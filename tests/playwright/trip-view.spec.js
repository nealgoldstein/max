// trip-view.spec.js — regression coverage for the trip view critical paths
// and role popover. Pairs with trip-mutators.spec.js (data-shape mutators)
// and itin-item.spec.js (within-destination editing).
//
// What these tests catch (and why they exist — bugs from this session):
//   • Arrival/Departure panel rendering — bitten by an over-broad CSS
//     selector (#trip-name-wrap vs .trip-name-block) that hid the entire
//     top section on a previous build.
//   • Wayside → overnight conversion silently failing — the popover
//     closed and nothing changed; the warning was buried in the console.
//     Now we listen for "[Max]" console warnings and any test that
//     produces one fails.
//   • Role popover row availability — the mdcItems-count gate suppresses
//     Wayside when sightCount > 2; this test pins that contract.
//
// Approach: seed a trip directly into localStorage via bootSeeded
// (helpers/load-app.js), drive conversions via the exported dispatcher,
// assert against trip data + DOM. No LLM, no network.

const { test, expect } = require('@playwright/test');
const { bootSeeded } = require('./helpers/load-app');
const { ICELAND_RING } = require('./helpers/seed-trip');

// Console-warn watcher. Filters for "[Max]" warnings that indicate a
// silent failure in the code we're regression-testing — converters,
// rendering, role popover. Excludes warnings that are expected in test
// mode (LLM calls without an API key, network sync without auth) since
// those would always fire and drown out the signal.
//
// Allowlist (we'll filter these out as known non-regression noise):
//   • fetchRegionEntryPoints — LLM call that needs an API key
//   • No API key — same root cause, different surface
//   • MaxSync — server sync not available in headless tests
//
// Anything else under the "[Max]" prefix means a real code path
// degraded silently and the test should fail.
const KNOWN_NOISE = [
  /fetchRegionEntryPoints/i,
  /No API key/i,
  /MaxSync/i,
  /scheduleSave/i,
  // v360.3: Leaflet CDN blocked in the headless test env, so
  // initMainMap / updateMainMap throw "L is not defined". The trip
  // view itself renders fine without the map (the map can recover
  // later if Leaflet eventually loads). Not a regression.
  /initMainMap failed/i,
  /updateMainMap failed/i,
  /checkDeadlineAlert failed/i,
];

function attachWarningWatcher(page) {
  const warnings = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'warning') return;
    const txt = msg.text();
    if (!txt.includes('[Max]')) return;
    if (KNOWN_NOISE.some((re) => re.test(txt))) return;
    warnings.push(txt);
  });
  return warnings;
}

test.describe('Trip view — top section renders', () => {
  test('shows trip name, destinations list, and main map', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // Trip-name wrap is the canary for the CSS-over-broad regression:
    // an earlier rule on `.trip-name-block` hid the whole top of the
    // trip view including the picker's Home button. Pin the specific
    // wrapper that should always be visible.
    await expect(page.locator('#trip-name-wrap')).toBeVisible();

    // Three destinations from the seed.
    await expect(page.locator('.tm-dest')).toHaveCount(3);

    // Main map is visible.
    await expect(page.locator('#main-map')).toBeVisible();

    // No "[Max]" console warnings during the load.
    expect(warnings).toEqual([]);
  });

  test('Arrival/Departure panel renders above the destinations list', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // The Arrival/Departure panel is rendered by
    // MaxTripUI.renderArrivalDeparturePanel(trip, c). We don't pin a
    // CSS class (the renderer doesn't expose a stable one across builds);
    // instead we verify (a) the labels "Arriving" and "Leaving" are
    // present, and (b) they precede the first .tm-dest card in
    // document order. This was broken in an earlier build where the
    // panel's gate required trip.candidates (legacy) and modern trips
    // got a missing panel.
    const result = await page.evaluate(() => {
      // Find an element whose text contains "Arriv" (matches "Arriving"
      // / "Arrival") and that's small enough to be the actual label
      // (not a wrapping container with the whole trip view in it).
      const candidates = Array.from(document.querySelectorAll('body *')).filter(
        (el) => /Arriv(ing|al)/i.test(el.textContent || '') && el.children.length < 8
      );
      if (!candidates.length) return { ok: false, reason: 'no Arriving label found' };
      const firstDest = document.querySelector('.tm-dest');
      if (!firstDest) return { ok: false, reason: 'no .tm-dest' };
      // Take the earliest candidate by document position.
      const sorted = candidates.sort((a, b) => {
        const c = a.compareDocumentPosition(b);
        if (c & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (c & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });
      const h = sorted[0];
      const cmp = h.compareDocumentPosition(firstDest);
      const headingBeforeFirstDest = !!(cmp & Node.DOCUMENT_POSITION_FOLLOWING);
      return { ok: headingBeforeFirstDest, reason: headingBeforeFirstDest ? '' : 'panel below dest' };
    });
    expect(result.ok, result.reason).toBe(true);

    expect(warnings).toEqual([]);
  });
});

