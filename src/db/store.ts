// StudyStore: everything the screens read and write, and the lock side (the `Vault` shape the
// screens use, agreed in issue #16). The only code that touches the database.
//
// Encryption (docs/SECURITY.md, #16):
// - status 'new': no keyring yet. Records are stored plain, exactly as in milestone 2, until setUp,
//   which encrypts everything already there. (Once the setup screen gates the app, this mode isn't
//   used; it keeps old data and old builds working until then.)
// - status 'locked': set up, key not given yet. Everything except status/getKeyring/unlock refuses
//   with StoreError 'locked'.
// - status 'unlocked': every record written is sealed: index fields readable, the rest in `enc`.
//
// How writes work: encryption is async, and an IndexedDB transaction commits as soon as nothing is
// pending, so we never encrypt inside one. Each write reads (one transaction), decrypts, works out
// the change, encrypts, then writes (a second transaction). Writes run one at a time (Web Locks
// across tabs where available, a queue within this one), so nothing slips in between.
//
// FSRS and cloze come in as `deps` (the real ones by default), so tests can use stand-ins. The
// review log is only ever added to (FSRS rule 2). Deleting a card or deck keeps its reviews.
import { checkCloze } from '../lib/cloze';
import { decryptRecord, encryptRecord, recordAad } from '../lib/crypto';
import { buildQueue, newSchedulingState, review } from '../lib/scheduler';
import { studyDay } from '../lib/studyDay';
import type { EncryptedRecord, Keyring, KeyringEntry, UnlockMethod } from '../types/crypto';
import type { Card, Deck, Note, NoteKind, QueueOptions, Rating, ReviewRecord } from '../types/study';
import { openHonedDb, RECORD_STORES, type ChangeRecord, type HonedDb, type RecordStore } from './schema';

export type StoreStatus = 'new' | 'locked' | 'unlocked';

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

  // --- The lock side (the screens' `Vault`, src/ui/vault.ts) ---
  status(): StoreStatus;
  /** Readable while locked (the unlock screen needs the passkey entries). Null before setup. */
  getKeyring(): Promise<Keyring | null>;
  /** Saves the first keyring, encrypts all existing data, and leaves the store unlocked. */
  setUp(keyring: Keyring, dataKey: CryptoKey, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Checks the key against the one saved at setup ('wrong-key' if not), finishes an interrupted setUp. */
  unlock(dataKey: CryptoKey): Promise<void>;
  lock(): void;
  addKeyringEntry(entry: KeyringEntry): Promise<void>;
  removeKeyringEntry(id: string): Promise<void>;
  /** Removes every entry of `method` and adds `entry`, in one go (change passphrase, new recovery key). */
  replaceKeyringEntries(method: UnlockMethod, entry: KeyringEntry): Promise<void>;

  // --- Study data ---
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

export type StoreErrorCode = 'not-found' | 'invalid' | 'locked' | 'wrong-key';

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
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
  /** Records encrypted per write during setUp's migration (smaller in tests). */
  migrationBatch: number;
}

const realDeps: StoreDeps = {
  newSchedulingState,
  review,
  buildQueue,
  checkCloze,
  clock: () => new Date(),
  newId: () => crypto.randomUUID(),
  migrationBatch: 200,
};

export const DECK_NAME_MAX = 100;

/** The fields each store keeps readable when sealed (docs/SECURITY.md, "What stays readable"). */
const READABLE: Record<RecordStore, readonly string[]> = {
  decks: ['id'],
  notes: ['id', 'deckId'],
  cards: ['id', 'noteId', 'deckId', 'suspended', 'position'],
  reviews: ['id', 'cardId', 'reviewedAt'],
  changes: ['seq', 'id', 'at', 'entity', 'entityId', 'op'],
};
const KEYCHECK_AAD = 'honed:v1:meta:keycheck';

type Row = Record<string, unknown>;
const isSealed = (row: unknown): row is Row & { enc: EncryptedRecord } =>
  typeof row === 'object' && row !== null && 'enc' in row;

