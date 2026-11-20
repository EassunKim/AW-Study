// The built app in real browsers (desktop Chrome, an Android phone, an iPhone), served with the
// headers visitors get.
import { expect, test, type Page } from './fixtures';
import { APP_NAME } from '../../src/brand';
import { openUnlocked, unlockWithPassphrase } from './lock-helpers';

// Collects page errors and console errors. A blocked script or style (the security policy saying
// no) shows up here, so "no errors" also means "nothing the policy had to block".
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

test('opens with today’s study day and no errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle(APP_NAME); // the %APP_NAME% placeholder was filled in
  await expect(page.getByRole('heading', { name: APP_NAME })).toBeVisible();
  await expect(page.getByTestId('study-day')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('offline-status')).toHaveText(/Ready/);
  expect(errors).toEqual([]);
});

test('the page carries the strict security policy', async ({ request }) => {
  const res = await request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(res.headers()['cache-control']).toBe('no-cache, no-transform');
});

test('is installable: a manifest with icons that load', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest.name).toBe(APP_NAME);
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  expect((await request.get('/icons/apple-touch-icon.png')).status()).toBe(200);
});

test('opens with no connection once it has been visited', async ({ page, context, browserName }) => {
  // Playwright can only take Chromium offline with a service worker in charge
  test.skip(browserName !== 'chromium', 'offline mode with service workers is Chromium-only in Playwright');
  const errors = watchErrors(page);
  await page.goto('/');
  // The service worker has cached the app and taken charge of the page
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: APP_NAME })).toBeVisible();
  await expect(page.getByTestId('study-day')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('the service worker leaves /ai/, /api/ and Cloudflare’s /cdn-cgi/ to the network, so Access and Google can sign you in', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'service workers are only driven reliably in Chromium by Playwright');
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // The test server has no helper behind /ai/ and no sync server behind /api/, so the network answers 404; the app would answer 200
  for (const path of ['/ai/whoami', '/ai', '/api/auth/callback?code=x&state=y', '/api', '/cdn-cgi/access/authorized?nonce=x']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    expect(res?.fromServiceWorker(), path).toBe(false);
  }
  // Every other address still gets the app from the service worker, even one it has never seen
  const other = await page.goto('/some/page');
  expect(other?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Honed' })).toBeVisible();
});

test('a new version never reloads an unlocked app: it waits, says so, and applies on Lock', async ({ page }) => {
  await openUnlocked(page);
  const marked = async () => page.evaluate(() => (window as unknown as { mark?: number }).mark === 1);
  const mark = () => page.evaluate(() => void ((window as unknown as { mark?: number }).mark = 1));
  const newVersion = () => page.evaluate(() => window.dispatchEvent(new Event('honed:update-ready')));

  // Unlocked: no reload (that would ask for the passkey again, or lose a quiz), a banner instead
  await mark();
  await newVersion();
  await expect(page.getByTestId('update-banner')).toContainText('A new version of Honed is ready');
  expect(await marked()).toBe(true);

  // Lock: now it reloads, onto the unlock screen
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await reloaded;
  expect(await marked()).toBe(false);
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();

  // Locked, nothing started: a new version reloads at once
  await mark();
  const again = page.waitForEvent('load');
  await newVersion();
  await again;
  expect(await marked()).toBe(false);
  await unlockWithPassphrase(page);
  await expect(page.getByTestId('update-banner')).toBeHidden();
});
