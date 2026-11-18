// StudyStore: everything the screens read and write. The only code that touches the database.
//
// - Each write and its change-log rows happen in one IndexedDB transaction: all or nothing.
//   (Inside a transaction, only await IndexedDB requests: awaiting anything else lets IndexedDB
//   commit early. So all ids, times and FSRS results are worked out before a transaction starts or
//   from data read inside it, with synchronous functions.)
// - FSRS and cloze come in as `deps` (the real ones by default), so tests can use simple stand-ins.
// - The review log is only ever added to (FSRS rule 2). Deleting a card or deck keeps its reviews.
import { checkCloze } from '../lib/cloze';
import { buildQueue, newSchedulingState, review } from '../lib/scheduler';
import { studyDay } from '../lib/studyDay';
import type { Card, Deck, Note, NoteKind, QueueOptions, Rating, ReviewRecord } from '../types/study';
import { openHonedDb, type ChangeRecord, type HonedDb } from './schema';

export interface DeckSummary extends Deck {
  total: number; // cards in the deck
  newCount: number; // never reviewed, not suspended
  dueCount: number; // reviewed before and due by `now`, not suspended
}

export interface NoteWithCards {
  note: Note;
  cards: Card[]; // ordered by ordinal
}

export interface NoteInput {
  deckId: string;
  kind: NoteKind;
  front: string;
  back: string;
}

export interface StudyQueueOptions {
  deckId?: string; // leave out to study every deck
  now: Date;
  timeZone: string;
  dayStartHour: number;
  newPerDay: number;
}

export interface StudyStore {
  deviceId(): string;
  listDecks(now: Date): Promise<DeckSummary[]>;
  getDeck(id: string): Promise<Deck | null>;
  createDeck(name: string): Promise<Deck>;
  renameDeck(id: string, name: string): Promise<Deck>;
  /** Deletes the deck, its notes and its cards. Their reviews stay in the log. */
  deleteDeck(id: string): Promise<void>;
  listNotes(deckId: string): Promise<NoteWithCards[]>;
  addNote(input: NoteInput): Promise<NoteWithCards>;
  /**
   * Changes a note's text. Cards keep their FSRS state (FSRS rule 4: a small fix). For a cloze
   * note, numbers that disappear lose their card and new numbers get a new card.
   */
  updateNote(id: string, edit: { front: string; back: string }): Promise<NoteWithCards>;
  deleteNote(id: string): Promise<void>;
  getCard(id: string): Promise<{ card: Card; note: Note } | null>;
  setSuspended(cardId: string, suspended: boolean): Promise<Card>;
  /** The card ids to study now, in order (see buildQueue in src/lib/scheduler.ts). */
  studyQueue(options: StudyQueueOptions): Promise<string[]>;
  /** Records an answer: the card's new FSRS state and a row in the review log. */
  answer(cardId: string, rating: Rating, durationMs: number, now: Date): Promise<Card>;
  /** Change-log rows after `seq` (0 = all), oldest first. For v2's sync, and for tests. */
  changesSince(seq: number): Promise<ChangeRecord[]>;
  close(): void;
}

export class StoreError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface StoreDeps {
  newSchedulingState: typeof newSchedulingState;
  review: typeof review;
  buildQueue: typeof buildQueue;
  checkCloze: typeof checkCloze;
  /** Now, for createdAt/updatedAt and change-log times. */
  clock: () => Date;
  newId: () => string;
}

