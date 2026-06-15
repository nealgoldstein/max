// trip-search.spec.js — PD.407: the inline trip-view search bar.
//
// The markup (#trip-inline-search-bar) lived above #lp-content but its wiring
// (_ensureTripInlineSearch) was never implemented. This exercises the wiring:
// the bar shows for a built trip, typing highlights matching content + counts
// them, Enter/↑/↓ navigate, and Clear resets. Browser-only behavior — this is
// its verification net (runs in CI).

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');
const { ICELAND_RING } = require('./helpers/seed-trip');

test.describe('inline trip-view search (PD.407)', () => {
  test('bar shows on a built trip; typing highlights + counts; nav + clear work', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);

    const bar = page.locator('#trip-inline-search-bar');
    await expect(bar, 'search bar is shown for a built trip').toBeVisible();

    const inp = page.locator('#trip-inline-search');
    await inp.fill('Reykjavik');   // a place name that's definitely on screen

    // Highlights get applied to matching content.
    await page.waitForFunction(
      () => document.querySelectorAll('.trip-search-hit').length > 0,
      { timeout: 5000 }
    );
    const hits = await page.evaluate(() => document.querySelectorAll('.trip-search-hit').length);
    expect(hits, 'at least one match highlighted').toBeGreaterThanOrEqual(1);

    // Counter becomes visible while a query is present.
    await expect(page.locator('#trip-inline-search-counter')).toBeVisible();

    // Enter navigates to a single active match.
    await inp.press('Enter');
    const active = await page.evaluate(() => document.querySelectorAll('.trip-search-hit-active').length);
    expect(active, 'exactly one active match after navigating').toBe(1);

    // Clear resets — no highlights, input emptied.
    await page.locator('#trip-inline-search-clear').click();
    const afterClear = await page.evaluate(() => ({
      hits: document.querySelectorAll('.trip-search-hit').length,
      value: document.getElementById('trip-inline-search').value,
    }));
    expect(afterClear.hits, 'highlights cleared').toBe(0);
    expect(afterClear.value, 'input emptied').toBe('');
  });

  test('a query with no matches reports "no matches" and highlights nothing', async ({ page }) => {
    await bootSeeded(page, ICELAND_RING);
    const inp = page.locator('#trip-inline-search');
    await inp.fill('zzzznotaplacezzzz');
    await expect(page.locator('#trip-inline-search-counter')).toHaveText(/no matches/i);
    const hits = await page.evaluate(() => document.querySelectorAll('.trip-search-hit').length);
    expect(hits).toBe(0);
  });
});
