// Automatic backups to a folder the user picks once (the File System Access API: Chrome and Edge on
// a computer). After study, at most once an hour, and only when something changed, a new backup is
// written and all but the newest few are deleted. Elsewhere, a gentle reminder instead.
import { BACKUP_EXTENSION } from './format';

export const KEEP_BACKUPS = 5;
export const AUTO_GAP_MS = 60 * 60 * 1000; // at most once an hour
export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // a week

/** The parts of a folder handle we use (so tests can pass a fake). */
export interface Folder {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableLike> }>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}
interface WritableLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/** Whether this browser can back up to a folder: a computer with showDirectoryPicker. */
export function canUseFolder(win: unknown = globalThis.window, userAgent: string = globalThis.navigator?.userAgent ?? ''): boolean {
  return typeof (win as { showDirectoryPicker?: unknown } | undefined)?.showDirectoryPicker === 'function' && !/Android|iPhone|iPad|Mobile/.test(userAgent);
}

/** Asks the user for a folder. Null if they cancel. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (globalThis.window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  try {
    return await picker({ id: 'honed-backups', mode: 'readwrite', startIn: 'documents' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

type Permissioned = { queryPermission?(o: object): Promise<PermissionState>; requestPermission?(o: object): Promise<PermissionState> };

/** Whether we may still write to the folder (browsers forget after a while). */
export async function folderAllowed(folder: FileSystemDirectoryHandle): Promise<boolean> {
  const handle = folder as unknown as Permissioned;
  try {
    return (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Asks again (needs a click). */
export async function allowFolderAgain(folder: FileSystemDirectoryHandle): Promise<boolean> {
  const handle = folder as unknown as Permissioned;
  try {
    return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Writes the backup into the folder, then keeps only the newest `keep` of this app's backups. */
export async function writeToFolder(folder: Folder, fileName: string, text: string, appName: string, keep = KEEP_BACKUPS): Promise<void> {
  const file = await folder.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();

  const ours: string[] = [];
  for await (const name of folder.keys()) if (isOurBackup(name, appName)) ours.push(name);
  ours.sort(); // the names sort by time (backupFileName)
  for (const old of ours.slice(0, Math.max(0, ours.length - keep))) await folder.removeEntry(old);
}

function isOurBackup(name: string, appName: string): boolean {
  return name.startsWith(`${appName}-backup-`) && name.endsWith(BACKUP_EXTENSION);
}

interface Timing {
  now: Date;
  lastAt: string | null; // the last backup, if any
  since: string; // when this device started counting
  lastUpTo: number; // the change the last backup went up to (0 if none)
  latest: number; // the newest change now
}

/** An automatic folder backup is due: something changed, and the last one was over an hour ago. */
export function autoBackupDue({ now, lastAt, lastUpTo, latest }: Omit<Timing, 'since'>): boolean {
  if (latest <= lastUpTo) return false;
  return lastAt === null || now.getTime() - Date.parse(lastAt) >= AUTO_GAP_MS;
}

/** The reminder shows: something isn't backed up, and the last backup (or the start) is over a week old. */
export function reminderDue({ now, lastAt, since, lastUpTo, latest }: Timing): boolean {
  if (latest <= lastUpTo) return false;
  return now.getTime() - Date.parse(lastAt ?? since) > REMIND_AFTER_MS;
}
