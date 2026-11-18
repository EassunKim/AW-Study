// The backup file (`.honed`): JSON holding the keyring (wrapped data keys only), the key check and
// every record exactly as stored, still encrypted. No plaintext, so it can sit in a cloud drive.
// The format is written down in docs/SECURITY.md ("Backups"); change it there first.
//
// Bytes (IVs, ciphertexts, wrapped keys, salts) are Uint8Array in the database. JSON has no bytes,
// so each one is written as {"$bytes": "<base64url>"} and read back into a Uint8Array.
import type { SealedSnapshot } from '../db/store';
import type { EncryptedRecord } from '../types/crypto';

export const BACKUP_FORMAT = 'honed-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = '.honed';

export interface Backup {
  createdAt: string; // ISO time
  snapshot: SealedSnapshot;
}

export type BackupErrorCode =
  | 'not-a-backup' // not JSON, or not ours
  | 'too-new' // made by a newer version of the format
  | 'damaged'; // ours, but something is missing or won't decrypt

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/** The file's text. */
export function encodeBackup(backup: Backup): string {
  const { schema, keyring, keycheck, stores } = backup.snapshot;
  const file = { format: BACKUP_FORMAT, v: BACKUP_VERSION, createdAt: backup.createdAt, schema, keyring, keycheck, stores };
  return JSON.stringify(file, (_key, value: unknown) => (value instanceof Uint8Array ? { $bytes: toBase64Url(value) } : value));
}

/** Reads a file's text, checking its shape (not yet that it decrypts: see openBackup). */
export function decodeBackup(text: string): Backup {
  let file: unknown;
  try {
    file = JSON.parse(text, (_key, value: unknown) => (isBytes(value) ? fromBase64Url(value.$bytes) : value));
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('not-a-backup', 'That file isn’t a backup.');
  }
  if (!isObject(file) || file.format !== BACKUP_FORMAT) throw new BackupError('not-a-backup', 'That file isn’t a backup.');
  if (typeof file.v !== 'number' || file.v > BACKUP_VERSION) {
    throw new BackupError('too-new', 'That backup was made by a newer version. Update the app first.');
  }
  const damaged = (what: string) => new BackupError('damaged', `That backup is damaged (${what}).`);
  if (typeof file.createdAt !== 'string' || Number.isNaN(Date.parse(file.createdAt))) throw damaged('date');
  if (!Number.isInteger(file.schema) || (file.schema as number) < 1) throw damaged('schema');
  const keyring = file.keyring;
  if (!isObject(keyring) || keyring.v !== 1 || !Array.isArray(keyring.entries) || keyring.entries.length === 0) {
    throw damaged('keyring');
  }
  if (!keyring.entries.every((e) => isObject(e) && typeof e.id === 'string' && e.wrapped instanceof Uint8Array)) {
    throw damaged('keyring');
  }
  if (!isEncrypted(file.keycheck)) throw damaged('key check');
  const stores = file.stores;
  if (!isObject(stores)) throw damaged('records');
  for (const [name, rows] of Object.entries(stores)) {
    if (!Array.isArray(rows) || !rows.every((r) => isObject(r) && typeof r.id === 'string' && isEncrypted(r.enc))) {
      throw damaged(name);
    }
  }
  return {
    createdAt: file.createdAt,
    snapshot: { schema: file.schema as number, keyring: keyring as never, keycheck: file.keycheck, stores: stores as Record<string, unknown[]> },
  };
}

/** A file name that sorts by time, e.g. "Honed-backup-2026-11-18-0930.honed" (local time). */
export function backupFileName(appName: string, at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
  return `${appName}-backup-${stamp}${BACKUP_EXTENSION}`;
}

// --- Helpers ---

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBytes(value: unknown): value is { $bytes: string } {
  return isObject(value) && typeof value.$bytes === 'string' && Object.keys(value).length === 1;
}

function isEncrypted(value: unknown): value is EncryptedRecord {
  return isObject(value) && value.v === 1 && value.iv instanceof Uint8Array && value.ct instanceof Uint8Array;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const n = (data[i]! << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < data.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < data.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new BackupError('damaged', 'That backup is damaged (bytes).');
  }
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (ALPHABET.indexOf(text[i]!) << 18) |
      (ALPHABET.indexOf(text[i + 1]!) << 12) |
      ((i + 2 < text.length ? ALPHABET.indexOf(text[i + 2]!) : 0) << 6) |
      (i + 3 < text.length ? ALPHABET.indexOf(text[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < text.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < text.length) out[o++] = n & 255;
  }
  return out;
}
