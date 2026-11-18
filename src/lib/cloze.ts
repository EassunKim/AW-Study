// Cloze (fill-in-the-blank) notes: "The {{c1::mitochondria}} makes {{c2::ATP::energy molecule}}."
// Each number becomes its own card. Pure functions, no HTML: the screens turn ClozeSegments into
// React elements, so card text can never inject markup.
//
// STATUS: stub. Task issue "M2: scheduler and cloze" (GitHub, label agent-task). Keep these
// signatures: the data layer and the screens are built against them.
//
// Syntax: {{cN::answer}} or {{cN::answer::hint}}, N a whole number from 1 to 99. The same N may
// appear more than once (all of them are hidden together on that card). Text outside the braces is
// shown as is. Nested clozes are not allowed.

import type { ClozeCheck, ClozeSegment } from '../types/study';

/**
 * Checks a cloze note's text. ok: the cloze numbers used, sorted, each once. Not ok (with a short
 * message for the editor) when: there is no cloze at all, a cloze is unclosed or nested, N is 0, not
 * a whole number or above 99, or the answer is empty.
 */
export function checkCloze(text: string): ClozeCheck {
  void text;
  throw new Error('cloze: not implemented yet');
}

/**
 * Card `n` of the note. Front: every {{cn::...}} becomes a blank (with its hint, if any); clozes
 * with other numbers show their answer as ordinary text. Back: the same, but the cn answers are
 * revealed as 'answer' segments. Neighbouring text segments are merged.
 */
export function renderCloze(text: string, n: number, side: 'front' | 'back'): ClozeSegment[] {
  void [text, n, side];
  throw new Error('cloze: not implemented yet');
}
