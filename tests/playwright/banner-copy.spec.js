// banner-copy.spec.js — PD.394: the build banner copy is decided by
// the build MODE, not a fragile hasRoute heuristic. Two operations,
// two messages:
//   "activity-first"  (after you upload your list)  → looking for other places
//   "candidate-first" (Discovery → trip)            → determining your route
const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

test('build banner copy is mode-driven', async ({ page }) => {
  await bootClean(page);
  const r = await page.evaluate(() => {
    const out = {};
    const fake = { _build: true, _ph: 'build:enhance-start', _md: 'activity-first',
      isBuilding(){return this._build;}, phase(){return this._ph;}, mode(){return this._md;} };
    const real = window.MaxBuild;
    window.MaxBuild = fake;
    window._maxBuildBannerRecontext();
    out.activity = (document.getElementById('pm-build-phase-banner')||{}).innerText || '';
    fake._md = 'candidate-first'; fake._ph = 'build:start';
    window._maxBuildBannerRecontext();
    out.candidate = (document.getElementById('pm-build-phase-banner')||{}).innerText || '';
    // not building → banner removed
    fake._build = false;
    window._maxBuildBannerRecontext();
    out.gone = !document.getElementById('pm-build-phase-banner');
    window.MaxBuild = real;
    return out;
  });
  expect(r.activity, 'after upload').toContain('looking for other places that you might want to consider');
  expect(r.candidate, 'discovery → trip').toContain('determining your route');
  expect(r.gone, 'no build → no banner').toBe(true);
});
