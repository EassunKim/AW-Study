// The stand-in vault (until #16). Its rules are the ones #16 must keep, so these tests double as a
// checklist for the real store.
import { describe, expect, it } from 'vitest';
import type { Keyring, KeyringEntry } from '../types/crypto';
import { fakeVault } from './fakeVault';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const base = { createdAt: '2026-11-18T09:00:00.000Z', wrap: 'AES-KW', wrapped: new Uint8Array([9, 8, 7]) } as const;
const hkdf = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: 'x' } as const;
const entry = (id: string, method: 'passphrase' | 'recovery' | 'passkey'): KeyringEntry =>
  method === 'passphrase'
    ? { ...base, id, method, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1, salt: new Uint8Array(16) } }
    : method === 'recovery'
      ? { ...base, id, method, kdf: hkdf }
      : { ...base, id, method, kdf: hkdf, credentialId: new Uint8Array([1, 2]), prfSalt: new Uint8Array(32), label: 'Phone' };
const keyring = (...entries: KeyringEntry[]): Keyring => ({ v: 1, entries });
const KEY = {} as CryptoKey; // the fake never uses it

describe('fakeVault', () => {
  it('goes new → unlocked after setup → locked after a reload', async () => {
    const storage = memoryStorage();
    const vault = fakeVault(storage);
    expect(vault.status()).toBe('new');
    const progress: number[] = [];
    await vault.setUp(keyring(entry('p', 'passphrase'), entry('r', 'recovery')), KEY, (done) => progress.push(done));
    expect(vault.status()).toBe('unlocked');
    expect(progress.at(-1)).toBe(3);
    expect(fakeVault(storage).status()).toBe('locked'); // a new page load starts locked
  });

  it('keeps bytes as bytes through storage', async () => {
    const storage = memoryStorage();
    await fakeVault(storage).setUp(keyring(entry('p', 'passphrase'), entry('r', 'recovery')), KEY);
    const saved = await fakeVault(storage).getKeyring();
    expect(saved?.entries[0]?.wrapped).toEqual(new Uint8Array([9, 8, 7]));
    expect(saved?.entries[0]?.wrapped).toBeInstanceOf(Uint8Array);
  });

  it('refuses to set up twice, and refuses changes while locked', async () => {
    const vault = fakeVault(memoryStorage());
    await vault.setUp(keyring(entry('p', 'passphrase'), entry('r', 'recovery')), KEY);
    await expect(vault.setUp(keyring(entry('q', 'passphrase'), entry('r', 'recovery')), KEY)).rejects.toThrow();
    vault.lock();
    await expect(vault.addKeyringEntry(entry('k', 'passkey'))).rejects.toThrow(/locked/);
  });

  it('replaces every entry of a method with the new one', async () => {
    const vault = fakeVault(memoryStorage());
    await vault.setUp(keyring(entry('p1', 'passphrase'), entry('r', 'recovery')), KEY);
    await vault.replaceKeyringEntries('passphrase', entry('p2', 'passphrase'));
    expect((await vault.getKeyring())?.entries.map((e) => e.id).sort()).toEqual(['p2', 'r']);
  });

  it('never removes the last way in', async () => {
    const vault = fakeVault(memoryStorage());
    await vault.setUp(keyring(entry('k', 'passkey'), entry('r', 'recovery')), KEY);
    await expect(vault.removeKeyringEntry('k')).rejects.toThrow(/passphrase or passkey/);
    await expect(vault.removeKeyringEntry('r')).rejects.toThrow(/recovery key/);
    await vault.addKeyringEntry(entry('p', 'passphrase'));
    await vault.removeKeyringEntry('k');
    expect((await vault.getKeyring())?.entries.map((e) => e.id).sort()).toEqual(['p', 'r']);
  });
});
