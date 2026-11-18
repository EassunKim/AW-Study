// The shared contract for milestone 3's encryption (docs/SECURITY.md). The data layer (#16), the
// screens (#17) and backups (#18) code against these types and the function signatures in
// src/lib/crypto.ts and src/lib/passkey.ts. Change them only in their own small PR, announced in
// those issues.
//
// Bytes are Uint8Array: IndexedDB stores them as they are; backups (#18) encode them as base64url.

/** Every way of unlocking. */
export type UnlockMethod = 'passphrase' | 'passkey' | 'recovery';

/** Key derivation for a passphrase: PBKDF2-HMAC-SHA-256. */
export interface Pbkdf2Params {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: Uint8Array; // 16 random bytes
}

/** Key derivation from a high-entropy secret (a recovery key, a passkey's PRF output). */
export interface HkdfParams {
  name: 'HKDF';
  hash: 'SHA-256';
  salt: Uint8Array; // 16 random bytes
  info: string; // what the key is for, e.g. "honed:v1:recovery"
}

interface EntryBase {
  id: string; // random, so one entry can be removed or replaced
  createdAt: string; // ISO time
  wrap: 'AES-KW'; // how the data key is wrapped
  wrapped: Uint8Array; // the data key, wrapped with this entry's key-encryption key
}

/** One wrapped copy of the data key. */
export type KeyringEntry =
  | (EntryBase & { method: 'passphrase'; kdf: Pbkdf2Params })
  | (EntryBase & { method: 'recovery'; kdf: HkdfParams })
  | (EntryBase & {
      method: 'passkey';
      kdf: HkdfParams;
      credentialId: Uint8Array; // which passkey
      prfSalt: Uint8Array; // the 32 bytes the passkey's PRF is evaluated on
      label: string; // shown in Settings, e.g. "iPhone" (the user can edit it)
    });

/** All the ways this user can unlock. Stored in `meta` (#16) and in backups (#18). */
export interface Keyring {
  v: 1;
  entries: KeyringEntry[];
}

/** A record's private part, encrypted. */
export interface EncryptedRecord {
  v: 1;
  iv: Uint8Array; // 12 random bytes, never reused
  ct: Uint8Array; // AES-GCM ciphertext with its 16-byte tag
}

/** What the user gives to unlock. */
export type UnlockSecret =
  | { method: 'passphrase'; passphrase: string }
  | { method: 'recovery'; recoveryKey: string }
  | { method: 'passkey'; credentialId: Uint8Array; prfOutput: Uint8Array };

export type CryptoErrorCode =
  | 'wrong-secret' // doesn't unlock this keyring
  | 'invalid' // badly formed input (e.g. a recovery key failing its check)
  | 'corrupt' // a record or entry that won't decrypt or parse
  | 'unsupported'; // the browser lacks something (e.g. PRF)

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
