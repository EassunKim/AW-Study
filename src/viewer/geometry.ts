// Positions of notes and highlights (#56). The store keeps them as fractions of the page (0 to 1, from
// the top left: src/types/annotation.ts PageRect), so they line up at any zoom and screen size. These
// turn what the browser measures (pixels on screen) into fractions and back. Pure, with tests.
import type { PageRect } from '../types/annotation';

/** A box in screen pixels, as getBoundingClientRect gives it. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Math.round(n * 10_000) / 10_000; // a 10,000th of the page is plenty

/** A box on screen as fractions of the page box, cut to the page; null if nothing of it is on the page. */
export function toPageRect(box: ScreenBox, page: ScreenBox): PageRect | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const x1 = clamp01((box.left - page.left) / page.width);
  const y1 = clamp01((box.top - page.top) / page.height);
  const x2 = clamp01((box.left + box.width - page.left) / page.width);
  const y2 = clamp01((box.top + box.height - page.top) / page.height);
  if (x2 <= x1 || y2 <= y1) return null;
  const x = round(x1);
  const y = round(y1);
  return { x, y, w: Math.min(round(x2 - x), round(1 - x)), h: Math.min(round(y2 - y), round(1 - y)) };
}

/** A point on screen as a pinned note's position (w and h 0), or null if it's off the page. */
export function toPagePoint(clientX: number, clientY: number, page: ScreenBox): PageRect | null {
  if (page.width <= 0 || page.height <= 0) return null;
  const x = (clientX - page.left) / page.width;
  const y = (clientY - page.top) / page.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: round(x), y: round(y), w: 0, h: 0 };
}

/** The box between two points (a drag), as fractions; either corner may come first. */
export function boxBetween(a: { x: number; y: number }, b: { x: number; y: number }): PageRect {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  return { x: round(x), y: round(y), w: round(clamp01(Math.max(a.x, b.x)) - x), h: round(clamp01(Math.max(a.y, b.y)) - y) };
}

/**
 * A text selection's boxes (Range.getClientRects, one or more per word run, sometimes with
 * duplicates for whole elements) as one box per line: boxes that share most of their height and
 * touch or overlap are joined. Tiny boxes (empty runs, line ends) are dropped.
 */
export function lineRects(rects: readonly PageRect[]): PageRect[] {
  const usable = rects.filter((r) => r.w > 0.001 && r.h > 0.001).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PageRect[] = [];
  for (const r of usable) {
    const line = lines.find((l) => sameLine(l, r) && r.x <= l.x + l.w + 0.01 && l.x <= r.x + r.w + 0.01);
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const right = Math.max(line.x + line.w, r.x + r.w);
    const bottom = Math.max(line.y + line.h, r.y + r.h);
    line.x = Math.min(line.x, r.x);
    line.y = Math.min(line.y, r.y);
    line.w = round(right - line.x);
    line.h = round(bottom - line.y);
  }
  return lines;
}

function sameLine(a: PageRect, b: PageRect): boolean {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return overlap > 0.5 * Math.min(a.h, b.h);
}

/** The words inside a box: each piece of text whose centre is in the box, in reading order. */
export function textInArea(area: PageRect, pieces: readonly { rect: PageRect; text: string }[]): string {
  return pieces
    .filter(({ rect, text }) => {
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      return text.trim() !== '' && cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
    })
    .map((p) => p.text.trim())
    .join(' ');
}

/** A fraction as a CSS percentage. */
export const percent = (n: number) => `${round(n * 100)}%`;
