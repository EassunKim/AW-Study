// The on-device database (IndexedDB) in every browser engine we test, through the real built app.
// The store's rules are tested in src/db/store.test.ts; this checks it works and persists in
// real browsers. Adding notes waits for the real scheduler and cloze (issue #5).
import { expect, test, type Page } from '@playwright/test';

type Store = {
  deviceId(): string;
  createDeck(name: string): Promise<{ id: string; name: string }>;
  listDecks(now: Date): Promise<{ id: string; name: string; total: number }[]>;
};
declare global {
  var __honedStore: Promise<Store>;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('decks are stored on the device and survive a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  const before = await page.evaluate(async () => {
    const store = await globalThis.__honedStore;
    const deck = await store.createDeck('Cell biology');
    return { device: store.deviceId(), deck };
  });
  expect(before.deck.name).toBe('Cell biology');

  await page.reload();
  const after = await page.evaluate(async () => {
    const store = await globalThis.__honedStore;
    return { device: store.deviceId(), decks: await store.listDecks(new Date()) };
  });
  expect(after.device).toBe(before.device); // the same device id, read back from storage
  expect(after.decks).toEqual([expect.objectContaining({ id: before.deck.id, name: 'Cell biology', total: 0 })]);
  expect(errors).toEqual([]);
});

test('works offline: the database needs no network', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline mode with service workers is Chromium-only in Playwright');
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  const decks = await page.evaluate(async () => {
    const store = await globalThis.__honedStore;
    await store.createDeck('Offline deck');
    return (await store.listDecks(new Date())).map((d) => d.name);
  });
  await context.setOffline(false);
  expect(decks).toContain('Offline deck');
});
