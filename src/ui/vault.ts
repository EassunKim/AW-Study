// The lock side of the store, as the screens use it: is it set up, locked or unlocked; set it up;
// unlock and lock; change the ways of unlocking. This is the shape proposed for #16 in issue #16
// (comment of Nov 18). Until #16 lands, src/ui/fakeVault.ts provides it over the unencrypted M2
// store, so the screens can be built and tested.
//
// The crypto calls (unlock, the wrapWith* functions) happen in the screens, through ./keys: the
// store never sees a passphrase, a recovery key or a passkey's PRF output, only wrapped keys and
// the data key.
import type { Keyring, KeyringEntry, UnlockMethod } from '../types/crypto';

export type VaultStatus = 'new' | 'locked' | 'unlocked';

export interface Vault {
  status(): VaultStatus;
  /** Readable while locked: the unlock screen needs the passkey entries. Null before setup. */
  getKeyring(): Promise<Keyring | null>;
  /** Saves the first keyring, encrypts any existing data, and leaves the store unlocked. */
  setUp(keyring: Keyring, dataKey: CryptoKey, onProgress?: (done: number, total: number) => void): Promise<void>;
  unlock(dataKey: CryptoKey): Promise<void>;
  lock(): void;
  addKeyringEntry(entry: KeyringEntry): Promise<void>;
  removeKeyringEntry(id: string): Promise<void>;
  /** Removes every entry of `method` and adds `entry`, in one go (change passphrase, new recovery key). */
  replaceKeyringEntries(method: UnlockMethod, entry: KeyringEntry): Promise<void>;
}
