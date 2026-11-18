// Backups (#18): a round trip through the file, no plaintext in it, and a wrong key or a damaged
// file failing cleanly with this device's data untouched. Uses the real store and crypto.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openHonedDb, RECORD_STORES } from '../db/schema';
import { openStudyStore, StoreError, type StudyStore } from '../db/store';
import { containsText, newDataKey, TEST_PASSPHRASE, testKeyring } from '../db/test-helpers';
import { unlock } from '../lib/crypto';
import { describeCounts, makeBackup, openBackup, restoreBackup } from './backup';
import { BackupError, decodeBackup, encodeBackup, fromBase64Url, toBase64Url } from './format';

const MARKER = 'BACKUP-MARKER-77';
const T0 = new Date('2026-11-18T18:00:00Z');
let counter = 0;
const opened: StudyStore[] = [];
const freshName = () => `backup-${++counter}`;

async function open(name = freshName()) {
  const store = await openStudyStore({ name });
  opened.push(store);
  return store;
}

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function setUp(store: StudyStore) {
  const key = await newDataKey();
  const keyring = await testKeyring(key);
  await store.setUp(keyring, key);
  return { key, keyring };
}

async function writeSome(store: StudyStore, tag = MARKER) {
  const deck = await store.createDeck(`Deck ${tag}`);
  const note = await store.addNote({ deckId: deck.id, kind: 'basic', front: `Q ${tag}`, back: `A ${tag}` });
  await store.addNote({ deckId: deck.id, kind: 'cloze', front: `{{c1::${tag}}} and {{c2::two}}`, back: tag });
  await store.answer(note.cards[0]!.id, 3, 1500, T0);
  return deck;
}

/** Every row of every store (and the keyring and key check), as stored. */
async function raw(name: string) {
  const db = await openHonedDb(name);
  const rows: Record<string, unknown> = {};
  for (const store of RECORD_STORES) rows[store] = await db.getAll(store);
  rows.keyring = (await db.get('meta', 'keyring'))?.value;
  rows.keycheck = (await db.get('meta', 'keycheck'))?.value;
  db.close();
  return rows;
}

const passphrase = { method: 'passphrase', passphrase: TEST_PASSPHRASE } as const;

describe('making a backup', () => {
  it('round trip: back up, restore on a fresh device, and every record is the same', async () => {
    const fromName = freshName();
    const from = await open(fromName);
    await setUp(from);
    await writeSome(from);
    const { text } = await makeBackup(from, T0);

    const toName = freshName();
    const to = await open(toName);
    expect(to.status()).toBe('new');
    const backup = decodeBackup(text);
    const key = await unlock(backup.snapshot.keyring, passphrase);
    const summary = await openBackup(backup, key);
    expect(summary.counts).toEqual({ decks: 1, notes: 2, cards: 3, reviews: 1 });
    await restoreBackup(to, backup.snapshot, key);

    expect(to.status()).toBe('unlocked');
    expect(await raw(toName)).toEqual(await raw(fromName));
    // And it reads back through the store
    const decks = await to.listDecks(T0);
    expect(decks.map((d) => d.name)).toEqual([`Deck ${MARKER}`]);
    expect(await to.changesSince(0)).toEqual(await from.changesSince(0));
  });

  it('after a restore, the backup’s passphrase unlocks the device', async () => {
    const from = await open();
    await setUp(from);
    await writeSome(from);
    const backup = decodeBackup((await makeBackup(from, T0)).text);
    const toName = freshName();
    const to = await open(toName);
    await restoreBackup(to, backup.snapshot, await unlock(backup.snapshot.keyring, passphrase));
    to.close();

    const again = await open(toName);
    expect(again.status()).toBe('locked');
    await again.unlock(await unlock((await again.getKeyring())!, passphrase));
    expect((await again.listDecks(T0)).length).toBe(1);
  });

  it('holds no plaintext: the marker appears nowhere in the file', async () => {
    const store = await open();
    await setUp(store);
    await writeSome(store);
    const { text } = await makeBackup(store, T0);
    expect(text).not.toContain(MARKER);
    // Bytes are base64url in the file: check them decoded too
    expect(containsText(decodeBackup(text).snapshot, MARKER)).toBe(false);
  });

  it('refuses while locked', async () => {
    const store = await open();
    await setUp(store);
    store.lock();
    await expect(makeBackup(store, T0)).rejects.toMatchObject({ code: 'locked' });
  });

  it('refuses before setup (records would be plain)', async () => {
    const store = await open();
    await store.createDeck(`Plain ${MARKER}`);
    await expect(makeBackup(store, T0)).rejects.toBeInstanceOf(StoreError);
  });

  it('records the newest change it holds', async () => {
    const store = await open();
    await setUp(store);
    expect((await makeBackup(store, T0)).upTo).toBe(0);
    await writeSome(store);
    const { upTo } = await makeBackup(store, T0);
    expect(upTo).toBe(await store.latestChange());
    expect(upTo).toBeGreaterThan(0);
  });
});

