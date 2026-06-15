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
});
