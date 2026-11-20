// Browser tests (tests/browsers/) against the real built app, served by the real server with the
// headers visitors get. Three devices: desktop Chrome, an Android phone (Chromium) and an iPhone
// (WebKit, Safari's engine). `npm run test:browsers` builds first, then runs them.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/browsers',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky test gets fixed, never rerun until green
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    // WebKit on Windows and Linux runs every step about 3x slower than Chromium (measured Nov 20, #81:
    // setup 1.1 s vs 0.2 s, a class and lecture 2.0 s vs 0.5 s, unlock 0.9 s vs 0.1 s), so its longest
    // tests take 10-12 s, and on a busy machine (two browsers per CPU thread) 25-30 s, past the default
    // 30 s, failing wherever the clock ran out. Nothing hangs: its budgets are scaled to its speed.
    { name: 'iphone', use: { ...devices['iPhone 15'] }, timeout: 90_000, expect: { timeout: 15_000 } },
  ],
  webServer: {
    command: `node server/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
});
