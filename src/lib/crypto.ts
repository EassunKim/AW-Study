// The encryption core (docs/SECURITY.md): pure WebCrypto functions, no storage, no UI. Node has the
// same WebCrypto, so all of it is tested in Vitest.
//
// STATUS: stub (issue #15; the implementation follows in its second PR). The signatures are the
// contract #16, #17 and #18 build against: keep them.

import type { EncryptedRecord, Keyring, KeyringEntry, UnlockSecret } from '../types/crypto';

/** PBKDF2-HMAC-SHA-256 iterations for new passphrase entries (OWASP's figure). */
export const PBKDF2_ITERATIONS = 600_000;

const todo = (): never => {
  throw new Error('crypto: not implemented yet (#15)');
};

/**
 * A new random 256-bit AES-GCM data key, made once at setup. Extractable, because setup wraps it
 * for each unlock method; keep it only as long as setup needs it, then use the non-extractable key
 * `unlock` gives.
 */
export function newDataKey(): Promise<CryptoKey> {
  return todo();
}

/**
 * Wraps the data key under a passphrase (NFC-normalised, PBKDF2, random 16-byte salt).
 * `iterations` is for tests only: real entries always use PBKDF2_ITERATIONS.
 */
export function wrapWithPassphrase(
  dataKey: CryptoKey,
  passphrase: string,
  options?: { iterations?: number },
): Promise<KeyringEntry> {
  void [dataKey, passphrase, options];
  return todo();
}

/** Wraps the data key under a recovery key from `newRecoveryKey` (HKDF, random 16-byte salt). */
export function wrapWithRecoveryKey(dataKey: CryptoKey, recoveryKey: string): Promise<KeyringEntry> {
  void [dataKey, recoveryKey];
  return todo();
}

/** Wraps the data key under a passkey's PRF output (from createPasskey in ./passkey). */
export function wrapWithPasskey(
  dataKey: CryptoKey,
  passkey: { credentialId: Uint8Array; prfSalt: Uint8Array; prfOutput: Uint8Array; label: string },
): Promise<KeyringEntry> {
  void [dataKey, passkey];
  return todo();
}

/**
 * The data key, from whichever keyring entry the secret fits (for a passkey, the entry with its
 * credential id). Non-extractable unless `extractable` is set, which only Settings uses, after the
 * user proved who they are, to rewrap the key for a new method. Throws CryptoError 'wrong-secret'
 * when no entry fits, 'invalid' for a malformed recovery key.
 */
export function unlock(keyring: Keyring, secret: UnlockSecret, options?: { extractable?: boolean }): Promise<CryptoKey> {
  void [keyring, secret, options];
  return todo();
}

/** A new recovery key: 16 random bytes + a 4-byte check, as 8 groups of 4 Crockford base32 characters. */
export function newRecoveryKey(): Promise<string> {
  return todo();
}

/**
 * Whether typed text is a well-formed recovery key (case, spaces and dashes ignored; I, L, O read
 * as 1, 1, 0; the check must match). For live feedback while typing; `unlock` checks it again.
 */
export function isRecoveryKey(text: string): Promise<boolean> {
  void text;
  return todo();
}

/** The additional data binding a record to its place: `honed:v1:<store>:<id>`. */
export function recordAad(store: string, id: string): string {
  return `honed:v1:${store}:${id}`;
}

/** Encrypts the JSON of `value` with AES-GCM, a fresh random IV, and `aad` (from recordAad). */
export function encryptRecord(dataKey: CryptoKey, aad: string, value: unknown): Promise<EncryptedRecord> {
  void [dataKey, aad, value];
  return todo();
}

/** Decrypts a record. Throws CryptoError 'corrupt' if it was changed, moved (other aad), or the key is wrong. */
export function decryptRecord<T>(dataKey: CryptoKey, aad: string, record: EncryptedRecord): Promise<T> {
  void [dataKey, aad, record];
  return todo();
}
