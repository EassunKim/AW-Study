// FSRS scheduling and the daily queue. Pure functions: no storage, no UI, no clock (the caller
// passes `now`). The only file that imports ts-fsrs; everything else uses the plain types in
// src/types/study.ts.
//
// Rules (see docs/DESIGN.md, "The daily loop" and "Rules that keep FSRS honest"):
// - ts-fsrs 6 with desired retention 0.9 and maximum interval 36500 days.
// - Fuzz (the small random spread of intervals) is on, but deterministic: ts-fsrs seeds it from the
//   review time, the rep count and the card's difficulty and stability, so the same state, answer
//   and time always give the same result. Tests never depend on chance.
// - Converting to and from ts-fsrs's Card loses nothing: a round trip of any state is equal.
//
// We use ts-fsrs's classic `fsrs()` API. Version 6 marks it deprecated in favour of a new
// middleware-based scheduler, but it is still exported and fully supported; moving over later only
// touches this file.

import { fsrs, generatorParameters, State, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type {
  CardPhase,
  IntervalPreview,
  QueueCard,
  QueueOptions,
  Rating,
  ReviewOutcome,
  SchedulingState,
} from '../types/study';
import { studyDay } from './studyDay';

const engine = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: true,
  }),
);

const RATINGS: readonly Rating[] = [1, 2, 3, 4];

/** The state of a card that has never been reviewed, due at `now`. */
export function newSchedulingState(now: Date): SchedulingState {
  return {
    phase: 'new',
    due: iso(now),
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
}

/**
 * The user answered `rating` at `now`. Returns the card's next state and the review-log entry.
 * Never mutates `state`.
 */
export function review(state: SchedulingState, rating: Rating, now: Date): ReviewOutcome {
  checkRating(rating);
  const { card, log } = engine.next(toFsrsCard(state), checkDate(now), rating as Grade);
  return {
    next: fromFsrsCard(card),
    entry: {
      rating,
      reviewedAt: iso(now),
      // The card as it was before this answer. Taken from our own input rather than ts-fsrs's log,
      // whose `due` field actually holds the previous review time.
      phaseBefore: state.phase,
      dueBefore: state.due,
      stabilityBefore: state.stability,
      difficultyBefore: state.difficulty,
      scheduledDays: log.scheduled_days,
      learningSteps: log.learning_steps,
    },
  };
}

/**
 * What each of the four buttons would do now, with short labels for under the buttons:
 * under an hour in minutes ("10m"), under a day in hours ("5h"), under a month in days ("3d"),
 * under a year in months ("2.5mo", one decimal), else years ("1.2y").
 */
export function previewIntervals(state: SchedulingState, now: Date): IntervalPreview {
  checkDate(now);
  const preview = {} as IntervalPreview;
  for (const rating of RATINGS) {
    const { next } = review(state, rating, now);
    preview[rating] = { due: next.due, label: intervalLabel(Date.parse(next.due) - now.getTime()) };
  }
  return preview;
}

/** The chance (0-1) the user would recall the card at `now`. New cards: 0. */
export function retrievability(state: SchedulingState, now: Date): number {
  if (state.phase === 'new') return 0;
  return engine.retrievability(toFsrsCard(state), checkDate(now));
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
  const { now, timeZone, dayStartHour } = options;
  const nowMs = checkDate(now).getTime();
  const today = studyDay(now, timeZone, dayStartHour);
  const dayOf = (isoTime: string) => studyDay(new Date(isoTime), timeZone, dayStartHour);

  // Notes already studied today, from any of their cards (suspended ones included: the note was
  // still seen).
  const notesSeen = new Set<string>();
  for (const card of cards) {
    if (card.state.lastReview !== null && dayOf(card.state.lastReview) === today) {
      notesSeen.add(card.noteId);
    }
  }

  const active = cards.filter((card) => !card.suspended);
  const byDue = (a: QueueCard, b: QueueCard) =>
    Date.parse(a.state.due) - Date.parse(b.state.due) || compareIds(a.id, b.id);

  const learning = active
    .filter((c) => isLearning(c.state.phase) && Date.parse(c.state.due) <= nowMs)
    .sort(byDue);

  const queue = learning.map((c) => c.id);

  // Groups 2 and 3 share the sibling rule: one card per note per study day.
  const takeOnePerNote = (candidate: QueueCard) => {
    if (notesSeen.has(candidate.noteId)) return false;
    notesSeen.add(candidate.noteId);
    return true;
  };

  const reviews = active
    .filter((c) => c.state.phase === 'review' && dayOf(c.state.due) <= today)
    .sort(byDue);
  for (const card of reviews) {
    if (takeOnePerNote(card)) queue.push(card.id);
  }

  let newLeft = Math.max(0, options.newPerDay - options.newIntroducedToday);
  const fresh = active
    .filter((c) => c.state.phase === 'new')
    .sort((a, b) => a.position - b.position || compareIds(a.id, b.id));
  for (const card of fresh) {
    if (newLeft <= 0) break;
    if (takeOnePerNote(card)) {
      queue.push(card.id);
      newLeft -= 1;
    }
  }

  return queue;
}

// --- Conversion to and from ts-fsrs. Exported for the round-trip tests only. ---

const PHASES: readonly CardPhase[] = ['new', 'learning', 'review', 'relearning']; // index = State

/** @internal Our plain state as a ts-fsrs Card. */
export function toFsrsCard(state: SchedulingState): FsrsCard {
  const phase = PHASES.indexOf(state.phase);
  if (phase < 0) throw new RangeError(`scheduler: unknown phase "${String(state.phase)}"`);
  return {
    due: parseIso(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    scheduled_days: state.scheduledDays,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: phase as State,
    last_review: state.lastReview === null ? undefined : parseIso(state.lastReview),
  };
}

/** @internal A ts-fsrs Card as our plain state. */
export function fromFsrsCard(card: FsrsCard): SchedulingState {
  const phase = PHASES[card.state];
  if (phase === undefined) throw new RangeError(`scheduler: unknown ts-fsrs state ${card.state}`);
  return {
    phase,
    due: iso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ? iso(card.last_review) : null,
  };
}

// --- Helpers ---

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR_DAYS = 365;
const MONTH_DAYS = YEAR_DAYS / 12;

/**
 * "10m", "5h", "3d", "2.5mo", "1.2y". The unit is chosen after rounding, so 59.7 minutes reads
 * "1h", never "60m". Months and years show at most one decimal ("2mo", not "2.0mo").
 * @internal Exported for tests.
 */
export function intervalLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days}d`;
  const months = oneDecimal(days / MONTH_DAYS);
  if (months < 12) return `${months}mo`;
  return `${oneDecimal(days / YEAR_DAYS)}y`;
}

function oneDecimal(x: number): number {
  return Math.round(x * 10) / 10;
}

function isLearning(phase: CardPhase): boolean {
  return phase === 'learning' || phase === 'relearning';
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function iso(date: Date): string {
  return checkDate(date).toISOString();
}

function parseIso(value: string): Date {
  return checkDate(new Date(value));
}

function checkDate(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw new RangeError('scheduler: invalid date');
  return date;
}

function checkRating(rating: number): void {
  if (!RATINGS.includes(rating as Rating)) {
    throw new RangeError(`scheduler: rating must be 1-4, got ${rating}`);
  }
}
