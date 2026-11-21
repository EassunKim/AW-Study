// The encryption core (docs/SECURITY.md): pure WebCrypto functions, no storage, no UI. Node has the
// same WebCrypto, so all of it is tested in Vitest (crypto.test.ts).
//
// Only standard primitives: AES-GCM (records), AES-KW (wrapping the data key), PBKDF2-SHA-256
// (passphrases), HKDF-SHA-256 (recovery key, passkey PRF output). The signatures are the contract
// #16, #17 and #18 build against: keep them.

import { APP_NAME } from '../brand';
import {
  CryptoError,
  type EncryptedRecord,
  type HkdfParams,
  type Keyring,
  type KeyringEntry,
  type Pbkdf2Params,
  type RememberedKey,
  type UnlockSecret,
} from '../types/crypto';

/** PBKDF2-HMAC-SHA-256 iterations for new passphrase entries (OWASP's figure since 2023). */
export const PBKDF2_ITERATIONS = 600_000;

const INFO = { recovery: 'honed:v1:recovery', passkey: 'honed:v1:passkey', google: 'honed:v1:google' } as const;
const subtle = () => globalThis.crypto.subtle;
const utf8 = new TextEncoder();

/** Random bytes, in a fresh ArrayBuffer. */
function random(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** A copy backed by a plain ArrayBuffer, which is what WebCrypto's types ask for. */
function bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// --- Data key ---

export function newDataKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// --- Key-encryption keys ---

async function passphraseKek(passphrase: string, kdf: Pbkdf2Params): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', utf8.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: bytes(kdf.salt) },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function hkdfKek(secret: Uint8Array, kdf: HkdfParams): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', bytes(secret), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes(kdf.salt), info: utf8.encode(kdf.info) },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapUnder(dataKey: CryptoKey, kek: CryptoKey): Promise<Uint8Array> {
  if (!dataKey.extractable) {
    throw new CryptoError('invalid', 'This key can’t be wrapped: unlock with extractable: true first.');
  }
  return new Uint8Array(await subtle().wrapKey('raw', dataKey, kek, 'AES-KW'));
}

/** The data key from one entry, or null if this key-encryption key doesn't fit it. */
async function unwrapUnder(entry: KeyringEntry, kek: CryptoKey, extractable: boolean): Promise<CryptoKey | null> {
  try {
    return await subtle().unwrapKey('raw', bytes(entry.wrapped), kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, extractable, [
      'encrypt',
      'decrypt',
    ]);
  } catch {
    return null; // AES-KW's integrity check failed: wrong secret (or a damaged entry)
  }
}

const entryBase = (wrapped: Uint8Array) => ({
  id: globalThis.crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  wrap: 'AES-KW' as const,
  wrapped,
});

export async function wrapWithPassphrase(
  dataKey: CryptoKey,
  passphrase: string,
  options?: { iterations?: number },
): Promise<KeyringEntry> {
  if (!passphrase) throw new CryptoError('invalid', 'The passphrase can’t be empty.');
  const iterations = options?.iterations ?? PBKDF2_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1) throw new CryptoError('invalid', 'Bad iteration count.');
  const kdf: Pbkdf2Params = { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: random(16) };
  return { ...entryBase(await wrapUnder(dataKey, await passphraseKek(passphrase, kdf))), method: 'passphrase', kdf };
}

export async function wrapWithRecoveryKey(dataKey: CryptoKey, recoveryKey: string): Promise<KeyringEntry> {
  const secret = await parseRecoveryKey(recoveryKey);
  const kdf: HkdfParams = { name: 'HKDF', hash: 'SHA-256', salt: random(16), info: INFO.recovery };
  return { ...entryBase(await wrapUnder(dataKey, await hkdfKek(secret, kdf))), method: 'recovery', kdf };
}

export async function wrapWithPasskey(
  dataKey: CryptoKey,
  passkey: { credentialId: Uint8Array; prfSalt: Uint8Array; prfOutput: Uint8Array; label: string },
): Promise<KeyringEntry> {
  if (passkey.prfOutput.length !== 32) throw new CryptoError('invalid', 'A passkey’s PRF output is 32 bytes.');
  if (passkey.credentialId.length === 0) throw new CryptoError('invalid', 'Missing passkey id.');
  const kdf: HkdfParams = { name: 'HKDF', hash: 'SHA-256', salt: random(16), info: INFO.passkey };
  return {
    ...entryBase(await wrapUnder(dataKey, await hkdfKek(passkey.prfOutput, kdf))),
    method: 'passkey',
    kdf,
    credentialId: bytes(passkey.credentialId),
    prfSalt: bytes(passkey.prfSalt),
    label: passkey.label,
  };
}

