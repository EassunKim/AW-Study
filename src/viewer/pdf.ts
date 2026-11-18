// Opening PDFs with PDF.js (pdfjs-dist, Apache-2.0), entirely on the device. We use its *legacy*
// build: the modern one needs very new browsers (Uint8Array.toHex: Chrome 140, Safari 18.2) and
// Node 25, and the legacy one is only ~15% bigger. Everything PDF.js
// loads comes from our own site: its worker (bundled by Vite) and its data files (standard fonts,
// character maps, WebAssembly image decoders, colour profiles), which vite.config.ts copies to
// /pdfjs/. Nothing is fetched from another site, as the Content-Security-Policy requires.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// PDF.js parses in a Web Worker, loaded from our own site (worker-src 'self')
GlobalWorkerOptions.workerSrc = workerUrl;

/** Where PDF.js's data files are served (a folder URL, or a folder path in Node). */
let assetBase = '/pdfjs/';

/** For tests in Node: point PDF.js at node_modules/pdfjs-dist/ instead of /pdfjs/. */
export function setPdfAssetBase(base: string) {
  assetBase = base.endsWith('/') ? base : `${base}/`;
}

/** An open PDF. Call close() when done: it frees the worker and the memory PDF.js holds. */
export interface OpenPdf {
  doc: PDFDocumentProxy;
  close: () => Promise<void>;
}

/** Opens a PDF from its bytes (the bytes are copied: PDF.js takes ownership of what it gets). */
export async function openPdf(data: Uint8Array): Promise<OpenPdf> {
  const task = getDocument({
    data: data.slice(),
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    cMapUrl: `${assetBase}cmaps/`,
    wasmUrl: `${assetBase}wasm/`,
    iccUrl: `${assetBase}iccs/`,
    enableXfa: false, // forms in XFA would bring scripting; slides don't need it
    stopAtErrors: false,
  });
  try {
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (err) {
    void task.destroy();
    throw err;
  }
}

/**
 * Each page's text, in reading order as PDF.js gives it, one string per page (page 1 first).
 * For the AI and search; shows nothing. Runs of spaces collapse, line ends stay.
 */
export async function extractPageText(pdf: Uint8Array): Promise<string[]> {
  const { doc, close } = await openPdf(pdf);
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push(textOf((await page.getTextContent()).items));
      page.cleanup();
    }
    return pages;
  } finally {
    await close();
  }
}

/** Joins text items into a page's text. */
export function textOf(items: readonly unknown[]): string {
  let text = '';
  for (const item of items) {
    if (!isTextItem(item)) continue;
    text += item.str;
    text += item.hasEOL ? '\n' : item.str && !item.str.endsWith(' ') ? ' ' : '';
  }
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && typeof (item as TextItem).str === 'string';
}
