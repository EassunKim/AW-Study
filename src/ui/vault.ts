// The lock side of the store, as the screens use it: is it set up, locked or unlocked; set it up;
// unlock and lock; change the ways of unlocking. Agreed in issue #16; StudyStore (src/db/store.ts)
// implements it, so main.tsx passes the store as the vault. Store errors are StoreError codes:
// 'locked', 'wrong-key', 'invalid' (e.g. removing the last way in), 'not-found'.
//
// The crypto calls (unlock, the wrapWith* functions) happen in the screens, through ./keys: the
// store never sees a passphrase, a recovery key or a passkey's PRF output, only wrapped keys and
// the data key.
import type { Keyring, KeyringEntry, RememberedKey, UnlockMethod } from '../types/crypto';

export type VaultStatus = 'new' | 'locked' | 'unlocked';

export interface Vault {
  status(): VaultStatus;
  /** Readable while locked: the unlock screen needs the passkey entries. Null before setup. */
  getKeyring(): Promise<Keyring | null>;
  /** Saves the first keyring, encrypts any existing data, and leaves the store unlocked. */
  setUp(keyring: Keyring, dataKey: CryptoKey, onProgress?: (done: number, total: number) => void): Promise<void>;
  unlock(dataKey: CryptoKey): Promise<void>;
  lock(): void;
  /** This device's remembered unlock (#99), readable while locked; null if it doesn't remember. */
  getRemembered(): Promise<RememberedKey | null>;
  /** Remembers the unlock on this device (unlocked only). */
  remember(remembered: RememberedKey): Promise<void>;
  /** Forgets it: the next open asks again. */
  forget(): Promise<void>;
  addKeyringEntry(entry: KeyringEntry): Promise<void>;
  removeKeyringEntry(id: string): Promise<void>;
  /** Removes every entry of `method` and adds `entry`, in one go (change passphrase, new recovery key). */
  replaceKeyringEntries(method: UnlockMethod, entry: KeyringEntry): Promise<void>;
}
