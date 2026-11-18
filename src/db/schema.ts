// The on-device database: IndexedDB, the browser's built-in database (works in every engine,
// including real Safari and Playwright's WebKit; OPFS + SQLite didn't, see docs/PROGRESS.md).
//
// Migrations are numbered: DB_VERSION goes up by one for each change, and upgrade() runs every step
// between the user's old version and the new one, in order. Never edit a step that has shipped:
// users' devices already ran it. Add a new one.
//
// Records are stored in one of two forms (docs/SECURITY.md):
// - Plain (a Deck, Note, Card ... as in src/types/study.ts): before the user sets up encryption,
//   and for milestone 2 data that setUp hasn't encrypted yet.
// - Sealed (the Sealed* types below): only the fields the indexes need stay readable; everything
//   else is in `enc`, AES-GCM encrypted with the data key. A record is sealed exactly when it has
//   an `enc` field.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EncryptedRecord } from '../types/crypto';
import type { Card, CardPhase, Deck, Note, ReviewRecord } from '../types/study';

export const DB_NAME = 'honed';
export const DB_VERSION = 2;

/**
 * One row of the change log: every write, in order, with the device that made it. v2's sync ships
 * these between devices (encrypted). `data` is the whole record after a put, null after a delete.
 */
export interface ChangeRecord {
  seq?: number; // local order, given by IndexedDB
  id: string;
  deviceId: string;
  at: string;
  entity: 'deck' | 'note' | 'card' | 'review';
  entityId: string;
  op: 'put' | 'delete';
  data: Deck | Note | Card | ReviewRecord | null;
}

export interface SealedDeck {
  id: string;
  enc: EncryptedRecord;
}
export interface SealedNote {
  id: string;
  deckId: string;
  enc: EncryptedRecord;
}
export interface SealedCard {
  id: string;
  noteId: string;
  deckId: string;
  suspended: boolean;
  position: number;
  phase: CardPhase; // copies of state.phase and state.due, readable for counts and future indexes
  due: string;
  enc: EncryptedRecord;
}
export interface SealedReview {
  id: string;
  cardId: string;
  reviewedAt: string;
  enc: EncryptedRecord;
}
export interface SealedChange {
  seq?: number;
  id: string;
  at: string;
  entity: ChangeRecord['entity'];
  entityId: string;
  op: ChangeRecord['op'];
  enc: EncryptedRecord;
}

export interface HonedSchema extends DBSchema {
  // deviceId (string), keyring (Keyring), keycheck (EncryptedRecord), migration ('running')
  meta: { key: string; value: { key: string; value: unknown } };
  decks: { key: string; value: Deck | SealedDeck };
  notes: { key: string; value: Note | SealedNote; indexes: { byDeck: string } };
  cards: { key: string; value: Card | SealedCard; indexes: { byDeck: string; byNote: string } };
  reviews: { key: string; value: ReviewRecord | SealedReview; indexes: { byCard: string; byTime: string } };
  changes: { key: number; value: ChangeRecord | SealedChange };
}

export type HonedDb = IDBPDatabase<HonedSchema>;
export type RecordStore = 'decks' | 'notes' | 'cards' | 'reviews' | 'changes';
export const RECORD_STORES: RecordStore[] = ['decks', 'notes', 'cards', 'reviews', 'changes'];

export async function openHonedDb(name: string = DB_NAME): Promise<HonedDb> {
  const db = await openDB<HonedSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Step 1 (Nov 18, 2026): the first schema
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'key' });
        db.createObjectStore('decks', { keyPath: 'id' });
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('byDeck', 'deckId');
        cards.createIndex('byNote', 'noteId');
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('byCard', 'cardId');
        reviews.createIndex('byTime', 'reviewedAt');
        db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
      }
      // Step 2 (Nov 18, 2026, #16): records may now be sealed (encrypted, with an `enc` field). No
      // stores change; the version goes up so that an old milestone 2 tab, which would read sealed
      // records as plain ones and write plain ones among them, can no longer open the database.
    },
  });
  // Another tab opened a newer version of the app: close, so its upgrade isn't blocked. This tab
  // then needs a reload, which the service worker's update brings anyway.
  db.addEventListener('versionchange', () => db.close());
  return db;
}
