// Quizzes (#40) through the real screens and the real AI client (src/ai/http.ts), in desktop Chrome,
// an Android phone and an iPhone (WebKit). The test answers /ai/ itself, the way the helper does, so
// nothing is spent or sent. Service workers are off here: Playwright's routing doesn't see requests a
// service worker makes.
import { expect, test, type Page, type Route } from '@playwright/test';
import { numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

test.use({ serviceWorkers: 'block' });

interface AskedFor {
  pages: { page: number; text: string }[];
  count: number;
  avoid?: string[];
}

/** Answers /ai/questions like the helper: `count` questions over the slides sent, "Right n" being right. */
async function fakeHelper(page: Page) {
  const asked: AskedFor[] = [];
  await page.route('**/ai/questions', async (route: Route) => {
    const body = route.request().postDataJSON() as AskedFor;
    asked.push(body);
    const questions = Array.from({ length: body.count }, (_, i) => {
      const slide = body.pages[i % body.pages.length]!;
      return {
        question: `Question ${asked.length}.${i + 1} about slide ${slide.page}?`,
        options: [`Wrong ${i + 1}`, `Right ${i + 1}`, `Other ${i + 1}`, `Else ${i + 1}`],
        answer: 1,
        page: slide.page,
        explanation: `Slide ${slide.page} explains it.`,
      };
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
  });
  return asked;
}

/** A class with a lecture that covered slides 2-4 of a 4-slide PDF, ending on the class page. */
async function classWithLecture(page: Page) {
  await openUnlocked(page);
  await addClass(page, 'BIO 110');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  const form = page.getByRole('form', { name: 'What was covered?' });
  await form.getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(4)));
  await form.getByLabel('Lecture date').fill('2026-11-16');
  await form.getByLabel('Minutes').fill('50');
  await form.getByLabel('First slide').fill('2');
  await form.getByLabel('Last slide').fill('4');
  await form.getByRole('button', { name: 'Save lecture' }).click();
  await expect(page.getByTestId('lecture-row')).toContainText('Cells, slides 2–4');
}

const quizLink = (page: Page) => page.getByRole('link', { name: 'Quiz on Cells, slides 2–4' });

test('make a section’s questions with AI, take a quiz with feedback and the slide, and keep the score', async ({ page }) => {
  const problems = await watchProblems(page);
  const asked = await fakeHelper(page);
  await classWithLecture(page);
  await quizLink(page).click();
  await expect(page.getByRole('heading', { level: 2, name: /Quiz: Cells/ })).toBeVisible();
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet');

  // Make questions: only the section's slide text goes, never the PDF
  await page.getByRole('button', { name: 'Make questions' }).click();
  await expect(page.getByTestId('bank-size')).toHaveText('10 questions in this section’s bank.');
  expect(asked).toHaveLength(1);
  expect(asked[0]!.count).toBe(10); // 3 slides: at least 10
  expect(asked[0]!.pages.map((p) => p.page)).toEqual([2, 3, 4]);
  expect(asked[0]!.pages[0]!.text).toContain('Slide 2');
  expect(JSON.stringify(asked[0])).not.toContain('%PDF');

  // From here on the quiz needs no AI at all
  const aiCalls: string[] = [];
  await page.route('**/ai/**', (route) => (aiCalls.push(route.request().url()), route.abort()));

  await page.getByRole('button', { name: 'Start the quiz (5 questions)' }).click();
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByTestId('quiz-position')).toHaveText(`Question ${n} of 5`);
    const answers = page.getByRole('group', { name: 'Answers' });
    const pick = n <= 3 ? /Right/ : /Wrong/; // three right, two wrong
    await answers.getByRole('button', { name: pick }).click();
    const feedback = page.getByTestId('quiz-feedback');
    if (n <= 3) await expect(feedback).toContainText('Right.');
    else await expect(feedback).toContainText(/Not quite\. The answer is [A-D]: Right \d+\./);
    await expect(feedback).toContainText(/Slide \d explains it\./);
    await expect(answers.getByRole('button')).toHaveCount(4);
    for (const option of await answers.getByRole('button').all()) await expect(option).toBeDisabled(); // one try
    if (n === 1) {
      // The slide it came from, right here
      const slide = Number((await feedback.getByRole('button', { name: /Show slide/ }).innerText()).match(/\d+/)![0]);
      await feedback.getByRole('button', { name: /Show slide/ }).click();
      await expect(page.getByTestId('slide-position')).toHaveText(`Slide ${slide} of 4`);
    }
    await feedback.getByRole('button', { name: n < 5 ? 'Next question' : 'See your score' }).click();
  }
  await expect(page.getByTestId('quiz-score')).toHaveText('3 of 5 right (60%)');
  await expect(page.getByTestId('quiz-done').getByRole('listitem')).toHaveCount(2); // the two to look at again
  expect(aiCalls).toEqual([]);

  // The score stays: on the quiz page, on the class page, and after a reload
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('last-score')).toHaveText('Last quiz: 3 of 5 right (60%)');
  await page.getByRole('link', { name: '← BIO 110' }).click();
  await expect(page.getByTestId('section-last-quiz')).toContainText('3 of 5 right (60%)');
  await reloadUnlocked(page);
  await expect(page.getByTestId('section-last-quiz')).toContainText('3 of 5 right (60%)');
  expect(await problems()).toEqual([]);
});

test('when the AI can’t be used, it says why, and a lapsed sign-in offers to sign in again', async ({ page }) => {
  const problems = await watchProblems(page);
  await classWithLecture(page);
  await quizLink(page).click();
  const replies: [number, unknown][] = [
    [401, { error: 'Not signed in through Cloudflare Access.' }],
    [429, { error: 'Today’s AI limit (200) is reached. It resets at midnight UTC.' }],
    [200, { questions: [{ question: 'Broken', options: ['only one'], answer: 0, page: 2 }] }],
  ];
  let reply = 0;
  await page.route('**/ai/questions', (route) => {
    const [status, body] = replies[reply++]!;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const make = page.getByRole('button', { name: 'Make questions' });

  await make.click();
  await expect(page.getByRole('alert')).toHaveText('Sign in again to use AI.');
  await expect(page.getByRole('link', { name: 'Sign in for AI' })).toHaveAttribute('href', '/ai/whoami');
  await make.click();
  await expect(page.getByRole('alert')).toContainText('Today’s AI limit');
  await expect(page.getByRole('link', { name: 'Sign in for AI' })).toBeHidden();
  await make.click();
  await expect(page.getByRole('alert')).toContainText('wasn’t usable');
  await expect(page.getByTestId('bank-size')).toContainText('No questions yet'); // nothing half-made was kept
  await expect(page.getByRole('button', { name: /Start the quiz/ })).toBeHidden();
  // The CSP blocks nothing here, and the failed requests are the test's own 401 and 429 answers
  expect((await problems()).filter((p) => !/status of (401|429)/.test(p))).toEqual([]);
});
