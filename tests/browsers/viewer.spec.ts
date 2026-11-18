// The slide viewer (#25) on its test page (/viewer-demo.html), with PDFs made in the test
// (tests/fixtures/make-pdf.ts). Desktop Chrome, Android and iPhone (WebKit). Checks there are no
// errors and no Content-Security-Policy violations: PDF.js's worker, fonts and decoders must all
// come from our own site.
import { expect, test, type Page } from '@playwright/test';
import { numberedSlides } from '../fixtures/make-pdf';

/** Console errors, page errors and CSP violations, collected from the start. */
async function watchProblems(page: Page): Promise<() => Promise<string[]>> {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return async () => [...problems, ...(await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations))];
}

async function openPdf(page: Page, path: string, pdf: Uint8Array) {
  await page.goto(path);
  await page.getByLabel('PDF file').setInputFiles({ name: 'slides.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
}

const position = (page: Page) => page.getByTestId('slide-position');
const slide = (page: Page) => page.getByTestId('slide-page');

/** Whether the slide's canvas has something drawn (the fixture's blue bar), not just white. */
async function slideHasInk(page: Page): Promise<boolean> {
  return slide(page)
    .locator('canvas')
    .evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) if (data[i + 2]! > 150 && data[i]! < 100) return true;
      return false;
    });
}

