// playwright.config.js — config for the Max e2e suite.
//
// Tests boot Chromium against a local HTTP server that serves the app
// from the parent directory. We use http-server-style serving rather
// than file:// because the SW only registers on http(s):// origins —
// and we want SW behavior in tests to match production.

const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

// Resolve the app root (two levels up from this config: tests/playwright/ → max/)
const APP_ROOT = path.resolve(__dirname, '..', '..');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js$/,

  // Each test gets a fresh page + context. Concurrency low because
  // tests share localStorage / IDB by default; isolated contexts keep
  // them clean.
  fullyParallel: false,
  workers: 1,

  // Headless by default for CI; set HEADED=1 in env to see what's
  // happening.
  use: {
    baseURL: 'http://localhost:8765',
    headless: !process.env.HEADED,
    actionTimeout: 5000,
    navigationTimeout: 10000,
    // Capture trace on first retry — helps debug flakes.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Boot a tiny static server before the suite. Python's built-in
  // http.server is enough; no extra dependencies. The webServer block
  // tells Playwright to start it and wait until baseURL responds.
  webServer: {
    command: `python3 -m http.server 8765 --directory "${APP_ROOT}"`,
    url: 'http://localhost:8765/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 5000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
});
