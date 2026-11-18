// Cloze (fill-in-the-blank) notes: "The {{c1::mitochondria}} makes {{c2::ATP::energy molecule}}."
// Each number becomes its own card. Pure functions, no HTML: the screens turn ClozeSegments into
// React elements, so card text can never inject markup.
//
// Syntax: {{cN::answer}} or {{cN::answer::hint}}, N a whole number from 1 to 99. The same N may
// appear more than once (all of them are hidden together on that card). Text outside the braces is
// shown as is. Nested clozes are not allowed.
//
// Details the stub left open:
// - Every "{{" starts a cloze, so "{{note}}" is an error, not text. A lone "}}" is plain text.
// - The hint is everything after the answer's first "::". An empty hint ("{{c1::a::}}") is no hint.
// - Leading zeros are allowed: {{c01::...}} is cloze 1.
// - renderCloze on text that fails checkCloze shows the whole text as is, hiding nothing, rather
//   than throwing: the editor reports the error, the review screen never crashes.

import type { ClozeCheck, ClozeSegment } from '../types/study';

type Token = { kind: 'text'; text: string } | { kind: 'cloze'; n: number; answer: string; hint: string | null };

type Parsed = { ok: true; tokens: Token[] } | { ok: false; error: string };

const OPEN = '{{';
const CLOSE = '}}';
const MAX_N = 99;

/**
 * Checks a cloze note's text. ok: the cloze numbers used, sorted, each once. Not ok (with a short
 * message for the editor) when: there is no cloze at all, a cloze is unclosed or nested, N is 0, not
 * a whole number or above 99, or the answer is empty.
 */
export function checkCloze(text: string): ClozeCheck {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;
  const numbers = new Set<number>();
  for (const token of parsed.tokens) if (token.kind === 'cloze') numbers.add(token.n);
  if (numbers.size === 0) {
    return { ok: false, error: 'No cloze yet: wrap an answer like {{c1::answer}}.' };
  }
  return { ok: true, numbers: [...numbers].sort((a, b) => a - b) };
}

/**
 * Card `n` of the note. Front: every {{cn::...}} becomes a blank (with its hint, if any); clozes
 * with other numbers show their answer as ordinary text. Back: the same, but the cn answers are
 * revealed as 'answer' segments. Neighbouring text segments are merged.
 */
export function renderCloze(text: string, n: number, side: 'front' | 'back'): ClozeSegment[] {
  const parsed = parse(text);
  if (!parsed.ok) return text === '' ? [] : [{ kind: 'text', text }];

  const segments: ClozeSegment[] = [];
  const pushText = (value: string) => {
    if (value === '') return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.text += value;
    else segments.push({ kind: 'text', text: value });
  };

  for (const token of parsed.tokens) {
    if (token.kind === 'text') pushText(token.text);
    else if (token.n !== n) pushText(token.answer);
    else if (side === 'front') segments.push({ kind: 'blank', hint: token.hint });
    else segments.push({ kind: 'answer', text: token.answer });
  }
  return segments;
}

function parse(text: string): Parsed {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(OPEN, at);
    if (open < 0) {
      tokens.push({ kind: 'text', text: text.slice(at) });
      break;
    }
    if (open > at) tokens.push({ kind: 'text', text: text.slice(at, open) });

    const close = text.indexOf(CLOSE, open + OPEN.length);
    if (close < 0) return fail('A cloze is missing its closing }}.');
    const inner = text.slice(open + OPEN.length, close);
    if (inner.includes(OPEN)) return fail("Clozes can't be nested inside each other.");

    const cloze = parseInner(inner);
    if (!cloze.ok) return cloze;
    tokens.push(cloze.token);
    at = close + CLOSE.length;
  }
  return { ok: true, tokens };
}

function parseInner(inner: string): { ok: true; token: Token } | { ok: false; error: string } {
  const sep = inner.indexOf('::');
  const head = sep < 0 ? inner : inner.slice(0, sep);
  if (sep < 0 || !/^c/.test(head)) {
    return fail('Each cloze looks like {{c1::answer}}: a "c", a number, then "::".');
  }

  const digits = head.slice(1);
  if (!/^\d+$/.test(digits)) return fail(`"${digits}" isn't a whole number: use {{c1::...}}, {{c2::...}}.`);
  const n = Number(digits);
  if (n === 0) return fail('Cloze numbers start at 1, not 0.');
  if (n > MAX_N) return fail(`Cloze numbers go up to ${MAX_N}.`);

  const rest = inner.slice(sep + 2);
  const hintSep = rest.indexOf('::');
  const answer = hintSep < 0 ? rest : rest.slice(0, hintSep);
  const hint = hintSep < 0 ? '' : rest.slice(hintSep + 2);
  if (answer.trim() === '') return fail(`Cloze ${n} has an empty answer.`);

  return { ok: true, token: { kind: 'cloze', n, answer, hint: hint.trim() === '' ? null : hint } };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
