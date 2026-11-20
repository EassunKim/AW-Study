// Settings' Account box (#95, sync step 1), through the real screens on desktop, an Android phone and an
// iPhone. The test answers /api/ itself (no sync server here): it checks the box asks only when told, says
// signed in, signed out or unavailable, signs out as JSON from our own page, and links to the sign-in.
import { expect, test, type Page } from './fixtures';
import { navBar, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

async function toSettings(page: Page) {
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
}

test('the Account box checks only when asked, signs out, and links to Google sign-in', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked: { method: string; path: string; type: string | null; body: string | null }[] = [];
  let me: { status: number; body: unknown } = { status: 200, body: { signedIn: false } };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    asked.push({ method: req.method(), path, type: req.headers()['content-type'] ?? null, body: req.postData() });
    if (path === '/api/auth/signout') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"signedIn":false}' });
    await route.fulfill({ status: me.status, contentType: 'application/json', body: JSON.stringify(me.body) });
  });
  await openUnlocked(page);
  await toSettings(page);
  const box = page.getByRole('group', { name: 'Account (testing)' });
  const status = box.getByTestId('account-status');
  await expect(box.getByRole('button', { name: 'Check account' })).toBeVisible();
  await expect(box.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', '/api/auth/google?then=%2F%23%2Fsettings');
  expect(asked).toEqual([]); // opening Settings asks the server nothing

  await box.getByRole('button', { name: 'Check account' }).click();
  await expect(status).toHaveText('Not signed in on this device.');

  me = { status: 200, body: { signedIn: true, email: 'student@example.com', device: 'd1' } };
  await box.getByRole('button', { name: 'Check account' }).click();
  await expect(status).toHaveText('Signed in as student@example.com.');
  await expect(box.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0);

  await box.getByRole('button', { name: 'Sign out' }).click();
  await expect(status).toHaveText('Not signed in on this device.');
  await expect(box.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  const out = asked.find((a) => a.path === '/api/auth/signout')!;
  expect(out).toEqual({ method: 'POST', path: '/api/auth/signout', type: 'application/json', body: '{}' });
  expect(asked.every((a) => a.method === 'GET' ? a.body === null : a.body === '{}')).toBe(true); // nothing of yours is sent

  // No sync server behind /api/ (this site, or one where it isn't set up)
  me = { status: 404, body: { error: 'Not found' } };
  await box.getByRole('button', { name: 'Check account' }).click();
  await expect(status).toHaveText('Sync isn’t available here yet.');

  // The browser logs that deliberate 404 (Chromium does; WebKit may not): nothing else may appear
  const notFound = 'console: Failed to load resource: the server responded with a status of 404 (Not Found)';
  expect((await problems()).filter((p) => p !== notFound)).toEqual([]);
});
