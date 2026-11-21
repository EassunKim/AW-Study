// Settings' "Google unlock" (#101, docs/SECURITY.md "Google unlock"): opt-in. Turning it on proves
// it's you (passphrase, passkey or recovery key), gets the account's key from the sync server and adds a
// `google` keyring entry; from then on the unlock screen offers "Unlock with Google", and passkeys can be
// removed. Turning it off removes the entry and asks the server to delete the key (for every device).
import { useState } from 'react';
import { APP_NAME } from '../brand';
import { wrapWithGoogleKey } from '../lib/crypto';
import type { Keyring } from '../types/crypto';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { googleEntry } from '../ui/keys';
import { ProveItsYou, useVault } from '../ui/lock-parts';
import { accountStatus, googleUnlockUses, turnOffGoogleUnlock, turnOnGoogleUnlock } from './client';

export function GoogleUnlockSettings({ keyring, onChanged }: { keyring: Keyring; onChanged: () => Promise<void> | void }) {
  const vault = useVault();
  const entry = googleEntry(keyring);
  const [proving, setProving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [uses, setUses] = useState<{ device: string; at: string }[] | null>(null);

  const turnOn = async (changeKey: CryptoKey) => {
    setProving(false);
    setBusy(true);
    setMessage(null);
    try {
      const account = await accountStatus();
      if (!account.signedIn) throw new Error('Sign in with Google first (Account, above), then turn this on.');
      const googleKey = await turnOnGoogleUnlock();
      await vault.addKeyringEntry(await wrapWithGoogleKey(changeKey, googleKey, account.email));
      setMessage({ text: `Google unlock is on for ${account.email}.`, error: false });
      await onChanged();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!entry) return;
    setConfirmOff(false);
    setBusy(true);
    setMessage(null);
    try {
      await vault.removeKeyringEntry(entry.id); // refused if it's the only way in besides the recovery key
      await onChanged();
      await turnOffGoogleUnlock();
      setMessage({ text: 'Google unlock is off.', error: false });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setMessage({ text: /Keep at least one/.test(text) ? 'Add a passphrase or passkey first: otherwise only your recovery key could unlock.' : text, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 id="google-unlock-title">Google unlock</h3>
      <div className="stack" role="group" aria-labelledby="google-unlock-title">
        {entry ? (
          <>
            <p data-testid="google-unlock-state">
              On for {entry.email}: “Unlock with Google” opens {APP_NAME}, so you can remove your passkeys. Your recovery key still works.
            </p>
            <p className="muted small">Our server keeps a key that opens your data, so it, or anyone who broke into it or your Google account, could read it.</p>
            <div className="row">
              <button type="button" onClick={() => void googleUnlockUses().then(setUses)} disabled={busy}>
                When was it used?
              </button>
              <button type="button" onClick={() => setConfirmOff(true)} disabled={busy}>
                Turn off Google unlock
              </button>
            </div>
            {uses && (
              <ul className="small" aria-label="Google unlock uses" data-testid="google-unlock-uses">
                {uses.length === 0 && <li>Not used yet.</li>}
                {uses.map((u) => (
                  <li key={u.at + u.device}>
                    {u.device}, {new Date(u.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="small">
              Sign in with Google instead of a passkey or passphrase. A device that remembers you still opens straight in; this is for when it
              asks.
            </p>
            <p className="small" data-testid="google-unlock-warning">
              <strong>The cost:</strong> our server keeps a key that opens your data. So our server, or anyone who broke into it or into your
              Google account, could read your classes, slides and scores. Off, only you can.
            </p>
            <div className="row">
              <button type="button" onClick={() => setProving(true)} disabled={busy || proving}>
                Turn on Google unlock
              </button>
            </div>
          </>
        )}
        {proving && (
          <ProveItsYou keyring={keyring} why="Prove it’s you to turn on Google unlock." onProved={(key) => void turnOn(key)} onCancel={() => setProving(false)} />
        )}
        {message && (
          <p className={message.error ? 'error' : 'done'} role="status" data-testid="google-unlock-message">
            {message.text}
          </p>
        )}
      </div>
      {confirmOff && (
        <ConfirmDialog
          title="Turn off Google unlock?"
          message={`It stops working on every device of this account. Your data key doesn’t change, so anyone who copied the server’s key while it was on could still read what it opened. Keep a passphrase or passkey to unlock.`}
          confirmLabel="Turn it off"
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => void turnOff()}
        />
      )}
    </>
  );
}
