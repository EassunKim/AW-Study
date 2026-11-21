// The slide viewer (DESIGN, "The slide viewer"): one slide at a time, fitted to the screen, exactly
// as the PDF draws it. Arrow keys, swipes, the buttons or the thumbnail strip move between slides;
// pinch, the +/− buttons or the + and − keys zoom. The section's range is marked; the rest of the
// deck stays reachable. A text layer (invisible, selectable text over the slide) lets words be
// selected; `overlay` draws on top of the slide (notes and highlights, #56: ./AnnotatedViewer.tsx).
//
// Portrait pages (documents saved as PDF) fit the width instead and scroll down (#46, ./fit.ts), with a
// Whole page / Page width switch in the bar.
//
// Only what's needed is drawn: the current slide at screen size, and thumbnails as they scroll
// into view, so a 200-page deck stays quick.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { RenderingCancelledException, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fitPage, type Fit, type Size } from './fit';
import { openPdf } from './pdf';
import './viewer.css';

/** Pages `first` to `last`, counting from 1, both included. */
export interface SlideRange {
  first: number;
  last: number;
}

export interface SlideViewerProps {
  /** The PDF's bytes. */
  pdf: Uint8Array;
  /**
   * The slide to show (from 1). Changing it moves the viewer. To jump again to a slide the user has
   * since left, keep `page` in step with onPageChange (as src/viewer/demo.tsx does).
   */
  page?: number;
  /** The section's slides, marked in the viewer. */
  range?: SlideRange;
  /** Called when the user moves to another slide. */
  onPageChange?: (page: number) => void;
  /** Drawn over the current slide, in a box exactly its size (positions in % line up at any zoom). */
  overlay?: (page: number) => ReactNode;
  /** More controls at the end of the viewer's bar. */
  barExtra?: ReactNode;
}

export const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const SWIPE_PX = 50;
const MAX_CANVAS_PIXELS = 16_000_000; // browsers refuse bigger canvases (iPhones especially)

