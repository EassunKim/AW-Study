import { describe, expect, it } from 'vitest';
import { accountStatus, signInUrl, signOut, SyncUnavailable } from './client';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

describe('the sync client', () => {
  it('reads who you are signed in as', async () => {
    expect(await accountStatus(reply(200, { signedIn: true, email: 'a@b.c', device: 'x' }))).toEqual({ signedIn: true, email: 'a@b.c' });
    expect(await accountStatus(reply(200, { signedIn: false }))).toEqual({ signedIn: false });
  });

  it('says sync is unavailable when there is no server, it answers nonsense, or you are offline', async () => {
    await expect(accountStatus(reply(404, 'Not found'))).rejects.toThrow(SyncUnavailable);
    await expect(accountStatus(reply(200, { hello: 1 }))).rejects.toThrow(SyncUnavailable);
    await expect(accountStatus(offline)).rejects.toThrow(/offline/);
    await expect(signOut(offline)).rejects.toThrow(/offline/);
    await expect(signOut(reply(500, {}))).rejects.toThrow(SyncUnavailable);
  });

  it('signs out with an empty JSON body', async () => {
    const seen: RequestInit[] = [];
    await signOut((async (_url: string, init: RequestInit) => (seen.push(init), new Response('{}'))) as unknown as typeof fetch);
    expect(seen).toEqual([{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }]);
  });

  it('sends the sign-in back to Settings unless told otherwise', () => {
    expect(signInUrl()).toBe('/api/auth/google?then=%2F%23%2Fsettings');
    expect(signInUrl('/#/classes')).toBe('/api/auth/google?then=%2F%23%2Fclasses');
  });
});
