// daytrip-render.spec.js — RENDER-LEVEL coverage for "make it a day trip
// and it disappears." Mirrors wayside-render.spec.js.
//
// PD.470: the day-trip render dropped any stop whose _pmDeriveRole role
// wasn't "daytrip"/"maybe". A sight converted to a day trip often still
// reads as "see" in the cascade (its candidate role didn't flip), so the
// pin was dropped — and PD.461 dedups it out of the considered layer too,
// so it vanished. Route membership (it's a stop on a dayTrip route) should
// win; only a place promoted to an overnight ("stay") makes the planItem
// genuinely stale.

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');

function hubAndSightSeed() {
  const tripId = 'pw-dt-' + Date.now();
  function dest(id, place, lat, lng, nights, from, to) {
    return {
      id, place, intent: '', nights, lat, lng, dateFrom: from, dateTo: to,
      days: [{ id: 'dy_' + id + '_0', lbl: from, note: '', items: [] }],
      suggestions: [], restaurantSuggestions: [], hotelBookings: [], generalBookings: [],
      locations: [], execMode: false, todayItems: [], discoveredItems: [], attachedEvents: [],
      trackerItems: { booked: [], see: [], visited: [] }, trackerCat: 'booked', storyState: 'idle',
    };
  }
  const sight = dest('d2', 'Gljufrabui Falls', 63.61, -19.99, 0, '2026-08-03', '2026-08-03');
  sight.placeId = 'pl-gljufrabui';
  const trip = {
    name: 'Day Trip Test',
    destinations: [
      dest('d1', 'Vik', 63.42, -19.01, 2, '2026-08-01', '2026-08-03'),
      sight,
      dest('d3', 'Hofn', 64.25, -15.20, 2, '2026-08-03', '2026-08-05'),
    ],
    places: { 'pl-gljufrabui': { id: 'pl-gljufrabui', name: 'Gljufrabui Falls', country: 'Iceland', lat: 63.61, lng: -19.99 } },
    // The sight's candidate is a "see" the user touched — this is what made
    // the cascade say "see" and the day-trip render drop the pin.
    candidates: [{ id: 'c-glj', place: 'Gljufrabui Falls', role: 'see', _roleTouched: true }],
    routes: [], legs: {}, pendingActions: [],
    brief: { region: 'Iceland', when: 'August 2026', duration: '4 nights' },
    trackSpending: false,
  };
  return { id: tripId, envelope: { trip, activeDest: 'd1', destCtr: 3, sidCtr: 100, bkCtr: 0, activeDmSection: 'sights' } };
}

test('a sight converted to a day trip renders its pin (does not disappear) — PD.470', async ({ page }) => {
  await bootSeeded(page, hubAndSightSeed());
  await page.locator('#main-map').waitFor({ state: 'visible' });

  await page.evaluate(() => {
    // Make the Gljufrabui sight a day trip from the Vik hub.
    window.convertDestToDayTrip('d2', 'd1');
  });
  await page.waitForFunction(() => window.trip.destinations.length === 2);

  // Sanity: it's now a stop on a dayTrip route.
  const onRoute = await page.evaluate(() => {
    return (window.trip.routes || []).some((r) =>
      (r.subKind === 'dayTrip' || r.kind === 'dayTrip') &&
      (r.planItems || []).some((p) => p.type === 'stop' && /gljufrabui/i.test(p.placeId || ''))
    );
  });
  expect(onRoute, 'expected Gljufrabui to be a stop on a dayTrip route').toBe(true);

  const pins = await page.evaluate(() => {
    if (typeof updateMainMap === 'function') { try { updateMainMap(); } catch (e) {} }
    return document.querySelectorAll('.main-trip-daytrip-pin').length;
  });
  expect(pins, 'the day-trip pin must render (not disappear)').toBeGreaterThanOrEqual(1);
});