export async function openStudyStore(options: { name?: string; deps?: Partial<StoreDeps> } = {}): Promise<StudyStore> {
  const deps: StoreDeps = { ...realDeps, ...options.deps };
  const db = await openHonedDb(options.name);
  const device = await loadDeviceId(db, deps);
  const hasKeyring = (await db.get('meta', 'keyring')) !== undefined;
  return makeStore(db, device, deps, hasKeyring);
}

async function loadDeviceId(db: HonedDb, deps: StoreDeps): Promise<string> {
  const tx = db.transaction('meta', 'readwrite');
  const found = await tx.store.get('deviceId');
  if (found) {
    await tx.done;
    return found.value as string;
  }
  const value = deps.newId();
  await tx.store.put({ key: 'deviceId', value });
  await tx.done;
  return value;
}

/** Always a passphrase or passkey (to unlock), and always a recovery key (for when you can't). */
function checkKeyring(entries: KeyringEntry[]) {
  if (!entries.some((e) => e.method === 'passphrase' || e.method === 'passkey')) {
    throw new StoreError('invalid', 'Keep at least one passphrase or passkey, or you couldn’t unlock.');
  }
  if (!entries.some((e) => e.method === 'recovery')) {
    throw new StoreError('invalid', 'Keep a recovery key, or a forgotten passphrase would lose everything.');
  }
}

/** A card's readable facts, sealed or plain (counting needs no decryption). */
function cardFacts(row: unknown) {
  const c = row as Row & { state?: Card['state'] };
  return {
    deckId: String(c.deckId),
    suspended: Boolean(c.suspended),
    position: Number(c.position),
    phase: (c.phase ?? c.state?.phase) as Card['state']['phase'],
    due: String(c.due ?? c.state?.due),
  };
}

