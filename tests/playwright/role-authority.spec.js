// role-authority.spec.js — guards the single destination-role authority.
//
// Regression for PD.446/447: a destination with nights >= 1 must derive as
// a "stay" from the ONE authority (_pmDeriveRole), so the role popover and
// the map pin can't disagree — and an overnight must be reversible to a
// See. The original bug: _pmDeriveRole only honored an `overnight` boolean
// the trip-view converters never set, so a 1-night stay derived "maybe",
// the popover built a "maybe->see" transition that matched nothing, and
// "turn it back to a See" silently did nothing.

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');
const { ICELAND_RING } = require('./helpers/seed-trip');

test.describe('single destination-role authority (PD.446/447)', () => {
  test('a nights>=1 destination derives as "stay", and "stay" maps to overnight', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);
    const r = await page.evaluate(() => {
      const d2 = window.trip.destinations.find((d) => d.id === 'd2'); // Vik, nights 2
      return {
        nights: d2.nights,
        derived: window._pmDeriveRole ? window._pmDeriveRole(d2, null, {}).role : 'no-fn',
        stayOrSee: window._destStayOrSee ? window._destStayOrSee(d2) : 'no-fn',
      };
    });
    expect(r.nights).toBeGreaterThanOrEqual(1);
    expect(r.derived).toBe('stay');         // the authority agrees with nights
    expect(r.stayOrSee).toBe('overnight');  // mapped to dispatcher vocab
  });

  test('a 1-night stay can be turned back to a See (the stuck-toggle bug)', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);
    // Make d3 a 1-night stay (it already is nights 2; set to 1 to model the
    // exact "I made this a 1-night stay" case), then reverse it via the
    // real dispatcher exactly as the popover does.
    await page.evaluate(() => {
      const d3 = window.trip.destinations.find((d) => d.id === 'd3');
      d3.nights = 1;
    });
    const before = await page.evaluate(() => ({
      derived: window._pmDeriveRole(window.trip.destinations.find((d) => d.id === 'd3'), null, {}).role,
    }));
    expect(before.derived).toBe('stay'); // 1-night must be a stay

    // Reverse: overnight -> see, dispatched the same way the popover does.
    await page.evaluate(() => {
      window._applyStopRoleChange({ kind: 'destination', destId: 'd3' }, 'overnight', 'see', {});
    });
    const after = await page.evaluate(() => {
      const d3 = window.trip.destinations.find((d) => d.id === 'd3');
      return { nights: d3.nights, derived: window._pmDeriveRole(d3, null, {}).role };
    });
    expect(after.nights).toBe(0);        // the conversion actually applied
    expect(after.derived).not.toBe('stay');
  });

  test('the dispatcher accepts the derived "stay" vocabulary (not just "overnight")', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);
    // Pass the DERIVED vocab ("stay") as currentRole — a control reading
    // _pmDeriveRole would. PD.446b must normalize it so the reverse works
    // instead of building a "stay->see" key that matches no case.
    await page.evaluate(() => {
      window._applyStopRoleChange({ kind: 'destination', destId: 'd2' }, 'stay', 'see', {});
    });
    const after = await page.evaluate(() => window.trip.destinations.find((d) => d.id === 'd2').nights);
    expect(after).toBe(0); // "stay->see" was honored, not silently dropped
  });
});
