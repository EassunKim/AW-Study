// The encryption core, against Node's WebCrypto (the same API browsers have). Most tests use a
// low PBKDF2 iteration count to stay fast; one checks the real default.
import { describe, expect, it } from 'vitest';
import { CryptoError, type Keyring, type KeyringEntry } from '../types/crypto';
import {
  decryptBytes,
  decryptRecord,
  encryptBytes,
  encryptRecord,
  isRecoveryKey,
  newDataKey,
  newRecoveryKey,
  PBKDF2_ITERATIONS,
  recordAad,
  unlock,
  wrapWithPasskey,
  wrapWithPassphrase,
  wrapWithRecoveryKey,
} from './crypto';

const FAST = { iterations: 1_000 };
const keyring = (...entries: KeyringEntry[]): Keyring => ({ v: 1, entries });
const prfOutput = (seed: number) => new Uint8Array(32).fill(seed);
const credential = (seed: number) => new Uint8Array(16).fill(seed);

/** True when `key` decrypts what `original` encrypted: the same data key. */
async function sameKey(original: CryptoKey, key: CryptoKey) {
  const sealed = await encryptRecord(original, 'test', { check: 'ok' });
  return (await decryptRecord<{ check: string }>(key, 'test', sealed)).check === 'ok';
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no error';
  } catch (err) {
    return err instanceof CryptoError ? err.code : `not a CryptoError: ${String(err)}`;
  }
}

describe('records', () => {
  it('round-trip any JSON value, including non-English text', async () => {
    const key = await newDataKey();
    const value = { front: 'Was ist ATP? 能量 🔋', back: 'Energie', n: 3, list: [1, null] };
    const sealed = await encryptRecord(key, recordAad('notes', 'n1'), value);
    expect(sealed.v).toBe(1);
    expect(sealed.iv).toHaveLength(12);
    expect(await decryptRecord(key, recordAad('notes', 'n1'), sealed)).toEqual(value);
  });

  it('never contain the plaintext', async () => {
    const key = await newDataKey();
    const sealed = await encryptRecord(key, 'x', { front: 'MARKER-PLAINTEXT-123' });
    expect(new TextDecoder().decode(sealed.ct)).not.toContain('MARKER');
  });

  it('fail if a single bit is flipped', async () => {
    const key = await newDataKey();
    const sealed = await encryptRecord(key, 'x', { a: 1 });
    const ct = new Uint8Array(sealed.ct);
    ct[0] = ct[0]! ^ 1;
    expect(await codeOf(decryptRecord(key, 'x', { ...sealed, ct }))).toBe('corrupt');
  });

  it('fail when moved to another record’s place (other additional data)', async () => {
    const key = await newDataKey();
    const sealed = await encryptRecord(key, recordAad('cards', 'c1'), { a: 1 });
    expect(await codeOf(decryptRecord(key, recordAad('cards', 'c2'), sealed))).toBe('corrupt');
    expect(await codeOf(decryptRecord(key, recordAad('notes', 'c1'), sealed))).toBe('corrupt');
  });

  it('fail with another key, an unknown version or a bad IV', async () => {
    const sealed = await encryptRecord(await newDataKey(), 'x', { a: 1 });
    expect(await codeOf(decryptRecord(await newDataKey(), 'x', sealed))).toBe('corrupt');
    const key = await newDataKey();
    const mine = await encryptRecord(key, 'x', { a: 1 });
    expect(await codeOf(decryptRecord(key, 'x', { ...mine, v: 2 as 1 }))).toBe('corrupt');
    expect(await codeOf(decryptRecord(key, 'x', { ...mine, iv: new Uint8Array(8) }))).toBe('corrupt');
  });

  it('use a fresh IV every time', async () => {
    const key = await newDataKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 1000; i++) ivs.add((await encryptRecord(key, 'x', i)).iv.join(','));
    expect(ivs.size).toBe(1000);
  });

  it('refuse values JSON can’t hold', async () => {
    expect(await codeOf(encryptRecord(await newDataKey(), 'x', undefined))).toBe('invalid');
  });

  it('bind records to their store and id', () => {
    expect(recordAad('cards', 'abc')).toBe('honed:v1:cards:abc');
  });
});

