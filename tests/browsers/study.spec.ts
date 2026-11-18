// Studying by hand, through the real screens, in desktop Chrome, an Android phone and an iPhone
// (WebKit): decks, notes (basic and cloze), reviewing by tapping and by keys, data surviving a
// reload, and working offline. Each test starts with an empty database (a fresh browser context),`n// so it first sets up a passphrase (lock-helpers.ts) and unlocks again after each reload.
import { expect, test, type Page } from '@playwright/test';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  return errors;
}

const deckRow = (page: Page, name: string) => page.getByTestId('deck-row').filter({ hasText: name });

async function addDeck(page: Page, name: string) {
  await page.getByLabel('New deck').fill(name);
  await page.getByRole('button', { name: 'Add deck' }).click();
  await expect(deckRow(page, name)).toBeVisible();
}

async function openDeck(page: Page, name: string) {
  await deckRow(page, name).getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

async function addBasic(page: Page, front: string, back: string) {
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('Front (the question)').fill(front);
  await page.getByLabel('Back (the answer)').fill(back);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('note-row').filter({ hasText: front })).toBeVisible();
}

async function addCloze(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByRole('button', { name: 'Cloze' }).click();
  await page.getByLabel(/Text, with blanks/).fill(text);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible(); // the editor closed
}

test('make, rename and delete a deck', async ({ page }) => {
  const errors = watchErrors(page);
  await openUnlocked(page, '/#/cards');
  await expect(page.getByText('No decks yet')).toBeVisible();
  await addDeck(page, 'Biology');
  await expect(deckRow(page, 'Biology')).toContainText('0 due');

  await page.getByRole('button', { name: 'Rename Biology' }).click();
  await page.getByLabel(/New name for/).fill('Cell biology');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(deckRow(page, 'Cell biology')).toBeVisible();

  // An empty name is refused with a message, nothing changes
  await page.getByRole('button', { name: 'Add deck' }).click();
  await expect(page.getByText('A deck needs a name.')).toBeVisible();

  // Delete asks first, in the page: Cancel keeps the deck, confirming deletes it
  await page.getByRole('button', { name: 'Delete Cell biology' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Delete “Cell biology”?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(deckRow(page, 'Cell biology')).toBeVisible();
  await page.getByRole('button', { name: 'Delete Cell biology' }).click();
  await page.getByRole('button', { name: 'Delete deck' }).click();
  await expect(page.getByText('No decks yet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('write basic and cloze notes; cloze problems show as you type; card text is never HTML', async ({ page }) => {
  const errors = watchErrors(page);
  await openUnlocked(page, '/#/cards');
  await addDeck(page, 'Biology');
  await openDeck(page, 'Biology');

  await addBasic(page, 'What does <b>ATP</b> carry?', 'Energy');
  // Typed markup shows as typed: no bold element appears
  await expect(page.getByTestId('note-row').first()).toContainText('What does <b>ATP</b> carry?');
  await expect(page.locator('.note-row b')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByRole('button', { name: 'Cloze' }).click();
  const text = page.getByLabel(/Text, with blanks/);
  await text.fill('No blanks here');
  await expect(page.getByTestId('cloze-problem')).toBeVisible();
  await text.fill('{{c1::Mitochondria}} make {{c2::ATP::a molecule}}');
  await expect(page.getByTestId('cloze-problem')).toHaveCount(0);
  await expect(page.getByTestId('cloze-preview')).toHaveCount(2);
  await expect(page.getByTestId('cloze-preview').nth(1)).toContainText('[a molecule]');
  await page.getByRole('button', { name: 'Add note' }).click();

  await expect(page.getByTestId('note-row')).toHaveCount(2);
  await expect(page.getByText('Cloze, 2 cards')).toBeVisible();
  await expect(page.getByText('3 new')).toBeVisible();
  expect(errors).toEqual([]);
});

test('study a deck by tapping and by keys; a sibling waits; everything survives a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await openUnlocked(page, '/#/cards');
  await addDeck(page, 'Biology');
  await openDeck(page, 'Biology');
  await addBasic(page, 'What carries energy in cells?', 'ATP');
  await addCloze(page, '{{c1::Mitochondria}} make {{c2::ATP}}');
  await page.getByRole('link', { name: 'Study' }).click();

  // Card 1, the basic note: the answer is hidden until asked for
  const card = page.getByTestId('review-card');
  await expect(card).toContainText('What carries energy in cells?');
  await expect(card).not.toContainText('ATP');
  await expect(page.getByTestId('review-left')).toHaveText('2 to go'); // the cloze's 2nd card waits (sibling)
  await page.getByRole('button', { name: /Show answer/ }).click();
  await expect(card).toContainText('ATP');
  for (const rating of [1, 2, 3, 4]) await expect(page.getByTestId(`when-${rating}`)).not.toBeEmpty();
  await page.getByRole('button', { name: /^Good/ }).click();

  // Card 2, cloze number 1, by keyboard: Space shows the answer, 3 is Good
  await expect(page.getByTestId('cloze-blank')).toHaveText('[…]');
  await expect(card).toContainText('make ATP'); // the other cloze shows as plain text
  await page.keyboard.press('Space');
  await expect(page.getByTestId('cloze-answer')).toHaveText('Mitochondria');
  await page.keyboard.press('3');

  // Both answered "Good" come back in minutes, and cloze 2 waits for another day
  await expect(page.getByTestId('review-done')).toContainText('You reviewed 2 cards');

  await reloadUnlocked(page);
  await expect(page.getByTestId('review-done')).toContainText('Nothing is due');
  await page.getByRole('link', { name: 'Back to the deck' }).click();
  await expect(page.getByText('0 due')).toBeVisible();
  await expect(page.getByText('1 new')).toBeVisible();
  await expect(page.getByTestId('note-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('edit and delete a note', async ({ page }) => {
  const errors = watchErrors(page);
  await openUnlocked(page, '/#/cards');
  await addDeck(page, 'Chemistry');
  await openDeck(page, 'Chemistry');
  await addBasic(page, 'Symbol for sodium?', 'Na');
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Back (the answer)').fill('Na (natrium)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.getByRole('button', { name: 'Delete note' }).last().click(); // the dialog's button
  await expect(page.getByTestId('note-row')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a missing deck or page says so', async ({ page }) => {
  await openUnlocked(page, '/#/cards');
  await page.goto('/#/cards/deck/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Deck not found' })).toBeVisible();
  await page.goto('/#/cards/review/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Deck not found' })).toBeVisible();
  await page.goto('/#/nonsense');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('works offline: make a deck and a note with no connection', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline mode with service workers is Chromium-only in Playwright');
  const errors = watchErrors(page);
  await openUnlocked(page, '/#/cards');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await reloadUnlocked(page);
  await addDeck(page, 'Offline deck');
  await openDeck(page, 'Offline deck');
  await addBasic(page, 'Made offline?', 'Yes');
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
