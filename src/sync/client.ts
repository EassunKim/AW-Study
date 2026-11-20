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