describe('bytes (PDFs)', () => {
  it('round-trip exactly, at the size of the input plus the tag, with no JSON blow-up', async () => {
    const key = await newDataKey();
    const data = crypto.getRandomValues(new Uint8Array(65_536));
    const sealed = await encryptBytes(key, recordAad('deckFiles', 'd1'), data);
    expect(sealed.ct.length).toBe(data.length + 16); // AES-GCM adds a 16-byte tag, nothing more
    expect(await decryptBytes(key, recordAad('deckFiles', 'd1'), sealed)).toEqual(data);
  });

  it('fail when changed, moved, or opened with another key', async () => {
    const key = await newDataKey();
    const sealed = await encryptBytes(key, 'a', new Uint8Array([1, 2, 3]));
    const ct = new Uint8Array(sealed.ct);
    ct[1] = ct[1]! ^ 1;
    expect(await codeOf(decryptBytes(key, 'a', { ...sealed, ct }))).toBe('corrupt');
    expect(await codeOf(decryptBytes(key, 'b', sealed))).toBe('corrupt');
    expect(await codeOf(decryptBytes(await newDataKey(), 'a', sealed))).toBe('corrupt');
  });

  it('never contain the plaintext', async () => {
    const sealed = await encryptBytes(await newDataKey(), 'x', new TextEncoder().encode('%PDF-1.7 MARKER-IN-A-PDF'));
    expect(new TextDecoder().decode(sealed.ct)).not.toContain('MARKER');
  });
});

describe('passphrase', () => {
  it('unlocks the same data key, non-extractable by default', async () => {
    const key = await newDataKey();
    const ring = keyring(await wrapWithPassphrase(key, 'correct horse battery staple', FAST));
    const unlocked = await unlock(ring, { method: 'passphrase', passphrase: 'correct horse battery staple' });
    expect(await sameKey(key, unlocked)).toBe(true);
    expect(unlocked.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', unlocked)).rejects.toThrow();
  });

  it('refuses a wrong or empty passphrase', async () => {
    const ring = keyring(await wrapWithPassphrase(await newDataKey(), 'right', FAST));
    expect(await codeOf(unlock(ring, { method: 'passphrase', passphrase: 'wrong' }))).toBe('wrong-secret');
    expect(await codeOf(unlock(ring, { method: 'passphrase', passphrase: '' }))).toBe('invalid');
    expect(await codeOf(wrapWithPassphrase(await newDataKey(), '', FAST))).toBe('invalid');
  });

  it('matches the same words typed with composed or decomposed accents (NFC)', async () => {
    const key = await newDataKey();
    const ring = keyring(await wrapWithPassphrase(key, 'café crème', FAST)); // é, è as one character
    const unlocked = await unlock(ring, { method: 'passphrase', passphrase: 'café crème' }); // letter + accent
    expect(await sameKey(key, unlocked)).toBe(true);
  });

  it('records its parameters, with 600,000 iterations and a random salt by default', async () => {
    const key = await newDataKey();
    const a = await wrapWithPassphrase(key, 'p');
    const b = await wrapWithPassphrase(key, 'p', FAST);
    expect(a.method).toBe('passphrase');
    if (a.method !== 'passphrase' || b.method !== 'passphrase') throw new Error('unreachable');
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    expect(a.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000 });
    expect(a.kdf.salt).toHaveLength(16);
    expect(a.kdf.salt.join()).not.toBe(b.kdf.salt.join());
    expect(a.wrap).toBe('AES-KW');
  });

  it('can unlock an extractable key, which can be wrapped again (for Settings)', async () => {
    const key = await newDataKey();
    const ring = keyring(await wrapWithPassphrase(key, 'old', FAST));
    const extractable = await unlock(ring, { method: 'passphrase', passphrase: 'old' }, { extractable: true });
    const rewrapped = keyring(await wrapWithPassphrase(extractable, 'new', FAST));
    expect(await sameKey(key, await unlock(rewrapped, { method: 'passphrase', passphrase: 'new' }))).toBe(true);
  });

  it('won’t wrap a non-extractable key', async () => {
    const ring = keyring(await wrapWithPassphrase(await newDataKey(), 'p', FAST));
    const locked = await unlock(ring, { method: 'passphrase', passphrase: 'p' });
    expect(await codeOf(wrapWithPassphrase(locked, 'q', FAST))).toBe('invalid');
  });
});

