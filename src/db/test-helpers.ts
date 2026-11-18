// Helpers for the store's tests (not used by the app, so not in the build).
import { newDataKey, newRecoveryKey, wrapWithPassphrase, wrapWithRecoveryKey } from '../lib/crypto';
import type { Keyring } from '../types/crypto';

export const TEST_PASSPHRASE = 'test passphrase';

/** A keyring that opens `dataKey`: a passphrase (with few PBKDF2 iterations, for speed) and a recovery key. */
export async function testKeyring(dataKey: CryptoKey): Promise<Keyring> {
  return {
    v: 1,
    entries: [
      await wrapWithPassphrase(dataKey, TEST_PASSPHRASE, { iterations: 1_000 }),
      await wrapWithRecoveryKey(dataKey, await newRecoveryKey()),
    ],
  };
}

export { newDataKey };

/** Whether `needle` appears anywhere in a stored value: strings, and bytes read as text. */
export function containsText(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).includes(needle);
  if (Array.isArray(value)) return value.some((v) => containsText(v, needle));
  if (value && typeof value === 'object') return Object.values(value).some((v) => containsText(v, needle));
  return false;
}

/**
 * Bytes that pass the store's PDF check ("%PDF-" first), with `text` inside and random padding up
 * to `size` bytes. Not a renderable PDF: for storage tests only (the viewer's tests use real ones).
 */
export function fakePdf(text = 'slides', size = 1_000): Uint8Array {
  const head = new TextEncoder().encode(`%PDF-1.7\n% ${text}\n`);
  const data = new Uint8Array(Math.max(size, head.length));
  data.set(head);
  for (let i = head.length; i < data.length; i += 65_536) {
    globalThis.crypto.getRandomValues(data.subarray(i, Math.min(i + 65_536, data.length)));
  }
  return data;
}
