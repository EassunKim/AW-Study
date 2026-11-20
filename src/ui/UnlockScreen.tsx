// When the app opens locked: first this device's remembered unlock (#99), if it has one, which opens
// straight in; if that fails it's forgotten and the screen asks as usual. Asking means a passkey button
// (when this browser can use one and one is set up), the passphrase, or "Use your recovery key", with
// "Remember this device" ticked unless the person unticks it. After a recovery, the user sets a new
// passphrase before going on, since the old one is presumably forgotten.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { APP_NAME } from '../brand';
import { recallKey, rememberKey, wrapWithPassphrase } from '../lib/crypto';
import { getPasskeySecret } from '../lib/passkey';
import { setActivity } from './update';
import type { Keyring, UnlockSecret } from '../types/crypto';
import { hasPassphrase, openKey, passkeyEntries, passphraseProblem, unlockForChange, unlockMessage, unlockWith } from './keys';
import { NewPassphraseFields, RecoveryKeyField, RememberField, usePrfSupported, useVault } from './lock-parts';
import { useLoad } from './useLoad';

type Mode = 'passphrase' | 'recovery' | 'new-passphrase';

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const vault = useVault();
  const { data: keyring, error } = useLoad(() => vault.getKeyring(), [vault]);
  // 'trying' while a remembered unlock is tried; then 'ask' (with a note if one was there and failed)
  const [remembered, setRemembered] = useState<'trying' | 'ask' | 'failed'>('trying');
  const unlocked = useRef(onUnlocked); // tried once per opening, whatever the parent re-renders
  unlocked.current = onUnlocked;

  useEffect(() => {
    let live = true;
    (async () => {
      const saved = await vault.getRemembered();
      if (!saved) return live && setRemembered('ask');
      setActivity('unlocking');
      try {
        await vault.unlock(await recallKey(saved));
        if (live) unlocked.current();
      } catch {
        // Damaged, or for another key (say the data was restored from a backup elsewhere): forget it, ask
        await vault.forget();
        setActivity('locked');
        if (live) setRemembered('failed');
      }
    })().catch(() => live && setRemembered('ask'));
    return () => {
      live = false;
    };
  }, [vault]);

  if (error) return <p className="error">{error}</p>;
  if (keyring === undefined || remembered === 'trying') return <p className="muted">Opening…</p>;
  if (keyring === null) return <p className="error">This device isn’t set up yet. Reload the page.</p>;
  return <Unlock keyring={keyring} onUnlocked={onUnlocked} rememberFailed={remembered === 'failed'} />;
}

function Unlock({ keyring, onUnlocked, rememberFailed }: { keyring: Keyring; onUnlocked: () => void; rememberFailed: boolean }) {
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
  const [rememberIt, setRememberIt] = useState(true);

  const open = async (secretFor: () => Promise<UnlockSecret>, method: UnlockSecret['method']) => {
    setBusy(true);
    setProblem(null);
    setActivity('unlocking'); // a new version waits until this is done
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
      const { key, remembered } = await openKey(keyring, given, rememberIt);
      await vault.unlock(key);
      if (remembered) await vault.remember(remembered);
      onUnlocked();
    } catch (err) {
      setProblem(unlockMessage(err, method));
      setBusy(false);
      setActivity('locked');
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
      const remembered = rememberIt ? await rememberKey(changeKey) : null;
      vault.lock();
      await vault.unlock(remembered ? await recallKey(remembered) : await unlockWith(keyring, recovery));
      if (remembered) await vault.remember(remembered);
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
          <RememberField checked={rememberIt} onChange={setRememberIt} />
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
      <p className="muted">Your classes and slides are encrypted on this device.</p>
      {rememberFailed && (
        <p role="status" data-testid="remember-failed">
          This device’s remembered unlock didn’t work any more, so it was forgotten. Unlock once to remember it again.
        </p>
      )}
      <RememberField checked={rememberIt} onChange={setRememberIt} />
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