test.describe('Role popover — availability + Wayside gate', () => {
  test('opens the role popover for a middle destination with all roles offered (no mdcItems)', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // Target d2 (Vik), the middle destination. The Wayside row is only
    // offered when the popover has a route to attach it to — either a
    // synthetic prev→next "natural" route (requires neighbors on both
    // sides) or an existing transit route. First/last destinations
    // have no prev/next pairing, so Wayside is correctly suppressed
    // there. d2 sits between Reykjavik and Höfn, so the natural route
    // exists and Wayside should be offered.
    //
    // Invoke the popover opener directly — clicking Leaflet pins in
    // headless tests is brittle (depends on tile loading + pin
    // coords). The opener is the same function the map-pin click
    // handlers call.
    await page.evaluate(() => {
      window._openTripStopPopover({ kind: 'destination', destId: 'd2' });
    });

    const popover = page.locator('#trip-stop-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/Overnight stay/i);
    await expect(popover).toContainText(/Day trip/i);
    // The seed has zero mdcItems → sight count for Vik = 0 → gate
    // passes → Wayside row offered (and natural route is available
    // since Vik has neighbors on both sides).
    await expect(popover).toContainText(/Wayside/i);
    await expect(popover).toContainText(/See/i);

    expect(warnings).toEqual([]);
  });

  test('Wayside row is hidden when the place has more than 2 sights (mdcItems)', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Deep-clone the seed and attach 3 mdcItems all tied to Vik.
    // Targeting Vik (d2, middle dest) is important: the natural
    // prev→next route exists for d2, so Wayside would normally render.
    // The only thing suppressing it should be the gate (sightCount > 2).
    // If we used d1 (Reykjavik, first dest), Wayside would be hidden
    // for two reasons — the gate AND the lack of a natural route — and
    // the test would pass for the wrong reason.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.mdcItems = [
      { id: 'm1', name: 'Reynisfjara black sand beach', checked: true, requiredPlaces: [{ place: 'Vik' }] },
      { id: 'm2', name: 'Dyrhólaey lighthouse',         checked: true, requiredPlaces: [{ place: 'Vik' }] },
      { id: 'm3', name: 'Skógafoss waterfall',           checked: true, requiredPlaces: [{ place: 'Vik' }] },
    ];

    await bootSeeded(page, seed);

    await page.evaluate(() => {
      window._openTripStopPopover({ kind: 'destination', destId: 'd2' });
    });

    const popover = page.locator('#trip-stop-popover');
    await expect(popover).toBeVisible();
    // 3 sights > 2 → gate fires → Wayside row not rendered, even
    // though d2 has a viable natural prev→next route.
    await expect(popover).not.toContainText(/Wayside/i);
    // Other transitions still offered.
    await expect(popover).toContainText(/Day trip/i);
    await expect(popover).toContainText(/See/i);

    expect(warnings).toEqual([]);
  });
});

