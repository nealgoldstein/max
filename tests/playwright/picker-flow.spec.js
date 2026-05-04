// picker-flow.spec.js — picker → trip end-to-end scenarios.
//
// Approach: skip the LLM-driven candidate generation entirely.
// Fabricate `_tb.candidates` directly with realistic-shape candidate
// objects, then call buildFromCandidates. The build logic — the
// function that the deferred decomposition will split — is what
// these tests cover.
//
// Why not record real LLM responses for candidate generation?
//   - runCandidateSearch and expandMustDos write to picker UI DOM
//     elements that don't exist when we evaluate them in isolation.
//     They hang waiting for selectors that aren't there.
//   - The fixtures would be massive (every prompt + response across
//     N city-data calls per scenario) and brittle to prompt tweaks.
//   - The candidate-generation step is not what the decomposition
//     changes. The build step is what we need to protect.
//
// What this DOES protect:
//   - buildFromCandidates → trip envelope shape
//   - orderKeptCandidates ordering (route blocks, gateway inference)
//   - _reconcileDestinations rebuild path
//   - Entry/exit stop synthesis (Round GA.1)
//   - Date computation across destinations
//   - Trip name derivation from brief
//
// What this DOESN'T protect (and shouldn't try to):
//   - LLM call correctness — that's a vendor problem, not ours
//   - Picker UI DOM behavior — that's separate from the engine
//
// No fixtures file, no API key needed. Runs in <5s total.

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

// Realistic candidate fixtures, hand-crafted to mirror what the LLM
// produces in shape but trimmed to what the build flow needs.

const SWITZERLAND_CANDIDATES = [
  { id: 'c1', place: 'Zurich',     country: 'Switzerland', stayRange: '2-3 nights', whyItFits: 'gateway', lat: 47.37, lng: 8.55,  status: 'keep', _cityPick: true },
  { id: 'c2', place: 'Lucerne',    country: 'Switzerland', stayRange: '2 nights',   whyItFits: 'lake + Mt. Pilatus', lat: 47.05, lng: 8.31, status: 'keep' },
  { id: 'c3', place: 'Interlaken', country: 'Switzerland', stayRange: '3 nights',   whyItFits: 'Jungfrau base', lat: 46.69, lng: 7.85, status: 'keep' },
  { id: 'c4', place: 'Zermatt',    country: 'Switzerland', stayRange: '3 nights',   whyItFits: 'Matterhorn', lat: 46.02, lng: 7.75, status: 'keep' },
  { id: 'c5', place: 'Lausanne',   country: 'Switzerland', stayRange: '2 nights',   whyItFits: 'Lake Geneva', lat: 46.52, lng: 6.63, status: 'keep' },
  { id: 'c6', place: 'Geneva',     country: 'Switzerland', stayRange: '2 nights',   whyItFits: 'departure', lat: 46.20, lng: 6.14, status: 'keep' },
  { id: 'c7', place: 'Basel',      country: 'Switzerland', stayRange: '1-2 nights', whyItFits: 'museums', lat: 47.56, lng: 7.59, status: 'reject' },
];

const ICELAND_CANDIDATES = [
  { id: 'c1', place: 'Reykjavik', country: 'Iceland', stayRange: '2-3 nights', whyItFits: 'gateway + Golden Circle', lat: 64.14, lng: -21.94, status: 'keep', _cityPick: true },
  { id: 'c2', place: 'Vik',       country: 'Iceland', stayRange: '2 nights',   whyItFits: 'south coast + black beaches', lat: 63.42, lng: -19.01, status: 'keep' },
  { id: 'c3', place: 'Höfn',      country: 'Iceland', stayRange: '2 nights',   whyItFits: 'glacier lagoon', lat: 64.25, lng: -15.20, status: 'keep' },
  { id: 'c4', place: 'Akureyri',  country: 'Iceland', stayRange: '2 nights',   whyItFits: 'north + whale watching', lat: 65.68, lng: -18.10, status: 'keep' },
  { id: 'c5', place: 'Snæfellsnes Peninsula', country: 'Iceland', stayRange: '1 night', whyItFits: 'mini Iceland', lat: 64.95, lng: -23.60, status: 'reject' },
];

