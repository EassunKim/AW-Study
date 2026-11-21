// The sync engine (src/sync/engine.ts, #105) end to end: two devices (two stores) of one account syncing through
// the real sync server (sync/app.mjs) over HTTP, signed in with sessions made here. Nothing reaches Google.
import 'fake-indexeddb/auto';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSync } from '../../sync/app.mjs';
import { openDb } from '../../sync/db.mjs';
import { openStudyStore } from '../../src/db/store';
import { fakePdf, newDataKey, testKeyring } from '../../src/db/test-helpers';
import { wrapWithPassphrase } from '../../src/lib/crypto';
import { fetchAccountKeyring, fetchSealedFile, joinWithKey, startSync, stopSync, syncOnce } from '../../src/sync/engine';

const ORIGIN = 'http://honed.test';
const meeting = [{ day: 1, start: '10:30', minutes: 50 }];
const course = (name) => ({ name, meetings: meeting, termStart: null, termEnd: null });
const TODAY = '2026-11-20';

let db;
let filesDir;
let server;
let base;
let counter = 0;
const stores = [];

beforeEach(async () => {
  db = openDb(':memory:');
  filesDir = mkdtempSync(join(tmpdir(), 'honed-files-'));
  const handle = createSync({ db, google: {}, allowedEmails: ['nathan@example.com', 'matt@example.com'], appOrigin: ORIGIN, filesDir, log: () => {} });
  server = createServer((req, res) => void handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(filesDir, { recursive: true, force: true });
});

/** A signed-in session for `email` (made in the database, as a Google sign-in would), and a fetch that uses it. */
function signedIn(email) {
  const now = new Date().toISOString();
  let account = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
  if (!account) {
    account = { id: `acct-${email}` };
    db.prepare('INSERT INTO accounts (id, google_sub, email, created_at, signed_in_at) VALUES (?, ?, ?, ?, ?)').run(account.id, `sub-${email}`, email, now, now);
  }
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('base64url');
  db.prepare('INSERT INTO sessions (id, hash, account_id, device, created_at, used_at, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    `s-${++counter}`, hash, account.id, 'Test', now, now, now,
  );
  return (path, init = {}) => fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), Cookie: `honed_session=${token}`, Origin: ORIGIN } });
}

/** A device, set up with its own key (or `key`). */
async function device(key) {
  const store = await openStudyStore({ name: `engine-${++counter}` });
  stores.push(store);
  const k = key ?? (await newDataKey());
  await store.setUp(await testKeyring(k), k);
  return { store, key: k };
}

const names = async (store) => (await store.listCourses(TODAY)).map((c) => c.name).sort();

