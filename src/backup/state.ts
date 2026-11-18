// What backups remember between visits: when the last one was made (and up to which change), when
// we started counting, and the folder chosen for automatic backups. Its own small database, apart
// from the encrypted one: none of this is private (a folder handle only works with the browser's
// permission), and a restore must not overwrite it.
import { openDB, type IDBPDatabase } from 'idb';

export const STATE_DB = 'honed-backup-state';

export interface LastBackup {
  at: string; // ISO time
  upTo: number; // the newest change it holds (StudyStore.latestChange)
}

export interface BackupState {
  last: LastBackup | null;
  /** When this device started keeping track: the reminder counts from here until the first backup. */
  since: string;
  folder: FileSystemDirectoryHandle | null;
}

type Kv = { key: 'last' | 'since' | 'folder'; value: unknown };

let opening: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  opening ??= openDB(STATE_DB, 1, {
    upgrade(database) {
      database.createObjectStore('kv', { keyPath: 'key' });
    },
  });
  return opening;
}

export async function loadBackupState(now: Date): Promise<BackupState> {
  const d = await db();
  const get = async (key: Kv['key']) => ((await d.get('kv', key)) as Kv | undefined)?.value;
  let since = (await get('since')) as string | undefined;
  if (!since) {
    since = now.toISOString();
    await d.put('kv', { key: 'since', value: since });
  }
  return {
    last: ((await get('last')) as LastBackup | undefined) ?? null,
    since,
    folder: ((await get('folder')) as FileSystemDirectoryHandle | undefined) ?? null,
  };
}

export async function saveLastBackup(last: LastBackup): Promise<void> {
  await (await db()).put('kv', { key: 'last', value: last });
}

export async function saveFolder(folder: FileSystemDirectoryHandle | null): Promise<void> {
  const d = await db();
  if (folder) await d.put('kv', { key: 'folder', value: folder });
  else await d.delete('kv', 'folder');
}
