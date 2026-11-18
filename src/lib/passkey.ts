// Passkeys with the WebAuthn PRF extension (docs/SECURITY.md): the passkey gives a 32-byte secret
// that unlocks the data key. Browser only; the screens (#17) test it in Chromium with a virtual
// authenticator, and on real phones by hand.
//
// STATUS: stub (issue #15; the implementation follows in its second PR). Keep the signatures.

const todo = (): never => {
  throw new Error('passkey: not implemented yet (#15)');
};

/**
 * Whether this browser can create passkeys with PRF. Conservative: false when it can't tell, so
 * the setup screen offers a passphrase instead (always available).
 */
export function isPrfSupported(): Promise<boolean> {
  return todo();
}

export interface NewPasskey {
  credentialId: Uint8Array;
  prfSalt: Uint8Array; // random, 32 bytes; stored in the keyring entry
  prfOutput: Uint8Array; // 32 bytes; give it straight to wrapWithPasskey, never store it
}

/**
 * Creates a passkey for this site (Face ID, Touch ID, Windows Hello, a security key) and gets its
 * PRF output. If the authenticator only reports PRF as enabled at creation, asks once more to
 * evaluate it. Throws CryptoError 'unsupported' if the passkey has no PRF, and passes on the
 * browser's NotAllowedError when the user cancels.
 */
export function createPasskey(options: { userName: string }): Promise<NewPasskey> {
  void options;
  return todo();
}

/**
 * Asks the user to use one of their passkeys (the keyring's passkey entries) and returns which one
 * and its PRF output, ready for unlock({ method: 'passkey', ... }).
 */
export function getPasskeySecret(
  passkeys: { credentialId: Uint8Array; prfSalt: Uint8Array }[],
): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }> {
  void passkeys;
  return todo();
}
