// Remembering a device (#99, docs/SECURITY.md "Remembering a device"): the crypto (a device key that can't be
// read out, wrapping the data key) and the store (kept in this device's meta only, checked against the
// key, never in a backup, gone after a restore).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptRecord, encryptRecord, recallKey, rememberKey } from '../lib/crypto';
import { CryptoError } from '../types/crypto';
import { openHonedDb } from './schema';
import { openStudyStore, StoreError, type StudyStore } from './store';
import { newDataKey, testKeyring } from './test-helpers';

let counter = 0;
const opened: StudyStore[] = [];
const freshName = () => `remember-${++counter}`;

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
});

async function setUpNew(name = freshName()) {
  const store = await openStudyStore({ name });
  opened.push(store);
  const key = await newDataKey();
  await store.setUp(await testKeyring(key), key);
  return { store, key, name };
}

describe('rememberKey and recallKey', () => {
  it('give back a key that opens what the data key encrypted, and that can’t be read out', async () => {
    const key = await newDataKey();
    const sealed = await encryptRecord(key, 'honed:v1:test:1', { hello: 'world' });
    const remembered = await rememberKey(key);
    expect(remembered.deviceKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', remembered.deviceKey)).rejects.toThrow();
    expect(remembered.wrapped).not.toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

    const recalled = await recallKey(remembered);
    expect(recalled.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', recalled)).rejects.toThrow();
    expect(await decryptRecord(recalled, 'honed:v1:test:1', sealed)).toEqual({ hello: 'world' });
  });

  it('only remembers a key that was just unlocked for it (extractable)', async () => {
    const locked = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await expect(rememberKey(locked)).rejects.toThrow(CryptoError);
  });

  it('refuses a damaged or swapped remembered unlock', async () => {
    const remembered = await rememberKey(await newDataKey());
    const flipped = new Uint8Array(remembered.wrapped);
    flipped[0]! ^= 1;
    await expect(recallKey({ ...remembered, wrapped: flipped })).rejects.toThrow(CryptoError);
    const other = await rememberKey(await newDataKey());
    await expect(recallKey({ ...remembered, deviceKey: other.deviceKey })).rejects.toThrow(CryptoError);
    await expect(recallKey({ ...remembered, iv: new Uint8Array(12) })).rejects.toThrow(CryptoError);
    await expect(recallKey({ ...remembered, v: 2 } as never)).rejects.toThrow(CryptoError);
  });
});

describe('the store', () => {
  it('remembers only while unlocked, only a key that opens this device’s data, and forgets', async () => {
    const { store, key, name } = await setUpNew();
    expect(await store.getRemembered()).toBeNull();

    await expect(store.remember(await rememberKey(await newDataKey()))).rejects.toMatchObject({ code: 'wrong-key' });
    const remembered = await rememberKey(key);
    await store.remember(remembered);

    // Readable while locked (that's how the app opens without asking), and it opens the store
    store.lock();
    const again = await store.getRemembered();
    expect(again).not.toBeNull();
    await store.unlock(await recallKey(again!));
    expect(store.status()).toBe('unlocked');

    // Survives closing and reopening (it's on disk, in this device's meta)
    store.close();
    const reopened = await openStudyStore({ name });
    opened.push(reopened);
    expect(reopened.status()).toBe('locked');
    await reopened.unlock(await recallKey((await reopened.getRemembered())!));

    await reopened.forget();
    expect(await reopened.getRemembered()).toBeNull();
    reopened.lock();
    await expect(reopened.remember(remembered)).rejects.toBeInstanceOf(StoreError); // locked
  });

  it('never puts it in a backup, and a restore forgets it', async () => {
    const { store, key } = await setUpNew();
    await store.remember(await rememberKey(key));
    const snapshot = await store.exportSealed();
    expect(JSON.stringify(Object.keys(snapshot))).not.toContain('remembered');
    expect(Object.keys(snapshot.stores)).not.toContain('meta');
    // Restoring a backup (here: its own) replaces the data and keyring, so the old remembered unlock goes
    await store.replaceFromBackup(snapshot, key);
    expect(await store.getRemembered()).toBeNull();
  });

  it('keeps the remembered unlock out of the keyring', async () => {
    const { store, key, name } = await setUpNew();
    await store.remember(await rememberKey(key));
    const keyring = await store.getKeyring();
    expect(keyring!.entries.map((e) => e.method).sort()).toEqual(['passphrase', 'recovery']);
    const db = await openHonedDb(name);
    const meta = (await db.getAll('meta')).map((row) => (row as { key: string }).key).sort();
    db.close();
    expect(meta).toContain('remembered');
  });
});
