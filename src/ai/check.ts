// Checking the AI's answers on the device before anything uses them (CLAUDE.md: four options, one
// right answer among them, a slide number). The helper checks too; this is the app not trusting
// anything it didn't make itself.
import { AiError, type Grade, type McQuestion, type WrittenQuestion } from './backend';

const unusable = (why: string) => new AiError('unavailable', `The AI’s answer wasn’t usable (${why}).`);

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

/**
 * The questions that pass every check, in order; throws if none do or the reply isn't a list.
 * `pages` are the slide numbers that were sent: a question must come from one of them.
 */
export function checkQuestions(reply: unknown, pages: readonly number[], count: number): McQuestion[] {
  const list = (reply as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw unusable('no list of questions');
  const allowed = new Set(pages);
  const seen = new Set<string>();
  const good: McQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<Record<keyof McQuestion, unknown>> | null;
    if (!q || typeof q !== 'object') continue;
    const question = text(q.question, 600);
    if (!question || seen.has(question.toLowerCase())) continue;
    if (!Array.isArray(q.options) || q.options.length !== 4) continue;
    const options = q.options.map((o) => text(o, 300));
    if (options.some((o) => o === null)) continue;
    if (new Set(options.map((o) => o!.toLowerCase())).size !== 4) continue;
    if (!Number.isInteger(q.answer) || (q.answer as number) < 0 || (q.answer as number) > 3) continue;
    if (!Number.isInteger(q.page) || !allowed.has(q.page as number)) continue;
    seen.add(question.toLowerCase());
    good.push({
      question,
      options: options as McQuestion['options'],
      answer: q.answer as McQuestion['answer'],
      page: q.page as number,
      explanation: text(q.explanation, 600) ?? '',
    });
    if (good.length === count) break;
  }
  if (good.length === 0) throw unusable('no usable questions');
  return good;
}

/** Short-answer questions that pass every check, in order (#87): a question, 1-6 points, a slide that was sent. */
export function checkWritten(reply: unknown, pages: readonly number[], count: number): WrittenQuestion[] {
  const list = (reply as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) throw unusable('no list of questions');
  const allowed = new Set(pages);
  const seen = new Set<string>();
  const good: WrittenQuestion[] = [];
  for (const item of list) {
    const q = item as Partial<Record<keyof WrittenQuestion, unknown>> | null;
    if (!q || typeof q !== 'object') continue;
    const question = text(q.question, 600);
    if (!question || seen.has(question.toLowerCase())) continue;
    if (!Array.isArray(q.points) || q.points.length < 1 || q.points.length > 6) continue;
    const points = q.points.map((p) => text(p, 300));
    if (points.some((p) => p === null)) continue;
    if (typeof q.page !== 'number' || !allowed.has(q.page)) continue;
    seen.add(question.toLowerCase());
    good.push({ question, points: points as string[], page: q.page });
    if (good.length === count) break;
  }
  if (good.length === 0) throw unusable('no usable questions');
  return good;
}

export function checkGrade(reply: unknown, outOf: number): Grade {
  const r = reply as { mark?: unknown; feedback?: unknown } | null;
  const mark = r?.mark;
  if (!Number.isInteger(mark) || (mark as number) < 0 || (mark as number) > outOf) throw unusable('mark out of range');
  const feedback = text(r?.feedback, 400);
  if (!feedback) throw unusable('no feedback');
  return { mark: mark as number, outOf, feedback };
}

export function checkText(reply: unknown): string {
  const value = text((reply as { text?: unknown } | null)?.text, 4_000);
  if (!value) throw unusable('no text');
  return value;
}
