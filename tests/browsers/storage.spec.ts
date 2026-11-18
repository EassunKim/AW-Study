// SPIKE (issue #6): SQLite in a worker on OPFS, in every browser engine we test.
import { expect, test } from '@playwright/test';

type Db = { call<T>(method: string, ...args: unknown[]): Promise<T> };
declare global {
  var __honedDb: Db;
}

test('SQLite stores data on the device and keeps it across a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  const info = await page.evaluate(() => globalThis.__honedDb.call<{ sqlite: string; vfs: string }>('info'));
  expect(info.vfs).toBe('opfs-sahpool');
  expect(info.sqlite).toMatch(/^3\./);

  const first = await page.evaluate(() => globalThis.__honedDb.call<number>('spike'));
  const second = await page.evaluate(() => globalThis.__honedDb.call<number>('spike'));
  expect(second).toBe(first + 1);

  await page.reload();
  const afterReload = await page.evaluate(() => globalThis.__honedDb.call<number>('spike'));
  expect(afterReload).toBe(second + 1); // the rows written before the reload are still there
  expect(errors).toEqual([]);
});
