// The sync engine (src/sync/engine.ts, #105) end to end: two devices (two stores) of one account syncing through
// the real sync server (sync/app.mjs) over HTTP, signed in with sessions made here. Nothing reaches Google.
import 'fake-indexeddb/auto';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSync } from '../../sync/app.mjs';
import { openDb } from '../../sync/db.mjs';
import { openStudyStore } from '../../src/db/store';
import { newDataKey, testKeyring } from '../../src/db/test-helpers';
import { wrapWithPassphrase } from '../../src/lib/crypto';
import { fetchAccountKeyring, joinWithKey, startSync, stopSync, syncOnce } from '../../src/sync/engine';

const ORIGIN = 'http://honed.test';
const meeting = [{ day: 1, start: '10:30', minutes: 50 }];
const course = (name) => ({ name, meetings: meeting, termStart: null, termEnd: null });
const TODAY = '2026-11-20';

let db;
let server;
let base;
let counter = 0;
const stores = [];

beforeEach(async () => {
  db = openDb(':memory:');
  const handle = createSync({ db, google: {}, allowedEmails: ['nathan@example.com', 'matt@example.com'], appOrigin: ORIGIN, log: () => {} });
  server = createServer((req, res) => void handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  for (const s of stores.splice(0)) s.close();
  await new Promise((resolve) => server.close(resolve));
  db.close();
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