function makeStore(db: HonedDb, device: string, deps: StoreDeps, keyringSaved: boolean): StudyStore {
  let key: CryptoKey | null = null;
  let hasKeyring = keyringSaved;
  const iso = () => deps.clock().toISOString();
  const status = (): StoreStatus => (!hasKeyring ? 'new' : key ? 'unlocked' : 'locked');

  const requireOpen = () => {
    if (status() === 'locked') throw new StoreError('locked', 'Unlock first.');
  };

  // --- One write at a time, across tabs where the browser has Web Locks ---
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = (): Promise<T> => {
      const locks = (globalThis.navigator as Navigator | undefined)?.locks;
      return locks ? (locks.request('honed-store', fn) as Promise<T>) : fn();
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  // --- Sealing and opening records ---

  /** The record as stored: sealed when unlocked, plain before setup ('new'). */
  const seal = async (name: RecordStore, plain: Row): Promise<Row> => {
    if (!key) {
      requireOpen();
      return plain;
    }
    const readable: Row = {};
    const secret: Row = {};
    for (const [field, value] of Object.entries(plain)) {
      if (READABLE[name].includes(field)) readable[field] = value;
      else secret[field] = value;
    }
    if (readable.seq === undefined) delete readable.seq; // a new change row: IndexedDB numbers it
    if (name === 'cards') {
      const state = plain.state as Card['state'];
      readable.phase = state.phase;
      readable.due = state.due;
    }
    return { ...readable, enc: await encryptRecord(key, recordAad(name, String(plain.id)), secret) };
  };

  /** The plain record from what's stored. */
  const open = async <T>(name: RecordStore, stored: unknown): Promise<T> => {
    if (!isSealed(stored)) return stored as T; // plain: before setup, or not yet migrated
    if (!key) throw new StoreError('locked', 'Unlock first.');
    const secret = await decryptRecord<Row>(key, recordAad(name, String(stored.id)), stored.enc);
    const readable: Row = {};
    for (const field of READABLE[name]) if (field in stored) readable[field] = stored[field];
    return { ...secret, ...readable } as T;
  };

  const openAll = <T>(name: RecordStore, rows: unknown[]) => Promise.all(rows.map((r) => open<T>(name, r)));

  /** A change-log row, sealed, ready to add in the caller's write transaction. */
  const change = (entity: ChangeRecord['entity'], op: ChangeRecord['op'], entityId: string, data: ChangeRecord['data']) =>
    seal('changes', { id: deps.newId(), deviceId: device, at: iso(), entity, entityId, op, data });

  // --- Validation ---

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
  const nextPosition = (rows: unknown[]) => rows.reduce<number>((max, r) => Math.max(max, cardFacts(r).position + 1), 0);

  // --- Migration: seal every plain record (setUp, and an interrupted setUp finished by unlock) ---

  const migrate = async (onProgress?: (done: number, total: number) => void) => {
    const plain: Partial<Record<RecordStore, Row[]>> = {};
    let total = 0;
    for (const name of RECORD_STORES) {
      const rows = ((await db.getAll(name)) as unknown[]).filter((r) => !isSealed(r)) as Row[];
      plain[name] = rows;
      total += rows.length;
    }
    let done = 0;
    onProgress?.(done, total);
    for (const name of RECORD_STORES) {
      const rows = plain[name]!;
      for (let i = 0; i < rows.length; i += deps.migrationBatch) {
        const sealed = await Promise.all(rows.slice(i, i + deps.migrationBatch).map((r) => seal(name, r)));
        const tx = db.transaction(name, 'readwrite');
        for (const row of sealed) await tx.store.put(row as never);
        await tx.done;
        done += sealed.length;
        onProgress?.(done, total);
      }
    }
    await db.delete('meta', 'migration');
  };

  const keyringChange = (edit: (entries: KeyringEntry[]) => KeyringEntry[]) =>
    exclusive(async () => {
      if (status() !== 'unlocked') throw new StoreError('locked', 'Unlock first.');
      const keyring = (await db.get('meta', 'keyring'))?.value as Keyring;
      const entries = edit(keyring.entries);
      checkKeyring(entries);
      await db.put('meta', { key: 'keyring', value: { v: 1, entries } satisfies Keyring });
    });

  return {
    deviceId: () => device,
    status,

    async getKeyring() {
      return ((await db.get('meta', 'keyring'))?.value as Keyring | undefined) ?? null;
    },

    setUp: (keyring, dataKey, onProgress) =>
      exclusive(async () => {
        if (hasKeyring) throw new StoreError('invalid', 'Already set up.');
        if (keyring?.v !== 1) throw new StoreError('invalid', 'Bad keyring.');
        checkKeyring(keyring.entries);
        const keycheck = await encryptRecord(dataKey, KEYCHECK_AAD, 'ok');
        const tx = db.transaction('meta', 'readwrite');
        await tx.store.put({ key: 'keyring', value: keyring });
        await tx.store.put({ key: 'keycheck', value: keycheck });
        await tx.store.put({ key: 'migration', value: 'running' });
        await tx.done;
        hasKeyring = true;
        key = dataKey;
        await migrate(onProgress);
      }),

    unlock: (dataKey) =>
      exclusive(async () => {
        if (!hasKeyring) throw new StoreError('invalid', 'Not set up yet.');
        const keycheck = (await db.get('meta', 'keycheck'))?.value as EncryptedRecord;
        try {
          await decryptRecord(dataKey, KEYCHECK_AAD, keycheck);
        } catch {
          throw new StoreError('wrong-key', 'That key doesn’t open this device’s data.');
        }
        key = dataKey;
        if ((await db.get('meta', 'migration')) !== undefined) await migrate();
      }),

    lock() {
      key = null;
    },

    addKeyringEntry: (entry) => keyringChange((entries) => [...entries, entry]),

    removeKeyringEntry: (id) =>
      keyringChange((entries) => {
        if (!entries.some((e) => e.id === id)) throw new StoreError('not-found', 'That way of unlocking is already gone.');
        return entries.filter((e) => e.id !== id);
      }),

    replaceKeyringEntries: (method, entry) =>
      keyringChange((entries) => {
        if (entry.method !== method) throw new StoreError('invalid', 'The new entry is a different kind.');
        return [...entries.filter((e) => e.method !== method), entry];
      }),

    async listDecks(now) {
      requireOpen();
      const tx = db.transaction(['decks', 'cards']);
      const [rawDecks, rawCards] = await Promise.all([tx.objectStore('decks').getAll(), tx.objectStore('cards').getAll()]);
      await tx.done;
      const decks = await openAll<Deck>('decks', rawDecks);
      const cards = rawCards.map(cardFacts); // counted from readable fields: no card is decrypted
      const nowIso = now.toISOString();
      return decks
        .map((deck) => {
          const own = cards.filter((c) => c.deckId === deck.id);
          const active = own.filter((c) => !c.suspended);
          return {
            ...deck,
            total: own.length,
            newCount: active.filter((c) => c.phase === 'new').length,
            dueCount: active.filter((c) => c.phase !== 'new' && c.due <= nowIso).length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async getDeck(id) {
      requireOpen();
      const row = await db.get('decks', id);
      return row ? open<Deck>('decks', row) : null;
    },

    createDeck: (name) =>
      exclusive(async () => {
        const clean = deckName(name);
        const now = iso();
        const deck: Deck = { id: deps.newId(), name: clean, createdAt: now, updatedAt: now };
        const [row, log] = await Promise.all([seal('decks', { ...deck }), change('deck', 'put', deck.id, deck)]);
        const tx = db.transaction(['decks', 'changes'], 'readwrite');
        await tx.objectStore('decks').add(row as never);
        await tx.objectStore('changes').add(log as never);
        await tx.done;
        return deck;
      }),

    renameDeck: (id, name) =>
      exclusive(async () => {
        const clean = deckName(name);
        requireOpen();
        const row = await db.get('decks', id);
        if (!row) throw new StoreError('not-found', 'That deck no longer exists.');
        const next: Deck = { ...(await open<Deck>('decks', row)), name: clean, updatedAt: iso() };
        const [sealed, log] = await Promise.all([seal('decks', { ...next }), change('deck', 'put', id, next)]);
        const tx = db.transaction(['decks', 'changes'], 'readwrite');
        await tx.objectStore('decks').put(sealed as never);
        await tx.objectStore('changes').add(log as never);
        await tx.done;
        return next;
      }),

    deleteDeck: (id) =>
      exclusive(async () => {
        requireOpen();
        const read = db.transaction(['decks', 'notes', 'cards']);
        const [deck, noteIds, cardIds] = await Promise.all([
          read.objectStore('decks').get(id),
          read.objectStore('notes').index('byDeck').getAllKeys(id),
          read.objectStore('cards').index('byDeck').getAllKeys(id),
        ]);
        await read.done;
        if (!deck) throw new StoreError('not-found', 'That deck no longer exists.');
        const logs = await Promise.all([
          ...cardIds.map((cardId) => change('card', 'delete', cardId, null)),
          ...noteIds.map((noteId) => change('note', 'delete', noteId, null)),
          change('deck', 'delete', id, null),
        ]);
        const tx = db.transaction(['decks', 'notes', 'cards', 'changes'], 'readwrite');
        for (const cardId of cardIds) await tx.objectStore('cards').delete(cardId);
        for (const noteId of noteIds) await tx.objectStore('notes').delete(noteId);
        await tx.objectStore('decks').delete(id);
        for (const log of logs) await tx.objectStore('changes').add(log as never);
        await tx.done;
      }),

    async listNotes(deckId) {
      requireOpen();
      const tx = db.transaction(['notes', 'cards']);
      const [rawNotes, rawCards] = await Promise.all([
        tx.objectStore('notes').index('byDeck').getAll(deckId),
        tx.objectStore('cards').index('byDeck').getAll(deckId),
      ]);
      await tx.done;
      const [notes, cards] = await Promise.all([openAll<Note>('notes', rawNotes), openAll<Card>('cards', rawCards)]);
      return notes
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map((note) => ({ note, cards: cards.filter((c) => c.noteId === note.id).sort(byOrdinal) }));
    },

    addNote: (input) =>
      exclusive(async () => {
        const ordinals = ordinalsFor(input.kind, input.front, input.back);
        requireOpen();
        const read = db.transaction(['decks', 'cards']);
        const [deck, deckCards] = await Promise.all([
          read.objectStore('decks').get(input.deckId),
          read.objectStore('cards').index('byDeck').getAll(input.deckId),
        ]);
        await read.done;
        if (!deck) throw new StoreError('not-found', 'That deck no longer exists.');
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
        let position = nextPosition(deckCards);
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
        const [noteRow, noteLog, ...rest] = await Promise.all([
          seal('notes', { ...note }),
          change('note', 'put', note.id, note),
          ...cards.flatMap((card) => [seal('cards', { ...card }), change('card', 'put', card.id, card)]),
        ]);
        const tx = db.transaction(['notes', 'cards', 'changes'], 'readwrite');
        await tx.objectStore('notes').add(noteRow as never);
        await tx.objectStore('changes').add(noteLog as never);
        for (let i = 0; i < rest.length; i += 2) {
          await tx.objectStore('cards').add(rest[i] as never);
          await tx.objectStore('changes').add(rest[i + 1] as never);
        }
        await tx.done;
        return { note, cards };
      }),

    updateNote: (id, edit) =>
      exclusive(async () => {
        requireOpen();
        const read = db.transaction(['notes', 'cards']);
        const [noteRow, ownCards] = await Promise.all([
          read.objectStore('notes').get(id),
          read.objectStore('cards').index('byNote').getAll(id),
        ]);
        await read.done;
        if (!noteRow) throw new StoreError('not-found', 'That note no longer exists.');
        const note = await open<Note>('notes', noteRow);
        const ordinals = ordinalsFor(note.kind, edit.front, edit.back);
        const existing = await openAll<Card>('cards', ownCards);
        const deckCards = await db.getAllFromIndex('cards', 'byDeck', note.deckId);
        const now = deps.clock();
        const next: Note = { ...note, front: edit.front, back: edit.back, updatedAt: now.toISOString() };
        const keep = existing.filter((c) => ordinals.includes(c.ordinal));
        const gone = existing.filter((c) => !ordinals.includes(c.ordinal));
        const missing = ordinals.filter((n) => !existing.some((c) => c.ordinal === n));
        let position = nextPosition(deckCards);
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
        const [sealedNote, noteLog, ...rest] = await Promise.all([
          seal('notes', { ...next }),
          change('note', 'put', id, next),
          ...gone.map((card) => change('card', 'delete', card.id, null)),
          ...added.flatMap((card) => [seal('cards', { ...card }), change('card', 'put', card.id, card)]),
        ]);
        const goneLogs = rest.slice(0, gone.length);
        const addedRows = rest.slice(gone.length);
        const tx = db.transaction(['notes', 'cards', 'changes'], 'readwrite');
        await tx.objectStore('notes').put(sealedNote as never);
        await tx.objectStore('changes').add(noteLog as never);
        for (let i = 0; i < gone.length; i++) {
          await tx.objectStore('cards').delete(gone[i]!.id);
          await tx.objectStore('changes').add(goneLogs[i] as never);
        }
        for (let i = 0; i < addedRows.length; i += 2) {
          await tx.objectStore('cards').add(addedRows[i] as never);
          await tx.objectStore('changes').add(addedRows[i + 1] as never);
        }
        await tx.done;
        return { note: next, cards: [...keep, ...added].sort(byOrdinal) };
      }),

    deleteNote: (id) =>
      exclusive(async () => {
        requireOpen();
        const read = db.transaction(['notes', 'cards']);
        const [note, cardIds] = await Promise.all([
          read.objectStore('notes').get(id),
          read.objectStore('cards').index('byNote').getAllKeys(id),
        ]);
        await read.done;
        if (!note) throw new StoreError('not-found', 'That note no longer exists.');
        const logs = await Promise.all([
          ...cardIds.map((cardId) => change('card', 'delete', cardId, null)),
          change('note', 'delete', id, null),
        ]);
        const tx = db.transaction(['notes', 'cards', 'changes'], 'readwrite');
        for (const cardId of cardIds) await tx.objectStore('cards').delete(cardId);
        await tx.objectStore('notes').delete(id);
        for (const log of logs) await tx.objectStore('changes').add(log as never);
        await tx.done;
      }),

    async getCard(id) {
      requireOpen();
      const cardRow = await db.get('cards', id);
      if (!cardRow) return null;
      const card = await open<Card>('cards', cardRow);
      const noteRow = await db.get('notes', card.noteId);
      return noteRow ? { card, note: await open<Note>('notes', noteRow) } : null;
    },

    setSuspended: (cardId, suspended) =>
      exclusive(async () => {
        requireOpen();
        const row = await db.get('cards', cardId);
        if (!row) throw new StoreError('not-found', 'That card no longer exists.');
        const next: Card = { ...(await open<Card>('cards', row)), suspended };
        const [sealed, log] = await Promise.all([seal('cards', { ...next }), change('card', 'put', cardId, next)]);
        const tx = db.transaction(['cards', 'changes'], 'readwrite');
        await tx.objectStore('cards').put(sealed as never);
        await tx.objectStore('changes').add(log as never);
        await tx.done;
        return next;
      }),

    async studyQueue({ deckId, now, timeZone, dayStartHour, newPerDay }) {
      requireOpen();
      // Reviews from the last two days are enough to find today's (a study day is 24 hours long,
      // give or take a clock change); then keep those in today's study day.
      const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      const tx = db.transaction(['cards', 'reviews']);
      const [rawCards, rawRecent] = await Promise.all([
        deckId ? tx.objectStore('cards').index('byDeck').getAll(deckId) : tx.objectStore('cards').getAll(),
        tx.objectStore('reviews').index('byTime').getAll(IDBKeyRange.lowerBound(since)),
      ]);
      await tx.done;
      const inScope = new Set(rawCards.map((c) => c.id));
      // Decrypt only what the queue needs: this scope's cards and their recent reviews
      const [cards, recent] = await Promise.all([
        openAll<Card>('cards', rawCards),
        openAll<ReviewRecord>('reviews', rawRecent.filter((r) => inScope.has(r.cardId))),
      ]);
      const today = studyDay(now, timeZone, dayStartHour);
      const newIntroducedToday = recent.filter(
        (r) => r.phaseBefore === 'new' && studyDay(new Date(r.reviewedAt), timeZone, dayStartHour) === today,
      ).length;
      const options: QueueOptions = { now, timeZone, dayStartHour, newPerDay, newIntroducedToday };
      return deps.buildQueue(
        cards.map(({ id, noteId, position, suspended, state }) => ({ id, noteId, position, suspended, state })),
        options,
      );
    },

    answer: (cardId, rating, durationMs, now) =>
      exclusive(async () => {
        if (![1, 2, 3, 4].includes(rating)) throw new StoreError('invalid', `Unknown rating ${rating}.`);
        requireOpen();
        const row = await db.get('cards', cardId);
        if (!row) throw new StoreError('not-found', 'That card no longer exists.');
        const card = await open<Card>('cards', row);
        if (card.suspended) throw new StoreError('invalid', 'That card is suspended.');
        const outcome = deps.review(card.state, rating, now);
        const record: ReviewRecord = {
          ...outcome.entry,
          id: deps.newId(),
          cardId,
          durationMs: Math.max(0, Math.round(durationMs)),
          deviceId: device,
        };
        const next: Card = { ...card, state: outcome.next };
        const [sealedCard, sealedReview, cardLog, reviewLog] = await Promise.all([
          seal('cards', { ...next }),
          seal('reviews', { ...record }),
          change('card', 'put', cardId, next),
          change('review', 'put', record.id, record),
        ]);
        const tx = db.transaction(['cards', 'reviews', 'changes'], 'readwrite');
        await tx.objectStore('cards').put(sealedCard as never);
        await tx.objectStore('reviews').add(sealedReview as never);
        await tx.objectStore('changes').add(cardLog as never);
        await tx.objectStore('changes').add(reviewLog as never);
        await tx.done;
        return next;
      }),

    async changesSince(seq) {
      requireOpen();
      return openAll<ChangeRecord>('changes', await db.getAll('changes', IDBKeyRange.lowerBound(seq, true)));
    },

    close() {
      key = null;
      db.close();
    },
  };
}
