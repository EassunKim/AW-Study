// Classes, lectures and slides (#26) through the real screens, in desktop Chrome, an Android phone
// and an iPhone (WebKit): add a class, upload slides and say what a lecture covered, open them in
// the viewer, and find everything again after a reload. Checks for errors and Content-Security-
// Policy violations throughout. PDFs are made in the test.
import { expect, test, type Page } from '@playwright/test';
import { makePdf, numberedSlides } from '../../src/viewer/test-pdf';
import { addClass, classRow, pdfFile, watchProblems } from './class-helpers';
import { openUnlocked, reloadUnlocked } from './lock-helpers';

const lectureRow = (page: Page) => page.getByTestId('lecture-row');
const lectureForm = (page: Page) => page.getByRole('form', { name: 'What was covered?' });
const slides = (page: Page, n: number) => lectureForm(page).getByRole('group', { name: `Slides ${n}` });

async function record(page: Page, { date, minutes, first, last }: { date?: string; minutes?: number; first: number; last: number }) {
  const form = lectureForm(page);
  if (date) await form.getByLabel('Lecture date').fill(date);
  if (minutes) await form.getByLabel('Minutes').fill(String(minutes));
  await slides(page, 1).getByLabel('First slide').fill(String(first));
  await slides(page, 1).getByLabel('Last slide').fill(String(last));
  await form.getByRole('button', { name: 'Save lecture' }).click();
}

test('add a class, record a lecture with new slides, view them, and find it all after a reload', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await expect(page.getByText('No classes yet')).toBeVisible();

  await addClass(page, 'CHEM 101', { days: ['Mon', 'Wed', 'Fri'], start: '10:30', minutes: 50 });
  await expect(page.getByTestId('class-times')).toHaveText('Mon, Wed, Fri 10:30 am, 50 min');

  // What was covered: upload a PDF, give a range past its end (refused), then a good one
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Week 4.pdf', numberedSlides(5)));
  await expect(slides(page, 1).getByTestId('chosen-slides')).toHaveText('Week 4: 5 slides (new)');
  await record(page, { date: '2026-11-16', minutes: 50, first: 4, last: 9 });
  await expect(lectureForm(page).getByRole('alert')).toHaveText('“Week 4” has only 5 slides.');
  await record(page, { first: 5, last: 2 });
  await expect(lectureForm(page).getByRole('alert')).toHaveText('The first slide comes before the last one.');
  // Nothing stored by the refused tries: the PDF is still new (once stored, it's a deck of the class)
  await expect(slides(page, 1).getByTestId('chosen-slides')).toHaveText('Week 4: 5 slides (new)');
  await expect(page.getByTestId('deck-row')).toHaveCount(0);
  await record(page, { first: 2, last: 4 });
  await expect(lectureForm(page)).toBeHidden();
  await expect(lectureRow(page)).toHaveCount(1);
  await expect(lectureRow(page)).toContainText('Mon, Nov 16');
  await expect(lectureRow(page)).toContainText('Week 4, slides 2–4');
  await expect(lectureRow(page)).toContainText('50 min to study');
  await expect(page.getByTestId('deck-row')).toContainText('Week 4');
  await expect(page.getByTestId('deck-row')).toContainText('5 slides');

  // The section opens in the viewer at its first slide, with its range marked
  await lectureRow(page).getByRole('link', { name: 'Week 4, slides 2–4', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Week 4/ })).toContainText('slides 2–4');
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 5');
  await expect(page.getByTestId('slide-page')).toHaveAttribute('data-rendered', '2');

  // A reload locks; after unlocking, the same slides are there (straight from the address)
  await reloadUnlocked(page);
  await expect(page.getByTestId('slide-position')).toHaveText('Slide 2 of 5');
  await page.getByRole('link', { name: '← CHEM 101' }).click();
  await expect(lectureRow(page)).toContainText('Week 4, slides 2–4');
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(classRow(page, 'CHEM 101')).toContainText('1 lecture · 1 slide deck');
  await expect(page.getByRole('list', { name: 'Latest lectures' })).toContainText('Week 4, slides 2–4');

  expect(await problems()).toEqual([]);
});

