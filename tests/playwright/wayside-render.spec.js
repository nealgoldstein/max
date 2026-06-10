// wayside-render.spec.js — RENDER-LEVEL coverage for the "disappears
// from the map" bug. The existing wayside tests only asserted the DATA
// shape (destinations + route stop placeIds); none checked that the
// purple wayside PIN actually draws. This file boots the real (vendored)
// Leaflet map and asserts on the actual marker DOM.
//
// The bug: a stop's map position is resolved from trip.places[placeId]
// .lat/lng (_resolveStopCtr). If that entry is missing coords, the render
// falls back to getCityCenter(name) — which works for CITIES but NOT for
// sight names (a waterfall, viewpoint, hot spring). When that fails the
// renderer silently drops the stop and the pin "disappears."
//
// There are THREE converters that create a wayside/day-trip stop, and
// each must populate trip.places[placeId].lat/lng. The route-picked path
// (convertDestToWaysideOnRoute) was the one still missing the backfill.

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');

// A 4-destination trip whose 2nd stop is a SIGHT (a waterfall, not a
// city) carrying coords on the destination but pointing at a COORDLESS
// trip.places entry — exactly the real-trip shape. getCityCenter() will
// NOT resolve "Gljufrabui Waterfall", so the only way the pin can render
// is if the converter copies the dest's coords onto the place entry.
function fourStopSeedWithSightWayside() {
  const tripId = 'pw-sight-' + Date.now();
  function dest(id, place, lat, lng, nights, from, to) {
    return {
      id, place, intent: '', nights, lat, lng,
      dateFrom: from, dateTo: to,
      days: [{ id: 'dy_' + id + '_0', lbl: from, note: '', items: [] }],
      suggestions: [], restaurantSuggestions: [],
      hotelBookings: [], generalBookings: [], locations: [],
      execMode: false, todayItems: [], discoveredItems: [],
      attachedEvents: [], trackerItems: { booked: [], see: [], visited: [] },
      trackerCat: 'booked', storyState: 'idle',
    };
  }
  const sight = dest('d2', 'Gljufrabui Waterfall', 63.61, -19.99, 0, '2026-08-04', '2026-08-04');
  sight.placeId = 'pl-gljufrabui';
  const trip = {
    name: 'Sight Wayside Test',
    destinations: [
      dest('d1', 'Reykjavik', 64.14, -21.94, 3, '2026-08-01', '2026-08-04'),
      sight,
      dest('d3', 'Vik', 63.42, -19.01, 2, '2026-08-04', '2026-08-06'),
      dest('d4', 'Hofn', 64.25, -15.20, 2, '2026-08-06', '2026-08-08'),
    ],
    // Coordless place entry — the real-trip condition that defeats the
    // "only set coords if entry is new" converters.
    places: { 'pl-gljufrabui': { id: 'pl-gljufrabui', name: 'Gljufrabui Waterfall', country: 'Iceland', lat: null, lng: null } },
    routes: [], legs: {}, candidates: [], pendingActions: [],
    brief: { region: 'Iceland', when: 'August 2026', duration: '7 nights' },
    trackSpending: false,
  };
  return {
    id: tripId,
    envelope: { trip, activeDest: 'd1', destCtr: 4, sidCtr: 100, bkCtr: 0, activeDmSection: 'sights' },
  };
}

async function renderMainMapAndCountWaysidePins(page) {
  return page.evaluate(() => {
    if (typeof updateMainMap === 'function') {
      try { updateMainMap(); } catch (e) {}
    }
    return document.querySelectorAll('.main-trip-wayside-pin').length;
  });
}

