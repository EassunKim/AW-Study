// Encryption at rest (#16, docs/SECURITY.md): what's on disk, locking, the keyring rules, and
// migrating milestone 2 data. Uses the real FSRS, cloze and crypto (with few PBKDF2 iterations).
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { newRecoveryKey, wrapWithPasskey, wrapWithPassphrase, wrapWithRecoveryKey } from '../lib/crypto';
import { CryptoError, type Keyring } from '../types/crypto';
import { openHonedDb, RECORD_STORES } from './schema';
import { openStudyStore, StoreError, type StudyStore } from './store';
import { containsText, newDataKey, testKeyring } from './test-helpers';

const MARKER = 'SECRET-MARKER-42';
const T0 = new Date('2026-11-18T18:00:00Z');
let counter = 0;
const opened: StudyStore[] = [];
const freshName = () => `enc-${++counter}`;

async function open(name: string, deps = {}) {
  const store = await openStudyStore({ name, deps });
  opened.push(store);
  return store;
}

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

/** Some of everything, containing MARKER wherever a person can type. */
async function writeEverything(store: StudyStore) {
  const deck = await store.createDeck(`Deck ${MARKER}`);
  const basic = await store.addNote({ deckId: deck.id, kind: 'basic', front: `Q ${MARKER}`, back: `A ${MARKER}` });
  await store.addNote({ deckId: deck.id, kind: 'cloze', front: `{{c1::${MARKER}}} and {{c2::two}}`, back: MARKER });
  await store.answer(basic.cards[0]!.id, 3, 1500, T0);
  return { deck, basic };
}

/** Every row of every store, as stored. */
async function rawRows(name: string) {
  const db = await openHonedDb(name);
  const rows: Record<string, unknown[]> = {};
  for (const store of [...RECORD_STORES, 'meta'] as const) rows[store] = await db.getAll(store);
  db.close();
  return rows;
}

async function setUpNew(name: string) {
  const store = await open(name);
  const key = await newDataKey();
  await store.setUp(await testKeyring(key), key);
  return { store, key };
}

describe('on disk', () => {
  it('nothing a person wrote appears anywhere in the database, in any store', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    await writeEverything(store);
    const rows = await rawRows(name);
    expect(rows.cards!.length).toBeGreaterThan(0);
    for (const [storeName, list] of Object.entries(rows)) {
      expect(containsText(list, MARKER), `plaintext found in ${storeName}`).toBe(false);
    }
  });

  it('keeps readable exactly the fields SECURITY.md lists, and seals the rest', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    await writeEverything(store);
    const rows = await rawRows(name);
    const keys = (store: string) => Object.keys(rows[store]![0] as object).sort();
    expect(keys('decks')).toEqual(['enc', 'id']);
    expect(keys('notes')).toEqual(['deckId', 'enc', 'id']);
    expect(keys('cards')).toEqual(['deckId', 'due', 'enc', 'id', 'noteId', 'phase', 'position', 'suspended']);
    expect(keys('reviews')).toEqual(['cardId', 'enc', 'id', 'reviewedAt']);
    expect(keys('changes')).toEqual(['at', 'enc', 'entity', 'entityId', 'id', 'op', 'seq']);
  });

  it('before setup, records are plain (milestone 2), and setUp seals all of them', async () => {
    const name = freshName();
    const store = await open(name);
    await writeEverything(store);
    expect(containsText((await rawRows(name)).notes, MARKER)).toBe(true); // plain before setup
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    const rows = await rawRows(name);
    for (const s of RECORD_STORES) {
      expect(rows[s]!.every((r) => 'enc' in (r as object)), `unsealed rows left in ${s}`).toBe(true);
      expect(containsText(rows[s], MARKER), `plaintext left in ${s}`).toBe(false);
    }
  });

  it('a record moved into another record’s place won’t decrypt', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    const deck = await store.createDeck('D');
    const a = await store.addNote({ deckId: deck.id, kind: 'basic', front: 'a', back: 'a' });
    const b = await store.addNote({ deckId: deck.id, kind: 'basic', front: 'b', back: 'b' });
    const db = await openHonedDb(name);
    const rowA = (await db.get('cards', a.cards[0]!.id)) as { enc: unknown };
    const rowB = (await db.get('cards', b.cards[0]!.id)) as object;
    await db.put('cards', { ...rowB, enc: rowA.enc } as never); // b's place, a's ciphertext
    db.close();
    await expect(store.getCard(b.cards[0]!.id)).rejects.toBeInstanceOf(CryptoError);
    expect((await store.getCard(a.cards[0]!.id))!.note.front).toBe('a');
  });
});

