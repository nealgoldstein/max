// base-routes.spec.js — guards the base-to-base transit-route model.
//
// PD.468: syncTransitRoutes must connect the places you SLEEP (overnight
// bases, nights>=1), spanning the sights between them — not make a leg out
// of every consecutive place. This is what makes "on the way" mean
// "between Selfoss and Vík" instead of between two adjacent sights, and it
// matches the bases-only route spine (PD.465).

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

test('transit routes connect overnight bases, spanning the sights between (PD.468)', async ({ page }) => {
  await bootClean(page);
  await page.waitForFunction(() => window.MaxEngineTrip && typeof window.MaxEngineTrip.syncTransitRoutes === 'function');

  const routes = await page.evaluate(() => {
    // A → [sight, sight] → B → [sight] → C. Bases: A, B, C (nights>=1).
    const trip = {
      destinations: [
        { id: 'A',  place: 'Base A',  nights: 2, lat: 64.0, lng: -22.0, dateFrom: '2026-08-01', dateTo: '2026-08-03' },
        { id: 'S1', place: 'Sight 1', nights: 0, lat: 64.0, lng: -21.4, dateFrom: '2026-08-03', dateTo: '2026-08-03' },
        { id: 'S2', place: 'Sight 2', nights: 0, lat: 64.0, lng: -20.6, dateFrom: '2026-08-03', dateTo: '2026-08-03' },
        { id: 'B',  place: 'Base B',  nights: 2, lat: 64.0, lng: -19.0, dateFrom: '2026-08-03', dateTo: '2026-08-05' },
        { id: 'S3', place: 'Sight 3', nights: 0, lat: 64.0, lng: -17.0, dateFrom: '2026-08-05', dateTo: '2026-08-05' },
        { id: 'C',  place: 'Base C',  nights: 1, lat: 64.0, lng: -15.0, dateFrom: '2026-08-05', dateTo: '2026-08-06' },
      ],
      routes: [],
    };
    window.MaxEngineTrip.syncTransitRoutes(trip);
    return (trip.routes || [])
      .filter((r) => {
        const sub = (window.MaxMigration && MaxMigration.routeSubKind) ? MaxMigration.routeSubKind(r) : (r.subKind || r.kind);
        return sub === 'transit';
      })
      .map((r) => r.fromDestId + '->' + r.toDestId);
  });

  // Base-to-base only: A→B and B→C. NO sight legs.
  expect(routes.sort()).toEqual(['A->B', 'B->C']);
  expect(routes).not.toContain('A->S1');
  expect(routes).not.toContain('S1->S2');
  expect(routes).not.toContain('S2->B');
  expect(routes).not.toContain('B->S3');
  expect(routes).not.toContain('S3->C');
});

test('a sights-only draft (<2 bases) keeps every-destination routes so nothing vanishes', async ({ page }) => {
  await bootClean(page);
  await page.waitForFunction(() => window.MaxEngineTrip && typeof window.MaxEngineTrip.syncTransitRoutes === 'function');
  const routes = await page.evaluate(() => {
    const trip = {
      destinations: [
        { id: 'X', place: 'X', nights: 0, lat: 64.0, lng: -22.0, dateFrom: '2026-08-01', dateTo: '2026-08-01' },
        { id: 'Y', place: 'Y', nights: 0, lat: 64.0, lng: -21.0, dateFrom: '2026-08-01', dateTo: '2026-08-01' },
        { id: 'Z', place: 'Z', nights: 0, lat: 64.0, lng: -20.0, dateFrom: '2026-08-01', dateTo: '2026-08-01' },
      ],
      routes: [],
    };
    window.MaxEngineTrip.syncTransitRoutes(trip);
    return (trip.routes || []).map((r) => r.fromDestId + '->' + r.toDestId);
  });
  // Fallback: with no overnight bases, the old every-destination spine.
  expect(routes.sort()).toEqual(['X->Y', 'Y->Z']);
});
