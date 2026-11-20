// The look (#68, docs/design/README.md): the nav bar on the three main pages, the Phone / Light / Dark
// setting (kept on the device, so the unlock screen has it too) and the bundled font. Desktop Chrome,
// an Android phone and an iPhone (WebKit).
import { expect, test, type Page } from '@playwright/test';
import { addClass, navBar, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

const GREY = 'rgb(39, 39, 39)'; // #272727
const WHITE = 'rgb(242, 245, 241)'; // #f2f5f1
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const barColour = (page: Page) => page.locator('meta[name="theme-color"]').getAttribute('content');

test('the nav bar goes between Tasks, Classes and Settings, showing where you are; full-screen screens hide it', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  const nav = navBar(page);
  const current = nav.locator('[aria-current="page"]');

  // Tasks is the home page
  await expect(page.getByRole('heading', { level: 2, name: 'Tasks' })).toBeVisible();
  await expect(current).toHaveAccessibleName('Tasks');
  await expect(current).toHaveCount(1);

  await nav.getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes' })).toBeVisible();
  await expect(page).toHaveURL(/#\/classes$/);
  await expect(current).toHaveAccessibleName('Classes');

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await expect(current).toHaveAccessibleName('Settings');
  // The bar never covers the end of a long page (Settings, once all of it is there, is longer than the screen)
  await expect(page.getByRole('button', { name: 'Lock now' })).toBeVisible();
  await expect(async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const bar = (await nav.boundingBox())!;
    const lastLine = (await page.getByRole('contentinfo').locator('span').last().boundingBox())!;
    expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(bar.y);
  }).toPass();

  // A class's own screen is full-screen: no bar, a back link instead
  await addClass(page, 'COMP 2000');
  await expect(nav).toBeHidden();
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(current).toHaveAccessibleName('Classes');

  await nav.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('tasks-empty')).toContainText('Nothing to study yet');
  expect(await problems()).toEqual([]);
});

test('Phone, Light or Dark: chosen in Settings, kept on this device, and used on the unlock screen too', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page);
  expect(await background(page)).toBe(WHITE); // Phone, the default, follows the phone
  expect(await barColour(page)).toBe('#f2f5f1');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => background(page)).toBe(GREY);
  await expect.poll(() => barColour(page)).toBe('#272727');

  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  const colours = page.getByRole('group', { name: 'Colours' });
  await expect(colours.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true');

  // Light, though the phone is dark
  await colours.getByRole('button', { name: 'Light' }).click();
  await expect(colours.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(await background(page)).toBe(WHITE);
  expect(await barColour(page)).toBe('#f2f5f1');

  // A reload locks: the unlock screen is already light
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  expect(await background(page)).toBe(WHITE);

  // Dark, though the phone is light
  await page.emulateMedia({ colorScheme: 'light' });
  await openUnlocked(page, '/#/settings');
  await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Dark' }).click();
  expect(await background(page)).toBe(GREY);
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  expect(await background(page)).toBe(GREY);

  // Back to Phone: nothing kept, the phone decides again
  await openUnlocked(page, '/#/settings');
  await page.getByRole('group', { name: 'Colours' }).getByRole('button', { name: 'Phone' }).click();
  expect(await background(page)).toBe(WHITE);
  expect(await page.evaluate(() => localStorage.getItem('honed:theme'))).toBeNull();
  expect(await problems()).toEqual([]);
});

test('the font is bundled with the app: loaded from this site, within the security policy', async ({ page, baseURL }) => {
  const problems = await watchProblems(page);
  const fonts: string[] = [];
  page.on('request', (r) => r.resourceType() === 'font' && fonts.push(r.url()));
  await openUnlocked(page);
  await expect.poll(() => page.evaluate(() => document.fonts.check('16px "Lexend Variable"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Lexend Variable"?,/);
  expect(fonts.length).toBeGreaterThan(0);
  for (const url of fonts) expect(url.startsWith(`${baseURL}/assets/lexend-`), url).toBe(true);
  expect(await problems()).toEqual([]);
});
