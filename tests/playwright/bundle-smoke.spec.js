// bundle-smoke.spec.js — Phase B (#2 module system).
//
// The concat build (dist/app.bundle.js, emitted by `npm run build`) must boot
// the app EXACTLY like the 60 separate <script> tags. This loads the bundled
// index variant (index.bundle.html, also emitted by the build) and asserts the
// core globals came up with no uncaught page error — proving the bundle works as
// a real load path. This is the harness the ESM migration (Phase C) converts
// modules behind, one leaf at a time, with this staying green.
//
// Skips (never fails) if the bundle hasn't been built, so a bare `npx playwright
// test` without a prior `npm run build` doesn't spuriously redden the gate. CI
// runs `npm run build` before the suite, so it executes there.

const { test, expect } = require('@playwright/test');

test('bundle boots the app (index.bundle.html)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  const resp = await page.goto('/index.bundle.html');
  test.skip(!resp || resp.status() === 404, 'index.bundle.html not built — run `npm run build` first');

  // Core globals are defined only if the concatenated modules all executed.
  await page.waitForFunction(() => typeof window.MaxEngineTrip === 'object', null, { timeout: 15000 });

  const g = await page.evaluate(() => ({
    MaxEngineTrip: typeof window.MaxEngineTrip,
    MaxEnginePicker: typeof window.MaxEnginePicker,
    TripStore: typeof window.TripStore,
    MaxDecisions: typeof window.MaxDecisions,
    MaxMigration: typeof window.MaxMigration,
    normPlaceName: typeof window._normPlaceName,
    // Match the content-hashed bundle name (dist/app.bundle.<hash>.js) AND the
    // stable dist/app.bundle.js — the build emits both; index.bundle.html points
    // at the hashed one for CDN cache-busting.
    loadedFromBundle: !!document.querySelector('script[src*="dist/app.bundle."]'),
  }));

  expect(g.loadedFromBundle, 'page loaded the single bundle, not 60 tags').toBe(true);
  expect(g.MaxEngineTrip).toBe('object');
  expect(g.MaxEnginePicker).toBe('object');
  expect(g.TripStore).toBe('object');
  expect(g.MaxDecisions).toBe('object');
  expect(g.MaxMigration).toBe('object');
  expect(g.normPlaceName).toBe('function');
  expect(pageErrors, 'no uncaught page errors booting from the bundle').toEqual([]);
});
