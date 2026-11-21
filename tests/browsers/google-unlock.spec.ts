// Google unlock (#101), through the real screens on desktop, an Android phone and an iPhone. The test plays
// the sync server and Google: /api/ is answered here, and a sign-in "goes to Google" by redirecting straight
// back to where the app asked, as Google would after you pick your account.
import { expect, test, type Page, type Route } from './fixtures';
import { addClassAndReturn, navBar } from './class-helpers';
import { chooseRemember, confirmRecoveryKey, PASSPHRASE, readRecoveryKey, setUpWithPassphrase } from './lock-helpers';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7 + 1)).toString('base64url');

/** A fake sync server + Google. `fresh` is whether the session's Google sign-in counts as recent. */
async function fakeServer(page: Page) {
  const server = { signedIn: true, fresh: false, keyOn: false, key: KEY, asked: [] as string[], signIns: 0 };
  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    server.asked.push(`${req.method()} ${url.pathname}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/google') {
      // "Google": signed in, freshly, and back to `then`
      server.signIns++;
      server.signedIn = true;
      server.fresh = true;
      // A page that moves on at once (Playwright can't fake a redirect in WebKit; the real server's 303 is
      // tested in tests/sync/)
      const then = (url.searchParams.get('then') ?? '/').replace(/"/g, '');
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><meta http-equiv="refresh" content="0;url=${then}">` });
    }
    if (url.pathname === '/api/me') return json(200, server.signedIn ? { signedIn: true, email: 'nathan@example.com' } : { signedIn: false });
    if (!server.signedIn) return json(401, { error: 'Not signed in.' });
    if (url.pathname === '/api/unlock-key' && req.method() === 'POST') {
      server.keyOn = true;
      return json(200, { key: server.key });
    }
    if (url.pathname === '/api/unlock-key' && req.method() === 'GET') {
      if (!server.fresh) return json(403, { needsSignIn: true });
      if (!server.keyOn) return json(404, { off: true });
      return json(200, { key: server.key });
    }
    if (url.pathname === '/api/unlock-key' && req.method() === 'DELETE') {
      server.keyOn = false;
      return json(200, { off: true });
    }
    if (url.pathname === '/api/unlock-uses') return json(200, { uses: [{ device: 'Chrome on Windows', at: '2026-11-20T12:00:00Z' }] });
    return json(404, { error: 'Not found.' });
  });
  return server;
}

const unlockHeading = (page: Page) => page.getByRole('heading', { name: /^Unlock/ });
const unlocked = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Lock', exact: true });

async function toSettings(page: Page) {
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/status of (403|404)/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test('turn it on in Settings, then Lock: Unlock with Google signs in again if needed and opens', async ({ page }) => {
  const errors = watchErrors(page);
  const server = await fakeServer(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  await addClassAndReturn(page, 'Geology');
  await toSettings(page);

  const box = page.getByRole('group', { name: 'Google unlock' });
  await expect(box.getByTestId('google-unlock-warning')).toContainText('could read your classes');
  await box.getByRole('button', { name: 'Turn on Google unlock' }).click();
  await page.getByLabel('Current passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(box.getByTestId('google-unlock-state')).toContainText('On for nathan@example.com');
  expect(server.asked).toContain('POST /api/unlock-key');
  await box.getByRole('button', { name: 'When was it used?' }).click();
  await expect(box.getByTestId('google-unlock-uses')).toContainText('Chrome on Windows');

  // Lock: the sign-in isn't recent any more, so Unlock with Google goes to "Google" and back, then opens
  await unlocked(page).click();
  await expect(unlockHeading(page)).toBeVisible();
  await chooseRemember(page, false);
  server.fresh = false;
  await page.getByRole('button', { name: 'Unlock with Google' }).click();
  await expect(unlocked(page)).toBeVisible();
  expect(server.signIns).toBe(1);
  await expect(page).toHaveURL(/#\/$/); // back on Tasks, not on the return address
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByText('Geology')).toBeVisible();

  // The unticked box survived the trip: a reload asks again. With a fresh sign-in, no trip at all
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Unlock with Google' }).click();
  await expect(unlocked(page)).toBeVisible();
  expect(server.signIns).toBe(1);
  expect(errors).toEqual([]);
});

test('set up with Google from the start: sign in, the recovery key, then Unlock with Google', async ({ page }) => {
  const errors = watchErrors(page);
  const server = await fakeServer(page);
  server.signedIn = false;
  await page.goto('/');
  await page.getByRole('button', { name: 'Use your Google account' }).click();
  await expect(page.getByTestId('google-unlock-warning')).toContainText('could read your classes');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  // Back from "Google", setup carries on by itself to the recovery key
  const recoveryKey = await readRecoveryKey(page);
  expect(server.signIns).toBe(1);
  expect(server.keyOn).toBe(true);
  await confirmRecoveryKey(page, recoveryKey);
  await chooseRemember(page, false);
  await page.getByRole('button', { name: /I’ve saved it/ }).click();
  await expect(unlocked(page)).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);

  // No passphrase, no passkey: Google (or the recovery key) opens it
  await page.reload();
  await expect(unlockHeading(page)).toBeVisible();
  await page.getByRole('button', { name: 'Unlock with Google' }).click();
  await expect(unlocked(page)).toBeVisible();

  // Turning it off is refused: only the recovery key would be left
  await toSettings(page);
  await expect(page.getByText('Passphrase: none')).toBeVisible();
  await page.getByRole('button', { name: 'Turn off Google unlock' }).click();
  await page.getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.getByTestId('google-unlock-message')).toContainText('Add a passphrase or passkey first');
  expect(server.asked).not.toContain('DELETE /api/unlock-key');
  expect(errors).toEqual([]);
});

test('turned off: the entry goes, the server deletes its key, and Lock asks for the passphrase', async ({ page }) => {
  const errors = watchErrors(page);
  const server = await fakeServer(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  await toSettings(page);
  const box = page.getByRole('group', { name: 'Google unlock' });
  await box.getByRole('button', { name: 'Turn on Google unlock' }).click();
  await page.getByLabel('Current passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(box.getByTestId('google-unlock-state')).toBeVisible();

  await box.getByRole('button', { name: 'Turn off Google unlock' }).click();
  await page.getByRole('button', { name: 'Turn it off' }).click();
  await expect(box.getByTestId('google-unlock-message')).toHaveText('Google unlock is off.');
  expect(server.asked).toContain('DELETE /api/unlock-key');
  await unlocked(page).click();
  await expect(unlockHeading(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlock with Google' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Google unlock turned off from another device: the button says so, the passphrase still works', async ({ page }) => {
  const errors = watchErrors(page);
  const server = await fakeServer(page);
  await page.goto('/');
  await setUpWithPassphrase(page);
  await toSettings(page);
  const box = page.getByRole('group', { name: 'Google unlock' });
  await box.getByRole('button', { name: 'Turn on Google unlock' }).click();
  await page.getByLabel('Current passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(box.getByTestId('google-unlock-state')).toBeVisible();
  await unlocked(page).click();

  server.keyOn = false; // another device turned it off
  server.fresh = true;
  await page.getByRole('button', { name: 'Unlock with Google' }).click();
  await expect(page.getByRole('alert')).toContainText('turned off');
  await page.getByLabel('Passphrase', { exact: true }).fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(unlocked(page)).toBeVisible();
  expect(errors).toEqual([]);
});
