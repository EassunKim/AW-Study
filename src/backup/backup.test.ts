// Backups (#18): a round trip through the file, no plaintext in it, and a wrong key or a damaged
// file failing cleanly with this device's data untouched. Uses the real store and crypto.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openHonedDb, RECORD_STORES } from '../db/schema';
import { openStudyStore, StoreError, type StudyStore } from '../db/store';
import { containsText, fakePdf, newDataKey, TEST_PASSPHRASE, testKeyring } from '../db/test-helpers';
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

/** A class with a deck (its PDF and page text holding the tag), a lecture of two sections and an exam. */
async function writeSome(store: StudyStore, tag = MARKER) {
  const course = await store.createCourse({ name: `Class ${tag}`, meetings: [], termStart: null, termEnd: null });
  const deck = await store.addSlideDeck({ courseId: course.id, title: `Deck ${tag}`, fileName: 'w1.pdf', data: fakePdf(tag), pageTexts: [tag, 'two', 'three'] });
  await store.recordLecture({
    courseId: course.id,
    date: '2026-11-16',
    minutes: 50,
    sections: [
      { deckId: deck.id, firstPage: 1, lastPage: 2 },
      { deckId: deck.id, firstPage: 3, lastPage: 3 },
    ],
  });
  await store.addExam({ courseId: course.id, title: `Exam ${tag}`, kind: 'final', date: '2026-12-10', lectureIds: null });
  return course;
}

const classNames = async (store: StudyStore) => (await store.listCourses('2026-11-18')).map((c) => c.name);

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
  it('carries classes, slide decks (with their PDFs), lectures and sections, and names them in its summary', async () => {
    const from = await open();
    await setUp(from);
    const course = await from.createCourse({ name: `Chem ${MARKER}`, meetings: [], termStart: null, termEnd: null });
    const pdf = fakePdf(MARKER, 50_000);
    const pageTexts = ['one', `two ${MARKER}`];
    const deck = await from.addSlideDeck({ courseId: course.id, title: '', fileName: 'Week 1.pdf', data: pdf, pageTexts });
    await from.recordLecture({ courseId: course.id, date: '2026-11-18', minutes: 50, sections: [{ deckId: deck.id, firstPage: 1, lastPage: 2 }] });
    const { text } = await makeBackup(from, T0);
    expect(text).not.toContain(MARKER);

    const to = await open();
    const backup = decodeBackup(text);
    const key = await unlock(backup.snapshot.keyring, passphrase);
    const summary = await openBackup(backup, key); // a PDF is raw bytes: this must not call it damaged
    expect(summary.counts).toEqual({ classes: 1, 'slide decks': 1, lectures: 1, sections: 1 });
    expect(describeCounts(summary.counts)).toBe('1 class, 1 slide deck, 1 lecture, 1 section');
    await restoreBackup(to, backup.snapshot, key);
    expect(await to.getSlideDeckFile(deck.id)).toEqual(pdf);
    expect(await to.getSlideDeckPages(deck.id)).toEqual(pageTexts);
  });

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
    expect(summary.counts).toEqual({ classes: 1, exams: 1, 'slide decks': 1, lectures: 1, sections: 2 });
    await restoreBackup(to, backup.snapshot, key);

    expect(to.status()).toBe('unlocked');
    expect(await raw(toName)).toEqual(await raw(fromName));
    // And it reads back through the store
    expect(await classNames(to)).toEqual([`Class ${MARKER}`]);
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
    expect(await classNames(again)).toEqual([`Class ${MARKER}`]);
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
    await store.createCourse({ name: `Plain ${MARKER}`, meetings: [], termStart: null, termEnd: null });
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
    expect(await classNames(device)).toEqual([`Class ${MARKER}`]);
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
    const section = backup.snapshot.stores.sections![0] as { enc: { ct: Uint8Array } };
    section.enc.ct[5] = section.enc.ct[5]! ^ 1;
    const key = await unlock(backup.snapshot.keyring, passphrase);
    await expect(openBackup(backup, key)).rejects.toMatchObject({ code: 'damaged' });
    expect(await raw(deviceName)).toEqual(before);
  });

  it('a record moved to another record’s place fails to open', async () => {
    const { text } = await twoDevices();
    const backup = decodeBackup(text);
    const [a, b] = backup.snapshot.stores.sections as { id: string }[];
    [a!.id, b!.id] = [b!.id, a!.id];
    const key = await unlock(backup.snapshot.keyring, passphrase);
    await expect(openBackup(backup, key)).rejects.toMatchObject({ code: 'damaged' });
  });

  it('the store refuses plain records in a backup, leaving the device untouched', async () => {
    const { text, device, deviceName, before } = await twoDevices();
    const backup = decodeBackup(text);
    backup.snapshot.stores.courses!.push({ id: 'x', name: `Plain ${MARKER}` });
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
    expect(code(variant((f) => ((f.keycheck as { iv: unknown }).iv = { $bytes: 'AAAAA' })))).toBe('damaged'); // 5 characters can't be whole bytes
  });

  it('round-trips through text unchanged', async () => {
    const store = await open();
    await setUp(store);
    await writeSome(store);
    const backup = { createdAt: T0.toISOString(), snapshot: await store.exportSealed() };
    expect(decodeBackup(encodeBackup(backup))).toEqual(backup);
  });

  it('describes what it holds', () => {
    expect(describeCounts({ classes: 1, 'slide decks': 2, lectures: 3, entries: 3 })).toBe('1 class, 2 slide decks, 3 lectures, 3 entries');
    expect(describeCounts({ questions: 1, quizzes: 1 })).toBe('1 question, 1 quiz');
    expect(describeCounts({ questions: 12, quizzes: 2 })).toBe('12 questions, 2 quizzes');
    expect(describeCounts({})).toBe('nothing yet');
  });
});