test('the next lecture carries on where the last stopped, and can use two decks', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'BIOL 200');
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Cells.pdf', numberedSlides(12)));
  await record(page, { date: '2026-11-16', minutes: 60, first: 1, last: 6 });
  await expect(lectureRow(page)).toHaveCount(1);

  // The deck is chosen and the first slide filled in: 7
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await expect(slides(page, 1).getByRole('button', { name: /Cells/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(slides(page, 1).getByLabel('First slide')).toHaveValue('7');
  await expect(slides(page, 1).getByTestId('chosen-slides')).toContainText('the last lecture ended at slide 6');

  // Slides 7–12 of Cells, and 1–3 of a new PDF: 60 minutes shared 40/20 by page count
  await lectureForm(page).getByLabel('Lecture date').fill('2026-11-18');
  await lectureForm(page).getByLabel('Minutes').fill('60');
  await slides(page, 1).getByLabel('Last slide').fill('12');
  await lectureForm(page).getByRole('button', { name: 'Add slides from another deck' }).click();
  await slides(page, 2).getByLabel('Or upload a new PDF').setInputFiles(pdfFile('Tissues.pdf', numberedSlides(3)));
  await slides(page, 2).getByLabel('Last slide').fill('3');
  await lectureForm(page).getByRole('button', { name: 'Save lecture' }).click();
  await expect(lectureRow(page)).toHaveCount(2);
  const newest = lectureRow(page).first();
  await expect(newest).toContainText('Wed, Nov 18');
  await expect(newest.getByRole('listitem')).toHaveText([/Cells, slides 7–12\s*40 min to study/, /Tissues, slides 1–3\s*20 min to study/]);

  expect(await problems()).toEqual([]);
});

test('a class with lectures every day prompts for the latest one and fills in its date and length', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  // Every day at midnight: the latest lecture is always today's
  await addClass(page, 'Daily', { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: '00:00', minutes: 45 });
  await expect(page.getByTestId('cover-prompt')).toBeVisible();
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(page.getByRole('list', { name: 'Lectures to fill in' })).toContainText('Daily');
  await classRow(page, 'Daily').getByRole('link').click();

  await page.getByRole('button', { name: 'What was covered?' }).click();
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await expect(lectureForm(page).getByLabel('Lecture date')).toHaveValue(today);
  await expect(lectureForm(page).getByLabel('Minutes')).toHaveValue('45');
  await slides(page, 1).getByLabel('Upload the slides (PDF)').setInputFiles(pdfFile('Daily.pdf', numberedSlides(2)));
  await record(page, { first: 1, last: 2 });
  await expect(lectureRow(page)).toHaveCount(1);
  await expect(page.getByTestId('cover-prompt')).toBeHidden();
  expect(await problems()).toEqual([]);
});

