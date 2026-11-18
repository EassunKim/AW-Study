// TEMPORARY (#17, until #16 lands): a Vault over the unencrypted milestone 2 store, so the setup,
// unlock and Settings screens can be built and tested before the encrypted store exists. It keeps
// the keyring in localStorage and checks the rules the real one must keep (no removing the last
// way in), but it encrypts NOTHING. PR #21 stays a draft until #16 replaces this file; delete it
// then.
import type { Keyring, KeyringEntry, UnlockMethod } from '../types/crypto';
import type { Vault, VaultStatus } from './vault';

const KEY = 'honed-fake-keyring';

export function fakeVault(storage: Storage = window.localStorage): Vault {
  let unlocked = false;

  const read = (): Keyring | null => {
    const raw = storage.getItem(KEY);
    return raw ? (JSON.parse(raw, reviveBytes) as Keyring) : null;
  };
  const write = (keyring: Keyring) => storage.setItem(KEY, JSON.stringify(keyring, replaceBytes));
  const change = async (edit: (entries: KeyringEntry[]) => KeyringEntry[]) => {
    if (!unlocked) throw new Error('The store is locked.');
    const keyring = read();
    if (!keyring) throw new Error('Not set up yet.');
    const entries = edit(keyring.entries);
    checkStillOpenable(entries);
    write({ v: 1, entries });
  };

  return {
    status(): VaultStatus {
      return read() === null ? 'new' : unlocked ? 'unlocked' : 'locked';
    },
    async getKeyring() {
      return read();
    },
    async setUp(keyring, dataKey, onProgress) {
      void dataKey;
      if (read() !== null) throw new Error('Already set up.');
      const total = 3;
      for (let done = 1; done <= total; done++) onProgress?.(done, total);
      write(keyring);
      unlocked = true;
    },
    async unlock(dataKey) {
      void dataKey;
      unlocked = true;
    },
    lock() {
      unlocked = false;
    },
    addKeyringEntry: (entry) => change((entries) => [...entries, entry]),
    removeKeyringEntry: (id) => change((entries) => entries.filter((e) => e.id !== id)),
    replaceKeyringEntries: (method: UnlockMethod, entry) =>
      change((entries) => [...entries.filter((e) => e.method !== method), entry]),
  };
}

/**
 * The rule #16 keeps too: always a passphrase or passkey, and always a recovery key. Refused with
 * code 'invalid', like #16's StoreError, so the screens word it themselves.
 */
function checkStillOpenable(entries: KeyringEntry[]) {
  if (!entries.some((e) => e.method === 'passphrase' || e.method === 'passkey')) {
    throw invalid('Keep at least one passphrase or passkey, or you couldn’t unlock.');
  }
  if (!entries.some((e) => e.method === 'recovery')) throw invalid('Keep a recovery key.');
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'invalid' });
}

const replaceBytes = (_key: string, value: unknown) =>
  value instanceof Uint8Array ? { $bytes: [...value] } : value;
const reviveBytes = (_key: string, value: unknown) =>
  value && typeof value === 'object' && '$bytes' in value ? new Uint8Array((value as { $bytes: number[] }).$bytes) : value;
