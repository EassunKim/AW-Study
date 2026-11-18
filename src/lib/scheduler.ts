// FSRS scheduling and the daily queue. Pure functions: no storage, no UI, no clock (the caller
// passes `now`). The only file that imports ts-fsrs; everything else uses the plain types in
// src/types/study.ts.
//
// STATUS: stub. Task issue "M2: scheduler and cloze" (GitHub, label agent-task). The signatures
// below are the contract the data layer and the screens are built against: keep them.
//
// Rules to implement (see docs/DESIGN.md, "The daily loop" and "Rules that keep FSRS honest"):
// - ts-fsrs 6 with desired retention 0.9 and maximum interval 36500 days.
// - Fuzz (the small random spread of intervals) on in the app, but deterministic: seed it from the
//   state passed in (e.g. its due time and reps; ts-fsrs offers a seeded generator), so the same
//   state, answer and time always give the same result. Tests must not depend on chance.
// - Converting to and from ts-fsrs's Card must lose nothing: a round trip of any state is equal.

import type {
  IntervalPreview,
  QueueCard,
  QueueOptions,
  Rating,
  ReviewOutcome,
  SchedulingState,
} from '../types/study';

/** The state of a card that has never been reviewed, due at `now`. */
export function newSchedulingState(now: Date): SchedulingState {
  void now;
  throw new Error('scheduler: not implemented yet');
}

/**
 * The user answered `rating` at `now`. Returns the card's next state and the review-log entry.
 * Never mutates `state`.
 */
export function review(state: SchedulingState, rating: Rating, now: Date): ReviewOutcome {
  void [state, rating, now];
  throw new Error('scheduler: not implemented yet');
}

/**
 * What each of the four buttons would do now, with short labels for under the buttons:
 * under an hour in minutes ("10m"), under a day in hours ("5h"), under a month in days ("3d"),
 * under a year in months ("2.5mo", one decimal), else years ("1.2y").
 */
export function previewIntervals(state: SchedulingState, now: Date): IntervalPreview {
  void [state, now];
  throw new Error('scheduler: not implemented yet');
}

/** The chance (0-1) the user would recall the card at `now`. New cards: 0. */
export function retrievability(state: SchedulingState, now: Date): number {
  void [state, now];
  throw new Error('scheduler: not implemented yet');
}

/**
 * The card ids to study now, in order. Called again after every answer, so it only needs to be
 * right for this moment. In order:
 * 1. Learning and relearning cards due by `now` (earliest due first).
 * 2. Review cards due by the end of today's study day (most overdue first, i.e. earliest due).
 * 3. New cards, lowest `position` first, at most `newPerDay - newIntroducedToday` (never negative).
 * Never includes suspended cards. Siblings (same noteId): at most one card per note from groups 2
 * and 3 in a study day. A note counts as already seen today when any of its cards has a
 * `lastReview` in today's study day; then its other cards wait for another day. Learning cards
 * (group 1) are never held back.
 * The study day comes from studyDay(now, timeZone, dayStartHour) in ./studyDay.
 */
export function buildQueue(cards: readonly QueueCard[], options: QueueOptions): string[] {
  void [cards, options];
  throw new Error('scheduler: not implemented yet');
}
