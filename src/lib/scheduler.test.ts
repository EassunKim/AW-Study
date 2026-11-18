import { describe, expect, it } from 'vitest';
import type { CardPhase, QueueCard, QueueOptions, Rating, SchedulingState } from '../types/study';
import {
  buildQueue,
  fromFsrsCard,
  intervalLabel,
  newSchedulingState,
  previewIntervals,
  retrievability,
  review,
  toFsrsCard,
} from './scheduler';

const NOW = new Date('2026-11-18T09:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

/** A card answered Good every time it came due, `times` times, starting new at NOW. */
function matured(times: number): { state: SchedulingState; at: Date } {
  let state = newSchedulingState(NOW);
  let at = NOW;
  for (let i = 0; i < times; i++) {
    at = new Date(Math.max(at.getTime(), Date.parse(state.due)));
    state = review(state, 3, at).next;
  }
  return { state, at };
}

describe('newSchedulingState', () => {
  it('is a never-reviewed card due now', () => {
    expect(newSchedulingState(NOW)).toEqual({
      phase: 'new',
      due: '2026-11-18T09:00:00.000Z',
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    });
  });
});

describe('review', () => {
  const fresh = newSchedulingState(NOW);
  const outcome = (rating: Rating) => review(fresh, rating, NOW);

  it('gives a new card four different outcomes, later for each better answer', () => {
    const dues = ([1, 2, 3, 4] as Rating[]).map((r) => Date.parse(outcome(r).next.due));
    expect(new Set(dues).size).toBe(4);
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
    // Again, Hard and Good stay in the learning steps (minutes); Easy graduates (days)
    for (const r of [1, 2, 3] as Rating[]) {
      expect(outcome(r).next.phase).toBe('learning');
      expect(Date.parse(outcome(r).next.due) - NOW.getTime()).toBeLessThan(60 * MINUTE);
    }
    expect(outcome(4).next.phase).toBe('review');
    expect(Date.parse(outcome(4).next.due) - NOW.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it('records the answer and the state before it', () => {
    const { next, entry } = outcome(3);
    expect(next.reps).toBe(1);
    expect(next.lastReview).toBe(NOW.toISOString());
    expect(entry).toMatchObject({
      rating: 3,
      reviewedAt: NOW.toISOString(),
      phaseBefore: 'new',
      dueBefore: fresh.due,
      stabilityBefore: 0,
      difficultyBefore: 0,
    });

    const { state, at } = matured(4);
    const later = review(state, 1, plus(at, 30 * DAY)).entry;
    expect(later).toMatchObject({
      phaseBefore: 'review',
      dueBefore: state.due,
      stabilityBefore: state.stability,
      difficultyBefore: state.difficulty,
    });
  });

  it('sends a forgotten review card to relearning and counts the lapse', () => {
    const { state, at } = matured(4);
    expect(state.phase).toBe('review');
    const { next } = review(state, 1, plus(at, 30 * DAY));
    expect(next.phase).toBe('relearning');
    expect(next.lapses).toBe(state.lapses + 1);
  });

  it('never mutates the state passed in', () => {
    const { state, at } = matured(3);
    const copy = structuredClone(state);
    review(Object.freeze(state), 2, plus(at, 5 * DAY));
    expect(state).toEqual(copy);
  });

  it('gives the same result for the same state, answer and time', () => {
    const { state, at } = matured(5);
    const when = plus(at, 40 * DAY);
    expect(review(state, 3, when)).toEqual(review(state, 3, when));
  });

  it('spreads intervals a little (fuzz is on)', () => {
    const { state, at } = matured(5);
    const days = new Set<number>();
    for (let i = 0; i < 40; i++) {
      days.add(review(state, 3, plus(at, 60 * DAY + i * MINUTE)).next.scheduledDays);
    }
    expect(days.size).toBeGreaterThan(1);
  });

  it('caps intervals at 36500 days', () => {
    let { state, at } = matured(1);
    for (let i = 0; i < 40; i++) {
      at = new Date(Date.parse(state.due));
      state = review(state, 4, at).next;
    }
    expect(state.scheduledDays).toBeLessThanOrEqual(36500);
    expect(state.scheduledDays).toBeGreaterThan(30000);
  });

  it('rejects a rating outside 1-4 and an invalid date', () => {
    expect(() => review(fresh, 0 as Rating, NOW)).toThrow(RangeError);
    expect(() => review(fresh, 5 as Rating, NOW)).toThrow(RangeError);
    expect(() => review(fresh, 3, new Date('nope'))).toThrow(RangeError);
  });
});

describe('conversion to and from ts-fsrs', () => {
  it('round-trips every state unchanged', () => {
    const states: SchedulingState[] = [newSchedulingState(NOW)];
    let { state, at } = { state: newSchedulingState(NOW), at: NOW };
    for (const rating of [3, 1, 3, 3, 2, 4, 1, 3] as Rating[]) {
      at = new Date(Math.max(at.getTime(), Date.parse(state.due)) + MINUTE);
      state = review(state, rating, at).next;
      states.push(state);
    }
    expect(new Set(states.map((s) => s.phase))).toEqual(
      new Set<CardPhase>(['new', 'learning', 'review', 'relearning']),
    );
    for (const s of states) expect(fromFsrsCard(toFsrsCard(s))).toEqual(s);
  });

  it('rejects a phase it does not know', () => {
    const bad = { ...newSchedulingState(NOW), phase: 'archived' as CardPhase };
    expect(() => toFsrsCard(bad)).toThrow(RangeError);
  });
});

describe('retrievability', () => {
  it('is 0 for a new card', () => {
    expect(retrievability(newSchedulingState(NOW), NOW)).toBe(0);
  });

  it('starts near 1, is about 0.9 when due, and keeps falling', () => {
    const { state } = matured(4);
    const last = new Date(state.lastReview!);
    const atDue = retrievability(state, plus(last, state.scheduledDays * DAY));
    expect(retrievability(state, last)).toBeCloseTo(1, 5);
    expect(atDue).toBeGreaterThan(0.85);
    expect(atDue).toBeLessThan(0.95);
    expect(retrievability(state, plus(last, 10 * state.scheduledDays * DAY))).toBeLessThan(atDue);
  });
});

describe('previewIntervals', () => {
  it("shows each button's due time and label for a new card", () => {
    const preview = previewIntervals(newSchedulingState(NOW), NOW);
    for (const r of [1, 2, 3, 4] as Rating[]) {
      expect(preview[r].due).toBe(review(newSchedulingState(NOW), r, NOW).next.due);
    }
    expect(preview[1].label).toBe('1m');
    expect(preview[2].label).toBe('6m');
    expect(preview[3].label).toBe('10m');
    expect(preview[4].label).toMatch(/^\d+d$/);
  });
});

describe('intervalLabel', () => {
  const H = 60 * MINUTE;
  it.each([
    [30_000, '1m'],
    [10 * MINUTE, '10m'],
    [59.4 * MINUTE, '59m'],
    [59.7 * MINUTE, '1h'],
    [5 * H, '5h'],
    [23.6 * H, '1d'],
    [3 * DAY, '3d'],
    [29.4 * DAY, '29d'],
    [30 * DAY, '1mo'],
    [76 * DAY, '2.5mo'],
    [350 * DAY, '11.5mo'],
    [364 * DAY, '1y'],
    [438 * DAY, '1.2y'],
    [3650 * DAY, '10y'],
  ])('%d ms reads %s', (ms, label) => {
    expect(intervalLabel(ms)).toBe(label);
  });
});

describe('buildQueue', () => {
  const options = (over: Partial<QueueOptions> = {}): QueueOptions => ({
    now: NOW, // 09:00 UTC on Nov 18; the study day runs from Nov 18 04:00 to Nov 19 04:00 UTC
    timeZone: 'UTC',
    dayStartHour: 4,
    newPerDay: 10,
    newIntroducedToday: 0,
    ...over,
  });

  let next = 0;
  const card = (
    id: string,
    phase: CardPhase,
    due: string,
    extra: { noteId?: string; position?: number; suspended?: boolean; lastReview?: string | null } = {},
  ): QueueCard => ({
    id,
    noteId: extra.noteId ?? `note-${id}`,
    position: extra.position ?? next++,
    suspended: extra.suspended ?? false,
    state: { ...newSchedulingState(new Date(due)), phase, lastReview: extra.lastReview ?? null },
  });

  it('puts due learning cards first, then reviews due today, then new cards', () => {
    const cards = [
      card('new-a', 'new', '2026-11-18T09:00:00Z', { position: 1 }),
      card('rev-late', 'review', '2026-11-18T20:00:00Z'),
      card('learn-b', 'relearning', '2026-11-18T08:59:00Z'),
      card('rev-old', 'review', '2026-11-10T09:00:00Z'),
      card('learn-a', 'learning', '2026-11-18T08:00:00Z'),
      card('new-b', 'new', '2026-11-18T09:00:00Z', { position: 0 }),
    ];
    expect(buildQueue(cards, options())).toEqual(['learn-a', 'learn-b', 'rev-old', 'rev-late', 'new-b', 'new-a']);
  });

  it('leaves out learning cards due after now and reviews due after today', () => {
    const cards = [
      card('learn-soon', 'learning', '2026-11-18T09:05:00Z'),
      card('learn-now', 'learning', '2026-11-18T09:00:00Z'),
      card('rev-tomorrow', 'review', '2026-11-19T12:00:00Z'),
    ];
    expect(buildQueue(cards, options())).toEqual(['learn-now']);
  });

  it('ends the study day at 4 a.m. local time', () => {
    const utc = [
      card('before-4', 'review', '2026-11-19T03:59:00Z'),
      card('at-4', 'review', '2026-11-19T04:00:00Z'),
    ];
    expect(buildQueue(utc, options())).toEqual(['before-4']);

    // Vancouver is UTC-8 in November. At noon local on Nov 18 (20:00 UTC) the study day ends at
    // 4 a.m. local on Nov 19, which is 12:00 UTC.
    const vancouver = [
      card('before-4', 'review', '2026-11-19T11:59:00Z'),
      card('at-4', 'review', '2026-11-19T12:00:00Z'),
    ];
    const noonInVancouver = new Date('2026-11-18T20:00:00Z');
    expect(buildQueue(vancouver, options({ now: noonInVancouver, timeZone: 'America/Vancouver' }))).toEqual([
      'before-4',
    ]);
    // At 1 a.m. local (09:00 UTC) it is still the Nov 17 study day, which ended at 12:00 UTC on Nov 18
    expect(buildQueue(vancouver, options({ timeZone: 'America/Vancouver' }))).toEqual([]);
  });

  it('limits new cards to what is left of the daily limit', () => {
    const cards = ['a', 'b', 'c', 'd'].map((id, i) => card(id, 'new', '2026-11-18T09:00:00Z', { position: i }));
    expect(buildQueue(cards, options({ newPerDay: 3, newIntroducedToday: 1 }))).toEqual(['a', 'b']);
    expect(buildQueue(cards, options({ newPerDay: 3, newIntroducedToday: 3 }))).toEqual([]);
    expect(buildQueue(cards, options({ newPerDay: 3, newIntroducedToday: 7 }))).toEqual([]);
  });

  it('never includes suspended cards', () => {
    const cards = [
      card('learn', 'learning', '2026-11-18T08:00:00Z', { suspended: true }),
      card('rev', 'review', '2026-11-17T09:00:00Z', { suspended: true }),
      card('new', 'new', '2026-11-18T09:00:00Z', { suspended: true }),
      card('ok', 'new', '2026-11-18T09:00:00Z'),
    ];
    expect(buildQueue(cards, options())).toEqual(['ok']);
  });

  it('holds back siblings of a note already studied today', () => {
    const seenToday = '2026-11-18T05:00:00Z';
    const cards = [
      card('c1', 'review', '2026-11-25T09:00:00Z', { noteId: 'n', lastReview: seenToday }),
      card('c2', 'review', '2026-11-17T09:00:00Z', { noteId: 'n' }),
      card('c3', 'new', '2026-11-18T09:00:00Z', { noteId: 'n' }),
    ];
    expect(buildQueue(cards, options())).toEqual([]);
  });

  it('does not count a review from before 4 a.m. as today', () => {
    const yesterday = '2026-11-18T03:59:00Z'; // still the Nov 17 study day
    const cards = [
      card('c1', 'review', '2026-11-25T09:00:00Z', { noteId: 'n', lastReview: yesterday }),
      card('c2', 'review', '2026-11-17T09:00:00Z', { noteId: 'n' }),
    ];
    expect(buildQueue(cards, options())).toEqual(['c2']);
  });

  it('takes one card per note from reviews and new cards together', () => {
    const cards = [
      card('n1-new', 'new', '2026-11-18T09:00:00Z', { noteId: 'n1', position: 0 }),
      card('n1-rev', 'review', '2026-11-17T09:00:00Z', { noteId: 'n1' }),
      card('n2-new-a', 'new', '2026-11-18T09:00:00Z', { noteId: 'n2', position: 1 }),
      card('n2-new-b', 'new', '2026-11-18T09:00:00Z', { noteId: 'n2', position: 2 }),
      card('n3-new', 'new', '2026-11-18T09:00:00Z', { noteId: 'n3', position: 3 }),
    ];
    // Held-back siblings don't use up the new-card limit
    expect(buildQueue(cards, options({ newPerDay: 2 }))).toEqual(['n1-rev', 'n2-new-a', 'n3-new']);
  });

  it('never holds back learning cards, siblings or not', () => {
    const today = '2026-11-18T08:50:00Z';
    const cards = [
      card('l1', 'learning', '2026-11-18T08:51:00Z', { noteId: 'n', lastReview: today }),
      card('l2', 'relearning', '2026-11-18T08:52:00Z', { noteId: 'n', lastReview: today }),
      card('rev', 'review', '2026-11-17T09:00:00Z', { noteId: 'n' }),
    ];
    expect(buildQueue(cards, options())).toEqual(['l1', 'l2']);
  });

  it('is empty for no cards', () => {
    expect(buildQueue([], options())).toEqual([]);
  });
});
