// Reading a PDF the user picked: its bytes and the text of each page (which gives the page count),
// ready for addSlideDeck. PDF.js is loaded only when a PDF is first opened, so the app's first
// screen doesn't wait for it.
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '../db/lectures';

export interface PickedPdf {
  fileName: string;
  data: Uint8Array;
  pageTexts: string[];
}

export class PdfProblem extends Error {}

export async function readPdfFile(file: File): Promise<PickedPdf> {
  if (file.size === 0) throw new PdfProblem('That file is empty.');
  if (file.size > MAX_PDF_BYTES) throw new PdfProblem('That PDF is over 100 MB.');
  const data = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(data.subarray(0, 5)).startsWith('%PDF-')) {
    throw new PdfProblem('That file isn’t a PDF. Save the slides as a PDF first (in PowerPoint: File › Save As › PDF).');
  }
  const { extractPageText } = await import('../viewer/pdf');
  let pageTexts: string[];
  try {
    pageTexts = await extractPageText(data);
  } catch {
    throw new PdfProblem('That PDF couldn’t be opened. It may be damaged, or protected with a password.');
  }
  if (pageTexts.length === 0) throw new PdfProblem('That PDF has no pages.');
  if (pageTexts.length > MAX_PDF_PAGES) throw new PdfProblem(`PDFs can have at most ${MAX_PDF_PAGES} pages.`);
  return { fileName: file.name, data, pageTexts };
}