/** Google unlock (#101): the data key wrapped under the account's Google unlock key (32 bytes, from the sync server). */
export async function wrapWithGoogleKey(dataKey: CryptoKey, googleKey: Uint8Array, email: string): Promise<KeyringEntry> {
  if (googleKey.length !== 32) throw new CryptoError('invalid', 'A Google unlock key is 32 bytes.');
  const kdf: HkdfParams = { name: 'HKDF', hash: 'SHA-256', salt: random(16), info: INFO.google };
  return { ...entryBase(await wrapUnder(dataKey, await hkdfKek(googleKey, kdf))), method: 'google', kdf, email };
}

// --- Unlocking ---

const WRONG: Record<UnlockSecret['method'], string> = {
  passphrase: `That passphrase doesn’t unlock ${APP_NAME} on this device.`,
  recovery: `That recovery key doesn’t unlock ${APP_NAME} on this device.`,
  passkey: `That passkey doesn’t unlock ${APP_NAME} on this device.`,
  google: `Your Google account’s unlock doesn’t open ${APP_NAME} on this device.`,
};

export async function unlock(keyring: Keyring, secret: UnlockSecret, options?: { extractable?: boolean }): Promise<CryptoKey> {
  if (keyring?.v !== 1 || !Array.isArray(keyring.entries)) throw new CryptoError('corrupt', 'The keyring is damaged.');
  const extractable = options?.extractable ?? false;

  if (secret.method === 'recovery') {
    const raw = await parseRecoveryKey(secret.recoveryKey); // 'invalid' before any unlocking is tried
    for (const entry of keyring.entries) {
      if (entry.method !== 'recovery') continue;
      const key = await unwrapUnder(entry, await hkdfKek(raw, entry.kdf), extractable);
      if (key) return key;
    }
  } else if (secret.method === 'passphrase') {
    if (!secret.passphrase) throw new CryptoError('invalid', 'Type your passphrase.');
    for (const entry of keyring.entries) {
      if (entry.method !== 'passphrase') continue;
      const key = await unwrapUnder(entry, await passphraseKek(secret.passphrase, entry.kdf), extractable);
      if (key) return key;
    }
  } else if (secret.method === 'google') {
    for (const entry of keyring.entries) {
      if (entry.method !== 'google') continue;
      const key = await unwrapUnder(entry, await hkdfKek(secret.googleKey, entry.kdf), extractable);
      if (key) return key;
    }
  } else {
    for (const entry of keyring.entries) {
      if (entry.method !== 'passkey' || !sameBytes(entry.credentialId, secret.credentialId)) continue;
      const key = await unwrapUnder(entry, await hkdfKek(secret.prfOutput, entry.kdf), extractable);
      if (key) return key;
    }
  }
  throw new CryptoError('wrong-secret', WRONG[secret.method]);
}

// --- Recovery keys: 16 random bytes + a 4-byte check, Crockford base32, 8 groups of 4 ---

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford's: no I, L, O, U
const SECRET_BYTES = 16;
const CHECK_BYTES = 4;
const KEY_CHARS = 32; // (16 + 4) bytes * 8 bits / 5 bits per character

async function checkOf(secret: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', bytes(secret))).slice(0, CHECK_BYTES);
}

function toBase32(data: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 255);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return new Uint8Array(out);
}

export async function newRecoveryKey(): Promise<string> {
  const secret = random(SECRET_BYTES);
  const all = new Uint8Array(SECRET_BYTES + CHECK_BYTES);
  all.set(secret);
  all.set(await checkOf(secret), SECRET_BYTES);
  return toBase32(all).match(/.{4}/g)!.join('-');
}

