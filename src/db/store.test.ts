// StudyStore against an in-memory IndexedDB (fake-indexeddb), with simple stand-ins for FSRS and
// cloze, so these tests check the store's own rules: validation, transactions, the change log,
// the append-only review log, and what it hands to the scheduler.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClozeCheck, QueueCard, QueueOptions, Rating, ReviewOutcome, SchedulingState } from '../types/study';
import { openHonedDb } from './schema';
import { openStudyStore, StoreError, type StoreDeps, type StudyStore } from './store';

const T0 = new Date('2026-11-18T18:00:00Z'); // 10:00 in Vancouver (UTC-8 in this test's zone)
const ZONE = 'America/Los_Angeles';

/** Deterministic stand-ins: ids count up, the clock is fixed, FSRS and cloze are simple. */
function fakeDeps() {
  let id = 0;
  const queueCalls: { cards: readonly QueueCard[]; options: QueueOptions }[] = [];
  const deps: Partial<StoreDeps> = {
    newId: () => `id-${++id}`,
    clock: () => T0,
    newSchedulingState: (now: Date): SchedulingState => ({
      phase: 'new',
      due: now.toISOString(),
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    }),
    review: (state: SchedulingState, rating: Rating, now: Date): ReviewOutcome => ({
      next: {
        ...state,
        phase: 'review',
        reps: state.reps + 1,
        lastReview: now.toISOString(),
        due: new Date(now.getTime() + rating * 86_400_000).toISOString(),
        stability: rating,
      },
      entry: {
        rating,
        reviewedAt: now.toISOString(),
        phaseBefore: state.phase,
        dueBefore: state.due,
        stabilityBefore: state.stability,
        difficultyBefore: state.difficulty,
        scheduledDays: rating,
        learningSteps: 0,
      },
    }),
    checkCloze: (text: string): ClozeCheck => {
      const numbers = [...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
      return numbers.length ? { ok: true, numbers } : { ok: false, error: 'no cloze' };
    },
    buildQueue: (cards: readonly QueueCard[], options: QueueOptions) => {
      queueCalls.push({ cards, options });
      return cards.filter((c) => !c.suspended).map((c) => c.id);
    },
  };
  return { deps, queueCalls };
}

let name: string;
let store: StudyStore;
let queueCalls: ReturnType<typeof fakeDeps>['queueCalls'];
let counter = 0;

beforeEach(async () => {
  name = `test-${++counter}`; // a fresh database per test
  const fake = fakeDeps();
  queueCalls = fake.queueCalls;
  store = await openStudyStore({ name, deps: fake.deps });
});

afterEach(() => store.close());

const basic = (deckId: string, front = 'Q', back = 'A') => store.addNote({ deckId, kind: 'basic', front, back });

describe('device id', () => {
  it('is made once and kept when the database is opened again', async () => {
    const first = store.deviceId();
    store.close();
    store = await openStudyStore({ name, deps: { newId: () => 'a-different-id' } });
    expect(store.deviceId()).toBe(first);
  });
});

describe('decks', () => {
  it('creates, renames and lists decks by name, trimming names', async () => {
    const b = await store.createDeck('  Biology ');
    await store.createDeck('Anatomy');
    expect(b.name).toBe('Biology');
    await store.renameDeck(b.id, 'Zoology');
    expect((await store.listDecks(T0)).map((d) => d.name)).toEqual(['Anatomy', 'Zoology']);
  });

  it('rejects empty and overlong names, and changes nothing', async () => {
    await expect(store.createDeck('   ')).rejects.toThrow(StoreError);
    await expect(store.createDeck('x'.repeat(101))).rejects.toThrow(/at most 100/);
    expect(await store.listDecks(T0)).toEqual([]);
    expect(await store.changesSince(0)).toEqual([]);
  });

  it('reports missing decks as not-found', async () => {
    await expect(store.renameDeck('nope', 'x')).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.deleteDeck('nope')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('counts new and due cards, leaving out suspended ones', async () => {
    const deck = await store.createDeck('D');
    const a = await basic(deck.id);
    const b = await basic(deck.id);
    const c = await basic(deck.id);
    await store.answer(a.cards[0]!.id, 1, 1000, T0); // due one day later
    await store.setSuspended(c.cards[0]!.id, true);
    const [summary] = await store.listDecks(new Date(T0.getTime() + 2 * 86_400_000));
    expect(summary).toMatchObject({ total: 3, newCount: 1, dueCount: 1 });
    void b;
  });

  it('deleting a deck deletes its notes and cards but keeps their reviews', async () => {
    const deck = await store.createDeck('D');
    const other = await store.createDeck('Other');
    const n = await basic(deck.id);
    const keep = await basic(other.id);
    await store.answer(n.cards[0]!.id, 3, 500, T0);
    await store.deleteDeck(deck.id);
    expect(await store.getDeck(deck.id)).toBeNull();
    expect(await store.listNotes(deck.id)).toEqual([]);
    expect(await store.getCard(n.cards[0]!.id)).toBeNull();
    expect(await store.getCard(keep.cards[0]!.id)).not.toBeNull();
    const db = await openHonedDb(name);
    expect(await db.count('reviews')).toBe(1);
    db.close();
  });
});

describe('notes and cards', () => {
  it('a basic note makes one card in the new state', async () => {
    const deck = await store.createDeck('D');
    const { note, cards } = await basic(deck.id, 'What is ATP?', 'Energy currency');
    expect(note).toMatchObject({ kind: 'basic', front: 'What is ATP?', deckId: deck.id });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ ordinal: 1, noteId: note.id, deckId: deck.id, suspended: false });
    expect(cards[0]!.state.phase).toBe('new');
  });

  it('a cloze note makes one card per number, in order, with consecutive positions', async () => {
    const deck = await store.createDeck('D');
    await basic(deck.id); // position 0
    const { cards } = await store.addNote({ deckId: deck.id, kind: 'cloze', front: '{{c2::b}} {{c1::a}} {{c2::c}}', back: '' });
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2]);
    expect(cards.map((c) => c.position)).toEqual([1, 2]);
  });

  it('rejects invalid notes without writing anything', async () => {
    const deck = await store.createDeck('D');
    const before = (await store.changesSince(0)).length;
    await expect(basic(deck.id, ' ', 'A')).rejects.toMatchObject({ code: 'invalid' });
    await expect(basic(deck.id, 'Q', '')).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.addNote({ deckId: deck.id, kind: 'cloze', front: 'no blanks', back: '' })).rejects.toThrow('no cloze');
    await expect(basic('missing-deck')).rejects.toMatchObject({ code: 'not-found' });
    expect(await store.listNotes(deck.id)).toEqual([]);
    expect((await store.changesSince(0)).length).toBe(before);
  });

  it('editing a cloze note keeps surviving cards (with their FSRS state), drops removed numbers and adds new ones', async () => {
    const deck = await store.createDeck('D');
    const made = await store.addNote({ deckId: deck.id, kind: 'cloze', front: '{{c1::a}} {{c2::b}}', back: '' });
    const [c1, c2] = made.cards;
    const reviewed = await store.answer(c1!.id, 3, 800, T0);
    const edited = await store.updateNote(made.note.id, { front: '{{c1::a!}} {{c3::new}}', back: 'extra' });
    expect(edited.note).toMatchObject({ front: '{{c1::a!}} {{c3::new}}', back: 'extra' });
    expect(edited.cards.map((c) => c.ordinal)).toEqual([1, 3]);
    expect(edited.cards[0]!.id).toBe(c1!.id);
    expect(edited.cards[0]!.state).toEqual(reviewed.state); // a small fix keeps FSRS state (rule 4)
    expect(edited.cards[1]!.state.phase).toBe('new');
    expect(await store.getCard(c2!.id)).toBeNull();
  });

  it('an invalid edit changes nothing', async () => {
    const deck = await store.createDeck('D');
    const made = await basic(deck.id);
    await expect(store.updateNote(made.note.id, { front: '', back: 'A' })).rejects.toMatchObject({ code: 'invalid' });
    expect((await store.listNotes(deck.id))[0]!.note.front).toBe('Q');
  });

  it('deleting a note deletes its cards', async () => {
    const deck = await store.createDeck('D');
    const made = await store.addNote({ deckId: deck.id, kind: 'cloze', front: '{{c1::a}} {{c2::b}}', back: '' });
    await store.deleteNote(made.note.id);
    expect(await store.listNotes(deck.id)).toEqual([]);
    for (const card of made.cards) expect(await store.getCard(card.id)).toBeNull();
    await expect(store.deleteNote(made.note.id)).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('answering', () => {
  it('stores the new state and appends a review with the time taken and the device', async () => {
    const deck = await store.createDeck('D');
    const { cards } = await basic(deck.id);
    const card = await store.answer(cards[0]!.id, 3, 1234.6, T0);
    expect(card.state).toMatchObject({ phase: 'review', reps: 1, lastReview: T0.toISOString() });
    const db = await openHonedDb(name);
    const [review] = await db.getAll('reviews');
    db.close();
    expect(review).toMatchObject({
      cardId: cards[0]!.id,
      rating: 3,
      durationMs: 1235,
      deviceId: store.deviceId(),
      phaseBefore: 'new',
      reviewedAt: T0.toISOString(),
    });
  });

  it('refuses suspended and missing cards, and unknown ratings', async () => {
    const deck = await store.createDeck('D');
    const { cards } = await basic(deck.id);
    await expect(store.answer(cards[0]!.id, 5 as Rating, 0, T0)).rejects.toMatchObject({ code: 'invalid' });
    await store.setSuspended(cards[0]!.id, true);
    await expect(store.answer(cards[0]!.id, 3, 0, T0)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.answer('nope', 3, 0, T0)).rejects.toMatchObject({ code: 'not-found' });
    const db = await openHonedDb(name);
    expect(await db.count('reviews')).toBe(0);
    db.close();
  });
});

describe('study queue', () => {
  it('passes the deck’s cards to the scheduler with how many new cards were introduced today', async () => {
    const deck = await store.createDeck('D');
    const other = await store.createDeck('Other');
    const a = await basic(deck.id);
    const b = await basic(deck.id);
    const elsewhere = await basic(other.id);
    const yesterday = new Date('2026-11-17T18:00:00Z');
    await store.answer(a.cards[0]!.id, 3, 0, yesterday); // a new card, but yesterday
    await store.answer(b.cards[0]!.id, 3, 0, T0); // a new card today: counts
    await store.answer(b.cards[0]!.id, 3, 0, T0); // not new any more: doesn't
    await store.answer(elsewhere.cards[0]!.id, 3, 0, T0); // another deck: doesn't
    const ids = await store.studyQueue({ deckId: deck.id, now: T0, timeZone: ZONE, dayStartHour: 4, newPerDay: 20 });
    const call = queueCalls.at(-1)!;
    expect(call.options).toMatchObject({ newIntroducedToday: 1, newPerDay: 20, timeZone: ZONE, dayStartHour: 4 });
    expect(call.cards.map((c) => c.id).sort()).toEqual([a.cards[0]!.id, b.cards[0]!.id].sort());
    expect(ids).toHaveLength(2);
  });

  it('uses the study day, not the calendar day: 2 a.m. still counts as the evening before', async () => {
    const deck = await store.createDeck('D');
    const a = await basic(deck.id);
    // 22:00 on Nov 17 in Los Angeles (06:00 UTC Nov 18), then the queue at 02:00 local Nov 18
    await store.answer(a.cards[0]!.id, 3, 0, new Date('2026-11-18T06:00:00Z'));
    await store.studyQueue({ deckId: deck.id, now: new Date('2026-11-18T10:00:00Z'), timeZone: ZONE, dayStartHour: 4, newPerDay: 20 });
    expect(queueCalls.at(-1)!.options.newIntroducedToday).toBe(1);
    // After 4 a.m. local, it's a new study day
    await store.studyQueue({ deckId: deck.id, now: new Date('2026-11-18T13:00:00Z'), timeZone: ZONE, dayStartHour: 4, newPerDay: 20 });
    expect(queueCalls.at(-1)!.options.newIntroducedToday).toBe(0);
  });

  it('without a deck, studies every deck', async () => {
    const d1 = await store.createDeck('One');
    const d2 = await store.createDeck('Two');
    await basic(d1.id);
    await basic(d2.id);
    expect(await store.studyQueue({ now: T0, timeZone: ZONE, dayStartHour: 4, newPerDay: 20 })).toHaveLength(2);
  });
});

describe('change log', () => {
  it('records every write in order, with the device, and whole records for puts', async () => {
    const deck = await store.createDeck('D');
    const { note, cards } = await basic(deck.id);
    await store.answer(cards[0]!.id, 3, 0, T0);
    await store.deleteNote(note.id);
    const log = await store.changesSince(0);
    expect(log.map((c) => `${c.entity}:${c.op}`)).toEqual([
      'deck:put',
      'note:put',
      'card:put',
      'card:put',
      'review:put',
      'card:delete',
      'note:delete',
    ]);
    expect(log.every((c) => c.deviceId === store.deviceId())).toBe(true);
    expect(log[0]!.data).toEqual(deck);
    expect(log.at(-1)!.data).toBeNull();
    const after = await store.changesSince(log[4]!.seq!);
    expect(after).toHaveLength(2);
  });
});
