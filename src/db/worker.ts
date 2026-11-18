// The database worker. SQLite (WebAssembly) runs here, off the page's thread, storing its file in
// the browser's private file system (OPFS) through the "opfs-sahpool" mode, which needs no special
// cross-origin headers. Only this worker touches the database; the page talks to it through
// src/db/client.ts.
//
// SPIKE (issue #6): proves the storage works in Chromium and WebKit. The real schema and the
// StudyStore methods replace `spike` below.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

export interface WorkerRequest {
  id: number;
  method: string;
  args: unknown[];
}
export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

// One database file per origin. Changing these names would orphan existing users' data.
const POOL = { name: 'honed-pool', directory: '/honed-pool' };
const FILE = '/honed.sqlite3';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs(POOL);
  const db = new pool.OpfsSAHPoolDb(FILE);
  return { sqlite3, db };
})();

const methods: Record<string, (...args: never[]) => Promise<unknown>> = {
  async info() {
    const { sqlite3, db } = await ready;
    return { sqlite: sqlite3.version.libVersion, file: db.filename, vfs: 'opfs-sahpool' };
  },
  async spike() {
    const { db } = await ready;
    db.exec('CREATE TABLE IF NOT EXISTS spike (n INTEGER)');
    db.exec('INSERT INTO spike VALUES (1)');
    return db.selectValue('SELECT count(*) FROM spike');
  },
};

// A worker's global scope; typed by hand because the DOM and WebWorker type libraries clash.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`unknown method ${method}`);
    scope.postMessage({ id, ok: true, value: await fn(...(args as never[])) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
