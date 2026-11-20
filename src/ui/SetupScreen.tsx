// First run: explain, choose a passkey or a passphrase, save the recovery key, then encrypt any
// data already on this device with progress. Nothing is saved until the recovery
// key has been confirmed, so closing the page half-way just starts setup again. "Remember this device"
// (#99) is ticked unless the person unticks it: then Honed opens straight in from the next time.
import { useState, type FormEvent } from 'react';
import { askToPersist } from '../backup/persist';
import { RestoreBackup } from '../backup/RestoreBackup';
import { APP_NAME } from '../brand';
import { recallKey, rememberKey } from '../lib/crypto';
import { createPasskey } from '../lib/passkey';
import { makeKeys, passphraseProblem, unlockMessage, type NewKeys } from './keys';
import { guessDeviceLabel, NewPassphraseFields, RecoveryKeySheet, RememberField, usePrfSupported, useVault } from './lock-parts';
import { useStore } from './store-context';

type Step = 'intro' | 'passphrase' | 'passkey' | 'recovery' | 'saving' | 'restore';

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
          <button type="button" className="link" onClick={() => setStep('restore')}>
            Moving from another device? Restore a backup
          </button>
        </div>
      )}

      {step === 'restore' && (
        <RestoreBackup store={store} replacing={false} onRestored={onDone} onCancel={() => setStep('intro')} />
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
