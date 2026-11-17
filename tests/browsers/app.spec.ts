// The built app in real browsers (desktop Chrome, an Android phone, an iPhone), served with the
// headers visitors get.
import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.getByRole('heading', { name: 'AW-Study' })).toBeVisible();
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
  expect(manifest.name).toBe('AW-Study');
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
  await expect(page.getByRole('heading', { name: 'AW-Study' })).toBeVisible();
  await expect(page.getByTestId('study-day')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
