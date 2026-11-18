// Setting up and unlocking through the real screens (#17), for every browser test. Each test
// starts with an empty database (a fresh browser context), so the first visit shows setup and a
// reload shows the unlock screen.
import { expect, type Page } from '@playwright/test';

export const PASSPHRASE = 'paper lantern river cobalt';

const decksHeading = (page: Page) => page.getByRole('heading', { level: 2, name: 'Decks' });

/** Sets up with a passphrase (from the setup screen) and returns the recovery key it showed. */
export async function setUpWithPassphrase(page: Page, passphrase = PASSPHRASE): Promise<string> {
  await page.getByRole('button', { name: 'Use a passphrase' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Type it again').fill(passphrase);
  await page.getByRole('button', { name: 'Continue' }).click();
  const recoveryKey = await readRecoveryKey(page);
  await confirmRecoveryKey(page, recoveryKey);
  await page.getByRole('button', { name: /I’ve saved it/ }).click();
  await expect(decksHeading(page)).toBeVisible();
  return recoveryKey;
}

/** The recovery key on screen, as "XXXX-XXXX-…". */
export async function readRecoveryKey(page: Page): Promise<string> {
  const groupsShown = page.getByTestId('recovery-key').locator('span');
  await expect(groupsShown).toHaveCount(8); // waits: making the keys takes about half a second
  const groups = await groupsShown.allInnerTexts();
  expect(groups).toHaveLength(8);
  return groups.map((g) => g.trim()).join('-');
}

/** Types back the group the sheet asks for. */
export async function confirmRecoveryKey(page: Page, recoveryKey: string): Promise<void> {
  const label = page.getByText(/type group \d of your recovery key/);
  const group = Number((await label.innerText()).match(/group (\d)/)![1]);
  await page.getByLabel(/type group \d of your recovery key/).fill(recoveryKey.split('-')[group - 1]!);
}

export async function unlockWithPassphrase(page: Page, passphrase = PASSPHRASE): Promise<void> {
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Unlock/ })).toBeHidden();
}

/** Opens `path`, setting up on a first visit or unlocking after that. */
export async function openUnlocked(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  const setup = page.getByRole('button', { name: 'Use a passphrase' });
  const unlock = page.getByRole('heading', { name: /^Unlock/ });
  await expect(setup.or(unlock)).toBeVisible();
  if (await setup.isVisible()) await setUpWithPassphrase(page);
  else await unlockWithPassphrase(page);
}

/** Reloads (which locks) and unlocks again. */
export async function reloadUnlocked(page: Page): Promise<void> {
  await page.reload();
  await unlockWithPassphrase(page);
}