describe('two devices of one account', () => {
  it('the first device sends its state; a second device joins with the key and gets it all; edits go both ways', async () => {
    const pc = await device();
    await pc.store.createCourse(course('Biology'));
    const bio = (await pc.store.listCourses(TODAY))[0];
    await pc.store.addExam({ courseId: bio.id, title: 'Midterm', kind: 'midterm', date: '2026-12-01', lectureIds: null });
    const pcFetch = signedIn('nathan@example.com');
    expect(await startSync(pc.store, 'nathan@example.com', pcFetch)).toEqual({ started: true });
    const account = await fetchAccountKeyring(pcFetch);
    expect(account.version).toBe(1);

    // The phone was set up on its own first (another key): turning sync on there finds a different key
    const phone = await device();
    await phone.store.createCourse(course('Phone only'));
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    expect(found).toMatchObject({ started: false, reason: 'different-key' });
    // It unlocks the account's keyring (here: with the key itself) and joins: its own data is replaced
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);
    expect(await names(phone.store)).toEqual(['Biology']);
    expect(await phone.store.listExams(bio.id)).toHaveLength(1);

    // Edits both ways
    await phone.store.createCourse(course('Chemistry'));
    await syncOnce(phone.store, phoneFetch);
    await syncOnce(pc.store, pcFetch);
    expect(await names(pc.store)).toEqual(['Biology', 'Chemistry']);
    await pc.store.deleteCourse(bio.id);
    await syncOnce(pc.store, pcFetch);
    await syncOnce(phone.store, phoneFetch);
    expect(await names(phone.store)).toEqual(['Chemistry']);
    expect((await phone.store.getSyncState()).lastError).toBeNull();
    // Each round remembers how far it got, so the next asks only for what's new
    const last = db.prepare('SELECT MAX(seq) AS last FROM changes').get().last;
    expect((await phone.store.getSyncState()).pulled).toBe(last);
    let asked = '';
    await syncOnce(phone.store, (path, init) => ((asked += path.startsWith('/api/changes?') ? path : ''), phoneFetch(path, init)));
    expect(asked).toBe(`/api/changes?after=${last}`);
  });

  it('a change to how you unlock on one device reaches the other', async () => {
    const pc = await device();
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch);
    const phone = await device();
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);

    // The PC adds a second passphrase entry (as Settings would, with an extractable key)
    const extractable = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', pc.key), 'AES-GCM', true, ['encrypt', 'decrypt']);
    await pc.store.addKeyringEntry(await wrapWithPassphrase(extractable, 'a second passphrase', { iterations: 1000 }));
    await syncOnce(pc.store, pcFetch);
    expect((await fetchAccountKeyring(pcFetch)).version).toBe(2);
    await syncOnce(phone.store, phoneFetch);
    expect((await phone.store.getKeyring()).entries).toHaveLength(3);
  });

  it('turning sync off and on again with the same key joins straight back, nothing doubled', async () => {
    const pc = await device();
    await pc.store.createCourse(course('Art'));
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch);
    await stopSync(pc.store);
    expect(await pc.store.getSyncState()).toBeNull();
    await pc.store.createCourse(course('Drama'));
    expect(await startSync(pc.store, 'nathan@example.com', pcFetch)).toEqual({ started: true });
    expect(await names(pc.store)).toEqual(['Art', 'Drama']);
    const phone = await device();
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);
    expect(await names(phone.store)).toEqual(['Art', 'Drama']);
  });

  it('another account sees nothing of it', async () => {
    const pc = await device();
    await pc.store.createCourse(course('Private'));
    await startSync(pc.store, 'nathan@example.com', signedIn('nathan@example.com'));
    const matt = await device();
    expect(await startSync(matt.store, 'matt@example.com', signedIn('matt@example.com'))).toEqual({ started: true });
    expect(await names(matt.store)).toEqual([]);
  });

  it('records the problem when the server can’t be reached, and carries on next time', async () => {
    const pc = await device();
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch);
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(syncOnce(pc.store, offline)).rejects.toMatchObject({ code: 'offline' });
    expect((await pc.store.getSyncState()).lastError).toMatch(/offline/);
    await syncOnce(pc.store, pcFetch);
    expect((await pc.store.getSyncState()).lastError).toBeNull();
  });

  it('what the server holds is sealed: no class name in it', async () => {
    const pc = await device();
    await pc.store.createCourse(course('SECRET-CLASS-NAME'));
    await startSync(pc.store, 'nathan@example.com', signedIn('nathan@example.com'));
    const everything = JSON.stringify([db.prepare('SELECT * FROM changes').all(), db.prepare('SELECT * FROM keyrings').all()]);
    expect(everything).not.toContain('SECRET-CLASS-NAME');
    expect(everything).not.toContain(Buffer.from('SECRET-CLASS-NAME').toString('base64url'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM changes').get().n).toBe(1);
  });
});