test('shows slides and moves through them by keys, buttons, swipes and thumbnails; zooms; marks the range', async ({ page }) => {
  const problems = await watchProblems(page);
  // Every request goes to our own site, and PDF.js's worker loads from it
  const requests: { url: string; status: number }[] = [];
  page.on('requestfinished', async (r) => requests.push({ url: r.url(), status: (await r.response())?.status() ?? 0 }));
  await openPdf(page, '/viewer-demo.html?first=2&last=3', numberedSlides(5));

  await expect(position(page)).toHaveText('Slide 1 of 5');
  await expect(slide(page)).toHaveAttribute('data-rendered', '1');
  const origin = new URL(page.url()).origin;
  expect(requests.filter((r) => !r.url.startsWith(origin))).toEqual([]);
  expect(requests.filter((r) => r.status >= 400)).toEqual([]);
  expect(requests.some((r) => /\/assets\/pdf\.worker[^/]*\.mjs$/.test(r.url))).toBe(true);
  expect(await slideHasInk(page)).toBe(true);
  // The text layer is there, lined up over the slide (for highlights later)
  await expect(slide(page).locator('.textLayer')).toContainText('Slide 1');
  await expect(slide(page).locator('.textLayer')).toContainText('Fixture text 1');
  await expect(page.getByTestId('slide-range')).toHaveText('Outside this section: slides 2–3');

  // Keys
  await page.getByRole('region', { name: 'Slides' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(position(page)).toHaveText('Slide 2 of 5');
  await expect(page.getByTestId('slide-range')).toHaveText('This section: slides 2–3');
  await expect(slide(page).locator('.textLayer')).toContainText('Slide 2');

  // Buttons
  await page.getByRole('button', { name: 'Next slide' }).click();
  await expect(position(page)).toHaveText('Slide 3 of 5');

  // A swipe to the left: the next slide
  const box = (await page.getByTestId('slide-stage').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
  await page.mouse.up();
  await expect(position(page)).toHaveText('Slide 4 of 5');
  await expect(page.getByTestId('slide-range')).toHaveText('Outside this section: slides 2–3');

  // The page that holds the viewer moves it (like "Show me the slide" in a quiz)
  await page.getByRole('button', { name: 'Go to the section’s first slide' }).click();
  await expect(position(page)).toHaveText('Slide 2 of 5');
  await expect(slide(page)).toHaveAttribute('data-rendered', '2');

  // A thumbnail
  await page.getByRole('button', { name: 'Slide 1', exact: true }).click();
  await expect(position(page)).toHaveText('Slide 1 of 5');
  await expect(page.getByRole('button', { name: 'Slide 1', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Previous slide' })).toBeDisabled();

  // Zoom: buttons and keys, and the slide is drawn bigger
  const fitWidth = (await slide(page).boundingBox())!.width;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByTestId('zoom-level')).toHaveText('125%');
  await page.getByRole('region', { name: 'Slides' }).focus();
  await page.keyboard.press('+');
  await expect(page.getByTestId('zoom-level')).toHaveText('156%');
  await expect.poll(async () => (await slide(page).boundingBox())!.width).toBeGreaterThan(fitWidth * 1.5);
  await page.keyboard.press('0');
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');

  // End, and every move was reported once
  await page.keyboard.press('End');
  await expect(position(page)).toHaveText('Slide 5 of 5');
  await expect(page.getByRole('button', { name: 'Next slide' })).toBeDisabled();
  await expect(page.getByTestId('page-changes')).toHaveText('Moved to: 2, 3, 4, 1, 5');

  // Text extraction in the browser
  await page.getByRole('button', { name: 'Extract the text' }).click();
  await expect(page.getByTestId('page-text').locator('li')).toHaveCount(5);
  await expect(page.getByTestId('page-text').locator('li').nth(4)).toContainText('Slide 5');

  expect(await problems()).toEqual([]);
});

test('opens at a given slide', async ({ page }) => {
  const problems = await watchProblems(page);
  await openPdf(page, '/viewer-demo.html?page=4', numberedSlides(6));
  await expect(position(page)).toHaveText('Slide 4 of 6');
  await expect(slide(page)).toHaveAttribute('data-rendered', '4');
  await expect(slide(page).locator('.textLayer')).toContainText('Slide 4');
  expect(await problems()).toEqual([]);
});

test('a 150-slide deck opens quickly and draws only the thumbnails near the screen', async ({ page }) => {
  const problems = await watchProblems(page);
  const pdf = numberedSlides(150);
  const started = Date.now();
  await openPdf(page, '/viewer-demo.html', pdf);
  await expect(slide(page)).toHaveAttribute('data-rendered', '1', { timeout: 5_000 });
  expect(Date.now() - started).toBeLessThan(5_000);
  await expect(position(page)).toHaveText('Slide 1 of 150');
  await expect(page.locator('.sv-thumb[data-rendered="true"]').first()).toBeVisible();
  const drawn = await page.locator('.sv-thumb[data-rendered="true"]').count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThan(40);

  // Jumping to the end draws the thumbnails there
  await page.getByRole('region', { name: 'Slides' }).focus();
  await page.keyboard.press('End');
  await expect(position(page)).toHaveText('Slide 150 of 150');
  await expect(page.locator('li[data-page="150"] .sv-thumb')).toHaveAttribute('data-rendered', 'true');
  expect(await problems()).toEqual([]);
});

test('PDF.js’s data files are served from our own site', async ({ request }) => {
  // Fonts a PDF names without embedding (when the device lacks them), image decoders, colour
  // profiles and character maps: vite.config.ts copies them to /pdfjs/
  for (const path of [
    '/pdfjs/standard_fonts/FoxitSerif.pfb',
    '/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
    '/pdfjs/wasm/openjpeg.wasm',
    '/pdfjs/wasm/jbig2.wasm',
    '/pdfjs/wasm/qcms_bg.wasm',
    '/pdfjs/iccs/CGATS001Compat-v2-micro.icc',
    '/pdfjs/cmaps/UniJIS-UTF16-H.bcmap',
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect((await response.body()).length, path).toBeGreaterThan(1000);
  }
  expect((await request.get('/pdfjs/wasm/openjpeg.wasm')).headers()['content-type']).toBe('application/wasm');
});

test('a file that isn’t a PDF shows a message, not a crash', async ({ page }) => {
  await page.goto('/viewer-demo.html');
  await page.getByLabel('PDF file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByText('This PDF couldn’t be opened')).toBeVisible();
});
