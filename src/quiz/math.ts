// Maths in quiz text: the AI writes LaTeX between \( and \) (in a line) or \[ and \] (on its own),
// never $...$ (a price like "$5" would read as maths). This splits text into plain and maths parts;
// MathText (src/ui/MathText.tsx) shows the maths with KaTeX and the rest as plain React text.

export type MathPart = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

/** Longest LaTeX shown as maths; anything longer stays plain text (a runaway answer). */
const TEX_MAX = 1_000;

export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const open = text.startsWith('\\(', i) ? '\\)' : text.startsWith('\\[', i) ? '\\]' : null;
    const end = open ? text.indexOf(open, i + 2) : -1;
    if (open && end !== -1 && end - (i + 2) <= TEX_MAX) {
      const tex = text.slice(i + 2, end).trim();
      if (tex) {
        if (plain) parts.push({ kind: 'text', text: plain });
        plain = '';
        parts.push({ kind: 'math', tex, display: open === '\\]' });
        i = end + 2;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  if (plain) parts.push({ kind: 'text', text: plain });
  return parts;
}

/** The text with its maths markers taken out, for places that show plain text (and for repeats). */
export function plainMath(text: string): string {
  return splitMath(text)
    .map((p) => (p.kind === 'text' ? p.text : p.tex))
    .join('');
}