test.describe('Wayside geometry sanity-check (#120)', () => {
  test('reassigns a wayside from the wrong leg to its best-fit leg by perp distance', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // Set up: place Friðheimar Greenhouse (the real-world case from
    // the Iceland trip) as a wayside on the Vík → Höfn leg, even
    // though geographically it belongs to the Reykjavík → Vík leg
    // (perp distance is much smaller there). Then call the
    // reassignment helper and assert it moved to the correct leg.
    //
    // The seed has 3 destinations:
    //   d1: Reykjavik (64.14, -21.94)
    //   d2: Vik       (63.42, -19.01)
    //   d3: Höfn      (64.25, -15.20)
    // Friðheimar at (64.04, -20.50) sits well above the Vík→Höfn
    // chord (which runs east at ~63.5°N) but very close to the
    // Reykjavík→Vík chord.
    const result = await page.evaluate(() => {
      const trip = window.trip;
      trip.places = trip.places || {};
      trip.places['p-fridheimar'] = {
        id: 'p-fridheimar',
        name: 'Friðheimar Greenhouse',
        lat: 64.04, lng: -20.50,
        type: 'sight',
      };
      // Two transit routes with proper IDs matching the convention.
      trip.routes = [
        { id: 'r-tr-d1-d2', kind: 'route', subKind: 'transit', fromDestId: 'd1', toDestId: 'd2', planItems: [] },
        {
          id: 'r-tr-d2-d3', kind: 'route', subKind: 'transit', fromDestId: 'd2', toDestId: 'd3',
          planItems: [
            { id: 'pi-stop-fridheimar', type: 'stop', placeId: 'p-fridheimar', duration: 1, priority: 'optional', source: 'llm-wayside-v1' },
          ],
        },
      ];

      // Sanity-check: the wayside is currently on Vík→Höfn (wrong).
      const before = {
        onD1D2: trip.routes[0].planItems.length,
        onD2D3: trip.routes[1].planItems.length,
      };
      const summary = window._reassignWaysidesToBestLeg(trip);
      const after = {
        onD1D2: trip.routes[0].planItems.length,
        onD2D3: trip.routes[1].planItems.length,
      };
      return { before, after, summary };
    });

    expect(result.before).toEqual({ onD1D2: 0, onD2D3: 1 });
    // After reassignment: wayside moves from d2→d3 to d1→d2.
    expect(result.after).toEqual({ onD1D2: 1, onD2D3: 0 });
    expect(result.summary.moved).toBe(1);
    expect(result.summary.dropped).toBe(0);

    expect(warnings).toEqual([]);
  });

  test('one-shot enterApp migration cleans existing trips and sets the _waysidesGeoMigrated flag', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed a trip that already carries a misplaced wayside (no migration
    // flag set) so the enterApp-time migration has work to do.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.places = {
      'p-fridheimar': { id: 'p-fridheimar', name: 'Friðheimar Greenhouse', lat: 64.04, lng: -20.50, type: 'sight' },
    };
    seed.envelope.trip.routes = [
      { id: 'r-tr-d1-d2', kind: 'route', subKind: 'transit', fromDestId: 'd1', toDestId: 'd2', planItems: [] },
      {
        id: 'r-tr-d2-d3', kind: 'route', subKind: 'transit', fromDestId: 'd2', toDestId: 'd3',
        planItems: [
          { id: 'pi-stop-fridheimar', type: 'stop', placeId: 'p-fridheimar', duration: 1, priority: 'optional', source: 'llm-wayside-v1' },
        ],
      },
    ];
    // No _waysidesGeoMigrated flag → migration should fire.

    await bootSeeded(page, seed);

    const post = await page.evaluate(() => ({
      flag: !!window.trip._waysidesGeoMigrated,
      onD1D2: (window.trip.routes[0].planItems || []).length,
      onD2D3: (window.trip.routes[1].planItems || []).length,
    }));

    // Migration moved Friðheimar from d2→d3 to d1→d2 and set the flag.
    expect(post.flag).toBe(true);
    expect(post.onD1D2).toBe(1);
    expect(post.onD2D3).toBe(0);

    expect(warnings).toEqual([]);
  });

  test('drops a wayside that has no transit leg within 30 km perp distance', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // Place a wayside at a wildly off-trip location (Akureyri in
    // the north — nowhere near the south-coast chord of either
    // Reykjavík→Vík or Vík→Höfn). The reassignment pass should
    // detect no leg fits and drop it.
    const result = await page.evaluate(() => {
      const trip = window.trip;
      trip.places = trip.places || {};
      trip.places['p-akureyri'] = {
        id: 'p-akureyri',
        name: 'Akureyri',
        lat: 65.69, lng: -18.10,
        type: 'sight',
      };
      trip.routes = [
        { id: 'r-tr-d1-d2', kind: 'route', subKind: 'transit', fromDestId: 'd1', toDestId: 'd2', planItems: [] },
        {
          id: 'r-tr-d2-d3', kind: 'route', subKind: 'transit', fromDestId: 'd2', toDestId: 'd3',
          planItems: [
            { id: 'pi-stop-akureyri', type: 'stop', placeId: 'p-akureyri', duration: 2, priority: 'optional', source: 'llm-wayside-v1' },
          ],
        },
      ];
      const summary = window._reassignWaysidesToBestLeg(trip);
      const after = {
        onD1D2: trip.routes[0].planItems.length,
        onD2D3: trip.routes[1].planItems.length,
      };
      return { after, summary };
    });

    expect(result.after).toEqual({ onD1D2: 0, onD2D3: 0 });
    expect(result.summary.moved).toBe(0);
    expect(result.summary.dropped).toBe(1);

    // The dropped warning is expected (it's the function's own [Max]
    // log line) — filter it out of the regression watcher.
    const realWarnings = warnings.filter((w) => !/dropping ill-fit/i.test(w));
    expect(realWarnings).toEqual([]);
  });
});

