// Who's asking: Cloudflare Access puts a signed token (a JWT) on every request it lets through, in
// the Cf-Access-Jwt-Assertion header. We check it ourselves, so a request that somehow reaches the
// helper without passing Access (a misrouted tunnel, another container) is refused.
//
// The token is RS256-signed with Access's keys, published at <team domain>/cdn-cgi/access/certs.
// We check the signature, the issuer (our team domain), the audience (this Access application's
// AUD tag), the expiry, and take the email from it.
import { createPublicKey, verify } from 'node:crypto';

export class AccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessError';
  }
}

/**
 * Makes a checker: `await check(headers)` gives the signed-in email (lowercase), or throws AccessError.
 * `fetchKeys()` returns the JWKS (`{ keys: [...] }`); by default it's fetched from the team domain.
 */
export function accessChecker({ teamDomain, audience, fetchKeys, now = () => Date.now() }) {
  if (!teamDomain || !audience) throw new Error('Access needs ACCESS_TEAM_DOMAIN and ACCESS_AUD');
  const issuer = teamDomain.replace(/\/+$/, '');
  const loadKeys = fetchKeys ?? (() => fetchJson(`${issuer}/cdn-cgi/access/certs`));
  let keys = new Map();
  let loadedAt = -Infinity;

  const keyFor = async (kid) => {
    // Access rotates its keys: reload when a token names one we don't have (at most once a minute)
    // and every hour anyway
    if ((!keys.has(kid) && now() - loadedAt > 60_000) || now() - loadedAt > 3_600_000) {
      const jwks = await loadKeys();
      keys = new Map((jwks?.keys ?? []).filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]));
      loadedAt = now();
    }
    return keys.get(kid);
  };

  return async function check(headers) {
    const token = headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string' || !token) throw new AccessError('Not signed in through Cloudflare Access.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new AccessError('Bad Access token.');
    const [head, body, signature] = parts;
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new AccessError('Bad Access token.');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AccessError('Bad Access token.');
    const key = await keyFor(header.kid);
    if (!key) throw new AccessError('Access token signed with an unknown key.');
    const signed = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(signature, 'base64url'));
    if (!signed) throw new AccessError('Access token signature is wrong.');

    const seconds = now() / 1000;
    if (claims.iss !== issuer) throw new AccessError('Access token from another team.');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(audience)) throw new AccessError('Access token for another application.');
    if (typeof claims.exp !== 'number' || claims.exp < seconds) throw new AccessError('Access token expired.');
    if (typeof claims.nbf === 'number' && claims.nbf > seconds + 60) throw new AccessError('Access token not valid yet.');
    if (typeof claims.email !== 'string' || !claims.email.includes('@')) throw new AccessError('Access token has no email.');
    const email = claims.email.toLowerCase();
    const said = headers['cf-access-authenticated-user-email'];
    if (typeof said === 'string' && said.toLowerCase() !== email) throw new AccessError('Access headers disagree.');
    return email;
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Access keys: HTTP ${response.status}`);
  return response.json();
}