describe('restoring safely', () => {
  /** A device with its own data, and a backup from another device. */
  async function twoDevices() {
    const from = await open();
    await setUp(from);
    await writeSome(from);
    const text = (await makeBackup(from, T0)).text;
    const deviceName = freshName();
    const device = await open(deviceName);
    const own = await setUp(device);
    await writeSome(device, 'DEVICE-OWN');
    return { text, device, deviceName, own, before: await raw(deviceName) };
  }

  it('replaces this device’s data with the backup’s', async () => {
    const { text, device } = await twoDevices();
    const backup = decodeBackup(text);
    await restoreBackup(device, backup.snapshot, await unlock(backup.snapshot.keyring, passphrase));
    expect((await device.listDecks(T0)).map((d) => d.name)).toEqual([`Deck ${MARKER}`]);
  });

  it('a wrong key fails and leaves this device untouched', async () => {
    const { text, device, deviceName, own, before } = await twoDevices();
    const backup = decodeBackup(text);
    await expect(openBackup(backup, own.key)).rejects.toMatchObject({ code: 'damaged' });
    await expect(restoreBackup(device, backup.snapshot, own.key)).rejects.toMatchObject({ code: 'wrong-key' });
    expect(await raw(deviceName)).toEqual(before);
    expect(device.status()).toBe('unlocked');
  });

  it('a record changed in the file fails to open, and nothing is restored', async () => {
    const { text, deviceName, before } = await twoDevices();
    const backup = decodeBackup(text);
    const card = backup.snapshot.stores.cards![0] as { enc: { ct: Uint8Array } };
    card.enc.ct[5] = card.enc.ct[5]! ^ 1;
    const key = await unlock(backup.snapshot.keyring, passphrase);
    await expect(openBackup(backup, key)).rejects.toMatchObject({ code: 'damaged' });
    expect(await raw(deviceName)).toEqual(before);
  });

  it('a record moved to another record’s place fails to open', async () => {
    const { text } = await twoDevices();
    const backup = decodeBackup(text);
    const [a, b] = backup.snapshot.stores.cards as { id: string }[];
    [a!.id, b!.id] = [b!.id, a!.id];
    const key = await unlock(backup.snapshot.keyring, passphrase);
    await expect(openBackup(backup, key)).rejects.toMatchObject({ code: 'damaged' });
  });

  it('the store refuses plain records in a backup, leaving the device untouched', async () => {
    const { text, device, deviceName, before } = await twoDevices();
    const backup = decodeBackup(text);
    backup.snapshot.stores.decks!.push({ id: 'x', name: `Plain ${MARKER}` });
    await expect(restoreBackup(device, backup.snapshot, await unlock(backup.snapshot.keyring, passphrase))).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(await raw(deviceName)).toEqual(before);
  });

  it('refuses a backup from a newer schema', async () => {
    const { text, device } = await twoDevices();
    const backup = decodeBackup(text);
    backup.snapshot.schema = 99;
    await expect(restoreBackup(device, backup.snapshot, await unlock(backup.snapshot.keyring, passphrase))).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('refuses while this device is locked', async () => {
    const { text, device } = await twoDevices();
    const backup = decodeBackup(text);
    device.lock();
    await expect(restoreBackup(device, backup.snapshot, await unlock(backup.snapshot.keyring, passphrase))).rejects.toMatchObject({
      code: 'locked',
    });
  });
});

describe('the file format', () => {
  it('bytes survive base64url both ways, at every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe('-_8'); // url-safe alphabet, no padding
  });

  it('rejects files that aren’t backups, or are too new, or damaged', async () => {
    const store = await open();
    await setUp(store);
    const good = JSON.parse((await makeBackup(store, T0)).text);
    const code = (text: string) => {
      try {
        decodeBackup(text);
        return 'ok';
      } catch (err) {
        expect(err).toBeInstanceOf(BackupError);
        return (err as BackupError).code;
      }
    };
    const variant = (change: (f: Record<string, unknown>) => void) => {
      const copy = structuredClone(good);
      change(copy);
      return JSON.stringify(copy);
    };
    expect(code(JSON.stringify(good))).toBe('ok');
    expect(code('not json')).toBe('not-a-backup');
    expect(code('{"format":"something-else"}')).toBe('not-a-backup');
    expect(code(variant((f) => (f.v = 2)))).toBe('too-new');
    expect(code(variant((f) => delete f.keyring))).toBe('damaged');
    expect(code(variant((f) => delete f.keycheck))).toBe('damaged');
    expect(code(variant((f) => (f.createdAt = 'yesterday')))).toBe('damaged');
    expect(code(variant((f) => ((f.stores as Record<string, unknown>).decks = [{ id: 'x', name: 'plain' }])))).toBe('damaged');
    expect(code(variant((f) => ((f.keycheck as { iv: unknown }).iv = { $bytes: '!!' })))).toBe('damaged');
  });

  it('round-trips through text unchanged', async () => {
    const store = await open();
    await setUp(store);
    await writeSome(store);
    const backup = { createdAt: T0.toISOString(), snapshot: await store.exportSealed() };
    expect(decodeBackup(encodeBackup(backup))).toEqual(backup);
  });

  it('describes what it holds', () => {
    expect(describeCounts({ decks: 1, notes: 2, classes: 1, entries: 3 })).toBe('1 deck, 2 notes, 1 class, 3 entries');
    expect(describeCounts({})).toBe('nothing yet');
  });
});