export function SlideViewer({ pdf, page: wanted = 1, range, onPageChange, overlay, barExtra }: SlideViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState(wanted);
  const [zoom, setZoom] = useState(1);
  const [chosenFit, setChosenFit] = useState<Fit | null>(null); // null: picked by the page's shape
  const [natural, setNatural] = useState<Size | null>(null); // the current page's size, in points
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const count = doc?.numPages ?? 0;
  const shown = count ? clamp(page, 1, count) : page;
  const layout = natural && size.width > 0 && size.height > 0 ? fitPage(natural, size, chosenFit) : null;
  const fit = layout?.fit ?? 'page';
  /** Fit width, at fit size: the stage scrolls down, and up/down keys scroll before they move. */
  const scrolling = fit === 'width' && zoom === 1;

  // Open the PDF; close it when it changes or the viewer goes away
  useEffect(() => {
    let live = true;
    let close: (() => Promise<void>) | null = null;
    setDoc(null);
    setProblem(null);
    openPdf(pdf).then(
      (opened) => {
        if (!live) return void opened.close();
        close = opened.close;
        setDoc(opened.doc);
      },
      () => live && setProblem('This PDF couldn’t be opened. It may be damaged, or protected with a password.'),
    );
    return () => {
      live = false;
      void close?.();
    };
  }, [pdf]);

  // The current page's size, which picks its fit. Until it's known the last page's size stands in (a
  // deck's pages are nearly always one size), so moving doesn't blank the slide.
  useEffect(() => {
    if (!doc) return void setNatural(null);
    let live = true;
    doc.getPage(clamp(shown, 1, doc.numPages)).then(
      (p) => {
        if (!live) return;
        const { width, height } = p.getViewport({ scale: 1 });
        setNatural((old) => (old?.width === width && old.height === height ? old : { width, height }));
      },
      () => {}, // drawing the page reports the problem
    );
    return () => {
      live = false;
    };
  }, [doc, shown]);

  // A new page, or a new fit, starts at its top
  useEffect(() => {
    stageRef.current?.scrollTo?.({ top: 0, left: 0 });
  }, [shown, fit]);

  // Follow the `page` prop
  useEffect(() => {
    setPage(wanted);
    setZoom(1);
  }, [wanted]);

  const onChange = useRef(onPageChange);
  onChange.current = onPageChange;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const go = useCallback(
    (to: number) => {
      if (!count) return;
      const next = clamp(to, 1, count);
      if (next === shownRef.current) return;
      shownRef.current = next;
      setPage(next);
      setZoom(1);
      onChange.current?.(next);
    },
    [count],
  );

  const zoomBy = (factor: number) => setZoom((z) => clamp(round2(z * factor), 1, ZOOM_MAX));
  const switchFit = (to: Fit) => {
    setChosenFit(to);
    setZoom(1);
  };

  /** In fit width: scroll the page by `by` pixels, or move to the next or previous page at its end. */
  const scrollOrMove = (by: number) => {
    const stage = stageRef.current;
    if (stage) {
      const room = by > 0 ? stage.scrollHeight - stage.clientHeight - stage.scrollTop : stage.scrollTop;
      if (room > 1) return void stage.scrollBy({ top: by });
    }
    go(shown + Math.sign(by));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (scrolling) {
      const screen = (stageRef.current?.clientHeight ?? 0) * 0.85;
      const scroll: Record<string, number> = { ArrowDown: 60, ArrowUp: -60, PageDown: screen, ' ': screen, PageUp: -screen };
      const by = scroll[e.key];
      if (by !== undefined && !e.shiftKey) {
        e.preventDefault();
        return scrollOrMove(by);
      }
    }
    const actions: Record<string, () => void> = {
      ArrowRight: () => go(shown + 1),
      ArrowDown: () => go(shown + 1),
      PageDown: () => go(shown + 1),
      ' ': () => go(shown + 1),
      ArrowLeft: () => go(shown - 1),
      ArrowUp: () => go(shown - 1),
      PageUp: () => go(shown - 1),
      Home: () => go(1),
      End: () => go(count),
      '+': () => zoomBy(ZOOM_STEP),
      '=': () => zoomBy(ZOOM_STEP),
      '-': () => zoomBy(1 / ZOOM_STEP),
      '0': () => setZoom(1),
    };
    // While zoomed, arrows scroll the slide instead
    if (zoom > 1 && e.key.startsWith('Arrow')) return;
    const action = actions[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  const gestures = useGestures({ zoom, setZoom, next: () => go(shown + 1), previous: () => go(shown - 1) });
  const inRange = range ? shown >= range.first && shown <= range.last : null;

  return (
    <div
      className="slide-viewer"
      role="region"
      aria-roledescription="slide viewer"
      aria-label="Slides"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="sv-bar">
        <button type="button" className="sv-step" onClick={() => go(shown - 1)} disabled={!count || shown <= 1} aria-label="Previous slide">
          ‹
        </button>
        <span className="sv-position" data-testid="slide-position" aria-live="polite">
          {count ? `Slide ${shown} of ${count}` : 'Opening…'}
        </span>
        <button type="button" className="sv-step" onClick={() => go(shown + 1)} disabled={!count || shown >= count} aria-label="Next slide">
          ›
        </button>
        {range && (
          // As wide as the longer label always (viewer.css), so nothing after it moves when it changes (#110)
          <span className={`sv-range ${inRange ? 'in' : 'out'}`} data-testid="slide-range" data-wide={`Outside this section: slides ${range.first}–${range.last}`}>
            <span>
              {inRange ? 'This section' : 'Outside this section'}: slides {range.first}–{range.last}
            </span>
          </span>
        )}
        <span className="sv-zoom">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= 1} aria-label="Zoom out">
            −
          </button>
          <span data-testid="zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">
            +
          </button>
          {zoom > 1 && (
            <button type="button" onClick={() => setZoom(1)}>
              Fit
            </button>
          )}
        </span>
        {layout?.choice && (
          <button type="button" data-testid="fit-switch" onClick={() => switchFit(fit === 'width' ? 'page' : 'width')}>
            {fit === 'width' ? 'Whole page' : 'Page width'}
          </button>
        )}
        {barExtra}
      </div>

      <div
        ref={stageRef}
        className={`sv-stage ${zoom > 1 ? 'zoomed' : scrolling ? 'scrolling' : ''}`}
        {...gestures}
        data-testid="slide-stage"
        data-fit={layout ? fit : undefined}
      >
        {problem ? (
          <p className="error">{problem}</p>
        ) : (
          doc && layout && <Slide doc={doc} page={shown} scale={layout.scale * zoom} onProblem={setProblem} overlay={overlay} />
        )}
      </div>

      {doc && <Thumbnails doc={doc} current={shown} range={range} onPick={go} />}
    </div>
  );
}

// --- The current slide ---

function Slide({
  doc,
  page,
  scale,
  onProblem,
  overlay,
}: {
  doc: PDFDocumentProxy;
  page: number;
  /** PDF.js's scale: CSS pixels per point (fitted, then zoomed). */
  scale: number;
  onProblem: (message: string) => void;
  overlay?: (page: number) => ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let text: TextLayer | null = null;
    const draw = async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      const box = boxRef.current!;
      const canvas = canvasRef.current!;
      const pixels = pixelRatio(viewport.width, viewport.height);
      canvas.width = Math.floor(viewport.width * pixels);
      canvas.height = Math.floor(viewport.height * pixels);
      box.style.width = `${Math.floor(viewport.width)}px`;
      box.style.height = `${Math.floor(viewport.height)}px`;
      box.style.setProperty('--total-scale-factor', String(viewport.scale));
      box.dataset.rendered = '';
      task = pdfPage.render({ canvas, viewport, transform: pixels === 1 ? undefined : [pixels, 0, 0, pixels, 0, 0] });
      await task.promise;
      if (cancelled) return;
      const layer = textRef.current!;
      layer.replaceChildren();
      text = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container: layer, viewport });
      await text.render();
      if (!cancelled) box.dataset.rendered = String(page);
    };
    draw().catch((err: unknown) => {
      if (!cancelled && !(err instanceof RenderingCancelledException)) onProblem(`Slide ${page} couldn’t be drawn.`);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, page, scale, onProblem]);

  return (
    <div ref={boxRef} className="sv-page" data-testid="slide-page">
      <canvas ref={canvasRef} aria-label={`Slide ${page}`} role="img" />
      <div ref={textRef} className="textLayer" />
      {overlay?.(page)}
    </div>
  );
}

