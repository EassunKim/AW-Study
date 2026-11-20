// Remembering a device (#99), through the real screens on desktop, an Android phone and an iPhone:
// remembered at setup, a reload opens straight in; Lock and Settings' Forget make it ask again; unlocking
// with the box ticked remembers again, unticked doesn't; the key kept can't be read out of the page; a
// damaged one is forgotten and the screen asks.
import { expect, test, type Page } from './fixtures';
import { addClassAndReturn, navBar } from './class-helpers';
import { setUpWithPassphrase, unlockWithPassphrase } from './lock-helpers';

const unlockHeading = (page: Page) => page.getByRole('heading', { name: /^Unlock/ });
/** The header's Lock button: there on every page once unlocked, whichever page a reload reopens. */
const unlocked = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Lock', exact: true });

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** Reloads and says whether it opened straight in (true) or asked (false). */
async function reloadOpensStraightIn(page: Page): Promise<boolean> {
  await page.reload();
  await expect(unlocked(page).or(unlockHeading(page))).toBeVisible();
  return unlocked(page).isVisible();
}

async function toSettings(page: Page) {
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
}

test('remembered at setup, a reload opens straight in; Lock and Forget make it ask; the box decides', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  // Setup offers it, ticked
  await page.getByRole('button', { name: 'Use a passphrase' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('paper lantern river cobalt');
  await page.getByLabel('Type it again').fill('paper lantern river cobalt');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Remember this device')).toBeChecked();
  await page.goto('about:blank'); // start again: the helper does the rest of setup
  await page.goto('/');
  await setUpWithPassphrase(page, undefined, { remember: true });
  await addClassAndReturn(page, 'Chemistry');

  // Straight in, with the data
  expect(await reloadOpensStraightIn(page)).toBe(true);
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByText('Chemistry')).toBeVisible();
  expect(await reloadOpensStraightIn(page)).toBe(true);
  await toSettings(page);
  await expect(page.getByTestId('remember-status')).toContainText('remembers your unlock');

  // Lock forgets: the reload after asks too
  await unlocked(page).click();
  await expect(unlockHeading(page)).toBeVisible();
  expect(await reloadOpensStraightIn(page)).toBe(false);

  // Unlocking with the box ticked (as it is by default) remembers again
  await expect(page.getByLabel('Remember this device')).toBeChecked();
  await unlockWithPassphrase(page, undefined, { remember: true });
  expect(await reloadOpensStraightIn(page)).toBe(true);

  // Settings' Forget: still unlocked now, asks next time
  await toSettings(page);
  await page.getByRole('button', { name: 'Forget the unlock on this device' }).click();
  await expect(page.getByTestId('remember-status')).toContainText('Forgotten.');
  await expect(unlocked(page)).toBeVisible();
  expect(await reloadOpensStraightIn(page)).toBe(false);

  // Unticked: not remembered
  await unlockWithPassphrase(page, undefined, { remember: false });
  expect(await reloadOpensStraightIn(page)).toBe(false);
  expect(errors).toEqual([]);
});

test('the remembered key can’t be read out of the page, and a damaged one is forgotten', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await setUpWithPassphrase(page, undefined, { remember: true });

  const readRemembered = () =>
    page.evaluate(
      () =>
        new Promise<{ extractable: boolean; exported: string } | null>((resolve, reject) => {
          const open = indexedDB.open('honed');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const get = open.result.transaction('meta').objectStore('meta').get('remembered');
            get.onsuccess = async () => {
              open.result.close();
              const row = get.result as { value: { deviceKey: CryptoKey } } | undefined;
              if (!row) return resolve(null);
              const key = row.value.deviceKey;
              const exported = await crypto.subtle.exportKey('raw', key).then(
                () => 'exported',
                (e: Error) => e.name,
              );
              resolve({ extractable: key.extractable, exported });
            };
          };
        }),
    );
  expect(await readRemembered()).toEqual({ extractable: false, exported: 'InvalidAccessError' });

  // Damage it, as if the data had been replaced from somewhere else
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('honed');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction('meta', 'readwrite').objectStore('meta');
          const get = store.get('remembered');
          get.onsuccess = () => {
            const row = get.result as { key: string; value: { wrapped: Uint8Array } };
            row.value.wrapped = new Uint8Array(row.value.wrapped.length); // zeros
            const put = store.put(row);
            put.onsuccess = () => {
              open.result.close();
              resolve();
            };
          };
        };
      }),
  );
  expect(await reloadOpensStraightIn(page)).toBe(false);
  await expect(page.getByTestId('remember-failed')).toContainText('didn’t work any more');
  expect(await readRemembered()).toBeNull();
  await unlockWithPassphrase(page);
  expect(errors).toEqual([]);
});
