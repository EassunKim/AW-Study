// Passkeys with the WebAuthn PRF extension (docs/SECURITY.md): the passkey gives a 32-byte secret
// that unlocks the data key. Browser only; unit-tested with a fake navigator.credentials
// (passkey.test.ts), and by the screens (#17) in Chromium with a virtual authenticator and on real
// phones by hand.
//
// There's no server: nothing verifies the passkey's signature. What protects the data is the PRF
// secret itself, which only the authenticator can produce, after the user's Face ID, fingerprint
// or PIN. The challenge is random only because WebAuthn requires one.

import { APP_NAME } from '../brand';
import { CryptoError } from '../types/crypto';

/** WebAuthn PRF extension results, which the DOM types don't describe everywhere yet. */
interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | ArrayBufferView } };
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function bytes(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

/** base64url without padding: how WebAuthn names credentials in evalByCredential. */
export function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function isPrfSupported(): Promise<boolean> {
  try {
    const credential = (globalThis as { PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean>> } })
      .PublicKeyCredential;
    if (!credential?.getClientCapabilities) return false; // can't tell: offer a passphrase instead
    const capabilities = await credential.getClientCapabilities();
    return capabilities['extension:prf'] === true;
  } catch {
    return false;
  }
}

export interface NewPasskey {
  credentialId: Uint8Array;
  prfSalt: Uint8Array; // random, 32 bytes; stored in the keyring entry
  prfOutput: Uint8Array; // 32 bytes; give it straight to wrapWithPasskey, never store it
}

export async function createPasskey(options: { userName: string }): Promise<NewPasskey> {
  const prfSalt = random(32);
  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: APP_NAME }, // the id defaults to this site's domain
      user: { id: random(16), name: options.userName, displayName: options.userName },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256 (Windows Hello)
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new CryptoError('unsupported', 'No passkey was created.');

  const prf = (credential.getClientExtensionResults() as PrfResults).prf;
  if (!prf?.enabled && !prf?.results?.first) {
    throw new CryptoError('unsupported', 'This passkey can’t unlock data on this device (no PRF). Use a passphrase.');
  }
  const credentialId = bytes(credential.rawId);
  // Some authenticators only say PRF is enabled when the passkey is made; ask once more to evaluate it.
  const prfOutput = prf.results?.first
    ? bytes(prf.results.first)
    : (await getPasskeySecret([{ credentialId, prfSalt }])).prfOutput;
  return { credentialId, prfSalt, prfOutput };
}

export async function getPasskeySecret(
  passkeys: { credentialId: Uint8Array; prfSalt: Uint8Array }[],
): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }> {
  if (passkeys.length === 0) throw new CryptoError('wrong-secret', 'No passkey is set up on this device.');
  const evalByCredential = Object.fromEntries(passkeys.map((p) => [base64url(p.credentialId), { first: bytes(p.prfSalt) }]));
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: passkeys.map((p) => ({ type: 'public-key' as const, id: bytes(p.credentialId) })),
      userVerification: 'required',
      extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new CryptoError('wrong-secret', 'No passkey was used.');
  const first = (credential.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!first) throw new CryptoError('unsupported', 'This passkey didn’t give its unlock secret (no PRF).');
  return { credentialId: bytes(credential.rawId), prfOutput: bytes(first) };
}
