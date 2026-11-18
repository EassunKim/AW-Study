import { describe, expect, it } from 'vitest';
import { CryptoError, type Keyring, type KeyringEntry } from '../types/crypto';
import {
  confirmsGroup,
  hasPassphrase,
  passkeyEntries,
  PASSPHRASE_MIN,
  passphraseProblem,
  passphraseStrength,
  recoveryGroups,
  recoveryKeyFile,
  unlockMessage,
} from './keys';

const KEY = '7K2M-QX9D-A1B0-ZZ34-HJKM-NPQR-STVW-XY56';

describe('passphraseStrength', () => {
  it.each([
    ['', 'too-short'],
    ['short', 'too-short'],
    ['a'.repeat(PASSPHRASE_MIN - 1), 'too-short'],
    ['aaaaaaaaaaaa', 'weak'], // long enough, but one letter
    ['abababababab', 'weak'],
    ['letmeinplease', 'weak'], // one word, lower case
    ['Tr0ub4dor&3x', 'fair'], // short but mixed
    ['correcthorsebat', 'fair'], // 14+ characters
    ['paper lantern river cobalt', 'strong'], // four words
    ['a really quite long passphrase', 'strong'],
  ] as const)('%j is %s', (text, strength) => {
    expect(passphraseStrength(text)).toBe(strength);
  });

  it('counts characters, not UTF-16 units', () => {
    // 10 emoji are 10 characters (20 UTF-16 units): long enough
    expect(passphraseStrength('🙂🙃😀😁😂🤣😃😄😅😆')).not.toBe('too-short');
    expect(passphraseStrength('🙂🙃😀😁😂')).toBe('too-short');
  });
});

describe('passphraseProblem', () => {
  it('refuses a short passphrase, then a mismatch, then accepts', () => {
    expect(passphraseProblem('short', 'short')).toMatch(/at least/);
    expect(passphraseProblem('paper lantern river', 'paper lantern rivet')).toMatch(/don’t match/);
    expect(passphraseProblem('paper lantern river', 'paper lantern river')).toBeNull();
  });

  it('matches the same words typed with different Unicode forms (as on iPhone and Windows)', () => {
    const composed = 'café crème brûlée';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(passphraseProblem(composed, decomposed)).toBeNull();
  });
});

describe('confirmsGroup', () => {
  it('splits the key into its eight groups', () => {
    expect(recoveryGroups(KEY)).toHaveLength(8);
  });

  it('accepts the asked group, forgivingly', () => {
    expect(confirmsGroup(KEY, 2, 'QX9D')).toBe(true);
    expect(confirmsGroup(KEY, 2, 'qx9d')).toBe(true);
    expect(confirmsGroup(KEY, 2, ' Q X-9 D ')).toBe(true);
    expect(confirmsGroup(KEY, 3, 'albo')).toBe(true); // l and o read as 1 and 0, as A1B0
    expect(confirmsGroup(KEY, 3, 'AIB0')).toBe(true); // I reads as 1
  });

  it('refuses another group, a typo, or a group that does not exist', () => {
    expect(confirmsGroup(KEY, 2, '7K2M')).toBe(false);
    expect(confirmsGroup(KEY, 2, 'QX9E')).toBe(false);
    expect(confirmsGroup(KEY, 2, 'QX9')).toBe(false);
    expect(confirmsGroup(KEY, 9, '')).toBe(false);
    expect(confirmsGroup(KEY, 0, '7K2M')).toBe(false);
  });
});

describe('recoveryKeyFile', () => {
  it('holds the key, the date and the warning', () => {
    const text = recoveryKeyFile('Honed', KEY, new Date('2026-11-18T09:00:00Z'));
    expect(text).toContain(KEY);
    expect(text).toContain('2026-11-18');
    expect(text).toMatch(/nobody can get your cards back/);
  });
});

describe('keyring helpers', () => {
  const base = { createdAt: '2026-11-18T09:00:00.000Z', wrap: 'AES-KW', wrapped: new Uint8Array(40) } as const;
  const hkdf = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: 'x' } as const;
  const passkey: KeyringEntry = {
    ...base,
    id: 'pk',
    method: 'passkey',
    kdf: hkdf,
    credentialId: new Uint8Array([1]),
    prfSalt: new Uint8Array(32),
    label: 'iPhone',
  };
  const recovery: KeyringEntry = { ...base, id: 'rk', method: 'recovery', kdf: hkdf };
  const passphrase: KeyringEntry = {
    ...base,
    id: 'pp',
    method: 'passphrase',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1, salt: new Uint8Array(16) },
  };

  it('finds passkeys and the passphrase', () => {
    const keyring: Keyring = { v: 1, entries: [passkey, recovery] };
    expect(passkeyEntries(keyring).map((e) => e.id)).toEqual(['pk']);
    expect(hasPassphrase(keyring)).toBe(false);
    expect(hasPassphrase({ v: 1, entries: [passphrase, recovery] })).toBe(true);
    expect(passkeyEntries(null)).toEqual([]);
  });
});

describe('unlockMessage', () => {
  it('turns each crypto error into words for that method', () => {
    const wrong = new CryptoError('wrong-secret', 'no');
    expect(unlockMessage(wrong, 'passphrase')).toMatch(/passphrase doesn’t unlock/);
    expect(unlockMessage(wrong, 'recovery')).toMatch(/recovery key doesn’t unlock/);
    expect(unlockMessage(wrong, 'passkey')).toMatch(/passkey isn’t one/);
    expect(unlockMessage(new CryptoError('invalid', 'x'), 'recovery')).toMatch(/typo/);
    expect(unlockMessage(new CryptoError('unsupported', 'x'), 'passkey')).toMatch(/can’t be used/);
    expect(unlockMessage(new CryptoError('corrupt', 'x'), 'passphrase')).toMatch(/damaged/);
  });

  it('explains a cancelled passkey prompt, and passes other errors through', () => {
    expect(unlockMessage(new DOMException('no', 'NotAllowedError'), 'passkey')).toMatch(/cancelled/);
    expect(unlockMessage(new Error('disk full'), 'passphrase')).toBe('disk full');
  });
});