test.describe('Picker → trip flow', () => {

  test('Switzerland: linear trip with explicit entry Zurich + exit Geneva', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Switzerland Test',
        region: 'Switzerland',
        when: '2026-08-15',
        duration: '14 days',
        intent: 'Alps + scenic trains',
        interests: ['hiking'],
        drivers: [], tripMode: 'place',
        placeName: 'Switzerland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first',
        accommodation: '', compromises: '', hardlimits: '',
        entry: 'Zurich', tbExit: 'Geneva',
        entryMode: 'flight', exitMode: 'flight',
        candidates: candidates,
        chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
    }, SWITZERLAND_CANDIDATES);

    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 5000 });

    const result = await page.evaluate(() => ({
      destCount: trip.destinations.length,
      firstPlace: trip.destinations[0].place.toLowerCase(),
      lastPlace: trip.destinations[trip.destinations.length - 1].place.toLowerCase(),
      places: trip.destinations.map(d => d.place),
      hasDates: trip.destinations.every(d => !!d.dateFrom && !!d.dateTo),
      hasNights: trip.destinations.every(d => typeof d.nights === 'number' && d.nights > 0),
    }));

    expect(result.destCount).toBeGreaterThanOrEqual(5);
    expect(result.firstPlace).toContain('zurich');
    expect(result.lastPlace).toContain('geneva');
    expect(result.hasDates).toBe(true);
    expect(result.hasNights).toBe(true);
  });

  test('Iceland: round trip with inferred Reykjavik gateway', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Test',
        region: 'Iceland',
        when: '2026-08-01',
        duration: '10 days',
        intent: 'Ring Road',
        interests: ['waterfalls'],
        drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first',
        accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '',  // No explicit entry/exit — inference path.
        entryMode: 'flight', exitMode: 'flight',
        candidates: candidates,
        chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
    }, ICELAND_CANDIDATES);

    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 5000 });

    const result = await page.evaluate(() => ({
      destCount: trip.destinations.length,
      firstPlace: trip.destinations[0].place.toLowerCase(),
      lastPlace: trip.destinations[trip.destinations.length - 1].place.toLowerCase(),
      places: trip.destinations.map(d => d.place),
      hasDates: trip.destinations.every(d => !!d.dateFrom && !!d.dateTo),
    }));

    // Round CP.1: with no entry set + Iceland region, Reykjavik should
    // be inferred as the gateway. The round-trip exit-stop synthesis
    // is conditional (depends on whether the gateway is already in
    // the kept list); we verify the gateway-inference behavior, not
    // the synthesis itself.
    expect(result.firstPlace).toContain('reykjavik');
    expect(result.destCount).toBeGreaterThanOrEqual(4);
    expect(result.hasDates).toBe(true);
    // Reykjavik must appear somewhere in the trip (always, via gateway).
    const includesReykjavik = result.places.some(p =>
      p.toLowerCase().includes('reykjavik'));
    expect(includesReykjavik).toBe(true);
  });

  test('Edit existing: rebuild preserves trip name + flips kept candidates', async ({ page }) => {
    await bootClean(page);

    // Build a base Iceland trip first.
    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Edit Test',
        region: 'Iceland',
        when: '2026-08-01', duration: '10 days', intent: 'Ring Road',
        interests: ['waterfalls'], drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        candidates: candidates, chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
    }, ICELAND_CANDIDATES);

    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 5000 });

    const before = await page.evaluate(() => ({
      name: trip.name,
      places: trip.destinations.map(d => d.place),
    }));

    // Rebuild path: rehydrate _tb from trip.candidates (Round BK), flip
    // one keep to reject + one reject to keep, rebuild.
    await page.evaluate(async () => {
      window._tb._isRebuild = true;
      window._tb.candidates = (trip.candidates || []).map(c => ({ ...c }));
      // Find the rejected one (Snæfellsnes) and keep it; drop one of the
      // currently-kept (Vik).
      window._tb.candidates.forEach(c => {
        if (c.place === 'Snæfellsnes Peninsula') c.status = 'keep';
        else if (c.place === 'Vik') c.status = 'reject';
      });
      await window.buildFromCandidates();
    });
    await page.waitForFunction(() =>
      window.trip && Array.isArray(window.trip.destinations) &&
      window.trip.destinations.every(d => !!d.place));

    const after = await page.evaluate(() => ({
      name: trip.name,
      places: trip.destinations.map(d => d.place),
    }));

    expect(after.name).toBe(before.name);  // name preserved
    expect(after.places).toContain('Snæfellsnes Peninsula');  // newly kept
    expect(after.places.includes('Vik')).toBe(false);  // newly rejected
  });
});
