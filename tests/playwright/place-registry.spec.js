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
    const sproj = (typeof MP.sightsProjectionCheck === 'function') ? MP.sightsProjectionCheck(trip) : { ok: true };
    return {
      registryOk: reg.ok, registryMissing: reg.missing, regSize: reg.size,
      projOk: proj.ok, projDiffs: proj.diffs,
      sightsProjOk: sproj.ok, sightsMissing: sproj.missing, sightsInvented: sproj.invented,
      projNames: MP.destinationsOf(trip).map((d) => d.place).sort(),
      tripDestNames: (trip.destinations || []).map((d) => d.place).sort(),
    };
  });

  expect(res.err || '').toBe('');
  expect(res.registryOk, 'registry not a faithful union: ' + JSON.stringify(res.registryMissing)).toBe(true);
  expect(res.projOk, 'destinations projection drifted: ' + JSON.stringify(res.projDiffs)).toBe(true);
  expect(res.sightsProjOk, 'sights projection drifted: missing=' + JSON.stringify(res.sightsMissing) + ' invented=' + JSON.stringify(res.sightsInvented)).toBe(true);
  expect(res.projNames).toEqual(res.tripDestNames);
  expect(res.projNames.length).toBeGreaterThanOrEqual(3);
});

// OBSERVER (non-fatal): measure candidate↔requiredPlace mirror drift on a live
// trip that exercises a real role CHANGE through MaxRoleWriter — the exact path
// PD.86 drift travels. This does NOT fail the gate on mismatch; it logs the
// finding so we can see whether real trips carry drift before promoting
// candidateMirrorCheck to a hard assertion (or funneling the drift sites out).
test('OBSERVER: candidate↔requiredPlace mirror drift after a live role change', async ({ page }) => {
  await bootClean(page);
  // Seed a sight candidate whose requiredPlace name carries a country suffix —
  // the classic normalizer-gap shape ("Gullfoss" vs "Gullfoss, Iceland").
  const withSight = brief({
    candidates: BASES.concat([
      { id: 'c9', place: 'Gullfoss', country: 'Iceland', whyItFits: 'waterfall', lat: 64.33, lng: -20.12, status: 'keep' },
    ]),
    requiredPlaces: ['Gullfoss, Iceland'],
  });
  await page.evaluate((b) => { window.MaxEnginePicker.resetState(b); window._mdcItems = []; }, withSight);
  await page.evaluate(async () => { await window.buildFromCandidates(); });
  await page.waitForSelector('.tm-dest', { timeout: 8000 });

  const obs = await page.evaluate(() => {
    const trip = window.TripStore && window.TripStore.trip;
    const MP = window.MaxPlaces;
    if (!trip || !MP) return { err: !trip ? 'no live trip' : 'MaxPlaces not exposed' };
    // Drive a real role change through the canonical writer (set(idOrPlace,
    // role, opts)) — the exact mutation path PD.86 drift travels.
    let drove = false;
    try {
      if (window.MaxRoleWriter && typeof window.MaxRoleWriter.set === 'function') {
        const c = window.MaxRoleWriter.set('Gullfoss', 'daytrip', { hub: 'Reykjavik' });
        drove = !!c;
      }
    } catch (e) { /* observation only */ }
    const r = MP.candidateMirrorCheck(trip);
    const scan = (typeof MP.candidateMirrorScan === 'function') ? MP.candidateMirrorScan(trip) : { ok: true, suspects: [] };
    // ROOT-CAUSE shadow: is the stored _keep flag already redundant with the
    // keepFor projection? (Uses the live _isStaySection / _placeOrigin globals.)
    const keepShadow = (typeof MP.keepShadowCheck === 'function') ? MP.keepShadowCheck(trip) : { ok: true, checked: 0, diffs: [] };
    // Inventory: so checked=0 is never ambiguous — we can SEE whether the
    // suffixed requiredPlace exists and what key it resolved to.
    const PK = window.PlaceKey;
    const rpInv = [];
    (trip.placeActivities || []).forEach((it) => {
      if (!it || it.type === 'route') return;
      (it.requiredPlaces || []).forEach((p) => {
        if (!p) return;
        rpInv.push({ place: p.place || p.name, key: PK ? PK.resolve(p.place || p.name) : null,
                     _keep: !!p._keep, _isDayTrip: !!p._isDayTrip, _rejected: !!p._rejected });
      });
    });
    const candInv = (trip.candidates || []).map((c) => ({ place: c.place, role: c.role, status: c.status, key: PK ? PK.resolve(c.place) : null }));
    return { drove, ok: r.ok, checked: r.checked, mismatches: r.mismatches,
             scanOk: scan.ok, suspects: scan.suspects, candInv, rpInv,
             keepOk: keepShadow.ok, keepChecked: keepShadow.checked, keepDiffs: keepShadow.diffs };
  });

  expect(obs.err || '').toBe('');
  // NON-FATAL: report, never fail. CI log shows the measurement.
  console.log('[mirror-observer] drove=' + obs.drove + ' checked=' + obs.checked +
              ' strictDrift=' + (obs.ok ? 'none' : JSON.stringify(obs.mismatches)) +
              ' scanDrift=' + (obs.scanOk ? 'none' : JSON.stringify(obs.suspects)));
  console.log('[mirror-observer] candidates=' + JSON.stringify(obs.candInv));
  console.log('[mirror-observer] requiredPlaces=' + JSON.stringify(obs.rpInv));
  console.log('[keep-shadow] checked=' + obs.keepChecked + ' storedEqualsDerived=' + (obs.keepOk ? 'yes' : 'NO ' + JSON.stringify(obs.keepDiffs)));
  test.info().annotations.push({ type: 'mirror-drift', description: JSON.stringify(obs) });
  expect(typeof obs.checked).toBe('number'); // assert only that the check RAN
});
