// The sync server's HTTP API (#95, served at /api/ through the tunnel; docs/SECURITY.md "Accounts and
// sync"). Step 1 is accounts only: nothing syncs yet.
//
//   GET    /api/auth/google?then=<path>[&fresh=1]  start a Google sign-in (fresh: choose the account again)
//   GET    /api/auth/callback                       where Google sends the browser back
//   GET    /api/me                                  { signedIn, email?, device? }
//   GET    /api/devices                             this account's signed-in devices
//   POST   /api/auth/signout                        sign this device out
//   POST   /api/devices/signout  { id } | { all: true }   sign another device, or every device, out
//   DELETE /api/account                             delete the account (needs a sign-in in the last 5 minutes)
//   GET    /healthz                                 for the container's health check
//
// Requests that change something must come from our own site (Origin) as JSON. Answers are never
// cached. Logs are routes, statuses and times: never emails, tokens or codes.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { randomToken, SignInError } from './google.mjs';

export const SESSION_COOKIE = 'honed_session';
export const SIGNIN_COOKIE = 'honed_signin';
const DAY = 86_400_000;
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 180 * DAY;
export const RECENT_SIGN_IN_MS = 5 * 60_000;
export const SIGN_IN_WAIT_MS = 10 * 60_000; // how long a started sign-in may take
const MAX_PENDING = 500;
const MAX_BODY = 16 * 1024;
const TOUCH_EVERY_MS = 3_600_000; // a session's "last used" is saved at most hourly

const hashToken = (token) => createHash('sha256').update(token).digest('base64url');

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db  from openDb
 * @param {ReturnType<typeof import('./google.mjs').googleClient>} options.google
 * @param {string[]} options.allowedEmails  who may have an account (testing phase); empty lets nobody in
 * @param {string} options.appOrigin  https://honed.pacificfish.ca
 * @param {(line: object) => void} [options.log]
 * @param {() => Date} [options.now]
 */
