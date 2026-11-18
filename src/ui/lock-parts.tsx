// Pieces shared by setup, unlock and Settings: passphrase fields with a strength hint, the recovery
// key sheet (copy, download, print, then type a group back), and "prove it's you" before a change.
import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { APP_NAME } from '../brand';
import { isRecoveryKey } from '../lib/crypto';
import { getPasskeySecret, isPrfSupported } from '../lib/passkey';
import type { Keyring } from '../types/crypto';
import {
  confirmsGroup,
  hasPassphrase,
  passkeyEntries,
  passphraseStrength,
  recoveryGroups,
  recoveryKeyFile,
  STRENGTH_TEXT,
  unlockForChange,
  unlockMessage,
} from './keys';
import type { Vault } from './vault';
import './lock.css';

// --- The vault for every screen ---

export const VaultContext = createContext<Vault | null>(null);

export function useVault(): Vault {
  const vault = useContext(VaultContext);
  if (!vault) throw new Error('useVault() outside <VaultContext>');
  return vault;
}

/** Whether passkeys with PRF can be offered here. False until known, and when it can't tell. */
export function usePrfSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(isPrfSupported)
      .then((yes) => live && setSupported(yes === true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return supported;
}

/** A first name for a new passkey, from the device; the user can change it. */
export function guessDeviceLabel(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android phone';
  if (/Windows/.test(userAgent)) return 'Windows computer';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  return 'This device';
}

// --- Passphrase fields ---

export function NewPassphraseFields({
  passphrase,
  repeat,
  onPassphrase,
  onRepeat,
  label = 'Passphrase',
}: {
  passphrase: string;
  repeat: string;
  onPassphrase: (value: string) => void;
  onRepeat: (value: string) => void;
  label?: string;
}) {
  const strength = passphraseStrength(passphrase);
  return (
    <div className="stack">
      <label htmlFor="new-passphrase">{label}</label>
      <input
        id="new-passphrase"
        type="password"
        autoComplete="new-password"
        value={passphrase}
        onChange={(e) => onPassphrase(e.target.value)}
        aria-describedby="passphrase-strength"
      />
      <p id="passphrase-strength" className={`small strength strength-${strength}`} aria-live="polite">
        {passphrase === '' ? 'A few unrelated words work well, e.g. “paper lantern river cobalt”.' : STRENGTH_TEXT[strength]}
      </p>
      <label htmlFor="repeat-passphrase">Type it again</label>
      <input
        id="repeat-passphrase"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={(e) => onRepeat(e.target.value)}
      />
    </div>
  );
}

// --- The recovery key sheet ---

/**
 * Shows a new recovery key once, with Copy, Download and Print, then asks for one group of it back
 * so we know it was saved. `onSaved` runs only after the right group is typed.
 */
export function RecoveryKeySheet({
  recoveryKey,
  onSaved,
  saveLabel = 'I’ve saved it',
  busy = false,
}: {
  recoveryKey: string;
  onSaved: () => void;
  saveLabel?: string;
  busy?: boolean;
}) {
  const groups = recoveryGroups(recoveryKey);
  const [group] = useState(() => 1 + (crypto.getRandomValues(new Uint8Array(1))[0]! % groups.length));
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const ok = confirmsGroup(recoveryKey, group, typed);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setNote('Copied. Paste it somewhere safe, like a password manager.');
    } catch {
      setNote('This browser wouldn’t copy. Download or write it down instead.');
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !busy) onSaved();
  };

  return (
    <div className="stack recovery">
      <div className="recovery-sheet">
        <p className="print-only">{APP_NAME} recovery key</p>
        <p className="recovery-key" data-testid="recovery-key" aria-label="Your recovery key">
          {groups.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </p>
        <p className="print-only small">
          It unlocks your {APP_NAME} data if you forget your passphrase or lose your passkey. If you lose it and
          your passphrase, nobody can get your data back.
        </p>
      </div>
      <p>
        <strong>Save this recovery key now.</strong> It’s the only way back in if you forget your passphrase or lose
        your passkey. It’s shown only this once. <strong>Without it and your passphrase, your classes and slides are gone</strong>:
        nobody, including us, can unlock them.
      </p>
      <div className="row">
        <button type="button" onClick={copy}>
          Copy
        </button>
        <button type="button" onClick={() => downloadText(`${APP_NAME}-recovery-key.txt`, recoveryKeyFile(APP_NAME, recoveryKey, new Date()))}>
          Download
        </button>
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {note && (
        <p className="muted small" aria-live="polite">
          {note}
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <label htmlFor="confirm-group">To check you have it, type group {group} of your recovery key</label>
        <input
          id="confirm-group"
          className="recovery-input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!ok || busy}>
          {busy ? 'Saving…' : saveLabel}
        </button>
      </form>
    </div>
  );
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- A recovery key field ---

/** A field for typing a recovery key, saying at once when it can't be right. */
export function RecoveryKeyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [wellFormed, setWellFormed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (value.replace(/[\s-]/g, '').length < 32) {
      setWellFormed(null);
    } else {
      isRecoveryKey(value).then(
        (yes) => live && setWellFormed(yes),
        () => live && setWellFormed(null),
      );
    }
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className="stack">
      <label htmlFor="recovery-key">Recovery key</label>
      <input
        id="recovery-key"
        className="recovery-input"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {wellFormed === false && (
        <p className="error small" aria-live="polite">
          That recovery key isn’t quite right: check for a typo.
        </p>
      )}
    </div>
  );
}

// --- Prove it's you ---

/**
 * Before a change in Settings: the current passphrase, a passkey, or the recovery key. Gives the
 * data key in a form that can be rewrapped, for that one change.
 */
export function ProveItsYou({
  keyring,
  why,
  onProved,
  onCancel,
}: {
  keyring: Keyring;
  why: string;
  onProved: (dataKey: CryptoKey) => void;
  onCancel: () => void;
}) {
  const prf = usePrfSupported();
  const passkeys = passkeyEntries(keyring);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>(hasPassphrase(keyring) ? 'passphrase' : 'recovery');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const attempt = async (run: () => Promise<CryptoKey>, method: 'passphrase' | 'recovery' | 'passkey') => {
    setBusy(true);
    setProblem(null);
    try {
      onProved(await run());
    } catch (err) {
      setProblem(unlockMessage(err, method));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || secret.trim() === '') return;
    void attempt(
      () =>
        unlockForChange(
          keyring,
          mode === 'passphrase' ? { method: 'passphrase', passphrase: secret } : { method: 'recovery', recoveryKey: secret },
        ),
      mode,
    );
  };

  const usePasskey = () =>
    attempt(async () => {
      const got = await getPasskeySecret(passkeys.map((p) => ({ credentialId: p.credentialId, prfSalt: p.prfSalt })));
      return unlockForChange(keyring, { method: 'passkey', ...got });
    }, 'passkey');

  return (
    <div className="stack prove" role="group" aria-labelledby="prove-title">
      <h3 id="prove-title">First, prove it’s you</h3>
      <p className="muted small">{why}</p>
      {prf && passkeys.length > 0 && (
        <button type="button" onClick={usePasskey} disabled={busy}>
          Use a passkey
        </button>
      )}
      <form className="stack" onSubmit={submit}>
        {mode === 'passphrase' ? (
          <>
            <label htmlFor="current-passphrase">Current passphrase</label>
            <input
              id="current-passphrase"
              type="password"
              autoComplete="current-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </>
        ) : (
          <RecoveryKeyField value={secret} onChange={setSecret} />
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={busy || secret.trim() === ''}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
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
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