describe('locking', () => {
  it('is new, then unlocked after setUp, locked when opened again, and unlocked by the right key', async () => {
    const name = freshName();
    const first = await open(name);
    expect(first.status()).toBe('new');
    expect(await first.getKeyring()).toBeNull();
    const key = await newDataKey();
    await first.setUp(await testKeyring(key), key);
    expect(first.status()).toBe('unlocked');
    const { deck } = await writeEverything(first);
    first.close();

    const again = await open(name);
    expect(again.status()).toBe('locked');
    expect((await again.getKeyring())!.entries.map((e) => e.method).sort()).toEqual(['passphrase', 'recovery']);
    await again.unlock(key);
    expect(again.status()).toBe('unlocked');
    expect((await again.getDeck(deck.id))!.name).toBe(`Deck ${MARKER}`);
  });

  it('refuses everything while locked, with code "locked"', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    const { deck, basic } = await writeEverything(store);
    store.lock();
    expect(store.status()).toBe('locked');
    const calls: [string, () => Promise<unknown>][] = [
      ['listDecks', () => store.listDecks(T0)],
      ['getDeck', () => store.getDeck(deck.id)],
      ['createDeck', () => store.createDeck('x')],
      ['renameDeck', () => store.renameDeck(deck.id, 'x')],
      ['deleteDeck', () => store.deleteDeck(deck.id)],
      ['listNotes', () => store.listNotes(deck.id)],
      ['addNote', () => store.addNote({ deckId: deck.id, kind: 'basic', front: 'q', back: 'a' })],
      ['updateNote', () => store.updateNote(basic.note.id, { front: 'q', back: 'a' })],
      ['deleteNote', () => store.deleteNote(basic.note.id)],
      ['getCard', () => store.getCard(basic.cards[0]!.id)],
      ['setSuspended', () => store.setSuspended(basic.cards[0]!.id, true)],
      ['studyQueue', () => store.studyQueue({ now: T0, timeZone: 'UTC', dayStartHour: 4, newPerDay: 20 })],
      ['answer', () => store.answer(basic.cards[0]!.id, 3, 0, T0)],
      ['changesSince', () => store.changesSince(0)],
      ['addKeyringEntry', async () => store.addKeyringEntry((await store.getKeyring())!.entries[0]!)],
    ];
    for (const [label, call] of calls) {
      await expect(call(), label).rejects.toMatchObject({ code: 'locked' });
    }
    expect(await store.getKeyring()).not.toBeNull(); // still readable while locked
  });

  it('refuses a key that isn’t this store’s, and stays locked', async () => {
    const name = freshName();
    const { store } = await setUpNew(name);
    store.lock();
    await expect(store.unlock(await newDataKey())).rejects.toMatchObject({ code: 'wrong-key' });
    expect(store.status()).toBe('locked');
  });

  it('can’t be set up twice, or unlocked before setup', async () => {
    const name = freshName();
    const store = await open(name);
    await expect(store.unlock(await newDataKey())).rejects.toMatchObject({ code: 'invalid' });
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key);
    await expect(store.setUp(await testKeyring(key), key)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('the keyring', () => {
  const passkeyEntry = async (key: CryptoKey) =>
    wrapWithPasskey(key, { credentialId: new Uint8Array([1, 2]), prfSalt: new Uint8Array(32), prfOutput: new Uint8Array(32).fill(5), label: 'iPhone' });

  it('setUp needs a way to unlock and a recovery key', async () => {
    const key = await newDataKey();
    const noRecovery: Keyring = { v: 1, entries: [await wrapWithPassphrase(key, 'p', { iterations: 1000 })] };
    const noUnlock: Keyring = { v: 1, entries: [await wrapWithRecoveryKey(key, await newRecoveryKey())] };
    const store = await open(freshName());
    await expect(store.setUp(noRecovery, key)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.setUp(noUnlock, key)).rejects.toMatchObject({ code: 'invalid' });
    expect(store.status()).toBe('new');
  });

  it('adds and removes entries, but never the last way in or the last recovery key', async () => {
    const { store, key } = await setUpNew(freshName());
    const ring = (await store.getKeyring())!;
    const passphrase = ring.entries.find((e) => e.method === 'passphrase')!;
    const recovery = ring.entries.find((e) => e.method === 'recovery')!;

    await expect(store.removeKeyringEntry(passphrase.id)).rejects.toMatchObject({ code: 'invalid' }); // last way in
    await expect(store.removeKeyringEntry(recovery.id)).rejects.toMatchObject({ code: 'invalid' }); // last recovery
    const passkey = await passkeyEntry(key);
    await store.addKeyringEntry(passkey);
    await store.removeKeyringEntry(passphrase.id); // fine now: the passkey still unlocks
    expect((await store.getKeyring())!.entries.map((e) => e.method).sort()).toEqual(['passkey', 'recovery']);
    await expect(store.removeKeyringEntry(passkey.id)).rejects.toMatchObject({ code: 'invalid' });
    await expect(store.removeKeyringEntry('no-such-id')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('replaces every entry of a method in one go (change passphrase, new recovery key)', async () => {
    const { store, key } = await setUpNew(freshName());
    const newPassphrase = await wrapWithPassphrase(key, 'new one', { iterations: 1000 });
    await store.replaceKeyringEntries('passphrase', newPassphrase);
    const entries = (await store.getKeyring())!.entries;
    expect(entries.filter((e) => e.method === 'passphrase').map((e) => e.id)).toEqual([newPassphrase.id]);
    await expect(store.replaceKeyringEntries('recovery', newPassphrase)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('changing the keyring never rewrites a record', async () => {
    const name = freshName();
    const { store, key } = await setUpNew(name);
    await writeEverything(store);
    const before = await rawRows(name);
    await store.addKeyringEntry(await passkeyEntry(key));
    await store.replaceKeyringEntries('recovery', await wrapWithRecoveryKey(key, await newRecoveryKey()));
    const after = await rawRows(name);
    for (const s of RECORD_STORES) expect(after[s], s).toEqual(before[s]);
  });
});

describe('milestone 2 data', () => {
  it('a version 1 database (milestone 2) opens, keeps working unencrypted, and setUp encrypts it with progress', async () => {
    const name = freshName();
    // Exactly what milestone 2's schema step 1 made, with a plain deck in it
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('decks', { keyPath: 'id' });
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('byDeck', 'deckId');
        cards.createIndex('byNote', 'noteId');
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('byCard', 'cardId');
        reviews.createIndex('byTime', 'reviewedAt');
        db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
      },
    });
    await v1.put('decks', { id: 'old-deck', name: `Old ${MARKER}`, createdAt: T0.toISOString(), updatedAt: T0.toISOString() });
    v1.close();

    const store = await open(name);
    expect(store.status()).toBe('new');
    const deck = (await store.listDecks(T0))[0]!;
    expect(deck.name).toBe(`Old ${MARKER}`);
    await store.addNote({ deckId: deck.id, kind: 'cloze', front: `{{c1::${MARKER}}}`, back: '' });
    const notesBefore = await store.listNotes(deck.id);
    const changesBefore = await store.changesSince(0);

    const progress: [number, number][] = [];
    const key = await newDataKey();
    await store.setUp(await testKeyring(key), key, (done, total) => progress.push([done, total]));
    const total = progress[0]![1];
    expect(total).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual([total, total]);
    expect(progress.map((p) => p[0])).toEqual([...progress.map((p) => p[0])].sort((a, b) => a - b)); // only goes up

    expect(await store.listNotes(deck.id)).toEqual(notesBefore);
    expect(await store.changesSince(0)).toEqual(changesBefore);
    expect(containsText(await rawRows(name), MARKER)).toBe(false);
  });

  it('a setUp interrupted half-way is finished by the next unlock, losing nothing', async () => {
    const name = freshName();
    const store = await open(name, { migrationBatch: 1 });
    const { deck } = await writeEverything(store);
    const notesBefore = await store.listNotes(deck.id);
    const key = await newDataKey();
    let calls = 0;
    const closedHalfWay = store.setUp(await testKeyring(key), key, () => {
      if (++calls === 3) throw new Error('the page was closed');
    });
    await expect(closedHalfWay).rejects.toThrow('the page was closed');
    const rows = await rawRows(name);
    const all = RECORD_STORES.flatMap((s) => rows[s]!);
    expect(all.some((r) => 'enc' in (r as object))).toBe(true); // some sealed...
    expect(all.some((r) => !('enc' in (r as object)))).toBe(true); // ...some not yet
    store.close();

    const again = await open(name);
    expect(again.status()).toBe('locked'); // set up, so it needs the key
    await again.unlock(key);
    expect(await again.listNotes(deck.id)).toEqual(notesBefore);
    const after = await rawRows(name);
    for (const s of RECORD_STORES) expect(after[s]!.every((r) => 'enc' in (r as object)), s).toBe(true);
    expect(after.meta!.some((r) => (r as { key: string }).key === 'migration')).toBe(false);
  });
});

describe('speed', () => {
  it('lists and queues 2,000 encrypted cards (time printed for the PR)', async () => {
    const { store } = await setUpNew(freshName());
    const deck = await store.createDeck('Big');
    for (let i = 0; i < 1_000; i++) {
      await store.addNote({ deckId: deck.id, kind: 'cloze', front: `{{c1::fact ${i}}} and {{c2::detail ${i}}}`, back: '' });
    }
    let start = performance.now();
    const [summary] = await store.listDecks(T0);
    const listMs = performance.now() - start;
    start = performance.now();
    const queue = await store.studyQueue({ deckId: deck.id, now: T0, timeZone: 'UTC', dayStartHour: 4, newPerDay: 20 });
    const queueMs = performance.now() - start;
    expect(summary!.total).toBe(2_000);
    expect(queue).toHaveLength(20);
    console.log(`2,000 encrypted cards: listDecks ${listMs.toFixed(0)} ms, studyQueue ${queueMs.toFixed(0)} ms (Node + fake-indexeddb)`);
  }, 120_000);
});

void StoreError;
