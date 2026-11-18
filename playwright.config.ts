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
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: `node server/server.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
});
