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

  // Round NC.X regression test: the Mývatn bug.
  //
  // The role popup gives the user an explicit Overnight option
  // regardless of cand.overnightCapable (with a "(no lodging known)"
  // hint when relevant). _pmSetPlaceRole used to silently swallow the
  // Stay click when overnightCapable was false — user clicked
  // Overnight five+ times on Mývatn, c.role never moved off "daytrip",
  // pin stayed purple. This test guards the writer: explicit user
  // pick wins, no matter what the LLM said about lodging.
  test('_pmSetPlaceRole: user-picked Overnight wins on a non-overnight-capable place (Mývatn)', async ({ page }) => {
    await bootClean(page);

    await page.evaluate(() => {
      // Seed _tb with a single non-overnight-capable candidate.
      window._tb = window._tb || {};
      window._tb.placeActivities = [{
        id: 'a1',
        section: 'Sights',
        type: 'sight',
        requiredPlaces: [{
          place: 'Mývatn',
          country: 'Iceland',
          overnight: false,
          _keep: true,
          _isDayTrip: true,
          _dayTripHub: 'akureyri',
          lat: 65.61, lng: -16.99,
        }],
      }];
      window._tb.candidates = [{
        id: 'c1',
        place: 'Mývatn',
        overnightCapable: false,
        role: 'daytrip',
        dayTripHub: 'akureyri',
        status: 'keep',
        _roleTouched: true,
      }];
      window._tb.placeMeta = {};
    });

    // The actual write-path the popup's Save button calls.
    await page.evaluate(() => {
      window._pmSetPlaceRole('Mývatn', 'stay', '');
    });

    const after = await page.evaluate(() => {
      const c = window._tb.candidates[0];
      const p = window._tb.placeActivities[0].requiredPlaces[0];
      const meta = window._tb.placeMeta[Object.keys(window._tb.placeMeta)[0]] || null;
      return {
        candRole: c.role,
        candTouched: c._roleTouched,
        candStatus: c.status,
        candHub: c.dayTripHub,
        pIsDayTrip: p._isDayTrip,
        pHub: p._dayTripHub,
        stayOverride: meta && meta.stayOverride,
      };
    });

    // The user picked Overnight; everything must reflect that.
    expect(after.candRole).toBe('stay');               // the bug: was 'daytrip'
    expect(after.candTouched).toBe(true);
    expect(after.candStatus).toBe('keep');
    expect(after.candHub).toBe('');                    // stale hub cleared
    expect(after.pIsDayTrip).toBe(false);              // requiredPlace flag cleared
    expect(after.pHub).toBe('');                       // requiredPlace hub cleared
    expect(after.stayOverride).toBe(true);             // placeMeta updated
  });

  // PD.331 regression test: hard refresh in Discovery stays in Discovery.
  //
  // The URL is the source of truth for the screen (PD.330): being in
  // Discovery means the hash is #/trip/<id>/discovery, and a reload
  // must land back there. The bug: enterApp's BASELINE drawTripMode
  // call stamped #/trip/<id> over the deep link before the deferred
  // _dispatchRoute could honor it — refresh in Discovery opened the
  // trip view instead ("I save it from discovery and it opens in
  // trip"). drawTripMode now takes {noUrlStamp:true} for baseline
  // renders and refuses to stamp while a picker overlay is visible
  // (background re-renders were also stealing the URL and closing
  // the overlay via the route listener's TRIP branch).
  test('hard refresh in Discovery lands back in Discovery, not trip view', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Refresh Test',
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

    // Enter Discovery — same route the Discovery affordances use.
    await page.evaluate(() => {
      window.MaxRoute.navigate({
        screen: window.MaxRoute.SCREENS.DISCOVERY,
        tripId: window.trip.id,
      });
    });
    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      const ce = document.getElementById('candidate-explorer-overlay');
      const anyDiscovery = (ov && ov.style.display && ov.style.display !== 'none')
        || (ce && ce.style.display && ce.style.display !== 'none');
      return location.hash.includes('/discovery') && anyDiscovery;
    }, { timeout: 5000 });

    // THE SCENARIO: hard refresh while in Discovery.
    await page.reload();

    // Boot must honor the deep link: hash still /discovery and SOME
    // Discovery surface visible — PD.333: the dispatcher picks the
    // surface by data shape (placeActivities → activity picker;
    // candidates-only → candidate explorer), so this trip (built from
    // candidates, no placeActivities) restores the explorer. Either
    // way, NOT the trip view or home screen.
    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      const ce = document.getElementById('candidate-explorer-overlay');
      const anyDiscovery = (ov && ov.style.display && ov.style.display !== 'none')
        || (ce && ce.style.display && ce.style.display !== 'none');
      return location.hash.includes('/discovery') && anyDiscovery;
    }, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      hash: location.hash,
      homeDisplay: document.getElementById('home-screen').style.display,
      tripLoaded: !!(window.trip && window.trip.id),
    }));
    expect(state.hash).toContain('/discovery');
    expect(state.homeDisplay).toBe('none');
    expect(state.tripLoaded).toBe(true);
  });

  // PD.331 regression test #2: the NEW-trip variant (Neal's exact
  // report — "it still opens in trip with no destinations"). A
  // brand-new trip sits in Discovery with ZERO destinations (nothing
  // published yet). Three separate gaps made refresh lose the screen:
  //   1. No Discovery entry path stamped the URL for regular new
  //      trips (only the paste-list import did) — renderActivityPicker
  //      now stamps, and _initialTripSave stamps at mint time.
  //   2. enterApp's baseline drawTripMode stomped deep links (test #1).
  //   3. The boot-time tripChange repaint (renderTripPage →
  //      drawTripMode) pushed the bare trip route over /discovery
  //      before dispatch — repaints now pass noUrlStamp.
  test('new trip (no destinations): refresh in Discovery restores Discovery', async ({ page }) => {
    await bootClean(page);

    // New trip lands in Discovery: _tb seeded, picker rendered —
    // NOTHING published, trip.destinations stays empty.
    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Fresh',
        region: 'Iceland',
        when: '2026-09-01', duration: '8 days', intent: 'Ring Road',
        interests: [], drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        candidates: candidates, chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
      window.renderActivityPicker();
    }, ICELAND_CANDIDATES);

    // Simulate LLM completion: placeActivities arrive, the initial
    // save mints the trip, the picker re-renders.
    await page.evaluate(() => {
      window._tb.placeActivities = [{
        id: 'a1', section: 'Sights', type: 'sight', name: 'Golden Circle',
        requiredPlaces: [{ place: 'Reykjavik', country: 'Iceland' }],
      }];
      window._initialTripSave();
      window.renderActivityPicker();
    });
    // The mint must have put the discovery route in the URL.
    await page.waitForFunction(() => location.hash.includes('/discovery'), { timeout: 5000 });

    // THE SCENARIO: hard refresh on a destination-less trip in Discovery.
    await page.reload();

    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      return location.hash.includes('/discovery') &&
        ov && ov.style.display && ov.style.display !== 'none';
    }, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      hash: location.hash,
      homeDisplay: document.getElementById('home-screen').style.display,
      destCount: window.trip && window.trip.destinations ? window.trip.destinations.length : -1,
      candidatesRestored: window._tb && Array.isArray(window._tb.candidates) ? window._tb.candidates.length : 0,
    }));
    expect(state.hash).toContain('/discovery');
    expect(state.homeDisplay).toBe('none');
    expect(state.destCount).toBe(0);                 // still unpublished
    expect(state.candidatesRestored).toBeGreaterThan(0); // Discovery rehydrated
  });

  // PD.333 regression test: the SECOND Discovery surface. The
  // candidate explorer (#candidate-explorer-overlay) was invisible to
  // the router — it never stamped the URL and the dispatcher couldn't
  // restore it, so a refresh mid-explorer-session lost the screen
  // ("reloading when discovery was the only window ended up in trip
  // yet again"). Now: showCandidateExplorer stamps /discovery, and
  // the dispatcher restores the explorer when the trip has candidates
  // but no placeActivities.
  test('candidate explorer: refresh restores the explorer, not trip view', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Explorer',
        region: 'Iceland',
        when: '2026-09-01', duration: '8 days', intent: 'Ring Road',
        interests: [], drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        candidates: candidates, chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
      // Mint with candidates only — no placeActivities (the explorer
      // path: candidate-first trips).
      window._initialTripSave();
      window.showCandidateExplorer(window._tb.candidates, false);
    }, ICELAND_CANDIDATES);

    await page.waitForFunction(() => {
      const ce = document.getElementById('candidate-explorer-overlay');
      return location.hash.includes('/discovery') &&
        ce && ce.style.display && ce.style.display !== 'none';
    }, { timeout: 5000 });

    await page.reload();

    await page.waitForFunction(() => {
      const ce = document.getElementById('candidate-explorer-overlay');
      return location.hash.includes('/discovery') &&
        ce && ce.style.display && ce.style.display !== 'none';
    }, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      hash: location.hash,
      candidatesRestored: window._tb && Array.isArray(window._tb.candidates) ? window._tb.candidates.length : 0,
    }));
    expect(state.hash).toContain('/discovery');
    expect(state.candidatesRestored).toBeGreaterThan(0);
  });

  // PD.334 regression test: THE core complaint — "a simple process of
  // saving a trip, or a discovery page, and its data, and loading
  // from where you saved." Curation actions (keep/reject) used to
  // mutate _tb in memory with NO persist call: closing the tab lost
  // the work. Now every curation action persists (600ms debounce)
  // AND pagehide flushes the pending debounce. This test rejects a
  // candidate and reloads IMMEDIATELY (inside the debounce window) —
  // the pagehide flush must have written it.
  test('Discovery curation survives immediate close/reload (save-on-leave)', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Curate',
        region: 'Iceland',
        when: '2026-09-01', duration: '8 days', intent: 'Ring Road',
        interests: [], drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        candidates: candidates, chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
      window._initialTripSave();
      window.showCandidateExplorer(window._tb.candidates, false);
    }, ICELAND_CANDIDATES);
    await page.waitForFunction(() => location.hash.includes('/discovery'), { timeout: 5000 });

    // Curate: reject Vik (c2 is 'keep' in the fixture).
    await page.evaluate(async () => { await window.setCS('c2', 'reject'); });

    // Reload IMMEDIATELY — inside the 600ms persist debounce. The
    // pagehide save-on-leave flush is what must write it.
    await page.reload();
    await page.waitForFunction(() => window.MaxDB && window.trip && window.trip.id, { timeout: 10000 });

    const after = await page.evaluate(() => {
      const c2 = (window.trip.candidates || []).find(c => c && c.id === 'c2');
      return { c2Status: c2 ? c2.status : 'MISSING' };
    });
    expect(after.c2Status).toBe('reject');
  });

  // PD.338 regression test: a Discovery-stage trip (no destinations,
  // has candidates) reopens INTO Discovery from the home screen —
  // not into an empty trip overview. ("If you return to home from
  // the discovery view, it still opens in the trip view.")
  test('Discovery-stage trip reopens into Discovery from home, not empty trip view', async ({ page }) => {
    await bootClean(page);

    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Reopen',
        region: 'Iceland',
        when: '2026-09-01', duration: '8 days', intent: 'Ring Road',
        interests: [], drivers: [], tripMode: 'place',
        placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        candidates: candidates, chips: [], activityChips: [], requiredPlaces: [],
      });
      window._mdcItems = [];
      window._initialTripSave();              // mint: candidates, no destinations
      window.showCandidateExplorer(window._tb.candidates, false);
    }, ICELAND_CANDIDATES);
    await page.waitForFunction(() => location.hash.includes('/discovery'), { timeout: 5000 });
    const tripId = await page.evaluate(() => window.trip.id);

    // Home from Discovery.
    await page.evaluate(() => window.goHome());
    await page.waitForFunction(() => {
      const hs = document.getElementById('home-screen');
      return location.hash === '#/' && hs && hs.style.display === 'flex';
    }, { timeout: 5000 });

    // Reopen the trip from the home screen (same path the card uses).
    await page.evaluate((id) => window.selectTrip(id), tripId);
    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      const ce = document.getElementById('candidate-explorer-overlay');
      const anyDiscovery = (ov && ov.style.display && ov.style.display !== 'none')
        || (ce && ce.style.display && ce.style.display !== 'none');
      return location.hash.includes('/discovery') && anyDiscovery;
    }, { timeout: 10000 });

    const state = await page.evaluate(() => ({ hash: location.hash, destCount: window.trip.destinations.length }));
    expect(state.hash).toContain('/discovery');
    expect(state.destCount).toBe(0);
  });

  // PD.338a regression test: the BUILT-trip variant — "if you had
  // built the trip and went back to discovery (likely)", reopening
  // from home must land back in Discovery, not the trip overview.
  // Last-screen memory is local-only and written solely by the route
  // dispatcher.
  test('built trip last seen in Discovery reopens into Discovery from home', async ({ page }) => {
    await bootClean(page);

    // Build a full trip (destinations exist).
    await page.evaluate((candidates) => {
      window.MaxEnginePicker.resetState({
        name: 'Iceland Built Reopen',
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

    // Go back into Discovery on the built trip, then Home.
    await page.evaluate(() => {
      window.MaxRoute.navigate({ screen: window.MaxRoute.SCREENS.DISCOVERY, tripId: window.trip.id });
    });
    await page.waitForFunction(() => location.hash.includes('/discovery'), { timeout: 5000 });
    const tripId = await page.evaluate(() => window.trip.id);
    // goHome confirms ("Return to trips?") on built trips — accept it.
    page.on('dialog', (d) => d.accept());
    await page.evaluate(() => window.goHome());
    await page.waitForFunction(() => location.hash === '#/', { timeout: 5000 });

    // Reopen from home → must resume Discovery, not the trip overview.
    await page.evaluate((id) => window.selectTrip(id), tripId);
    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      const ce = document.getElementById('candidate-explorer-overlay');
      const anyDiscovery = (ov && ov.style.display && ov.style.display !== 'none')
        || (ce && ce.style.display && ce.style.display !== 'none');
      return location.hash.includes('/discovery') && anyDiscovery;
    }, { timeout: 10000 });

    const state = await page.evaluate(() => ({
      hash: location.hash,
      destCount: window.trip.destinations.length,
    }));
    expect(state.hash).toContain('/discovery');
    expect(state.destCount).toBeGreaterThan(0); // built trip, resumed in Discovery
  });
});
