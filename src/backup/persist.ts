// Persistent storage: ask the browser to keep the database instead of clearing it when space runs
// low. Asked right after setup or a restore (asking on a first visit tends to be refused).

/** Asks the browser to keep this site's data. True if it will. Never throws. */
export async function askToPersist(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<boolean> {
  try {
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export interface StorageState {
  /** null when the browser can't say. */
  persisted: boolean | null;
  usage: number | null; // bytes
}

export async function storageState(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<StorageState> {
  let persisted: boolean | null = null;
  let usage: number | null = null;
  try {
    if (storage?.persisted) persisted = await storage.persisted();
  } catch {
    /* unknown */
  }
  try {
    if (storage?.estimate) usage = (await storage.estimate()).usage ?? null;
  } catch {
    /* unknown */
  }
  return { persisted, usage };
}

/** On an iPhone or iPad in Safari's tabs (not from the Home Screen), where Safari clears data sooner. */
export function shouldSuggestHomeScreen(userAgent: string, standalone: boolean): boolean {
  const apple = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile\//.test(userAgent));
  return apple && !standalone;
}

/** Whether the app is running from the Home Screen or as an installed app. */
export function isStandalone(): boolean {
  const nav = globalThis.navigator as Navigator & { standalone?: boolean };
  return nav?.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** "1.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