test.describe('wayside pin actually renders on the trip map (sight, non-city name)', () => {
  test('route-picked path: convertDestToWaysideOnRoute keeps the sight pin on the map', async ({ page }) => {
    await bootSeeded(page, fourStopSeedWithSightWayside());
    await page.locator('#main-map').waitFor({ state: 'visible' });

    // Put the sight (d2) onto the d3->d4 transit route — a route that
    // does NOT end at d2, which forces the convertDestToWaysideOnRoute
    // path (the natural-neighbor merge would use convertDestToWayside).
    await page.evaluate(() => {
      // Ensure the transit routes exist (syncTransitRoutes builds them).
      if (window.MaxEngineTrip && MaxEngineTrip.syncTransitRoutes) {
        MaxEngineTrip.syncTransitRoutes(window.trip);
      }
    });
    await page.evaluate(() => {
      window.convertDestToWaysideOnRoute('d2', 'r-tr-d3-d4');
    });
    await page.waitForFunction(() => window.trip.destinations.length === 3);

    const diag = await page.evaluate(() => {
      const stops = (window.trip.routes || []).flatMap((r) =>
        (r.planItems || []).filter((p) => p.type === 'stop').map((p) => p.placeId)
      );
      const pid = stops.find((id) => /gljufrabui/i.test(id));
      const place = pid && window.trip.places ? window.trip.places[pid] : null;
      return { pid: pid || null, lat: place ? place.lat : 'NO_PLACE' };
    });
    expect(diag.pid, 'sight should be a stop on a route').toBeTruthy();
    expect(typeof diag.lat, 'wayside place entry must carry a numeric lat (backfilled)').toBe('number');

    const pins = await renderMainMapAndCountWaysidePins(page);
    expect(pins, 'the sight wayside pin must render on the map (not disappear)').toBeGreaterThanOrEqual(1);
  });

  test('null-island [0,0] sentinel entry is repaired, not plotted in the ocean (PD.440)', async ({ page }) => {
    // The real bug from Neal's trip: trip.places[id] pre-existed with
    // lat:0/lng:0 (the "coords unknown" sentinel the place pipeline
    // writes). isFinite(0) is true, so the old guard treated [0,0] as a
    // valid position and the pin was drawn ~3000km off Iceland (invisible).
    const seed = fourStopSeedWithSightWayside();
    seed.envelope.trip.places['pl-gljufrabui'].lat = 0;
    seed.envelope.trip.places['pl-gljufrabui'].lng = 0;
    await bootSeeded(page, seed);
    await page.locator('#main-map').waitFor({ state: 'visible' });

    await page.evaluate(() => {
      if (window.MaxEngineTrip && MaxEngineTrip.syncTransitRoutes) MaxEngineTrip.syncTransitRoutes(window.trip);
      window.convertDestToWaysideOnRoute('d2', 'r-tr-d3-d4');
    });
    await page.waitForFunction(() => window.trip.destinations.length === 3);

    const coords = await page.evaluate(() => {
      const p = window.trip.places['pl-gljufrabui'];
      return { lat: p.lat, lng: p.lng };
    });
    // The dest carried real coords (63.61,-19.99); the [0,0] entry must
    // be repaired to those, NOT left at the null-island sentinel.
    expect(Math.abs(coords.lat) > 0.01 || Math.abs(coords.lng) > 0.01,
      'place entry must no longer sit at [0,0]').toBe(true);
    expect(coords.lat).toBeCloseTo(63.61, 1);

    const pins = await renderMainMapAndCountWaysidePins(page);
    expect(pins).toBeGreaterThanOrEqual(1);
  });

  test('natural path: convertDestToWayside keeps the sight pin on the map', async ({ page }) => {
    await bootSeeded(page, fourStopSeedWithSightWayside());
    await page.locator('#main-map').waitFor({ state: 'visible' });

    await page.evaluate(() => {
      window.convertDestToWayside('d2', { absorbInto: 'next' });
    });
    await page.waitForFunction(() => window.trip.destinations.length === 3);

    const diag = await page.evaluate(() => {
      const stops = (window.trip.routes || []).flatMap((r) =>
        (r.planItems || []).filter((p) => p.type === 'stop').map((p) => p.placeId)
      );
      const pid = stops.find((id) => /gljufrabui/i.test(id));
      const place = pid && window.trip.places ? window.trip.places[pid] : null;
      return { pid: pid || null, lat: place ? place.lat : 'NO_PLACE' };
    });
    expect(diag.pid).toBeTruthy();
    expect(typeof diag.lat).toBe('number');

    const pins = await renderMainMapAndCountWaysidePins(page);
    expect(pins, 'the sight wayside pin must render on the map (not disappear)').toBeGreaterThanOrEqual(1);
  });
});
