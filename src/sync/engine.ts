// The sync engine (#105, docs/SECURITY.md "Accounts and sync"): talks to the sync server at /api/ and moves
// sealed changes between it and the store. It never sees the data key: sealing and opening are the store's.
//
// One round (`syncOnce`): the keyring (take the account's newer one, or send this device's change), send this
// device's own changes since the last round, then fetch and apply everything after the last number applied.
// Turning sync on (`startSync`) is the first round for this device: the first device of the account sends its
// keyring, key check and current state; a device with the same key just joins in; a device whose data was made
// under another key has to replace it with the account's (`joinWithKey`), which the screens ask about first.
import type { ChangeRecord } from '../db/schema';
import type { StudyStore } from '../db/store';
import type { SyncState, WireChange } from '../db/sync';
import { fromBase64Url, toBase64Url } from '../backup/format';
import type { EncryptedRecord, Keyring } from '../types/crypto';

export const PUSH_BATCH = 200;

export class SyncError extends Error {
  constructor(
    readonly code: 'signed-out' | 'offline' | 'different-key' | 'no-account-data' | 'server' | 'full',
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

type Fetch = typeof fetch;

// --- Bytes in JSON, as backups write them ---

const encode = (value: unknown): string => JSON.stringify(value, (_k, v: unknown) => (v instanceof Uint8Array ? { $bytes: toBase64Url(v) } : v));
const decode = <T>(value: unknown): T =>
  JSON.parse(JSON.stringify(value), (_k, v: unknown) =>
    typeof v === 'object' && v !== null && Object.keys(v).length === 1 && typeof (v as { $bytes?: unknown }).$bytes === 'string'
      ? fromBase64Url((v as { $bytes: string }).$bytes)
      : v,
  ) as T;

// --- The server ---

async function call(fetcher: Fetch, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(path, { cache: 'no-store', ...init });
  } catch {
    throw new SyncError('offline', 'Couldn’t reach the sync server. Are you offline?');
  }
  if (res.status === 401) throw new SyncError('signed-out', 'Sign in with Google to sync (Settings, Account).');
  return res;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface AccountKeyring {
  version: number;
  keyring: Keyring;
  keycheck: EncryptedRecord;
}

/** The account's keyring on the server, or null if no device has synced yet. */
export async function fetchAccountKeyring(fetcher: Fetch = fetch): Promise<AccountKeyring | null> {
  const res = await call(fetcher, '/api/keyring', { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError('server', 'The sync server didn’t answer properly. Try again.');
  const body = (await res.json()) as { version: number; keyring: unknown; keycheck: unknown };
  return { version: body.version, keyring: decode<Keyring>(body.keyring), keycheck: decode<EncryptedRecord>(body.keycheck) };
}

async function putKeyring(fetcher: Fetch, version: number, keyring: Keyring, keycheck: EncryptedRecord): Promise<number | 'stale' | 'different-key'> {
  const res = await call(fetcher, '/api/keyring', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: `{"version":${version},"keyring":${encode(keyring)},"keycheck":${encode(keycheck)}}`,
  });
  if (res.status === 409) return 'stale';
  if (res.status === 422) return 'different-key';
  if (!res.ok) throw new SyncError('server', 'The sync server didn’t take the keyring. Try again.');
  return ((await res.json()) as { version: number }).version;
}

async function pushChanges(fetcher: Fetch, wire: WireChange[]): Promise<void> {
  for (let i = 0; i < wire.length; i += PUSH_BATCH) {
    const changes = wire.slice(i, i + PUSH_BATCH).map((w) => ({
      id: w.id,
      entity: w.entity,
      entityId: w.entityId,
      op: w.op,
      at: w.at,
      iv: toBase64Url(w.sealed.iv),
      ct: toBase64Url(w.sealed.ct),
    }));
    const res = await call(fetcher, '/api/changes', json('POST', { changes }));
    if (res.status === 413) throw new SyncError('full', 'Your account on the sync server is full for now.');
    if (!res.ok) throw new SyncError('server', 'The sync server didn’t take this device’s changes. Try again.');
  }
}

async function* pullChanges(fetcher: Fetch, after: number): AsyncGenerator<{ wire: WireChange[]; last: number }> {
  let from = after;
  for (;;) {
    const res = await call(fetcher, `/api/changes?after=${from}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new SyncError('server', 'The sync server didn’t send the changes. Try again.');
    const body = (await res.json()) as {
      changes: { id: string; entity: WireChange['entity']; entityId: string; op: WireChange['op']; at: string; iv: string; ct: string }[];
      more: boolean;
      last: number;
    };
    const wire = body.changes.map((c) => ({
      id: c.id,
      entity: c.entity,
      entityId: c.entityId,
      op: c.op,
      at: c.at,
      sealed: { v: 1 as const, iv: fromBase64Url(c.iv), ct: fromBase64Url(c.ct) },
    }));
    yield { wire, last: body.last };
    if (!body.more) return;
    from = body.last;
  }
}

const sameKeycheck = (a: EncryptedRecord | null, b: EncryptedRecord | null) => !!a && !!b && encode(a) === encode(b);

// --- Slide files (#108): sealed as stored, sent as raw bytes: 1 (the version), the 12-byte IV, the ciphertext ---

export function sealedToBytes(sealed: EncryptedRecord): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + 12 + sealed.ct.length);
  out[0] = 1;
  out.set(sealed.iv, 1);
  out.set(sealed.ct, 13);
  return out;
}

export function bytesToSealed(data: Uint8Array): EncryptedRecord {
  if (data.length < 13 + 16 || data[0] !== 1) throw new SyncError('server', 'The sync server sent a damaged file.');
  return { v: 1, iv: data.slice(1, 13), ct: data.slice(13) };
}

async function putFile(fetcher: Fetch, deckId: string, kind: 'pdf' | 'pages', sealed: EncryptedRecord): Promise<void> {
  const res = await call(fetcher, `/api/files/${encodeURIComponent(deckId)}/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: sealedToBytes(sealed),
  });
  if (res.status === 413) throw new SyncError('full', 'Your account on the sync server is full for now (or a file is too big).');
  if (!res.ok) throw new SyncError('server', 'The sync server didn’t take a slide file. Try again.');
}

/** Sends the files of decks this device has and the server doesn't yet, one deck at a time. */
export async function uploadFiles(store: StudyStore, fetcher: Fetch = fetch): Promise<number> {
  let sent = 0;
  for (const deckId of await store.filesToUpload()) {
    const files = await store.sealedDeckFiles(deckId);
    if (!files) continue;
    await putFile(fetcher, deckId, 'pdf', files.pdf);
    if (files.pages) await putFile(fetcher, deckId, 'pages', files.pages);
    await store.markFilesUp(deckId);
    sent++;
  }
  return sent;
}

/**
 * A deck's file from the server, sealed (the store opens it), or null if it isn't there yet or sync is off on
 * this device. The store calls this when a deck's file isn't here (store.setFileSource).
 */
export async function fetchSealedFile(store: StudyStore, deckId: string, kind: 'pdf' | 'pages', fetcher: Fetch = fetch): Promise<EncryptedRecord | null> {
  if (!(await store.getSyncState())) return null;
  const res = await call(fetcher, `/api/files/${encodeURIComponent(deckId)}/${kind}`, { headers: { Accept: 'application/octet-stream' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError('server', 'The sync server didn’t send the slides. Try again.');
  return bytesToSealed(new Uint8Array(await res.arrayBuffer()));
}

// --- Rounds ---

/** What a round did: null if sync is off on this device. `changed`: records changed here by other devices. */
export type RoundResult = { state: SyncState; changed: number } | null;

/** One round: the keyring, this device's changes up, everyone else's down. Saves the state as it goes. */
export async function syncOnce(store: StudyStore, fetcher: Fetch = fetch, now: () => Date = () => new Date()): Promise<RoundResult> {
  let state = await store.getSyncState();
  if (!state) return null;
  let changed = 0;
  const save = async (next: Partial<SyncState>) => {
    state = { ...state!, ...next };
    await store.setSyncState(state);
  };
  try {
    // The keyring
    const account = await fetchAccountKeyring(fetcher);
    if (!account) throw new SyncError('no-account-data', 'Your account has no Honed data on the server any more. Turn sync off and on again.');
    if (!sameKeycheck(account.keycheck, await store.getKeycheck())) {
      throw new SyncError('different-key', 'Your account’s data was set up with another key. Turn sync off, then on again to replace this device’s data.');
    }
    const mine = await store.getKeyring();
    const mineText = encode(mine);
    if (account.version > state.keyringVersion) {
      await store.adoptKeyring(account.keyring);
      await save({ keyringVersion: account.version, keyringSent: encode(account.keyring) });
    } else if (mineText !== state.keyringSent && mine) {
      const sent = await putKeyring(fetcher, state.keyringVersion, mine, (await store.getKeycheck())!);
      if (typeof sent === 'number') await save({ keyringVersion: sent, keyringSent: mineText });
      // 'stale': another device changed it first; the next round takes theirs
    }

    // Up
    const own = await store.ownChangesSince(state.pushedSeq);
    if (own.length) {
      const upTo = await store.latestSeq();
      await pushChanges(fetcher, await store.sealForSync(own));
      await save({ pushedSeq: upTo });
    }

    // Down
    for await (const page of pullChanges(fetcher, state.pulled)) {
      if (page.wire.length) changed += await store.applyRemote(await store.openFromSync(page.wire));
      await save({ pulled: page.last });
    }

    // Slide files this device has and the server doesn't (#108)
    await uploadFiles(store, fetcher);
    await save({ lastSyncAt: now().toISOString(), lastError: null });
  } catch (err) {
    await save({ lastError: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  return { state, changed };
}

/** What turning sync on found: started, or this device's data is under another key (ask before replacing). */
export type StartResult = { started: true } | { started: false; reason: 'different-key'; account: AccountKeyring };

/** Turns sync on for this (unlocked) device, signed in as `email`. */
export async function startSync(store: StudyStore, email: string, fetcher: Fetch = fetch, now: () => Date = () => new Date()): Promise<StartResult> {
  const account = await fetchAccountKeyring(fetcher);
  const keyring = (await store.getKeyring())!;
  const keycheck = (await store.getKeycheck())!;
  const base: SyncState = { email, pulled: 0, pushedSeq: 0, keyringVersion: 0, keyringSent: '', seenAt: 0, lastSyncAt: null, lastError: null };

  if (!account) {
    // The first device of the account: its keyring, key check and state go up
    const version = await putKeyring(fetcher, 0, keyring, keycheck);
    if (typeof version !== 'number') throw new SyncError('server', 'Another device turned sync on at the same moment. Try again.');
    const upTo = await store.latestSeq();
    await pushChanges(fetcher, await store.sealForSync(await store.snapshotChanges()));
    await store.setSyncState({ ...base, pushedSeq: upTo, keyringVersion: version, keyringSent: encode(keyring) });
  } else if (sameKeycheck(account.keycheck, keycheck)) {
    // Same key (sync turned off and on, or a restored backup of this account): this device's state goes up
    // again (applying an old change twice is harmless: the later change still wins), then everything comes down
    const upTo = await store.latestSeq();
    await pushChanges(fetcher, await store.sealForSync(await store.snapshotChanges()));
    await store.setSyncState({ ...base, pushedSeq: upTo, keyringVersion: account.version, keyringSent: encode(account.keyring) });
    await store.adoptKeyring(account.keyring);
  } else {
    return { started: false, reason: 'different-key', account };
  }
  await syncOnce(store, fetcher, now);
  return { started: true };
}

/**
 * Joins the account with its data key (unlocked from the account's keyring by the screens): replaces this
 * device's data, if any, with the account's, and downloads everything.
 */
export async function joinWithKey(store: StudyStore, email: string, account: AccountKeyring, dataKey: CryptoKey, fetcher: Fetch = fetch, now: () => Date = () => new Date()) {
  await store.joinAccount(account.keyring, account.keycheck, dataKey);
  await store.setSyncState({
    email,
    pulled: 0,
    pushedSeq: await store.latestSeq(),
    keyringVersion: account.version,
    keyringSent: encode(account.keyring),
    seenAt: 0,
    lastSyncAt: null,
    lastError: null,
  });
  await syncOnce(store, fetcher, now);
}

/** Turns sync off on this device: its data stays here; nothing more goes up or comes down. */
export async function stopSync(store: StudyStore): Promise<void> {
  await store.setSyncState(null);
}

export type { ChangeRecord };