describe('recovery key', () => {
  it('looks like 8 groups of 4 Crockford base32 characters, and is different every time', async () => {
    const a = await newRecoveryKey();
    const b = await newRecoveryKey();
    expect(a).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(a).not.toBe(b);
    expect(await isRecoveryKey(a)).toBe(true);
  });

  it('forgives case, spaces, missing dashes and I/L/O for 1/1/0', async () => {
    const key = await newRecoveryKey();
    expect(await isRecoveryKey(key.toLowerCase())).toBe(true);
    expect(await isRecoveryKey(key.replace(/-/g, ' '))).toBe(true);
    expect(await isRecoveryKey(key.replace(/-/g, ''))).toBe(true);
    expect(await isRecoveryKey(key.replace(/1/g, 'l').replace(/0/g, 'O'))).toBe(true);
  });

  it('catches any single typo, a missing group and junk', async () => {
    const key = await newRecoveryKey();
    const chars = key.replace(/-/g, '');
    for (let i = 0; i < chars.length; i++) {
      const other = chars[i] === 'A' ? 'B' : 'A';
      expect(await isRecoveryKey(chars.slice(0, i) + other + chars.slice(i + 1)), `typo at ${i}`).toBe(false);
    }
    expect(await isRecoveryKey(key.slice(0, -5))).toBe(false);
    expect(await isRecoveryKey('not a key at all')).toBe(false);
    expect(await isRecoveryKey('UUUU-UUUU-UUUU-UUUU-UUUU-UUUU-UUUU-UUUU')).toBe(false);
  });

  it('unlocks the data key; another valid key is wrong, a malformed one invalid', async () => {
    const key = await newDataKey();
    const recovery = await newRecoveryKey();
    const ring = keyring(await wrapWithRecoveryKey(key, recovery));
    expect(await sameKey(key, await unlock(ring, { method: 'recovery', recoveryKey: recovery.toLowerCase() }))).toBe(true);
    expect(await codeOf(unlock(ring, { method: 'recovery', recoveryKey: await newRecoveryKey() }))).toBe('wrong-secret');
    expect(await codeOf(unlock(ring, { method: 'recovery', recoveryKey: 'ABCD' }))).toBe('invalid');
  });
});

describe('passkey', () => {
  it('unlocks with the right passkey and PRF output only', async () => {
    const key = await newDataKey();
    const entry = await wrapWithPasskey(key, { credentialId: credential(1), prfSalt: new Uint8Array(32), prfOutput: prfOutput(7), label: 'iPhone' });
    expect(entry).toMatchObject({ method: 'passkey', label: 'iPhone' });
    const ring = keyring(entry);
    expect(await sameKey(key, await unlock(ring, { method: 'passkey', credentialId: credential(1), prfOutput: prfOutput(7) }))).toBe(true);
    expect(await codeOf(unlock(ring, { method: 'passkey', credentialId: credential(1), prfOutput: prfOutput(8) }))).toBe('wrong-secret');
    expect(await codeOf(unlock(ring, { method: 'passkey', credentialId: credential(2), prfOutput: prfOutput(7) }))).toBe('wrong-secret');
  });

  it('refuses a PRF output that isn’t 32 bytes', async () => {
    const bad = { credentialId: credential(1), prfSalt: new Uint8Array(32), prfOutput: new Uint8Array(16), label: 'x' };
    expect(await codeOf(wrapWithPasskey(await newDataKey(), bad))).toBe('invalid');
  });
});

describe('a keyring with every method', () => {
  it('unlocks the same data key whichever way you use, and only with the method’s own secret', async () => {
    const key = await newDataKey();
    const recovery = await newRecoveryKey();
    const ring = keyring(
      await wrapWithPassphrase(key, 'my passphrase', FAST),
      await wrapWithRecoveryKey(key, recovery),
      await wrapWithPasskey(key, { credentialId: credential(3), prfSalt: new Uint8Array(32), prfOutput: prfOutput(9), label: 'Mac' }),
    );
    expect(await sameKey(key, await unlock(ring, { method: 'passphrase', passphrase: 'my passphrase' }))).toBe(true);
    expect(await sameKey(key, await unlock(ring, { method: 'recovery', recoveryKey: recovery }))).toBe(true);
    expect(await sameKey(key, await unlock(ring, { method: 'passkey', credentialId: credential(3), prfOutput: prfOutput(9) }))).toBe(true);
    // The recovery key typed as a passphrase is just a wrong passphrase
    expect(await codeOf(unlock(ring, { method: 'passphrase', passphrase: recovery }))).toBe('wrong-secret');
  });

  it('a keyring without the method used is wrong-secret; a damaged keyring is corrupt', async () => {
    const ring = keyring(await wrapWithRecoveryKey(await newDataKey(), await newRecoveryKey()));
    expect(await codeOf(unlock(ring, { method: 'passphrase', passphrase: 'x' }))).toBe('wrong-secret');
    expect(await codeOf(unlock({ v: 2 } as unknown as Keyring, { method: 'passphrase', passphrase: 'x' }))).toBe('corrupt');
  });

  it('a damaged wrapped key doesn’t unlock', async () => {
    const entry = await wrapWithPassphrase(await newDataKey(), 'p', FAST);
    const wrapped = new Uint8Array(entry.wrapped);
    wrapped[5] = wrapped[5]! ^ 1;
    expect(await codeOf(unlock(keyring({ ...entry, wrapped }), { method: 'passphrase', passphrase: 'p' }))).toBe('wrong-secret');
  });
});
