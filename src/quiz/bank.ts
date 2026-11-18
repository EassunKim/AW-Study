// Making a section's question bank with AI (DESIGN, "Questions"): about 3 questions per slide, at
// least 10, asked for a few slides at a time so each request stays well inside the helper's time
// and size limits. What comes back is checked twice (src/ai/check.ts, then the store), repeats are
// dropped, and each request's questions are saved as they arrive, so stopping half-way keeps them.
import type { AiBackend, SlideText } from '../ai/backend';
import { questionKey } from '../db/quiz';
import type { Section } from '../types/lecture';
import type { QuizStore } from '../types/quiz';

export const QUESTIONS_PER_SLIDE = 3;
export const MIN_BANK = 10;
export const SLIDES_PER_REQUEST = 5;
/** The helper's limits (helper/jobs.mjs LIMITS): characters per slide, questions to avoid. */
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

/** How many questions a section's bank should hold. */
export function bankTarget(slideCount: number): number {
  return slideCount === 0 ? 0 : Math.max(MIN_BANK, QUESTIONS_PER_SLIDE * slideCount);
}

export interface BankRequest {
  pages: SlideText[];
  count: number;
}

/**
 * The requests that fill a bank from `have` questions up to its target: the slides in groups of
 * SLIDES_PER_REQUEST, the questions still needed shared between them by slide count (whole numbers that
 * add up exactly). Empty when the bank is full or there's no slide text.
 */
export function planBank(slides: SlideText[], have: number): BankRequest[] {
  const need = bankTarget(slides.length) - have;
  if (need <= 0) return [];
  const groups: SlideText[][] = [];
  for (let i = 0; i < slides.length; i += SLIDES_PER_REQUEST) groups.push(slides.slice(i, i + SLIDES_PER_REQUEST));
  const exact = groups.map((g) => (need * g.length) / slides.length);
  const counts = exact.map(Math.floor);
  let left = need - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    counts[i]!++;
    left--;
  }
  return groups.map((pages, i) => ({ pages, count: counts[i]! })).filter((r) => r.count > 0);
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
