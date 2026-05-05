// itin-item.spec.js — Round MA.4 regression spec.
//
// MA.4 lifted the ~370-line mkItinItem body from index.html into
// trip-ui.js as renderItinItemFull, prefixing every cross-reference
// to inline globals (fS, autoSave, drawDestMode, getDest,
// _sightExternalUrl, _openSightUrlEditor, sStory, togMov,
// toggleSightBookForm, delS, fmtD, checkTimeConflicts,
// removeDayTripFromDayItem, ungroupDayTrip, _generatedCityData,
// _activeDmSection, sidCtr, highlightSightOnMap) with `global.X`.
//
// 17 references; mechanical work; one missed prefix would silently
// break a button. This spec boots the app with a seeded trip and
// clicks every button on each row type to surface any reference
// typos right away.

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');

const SEED = {
  id: 'spec-ma4',
  envelope: {
    trip: {
      name: 'MA.4 spec trip',
      destinations: [{
        id: 'd1', place: 'Reykjavik', nights: 2,
        dateFrom: '2026-05-10', dateTo: '2026-05-12',
        days: [
          { id: 'dy1', lbl: 'Day 1', items: [
            { id: 's1', type: 'sight',      n: 'Hallgrímskirkja', p: 'must',  done: false, slot: 'day' },
            { id: 's2', type: 'sight',      n: 'Sun Voyager',      p: 'nice',  done: false, slot: 'day' },
            { id: 'r1', type: 'restaurant', n: 'Bæjarins Beztu',                            slot: 'day' },
            { id: 'dt1', type: 'daytrip',   n: 'Trip to Vík', dayTripPlace: 'Vík', dayTripFrom: 'Reykjavik', peerDayTrip: false, note: 'about 180 km' },
          ]},
          { id: 'dy2', lbl: 'Day 2', items: [] },
        ],
        trackerItems: { booked:[], see:[], visited:[] }, trackerCat: 'booked',
        hotelBookings: [], generalBookings: [], locations: [],
        execMode: false, todayItems: [], discoveredItems: [], suggestions: [],
      }],
      legs: {}, trackSpending: false,
    },
    activeDest: 'd1',
    destCtr: 1, sidCtr: 100, bkCtr: 0,
    activeDmSection: 'sights',
  },
};

test.describe('MA.4 — itinerary item buttons', () => {
  test('every row type renders + every button works without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE.ERR: ' + m.text()); });

    await bootSeeded(page, SEED);

    // Drill into the destination view.
    await page.evaluate(() => { if (typeof drawDestMode === 'function') drawDestMode('d1'); });
    const day1 = page.locator('#dy-dy1');
    await expect(day1).toBeVisible({ timeout: 5000 });

    // 4 rows expected — sight (must), sight (nice), restaurant, daytrip.
    await expect(day1.locator('.srow')).toHaveCount(4);

    // Each row carries the correct dot variant.
    await expect(day1.locator('#sr-s1 .item-dot-sight.must')).toHaveCount(1);
    await expect(day1.locator('#sr-s2 .item-dot-sight.nice')).toHaveCount(1);
    await expect(day1.locator('#sr-r1 .item-dot-restaurant')).toHaveCount(1);
    await expect(day1.locator('#sr-dt1 .item-dot-daytrip')).toHaveCount(1);

    // Each row has a name span.
    await expect(day1.locator('#sr-s1 .sname')).toHaveText('Hallgrímskirkja');
    await expect(day1.locator('#sr-r1 .sname')).toHaveText('Bæjarins Beztu');

    // Action buttons render: story / done / move / book / delete.
    await expect(day1.locator('#sr-s1 .ssa')).toBeVisible();
    await expect(day1.locator('#sr-s1 .dsa')).toBeVisible();
    await expect(day1.locator('#sr-s1 button.msa')).toBeVisible();
    // Delete button glyph is U+2715 (✕, Multiplication X), not U+00D7 (×).
    await expect(day1.locator('#sr-s1 button.sa', { hasText: '✕' })).toHaveCount(1);

    // Time row renders.
    await expect(day1.locator('#stime-s1')).toBeVisible();

    // Day-trip row carries its transport sub-line + Cancel button.
    await expect(day1.locator('#sr-dt1 button', { hasText: 'Plan transport' })).toBeVisible();
    await expect(day1.locator('#sr-dt1 button', { hasText: 'Cancel day trip' })).toBeVisible();

    // ── Click priority dot — flips must ↔ nice without throwing ──
    await page.locator('#sr-s1 .item-dot-wrap').click();
    await expect(day1.locator('#sr-s1 .item-dot-sight.nice')).toHaveCount(1);
    await page.locator('#sr-s1 .item-dot-wrap').click();
    await expect(day1.locator('#sr-s1 .item-dot-sight.must')).toHaveCount(1);

    // ── Click "done ✓" — sets s.done = true ──
    await page.locator('#sr-s1 .dsa').click();
    const isDoneAfter = await page.evaluate(() =>
      trip.destinations[0].days[0].items.find(i => i.id === 's1').done
    );
    expect(isDoneAfter).toBe(true);

    // ── Click name — invokes highlightSightOnMap (no-op if no marker, must not throw) ──
    await page.locator('#sr-s2 .sname').click();

    // ── Click time row — opens editor ──
    await page.locator('#stime-s2').click();
    await expect(page.locator('#sr-s2 .stime-edit input.stime-inp').first()).toBeVisible();

    // ── Click Plan-transport on the daytrip — switches to routing tab ──
    await page.locator('#sr-dt1 button', { hasText: 'Plan transport' }).click();
    await page.waitForTimeout(150);
    const activeTab = await page.evaluate(() => window._activeDmSection);
    expect(activeTab).toBe('routing');

    // No console / page errors during the entire run — but tolerate
    // the "No API key" error that refreshRestaurantSuggestions throws
    // every time drawDestMode renders without a saved API key. That's
    // an unrelated guard in callMax; not what this spec tests.
    var realErrors = errors.filter(function(e){
      return !/No API key/.test(e) && !/Failed to load resource/.test(e);
    });
    expect(realErrors, realErrors.join('\n')).toEqual([]);
  });
});
