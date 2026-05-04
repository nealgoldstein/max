// helpers/load-app.js — common Playwright helpers for booting the app
// in test mode.
//
// Two boot modes:
//
//   bootSeeded(page, seed)
//     Inject a pre-built trip into localStorage BEFORE the app runs,
//     then navigate to /index.html. The app loads the seed as if the
//     user opened it from the home screen. Used by tests that exercise
//     trip-view behavior without going through the picker.
//
//   bootClean(page)
//     Clear all storage, then navigate. App boots to the home screen
//     with no trips. Used by picker→trip end-to-end tests.
//
// Both modes also unregister any service worker so test runs don't
// pick up stale cached versions.

async function _resetStorage(page) {
  await page.addInitScript(() => {
    // Clear everything EXCEPT the API key — needed for record-mode
    // tests that hit the real LLM. Tests that should run without an
    // API key (engine-only assertions) shouldn't trip on a stale key.
    try {
      const keep = localStorage.getItem('max-api-key');
      localStorage.clear();
      if (keep) localStorage.setItem('max-api-key', keep);
    } catch (e) {}
    try {
      navigator.serviceWorker.getRegistrations().then(rs => {
        rs.forEach(r => r.unregister());
      });
    } catch (e) {}
  });
}

async function bootSeeded(page, seed) {
  await _resetStorage(page);
  // Pre-populate localStorage with the seed trip + an index entry.
  await page.addInitScript((seedData) => {
    const { id, envelope } = seedData;
    try {
      localStorage.setItem('max-trip-' + id, JSON.stringify(envelope));
      const indexEntry = {
        id,
        name: envelope.trip.name || 'Test Trip',
        dateRange: envelope.trip.destinations[0].dateFrom + ' – ' +
                   envelope.trip.destinations[envelope.trip.destinations.length - 1].dateTo,
        destCount: envelope.trip.destinations.length,
        startDate: envelope.trip.destinations[0].dateFrom,
        endDate: envelope.trip.destinations[envelope.trip.destinations.length - 1].dateTo,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('max-trips-index', JSON.stringify([indexEntry]));
    } catch (e) {
      console.error('seed setup failed:', e);
    }
  }, seed);
  await page.goto('/index.html');
  // Wait for the engines to be on window — they load before the inline
  // script runs.
  await page.waitForFunction(() =>
    typeof window.MaxEngineTrip !== 'undefined' &&
    typeof window.MaxEnginePicker !== 'undefined' &&
    typeof window.MaxDB !== 'undefined'
  );
  // Open the trip programmatically using the same sequence the home-
  // screen card click uses (see index.html line ~3620): localLoad(id)
  // populates the trip object, then _currentTripId is set, then
  // enterApp() switches the panel from home to the trip view, which
  // calls drawTripMode() and renders the .tm-dest cards.
  await page.evaluate((tripId) => {
    if (typeof window.localLoad !== 'function' || typeof window.enterApp !== 'function') {
      throw new Error('localLoad/enterApp not on window — app boot incomplete');
    }
    if (!window.localLoad(tripId)) {
      throw new Error('localLoad returned false for ' + tripId);
    }
    window._currentTripId = tripId;
    window.enterApp();
  }, seed.id);
  // Wait for the trip view to render. Increased timeout because
  // drawTripMode does several async setups (hero map, FQ verdict, etc.).
  await page.waitForSelector('.tm-dest', { timeout: 10000 });
}

async function bootClean(page) {
  await _resetStorage(page);
  await page.goto('/index.html');
  await page.waitForFunction(() =>
    typeof window.MaxEngineTrip !== 'undefined' &&
    typeof window.MaxEnginePicker !== 'undefined' &&
    typeof window.MaxDB !== 'undefined'
  );
}

module.exports = { bootSeeded, bootClean };
