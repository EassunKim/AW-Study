import { describe, expect, it } from 'vitest';
import { AiError, type McQuestion } from '../ai/backend';
import { FakeAiBackend } from '../ai/fake';
import type { Question, QuestionInput, QuizAttempt } from '../types/quiz';
import { bankTarget, fillBank, planBank, sectionSlides, SLIDES_PER_REQUEST } from './bank';
import { describeScore, pickQuiz } from './pick';

const slides = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ page: from + i, text: `Slide ${from + i} text` }));

describe('sectionSlides', () => {
  it('takes the section’s pages with text, numbered from 1, trimmed and capped', () => {
    const pages = ['one', '  ', 'three', 'x'.repeat(9_000), 'five'];
    expect(sectionSlides({ firstPage: 2, lastPage: 4 }, pages)).toEqual([
      { page: 3, text: 'three' },
      { page: 4, text: 'x'.repeat(8_000) },
    ]);
  });
});

describe('planBank', () => {
  it('asks for about 3 a slide, at least 10, a few slides a request, adding up exactly', () => {
    expect(bankTarget(0)).toBe(0);
    expect(bankTarget(2)).toBe(10);
    expect(bankTarget(10)).toBe(30);
    expect(planBank(slides(3), 0)).toEqual([{ pages: slides(3), count: 10 }]);
    const plan = planBank(slides(12), 0);
    expect(plan.map((r) => r.pages.length)).toEqual([SLIDES_PER_REQUEST, SLIDES_PER_REQUEST, 2]);
    expect(plan.map((r) => r.count)).toEqual([15, 15, 6]);
    expect(planBank(slides(40), 0).every((r) => r.count <= 30)).toBe(true); // the helper's limit per request
  });

  it('only tops up what’s missing, and asks nothing for a full bank or no text', () => {
    expect(planBank(slides(12), 30).map((r) => r.count)).toEqual([3, 2, 1]);
    expect(planBank(slides(12), 36)).toEqual([]);
    expect(planBank([], 0)).toEqual([]);
  });
});

describe('fillBank', () => {
  /** A store that keeps questions in memory, with the real store's repeat rule. */
  function memoryStore() {
    const saved: QuestionInput[] = [];
    return {
      saved,
      listQuestions: async () => saved.map((q, i) => ({ ...q, id: `q${i}` }) as Question),
      addQuestions: async (_id: string, qs: QuestionInput[]) => {
        saved.push(...qs);
        return [] as Question[];
      },
    };
  }

  it('makes the bank request by request, telling the AI what it already has', async () => {
    const ai = new FakeAiBackend();
    const store = memoryStore();
    const progress: string[] = [];
    const added = await fillBank({
      ai,
      store,
      section: { id: 's', firstPage: 1, lastPage: 12 },
      pageTexts: slides(12).map((s) => s.text),
      onProgress: (p) => progress.push(`${p.done}/${p.total}:${p.added}`),
    });
    expect(added).toBe(36);
    expect(progress).toEqual(['0/3:0', '1/3:15', '2/3:30', '3/3:36']);
    expect(ai.calls.map((c) => (c.job === 'makeQuestions' ? c.request.avoid?.length : -1))).toEqual([0, 15, 30]);
  });

  it('drops repeats instead of refusing an answer, and keeps what was saved when the AI fails', async () => {
    const ai = new FakeAiBackend();
    const store = memoryStore();
    const real = ai.makeQuestions.bind(ai);
    let call = 0;
    ai.makeQuestions = async (request) => {
      if (++call === 2) throw new AiError('limit', 'Today’s limit.');
      const qs = await real(request);
      return [...qs, { ...qs[0]! } as McQuestion]; // the same question twice
    };
    const run = fillBank({ ai, store, section: { id: 's', firstPage: 1, lastPage: 12 }, pageTexts: slides(12).map((s) => s.text) });
    await expect(run).rejects.toMatchObject({ code: 'limit' });
    expect(store.saved).toHaveLength(15); // the first request's, without the repeat
  });
});

describe('pickQuiz', () => {
  const question = (id: string): Question => ({
    id,
    courseId: 'c',
    sectionId: 's',
    deckId: 'd',
    page: 1,
    question: id,
    options: ['a', 'b', 'c', 'd'],
    answer: 0,
    explanation: '',
    createdAt: '2026-11-18T00:00:00Z',
  });
  const attempt = (finishedAt: string, answers: [string, boolean][]): QuizAttempt => ({
    id: finishedAt,
    courseId: 'c',
    sectionId: 's',
    startedAt: finishedAt,
    finishedAt,
    answers: answers.map(([questionId, right]) => ({ questionId, chosen: 0, right, ms: 1 })),
    right: 0,
    asked: answers.length,
    score: 0,
    createdAt: finishedAt,
  });
  const noShuffle = () => 0.999; // leaves arrays in order

  it('asks last time’s wrong answers first, then new questions, then the longest-ago', () => {
    const bank = ['a', 'b', 'c', 'd', 'e', 'f'].map(question);
    const attempts = [
      attempt('2026-11-18T10:00:00Z', [['a', true], ['b', false]]), // newest
      attempt('2026-11-17T10:00:00Z', [['a', false], ['c', true], ['d', true]]),
      attempt('2026-11-16T10:00:00Z', [['d', true]]),
    ];
    // a: right last time (was wrong before); b: wrong; c, d: right on Nov 17; e, f: never asked
    expect(pickQuiz(bank, attempts, 6, noShuffle).map((i) => i.question.id)).toEqual(['b', 'e', 'f', 'c', 'd', 'a']);
    expect(pickQuiz(bank, attempts, 2, noShuffle).map((i) => i.question.id)).toEqual(['b', 'e']);
    expect(pickQuiz(bank.slice(0, 2), [], 5, noShuffle)).toHaveLength(2); // a small bank: all of it
  });

  it('shows each question’s options in a fresh order that still maps to the stored ones', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
    const items = pickQuiz(['a', 'b', 'c', 'd', 'e'].map(question), [], 5, random);
    for (const item of items) expect([...item.order].sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(items.map((i) => i.order.join(''))).size).toBeGreaterThan(1);
  });

  it('describes a score', () => {
    expect(describeScore(4, 5)).toBe('4 of 5 right (80%)');
    expect(describeScore(2, 3)).toBe('2 of 3 right (67%)');
  });
});
