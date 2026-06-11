// color-authority.spec.js — guards against role-color DRIFT between the two
// surfaces that color pins by role:
//
//   • MaxMapPin.style(role)            — the trip MAP authority (blue stay,
//                                        green see teardrop, purple daytrip).
//   • MaxEnginePicker.pinColorForRole  — the PICKER authority (kept-swatch
//                                        colors in the Discovery cards).
//
// These are deliberately NOT identical: the picker shows `see` as a gray
// base with an eye glyph overlaid, while the map shows `see` as a green
// teardrop. That divergence is intentional and surface-specific.
//
// But the STAY color (the overnight-base blue) is the same brand color on
// both surfaces and MUST stay in sync — if someone re-tints the stay pin on
// the map and forgets the picker (or vice-versa), a kept overnight would
// swatch one blue in the picker and render another on the map. This test
// pins that shared value so the drift is caught in CI, not on the trip.
//
// PD.482 (consistency): chosen over MERGING the two authorities, because the
// see/onway colors genuinely differ by surface and a blind merge would
// visually regress the picker.

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

test('the STAY color agrees between the map and picker authorities (no drift) — PD.482', async ({ page }) => {
  await bootClean(page);
  await page.waitForFunction(() =>
    window.MaxMapPin && typeof window.MaxMapPin.style === 'function' &&
    window.MaxEnginePicker && typeof window.MaxEnginePicker.pinColorForRole === 'function');

  const { mapStay, pickerStay } = await page.evaluate(() => ({
    mapStay: (window.MaxMapPin.style('stay') || {}).fill,
    pickerStay: window.MaxEnginePicker.pinColorForRole('stay'),
  }));

  // Both must be the overnight-base blue. If this fails, one authority was
  // re-tinted without the other — reconcile them (don't just bump the test).
  expect(pickerStay).toBe(mapStay);
  expect(mapStay.toLowerCase()).toBe('#1a5fa8');
});

test('the intentional see-color divergence is documented, not accidental — PD.482', async ({ page }) => {
  await bootClean(page);
  await page.waitForFunction(() =>
    window.MaxMapPin && window.MaxEnginePicker);

  const { mapSee, pickerSee } = await page.evaluate(() => ({
    mapSee: (window.MaxMapPin.style('see') || {}).fill,
    pickerSee: window.MaxEnginePicker.pinColorForRole('see'),
  }));

  // These SHOULD differ (green teardrop on the map; gray base + eye glyph in
  // the picker). This asserts the known, intended divergence so a future
  // accidental "fix" that unifies them trips the test and forces a decision.
  expect(mapSee).not.toBe(pickerSee);
});
