// Making a section's question bank with AI (DESIGN, "Questions"). How many: by the amount of text, about
// one question per 100 words, at least 3 and at most 10 a page, and at least 10 for the section, so a
// slide of a few lines gets 3 and a dense page of a document saved as PDF gets more (Nathan, Nov 18).
// A page of under 20 words (title, divider, thank-you) counts as 1, and the AI skips such slides.
// They're asked for a few pages at a time, within the helper's 30 questions a request. What comes back
// is checked twice (src/ai/check.ts, then the store), repeats are dropped, and each request's
// questions are saved as they arrive, so stopping half-way keeps them.
import type { AiBackend, SlideText } from '../ai/backend';
import { questionKey } from '../db/quiz';
import type { Section } from '../types/lecture';
import type { QuizStore } from '../types/quiz';

export const WORDS_PER_QUESTION = 100;
/** Below this, a page is probably a title, divider or thank-you slide. */
export const SHORT_PAGE_WORDS = 20;
export const MIN_PER_PAGE = 3;
export const MAX_PER_PAGE = 10;
export const MIN_BANK = 10;
export const SLIDES_PER_REQUEST = 5;
/** The helper's limits (helper/jobs.mjs LIMITS): questions a request, characters a slide, questions to avoid. */
export const QUESTIONS_PER_REQUEST = 30;
const PAGE_TEXT_MAX = 8_000;
const AVOID_MAX = 200;

/** The slides of a section that have text to ask about, as the AI gets them. */
export function sectionSlides(section: Pick<Section, 'firstPage' | 'lastPage'>, pageTexts: string[]): SlideText[] {
  const slides: SlideText[] = [];
  for (let page = section.firstPage; page <= section.lastPage; page++) {
    const text = (pageTexts[page - 1] ?? '').trim().slice(0, PAGE_TEXT_MAX);
    if (text) slides.push({ page, text });
  }
  return slides;
}

/**
 * Questions a page is worth: one per WORDS_PER_QUESTION words, between MIN_PER_PAGE and MAX_PER_PAGE.
 * A page of under SHORT_PAGE_WORDS words (a title, section divider, "Thank you" or "Questions?" slide)
 * is worth just 1: it's still sent, and the AI is told to skip such slides and ask about the rest.
 */
export function questionsForPage(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < SHORT_PAGE_WORDS) return 1;
  return Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, Math.round(words / WORDS_PER_QUESTION)));
}

/** How many questions a section's bank should hold: its pages' worth, at least MIN_BANK (0 with no text). */
export function bankTarget(slides: SlideText[]): number {
  if (slides.length === 0) return 0;
  return Math.max(MIN_BANK, slides.reduce((n, s) => n + questionsForPage(s.text), 0));
}

export interface BankRequest {
  pages: SlideText[];
  count: number;
}

/** Whole numbers in proportion to `weights` that add up to `total` (largest remainder; ties to the earlier). */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

/**
 * The requests that fill a bank from `have` questions up to its target. Pages go in groups of at most
 * SLIDES_PER_REQUEST pages and QUESTIONS_PER_REQUEST questions' worth; the questions still needed are
 * shared between the groups by what their pages are worth (whole numbers that add up exactly). Empty
 * when the bank is full or there's no text.
 */
export function planBank(slides: SlideText[], have: number): BankRequest[] {
  const target = bankTarget(slides);
  const need = target - have;
  if (need <= 0) return [];
  const groups: { pages: SlideText[]; worth: number }[] = [];
  for (const slide of slides) {
    const worth = questionsForPage(slide.text);
    const last = groups.at(-1);
    if (last && last.pages.length < SLIDES_PER_REQUEST && last.worth + worth <= QUESTIONS_PER_REQUEST) {
      last.pages.push(slide);
      last.worth += worth;
    } else groups.push({ pages: [slide], worth });
  }
  // A section under MIN_BANK is topped up in proportion too (its target is more than its pages' worth)
  const counts = share(need, groups.map((g) => g.worth)).map((c) => Math.min(c, QUESTIONS_PER_REQUEST));
  return groups.map((g, i) => ({ pages: g.pages, count: counts[i]! })).filter((r) => r.count > 0);
}

export interface BankProgress {
  done: number; // requests finished
  total: number;
  added: number; // questions saved so far
}

/**
 * Fills a section's bank: one AI request per planned group, each answer saved before the next is
 * asked. Throws the AI's error (AiError) or the store's; what was saved before that stays.
 */
export async function fillBank(options: {
  ai: AiBackend;
  store: Pick<QuizStore, 'listQuestions' | 'addQuestions'>;
  section: Pick<Section, 'id' | 'firstPage' | 'lastPage'>;
  pageTexts: string[];
  onProgress?: (progress: BankProgress) => void;
  signal?: AbortSignal;
}): Promise<number> {
  const { ai, store, section, signal } = options;
  const existing = await store.listQuestions(section.id);
  const requests = planBank(sectionSlides(section, options.pageTexts), existing.length);
  const seen = new Set(existing.map((q) => questionKey(q.question)));
  const asked = existing.map((q) => q.question);
  let added = 0;
  options.onProgress?.({ done: 0, total: requests.length, added });
  for (const [i, request] of requests.entries()) {
    const made = await ai.makeQuestions({ ...request, avoid: asked.slice(-AVOID_MAX) }, signal);
    // Drop repeats (of the bank, or within this answer) rather than refusing the whole answer
    const fresh = made.filter((q) => {
      const key = questionKey(q.question);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length > 0) {
      await store.addQuestions(section.id, fresh);
      asked.push(...fresh.map((q) => q.question));
      added += fresh.length;
    }
    options.onProgress?.({ done: i + 1, total: requests.length, added });
  }
  return added;
}
