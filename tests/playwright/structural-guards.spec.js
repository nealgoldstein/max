// structural-guards.spec.js — regression guards for two structural fixes that
// were the kind to silently regress. Both shipped (PD.433 / PD.488); these pin
// them so they can't quietly come back.
//
//   T3.1 — repaint coalescing: _scheduleMainMapUpdate() collapses N requests in
//          one tick into ONE updateMainMap (the old bug repainted twice per
//          mutation because both tripChange + mapDataChange subscribers called it).
//   T3.8 — publish no longer emits the retired `mdcItems` field onto the trip.

const { test, expect } = require('@playwright/test');
const { bootClean, bootSeeded } = require('./helpers/load-app');
const { ICELAND_RING } = require('./helpers/seed-trip');

test.describe('structural guards', () => {
  test('T3.1: multiple repaint requests in one tick coalesce to a single updateMainMap', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);
    await page.locator('#main-map').waitFor({ state: 'visible' });

    const calls = await page.evaluate(async () => {
      const orig = window.updateMainMap;
      let n = 0;
      window.updateMainMap = function () { n++; return orig ? orig.apply(this, arguments) : undefined; };
      // Three requests in the SAME tick — PD.433's coalescer must fire the
      // real repaint only once on the next microtask.
      window._scheduleMainMapUpdate();
      window._scheduleMainMapUpdate();
      window._scheduleMainMapUpdate();
      await new Promise((r) => setTimeout(r, 60));
      window.updateMainMap = orig;
      return n;
    });
    expect(calls, 'coalesced to ONE repaint (not one per request)').toBe(1);
  });

  test('T3.8: publishing a trip does not emit the retired mdcItems field', async ({ page }) => {
    await bootClean(page);
    await page.evaluate(() => {
      window.MaxEnginePicker.resetState({
        name: 'Guard Iceland', region: 'Iceland', when: '2026-08-01',
        duration: '10 days', intent: 'Ring Road', interests: ['waterfalls'],
        drivers: [], tripMode: 'place', placeName: 'Iceland', placeContext: '',
        partyComposition: 'couple', partySize: '2', partyAges: 'adults',
        physicalAbility: 'moderate', avoid: {}, pace: 'enough',
        anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
        entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
        chips: [], activityChips: [], requiredPlaces: [],
        candidates: [
          { id: 'c1', place: 'Reykjavik', country: 'Iceland', stayRange: '3 nights', whyItFits: 'gateway', lat: 64.14, lng: -21.94, status: 'keep', overnightCapable: true, _cityPick: true },
          { id: 'c2', place: 'Vik',       country: 'Iceland', stayRange: '2 nights', whyItFits: 'south coast', lat: 63.42, lng: -19.01, status: 'keep', overnightCapable: true },
          { id: 'c3', place: 'Höfn',      country: 'Iceland', stayRange: '2 nights', whyItFits: 'glacier lagoon', lat: 64.25, lng: -15.20, status: 'keep', overnightCapable: true },
        ],
      });
      window._mdcItems = [];
    });
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 8000 });

    const mdc = await page.evaluate(() => ({
      onTrip: window.trip ? (window.trip.mdcItems !== undefined) : 'no-trip',
    }));
    expect(mdc.onTrip, 'trip.mdcItems must not be emitted by publish (retired field)').toBe(false);
  });

  // T3.6 slice 1 — _rankPopoverTransitLegs extracted (pure) from the
  // ~850-line _openTripStopPopover. Pin its behaviour so the extraction
  // (and any future refactor of the popover) can't silently change the
  // Wayside dropdown's leg list.
  test('T3.6: _rankPopoverTransitLegs ranks legs purely from trip + ctx', async ({ page }) => {
    await bootClean(page);
    const r = await page.evaluate(() => {
      const trip = {
        destinations: [
          { id: 'A', place: 'Aville', lat: 64.0, lng: -22.0 },
          { id: 'B', place: 'Btown',  lat: 63.5, lng: -20.0 },
          { id: 'C', place: 'Cby',    lat: 64.2, lng: -15.0 },
        ],
        routes: [
          { id: 'r-tr-A-B', subKind: 'transit', fromDestId: 'A', toDestId: 'B' },
          { id: 'r-tr-B-C', subKind: 'transit', fromDestId: 'B', toDestId: 'C' },
        ],
      };
      const fn = window._rankPopoverTransitLegs;
      // destination kind on the MIDDLE stop: both real legs touch B and are
      // excluded; the natural-merge leg A→C is synthesised in their place.
      const dest = fn(trip, { kind: 'destination', destId: 'B' }, null);
      // wayside kind: no self-exclusion, so both transit legs are offered and
      // the currentRouteId stays selected.
      const way = fn(trip, { kind: 'wayside' }, 'r-tr-A-B');
      return {
        destCount: dest.count,
        destHasNatural: dest.html.includes('r-tr-A-C') && dest.html.includes('Aville → Cby'),
        wayCount: way.count,
        waySelectsCurrent: way.html.includes('value="r-tr-A-B" selected'),
        emptyGuard: fn(null, null, null),
        typeofFn: typeof fn,
      };
    });
    expect(r.typeofFn, 'helper exposed on window').toBe('function');
    expect(r.destCount, 'middle-stop destination ⇒ one synthesised natural leg').toBe(1);
    expect(r.destHasNatural, 'natural-merge leg A→C present').toBe(true);
    expect(r.wayCount, 'wayside ⇒ both real transit legs offered').toBe(2);
    expect(r.waySelectsCurrent, 'currentRouteId stays selected').toBe(true);
    expect(r.emptyGuard, 'null args ⇒ safe empty result').toEqual({ html: '', count: 0 });
  });

  // T3.6 slice 2 — _pmBuildPlaceRow extracted from _renderPlaceActivityItems'
  // by-Place loop (~107 lines). Pin that it builds a well-formed row node from
  // a synthetic pInfo + deps, so the row markup can't silently drift and so the
  // extraction stays the reusable seam for a future single-row re-render.
  test('T3.6: _pmBuildPlaceRow builds a place row node from pInfo + deps', async ({ page }) => {
    await bootClean(page);
    const r = await page.evaluate(() => {
      const fn = window._pmBuildPlaceRow;
      if (typeof fn !== 'function') return { typeofFn: typeof fn };
      const pInfo = {
        place: 'Testville',
        kept: true,
        activities: [
          { item: { name: 'Coastal Hike', type: 'sight' }, placeRef: { nights: 2 } },
          { item: { name: 'Harbor Walk',  type: 'sight' }, placeRef: { nights: 0 } },
        ],
      };
      let row, threw = null;
      try {
        row = fn('testville', pInfo, {
          childrenByHub: { testville: ['Cove A', 'Cove B'] },
          whyFitsLineFor: () => '<div class="why">because</div>',
        });
      } catch (e) { threw = String((e && e.message) || e); }
      if (threw) return { threw };
      const html = row.outerHTML;
      return {
        typeofFn: 'function',
        isNode: row instanceof HTMLElement,
        className: row.className,
        id: row.id,
        dataPlace: row.getAttribute('data-place'),
        hasCheckboxOn: html.includes('tb-act-check on'),
        hasName: html.includes('>Testville</span>'),
        hasNights: html.includes('2 nights suggested'),
        hasSightsHere: html.includes('Sights here:') && html.includes('Cove A'),
        hasWhy: html.includes('class="why"'),
        hasMenu: html.includes('pm-row-menu-btn'),
        hasBadges: html.includes('Coastal Hike') && html.includes('Harbor Walk'),
      };
    });
    expect(r.typeofFn, 'helper exposed on window').toBe('function');
    expect(r.threw, 'row build must not throw').toBeUndefined();
    expect(r.isNode, 'returns a DOM element').toBe(true);
    expect(r.className).toBe('tb-act-table-row tb-dest-major on');
    expect(r.id).toBe('tb-place-place-row-testville');
    expect(r.dataPlace).toBe('Testville');
    expect(r.hasCheckboxOn, 'kept ⇒ checkbox on').toBe(true);
    expect(r.hasName, 'place name rendered').toBe(true);
    expect(r.hasNights, 'nights line from max placeRef nights').toBe(true);
    expect(r.hasSightsHere, 'Sights-here line from childrenByHub dep').toBe(true);
    expect(r.hasWhy, 'whyFitsLineFor dep injected').toBe(true);
    expect(r.hasMenu, 'row ⋯ menu rendered').toBe(true);
    expect(r.hasBadges, 'one activity badge per activity').toBe(true);
  });
});
