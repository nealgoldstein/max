// sequence.spec.js — guards geographic placement of non-chain stops.
//
// Regression for PD.448: sequenceDestinations() must INSERT a destination
// that isn't part of the route chain (a Discovery/Enhance add) next to its
// geographic neighbour, not concat it onto the end. The original bug: the
// code `ordered = ordered.concat(remaining)` appended every stray stop, so
// a highland sight (Ljótipollur) landed last in the itinerary instead of
// beside its neighbour Sigöldugljúfur.

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

test('a non-chain stop is inserted by geography, not appended to the end (PD.448)', async ({ page }) => {
  await bootClean(page);
  await page.waitForFunction(() => typeof window.sequenceDestinations === 'function');

  const result = await page.evaluate(() => {
    // Three chain stops on a west→east line, plus X sitting right next to
    // the MIDDLE stop. Cheapest-insertion must drop X beside B, never last.
    const A = { id: 'a', place: 'Acity', lat: 64.0, lng: -22.0, nights: 1 };
    const B = { id: 'b', place: 'Bcity', lat: 64.0, lng: -19.0, nights: 1 };
    const C = { id: 'c', place: 'Ccity', lat: 64.0, lng: -15.0, nights: 1 };
    const X = { id: 'x', place: 'Xsight', lat: 64.0, lng: -19.1, nights: 0 }; // hugs B
    const destinations = [A, B, C, X]; // X deliberately last on input
    const mdcItems = [{
      checked: true,
      type: 'route',
      requiredPlaces: [{ place: 'Acity' }, { place: 'Bcity' }, { place: 'Ccity' }],
    }];
    const ordered = window.sequenceDestinations(destinations, mdcItems, {});
    return ordered.map((d) => d.place);
  });

  // X must land adjacent to Bcity (its neighbour), and must NOT be last.
  const xPos = result.indexOf('Xsight');
  const bPos = result.indexOf('Bcity');
  expect(result[result.length - 1]).not.toBe('Xsight');     // not appended to the end
  expect(Math.abs(xPos - bPos)).toBe(1);                     // sits right beside its neighbour
  expect(result[0]).toBe('Acity');                           // arrival anchor preserved
});