describe('slide files (#108)', () => {
  it('a deck added on the PC opens on the phone: fetched sealed when opened, the same bytes, never sent back', async () => {
    const pc = await device();
    const bio = await pc.store.createCourse(course('Biology'));
    const pdf = fakePdf('PDF-MARKER-123');
    const deck = await pc.store.addSlideDeck({ courseId: bio.id, title: 'Week 1', fileName: 'w1.pdf', data: pdf, pageTexts: ['page one PAGE-MARKER', 'page two'] });
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch); // its first round sends the deck's files too
    expect(db.prepare('SELECT deck_id, kind FROM files ORDER BY kind').all()).toEqual([
      { deck_id: deck.id, kind: 'pages' },
      { deck_id: deck.id, kind: 'pdf' },
    ]);
    expect(await pc.store.filesToUpload()).toEqual([]);

    const phone = await device();
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);
    // Without a source (as before the runner starts) it says how to get them
    await expect(phone.store.getSlideDeckFile(deck.id)).rejects.toThrow(/Turn on sync/);
    let fetched = 0;
    phone.store.setFileSource((id, kind) => (fetched++, fetchSealedFile(phone.store, id, kind, phoneFetch)));
    expect(await phone.store.getSlideDeckFile(deck.id)).toEqual(pdf);
    expect(await phone.store.getSlideDeckPages(deck.id)).toEqual(['page one PAGE-MARKER', 'page two']);
    // Kept: the second open doesn't fetch again
    await phone.store.getSlideDeckFile(deck.id);
    expect(fetched).toBe(2);
    // Fetched decks aren't sent back up
    expect(await phone.store.filesToUpload()).toEqual([]);

    // What the server keeps is sealed
    const account = db.prepare('SELECT id FROM accounts WHERE email = ?').get('nathan@example.com').id;
    for (const name of readdirSync(join(filesDir, account))) {
      const text = readFileSync(join(filesDir, account, name)).toString('latin1');
      expect(text).not.toContain('PDF-MARKER-123');
      expect(text).not.toContain('PAGE-MARKER');
    }
  });

  it('a deck not uploaded yet says so; a deck deleted on one device leaves the server', async () => {
    const pc = await device();
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch);
    const phone = await device();
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);
    phone.store.setFileSource((id, kind) => fetchSealedFile(phone.store, id, kind, phoneFetch));

    // The PC adds a deck; its records reach the phone before its files (sent without the upload step)
    const art = await pc.store.createCourse(course('Art'));
    const deck = await pc.store.addSlideDeck({ courseId: art.id, title: 'Colour', fileName: 'c.pdf', data: fakePdf('c'), pageTexts: ['c'] });
    const before = (await pc.store.getSyncState()).pushedSeq;
    const own = await pc.store.ownChangesSince(before);
    await pcFetch('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: (await pc.store.sealForSync(own)).map((w) => ({ ...w, iv: Buffer.from(w.sealed.iv).toString('base64url'), ct: Buffer.from(w.sealed.ct).toString('base64url'), sealed: undefined })),
      }),
    });
    await syncOnce(phone.store, phoneFetch);
    await expect(phone.store.getSlideDeckFile(deck.id)).rejects.toThrow(/haven’t reached the server yet/);
    // The PC's next round sends them; now they open
    await syncOnce(pc.store, pcFetch);
    expect(await phone.store.getSlideDeckFile(deck.id)).toBeInstanceOf(Uint8Array);

    // Deleted on the phone: gone from the server too
    await phone.store.deleteSlideDeck(deck.id);
    await syncOnce(phone.store, phoneFetch);
    expect(db.prepare('SELECT COUNT(*) AS n FROM files WHERE deck_id = ?').get(deck.id).n).toBe(0);
  });

  it('a file sealed with another key is refused, not kept', async () => {
    const pc = await device();
    const bio = await pc.store.createCourse(course('Biology'));
    const deck = await pc.store.addSlideDeck({ courseId: bio.id, title: 'W', fileName: 'w.pdf', data: fakePdf('w'), pageTexts: ['w'] });
    const pcFetch = signedIn('nathan@example.com');
    await startSync(pc.store, 'nathan@example.com', pcFetch);
    const phone = await device();
    const phoneFetch = signedIn('nathan@example.com');
    const found = await startSync(phone.store, 'nathan@example.com', phoneFetch);
    await joinWithKey(phone.store, 'nathan@example.com', found.account, pc.key, phoneFetch);
    // Someone swaps the file on the server for one sealed by a stranger's key
    const stranger = await device();
    const other = await stranger.store.addSlideDeck({ courseId: (await stranger.store.createCourse(course('X'))).id, title: 'X', fileName: 'x.pdf', data: fakePdf('x'), pageTexts: ['x'] });
    const swapped = await stranger.store.sealedDeckFiles(other.id);
    phone.store.setFileSource(async () => swapped.pdf);
    await expect(phone.store.getSlideDeckFile(deck.id)).rejects.toThrow(/can’t be opened/);
    phone.store.setFileSource(null);
    await expect(phone.store.getSlideDeckFile(deck.id)).rejects.toThrow(/Turn on sync/); // nothing was kept
  });
});
