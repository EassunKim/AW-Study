// Shared steps for browser tests that work with classes, lectures and slides (#26), through the
// real screens. PDFs are made in the test (src/viewer/test-pdf.ts): no real slides are committed.
import { expect, type Page } from '@playwright/test';

/** Console errors, page errors and Content-Security-Policy violations, collected from the start. */
export async function watchProblems(page: Page): Promise<() => Promise<string[]>> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { cspViolations: string[] }).cspViolations.push(`CSP: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return async () => [...problems, ...(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations))];
}

export const classRow = (page: Page, name: string) => page.getByTestId('class-row').filter({ hasText: name });

/** On the Classes page: opens a class's own page, from its heading. */
export async function openClass(page: Page, name: string) {
  await classRow(page, name).getByRole('heading').getByRole('link').click();
  await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
}

/** The nav bar at the bottom of the three main pages (Tasks, Classes, Settings). */
export const navBar = (page: Page) => page.getByRole('navigation', { name: 'Pages' });

/** From any main page (Tasks, the home page, after unlocking): to the Classes page, through the nav bar. */
export async function toClasses(page: Page) {
  await navBar(page).getByRole('link', { name: 'Classes' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Classes', exact: true })).toBeVisible();
}

/** From a main page: adds a class (optionally with lecture days and time), ending on its page. */
export async function addClass(page: Page, name: string, times?: { days: string[]; start: string; minutes: number }) {
  if (!(await page.getByRole('button', { name: 'Add a class' }).isVisible())) await toClasses(page);
  await page.getByRole('button', { name: 'Add a class' }).click();
  const form = page.getByRole('form', { name: 'New class' });
  await form.getByLabel('Class name').fill(name);
  if (times) {
    const days = form.getByRole('group', { name: 'Days for lecture time 1' });
    for (const day of times.days) await days.getByRole('button', { name: day, exact: true }).click();
    await form.getByLabel('Starts at').fill(times.start);
    await form.getByLabel('Minutes').fill(String(times.minutes));
  }
  await form.getByRole('button', { name: 'Add class' }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

/** Adds a class and goes back to the classes screen, where it's listed. */
export async function addClassAndReturn(page: Page, name: string) {
  await addClass(page, name);
  await page.getByRole('link', { name: '← Classes' }).click();
  await expect(classRow(page, name)).toBeVisible();
}

/** A PDF for setInputFiles. */
export function pdfFile(name: string, data: Uint8Array) {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(data) };
}
