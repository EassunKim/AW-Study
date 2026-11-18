// Setting up and using the keys, for the screens: what setup makes, how each way of unlocking
// turns into the data key, the passphrase rules, and plain-words messages for crypto errors.
// Pure logic over src/lib/crypto.ts and src/lib/passkey.ts; no React.
import {
  newDataKey,
  newRecoveryKey,
  unlock,
  wrapWithPasskey,
  wrapWithPassphrase,
  wrapWithRecoveryKey,
} from '../lib/crypto';
import { CryptoError, type Keyring, type KeyringEntry, type UnlockSecret } from '../types/crypto';

/** What setup produces before anything is saved: the keyring, the data key, and the key to show. */
export interface NewKeys {
  keyring: Keyring;
  dataKey: CryptoKey;
  recoveryKey: string;
}

/** A passkey just made by createPasskey, with the label the user gave it. */
export interface PasskeyInput {
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
  prfOutput: Uint8Array;
  label: string;
}

export type FirstMethod = { method: 'passphrase'; passphrase: string } | { method: 'passkey'; passkey: PasskeyInput };

/** `iterations` is for tests only, as in wrapWithPassphrase. */
export interface KeyOptions {
  iterations?: number;
}

/**
 * A new data key wrapped for the chosen method and for a new recovery key. Every user has a
 * recovery key: it's the only way back if the passphrase is forgotten or the passkey lost.
 */
export async function makeKeys(first: FirstMethod, options: KeyOptions = {}): Promise<NewKeys> {
  const dataKey = await newDataKey();
  const recoveryKey = await newRecoveryKey();
  const entries: KeyringEntry[] = [
    first.method === 'passphrase'
      ? await wrapWithPassphrase(dataKey, first.passphrase, options)
      : await wrapWithPasskey(dataKey, first.passkey),
    await wrapWithRecoveryKey(dataKey, recoveryKey),
  ];
  return { keyring: { v: 1, entries }, dataKey, recoveryKey };
}

/** The everyday data key (non-extractable) for a secret. Throws CryptoError as `unlock` does. */
export function unlockWith(keyring: Keyring, secret: UnlockSecret): Promise<CryptoKey> {
  return unlock(keyring, secret);
}

/**
 * An extractable data key, for Settings to rewrap after the user has proved who they are. Use it
 * for the one change and drop it.
 */
export function unlockForChange(keyring: Keyring, secret: UnlockSecret): Promise<CryptoKey> {
  return unlock(keyring, secret, { extractable: true });
}

/** The keyring's passkeys, for the unlock screen's button and the Settings list. */
export function passkeyEntries(keyring: Keyring | null) {
  return (keyring?.entries ?? []).filter(
    (e): e is Extract<KeyringEntry, { method: 'passkey' }> => e.method === 'passkey',
  );
}

export function hasPassphrase(keyring: Keyring | null): boolean {
  return (keyring?.entries ?? []).some((e) => e.method === 'passphrase');
}

// --- Passphrases ---

export const PASSPHRASE_MIN = 10;

export type Strength = 'too-short' | 'weak' | 'fair' | 'strong';

/**
 * A rough strength hint, without a word list (no extra dependency): length matters most, and a
 * few words with spaces beat a short mix of symbols. Under PASSPHRASE_MIN characters is refused.
 */
export function passphraseStrength(passphrase: string): Strength {
  const text = passphrase.normalize('NFC');
  const length = [...text].length;
  if (length < PASSPHRASE_MIN) return 'too-short';
  const distinct = new Set(text.toLowerCase()).size;
  if (distinct < 5) return 'weak';
  const words = text.trim().split(/\s+/).filter((w) => w.length >= 3).length;
  if (length >= 20 || (words >= 4 && length >= 16)) return 'strong';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(text)).length;
  if (length >= 14 || kinds >= 3) return 'fair';
  return 'weak';
}

export const STRENGTH_TEXT: Record<Strength, string> = {
  'too-short': `Use at least ${PASSPHRASE_MIN} characters.`,
  weak: 'Weak: easy to guess. A few unrelated words work well.',
  fair: 'Fair. Longer is safer: a few unrelated words work well.',
  strong: 'Strong.',
};

/** Why a new passphrase can't be used yet, or null when it can. */
export function passphraseProblem(passphrase: string, repeat: string): string | null {
  if (passphraseStrength(passphrase) === 'too-short') return STRENGTH_TEXT['too-short'];
  if (passphrase.normalize('NFC') !== repeat.normalize('NFC')) return 'The two passphrases don’t match.';
  return null;
}

// --- Recovery key confirmation ---

/** The groups of a recovery key ("ABCD-EFGH-…" → ["ABCD", "EFGH", …]). */
export function recoveryGroups(recoveryKey: string): string[] {
  return recoveryKey.split('-');
}

/**
 * Whether the user typed the group asked for (1-based `group`), ignoring case, spaces and dashes,
 * and reading I, L and O as 1, 1 and 0, as the recovery key format does.
 */
export function confirmsGroup(recoveryKey: string, group: number, typed: string): boolean {
  const want = recoveryGroups(recoveryKey)[group - 1];
  if (!want) return false;
  const clean = (s: string) => s.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return clean(typed) === clean(want);
}

/** The text of the "Download" file for a recovery key. */
export function recoveryKeyFile(appName: string, recoveryKey: string, madeAt: Date): string {
  return [
    `${appName} recovery key`,
    '',
    recoveryKey,
    '',
    `Made ${madeAt.toISOString().slice(0, 10)}.`,
    `It unlocks your ${appName} cards if you forget your passphrase or lose your passkey.`,
    'Keep it somewhere safe and private. Anyone with it and your device can read your cards.',
    'If you lose it and your passphrase, nobody can get your cards back.',
    '',
  ].join('\n');
}

// --- Errors in plain words ---

/** What to show when unlocking or changing keys fails. */
export function unlockMessage(err: unknown, method: UnlockSecret['method']): string {
  if (err instanceof CryptoError) {
    switch (err.code) {
      case 'wrong-secret':
        return method === 'passphrase'
          ? 'That passphrase doesn’t unlock this device’s cards. Check it and try again.'
          : method === 'recovery'
            ? 'That recovery key doesn’t unlock this device’s cards.'
            : 'That passkey isn’t one set up for this device’s cards.';
      case 'invalid':
        return 'That recovery key isn’t quite right: check for a typo.';
      case 'unsupported':
        return 'This browser or passkey can’t be used to unlock. Use your passphrase or recovery key.';
      case 'corrupt':
        return 'The saved keys on this device look damaged. Try your recovery key, or restore a backup.';
    }
  }
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'The passkey request was cancelled or timed out.';
  }
  return err instanceof Error ? err.message : String(err);
}
