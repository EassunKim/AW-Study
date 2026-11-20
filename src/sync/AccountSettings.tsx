// Settings' Account box (#95, sync step 1, testing phase): sign in with Google, check who you're
// signed in as, sign out. Signing in never unlocks anything (docs/SECURITY.md, "Accounts and sync"),
// and nothing syncs yet. The server is only asked when you press a button.
import { useState } from 'react';
import { accountStatus, signInUrl, signOut, type AccountStatus } from './client';

type Check = { state: 'busy' } | { state: 'known'; status: AccountStatus } | { state: 'problem'; message: string };

export function AccountSettings() {
  const [check, setCheck] = useState<Check | null>(null);
  const run = async (action: () => Promise<AccountStatus>) => {
    setCheck({ state: 'busy' });
    try {
      setCheck({ state: 'known', status: await action() });
    } catch (err) {
      setCheck({ state: 'problem', message: err instanceof Error ? err.message : String(err) });
    }
  };
  const signedIn = check?.state === 'known' && check.status.signedIn;

  return (
    <>
      <h3 id="account-title">Account (testing)</h3>
      <div className="stack" aria-labelledby="account-title" role="group">
        <p className="muted small">
          Sign in with Google to get this device ready for sync. Signing in only says who you are: your classes and slides
          still open only with your passkey, passphrase or recovery key. Nothing syncs yet, and only invited testers can sign in.
        </p>
        {check?.state === 'known' && (
          <p role="status" data-testid="account-status">
            {check.status.signedIn ? `Signed in as ${check.status.email}.` : 'Not signed in on this device.'}
          </p>
        )}
        {check?.state === 'problem' && (
          <p className="error" role="status" data-testid="account-status">
            {check.message}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={() => void run(() => accountStatus())} disabled={check?.state === 'busy'}>
            {check?.state === 'busy' ? 'Checking…' : 'Check account'}
          </button>
          {signedIn ? (
            <button type="button" onClick={() => void run(async () => (await signOut(), { signedIn: false }))}>
              Sign out
            </button>
          ) : (
            <a className="button" href={signInUrl()}>
              Sign in with Google
            </a>
          )}
        </div>
        <p className="muted small">Signing in leaves Honed for Google’s page, so you’ll unlock again when you come back.</p>
      </div>
    </>
  );
}
