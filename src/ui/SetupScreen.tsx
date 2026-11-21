// First run: explain, choose a passkey or a passphrase, save the recovery key, then encrypt any
// data already on this device with progress. Nothing is saved until the recovery
// key has been confirmed, so closing the page half-way just starts setup again. "Remember this device"
// (#99) is ticked unless the person unticks it: then Honed opens straight in from the next time.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { askToPersist } from '../backup/persist';
import { RestoreBackup } from '../backup/RestoreBackup';
import { APP_NAME } from '../brand';
import { recallKey, rememberKey } from '../lib/crypto';
import { createPasskey } from '../lib/passkey';
import { GOOGLE_SETUP_RETURN, GoogleUnlockError, JOIN_RETURN, accountStatus, signInUrl, turnOnGoogleUnlock } from '../sync/client';
import { fetchAccountKeyring, joinWithKey, type AccountKeyring } from '../sync/engine';
import { JoinUnlock } from '../sync/JoinUnlock';
import { makeKeys, passphraseProblem, unlockMessage, type NewKeys } from './keys';
import { guessDeviceLabel, NewPassphraseFields, RecoveryKeySheet, RememberField, usePrfSupported, useVault } from './lock-parts';
import { useStore } from './store-context';

type Step = 'intro' | 'passphrase' | 'passkey' | 'google' | 'join' | 'recovery' | 'saving' | 'restore';

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const vault = useVault();
  const store = useStore();
  const prf = usePrfSupported();
  const [step, setStep] = useState<Step>('intro');
  const [keys, setKeys] = useState<NewKeys | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [label, setLabel] = useState(() => guessDeviceLabel());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [rememberIt, setRememberIt] = useState(true);

  // Google unlock (#101): sign in with Google (leaving the page if not signed in yet), then the account's
  // key wraps the new data key. Back from Google, the page opens at GOOGLE_SETUP_RETURN and carries on.
  const chooseGoogle = async (back: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const account = await accountStatus();
      if (!account.signedIn) {
        if (back) throw new GoogleUnlockError('needs-sign-in', 'The Google sign-in didn’t finish. Try again.');
        window.location.assign(signInUrl(GOOGLE_SETUP_RETURN));
        return;
      }
      setKeys(await makeKeys({ method: 'google', googleKey: await turnOnGoogleUnlock(), email: account.email }));
      setStep('recovery');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    if (window.location.hash === GOOGLE_SETUP_RETURN.slice(1)) {
      resumed.current = true;
      setStep('google');
      void chooseGoogle(true);
    } else if (window.location.hash === JOIN_RETURN.slice(1)) {
      resumed.current = true;
      setStep('join');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choosePassphrase = async (e: FormEvent) => {
    e.preventDefault();
    const why = passphraseProblem(passphrase, repeat);
    if (why) return setProblem(why);
    setBusy(true);
    setProblem(null);
    try {
      setKeys(await makeKeys({ method: 'passphrase', passphrase }));
      setPassphrase('');
      setRepeat('');
      setStep('recovery');
    } catch (err) {
      setProblem(unlockMessage(err, 'passphrase'));
    } finally {
      setBusy(false);
    }
  };

  const choosePasskey = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const made = await createPasskey({ userName: `${APP_NAME} (${label.trim() || 'this device'})` });
      setKeys(await makeKeys({ method: 'passkey', passkey: { ...made, label: label.trim() || 'Passkey' } }));
      setStep('recovery');
    } catch (err) {
      setProblem(unlockMessage(err, 'passkey'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!keys) return;
    setStep('saving');
    setProblem(null);
    try {
      await vault.setUp(keys.keyring, keys.dataKey, (done, total) => setProgress({ done, total }));
      // From here on only a key that can't be read out of the page: the remembered one, or one from the keyring
      if (rememberIt) {
        const remembered = await rememberKey(keys.dataKey);
        vault.lock();
        await vault.unlock(await recallKey(remembered));
        await vault.remember(remembered);
      }
      setKeys(null);
      void askToPersist(); // right after setup, when browsers are likeliest to say yes
      onDone();
    } catch (err) {
      setProblem(`Setting up didn’t finish: ${err instanceof Error ? err.message : String(err)}. Reload to try again.`);
    }
  };

  return (
    <section className="setup" aria-labelledby="setup-title">
      <h2 id="setup-title">Lock your classes and slides</h2>

      {step === 'intro' && (
        <div className="stack">
          <p>
            {APP_NAME} encrypts your classes, slides and study history on this device. Only you can unlock them: not us, and not anyone else who
            uses this computer or finds a backup.
          </p>
          <p>Choose how you’ll unlock {APP_NAME} each time you open it.</p>
          {prf && (
            <button type="button" className="primary" onClick={() => setStep('passkey')}>
              Use a passkey
            </button>
          )}
          {prf && <p className="muted small">Face ID, Touch ID, Windows Hello or a security key. Nothing to remember.</p>}
          <button type="button" className={prf ? '' : 'primary'} onClick={() => setStep('passphrase')}>
            Use a passphrase
          </button>
          <button type="button" onClick={() => setStep('google')}>
            Use your Google account
          </button>
          <p className="muted small">Sign in with Google instead. The simplest, but our server could then read your data.</p>
          <button type="button" onClick={() => setStep('join')}>
            I already use {APP_NAME} on another device
          </button>
          <p className="muted small">Sign in with Google and bring your classes across (sync must be on on your other device).</p>
          <button type="button" className="link" onClick={() => setStep('restore')}>
            Moving from another device? Restore a backup
          </button>
        </div>
      )}

      {step === 'join' && <JoinAccount onDone={onDone} onBack={() => setStep('intro')} />}

      {step === 'restore' && (
        <RestoreBackup store={store} replacing={false} onRestored={onDone} onCancel={() => setStep('intro')} />
      )}

      {step === 'google' && (
        <div className="stack">
          <p>
            Unlock {APP_NAME} by signing in with Google: nothing to remember, and a new device needs only your Google account.
          </p>
          <p data-testid="google-unlock-warning">
            <strong>The cost:</strong> our server keeps a key that opens your data. So our server, or anyone who broke into it or into your Google account,
            could read your classes, slides and scores. With a passkey or passphrase, only you can.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void chooseGoogle(false)} disabled={busy}>
              {busy ? 'Making your keys…' : 'Continue with Google'}
            </button>
            <button type="button" onClick={() => setStep('intro')} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      {step === 'passphrase' && (
        <form className="stack" onSubmit={choosePassphrase}>
          <p>Pick a passphrase you’ll remember. You’ll type it each time you open {APP_NAME}.</p>
          <NewPassphraseFields passphrase={passphrase} repeat={repeat} onPassphrase={setPassphrase} onRepeat={setRepeat} />
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Making your keys…' : 'Continue'}
            </button>
            <button type="button" onClick={() => setStep('intro')} disabled={busy}>
              Back
            </button>
          </div>
        </form>
      )}

      {step === 'passkey' && (
        <form className="stack" onSubmit={choosePasskey}>
          <label htmlFor="passkey-label">Name this passkey</label>
          <input id="passkey-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          <p className="muted small">Shown in Settings, so you can tell your passkeys apart.</p>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Waiting for your passkey…' : 'Create passkey'}
            </button>
            <button type="button" onClick={() => setStep('intro')} disabled={busy}>
              Back
            </button>
          </div>
        </form>
      )}

      {step === 'recovery' && keys && (
        <>
          <RecoveryKeySheet recoveryKey={keys.recoveryKey} onSaved={save} saveLabel="I’ve saved it: lock my data" />
          <RememberField checked={rememberIt} onChange={setRememberIt} />
        </>
      )}

      {step === 'saving' && (
        <div className="stack" aria-live="polite">
          <p>Encrypting what’s already on this device…</p>
          {/* total is 0 on a fresh device: nothing to encrypt */}
          <progress max={Math.max(1, progress?.total ?? 1)} value={progress?.done ?? 0} aria-label="Encrypting" />
          {progress && progress.total > 0 && (
            <p className="muted small">
              {progress.done} of {progress.total}
            </p>
          )}
        </div>
      )}

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * Setting up by joining the account (#105): signed in with Google (if not, off to Google and back to
 * JOIN_RETURN), the account's keyring from the server, unlocked here, then everything downloaded.
 */
function JoinAccount({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const vault = useVault();
  const store = useStore();
  const [found, setFound] = useState<
    { state: 'checking' } | { state: 'signed-out' } | { state: 'empty'; email: string } | { state: 'ready'; email: string; account: AccountKeyring } | { state: 'problem'; message: string }
  >({ state: 'checking' });

  useEffect(() => {
    let live = true;
    (async () => {
      const me = await accountStatus();
      if (!me.signedIn) return live && setFound({ state: 'signed-out' });
      const account = await fetchAccountKeyring();
      if (!live) return;
      setFound(account ? { state: 'ready', email: me.email, account } : { state: 'empty', email: me.email });
    })().catch((err: unknown) => live && setFound({ state: 'problem', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="stack" data-testid="join-account">
      <p>Bring your classes, lectures, quizzes and notes from your other device. Slide PDFs come across in a later update.</p>
      {found.state === 'checking' && <p className="muted">Checking your account…</p>}
      {found.state === 'signed-out' && (
        <a className="button primary" href={signInUrl(JOIN_RETURN)}>
          Sign in with Google
        </a>
      )}
      {found.state === 'empty' && (
        <p role="status">
          {found.email} has no {APP_NAME} data on the server yet. On your other device, turn on sync (Settings, Sync), then try again.
        </p>
      )}
      {found.state === 'problem' && (
        <p className="error" role="alert">
          {found.message}
        </p>
      )}
      {found.state === 'ready' && (
        <JoinUnlock
          keyring={found.account.keyring}
          onOpened={async ({ key, remembered }) => {
            await joinWithKey(store, found.email, found.account, key);
            if (remembered) await vault.remember(remembered);
            onDone();
          }}
        />
      )}
      <div className="row">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
