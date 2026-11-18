// Page text extraction, on PDFs made in the test (tests/fixtures/make-pdf.ts). PDF.js runs in Node
// here, with its worker in the same thread and its data files read from node_modules.
import { fileURLToPath } from 'node:url';
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { makePdf, numberedSlides } from '../../tests/fixtures/make-pdf';
import { extractPageText, openPdf, setPdfAssetBase, textOf } from './pdf';

beforeAll(() => {
  GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  setPdfAssetBase(fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url)));
});

describe('extractPageText', () => {
  it('gives each page’s text, in page order', async () => {
    const text = await extractPageText(
      makePdf([
        { title: 'Covalent bonds', body: 'Atoms share electrons (a pair per bond).' },
        { title: 'Ionic bonds', body: 'One atom gives an electron to another.' },
        { title: 'Summary' },
      ]),
    );
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('Covalent bonds');
    expect(text[0]).toContain('Atoms share electrons (a pair per bond).');
    expect(text[1]).toContain('Ionic bonds');
    expect(text[2]).toBe('Summary');
  });

  it('handles a long deck', async () => {
    const text = await extractPageText(numberedSlides(120));
    expect(text).toHaveLength(120);
    expect(text[119]).toContain('Slide 120');
    expect(text[119]).toContain('Fixture text 120');
  });

  it('does not take the caller’s bytes away', async () => {
    const bytes = numberedSlides(2);
    const length = bytes.length;
    await extractPageText(bytes);
    expect(bytes.length).toBe(length); // PDF.js would detach a buffer it was given directly
    const { doc, close } = await openPdf(bytes);
    expect(doc.numPages).toBe(2);
    await close();
  });

  it('refuses something that isn’t a PDF', async () => {
    await expect(extractPageText(new TextEncoder().encode('hello'))).rejects.toThrow();
  });
});

describe('textOf', () => {
  it('joins items with spaces, keeps line ends, collapses runs of spaces', () => {
    const item = (str: string, hasEOL = false) => ({ str, hasEOL, dir: 'ltr', transform: [], width: 0, height: 0, fontName: 'f' });
    expect(textOf([item('Hello'), item('world', true), item('Next   line'), { type: 'beginMarkedContent' }, item('  end ')])).toBe(
      'Hello world\nNext line end',
    );
  });
});
