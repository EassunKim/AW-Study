// Passkey requests, with a fake navigator.credentials and PublicKeyCredential (Node has neither).
// Real passkeys are tested by the screens (#17) in Chromium and by hand on phones.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CryptoError } from '../types/crypto';
import { base64url, createPasskey, getPasskeySecret, isPrfSupported } from './passkey';

type Options = { publicKey: Record<string, unknown> & { extensions?: { prf?: Record<string, unknown> } } };

function fakeCredential(rawId: Uint8Array, prf: unknown) {
  return { rawId: rawId.buffer, getClientExtensionResults: () => ({ prf }) };
}

function fakeCredentials({ create, get }: { create?: (o: Options) => unknown; get?: (o: Options) => unknown }) {
  const calls = { create: [] as Options[], get: [] as Options[] };
  vi.stubGlobal('navigator', {
    credentials: {
      create: async (o: Options) => (calls.create.push(o), create?.(o) ?? null),
      get: async (o: Options) => (calls.get.push(o), get?.(o) ?? null),
    },
  });
  return calls;
}

const id = new Uint8Array([1, 2, 3, 250, 251, 252]);
const output = new Uint8Array(32).fill(42);

afterEach(() => vi.unstubAllGlobals());

describe('isPrfSupported', () => {
  it('is false when the browser can’t tell, and follows getClientCapabilities when it can', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(await isPrfSupported()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', {});
    expect(await isPrfSupported()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({ 'extension:prf': true }) });
    expect(await isPrfSupported()).toBe(true);
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => ({ 'extension:prf': false }) });
    expect(await isPrfSupported()).toBe(false);
    vi.stubGlobal('PublicKeyCredential', { getClientCapabilities: async () => Promise.reject(new Error('no')) });
    expect(await isPrfSupported()).toBe(false);
  });
});

describe('createPasskey', () => {
  it('asks for a discoverable, user-verified passkey with PRF on a random 32-byte salt', async () => {
    const calls = fakeCredentials({ create: () => fakeCredential(id, { enabled: true, results: { first: output.buffer } }) });
    const made = await createPasskey({ userName: 'Nathan' });
    const request = calls.create[0]!.publicKey;
    expect(request.authenticatorSelection).toEqual({ residentKey: 'required', userVerification: 'required' });
    expect((request.user as { name: string }).name).toBe('Nathan');
    const salt = (request.extensions!.prf as { eval: { first: Uint8Array } }).eval.first;
    expect(salt).toHaveLength(32);
    expect(made.prfSalt).toEqual(salt);
    expect(made.credentialId).toEqual(id);
    expect(made.prfOutput).toEqual(output);
    expect(calls.get).toHaveLength(0);
  });

  it('asks once more when the authenticator only says PRF is enabled', async () => {
    const calls = fakeCredentials({
      create: () => fakeCredential(id, { enabled: true }),
      get: () => fakeCredential(id, { results: { first: output.buffer } }),
    });
    const made = await createPasskey({ userName: 'Matt' });
    expect(calls.get).toHaveLength(1);
    const evalBy = (calls.get[0]!.publicKey.extensions!.prf as { evalByCredential: Record<string, { first: Uint8Array }> })
      .evalByCredential;
    expect(Object.keys(evalBy)).toEqual([base64url(id)]);
    expect(evalBy[base64url(id)]!.first).toEqual(made.prfSalt);
    expect(made.prfOutput).toEqual(output);
  });

  it('refuses a passkey without PRF', async () => {
    fakeCredentials({ create: () => fakeCredential(id, undefined) });
    await expect(createPasskey({ userName: 'x' })).rejects.toMatchObject({ code: 'unsupported' });
    fakeCredentials({ create: () => fakeCredential(id, { enabled: false }) });
    await expect(createPasskey({ userName: 'x' })).rejects.toBeInstanceOf(CryptoError);
  });

  it('passes on the browser’s error when the user cancels', async () => {
    fakeCredentials({
      create: () => {
        throw new DOMException('cancelled', 'NotAllowedError');
      },
    });
    await expect(createPasskey({ userName: 'x' })).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});

describe('getPasskeySecret', () => {
  it('offers every passkey, each with its own salt, and returns the one used', async () => {
    const other = new Uint8Array([9, 9]);
    const calls = fakeCredentials({ get: () => fakeCredential(other, { results: { first: output.buffer } }) });
    const got = await getPasskeySecret([
      { credentialId: id, prfSalt: new Uint8Array(32).fill(1) },
      { credentialId: other, prfSalt: new Uint8Array(32).fill(2) },
    ]);
    const request = calls.get[0]!.publicKey;
    expect(request.userVerification).toBe('required');
    expect((request.allowCredentials as { id: Uint8Array }[]).map((c) => c.id)).toEqual([id, other]);
    const evalBy = (request.extensions!.prf as { evalByCredential: Record<string, { first: Uint8Array }> }).evalByCredential;
    expect(evalBy[base64url(other)]!.first).toEqual(new Uint8Array(32).fill(2));
    expect(got).toEqual({ credentialId: other, prfOutput: output });
  });

  it('needs at least one passkey, and a PRF result', async () => {
    await expect(getPasskeySecret([])).rejects.toMatchObject({ code: 'wrong-secret' });
    fakeCredentials({ get: () => fakeCredential(id, {}) });
    await expect(getPasskeySecret([{ credentialId: id, prfSalt: new Uint8Array(32) }])).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('base64url', () => {
  it('uses the URL-safe alphabet without padding', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
  });
});