export function createSync({ db, google, allowedEmails, appOrigin, log = (line) => console.log(JSON.stringify(line)), now = () => new Date() }) {
  const allowed = new Set(allowedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const pending = new Map(); // state -> { nonce, verifier, then, at }
  const secure = appOrigin.startsWith('https:') ? '; Secure' : '';

  const q = {
    accountBySub: db.prepare('SELECT * FROM accounts WHERE google_sub = ?'),
    addAccount: db.prepare('INSERT INTO accounts (id, google_sub, email, created_at, signed_in_at) VALUES (?, ?, ?, ?, ?)'),
    updateAccount: db.prepare('UPDATE accounts SET email = ?, signed_in_at = ? WHERE id = ?'),
    deleteAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
    addSession: db.prepare('INSERT INTO sessions (id, hash, account_id, device, created_at, used_at, signed_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT s.*, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.hash = ?'),
    touch: db.prepare('UPDATE sessions SET used_at = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteSessionByHash: db.prepare('DELETE FROM sessions WHERE hash = ?'),
    deleteAccountSession: db.prepare('DELETE FROM sessions WHERE id = ? AND account_id = ?'),
    deleteAccountSessions: db.prepare('DELETE FROM sessions WHERE account_id = ?'),
    devices: db.prepare('SELECT id, device, created_at, used_at FROM sessions WHERE account_id = ? ORDER BY used_at DESC'),
  };

  /** The signed-in session for this request, or null (an expired or no-longer-allowed one is removed). */
  const sessionOf = (req) => {
    const token = cookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const row = q.session.get(hashToken(token));
    if (!row) return null;
    const at = now().getTime();
    const expired = at - Date.parse(row.used_at) > SESSION_IDLE_MS || at - Date.parse(row.created_at) > SESSION_MAX_MS;
    if (expired || !allowed.has(row.email)) {
      q.deleteSession.run(row.id);
      return null;
    }
    if (at - Date.parse(row.used_at) > TOUCH_EVERY_MS) q.touch.run(now().toISOString(), row.id);
    return row;
  };

  return async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://sync');
    const route = `${req.method} ${url.pathname}`;
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    const done = (status) => log({ at: now().toISOString(), route, status, ms: Date.now() - started });

    const json = (status, body, extra = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(body));
      done(status);
    };
    const redirect = (to, extra = {}) => {
      res.writeHead(303, { ...headers, Location: to, ...extra });
      res.end();
      done(303);
    };
    // A plain page for sign-in problems (the browser arrived by a redirect, so JSON would be no use)
    const page = (status, message, extra = {}) => {
      res.writeHead(status, {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ...extra,
      });
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Honed sign-in</title></head>` +
          `<body><h1>Honed sign-in</h1><p>${escapeHtml(message)}</p><p><a href="/#/settings">Back to Honed</a></p></body></html>`,
      );
      done(status);
    };

    if (url.pathname === '/healthz' && req.method === 'GET') return json(200, { ok: true });

    // --- Signing in ---

    if (url.pathname === '/api/auth/google' && req.method === 'GET') {
      const then = safePath(url.searchParams.get('then'));
      const at = now().getTime();
      for (const [state, p] of pending) if (at - p.at > SIGN_IN_WAIT_MS) pending.delete(state);
      if (pending.size >= MAX_PENDING) return page(503, 'Too many sign-ins at once. Try again in a few minutes.');
      const state = randomToken();
      const sign = { nonce: randomToken(), verifier: randomToken(), then, at };
      pending.set(state, sign);
      // The state also goes in a cookie, so a sign-in can only finish in the browser that started it
      // (nobody can send you a link that signs you in to their account)
      return redirect(google.signInUrl({ state, nonce: sign.nonce, verifier: sign.verifier, prompt: url.searchParams.get('fresh') ? 'select_account' : undefined }), {
        'Set-Cookie': `${SIGNIN_COOKIE}=${state}; Path=/api/auth/; HttpOnly; SameSite=Lax; Max-Age=${SIGN_IN_WAIT_MS / 1000}${secure}`,
      });
    }

    if (url.pathname === '/api/auth/callback' && req.method === 'GET') {
      const clear = `${SIGNIN_COOKIE}=; Path=/api/auth/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
      const state = url.searchParams.get('state') ?? '';
      const sign = pending.get(state);
      pending.delete(state);
      if (url.searchParams.get('error')) return page(400, 'The sign-in was cancelled.', { 'Set-Cookie': clear });
      if (!sign || now().getTime() - sign.at > SIGN_IN_WAIT_MS || cookies(req)[SIGNIN_COOKIE] !== state) {
        return page(400, 'That sign-in link has expired, or was started in another browser. Please sign in again.', { 'Set-Cookie': clear });
      }
      let who;
      try {
        const idToken = await google.exchange(url.searchParams.get('code') ?? '', sign.verifier);
        who = await google.verifyIdToken(idToken, sign.nonce);
      } catch (err) {
        if (err instanceof SignInError) return page(400, `Google sign-in didn’t work: ${err.message}`, { 'Set-Cookie': clear });
        throw err;
      }
      if (!allowed.has(who.email)) {
        return page(403, 'Honed sync is invite-only for now, and this Google account isn’t on the list.', { 'Set-Cookie': clear });
      }

      const at = now().toISOString();
      let account = q.accountBySub.get(who.sub);
      if (account) q.updateAccount.run(who.email, at, account.id);
      else {
        account = { id: randomUUID() };
        q.addAccount.run(account.id, who.sub, who.email, at, at);
      }
      // Signing in again on this device replaces its session rather than adding another
      const old = cookies(req)[SESSION_COOKIE];
      if (old) q.deleteSessionByHash.run(hashToken(old));
      const token = randomBytes(32).toString('base64url');
      q.addSession.run(randomUUID(), hashToken(token), account.id, deviceName(req.headers['user-agent']), at, at, at);
      res.setHeader('Set-Cookie', [clear, `${SESSION_COOKIE}=${token}; Path=/api/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_MS / 1000}${secure}`]);
      return redirect(sign.then);
    }

    // --- Signed in ---

    if (url.pathname === '/api/me' && req.method === 'GET') {
      const s = sessionOf(req);
      return json(200, s ? { signedIn: true, email: s.email, device: s.id } : { signedIn: false });
    }

    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });

    // Everything below changes something, or is private: our own site only, signed in
    const changing = req.method !== 'GET';
    if (changing) {
      if (req.headers.origin !== appOrigin) return json(403, { error: 'Requests must come from Honed itself.' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return json(415, { error: 'Send JSON.' });
    }
    let body = {};
    if (changing) {
      try {
        body = await readJson(req);
      } catch {
        return json(400, { error: 'Bad JSON.' });
      }
    }
    const s = sessionOf(req);
    const signOutCookie = `${SESSION_COOKIE}=; Path=/api/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;

    if (url.pathname === '/api/auth/signout' && req.method === 'POST') {
      if (s) q.deleteSession.run(s.id);
      return json(200, { signedIn: false }, { 'Set-Cookie': signOutCookie });
    }

    if (!s) return json(401, { error: 'Not signed in.' });

    if (url.pathname === '/api/devices' && req.method === 'GET') {
      const devices = q.devices.all(s.account_id).map((d) => ({ id: d.id, device: d.device, since: d.created_at, lastUsed: d.used_at, current: d.id === s.id }));
      return json(200, { devices });
    }

    if (url.pathname === '/api/devices/signout' && req.method === 'POST') {
      if (body.all === true) {
        q.deleteAccountSessions.run(s.account_id);
        return json(200, { signedIn: false }, { 'Set-Cookie': signOutCookie });
      }
      if (typeof body.id !== 'string') return json(400, { error: 'Say which device.' });
      q.deleteAccountSession.run(body.id, s.account_id); // never another account's
      return json(200, body.id === s.id ? { signedIn: false } : { signedIn: true }, body.id === s.id ? { 'Set-Cookie': signOutCookie } : {});
    }

    if (url.pathname === '/api/account' && req.method === 'DELETE') {
      if (now().getTime() - Date.parse(s.signed_in_at) > RECENT_SIGN_IN_MS) {
        return json(403, { error: 'Sign in with Google again first, then delete the account within 5 minutes.', needsSignIn: true });
      }
      q.deleteAccount.run(s.account_id); // its sessions go with it (ON DELETE CASCADE)
      return json(200, { deleted: true, signedIn: false }, { 'Set-Cookie': signOutCookie });
    }

    return json(404, { error: 'Not found.' });
  };
}

/** A path on our own site to go back to after signing in: "/..." only, never another site. */
export function safePath(then) {
  if (typeof then !== 'string' || then.length > 300) return '/#/settings';
  if (!then.startsWith('/') || then.startsWith('//') || then.startsWith('/\\') || /[\u0000-\u001f\u007f\\]/.test(then)) return '/#/settings';
  return then;
}

/** "Chrome on Windows", "Safari on iPhone": enough to tell devices apart in a list. */
export function deviceName(agent = '') {
  const os = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Mac OS X|Macintosh/.test(agent) ? 'Mac' : /CrOS/.test(agent) ? 'ChromeOS' : /Linux/.test(agent) ? 'Linux' : null;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\/|FxiOS/.test(agent) ? 'Firefox' : /CriOS|Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : null;
  if (!os && !browser) return 'A browser';
  return [browser ?? 'A browser', os && `on ${os}`].filter(Boolean).join(' ');
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too big');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const value = text ? JSON.parse(text) : {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
  return value;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