test.describe('Migration visibility on trip load (#104)', () => {
  test('wayside migration on load surfaces a save-status toast describing what changed', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed a trip with a misplaced wayside but no migration flag, so
    // the load-time _reassignWaysidesToBestLeg pass moves it. The
    // user should see a consolidated toast in #save-status describing
    // what changed — NOT just a console log.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.places = {
      'p-fridheimar': { id: 'p-fridheimar', name: 'Friðheimar Greenhouse', lat: 64.04, lng: -20.50, type: 'sight' },
    };
    seed.envelope.trip.routes = [
      { id: 'r-tr-d1-d2', kind: 'route', subKind: 'transit', fromDestId: 'd1', toDestId: 'd2', planItems: [] },
      {
        id: 'r-tr-d2-d3', kind: 'route', subKind: 'transit', fromDestId: 'd2', toDestId: 'd3',
        planItems: [
          { id: 'pi-stop-fridheimar', type: 'stop', placeId: 'p-fridheimar', duration: 1, priority: 'optional', source: 'llm-wayside-v1' },
        ],
      },
    ];

    await bootSeeded(page, seed);

    // The save-status pill (#save-status) should display the migration
    // summary. enterApp emits it AFTER drawTripMode's initial autoSave
    // (which would otherwise clobber the message), so the test has to
    // wait for the trailing toast. toContainText polls until the
    // expected text shows up — up to its default timeout.
    const status = page.locator('#save-status');
    await expect(status).toContainText(/Updated this trip/i, { timeout: 5000 });
    await expect(status).toContainText(/wayside/i);

    expect(warnings).toEqual([]);
  });
});

