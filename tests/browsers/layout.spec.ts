// Layout checks from real-phone findings (#84), on desktop, Android and iPhone.
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, toClasses, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

/** Nothing on the page is wider than the window: no sideways scrolling. */
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

// A real file name from Nathan's iPhone (Nov 19): a long hash with no spaces to break at
const LONG = '60b12469c48ab3fc4e0cc9da0c170de8_lecture02_s05_introduction_to_everything.pdf';

test('a long file name wraps in “What was covered?” instead of pushing the page sideways', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'Test 01');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel(/Upload the slides|Or upload a new PDF/).setInputFiles(pdfFile(LONG, numberedSlides(12)));
  await form.getByLabel('Lecture date').fill('2026-11-13');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('1');
  await form.getByLabel('Last slide').fill('8');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await expect(page.getByTestId('chosen-slides')).toContainText('60b12469');
  expect(await scrollsSideways(page)).toBe(false); // the new file's line
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toHaveCount(1);

  // The next lecture: the deck is a button to carry on in, and chosen
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const deck = page.getByRole('group', { name: 'Slide decks' }).getByRole('button');
  await expect(deck).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('chosen-slides')).toContainText('the last lecture ended at slide 8');
  expect(await scrollsSideways(page)).toBe(false);
  const box = (await deck.boundingBox())!;
  const window = page.viewportSize()!;
  expect(box.x + box.width).toBeLessThanOrEqual(window.width);
  expect(await problems()).toEqual([]);
});

test('the Classes page title stands apart from the class names', async ({ page }) => {
  await openUnlocked(page);
  await addClass(page, 'math');
  await page.getByRole('link', { name: '← Classes' }).click();
  await toClasses(page).catch(() => undefined);
  const size = (selector: string) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const title = await size('#classes-title');
  const name = await size('h3.class-name');
  expect(title).toBeGreaterThanOrEqual(name * 1.25);
  const gap = await page.evaluate(() => {
    const t = document.querySelector('#classes-title')!.getBoundingClientRect();
    const n = document.querySelector('h3.class-name')!.getBoundingClientRect();
    return n.top - t.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(16);
});