/**
 * @internal The 16 secret bytes of a typed recovery key. Forgiving about case, spaces, dashes,
 * and I/L/O for 1/1/0; strict about the check. Throws CryptoError 'invalid'.
 */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const clean = text
    .toUpperCase()
    .replace(/[\s\-_]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  const invalid = new CryptoError('invalid', 'That doesn’t look like a recovery key: check each group of 4.');
  if (clean.length !== KEY_CHARS) throw invalid;
  const all = fromBase32(clean);
  if (!all || all.length !== SECRET_BYTES + CHECK_BYTES) throw invalid;
  const secret = all.slice(0, SECRET_BYTES);
  if (!sameBytes(await checkOf(secret), all.slice(SECRET_BYTES))) throw invalid;
  return secret;
}

export async function isRecoveryKey(text: string): Promise<boolean> {
  try {
    await parseRecoveryKey(text);
    return true;
  } catch {
    return false;
  }
}

// --- Records ---

export function recordAad(store: string, id: string): string {
  return `honed:v1:${store}:${id}`;
}

export async function encryptRecord(dataKey: CryptoKey, aad: string, value: unknown): Promise<EncryptedRecord> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new CryptoError('invalid', 'Only JSON values can be encrypted.');
  return encryptBytes(dataKey, aad, utf8.encode(json));
}

export async function decryptRecord<T>(dataKey: CryptoKey, aad: string, record: EncryptedRecord): Promise<T> {
  const plain = await decryptBytes(dataKey, aad, record);
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new CryptoError('corrupt', 'This record decrypted to something unreadable.');
  }
}

/**
 * Encrypts raw bytes (a PDF) the same way as a record: AES-GCM, a fresh IV, `aad` binding it to
 * its place. (encryptRecord would JSON-encode the bytes, several times their size.)
 */
export async function encryptBytes(dataKey: CryptoKey, aad: string, data: Uint8Array): Promise<EncryptedRecord> {
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, dataKey, bytes(data));
  return { v: 1, iv, ct: new Uint8Array(ct) };
}

/** Decrypts bytes from encryptBytes. Throws CryptoError 'corrupt' if changed, moved or the key is wrong. */
export async function decryptBytes(dataKey: CryptoKey, aad: string, record: EncryptedRecord): Promise<Uint8Array> {
  if (record?.v !== 1 || !(record.iv instanceof Uint8Array) || record.iv.length !== 12 || !(record.ct instanceof Uint8Array)) {
    throw new CryptoError('corrupt', 'This record is damaged.');
  }
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv: bytes(record.iv), additionalData: utf8.encode(aad) }, dataKey, bytes(record.ct)),
    );
  } catch {
    throw new CryptoError('corrupt', 'This record can’t be decrypted: it was changed, moved, or the key is wrong.');
  }
}

// --- Remembering a device (#99, docs/SECURITY.md "Remembering a device") ---

const REMEMBER_AAD = 'honed:v1:meta:remembered';

/**
 * Wraps an extractable data key (just unlocked, or just made at setup) under a new device key that
 * can't be read out of the page, to keep in this device's `meta`. Drop the extractable key afterwards.
 */
export async function rememberKey(dataKey: CryptoKey): Promise<RememberedKey> {
  if (!dataKey.extractable) throw new CryptoError('invalid', 'Remembering needs the key straight after unlocking.');
  const deviceKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  const iv = random(12);
  const wrapped = await subtle().wrapKey('raw', dataKey, deviceKey, { name: 'AES-GCM', iv, additionalData: utf8.encode(REMEMBER_AAD) });
  return { v: 1, deviceKey, iv, wrapped: new Uint8Array(wrapped), at: new Date().toISOString() };
}

/** The data key from a remembered unlock, never extractable. Throws CryptoError 'corrupt' if it won't open. */
export async function recallKey(remembered: RememberedKey): Promise<CryptoKey> {
  if (
    remembered?.v !== 1 ||
    !(remembered.deviceKey instanceof CryptoKey) ||
    !(remembered.iv instanceof Uint8Array) ||
    remembered.iv.length !== 12 ||
    !(remembered.wrapped instanceof Uint8Array)
  ) {
    throw new CryptoError('corrupt', 'This device’s remembered unlock is damaged.');
  }
  try {
    return await subtle().unwrapKey(
      'raw',
      bytes(remembered.wrapped),
      remembered.deviceKey,
      { name: 'AES-GCM', iv: bytes(remembered.iv), additionalData: utf8.encode(REMEMBER_AAD) },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new CryptoError('corrupt', 'This device’s remembered unlock no longer works.');
  }
}
