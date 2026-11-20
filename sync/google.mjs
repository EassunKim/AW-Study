// Google sign-in (OpenID Connect), our own code (#93, docs/SECURITY.md "Accounts and sync"):
//
//   1. signInUrl(): the browser goes to Google with our client id, the scopes `openid email`, a `state`
//      and a `nonce` we made for this sign-in, and a PKCE challenge.
//   2. Google sends the browser back to /api/auth/callback with a one-time code.
//   3. exchange(): we trade the code (plus the PKCE verifier and our client secret) for an ID token.
//   4. verifyIdToken(): we check that token ourselves: Google's signature (RS256, keys from Google's
//      published set), the issuer, the audience (our client id), the expiry, the nonce, and that the email
//      is verified. Only then do we believe who it is.
//
// Google's addresses are fixed in production (GOOGLE); tests pass a fake's.
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

export const GOOGLE = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'], // Google uses both
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  keys: 'https://www.googleapis.com/oauth2/v3/certs',
};

export class SignInError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignInError';
  }
}

/** A random value for state, nonce or the PKCE verifier: 32 bytes, base64url. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** PKCE's S256 challenge for a verifier. */
export const challengeFor = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.redirectUri  https://honed.pacificfish.ca/api/auth/callback
 * @param {typeof GOOGLE} [options.endpoints]  (tests)
 * @param {typeof fetch} [options.fetch]  (tests)
 * @param {() => number} [options.now]  milliseconds
 */
export function googleClient({ clientId, clientSecret, redirectUri, endpoints = GOOGLE, fetch: get = fetch, now = () => Date.now() }) {
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Google sign-in needs a client id, a client secret and a redirect address');
  let keys = new Map();
  let loadedAt = -Infinity;

  const keyFor = async (kid) => {
    // Google rotates its keys: reload when a token names one we don't have (at most once a minute),
    // and every hour anyway
    if ((!keys.has(kid) && now() - loadedAt > 60_000) || now() - loadedAt > 3_600_000) {
      const res = await get(endpoints.keys);
      if (!res.ok) throw new SignInError('Couldn’t get Google’s keys.');
      const jwks = await res.json();
      keys = new Map((jwks?.keys ?? []).filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
      loadedAt = now();
    }
    return keys.get(kid);
  };

  return {
    /** Where to send the browser to sign in. */
    signInUrl({ state, nonce, verifier, prompt }) {
      const url = new URL(endpoints.authorize);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        nonce,
        code_challenge: challengeFor(verifier),
        code_challenge_method: 'S256',
        ...(prompt ? { prompt } : {}),
      }).toString();
      return url.toString();
    },

    /** Trades the code from the callback for Google's ID token (still to be checked). */
    async exchange(code, verifier) {
      const res = await get(endpoints.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }).toString(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.id_token !== 'string') throw new SignInError('Google didn’t accept the sign-in.');
      return body.id_token;
    },

    /** Checks Google's ID token; gives `{ sub, email }`, or throws SignInError. */
    async verifyIdToken(token, nonce) {
      const parts = token.split('.');
      if (parts.length !== 3) throw new SignInError('Bad sign-in token.');
      const [head, body, signature] = parts;
      let header, claims;
      try {
        header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
        claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        throw new SignInError('Bad sign-in token.');
      }
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new SignInError('Bad sign-in token.');
      const key = await keyFor(header.kid);
      if (!key) throw new SignInError('Sign-in token signed with an unknown key.');
      if (!verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(signature, 'base64url'))) {
        throw new SignInError('Sign-in token signature is wrong.');
      }
      const seconds = now() / 1000;
      if (!endpoints.issuers.includes(claims.iss)) throw new SignInError('Sign-in token from someone other than Google.');
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(clientId)) throw new SignInError('Sign-in token meant for another app.');
      if (typeof claims.exp !== 'number' || claims.exp < seconds - 60) throw new SignInError('Sign-in token has expired.');
      if (typeof claims.iat === 'number' && claims.iat > seconds + 300) throw new SignInError('Sign-in token from the future.');
      if (typeof nonce !== 'string' || claims.nonce !== nonce) throw new SignInError('Sign-in token wasn’t for this sign-in.');
      if (typeof claims.sub !== 'string' || !claims.sub) throw new SignInError('Sign-in token has no account id.');
      if (typeof claims.email !== 'string' || claims.email_verified !== true) throw new SignInError('Google hasn’t verified this account’s email.');
      return { sub: claims.sub, email: claims.email.toLowerCase(), authTime: typeof claims.auth_time === 'number' ? claims.auth_time : null };
    },
  };
}