/** Device pixels per CSS pixel for a sharp slide, lowered for huge zooms so the canvas stays drawable. */
function pixelRatio(width: number, height: number): number {
  const wanted = Math.min(globalThis.devicePixelRatio || 1, 3);
  const fits = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
  return Math.max(0.25, Math.min(wanted, fits));
}

// --- Thumbnails ---

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 72; // keep in step with .sv-thumb's height in viewer.css

function Thumbnails({
  doc,
  current,
  range,
  onPick,
}: {
  doc: PDFDocumentProxy;
  current: number;
  range?: SlideRange;
  onPick: (page: number) => void;
}) {
  const stripRef = useRef<HTMLOListElement>(null);

  // Keep the current slide's thumbnail in view
  useEffect(() => {
    const item = stripRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    item?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <ol ref={stripRef} className="sv-thumbs" aria-label="All slides">
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
        <li key={n} data-page={n} className={range && n >= range.first && n <= range.last ? 'in-range' : ''}>
          <button
            type="button"
            onClick={() => onPick(n)}
            aria-label={`Slide ${n}`}
            aria-current={n === current ? 'true' : undefined}
          >
            <Thumbnail doc={doc} page={n} root={stripRef} />
            <span className="sv-thumb-number">{n}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Drawn the first time it comes near the visible part of the strip. */
function Thumbnail({ doc, page, root }: { doc: PDFDocumentProxy; page: number; root: RefObject<HTMLOListElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: root.current, rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [near, root]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      // Within THUMB_WIDTH × THUMB_HEIGHT: a portrait page's thumbnail is narrower, never taller (#46)
      const viewport = pdfPage.getViewport({ scale: Math.min(THUMB_WIDTH / natural.width, THUMB_HEIGHT / natural.height) });
      const canvas = canvasRef.current!;
      const pixels = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixels);
      canvas.height = Math.floor(viewport.height * pixels);
      task = pdfPage.render({ canvas, viewport, transform: pixels === 1 ? undefined : [pixels, 0, 0, pixels, 0, 0] });
      await task.promise;
      if (!cancelled) canvas.dataset.rendered = 'true';
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, page]);

  return <canvas ref={canvasRef} className="sv-thumb" width={THUMB_WIDTH} height={THUMB_HEIGHT} />;
}

// --- Swipes and pinches ---

function useGestures({
  zoom,
  setZoom,
  next,
  previous,
}: {
  zoom: number;
  setZoom: (zoom: number) => void;
  next: () => void;
  previous: () => void;
}) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; onWords: boolean } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  return {
    onPointerDown(e: PointerEvent) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        // A mouse pressed on words selects them: that drag is never a swipe
        const onWords = e.pointerType === 'mouse' && !!(e.target as Element).closest?.('.textLayer span');
        start.current = { x: e.clientX, y: e.clientY, onWords };
      }
      if (pointers.current.size === 2) {
        start.current = null; // a pinch, not a swipe
        pinch.current = { distance: distance(), zoom };
      }
    },
    onPointerMove(e: PointerEvent) {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && pointers.current.size === 2 && pinch.current.distance > 0) {
        setZoom(clamp(round2((pinch.current.zoom * distance()) / pinch.current.distance), 1, ZOOM_MAX));
      }
    },
    onPointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      const from = start.current;
      if (!from || pointers.current.size > 0) return;
      start.current = null;
      if (zoom > 1) return; // zoomed in, a drag moves around the slide
      if (from.onWords || selectingText()) return; // a drag that selected words, not a swipe
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0) next();
        else previous();
      }
    },
    onPointerCancel(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      pinch.current = null;
      start.current = null;
    },
  };
}

// --- Helpers ---

/** Whether some words on the page are selected (a drag over the text layer selects, it doesn't swipe). */
function selectingText(): boolean {
  const selection = globalThis.getSelection?.();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== '';
}

/** The element's content size, kept up to date. */
function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