test.describe('Visual continuity on role conversion (#104 production)', () => {
  test('dayTrip → overnight flashes the newly-created destination card', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed a trip with a day-trip route under Reykjavík with a single
    // stop (Þingvellir). Promoting that stop back to overnight should
    // create a fresh .tm-dest card AND apply the flash highlight.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.places = {
      'p-thingvellir': { id: 'p-thingvellir', name: 'Þingvellir', lat: 64.26, lng: -21.13, type: 'sight' },
    };
    seed.envelope.trip.routes = [
      {
        id: 'r-dt-d1-thingvellir', kind: 'route', subKind: 'dayTrip',
        fromDestId: 'd1', toDestId: 'd1',
        planItems: [
          { id: 'pi-stop-thingvellir', type: 'stop', placeId: 'p-thingvellir', duration: 1.5, priority: 'iconic', notes: 'Where tectonic plates meet.', legacy: { sourceNights: 1 } },
        ],
      },
    ];

    await bootSeeded(page, seed);

    await page.evaluate(() => {
      const route = window.trip.routes[0];
      const stop = route.planItems[0];
      const hub = window.trip.destinations.find(function (d) { return d.id === 'd1'; });
      window._applyStopRoleChange(
        { kind: 'dayTrip', hubDest: hub, route, stop },
        'dayTrip',
        'overnight',
        {}
      );
    });

    // Wait for any .tm-dest with the flash class — the new dest's id
    // is minted server-side via destCtr so we don't know it ahead of
    // time, but there should be exactly one card pulsing.
    const flashed = await page.locator('.tm-dest.tm-just-moved').waitFor({
      state: 'attached',
      timeout: 3000,
    }).then(() => true).catch(() => false);
    expect(flashed).toBe(true);

    // And the trip should now have 4 destinations (3 + the promoted one).
    const destCount = await page.evaluate(() => window.trip.destinations.length);
    expect(destCount).toBe(4);

    expect(warnings).toEqual([]);
  });

  test('see → overnight applies the .tm-just-moved class to the dest card', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed with a 0-night "see" destination so we can promote it
    // back to an overnight and assert the highlight class lands on
    // the right card. The class is applied via JS after the re-render,
    // then auto-decays via CSS animation over ~2.4s — the test catches
    // it during the brief window when it's present.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.destinations[1].nights = 0;
    seed.envelope.trip.destinations[1].dateTo = seed.envelope.trip.destinations[1].dateFrom;

    await bootSeeded(page, seed);

    // Trigger the conversion through the dispatcher.
    await page.evaluate(() => {
      window._applyStopRoleChange(
        { kind: 'destination', destId: 'd2' },
        'see',
        'overnight',
        {}
      );
    });

    // The flash helper uses a short setTimeout chain (30ms + 180ms
    // retry) to wait for the re-render. Poll for the class.
    const hasFlash = await page.locator('.tm-dest[data-id="d2"].tm-just-moved').waitFor({
      state: 'attached',
      timeout: 3000,
    }).then(() => true).catch(() => false);
    expect(hasFlash).toBe(true);

    expect(warnings).toEqual([]);
  });
});

test.describe('How Max thinks — philosophy modal (#110)', () => {
  test('opens and surfaces the river / Eisenhower / Faulkner / lineage content', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // The home-screen footer link and the trip-view More-menu entry
    // both call showAboutMax(). Call it directly to exercise the
    // wiring without depending on dom traversal.
    await page.evaluate(() => {
      if (typeof window.showAboutMax !== 'function') {
        throw new Error('showAboutMax not on window');
      }
      window.showAboutMax();
    });

    const overlay = page.locator('#about-max-overlay');
    await expect(overlay).toBeVisible();

    // The modal should render the river metaphor up front, the
    // Eisenhower quote, and the wisp-arc + Faulkner block lower down.
    // These three are the new content this task added; pinning their
    // presence prevents the philosophy from silently regressing back
    // to the prior text.
    const txt = page.locator('#about-max-text');
    await expect(txt).toContainText(/A trip is like a river/i);
    await expect(txt).toContainText(/Eisenhower/);
    await expect(txt).toContainText(/Plans are useless, but planning is everything/i);
    await expect(txt).toContainText(/wisp.*living.*travel.*real/is);
    await expect(txt).toContainText(/Faulkner/);
    await expect(txt).toContainText(/The past is never dead/i);

    expect(warnings).toEqual([]);
  });
});

