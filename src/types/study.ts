// The shared contract for milestone 2. The data layer (src/db/), the scheduler (src/lib/scheduler.ts),
// cloze handling (src/lib/cloze.ts) and the screens (src/ui/) all code against these types, so they
// can be built in parallel by different people. Change a type here only in its own small PR, and say
// so in the task issue: everyone else depends on it.
//
// Everything here is plain JSON (strings, numbers, booleans): no Date objects, no library types.
// Stored rows, sync (v2) and the worker boundary all need that. Times are ISO 8601 strings in UTC
// ("2026-11-18T00:23:27.000Z"); ids are crypto.randomUUID() strings.

/** The four answer buttons. Same numbers as ts-fsrs's Rating enum. */
export type Rating = 1 | 2 | 3 | 4; // 1 Again, 2 Hard, 3 Good, 4 Easy

/** Where a card is in FSRS's life cycle (ts-fsrs's State 0-3, by name). */
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

/**
 * A card's FSRS memory state: our own copy of ts-fsrs's Card fields, so storage never depends on
 * the library's shape. Only src/lib/scheduler.ts converts between the two.
 */
export interface SchedulingState {
  phase: CardPhase;
  due: string; // when the card is next due (ISO, UTC)
  stability: number; // days until recall probability falls to 90%
  difficulty: number; // 1-10
  scheduledDays: number;
  learningSteps: number; // which (re)learning step the card is on
  reps: number;
  lapses: number;
  lastReview: string | null;
}

/**
 * What one answer did, as the scheduler reports it. The data layer adds id, cardId, durationMs and
 * deviceId and appends it to the review log, which is never edited (FSRS rule 2).
 * The *Before fields are the card's state before this answer (ts-fsrs's ReviewLog), which is what
 * FSRS's optimizer needs later.
 */
export interface ReviewEntry {
  rating: Rating;
  reviewedAt: string;
  phaseBefore: CardPhase;
  dueBefore: string;
  stabilityBefore: number;
  difficultyBefore: number;
  scheduledDays: number;
  learningSteps: number;
}

/** A row of the review log as stored. */
export interface ReviewRecord extends ReviewEntry {
  id: string;
  cardId: string;
  durationMs: number; // time from showing the card to answering (used for pacing in milestone 4)
  deviceId: string;
}

/** The scheduler's answer to "the user pressed this button". */
export interface ReviewOutcome {
  next: SchedulingState;
  entry: ReviewEntry;
}

/** What each button would do, shown under the buttons ("10m", "3d", "2mo"). */
export type IntervalPreview = Record<Rating, { due: string; label: string }>;

export interface Deck {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the user writes. A basic note makes one card; a cloze note makes one card per cloze number
 * ({{c1::...}}, {{c2::...}}). Cards made from the same note are "siblings".
 */
export type NoteKind = 'basic' | 'cloze';

export interface Note {
  id: string;
  deckId: string;
  kind: NoteKind;
  front: string; // basic: the question. cloze: the text with {{cN::answer}} or {{cN::answer::hint}}
  back: string; // basic: the answer. cloze: optional extra shown after answering
  createdAt: string;
  updatedAt: string;
}

/** What gets reviewed. */
export interface Card {
  id: string;
  noteId: string;
  deckId: string;
  ordinal: number; // 1 for basic; the cloze number for cloze cards
  position: number; // order new cards are introduced in (lower first)
  suspended: boolean;
  state: SchedulingState;
  createdAt: string;
}

// --- The scheduler (src/lib/scheduler.ts) ---

/** What the queue needs to know about a card. */
export type QueueCard = Pick<Card, 'id' | 'noteId' | 'position' | 'suspended' | 'state'>;

export interface QueueOptions {
  now: Date;
  timeZone: string; // IANA name; the study day comes from studyDay() in src/lib/studyDay.ts
  dayStartHour: number;
  newPerDay: number; // milestone 2: a fixed limit. Milestone 4 replaces it with the time budget.
  newIntroducedToday: number; // new cards already shown this study day
}

// --- Cloze (src/lib/cloze.ts) ---

/** A piece of a rendered cloze card. The UI turns these into elements: never into raw HTML. */
export type ClozeSegment =
  | { kind: 'text'; text: string } // ordinary text
  | { kind: 'blank'; hint: string | null } // the hidden answer, on the front
  | { kind: 'answer'; text: string }; // the revealed answer, on the back

export type ClozeCheck = { ok: true; numbers: number[] } | { ok: false; error: string };
