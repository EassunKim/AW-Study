// TEMPORARY probe (issue #6): which parts of the private file system (OPFS) this browser supports.
import { test } from '@playwright/test';

test('probe OPFS support', async ({ page, browserName }, info) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const out: Record<string, string> = {};
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        out[name] = `ok ${String(await fn())}`;
      } catch (e) {
        out[name] = `FAIL ${(e as Error).name}: ${(e as Error).message}`;
      }
    };
    await step('getDirectory (page)', async () => !!(await navigator.storage.getDirectory()));
    await step('write file (page, createWritable)', async () => {
      const dir = await navigator.storage.getDirectory();
      const f = await dir.getFileHandle('probe.txt', { create: true });
      const w = await f.createWritable();
      await w.write('hi');
      await w.close();
      return (await f.getFile()).size;
    });
    // Sync access handles only exist in workers: probe from a tiny worker made from a blob URL
    // is blocked by our CSP (worker-src 'self'), so ask our own db worker's environment instead.
    await step('persisted', async () => navigator.storage.persisted());
    return out;
  });
  console.log(`[${info.project.name} ${browserName}]`, JSON.stringify(result, null, 1));
});
