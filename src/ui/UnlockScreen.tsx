// Each time the app opens: a passkey button (when this browser can use one and one is set up), the
// passphrase, or "Use your recovery key". After a recovery, the user sets a new passphrase before
// going on, since the old one is presumably forgotten.
import { useState, type FormEvent } from 'react';
import { APP_NAME } from '../brand';
import { wrapWithPassphrase } from '../lib/crypto';
import { getPasskeySecret } from '../lib/passkey';
import type { Keyring, UnlockSecret } from '../types/crypto';
import { hasPassphrase, passkeyEntries, passphraseProblem, unlockForChange, unlockMessage, unlockWith } from './keys';
import { NewPassphraseFields, RecoveryKeyField, usePrfSupported, useVault } from './lock-parts';
import { useLoad } from './useLoad';

type Mode = 'passphrase' | 'recovery' | 'new-passphrase';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const vault = useVault();
  const { data: keyring, error } = useLoad(() => vault.getKeyring(), [vault]);
  if (error) return <p className="error">{error}</p>;
  if (keyring === undefined) return <p className="muted">Loading…</p>;
  if (keyring === null) return <p className="error">This device isn’t set up yet. Reload the page.</p>;
  return <Unlock keyring={keyring} onUnlocked={onUnlocked} />;
}

function Unlock({ keyring, onUnlocked }: { keyring: Keyring; onUnlocked: () => void }) {
  const vault = useVault();
  const prf = usePrfSupported();
  const passkeys = passkeyEntries(keyring);
  const [mode, setMode] = useState<Mode>(hasPassphrase(keyring) ? 'passphrase' : 'recovery');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = async (secretFor: () => Promise<UnlockSecret>, method: UnlockSecret['method']) => {
    setBusy(true);
    setProblem(null);
    try {
      const given = await secretFor();
      if (given.method === 'recovery') {
        // Prove the key works now, then ask for a new passphrase before opening
        await unlockWith(keyring, given);
        setRecoveryKey(given.recoveryKey);
        setMode('new-passphrase');
        setBusy(false);
        return;
      }
      await vault.unlock(await unlockWith(keyring, given));
      onUnlocked();
    } catch (err) {
      setProblem(unlockMessage(err, method));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || secret.trim() === '') return;
    const method = mode === 'recovery' ? 'recovery' : 'passphrase';
    void open(
      async () =>
        method === 'recovery' ? { method, recoveryKey: secret } : { method, passphrase: secret },
      method,
    );
  };

  const usePasskey = () =>
    open(async () => {
      const got = await getPasskeySecret(passkeys.map((p) => ({ credentialId: p.credentialId, prfSalt: p.prfSalt })));
      return { method: 'passkey', ...got };
    }, 'passkey');

  const setNewPassphrase = async (e: FormEvent) => {
    e.preventDefault();
    const why = passphraseProblem(passphrase, repeat);
    if (why) return setProblem(why);
    setBusy(true);
    setProblem(null);
    try {
      const recovery = { method: 'recovery', recoveryKey } as const;
      const changeKey = await unlockForChange(keyring, recovery);
      await vault.unlock(changeKey);
      await vault.replaceKeyringEntries('passphrase', await wrapWithPassphrase(changeKey, passphrase));
      // Day to day, only a key that can't be read out of the page
      vault.lock();
      await vault.unlock(await unlockWith(keyring, recovery));
      onUnlocked();
    } catch (err) {
      setProblem(unlockMessage(err, 'recovery'));
      setBusy(false);
    }
  };

  if (mode === 'new-passphrase') {
    return (
      <section className="unlock" aria-labelledby="unlock-title">
        <h2 id="unlock-title">Set a new passphrase</h2>
        <form className="stack" onSubmit={setNewPassphrase}>
          <p>Your recovery key worked. Choose a new passphrase for opening {APP_NAME} from now on.</p>
          <NewPassphraseFields
            label="New passphrase"
            passphrase={passphrase}
            repeat={repeat}
            onPassphrase={setPassphrase}
            onRepeat={setRepeat}
          />
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save and open'}
          </button>
        </form>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="unlock" aria-labelledby="unlock-title">
      <h2 id="unlock-title">Unlock {APP_NAME}</h2>
      <p className="muted">Your cards are encrypted on this device.</p>
      {prf && passkeys.length > 0 && (
        <button type="button" className="primary" onClick={usePasskey} disabled={busy}>
          Unlock with a passkey
        </button>
      )}
      <form className="stack" onSubmit={submit}>
        {mode === 'passphrase' ? (
          <>
            <label htmlFor="unlock-passphrase">Passphrase</label>
            <input
              id="unlock-passphrase"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </>
        ) : (
          <RecoveryKeyField value={secret} onChange={setSecret} />
        )}
        <button type="submit" className={prf && passkeys.length > 0 ? '' : 'primary'} disabled={busy || secret.trim() === ''}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      <button
        type="button"
        className="link"
        onClick={() => {
          setMode(mode === 'recovery' ? 'passphrase' : 'recovery');
          setSecret('');
          setProblem(null);
        }}
        hidden={mode === 'recovery' && !hasPassphrase(keyring)}
      >
        {mode === 'recovery' ? 'Use your passphrase instead' : 'Use your recovery key'}
      </button>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