test('exams, editing and deleting; a deck in use can’t be deleted; a file that isn’t a PDF is refused', async ({ page }) => {
  const problems = await watchProblems(page);
  await openUnlocked(page);
  await addClass(page, 'PHYS 150');

  // Not a PDF, then a real one, uploaded from the decks list
  await page.getByLabel('Add slides (PDF)').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>no</html>') });
  await expect(page.getByRole('alert')).toContainText('isn’t a PDF');
  await page.getByLabel('Add slides (PDF)').setInputFiles(pdfFile('Forces.pdf', makePdf([{ title: 'Newton' }, { title: 'Friction' }, { title: 'Drag' }])));
  await expect(page.getByTestId('deck-row')).toContainText('Forces');

  // A lecture using it, then deleting the deck is refused with a reason
  await page.getByRole('button', { name: 'What was covered?' }).click();
  await slides(page, 1).getByRole('button', { name: /Forces/ }).click();
  await record(page, { date: '2026-11-17', minutes: 80, first: 1, last: 3 });
  await expect(lectureRow(page)).toContainText('80 min to study');
  await page.getByRole('button', { name: 'Delete Forces' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('delete those lectures first');

  // Change the lecture's length: its study time follows
  await page.getByRole('button', { name: 'Edit lecture of Tue, Nov 17' }).click();
  await page.getByRole('form', { name: 'Edit lecture' }).getByLabel('Minutes').fill('50');
  await page.getByRole('form', { name: 'Edit lecture' }).getByRole('button', { name: 'Save' }).click();
  await expect(lectureRow(page)).toContainText('50 min to study');

  // Exams: add (no date is refused), edit, delete
  await page.getByRole('button', { name: 'Add an exam' }).click();
  const examForm = page.getByRole('form', { name: 'New exam' });
  await examForm.getByRole('button', { name: 'Add exam' }).click();
  await expect(examForm.getByRole('alert')).toHaveText('Give the exam a date.');
  await examForm.getByLabel('Exam date').fill('2026-12-10');
  await examForm.getByRole('button', { name: 'Final' }).click();
  await examForm.getByRole('button', { name: 'Add exam' }).click();
  const examRow = page.getByTestId('exam-row');
  await expect(examRow).toContainText('Final');
  await expect(examRow).toContainText('Thu, Dec 10');
  await expect(examRow).toContainText('Covers every lecture up to it');
  await page.getByRole('button', { name: 'Edit Final' }).click();
  const edit = page.getByRole('form', { name: 'Edit Final' });
  await edit.getByLabel('Title (optional)').fill('Final exam');
  await edit.getByLabel('Chosen lectures').check();
  await edit.getByLabel('Lecture of Tue, Nov 17').check();
  await edit.getByRole('button', { name: 'Save exam' }).click();
  await expect(examRow).toContainText('Final exam');
  await expect(examRow).toContainText('Covers 1 chosen lecture');
  await page.getByRole('button', { name: 'Delete Final exam' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(examRow).toHaveCount(0);

  // Edit the class: rename it and give it lecture times
  await page.getByRole('button', { name: 'Edit class' }).click();
  const classForm = page.getByRole('form', { name: 'Edit PHYS 150' });
  await classForm.getByLabel('Class name').fill('PHYS 151');
  await classForm.getByRole('group', { name: 'Days for lecture time 1' }).getByRole('button', { name: 'Tue' }).click();
  await classForm.getByLabel('Starts at').fill('14:00');
  await classForm.getByLabel('Minutes').fill('80');
  await classForm.getByRole('button', { name: 'Save class' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'PHYS 151' })).toBeVisible();
  await expect(page.getByTestId('class-times')).toHaveText('Tue 2:00 pm, 80 min');

  // Delete the lecture, then the deck can go; deleting the class goes back to an empty list
  await page.getByRole('button', { name: 'Delete lecture of Tue, Nov 17' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(lectureRow(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete Forces' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('deck-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete class' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No classes yet')).toBeVisible();

  expect(await problems()).toEqual([]);
});

test('a missing class or deck says so', async ({ page }) => {
  await openUnlocked(page);
  await page.goto('/#/class/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Class not found' })).toBeVisible();
  await page.goto('/#/class/does-not-exist/slides/nope/1-2');
  await expect(page.getByRole('heading', { name: 'Slides not found' })).toBeVisible();
});

test('a device with milestone 2’s flashcards upgrades: the cards are dropped, the app works', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.goto('/viewer-demo.html'); // same site, but the app (and its database) isn't opened
  // The database as the live site left it before #26: version 3, with a deck, a card, and changes for
  // the deck (to drop) and a class (to keep)
  await page.evaluate(
    () =>
      new Promise<void>((done, fail) => {
        const req = indexedDB.open('honed', 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('meta', { keyPath: 'key' });
          db.createObjectStore('decks', { keyPath: 'id' });
          db.createObjectStore('notes', { keyPath: 'id' }).createIndex('byDeck', 'deckId');
          const cards = db.createObjectStore('cards', { keyPath: 'id' });
          cards.createIndex('byDeck', 'deckId');
          cards.createIndex('byNote', 'noteId');
          const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
          reviews.createIndex('byCard', 'cardId');
          reviews.createIndex('byTime', 'reviewedAt');
          db.createObjectStore('changes', { keyPath: 'seq', autoIncrement: true });
          db.createObjectStore('courses', { keyPath: 'id' });
          for (const s of ['exams', 'slideDecks', 'lectures']) db.createObjectStore(s, { keyPath: 'id' }).createIndex('byCourse', 'courseId');
          db.createObjectStore('deckFiles', { keyPath: 'id' });
          db.createObjectStore('deckPages', { keyPath: 'id' });
          const sections = db.createObjectStore('sections', { keyPath: 'id' });
          sections.createIndex('byCourse', 'courseId');
          sections.createIndex('byLecture', 'lectureId');
          sections.createIndex('byDeck', 'deckId');
        };
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['decks', 'cards', 'changes'], 'readwrite');
          tx.objectStore('decks').put({ id: 'old', name: 'Old flashcards', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' });
          tx.objectStore('cards').put({ id: 'card', deckId: 'old', noteId: 'n' });
          tx.objectStore('changes').put({ id: 'c1', deviceId: 'd', at: '2026-11-17T00:00:00Z', entity: 'deck', entityId: 'old', op: 'put', data: null });
          tx.objectStore('changes').put({ id: 'c2', deviceId: 'd', at: '2026-11-17T00:00:00Z', entity: 'course', entityId: 'gone', op: 'delete', data: null });
          tx.oncomplete = () => (db.close(), done());
          tx.onerror = () => fail(tx.error);
        };
      }),
  );

  await openUnlocked(page); // sets up: nothing to encrypt but the database itself
  await expect(page.getByText('No classes yet')).toBeVisible();
  await addClass(page, 'After the upgrade');
  const state = await page.evaluate(
    () =>
      new Promise<{ version: number; stores: string[]; changes: string[] }>((done, fail) => {
        const req = indexedDB.open('honed');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction('changes').objectStore('changes').getAll();
          all.onsuccess = () => {
            done({ version: db.version, stores: [...db.objectStoreNames], changes: all.result.map((c: { entity: string }) => c.entity) });
            db.close();
          };
        };
      }),
  );
  expect(state.version).toBeGreaterThanOrEqual(4); // step 4 dropped the cards (later steps add stores)
  expect(state.stores.filter((s) => ['decks', 'notes', 'cards', 'reviews'].includes(s))).toEqual([]);
  expect(state.changes).toEqual(['course', 'course']); // the old class change stays; the new class's is added
  expect(await problems()).toEqual([]);
});
