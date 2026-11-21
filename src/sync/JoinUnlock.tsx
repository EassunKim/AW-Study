// Unlocking the account's keyring to join it on this device (#105): Google unlock (when the account has it),
// a passkey that's synced to this device, the account's passphrase or its recovery key. Gives the session key
// (never extractable) and, when "Remember this device" is ticked, this device's remembered unlock (#99).
import { useState, type FormEvent } from 'react';
import { getPasskeySecret } from '../lib/passkey';
import type { Keyring, RememberedKey, UnlockSecret } from '../types/crypto';
import { googleEntry, hasPassphrase, openKey, passkeyEntries, unlockMessage } from '../ui/keys';
import { RecoveryKeyField, RememberField, usePrfSupported } from '../ui/lock-parts';
import { fetchGoogleKey, GoogleUnlockError } from './client';

export function JoinUnlock({
  keyring,
  onOpened,
  confirmLabel = 'Unlock and download',
}: {
  keyring: Keyring;
  onOpened: (opened: { key: CryptoKey; remembered: RememberedKey | null }) => Promise<void>;
  confirmLabel?: string;
}) {
  const prf = usePrfSupported();
  const google = googleEntry(keyring);
  const passkeys = passkeyEntries(keyring);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>(hasPassphrase(keyring) ? 'passphrase' : 'recovery');
  const [secret, setSecret] = useState('');
  const [rememberIt, setRememberIt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const attempt = async (given: () => Promise<UnlockSecret>, method: UnlockSecret['method']) => {
    setBusy(true);
    setProblem(null);
    try {
      await onOpened(await openKey(keyring, await given(), rememberIt));
    } catch (err) {
      setProblem(
        err instanceof GoogleUnlockError && err.code === 'needs-sign-in'
          ? 'Sign in with Google again, then try within 5 minutes.'
          : err instanceof GoogleUnlockError
            ? err.message
            : unlockMessage(err, method),
      );
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || secret.trim() === '') return;
    void attempt(
      async () => (mode === 'passphrase' ? { method: 'passphrase', passphrase: secret } : { method: 'recovery', recoveryKey: secret }),
      mode,
    );
  };

  return (
    <div className="stack" role="group" aria-label="Unlock your account’s data">
      <p className="small">Unlock your account’s data the way you do on your other device.</p>
      <RememberField checked={rememberIt} onChange={setRememberIt} />
      {google && (
        <button type="button" className="primary" onClick={() => void attempt(async () => ({ method: 'google', googleKey: await fetchGoogleKey() }), 'google')} disabled={busy}>
          Unlock with Google
        </button>
      )}
      {prf && passkeys.length > 0 && (
        <button
          type="button"
          onClick={() =>
            void attempt(async () => {
              const got = await getPasskeySecret(passkeys.map((p) => ({ credentialId: p.credentialId, prfSalt: p.prfSalt })));
              return { method: 'passkey', ...got };
            }, 'passkey')
          }
          disabled={busy}
        >
          Use a passkey
        </button>
      )}
      <form className="stack" onSubmit={submit}>
        {mode === 'passphrase' ? (
          <>
            <label htmlFor="join-passphrase">Your passphrase</label>
            <input id="join-passphrase" type="password" autoComplete="current-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </>
        ) : (
          <RecoveryKeyField value={secret} onChange={setSecret} />
        )}
        <button type="submit" className={google ? '' : 'primary'} disabled={busy || secret.trim() === ''}>
          {busy ? 'Downloading…' : confirmLabel}
        </button>
      </form>
      {hasPassphrase(keyring) && (
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === 'passphrase' ? 'recovery' : 'passphrase');
            setSecret('');
            setProblem(null);
          }}
        >
          {mode === 'passphrase' ? 'Use your recovery key instead' : 'Use your passphrase instead'}
        </button>
      )}
      {busy && <p className="muted small" role="status">Unlocking and downloading your data…</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
