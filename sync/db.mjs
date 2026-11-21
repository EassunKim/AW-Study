// The sync server's data (#95): one SQLite file, sync.db, in the data folder, through Node's own
// node:sqlite. Numbered schema steps (PRAGMA user_version): never edit a step that has shipped, add one.
//
// Step 1: accounts and sessions. Step 2: Google unlock keys and when they were used. What's readable here is exactly docs/SECURITY.md's "What the sync
// server holds": the Google account id and email, and sessions as SHA-256 hashes, never the tokens.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const STEPS = [
  // Step 1 (Nov 20, 2026, #95)
  `CREATE TABLE accounts (
     id          TEXT PRIMARY KEY,              -- our own random id
     google_sub  TEXT NOT NULL UNIQUE,          -- Google's id for the account (never the email: emails change hands)
     email       TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     signed_in_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     id          TEXT PRIMARY KEY,              -- a random id to name it in the devices list
     hash        TEXT NOT NULL UNIQUE,          -- SHA-256 of the cookie's token, base64url
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device      TEXT NOT NULL,                 -- "Chrome on Windows", from the browser
     created_at  TEXT NOT NULL,
     used_at     TEXT NOT NULL,
     signed_in_at TEXT NOT NULL                 -- the Google sign-in behind it (deleting the account needs a recent one)
   );
   CREATE INDEX sessions_account ON sessions(account_id);`,
  // Step 2 (Nov 20, 2026, #101): Google unlock (docs/SECURITY.md "Google unlock"), opt-in per account. The key
  // opens that account's data: it's only ever given to a session with a fresh Google sign-in, and each time
  // is recorded (never the key itself).
  `CREATE TABLE unlock_keys (
     account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     key         BLOB NOT NULL,                 -- 32 random bytes
     created_at  TEXT NOT NULL
   );
   CREATE TABLE unlock_uses (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device      TEXT NOT NULL,
     at          TEXT NOT NULL
   );
   CREATE INDEX unlock_uses_account ON unlock_uses(account_id, at);`,
];

/** Opens (and if needed creates or upgrades) the database in `dir`, or in memory for ':memory:'. */
export function openDb(dir) {
  const db = new DatabaseSync(dir === ':memory:' ? ':memory:' : join(dir, 'sync.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > STEPS.length) {
    db.close();
    throw new Error(`sync.db is from a newer version (schema step ${version}); update the app`);
  }
  for (let step = version; step < STEPS.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(STEPS[step]);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

export const SCHEMA_STEP = STEPS.length;
