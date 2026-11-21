// The app's side of the sync server (sync/, #95), at /api/ on our own site (so `connect-src 'self'`
// is unchanged). Step 1 is the account only: who you're signed in as, and signing out. Nothing of yours
// is sent: these requests carry the session cookie and nothing else (docs/SECURITY.md, "Accounts and
// sync").

export type AccountStatus = { signedIn: false } | { signedIn: true; email: string };

/** Why the account couldn't be checked. */
export class SyncUnavailable extends Error {
  constructor(message = 'Sync isn’t available here yet.') {
    super(message);
    this.name = 'SyncUnavailable';
  }
}

/**
 * Where "Sign in with Google" goes. In the same window, so an iPhone Home Screen app keeps the cookie
 * (a new tab would be Safari, with its own cookies); Google sends the browser back to `then`.
 */
export function signInUrl(then = '/#/settings'): string {
  return `/api/auth/google?then=${encodeURIComponent(then)}`;
}

/** Who this device is signed in as (asks the server: only when the user asks). */
export async function accountStatus(fetcher: typeof fetch = fetch): Promise<AccountStatus> {
  let res: Response;
  try {
    res = await fetcher('/api/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new SyncUnavailable('Couldn’t reach the sync server. Are you offline?');
  }
  if (!res.ok) throw new SyncUnavailable();
  const body = (await res.json().catch(() => null)) as { signedIn?: unknown; email?: unknown } | null;
  if (body?.signedIn === true && typeof body.email === 'string') return { signedIn: true, email: body.email };
  if (body?.signedIn === false) return { signedIn: false };
  throw new SyncUnavailable();
}

/** Signs this device out of the account (its data stays here). */
export async function signOut(fetcher: typeof fetch = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetcher('/api/auth/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch {
    throw new SyncUnavailable('Couldn’t reach the sync server. Are you offline?');
  }
  if (!res.ok) throw new SyncUnavailable('Couldn’t sign out. Try again.');
}

// --- Google unlock (#101, docs/SECURITY.md "Google unlock") ---

/** Why the Google unlock key couldn't be had: sign in with Google again first, or it's turned off. */
export class GoogleUnlockError extends Error {
  constructor(
    readonly code: 'needs-sign-in' | 'off' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleUnlockError';
  }
}

function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function keyFrom(res: Response): Promise<Uint8Array> {
  const body = (await res.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof body?.key !== 'string') throw new GoogleUnlockError('unavailable', 'The sync server sent something unexpected.');
  let key: Uint8Array;
  try {
    key = fromBase64url(body.key);
  } catch {
    throw new GoogleUnlockError('unavailable', 'The sync server sent something unexpected.');
  }
  if (key.length !== 32) throw new GoogleUnlockError('unavailable', 'The sync server sent something unexpected.');
  return key;
}

async function call(fetcher: typeof fetch, path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetcher(path, { cache: 'no-store', ...init });
  } catch {
    throw new GoogleUnlockError('unavailable', 'Couldn’t reach the sync server. Are you offline?');
  }
}

const SEND = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } as const;

/** Turning Google unlock on: the account's key (made on the server the first time). Signed in only. */
export async function turnOnGoogleUnlock(fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await call(fetcher, '/api/unlock-key', SEND);
  if (res.status === 401) throw new GoogleUnlockError('needs-sign-in', 'Sign in with Google first (Account, above).');
  if (!res.ok) throw new GoogleUnlockError('unavailable', 'Couldn’t turn on Google unlock. Try again.');
  return keyFrom(res);
}

/** The account's Google unlock key, for unlocking: needs a Google sign-in in the last 5 minutes. */
export async function fetchGoogleKey(fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const res = await call(fetcher, '/api/unlock-key', { headers: { Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new GoogleUnlockError('needs-sign-in', 'Sign in with Google to unlock.');
  if (res.status === 404) throw new GoogleUnlockError('off', 'Google unlock has been turned off for your account. Use your recovery key.');
  if (!res.ok) throw new GoogleUnlockError('unavailable', 'Couldn’t reach the sync server. Try again.');
  return keyFrom(res);
}

/** Turning Google unlock off for the account (every device): the server deletes its key. */
export async function turnOffGoogleUnlock(fetcher: typeof fetch = fetch): Promise<void> {
  const res = await call(fetcher, '/api/unlock-key', { ...SEND, method: 'DELETE' });
  if (!res.ok && res.status !== 401) throw new GoogleUnlockError('unavailable', 'Couldn’t reach the sync server to turn it off there. Try again.');
}

/** When and on which device the key was given out (newest first). */
export async function googleUnlockUses(fetcher: typeof fetch = fetch): Promise<{ device: string; at: string }[]> {
  const res = await call(fetcher, '/api/unlock-uses', { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as { uses?: { device: string; at: string }[] } | null;
  return Array.isArray(body?.uses) ? body.uses : [];
}

/** Where a Google sign-in for unlocking comes back to: the unlock screen picks it up from there. */
export const GOOGLE_UNLOCK_RETURN = '/#/google-unlock';
/** Where a Google sign-in for setting up comes back to. */
export const GOOGLE_SETUP_RETURN = '/#/google-setup';
