// The on-device database: IndexedDB, the browser's built-in database (works in every engine,
// including real Safari and Playwright's WebKit; OPFS + SQLite didn't, see docs/PROGRESS.md).
//
// Migrations are numbered: DB_VERSION goes up by one for each change, and upgrade() runs every step
// between the user's old version and the new one, in order. Never edit a step that has shipped:
// users' devices already ran it. Add a new one.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Card, Deck, Note, ReviewRecord } from '../types/study';

export const DB_NAME = 'honed';
export const DB_VERSION = 1;

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

export interface HonedSchema extends DBSchema {
  meta: { key: string; value: { key: string; value: string } };
  decks: { key: string; value: Deck };
  notes: { key: string; value: Note; indexes: { byDeck: string } };
  cards: { key: string; value: Card; indexes: { byDeck: string; byNote: string } };
  reviews: { key: string; value: ReviewRecord; indexes: { byCard: string; byTime: string } };
  changes: { key: number; value: ChangeRecord };
}

export type HonedDb = IDBPDatabase<HonedSchema>;

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
    },
  });
  // Another tab opened a newer version of the app: close, so its upgrade isn't blocked. This tab
  // then needs a reload, which the service worker's update brings anyway.
  db.addEventListener('versionchange', () => db.close());
  return db;
}
