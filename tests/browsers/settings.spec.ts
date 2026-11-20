// Settings on one page (#79, restyle step 4): the AI sign-in check and Compare models, through the real
// screens on desktop, an Android phone and an iPhone. The test answers /ai/ itself: nothing is spent
// or sent.
import { expect, test, type Page } from './fixtures';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, navBar, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' }); // Playwright's routing doesn't see a service worker's requests

async function toSettings(page: Page) {
  await navBar(page).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Settings', exact: true })).toBeVisible();
}

test('Settings checks the AI sign-in only when asked, and says signed in, signed out or not allowed', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked: string[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: { email: 'student@example.com', ready: true, usedToday: 3, dailyLimit: 200 } };
  await page.route('**/ai/**', async (route) => {
    asked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });
  await openUnlocked(page);
  await toSettings(page);
  const ai = page.getByRole('group', { name: 'AI' });
  const status = ai.getByTestId('ai-status');
  await expect(ai.getByRole('button', { name: 'Check AI sign-in' })).toBeVisible();
  expect(asked).toEqual([]); // opening Settings sends nothing

  await ai.getByRole('button', { name: 'Check AI sign-in' }).click();
  await expect(status).toHaveText('Signed in for AI as student@example.com. 3 of 200 AI requests used today.');
  expect(asked).toEqual(['GET /ai/whoami']);

  reply = { status: 401, body: { error: 'Not signed in.' } };
  await ai.getByRole('button', { name: 'Check AI sign-in' }).click();
  await expect(status).toHaveText('You’re not signed in for AI.');
  await expect(ai.getByRole('link', { name: 'Sign in for AI' })).toHaveAttribute('href', /^\/ai\/signin\?then=%2F%23%2Fsettings$/);

  reply = { status: 403, body: { email: 'other@example.com', ready: false, error: 'This account can’t use the AI helper.' } };
  await ai.getByRole('button', { name: 'Check AI sign-in' }).click();
  await expect(status).toHaveText('This account can’t use the AI helper.');
  expect(asked).toHaveLength(3);
  // The browser logs the answers we asked for (401, 403); nothing else may go wrong
  expect((await problems()).filter((p) => !/status of (401|403)/.test(p))).toEqual([]);
});

test('Compare models in Settings opens a recent lecture’s quiz screen with the comparison showing', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.route('**/ai/**', (route) => route.abort()); // nothing is run in this test
  await openUnlocked(page);
  await toSettings(page);
  await expect(page.getByText('Nothing to compare yet')).toBeVisible();

  await addClass(page, 'BIO 110');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByLabel(/Make quiz questions now/).uncheck();
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('Cells, slides 2–4');
  await page.getByRole('link', { name: '← Classes' }).click();

  await toSettings(page);
  const choices = page.getByRole('list', { name: 'Compare models' });
  await expect(choices.getByRole('link')).toHaveText(['BIO 110: Cells, slides 2–4']);
  await choices.getByRole('link').click();
  await expect(page).toHaveURL(/#\/class\/[^/]+\/quiz\/[^/]+\/compare$/);
  await expect(page.getByRole('heading', { level: 2, name: /Quiz: Cells/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Compare models' })).toBeVisible();
  expect(await problems()).toEqual([]);
});
