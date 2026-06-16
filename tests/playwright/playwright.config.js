// playwright.config.js — config for the Max e2e suite.
//
// Tests boot Chromium against a local HTTP server that serves the app
// from the parent directory. We use http-server-style serving rather
// than file:// because the SW only registers on http(s):// origins —
// and we want SW behavior in tests to match production.

const path = require('path');
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// Resolve the app root (two levels up from this config: tests/playwright/ → max/)
const APP_ROOT = path.resolve(__dirname, '..', '..');

// Single source of truth for the dev port: read DEV_PORT from dev.config
// (shared with ./dev.sh) so the preview server and this runner never drift
// onto different ports. Falls back to 8765 if the file is missing/unreadable.
let DEV_PORT = 8765;
try {
  const m = fs.readFileSync(path.join(APP_ROOT, 'dev.config'), 'utf8').match(/^\s*DEV_PORT\s*=\s*(\d+)/m);
  if (m) DEV_PORT = Number(m[1]);
} catch (e) { /* keep default */ }
const BASE_URL = `http://localhost:${DEV_PORT}`;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js$/,

  // Each test gets a fresh page + context. Concurrency low because
  // tests share localStorage / IDB by default; isolated contexts keep
  // them clean.
  fullyParallel: false,
  workers: 1,

  // v360.x: per-test timeout raised from Playwright's 30s default. The
  // build-harness tests drive the FULL paste→build→publish→return
  // pipeline (many canned-LLM round-trips + renders); on a loaded
  // machine that legitimately runs past 30s and tripped a flaky timeout
  // during the full-suite deploy gate — even though each test passes
  // comfortably in isolation. 60s gives real headroom without slowing
  // the happy path (tests finish as soon as they're done).
  timeout: 60000,
  // One retry so a single load-induced flake re-runs instead of aborting
  // the whole deploy. trace:'on-first-retry' (below) captures the retry
  // for debugging; a test that fails on BOTH attempts is a real failure.
  retries: 1,

  // Headless by default for CI; set HEADED=1 in env to see what's
  // happening.
  use: {
    baseURL: BASE_URL,
    headless: !process.env.HEADED,
    actionTimeout: 5000,
    navigationTimeout: 10000,
    // Capture trace on first retry — helps debug flakes.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // v359.60.12: block service workers in tests. The app's SW caches
    // index.html aggressively, which means tests can hit a stale
    // snapshot of index.html even after a fresh deploy. Newly-added
    // window.X exports / function declarations weren't appearing on
    // window in the test, because Playwright was getting served the
    // cached version. Blocking SWs forces every test to fetch fresh
    // bytes from the http.server we boot.
    serviceWorkers: 'block',
  },

  // Boot a tiny static server before the suite. Python's built-in
  // http.server is enough; no extra dependencies. The webServer block
  // tells Playwright to start it and wait until baseURL responds.
  webServer: {
    // Build the bundle first, then serve. The Playwright suite loads
    // index.bundle.html (the order-preserved artifact we deploy) — not the raw
    // multi-tag index.html — because converting modules to ESM makes them deferred
    // type=module scripts in raw index.html, so load-order there no longer matches
    // production. The bundle is in-order and IS what ships, so it's the correct
    // thing to gate on. Building here keeps index.bundle.html fresh on every run.
    command: `npm --prefix "${APP_ROOT}" run build && python3 -m http.server ${DEV_PORT} --directory "${APP_ROOT}"`,
    url: `${BASE_URL}/index.bundle.html`,
    reuseExistingServer: !process.env.CI,
    // v360.1: bumped from 5s. Python http.server's cold-start is
    // usually <1s, but the deploy occasionally hit a 5s timeout on
    // slower machines / when the OS was paging. 20s is generous but
    // doesn't slow anything down on the happy path — Playwright
    // polls the URL and proceeds as soon as it answers.
    timeout: 20000,
    // Quiet the per-request "[WebServer] ::1 - - GET /foo.js 200 -"
    // spam. Python's http.server logs every request to stderr;
    // Playwright captures and re-emits it, drowning the actual test
    // results. Set PLAYWRIGHT_VERBOSE=1 in env to re-enable when
    // debugging a server-side issue.
    stdout: process.env.PLAYWRIGHT_VERBOSE ? 'pipe' : 'ignore',
    stderr: process.env.PLAYWRIGHT_VERBOSE ? 'pipe' : 'ignore',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Quiet local runs: 'dot' prints one char per test and only expands
  // output for FAILURES (full error + the HTML report for digging in).
  // CI keeps 'list' for readable logs. Set PW_VERBOSE=1 to force 'list'
  // locally when you want the per-test rundown.
  reporter: process.env.CI || process.env.PW_VERBOSE
    ? 'list'
    : [['dot'], ['html', { open: 'never' }]],
});
