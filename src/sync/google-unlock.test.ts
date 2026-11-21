// Google unlock (#101): the keyring entry (crypto), the keyring rule (store), and the client's calls.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newRecoveryKey, unlock, wrapWithGoogleKey, wrapWithRecoveryKey } from '../lib/crypto';
import { openStudyStore } from '../db/store';
import { newDataKey, testKeyring } from '../db/test-helpers';
import { CryptoError, type Keyring } from '../types/crypto';
import { fetchGoogleKey, GoogleUnlockError, turnOnGoogleUnlock } from './client';

const random32 = () => crypto.getRandomValues(new Uint8Array(32));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('the google keyring entry', () => {
  it('opens with the account’s key, and not with another', async () => {
    const dataKey = await newDataKey();
    const googleKey = random32();
    const entry = await wrapWithGoogleKey(dataKey, googleKey, 'nathan@example.com');
    expect(entry).toMatchObject({ method: 'google', email: 'nathan@example.com', kdf: { name: 'HKDF', info: 'honed:v1:google' } });
    const keyring: Keyring = { v: 1, entries: [entry] };
    const opened = await unlock(keyring, { method: 'google', googleKey }, { extractable: true });
    expect(new Uint8Array(await crypto.subtle.exportKey('raw', opened))).toEqual(new Uint8Array(await crypto.subtle.exportKey('raw', dataKey)));
    await expect(unlock(keyring, { method: 'google', googleKey: random32() })).rejects.toMatchObject({ code: 'wrong-secret' });
    await expect(wrapWithGoogleKey(dataKey, new Uint8Array(31), 'x')).rejects.toBeInstanceOf(CryptoError);
  });

  it('counts as a way to unlock, but the recovery key stays required', async () => {
    const dataKey = await newDataKey();
    const google = await wrapWithGoogleKey(dataKey, random32(), 'nathan@example.com');
    const recovery = await wrapWithRecoveryKey(dataKey, await newRecoveryKey());
    const fine = await openStudyStore({ name: 'google-unlock-1' });
    await fine.setUp({ v: 1, entries: [google, recovery] }, dataKey);
    expect(fine.status()).toBe('unlocked');
    fine.close();
    const missing = await openStudyStore({ name: 'google-unlock-2' });
    await expect(missing.setUp({ v: 1, entries: [google] }, dataKey)).rejects.toMatchObject({ code: 'invalid' });
    missing.close();
    // And with a passphrase too, the passphrase can go once Google is there (and Google can go with the passphrase back)
    const both = await openStudyStore({ name: 'google-unlock-3' });
    const ring = await testKeyring(dataKey);
    await both.setUp(ring, dataKey);
    await both.addKeyringEntry(google);
    await both.removeKeyringEntry(ring.entries.find((e) => e.method === 'passphrase')!.id);
    await expect(both.removeKeyringEntry(google.id)).rejects.toMatchObject({ code: 'invalid' }); // only the recovery key would be left
    both.close();
  });
});

describe('the client', () => {
  it('reads the key, and says why it couldn’t', async () => {
    const key = random32();
    expect(await fetchGoogleKey(reply(200, { key: b64url(key) }))).toEqual(key);
    expect(await turnOnGoogleUnlock(reply(200, { key: b64url(key) }))).toEqual(key);
    await expect(fetchGoogleKey(reply(403, { needsSignIn: true }))).rejects.toMatchObject({ code: 'needs-sign-in' });
    await expect(fetchGoogleKey(reply(401, {}))).rejects.toMatchObject({ code: 'needs-sign-in' });
    await expect(fetchGoogleKey(reply(404, { off: true }))).rejects.toMatchObject({ code: 'off' });
    await expect(fetchGoogleKey(reply(200, { key: 'short' }))).rejects.toBeInstanceOf(GoogleUnlockError);
    await expect(turnOnGoogleUnlock(reply(401, {}))).rejects.toMatchObject({ code: 'needs-sign-in' });
  });
});
