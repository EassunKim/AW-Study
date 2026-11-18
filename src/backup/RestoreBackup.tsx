// Restoring a backup: pick the `.honed` file, unlock it with its own passphrase, passkey or recovery
// key, see what's in it, then confirm replacing this device's data. Nothing here changes until that
// last step, and the store replaces everything in one transaction.
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { APP_NAME } from '../brand';
import { getPasskeySecret } from '../lib/passkey';
import type { UnlockSecret } from '../types/crypto';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { hasPassphrase, passkeyEntries, unlockMessage, unlockWith } from '../ui/keys';
import { RecoveryKeyField, usePrfSupported } from '../ui/lock-parts';
import { messageOf } from '../ui/useLoad';
import { notifyBackupChanged } from './actions';
import { describeCounts, openBackup, restoreBackup, type BackupStore, type BackupSummary } from './backup';
import { BACKUP_EXTENSION, decodeBackup, type Backup } from './format';
import { askToPersist } from './persist';
import { saveLastBackup } from './state';

export function RestoreBackup({
  store,
  replacing,
  onRestored,
  onCancel,
}: {
  store: BackupStore;
  /** True when this device already has data that the backup will replace. */
  replacing: boolean;
  onRestored: () => void;
  onCancel: () => void;
}) {
  const prf = usePrfSupported();
  const [backup, setBackup] = useState<Backup | null>(null);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [opened, setOpened] = useState<{ key: CryptoKey; summary: BackupSummary } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const keyring = backup?.snapshot.keyring;
  const passkeys = keyring ? passkeyEntries(keyring) : [];

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setBackup(null);
    setOpened(null);
    setProblem(null);
    if (!file) return;
    try {
      const read = decodeBackup(await file.text());
      setBackup(read);
      setMode(hasPassphrase(read.snapshot.keyring) ? 'passphrase' : 'recovery');
    } catch (err) {
      setProblem(messageOf(err));
    }
  };

  const unlock = async (secretFor: () => Promise<UnlockSecret>, method: UnlockSecret['method']) => {
    if (!keyring || !backup) return;
    setBusy(true);
    setProblem(null);
    try {
      const key = await unlockWith(keyring, await secretFor());
      setOpened({ key, summary: await openBackup(backup, key) });
    } catch (err) {
      setProblem(err instanceof Error && err.name === 'BackupError' ? err.message : unlockMessage(err, method));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || secret.trim() === '') return;
    void unlock(async () => (mode === 'recovery' ? { method: 'recovery', recoveryKey: secret } : { method: 'passphrase', passphrase: secret }), mode);
  };

  const usePasskey = () =>
    unlock(async () => {
      const got = await getPasskeySecret(passkeys.map((p) => ({ credentialId: p.credentialId, prfSalt: p.prfSalt })));
      return { method: 'passkey', ...got };
    }, 'passkey');

  const restore = async () => {
    if (!backup || !opened) return;
    setConfirming(false);
    setBusy(true);
    setProblem(null);
    try {
      await restoreBackup(store, backup.snapshot, opened.key);
      await saveLastBackup({ at: backup.createdAt, upTo: await store.latestChange() });
      notifyBackupChanged();
      void askToPersist();
      onRestored();
    } catch (err) {
      setProblem(messageOf(err));
      setBusy(false);
    }
  };

  const when = backup ? new Date(backup.createdAt).toLocaleString() : '';

  return (
    <div className="stack restore" role="group" aria-labelledby="restore-title">
      <h3 id="restore-title">Restore from a backup</h3>

      {!opened && (
        <>
          <label htmlFor="backup-file">Backup file ({BACKUP_EXTENSION})</label>
          <input id="backup-file" type="file" accept={`${BACKUP_EXTENSION},application/json`} onChange={pick} disabled={busy} />
        </>
      )}

      {backup && !opened && (
        <form className="stack" onSubmit={submit}>
          <p>
            Backup made <strong>{when}</strong>. Unlock it with the passphrase, passkey or recovery key you had then.
          </p>
          {prf && passkeys.length > 0 && (
            <button type="button" onClick={usePasskey} disabled={busy}>
              Use a passkey
            </button>
          )}
          {mode === 'passphrase' ? (
            <>
              <label htmlFor="backup-passphrase">The backup’s passphrase</label>
              <input
                id="backup-passphrase"
                type="password"
                autoComplete="current-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </>
          ) : (
            <RecoveryKeyField value={secret} onChange={setSecret} />
          )}
          <button type="submit" className="primary" disabled={busy || secret.trim() === ''}>
            {busy ? 'Opening…' : 'Open backup'}
          </button>
          {hasPassphrase(backup.snapshot.keyring) && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setMode(mode === 'passphrase' ? 'recovery' : 'passphrase');
                setSecret('');
                setProblem(null);
              }}
            >
              {mode === 'passphrase' ? 'Use the recovery key instead' : 'Use the passphrase instead'}
            </button>
          )}
        </form>
      )}

      {opened && (
        <div className="stack">
          <p data-testid="backup-summary">
            The backup from <strong>{when}</strong> holds {describeCounts(opened.summary.counts)}.
          </p>
          <p className="muted small">
            {replacing
              ? `Restoring replaces everything on this device with it. From then on, you unlock ${APP_NAME} with the backup’s passphrase, passkeys and recovery key.`
              : `From then on, you unlock ${APP_NAME} with the backup’s passphrase, passkeys and recovery key.`}
          </p>
          <button type="button" className="primary" onClick={() => setConfirming(true)} disabled={busy}>
            {busy ? 'Restoring…' : 'Restore this backup'}
          </button>
        </div>
      )}

      <button type="button" onClick={onCancel} disabled={busy}>
        Cancel
      </button>

      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title={replacing ? 'Replace this device’s data?' : 'Restore this backup?'}
          message={
            replacing
              ? `Everything ${APP_NAME} has on this device is replaced by the backup from ${when}. This can’t be undone.`
              : `${APP_NAME} on this device will hold the backup from ${when}.`
          }
          confirmLabel={replacing ? 'Replace with the backup' : 'Restore'}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void restore()}
        />
      )}
    </div>
  );
}
