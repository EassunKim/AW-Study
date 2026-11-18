// Today's checklist and Play (#47) through the real screens, in desktop Chrome, an Android phone and
// an iPhone (WebKit), on a clock the test controls (Wednesday Nov 18, 2026, 10:00 in Los Angeles).
// /ai/ is answered by the test, like the helper (service workers off so Playwright sees it).
import { expect, test, type Page } from '@playwright/test';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

async function fakeHelper(page: Page) {
  await page.route('**/ai/questions', async (route) => {
    const body = route.request().postDataJSON() as { pages: { page: number }[]; count: number };
    const questions = Array.from({ length: body.count }, (_, i) => ({
      question: `Question ${i + 1} about slide ${body.pages[i % body.pages.length]!.page}?`,
      options: [`Right ${i + 1}`, `Wrong ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
      answer: 0,
      page: body.pages[i % body.pages.length]!.page,
      explanation: 'Because the slide says so.',
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
}

/** A class with yesterday's 30-minute lecture on slides 2-4, back on the home screen. */
async function lectureYesterday(page: Page, className: string, minutes = 30) {
  await addClass(page, className);
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel(/Upload the slides|Or upload a new PDF/).setInputFiles(pdfFile(`${className}.pdf`, numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-17');
  await form.getByLabel('Minutes').fill(String(minutes));
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toHaveCount(1);
  await page.getByRole('link', { name: '← Classes' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T10:00:00-08:00') });
  await fakeHelper(page);
});

test('yesterday’s lecture is on today’s list; Play runs its session, offers the quiz at 80%, and ticks it off', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'BIO 110');

  // Day 1 of the first week: a third of 30 minutes, then a quiz
  const items = page.getByTestId('today-item');
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('Study BIO 110 · BIO 110, slides 2–4');
  await expect(items).toContainText('10 min, then a 5-question quiz · session 1 of 3');
  await expect(page.getByTestId('today-minutes')).toContainText('10 min planned of 60 min a day');

  // "Stop for now" changes nothing
  await page.getByRole('link', { name: '▶ Play' }).click();
  await expect(page.getByTestId('study-timer')).toHaveText('10:00 left');
  await page.getByRole('link', { name: 'Stop for now' }).click();
  await expect(items).toHaveCount(1);

  // The session: slides with a timer; the quiz is offered at 80% (8 of 10 minutes)
  await page.getByRole('link', { name: '▶ Play' }).click();
  await expect(page.getByTestId('play-position')).toHaveText('1 of 1');
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 4');
  await expect(page.getByTestId('study-prompt')).toBeHidden();
  await page.clock.fastForward('07:50');
  await expect(page.getByTestId('study-prompt')).toBeHidden();
  await page.clock.fastForward('00:15');
  await expect(page.getByTestId('study-prompt')).toContainText('Time for the quiz');
  await expect(page.getByTestId('study-timer')).toHaveText(/^1:5\d left$/);
  await page.getByRole('button', { name: 'I’m ready for the quiz' }).click();

  // No questions yet: make them right here, and the quiz starts
  await page.getByRole('button', { name: 'Make questions' }).click();
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId('quiz-position')).toHaveText(`Question ${n} of 5`);
    await page.getByRole('group', { name: 'Answers' }).getByRole('button', { name: /Right/ }).click();
    await page.getByTestId('quiz-feedback').getByRole('button', { name: n < 5 ? 'Next question' : 'See your score' }).click();
  }
  await expect(page.getByTestId('quiz-score')).toHaveText('5 of 5 right (100%)');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByTestId('play-done')).toContainText('1 of 1 item done');

  // Home: done for today, and the 8 minutes count against the day
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByText('All done for today.')).toBeVisible();
  await expect(page.getByTestId('today-minutes')).toContainText('8 min done · Nothing left for today of 60 min a day');
  await reloadUnlocked(page);
  await expect(page.getByText('All done for today.')).toBeVisible();
  expect(await problems()).toEqual([]);
});

test('the daily minutes decide what fits today; the rest waits', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await lectureYesterday(page, 'CHEM 101');
  await lectureYesterday(page, 'PHYS 150');
  await expect(page.getByTestId('today-item')).toHaveCount(2);

  // Ten minutes a day: one session fits, the other waits
  await page.getByRole('button', { name: 'change' }).click();
  const form = page.getByRole('form', { name: 'Daily study time' });
  await form.getByLabel('Minutes a day').fill('5');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toContainText('10 to 600');
  await form.getByLabel('Minutes a day').fill('10');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('today-minutes')).toContainText('10 min planned of 10 min a day');
  await expect(page.getByTestId('today-item')).toHaveCount(1);
  await expect(page.getByTestId('later-count')).toContainText('1 more waiting');
  await reloadUnlocked(page);
  await expect(page.getByTestId('today-minutes')).toContainText('of 10 min a day');
  expect(await problems()).toEqual([]);
});