test.describe('Per-leg honesty surface', () => {
  test('route chip shows drive-time estimate between consecutive destinations', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // The honesty surface renders inside .route-chip-inner as a second
    // line under the route-options row. It's text like "~2h45 drive" or
    // "~2h45 drive · 3 stops along the way". Reykjavik (64.14,-21.94)
    // to Vik (63.42,-19.01) is ~165 km, which at 60 km/h reads as ~2h45.
    // We don't assert the exact minutes (rounding to 5-min buckets means
    // small coord changes can flip the label by ±5m); we assert that
    // SOME drive label renders.
    const chips = await page.locator('.route-chip').count();
    expect(chips).toBe(2); // 3 destinations → 2 inter-leg chips

    // First chip should contain a drive-time label.
    const firstChipText = await page.locator('.route-chip').first().textContent();
    expect(firstChipText).toMatch(/~\d+h\d{0,2}\s*drive|~\d+m\s*drive/);

    // No waysides in the seed → "N stops along the way" should NOT appear.
    expect(firstChipText).not.toMatch(/stops? along the way/i);

    expect(warnings).toEqual([]);
  });
});

test.describe('Role popover — What\'s here block', () => {
  test('popover shows activities/sights linked to the destination via mdcItems', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed three mdcItems linked to Vik (d2). The "What's here" block
    // should pull these into the popover so the user sees what's at
    // the place before deciding its role. Without this block the user
    // has to scroll the destination card to see the same info.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.mdcItems = [
      { id: 'm1', name: 'Reynisfjara black sand beach', why: 'Basalt columns + Atlantic surf', checked: true, requiredPlaces: [{ place: 'Vik' }] },
      { id: 'm2', name: 'Dyrhólaey lighthouse',         why: 'Sea-cliff viewpoint + puffins in summer', checked: true, requiredPlaces: [{ place: 'Vik' }] },
      { id: 'm3', name: 'Skógafoss waterfall',           why: 'Walk behind the falls', checked: true, requiredPlaces: [{ place: 'Vik' }] },
    ];

    await bootSeeded(page, seed);

    await page.evaluate(() => {
      window._openTripStopPopover({ kind: 'destination', destId: 'd2' });
    });

    const popover = page.locator('#trip-stop-popover');
    await expect(popover).toBeVisible();
    // Block heading + each activity name should render inside the popover.
    await expect(popover).toContainText(/What['’]s here/i);
    await expect(popover).toContainText(/Reynisfjara black sand beach/i);
    await expect(popover).toContainText(/Dyrhólaey lighthouse/i);
    await expect(popover).toContainText(/Skógafoss waterfall/i);

    expect(warnings).toEqual([]);
  });

  test('What\'s here surfaces stop notes + duration when popover opens for a wayside', async ({ page }) => {
    const warnings = attachWarningWatcher(page);

    // Seed a trip with a wayside on the Reykjavík → Vík transit route.
    // The wayside is Seljalandsfoss with the LLM's note "A 60m waterfall
    // you can walk behind" and a 0.5h recommended duration. The popover
    // should surface BOTH inside the "What's here" block — that's the
    // info the user needs to decide whether 30 minutes is worth a stop.
    const seed = JSON.parse(JSON.stringify(ICELAND_RING));
    seed.envelope.trip.places = {
      'p-seljalandsfoss': { id: 'p-seljalandsfoss', name: 'Seljalandsfoss', lat: 63.61, lng: -19.99, type: 'sight' },
    };
    seed.envelope.trip.routes = [
      {
        id: 'r-tr-d1-d2', kind: 'route', subKind: 'transit', fromDestId: 'd1', toDestId: 'd2',
        planItems: [
          {
            id: 'pi-stop-selja',
            type: 'stop',
            placeId: 'p-seljalandsfoss',
            duration: 0.5,
            priority: 'iconic',
            notes: 'A 60m waterfall you can walk behind.',
            source: 'llm-wayside-v1',
          },
        ],
      },
    ];

    await bootSeeded(page, seed);

    await page.evaluate(() => {
      const route = window.trip.routes[0];
      const stop = route.planItems[0];
      window._openTripStopPopover({ kind: 'wayside', route, stop });
    });

    const popover = page.locator('#trip-stop-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/What['’]s here/i);
    await expect(popover).toContainText(/Seljalandsfoss/i);
    // Duration formatted as "30m" (0.5h).
    await expect(popover).toContainText(/30m/);
    // Distance from the route's start (Reykjavik). Seljalandsfoss
    // (63.61, -19.99) to Reykjavik (64.14, -21.94) is ~125 km
    // by haversine; the popover should surface that as "~125 km
    // from Reykjavik".
    await expect(popover).toContainText(/~\d+\s*km from Reykjavik/i);
    // Description from stop.notes appears.
    await expect(popover).toContainText(/60m waterfall you can walk behind/i);

    expect(warnings).toEqual([]);
  });

  test('What\'s here block is omitted when the place has no linked activities', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    // Seed has zero mdcItems and no suggestions → "What's here" block
    // should not render at all. Pins the contract that the popover
    // doesn't sprout an empty section.
    await bootSeeded(page, ICELAND_RING);

    await page.evaluate(() => {
      window._openTripStopPopover({ kind: 'destination', destId: 'd2' });
    });

    const popover = page.locator('#trip-stop-popover');
    await expect(popover).toBeVisible();
    await expect(popover).not.toContainText(/What['’]s here/i);

    expect(warnings).toEqual([]);
  });
});

