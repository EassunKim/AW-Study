// Test helper (not used by the app, so not in the build; it lives in src/ because the image build
// type-checks src/ without tests/). Makes small, valid PDF files for tests: landscape "slides"
// (720 × 540 points, 4:3) with a title and a line of text on each, in Helvetica (one of PDF's
// standard fonts, not embedded). No real lecture slides are ever committed (CLAUDE.md).

export interface FixturePage {
  title: string;
  body?: string;
}

/** A PDF with these pages, as bytes. */
export function makePdf(pages: FixturePage[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // its object number: they start at 1

  const catalog = add(''); // filled in once the pages object exists
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const page of pages) {
    const lines = [`BT /F1 36 Tf 60 440 Td (${escape(page.title)}) Tj ET`];
    if (page.body) lines.push(`BT /F1 20 Tf 60 380 Td (${escape(page.body)}) Tj ET`);
    lines.push('0.2 0.4 0.8 rg 60 100 600 12 re f'); // a coloured bar, so pages aren't blank
    const stream = lines.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 720 540] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out); // ASCII only, so characters and bytes line up
}

/** `count` numbered slides: "Slide 1" … with "Fixture text 1" … underneath. */
export function numberedSlides(count: number): Uint8Array {
  return makePdf(Array.from({ length: count }, (_, i) => ({ title: `Slide ${i + 1}`, body: `Fixture text ${i + 1}` })));
}

function escape(text: string): string {
  if (/[^\x20-\x7e]/.test(text)) throw new Error('makePdf: ASCII text only');
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}
