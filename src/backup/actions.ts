// Backup actions shared by Settings and the reminder banner: make a backup and hand it over
// (download, share, or the folder), and remember when it was made. Anything that changes the backup
// state calls notify(), so every screen showing it reloads.
import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../brand';
import { makeBackup, type BackupStore } from './backup';
import { writeToFolder, type Folder } from './folder';
import { backupFileName } from './format';
import { loadBackupState, saveLastBackup, type BackupState } from './state';

const listeners = new Set<() => void>();
export function notifyBackupChanged() {
  for (const listener of listeners) listener();
}

/** The backup state, reloaded whenever it changes anywhere in the app. Null while loading. */
export function useBackupState(): { state: BackupState | null; reload: () => void } {
  const [state, setState] = useState<BackupState | null>(null);
  const reload = useCallback(() => {
    loadBackupState(new Date()).then(setState, () => {});
  }, []);
  useEffect(() => {
    reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  return { state, reload };
}

export type Delivery = 'download' | 'share' | 'folder';

/** Makes a backup now and delivers it. Returns false if the user cancelled a share. */
export async function backUpNow(store: BackupStore, how: Delivery, folder?: FileSystemDirectoryHandle | null): Promise<boolean> {
  const now = new Date();
  const { text, upTo } = await makeBackup(store, now);
  const name = backupFileName(APP_NAME, now);
  if (how === 'folder') {
    if (!folder) throw new Error('No folder chosen.');
    await writeToFolder(folder as unknown as Folder, name, text, APP_NAME);
  } else if (how === 'share') {
    try {
      await navigator.share({ files: [backupAsFile(name, text)], title: `${APP_NAME} backup` });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return false;
      throw err;
    }
  } else {
    downloadFile(name, text);
  }
  await saveLastBackup({ at: now.toISOString(), upTo });
  notifyBackupChanged();
  return true;
}

function backupAsFile(name: string, text: string): File {
  return new File([text], name, { type: 'application/json' });
}

/** Whether this browser can share a backup file (most phones). */
export function canShareBackup(): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [backupAsFile('a.honed', '{}')] }) === true;
  } catch {
    return false;
  }
}

/** Phones and tablets share; computers download. */
export function preferredDelivery(): Delivery {
  return /Android|iPhone|iPad|Mobile/.test(navigator.userAgent) && canShareBackup() ? 'share' : 'download';
}

export function downloadFile(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "today", "yesterday", "9 days ago" */
export function ago(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