const realDeps: StoreDeps = {
  newSchedulingState,
  review,
  buildQueue,
  checkCloze,
  clock: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export const DECK_NAME_MAX = 100;

export async function openStudyStore(options: { name?: string; deps?: Partial<StoreDeps> } = {}): Promise<StudyStore> {
  const deps: StoreDeps = { ...realDeps, ...options.deps };
  const db = await openHonedDb(options.name);
  const device = await loadDeviceId(db, deps);
  return makeStore(db, device, deps);
}

async function loadDeviceId(db: HonedDb, deps: StoreDeps): Promise<string> {
  const tx = db.transaction('meta', 'readwrite');
  const found = await tx.store.get('deviceId');
  if (found) {
    await tx.done;
    return found.value;
  }
  const value = deps.newId();
  await tx.store.put({ key: 'deviceId', value });
  await tx.done;
  return value;
}

function makeStore(db: HonedDb, device: string, deps: StoreDeps): StudyStore {
  const iso = () => deps.clock().toISOString();

  /** A change-log row; written in the caller's transaction. */
  const change = (
    entity: ChangeRecord['entity'],
    op: ChangeRecord['op'],
    entityId: string,
    data: ChangeRecord['data'],
  ): ChangeRecord => ({ id: deps.newId(), deviceId: device, at: iso(), entity, entityId, op, data });

  const deckName = (name: string) => {
    const clean = name.trim();
    if (!clean) throw new StoreError('invalid', 'A deck needs a name.');
    if (clean.length > DECK_NAME_MAX) throw new StoreError('invalid', `Deck names can be at most ${DECK_NAME_MAX} characters.`);
    return clean;
  };

  /** The card numbers a note's text makes: [1] for basic, the cloze numbers for cloze. */
  const ordinalsFor = (kind: NoteKind, front: string, back: string): number[] => {
    if (kind === 'basic') {
      if (!front.trim()) throw new StoreError('invalid', 'The front can’t be empty.');
      if (!back.trim()) throw new StoreError('invalid', 'The back can’t be empty.');
      return [1];
    }
    const check = deps.checkCloze(front);
    if (!check.ok) throw new StoreError('invalid', check.error);
    return check.numbers;
  };

  const byOrdinal = (a: Card, b: Card) => a.ordinal - b.ordinal;

  return {
    deviceId: () => device,

    async listDecks(now) {
      const tx = db.transaction(['decks', 'cards']);
      const [decks, cards] = await Promise.all([tx.objectStore('decks').getAll(), tx.objectStore('cards').getAll()]);
      await tx.done;
      const nowIso = now.toISOString();
      return decks
        .map((deck) => {
          const own = cards.filter((c) => c.deckId === deck.id);
          const active = own.filter((c) => !c.suspended);
          return {
            ...deck,
            total: own.length,
            newCount: active.filter((c) => c.state.phase === 'new').length,
            dueCount: active.filter((c) => c.state.phase !== 'new' && c.state.due <= nowIso).length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getDeck(id) {
      return (await db.get('decks', id)) ?? null;
    },

    async createDeck(name) {
      const now = iso();
      const deck: Deck = { id: deps.newId(), name: deckName(name), createdAt: now, updatedAt: now };
      const tx = db.transaction(['decks', 'changes'], 'readwrite');
      await tx.objectStore('decks').add(deck);
      await tx.objectStore('changes').add(change('deck', 'put', deck.id, deck));
      await tx.done;
      return deck;
    },

    async renameDeck(id, name) {
      const clean = deckName(name);
      const tx = db.transaction(['decks', 'changes'], 'readwrite');
      const deck = await tx.objectStore('decks').get(id);
      if (!deck) {
        throw abort(tx, new StoreError('not-found', 'That deck no longer exists.'));
      }
      const next: Deck = { ...deck, name: clean, updatedAt: iso() };
      await tx.objectStore('decks').put(next);
      await tx.objectStore('changes').add(change('deck', 'put', id, next));
      await tx.done;
      return next;
    },

    async deleteDeck(id) {
      const tx = db.transaction(['decks', 'notes', 'cards', 'changes'], 'readwrite');
      if (!(await tx.objectStore('decks').get(id))) {
        throw abort(tx, new StoreError('not-found', 'That deck no longer exists.'));
      }
      const notes = await tx.objectStore('notes').index('byDeck').getAllKeys(id);
      const cards = await tx.objectStore('cards').index('byDeck').getAllKeys(id);
      for (const cardId of cards) {
        await tx.objectStore('cards').delete(cardId);
        await tx.objectStore('changes').add(change('card', 'delete', cardId, null));
      }
      for (const noteId of notes) {
        await tx.objectStore('notes').delete(noteId);
        await tx.objectStore('changes').add(change('note', 'delete', noteId, null));
      }
      await tx.objectStore('decks').delete(id);
      await tx.objectStore('changes').add(change('deck', 'delete', id, null));
      await tx.done;
    },

    async listNotes(deckId) {
      const tx = db.transaction(['notes', 'cards']);
      const [notes, cards] = await Promise.all([
        tx.objectStore('notes').index('byDeck').getAll(deckId),
        tx.objectStore('cards').index('byDeck').getAll(deckId),
      ]);
      await tx.done;
      return notes
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((note) => ({ note, cards: cards.filter((c) => c.noteId === note.id).sort(byOrdinal) }));
    },

    async addNote(input) {
      const ordinals = ordinalsFor(input.kind, input.front, input.back);
      const now = deps.clock();
      const stamp = now.toISOString();
      const note: Note = {
        id: deps.newId(),
        deckId: input.deckId,
        kind: input.kind,
        front: input.front,
        back: input.back,
        createdAt: stamp,
        updatedAt: stamp,
      };
      const tx = db.transaction(['decks', 'notes', 'cards', 'changes'], 'readwrite');
      if (!(await tx.objectStore('decks').get(input.deckId))) {
        throw abort(tx, new StoreError('not-found', 'That deck no longer exists.'));
      }
      let position = await nextPosition(tx.objectStore('cards').index('byDeck').getAll(input.deckId));
      const cards: Card[] = ordinals.map((ordinal) => ({
        id: deps.newId(),
        noteId: note.id,
        deckId: input.deckId,
        ordinal,
        position: position++,
        suspended: false,
        state: deps.newSchedulingState(now),
        createdAt: stamp,
      }));
      await tx.objectStore('notes').add(note);
      await tx.objectStore('changes').add(change('note', 'put', note.id, note));
      for (const card of cards) {
        await tx.objectStore('cards').add(card);
        await tx.objectStore('changes').add(change('card', 'put', card.id, card));
      }
      await tx.done;
      return { note, cards };
    },

    async updateNote(id, edit) {
      const tx = db.transaction(['notes', 'cards', 'changes'], 'readwrite');
      const note = await tx.objectStore('notes').get(id);
      if (!note) {
        throw abort(tx, new StoreError('not-found', 'That note no longer exists.'));
      }
      let ordinals: number[];
      try {
        ordinals = ordinalsFor(note.kind, edit.front, edit.back);
      } catch (err) {
        throw abort(tx, err as Error);
      }
      const now = deps.clock();
      const next: Note = { ...note, front: edit.front, back: edit.back, updatedAt: now.toISOString() };
      const existing = await tx.objectStore('cards').index('byNote').getAll(id);
      const keep = existing.filter((c) => ordinals.includes(c.ordinal));
      const gone = existing.filter((c) => !ordinals.includes(c.ordinal));
      const missing = ordinals.filter((n) => !existing.some((c) => c.ordinal === n));
      let position = await nextPosition(tx.objectStore('cards').index('byDeck').getAll(note.deckId));
      const added: Card[] = missing.map((ordinal) => ({
        id: deps.newId(),
        noteId: id,
        deckId: note.deckId,
        ordinal,
        position: position++,
        suspended: false,
        state: deps.newSchedulingState(now),
        createdAt: now.toISOString(),
      }));
      await tx.objectStore('notes').put(next);
      await tx.objectStore('changes').add(change('note', 'put', id, next));
      for (const card of gone) {
        await tx.objectStore('cards').delete(card.id);
        await tx.objectStore('changes').add(change('card', 'delete', card.id, null));
      }
      for (const card of added) {
        await tx.objectStore('cards').add(card);
        await tx.objectStore('changes').add(change('card', 'put', card.id, card));
      }
      await tx.done;
      return { note: next, cards: [...keep, ...added].sort(byOrdinal) };
    },

    async deleteNote(id) {
      const tx = db.transaction(['notes', 'cards', 'changes'], 'readwrite');
      if (!(await tx.objectStore('notes').get(id))) {
        throw abort(tx, new StoreError('not-found', 'That note no longer exists.'));
      }
      for (const cardId of await tx.objectStore('cards').index('byNote').getAllKeys(id)) {
        await tx.objectStore('cards').delete(cardId);
        await tx.objectStore('changes').add(change('card', 'delete', cardId, null));
      }
      await tx.objectStore('notes').delete(id);
      await tx.objectStore('changes').add(change('note', 'delete', id, null));
      await tx.done;
    },

    async getCard(id) {
      const tx = db.transaction(['cards', 'notes']);
      const card = await tx.objectStore('cards').get(id);
      const note = card ? await tx.objectStore('notes').get(card.noteId) : undefined;
      await tx.done;
      return card && note ? { card, note } : null;
    },

    async setSuspended(cardId, suspended) {
      const tx = db.transaction(['cards', 'changes'], 'readwrite');
      const card = await tx.objectStore('cards').get(cardId);
      if (!card) {
        throw abort(tx, new StoreError('not-found', 'That card no longer exists.'));
      }
      const next: Card = { ...card, suspended };
      await tx.objectStore('cards').put(next);
      await tx.objectStore('changes').add(change('card', 'put', cardId, next));
      await tx.done;
      return next;
    },

    async studyQueue({ deckId, now, timeZone, dayStartHour, newPerDay }) {
      // Reviews from the last two days are enough to find today's (a study day is 24 hours long,
      // give or take a clock change); then keep those in today's study day.
      const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      const tx = db.transaction(['cards', 'reviews']);
      const [cards, recent] = await Promise.all([
        deckId ? tx.objectStore('cards').index('byDeck').getAll(deckId) : tx.objectStore('cards').getAll(),
        tx.objectStore('reviews').index('byTime').getAll(IDBKeyRange.lowerBound(since)),
      ]);
      await tx.done;
      const today = studyDay(now, timeZone, dayStartHour);
      const inScope = new Set(cards.map((c) => c.id));
      const newIntroducedToday = recent.filter(
        (r) =>
          r.phaseBefore === 'new' &&
          inScope.has(r.cardId) &&
          studyDay(new Date(r.reviewedAt), timeZone, dayStartHour) === today,
      ).length;
      const options: QueueOptions = { now, timeZone, dayStartHour, newPerDay, newIntroducedToday };
      return deps.buildQueue(
        cards.map(({ id, noteId, position, suspended, state }) => ({ id, noteId, position, suspended, state })),
        options,
      );
    },

    async answer(cardId, rating, durationMs, now) {
      if (![1, 2, 3, 4].includes(rating)) throw new StoreError('invalid', `Unknown rating ${rating}.`);
      const tx = db.transaction(['cards', 'reviews', 'changes'], 'readwrite');
      const card = await tx.objectStore('cards').get(cardId);
      if (!card) {
        throw abort(tx, new StoreError('not-found', 'That card no longer exists.'));
      }
      if (card.suspended) {
        throw abort(tx, new StoreError('invalid', 'That card is suspended.'));
      }
      const outcome = deps.review(card.state, rating, now);
      const record: ReviewRecord = {
        ...outcome.entry,
        id: deps.newId(),
        cardId,
        durationMs: Math.max(0, Math.round(durationMs)),
        deviceId: device,
      };
      const next: Card = { ...card, state: outcome.next };
      await tx.objectStore('cards').put(next);
      await tx.objectStore('reviews').add(record);
      await tx.objectStore('changes').add(change('card', 'put', cardId, next));
      await tx.objectStore('changes').add(change('review', 'put', record.id, record));
      await tx.done;
      return next;
    },

    async changesSince(seq) {
      return db.getAll('changes', IDBKeyRange.lowerBound(seq, true));
    },

    close() {
      db.close();
    },
  };
}

/**
 * Cancels a transaction and returns the error to throw. Aborting rejects tx.done, which nobody else
 * waits on: catch it here so it isn't reported as an unhandled rejection.
 */
function abort(tx: { abort(): void; done: Promise<void> }, error: Error): Error {
  tx.done.catch(() => {});
  tx.abort();
  return error;
}

/** The next free new-card position in a deck: one past the highest so far. */
async function nextPosition(cards: Promise<Card[]>): Promise<number> {
  return (await cards).reduce((max, c) => Math.max(max, c.position + 1), 0);
}
