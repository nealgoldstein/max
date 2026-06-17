// place-registry.spec.js — #Place model, Phase D LIVE shadow.
//
// The Node tests prove the unified registry + destinations projection on
// fixtures. This proves they hold against a REAL built trip in the browser
// (richer placeActivities, real identity resolution, real coords) — the
// confidence we need before migrating any reader of trip.destinations onto the
// projection. Asserts:
//   • registryShadowCheck — the registry is a faithful union of the live arrays
//   • destinationsProjectionCheck — destinationsOf reproduces trip.destinations
//   • the projection's destinations match the trip's, by name
//
// Mirrors p4_4-gate.spec.js's boot pattern.
const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

function brief(extra) {
  return Object.assign({
    name: 'Place Registry', region: 'Iceland', when: '2026-08-01',
    duration: '10 days', intent: 'Ring Road', interests: ['waterfalls'],
    drivers: [], tripMode: 'place', placeName: 'Iceland', placeContext: '',
    partyComposition: 'couple', partySize: '2', partyAges: 'adults',
    physicalAbility: 'moderate', avoid: {}, pace: 'enough',
    anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
    entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
    chips: [], activityChips: [], requiredPlaces: [],
  }, extra || {});
}

const BASES = [
  { id: 'c1', place: 'Reykjavik', country: 'Iceland', stayRange: '3 nights', whyItFits: 'gateway', lat: 64.14, lng: -21.94, status: 'keep', overnightCapable: true, _cityPick: true },
  { id: 'c2', place: 'Vik',       country: 'Iceland', stayRange: '2 nights', whyItFits: 'south coast', lat: 63.42, lng: -19.01, status: 'keep', overnightCapable: true },
  { id: 'c3', place: 'Höfn',      country: 'Iceland', stayRange: '2 nights', whyItFits: 'glacier lagoon', lat: 64.25, lng: -15.20, status: 'keep', overnightCapable: true },
];

test('unified Place registry + destinations projection are faithful to a real trip', async ({ page }) => {
  await bootClean(page);
  await page.evaluate((b) => { window.MaxEnginePicker.resetState(b); window._mdcItems = []; }, brief({ candidates: BASES }));
  await page.evaluate(async () => { await window.buildFromCandidates(); });
  await page.waitForSelector('.tm-dest', { timeout: 8000 });

  const res = await page.evaluate(() => {
    const trip = window.TripStore && window.TripStore.trip;
    const MP = window.MaxPlaces;
    if (!trip) return { err: 'no live trip' };
    if (!MP) return { err: 'MaxPlaces not exposed' };
    const reg = MP.registryShadowCheck(trip);
    const proj = MP.destinationsProjectionCheck(trip);
    return {
      registryOk: reg.ok, registryMissing: reg.missing, regSize: reg.size,
      projOk: proj.ok, projDiffs: proj.diffs,
      projNames: MP.destinationsOf(trip).map((d) => d.place).sort(),
      tripDestNames: (trip.destinations || []).map((d) => d.place).sort(),
    };
  });

  expect(res.err || '').toBe('');
  expect(res.registryOk, 'registry not a faithful union: ' + JSON.stringify(res.registryMissing)).toBe(true);
  expect(res.projOk, 'destinations projection drifted: ' + JSON.stringify(res.projDiffs)).toBe(true);
  expect(res.projNames).toEqual(res.tripDestNames);
  expect(res.projNames.length).toBeGreaterThanOrEqual(3);
});