test.describe('Role conversions — no silent failures', () => {
  test('overnight → wayside → overnight round-trip completes without "[Max]" warnings', async ({ page }) => {
    const warnings = attachWarningWatcher(page);
    await bootSeeded(page, ICELAND_RING);

    // Step 1: convert Vik (d2) to a wayside via the dispatcher. The
    // natural route between Vik's neighbors is Reykjavik → Höfn, which
    // gets the id "r-tr-d1-d3" by convention.
    await page.evaluate(() => {
      window._applyStopRoleChange(
        { kind: 'destination', destId: 'd2' },
        'overnight',
        'wayside',
        { routeId: 'r-tr-d1-d3' }
      );
    });
    await page.waitForFunction(() => window.trip.destinations.length === 2);

    const afterWayside = await page.evaluate(() => ({
      destPlaces: window.trip.destinations.map((d) => d.place),
      routeStopPlaceIds: (window.trip.routes || []).flatMap((r) =>
        (r.planItems || [])
          .filter((p) => p.type === 'stop')
          .map((p) => p.placeId || '')
      ),
    }));
    expect(afterWayside.destPlaces).toEqual(['Reykjavik', 'Höfn']);
    // Vik is now a stop on a route somewhere.
    const vikStop = afterWayside.routeStopPlaceIds.find((id) => /vik/i.test(id));
    expect(vikStop, 'expected Vik to appear as a wayside stop on some route').toBeTruthy();

    // Step 2: reverse — promote the wayside back to an overnight. This
    // is the exact bug from this session that returned "[Max]
    // ungroupWaysideByRouteStop: stop not found on route" and silently
    // closed the popover. With the placeId fallback + date seeding
    // fixes, it should now complete cleanly.
    await page.evaluate(() => {
      const route = window.trip.routes.find((r) =>
        (r.planItems || []).some(
          (p) => p.type === 'stop' && /vik/i.test(p.placeId || '')
        )
      );
      const stop = route.planItems.find(
        (p) => p.type === 'stop' && /vik/i.test(p.placeId || '')
      );
      window._applyStopRoleChange(
        { kind: 'wayside', route, stop },
        'wayside',
        'overnight',
        {}
      );
    });
    await page.waitForFunction(() => window.trip.destinations.length === 3);

    const afterPromote = await page.evaluate(() => ({
      destPlaces: window.trip.destinations.map((d) => d.place),
    }));
    expect(afterPromote.destPlaces.some((p) => /vik/i.test(p))).toBe(true);

    // The whole round trip must produce zero "[Max]" warnings.
    expect(warnings).toEqual([]);
  });
});
