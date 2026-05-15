// migration-tests.js — Node-runnable tests for trip envelope migration.
//
// Run: `node tests/migration-tests.js` from the max/ root.
//
// Covers the v0 → v1 migration in migration.js:
//   - trip.places{} dictionary built from inline data
//   - dest.placeId set to ref trip.places
//   - dest.days[] built from dateFrom/dateTo
//   - dest.dayTrips[] → PlanItems with type:dayTrip on day[0]
//   - Idempotency (run twice, second is a no-op)
//   - Edge cases (empty trips, malformed entries, dates missing)

'use strict';

const fs = require('fs');
const assert = require('assert');
const path = require('path');

global.window = global;

const ROOT = path.resolve(__dirname, '..');
function loadModule(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code);
}
loadModule('migration.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log('  ✗ ' + name);
    console.log('      ' + (e.stack || e.message || e));
  }
}

function describe(name, fn) {
  console.log('\n' + name);
  fn();
}

// Convenience: deep clone for tests that want to assert non-mutation.
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Build a minimal legacy envelope (schema v0) for testing.
function legacyEnvelope(overrides) {
  const env = {
    trip: {
      id: 'trip-test-1',
      name: 'Iceland test',
      destinations: [
        {
          id: 'dest-1',
          place: 'Reykjavík',
          country: 'Iceland',
          nights: 3,
          dateFrom: '2026-06-01',
          dateTo: '2026-06-04',
          lat: 64.1466,
          lng: -21.9426,
          dayTrips: [
            {
              place: 'Blue Lagoon',
              country: 'Iceland',
              lat: 63.8804,
              lng: -22.4495,
              whyItFits: 'Iconic geothermal spa',
              sourceNights: 1,
              absorbedFromHub: 'Reykjavík',
              distKm: 39
            }
          ]
        }
      ]
    },
    activeDest: 'dest-1'
  };
  if (overrides && overrides.trip) {
    Object.assign(env.trip, overrides.trip);
  }
  return env;
}

// ── Suite: makePlaceId ─────────────────────────────────────────

describe('makePlaceId — deterministic from name', () => {
  const { makePlaceId } = MaxMigration._internal;

  test('same name → same id', () => {
    assert.strictEqual(makePlaceId('Reykjavik'), makePlaceId('Reykjavik'));
  });

  test('strips diacritics for matching', () => {
    assert.strictEqual(makePlaceId('Reykjavík'), makePlaceId('Reykjavik'));
  });

  test('case-insensitive', () => {
    assert.strictEqual(makePlaceId('REYKJAVIK'), makePlaceId('reykjavik'));
  });

  test('produces a stable slug', () => {
    assert.strictEqual(makePlaceId('Reykjavík'), 'pl-reykjavik');
    assert.strictEqual(makePlaceId('Blue Lagoon'), 'pl-blue-lagoon');
    assert.strictEqual(makePlaceId('Vík í Mýrdal'), 'pl-vik-i-myrdal');
  });

  test('handles empty / nullish', () => {
    assert.strictEqual(makePlaceId(''), 'pl-unknown');
    assert.strictEqual(makePlaceId(null), 'pl-unknown');
    assert.strictEqual(makePlaceId(undefined), 'pl-unknown');
  });
});

// ── Suite: buildDaysForDest ────────────────────────────────────

describe('buildDaysForDest — calendar days from dateFrom/dateTo', () => {
  const { buildDaysForDest } = MaxMigration._internal;

  test('3-night stay produces 3 day entries', () => {
    const days = buildDaysForDest({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-04'
    });
    assert.strictEqual(days.length, 3);
    assert.strictEqual(days[0].date, '2026-06-01');
    assert.strictEqual(days[1].date, '2026-06-02');
    assert.strictEqual(days[2].date, '2026-06-03');
  });

  test('each day has an empty planItems[]', () => {
    const days = buildDaysForDest({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-02'
    });
    assert.strictEqual(days.length, 1);
    assert.deepStrictEqual(days[0].planItems, []);
  });

  test('falls back to nights when no dates', () => {
    const days = buildDaysForDest({ nights: 2 });
    assert.strictEqual(days.length, 2);
    assert.strictEqual(days[0].date, null);
    assert.deepStrictEqual(days[0].planItems, []);
  });

  test('zero / missing data → empty array', () => {
    assert.deepStrictEqual(buildDaysForDest({}), []);
    assert.deepStrictEqual(buildDaysForDest({ nights: 0 }), []);
  });
});

// ── Suite: migrateTripShape (v0 → v1) ──────────────────────────

describe('migrateTripShape — sets schema version', () => {
  test('legacy envelope (no _schemaVersion) gets bumped to current', () => {
    const env = legacyEnvelope();
    assert.strictEqual(env.trip._schemaVersion, undefined);
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(env.trip._schemaVersion, MaxMigration.CURRENT_SCHEMA_VERSION);
  });

  test('null envelope is a no-op (no throw)', () => {
    assert.strictEqual(MaxMigration.migrateTripShape(null), null);
  });

  test('envelope without .trip is a no-op', () => {
    const env = { foo: 'bar' };
    const out = MaxMigration.migrateTripShape(env);
    assert.strictEqual(out, env);
    assert.strictEqual(out.foo, 'bar');
  });

  test('already-migrated envelope is unchanged (idempotent)', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const after = clone(env);
    MaxMigration.migrateTripShape(env);
    assert.deepStrictEqual(env, after, 'second migration should not change anything');
  });
});

describe('migrateTripShape — trip.places{} dictionary', () => {
  test('creates trip.places if missing', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(typeof env.trip.places, 'object');
    assert(env.trip.places !== null);
  });

  test('Reykjavík is in trip.places after migration', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const place = env.trip.places['pl-reykjavik'];
    assert(place, 'Reykjavik place should exist');
    assert.strictEqual(place.name, 'Reykjavík');
    assert.strictEqual(place.country, 'Iceland');
    assert.strictEqual(place.lat, 64.1466);
    assert.strictEqual(place.lng, -21.9426);
  });

  test('day-trip place gets its own entry in trip.places', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const place = env.trip.places['pl-blue-lagoon'];
    assert(place, 'Blue Lagoon place should exist');
    assert.strictEqual(place.name, 'Blue Lagoon');
    assert.strictEqual(place.lat, 63.8804);
  });

  test('same place across destinations dedupes to one entry', () => {
    const env = legacyEnvelope({
      trip: {
        destinations: [
          { id: 'd1', place: 'Reykjavík', country: 'Iceland', nights: 2,
            dateFrom: '2026-06-01', dateTo: '2026-06-03', lat: 64.1, lng: -21.9 },
          { id: 'd2', place: 'Vík', country: 'Iceland', nights: 1,
            dateFrom: '2026-06-03', dateTo: '2026-06-04', lat: 63.4, lng: -19.0,
            dayTrips: [
              { place: 'Reykjavík', country: 'Iceland', lat: 64.1, lng: -21.9 }
            ]
          }
        ]
      }
    });
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(Object.keys(env.trip.places).length, 2,
      'should dedupe Reykjavik to one entry');
    assert(env.trip.places['pl-reykjavik']);
    assert(env.trip.places['pl-vik']);
  });

  test('preserves existing trip.places entries', () => {
    const env = legacyEnvelope();
    env.trip.places = {
      'pl-custom': { id: 'pl-custom', name: 'Custom Place', type: 'sight' }
    };
    MaxMigration.migrateTripShape(env);
    assert(env.trip.places['pl-custom'], 'pre-existing entry should be preserved');
    assert(env.trip.places['pl-reykjavik'], 'new entries still get added');
  });

  test('backfills missing lat/lng on existing place entries', () => {
    const env = legacyEnvelope();
    env.trip.places = {
      'pl-reykjavik': { id: 'pl-reykjavik', name: 'Reykjavík', type: 'city' }
    };
    MaxMigration.migrateTripShape(env);
    const place = env.trip.places['pl-reykjavik'];
    assert.strictEqual(place.lat, 64.1466, 'should backfill lat from destination');
    assert.strictEqual(place.lng, -21.9426);
    assert.strictEqual(place.country, 'Iceland');
  });
});

describe('migrateTripShape — dest.placeId + dest.days[]', () => {
  test('each destination gets a placeId ref', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    assert.strictEqual(dest.placeId, 'pl-reykjavik');
  });

  test('dest.place (string) is preserved for back-compat', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    assert.strictEqual(dest.place, 'Reykjavík',
      'legacy string field should still be present');
  });

  test('dest.days[] is built from dateFrom..dateTo', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    assert.strictEqual(dest.days.length, 3);
    assert.strictEqual(dest.days[0].date, '2026-06-01');
    assert.strictEqual(dest.days[2].date, '2026-06-03');
  });

  test('each day has empty planItems[]', () => {
    const env = legacyEnvelope();
    // Remove dayTrips so day[0].planItems stays empty
    env.trip.destinations[0].dayTrips = [];
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    dest.days.forEach(day => {
      assert(Array.isArray(day.planItems), 'planItems should be array');
      assert.strictEqual(day.planItems.length, 0);
    });
  });

  test('existing dest.days are normalized (planItems[] added if missing)', () => {
    const env = legacyEnvelope();
    env.trip.destinations[0].days = [
      { date: '2026-06-01' }, // no planItems
      { date: '2026-06-02', planItems: [{ id: 'pre-existing', type: 'sight' }] },
      { date: '2026-06-03' }
    ];
    env.trip.destinations[0].dayTrips = []; // skip dayTrip migration
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    assert.strictEqual(dest.days.length, 3);
    assert(Array.isArray(dest.days[0].planItems));
    assert.strictEqual(dest.days[0].planItems.length, 0);
    assert.strictEqual(dest.days[1].planItems.length, 1,
      'pre-existing PlanItems should be preserved');
    assert.strictEqual(dest.days[1].planItems[0].id, 'pre-existing');
    assert(Array.isArray(dest.days[2].planItems));
  });

  test('legacy day shape (id/lbl/note/items) gets date + planItems backfilled', () => {
    // Real Max trips have days with this shape — built by makeDays()
    // long before the migration existed.
    const env = legacyEnvelope();
    env.trip.destinations[0].days = [
      { id: 'dyd1_0', lbl: 'Sep 17', note: 'arrival', items: [] },
      { id: 'dyd1_1', lbl: 'Sep 18', items: [{ id: 's1', n: 'A sight' }] },
      { id: 'dyd1_2', lbl: 'Sep 19', items: [] }
    ];
    env.trip.destinations[0].dateFrom = '2026-09-17';
    env.trip.destinations[0].dateTo = '2026-09-20';
    env.trip.destinations[0].dayTrips = [];
    MaxMigration.migrateTripShape(env);
    const days = env.trip.destinations[0].days;
    // date backfilled from dateFrom + index
    assert.strictEqual(days[0].date, '2026-09-17');
    assert.strictEqual(days[1].date, '2026-09-18');
    assert.strictEqual(days[2].date, '2026-09-19');
    // planItems[] added (empty)
    days.forEach(d => {
      assert(Array.isArray(d.planItems), 'planItems should exist on every day');
      assert.strictEqual(d.planItems.length, 0);
    });
    // Legacy fields preserved
    assert.strictEqual(days[0].id, 'dyd1_0');
    assert.strictEqual(days[0].lbl, 'Sep 17');
    assert.strictEqual(days[0].note, 'arrival');
    assert.strictEqual(days[1].items.length, 1, 'legacy items[] preserved');
    assert.strictEqual(days[1].items[0].n, 'A sight');
  });

  test('legacy days without dateFrom keep undefined date (graceful)', () => {
    const env = legacyEnvelope();
    env.trip.destinations[0].days = [
      { id: 'd1', lbl: 'Day 1', items: [] }
    ];
    env.trip.destinations[0].dateFrom = null;
    env.trip.destinations[0].dateTo = null;
    env.trip.destinations[0].dayTrips = [];
    MaxMigration.migrateTripShape(env);
    const day = env.trip.destinations[0].days[0];
    assert(Array.isArray(day.planItems), 'planItems still added');
    // date should be undefined, not crash
    assert.ok(day.date === undefined || day.date === null,
      'date should be undefined when no dateFrom');
  });
});

// These tests use the per-version migrator _migrateV0toV1 so they
// can assert the v1 intermediate state (dayTrip-typed PlanItems on
// day[0]). The full pipeline goes v0 → v1 → v2; v2 converts those
// PlanItems into route references, asserted in a separate suite below.
const _migrateV0toV1 = MaxMigration._internal.migrateV0toV1;
const _migrateV1toV2 = MaxMigration._internal.migrateV1toV2;

describe('migrateTripShape v0→v1 — dest.dayTrips → PlanItems on day[0]', () => {
  test('legacy dayTrip becomes a PlanItem on day[0]', () => {
    const env = legacyEnvelope();
    _migrateV0toV1(env);
    const day0 = env.trip.destinations[0].days[0];
    assert.strictEqual(day0.planItems.length, 1);
    const pi = day0.planItems[0];
    assert.strictEqual(pi.type, 'dayTrip');
    assert.strictEqual(pi.state, 'suggestion');
    assert.strictEqual(pi.placeId, 'pl-blue-lagoon');
    assert.strictEqual(pi.source, 'legacy-daytrip');
  });

  test('PlanItem carries legacy bookkeeping (sourceNights, hub)', () => {
    const env = legacyEnvelope();
    _migrateV0toV1(env);
    const pi = env.trip.destinations[0].days[0].planItems[0];
    assert.strictEqual(pi.legacy.sourceNights, 1);
    assert.strictEqual(pi.legacy.absorbedFromHub, 'Reykjavík');
    assert.strictEqual(pi.legacy.distKm, 39);
  });

  test('PlanItem notes come from whyItFits', () => {
    const env = legacyEnvelope();
    _migrateV0toV1(env);
    const pi = env.trip.destinations[0].days[0].planItems[0];
    assert.strictEqual(pi.notes, 'Iconic geothermal spa');
  });

  test('multiple dayTrips on one destination → multiple PlanItems on day[0]', () => {
    const env = legacyEnvelope({
      trip: {
        destinations: [{
          id: 'dest-1',
          place: 'Reykjavík',
          country: 'Iceland',
          nights: 3,
          dateFrom: '2026-06-01',
          dateTo: '2026-06-04',
          dayTrips: [
            { place: 'Blue Lagoon', country: 'Iceland' },
            { place: 'Þingvellir', country: 'Iceland' },
            { place: 'Geysir', country: 'Iceland' }
          ]
        }]
      }
    });
    _migrateV0toV1(env);
    const day0 = env.trip.destinations[0].days[0];
    assert.strictEqual(day0.planItems.length, 3);
    const places = day0.planItems.map(pi => pi.placeId).sort();
    assert.deepStrictEqual(places, ['pl-blue-lagoon', 'pl-geysir', 'pl-thingvellir']);
  });

  test('idempotent — second v0→v1 migration does not duplicate PlanItems', () => {
    const env = legacyEnvelope();
    _migrateV0toV1(env);
    const countAfterFirst = env.trip.destinations[0].days[0].planItems.length;
    // Reset schema version to force a re-run (simulates a partial earlier migration)
    delete env.trip._schemaVersion;
    _migrateV0toV1(env);
    const countAfterSecond = env.trip.destinations[0].days[0].planItems.length;
    assert.strictEqual(countAfterSecond, countAfterFirst,
      'PlanItems should not duplicate on re-migration');
  });

  test('malformed dayTrip (no place) is skipped silently', () => {
    const env = legacyEnvelope({
      trip: {
        destinations: [{
          id: 'dest-1',
          place: 'Reykjavík',
          country: 'Iceland',
          nights: 2,
          dateFrom: '2026-06-01',
          dateTo: '2026-06-03',
          dayTrips: [
            { place: 'Blue Lagoon', country: 'Iceland' },
            { /* no place field */ whyItFits: 'broken entry' },
            null,
            { place: '', country: 'Iceland' }
          ]
        }]
      }
    });
    _migrateV0toV1(env);
    const planItems = env.trip.destinations[0].days[0].planItems;
    assert.strictEqual(planItems.length, 1,
      'only the valid dayTrip should become a PlanItem');
  });

  test('destination with no days[] (no dates) cannot accept dayTrips as PlanItems', () => {
    const env = legacyEnvelope({
      trip: {
        destinations: [{
          id: 'dest-1',
          place: 'Somewhere',
          country: 'XX',
          // no dateFrom/dateTo, no nights → days[] will be empty
          dayTrips: [{ place: 'Side Trip', country: 'XX' }]
        }]
      }
    });
    MaxMigration.migrateTripShape(env);
    const dest = env.trip.destinations[0];
    assert.deepStrictEqual(dest.days, [],
      'no days when no dates and no nights');
    // The Place entry IS still created — it's a known place worth referencing
    assert(env.trip.places['pl-side-trip'],
      'place should still be added to dict');
  });
});

describe('migrateTripShape — empty / edge inputs', () => {
  test('trip with no destinations is migrated (just sets places + version)', () => {
    const env = { trip: { id: 't1', destinations: [] } };
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(env.trip._schemaVersion, MaxMigration.CURRENT_SCHEMA_VERSION);
    assert.deepStrictEqual(env.trip.places, {});
  });

  test('trip with destination but no dayTrips is migrated cleanly', () => {
    const env = {
      trip: {
        id: 't1',
        destinations: [{
          id: 'd1', place: 'Paris', country: 'France', nights: 3,
          dateFrom: '2026-09-01', dateTo: '2026-09-04'
        }]
      }
    };
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(env.trip._schemaVersion, MaxMigration.CURRENT_SCHEMA_VERSION);
    assert(env.trip.places['pl-paris']);
    assert.strictEqual(env.trip.destinations[0].placeId, 'pl-paris');
    assert.strictEqual(env.trip.destinations[0].days.length, 3);
    env.trip.destinations[0].days.forEach(d => {
      assert.deepStrictEqual(d.planItems, []);
    });
    // v2 also adds an empty routes[] when none exist.
    assert.deepStrictEqual(env.trip.routes, []);
    // v2 backfills day ids.
    env.trip.destinations[0].days.forEach((d, idx) => {
      assert.strictEqual(d.id, 'd-d1-' + idx);
    });
  });
});

// ── Suite: v1 → v2 (dayTrip PlanItems → Routes) ────────────────

// Build a v1-shaped envelope (places{}, dest.placeId, dest.days[],
// at least one {type:"dayTrip"} PlanItem on day[0]). This is what
// the v0→v1 migration produces; v1→v2 takes it from here.
function v1EnvelopeWithDayTrip(overrides) {
  const env = legacyEnvelope(overrides);
  _migrateV0toV1(env);
  return env;
}

describe('migrateTripShape v1→v2 — dayTrip PlanItems → Routes', () => {
  test('dayTrip PlanItem becomes a route reference + a routes[] entry', () => {
    const env = v1EnvelopeWithDayTrip();
    _migrateV1toV2(env);

    // The route was created.
    assert.strictEqual(env.trip.routes.length, 1);
    const route = env.trip.routes[0];
    assert.strictEqual(route.kind, 'dayTrip');
    assert.strictEqual(route.fromDestId, 'dest-1');
    assert.strictEqual(route.toDestId, 'dest-1');
    assert.strictEqual(route.id, 'r-dt-dest-1-pl-blue-lagoon');

    // The route has a single stop PlanItem, marked iconic.
    assert.strictEqual(route.planItems.length, 1);
    const stop = route.planItems[0];
    assert.strictEqual(stop.type, 'stop');
    assert.strictEqual(stop.priority, 'iconic');
    assert.strictEqual(stop.placeId, 'pl-blue-lagoon');

    // The legacy bookkeeping rode along on the stop.
    assert.strictEqual(stop.legacy.sourceNights, 1);
    assert.strictEqual(stop.legacy.distKm, 39);

    // The hub day's planItems now has a single route reference,
    // replacing the original dayTrip PlanItem.
    const day0 = env.trip.destinations[0].days[0];
    assert.strictEqual(day0.planItems.length, 1);
    assert.strictEqual(day0.planItems[0].type, 'route');
    assert.strictEqual(day0.planItems[0].routeId, route.id);

    // The route's transitDays points back at this day.
    assert.strictEqual(route.transitDays.length, 1);
    assert.strictEqual(route.transitDays[0], day0.id);
  });

  test('multiple dayTrip PlanItems → multiple routes + multiple route refs', () => {
    const env = v1EnvelopeWithDayTrip({
      trip: {
        destinations: [{
          id: 'dest-1', place: 'Reykjavík', country: 'Iceland', nights: 3,
          dateFrom: '2026-06-01', dateTo: '2026-06-04',
          dayTrips: [
            { place: 'Blue Lagoon', country: 'Iceland' },
            { place: 'Þingvellir', country: 'Iceland' },
            { place: 'Geysir', country: 'Iceland' }
          ]
        }]
      }
    });
    _migrateV1toV2(env);

    assert.strictEqual(env.trip.routes.length, 3);
    env.trip.routes.forEach(r => {
      assert.strictEqual(r.kind, 'dayTrip');
      assert.strictEqual(r.fromDestId, 'dest-1');
      assert.strictEqual(r.toDestId, 'dest-1');
      assert.strictEqual(r.planItems.length, 1);
      assert.strictEqual(r.planItems[0].priority, 'iconic');
    });

    const day0 = env.trip.destinations[0].days[0];
    assert.strictEqual(day0.planItems.length, 3);
    day0.planItems.forEach(pi => {
      assert.strictEqual(pi.type, 'route');
      assert(pi.routeId);
    });
  });

  test('idempotent — running v1→v2 twice does not duplicate routes', () => {
    const env = v1EnvelopeWithDayTrip();
    _migrateV1toV2(env);
    const routesAfterFirst = env.trip.routes.length;
    const dayItemsAfterFirst = env.trip.destinations[0].days[0].planItems.length;

    // Reset version flag and re-run; the route already exists so v1→v2
    // should be a no-op on the second pass (no dayTrip PlanItems left
    // to convert).
    delete env.trip._schemaVersion;
    _migrateV1toV2(env);

    assert.strictEqual(env.trip.routes.length, routesAfterFirst);
    assert.strictEqual(env.trip.destinations[0].days[0].planItems.length, dayItemsAfterFirst);
  });

  test('every day gets a backfilled id (route↔day bidirectional ref needs them)', () => {
    const env = v1EnvelopeWithDayTrip();
    // The v0→v1 step builds days without ids; v1→v2 must backfill.
    env.trip.destinations[0].days.forEach(d => assert.strictEqual(d.id, undefined));
    _migrateV1toV2(env);
    env.trip.destinations[0].days.forEach((d, idx) => {
      assert.strictEqual(d.id, 'd-dest-1-' + idx);
    });
  });

  test('full pipeline v0→v1→v2→v3 produces routes (no dayTrip PlanItems remain)', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    // No dayTrip-typed PlanItems anywhere.
    env.trip.destinations.forEach(d => {
      (d.days || []).forEach(day => {
        (day.planItems || []).forEach(pi => {
          assert.notStrictEqual(pi.type, 'dayTrip');
        });
      });
    });
    // The dayTrip Route exists. Post-v3, kind:"route" is the Segment
    // discriminator and subKind:"dayTrip" identifies the loop. (The
    // legacy entry/exit strings on the test fixture also synthesize
    // arrival + departure routes, so we don't assert on routes.length.)
    const dayTripRoute = env.trip.routes.find(r => r && r.subKind === 'dayTrip');
    assert(dayTripRoute, 'expected a kind:"route" subKind:"dayTrip" route to exist');
    assert.strictEqual(dayTripRoute.kind, 'route');
    assert.strictEqual(dayTripRoute.subKind, 'dayTrip');
  });

  test('v2 with no dayTrip PlanItems is a no-op (just bumps version + ensures routes[])', () => {
    const env = {
      trip: {
        id: 't1',
        _schemaVersion: 1,
        places: { 'pl-paris': { id: 'pl-paris', name: 'Paris', type: 'city' } },
        destinations: [{
          id: 'd1', place: 'Paris', country: 'France', nights: 2, placeId: 'pl-paris',
          dateFrom: '2026-09-01', dateTo: '2026-09-03',
          days: [
            { date: '2026-09-01', planItems: [] },
            { date: '2026-09-02', planItems: [] }
          ]
        }]
      }
    };
    _migrateV1toV2(env);
    assert.strictEqual(env.trip._schemaVersion, 2);
    assert.deepStrictEqual(env.trip.routes, []);
    // Day ids were backfilled.
    env.trip.destinations[0].days.forEach((d, idx) => {
      assert.strictEqual(d.id, 'd-d1-' + idx);
    });
  });
});

// ── Suite: v2 → v3 (Segment polymorphic base + Reference + arrival/departure routes) ──

function v2EnvelopeReady(overrides) {
  // Build a v2-shaped envelope: legacy + v0→v1 + v1→v2.
  const env = legacyEnvelope(overrides);
  _migrateV0toV1(env);
  _migrateV1toV2(env);
  return env;
}

const _migrateV2toV3 = MaxMigration._internal.migrateV2toV3;

describe('migrateTripShape v2→v3 — Segment polymorphic base', () => {
  test('Trip envelope gets kind:"trip", startsAt, endsAt', () => {
    const env = v2EnvelopeReady();
    _migrateV2toV3(env);
    assert.strictEqual(env.trip.kind, 'trip');
    assert.strictEqual(env.trip.startsAt.date, '2026-06-01');
    // Legacy envelope has one destination with dateTo 2026-06-04, so endsAt matches.
    assert.strictEqual(env.trip.endsAt.date, '2026-06-04');
  });

  test('Each Stay (destination) gets kind:"stay", startsAt, endsAt', () => {
    const env = v2EnvelopeReady();
    _migrateV2toV3(env);
    env.trip.destinations.forEach(d => {
      assert.strictEqual(d.kind, 'stay');
      if (d.dateFrom) assert.strictEqual(d.startsAt.date, d.dateFrom);
      if (d.dateTo)   assert.strictEqual(d.endsAt.date,   d.dateTo);
    });
  });

  test('Each Day gets kind:"day", startsAt, endsAt (next-day)', () => {
    const env = v2EnvelopeReady();
    _migrateV2toV3(env);
    const day0 = env.trip.destinations[0].days[0];
    assert.strictEqual(day0.kind, 'day');
    assert.strictEqual(day0.startsAt.date, day0.date);
    // endsAt.date is date+1
    const expectEnd = new Date(day0.date + 'T00:00:00Z');
    expectEnd.setUTCDate(expectEnd.getUTCDate() + 1);
    assert.strictEqual(day0.endsAt.date, expectEnd.toISOString().slice(0, 10));
  });

  test('Routes: v2 kind moves to subKind, kind becomes "route"', () => {
    const env = v2EnvelopeReady();
    // Pre-v3: route.kind === "dayTrip" (v2 shape)
    assert.strictEqual(env.trip.routes[0].kind, 'dayTrip');
    _migrateV2toV3(env);
    // Post-v3: route.kind === "route", subKind === "dayTrip"
    assert.strictEqual(env.trip.routes[0].kind, 'route');
    assert.strictEqual(env.trip.routes[0].subKind, 'dayTrip');
  });

  test('Day gets refs[] mirroring planItems[type:"route"]', () => {
    const env = v2EnvelopeReady();
    // Sanity: v2 produced a {type:"route", routeId} PlanItem on day[0].
    const day0 = env.trip.destinations[0].days[0];
    const routeRefPi = day0.planItems.find(pi => pi.type === 'route');
    assert(routeRefPi, 'v2 fixture should have a type:"route" PlanItem');

    _migrateV2toV3(env);
    // After v3 the Reference exists in day.refs[].
    assert(Array.isArray(day0.refs));
    assert.strictEqual(day0.refs.length, 1);
    const ref = day0.refs[0];
    assert.strictEqual(ref.kind, 'reference');
    assert.strictEqual(ref.targetKind, 'route');
    assert.strictEqual(ref.targetId, routeRefPi.routeId);
    // The legacy PlanItem stays in place (Phase 1 of v3 is additive).
    const stillThere = day0.planItems.find(pi => pi.type === 'route');
    assert(stillThere, 'v3 keeps the legacy type:"route" PlanItem alongside the new Reference');
  });

  test('arrival + departure routes are synthesized from brief.entry / tbExit', () => {
    const env = v2EnvelopeReady({
      trip: {
        brief: {
          entry:  'Keflavík Airport',
          tbExit: 'Keflavík Airport'
        }
      }
    });
    _migrateV2toV3(env);
    assert(env.trip.arrival,   'trip.arrival routeId should be set');
    assert(env.trip.departure, 'trip.departure routeId should be set');
    const arrivalRoute = env.trip.routes.find(r => r.id === env.trip.arrival);
    const departureRoute = env.trip.routes.find(r => r.id === env.trip.departure);
    assert(arrivalRoute,   'arrival route should exist in trip.routes');
    assert(departureRoute, 'departure route should exist in trip.routes');
    assert.strictEqual(arrivalRoute.kind,    'route');
    assert.strictEqual(arrivalRoute.subKind, 'arrival');
    assert.strictEqual(departureRoute.kind,    'route');
    assert.strictEqual(departureRoute.subKind, 'departure');
    // Endpoints: arrival has no fromDestId (from outside), departure has no toDestId.
    assert.strictEqual(arrivalRoute.fromDestId, null);
    assert.strictEqual(arrivalRoute.toDestId, env.trip.destinations[0].id);
    assert.strictEqual(departureRoute.fromDestId,
      env.trip.destinations[env.trip.destinations.length - 1].id);
    assert.strictEqual(departureRoute.toDestId, null);
  });

  test('arrival/departure routes are NOT synthesized when brief.entry/tbExit are empty', () => {
    const env = v2EnvelopeReady();
    // Legacy fixture has no brief.entry/tbExit set.
    delete env.trip.brief;
    _migrateV2toV3(env);
    assert.strictEqual(env.trip.arrival,   undefined);
    assert.strictEqual(env.trip.departure, undefined);
  });

  test('idempotent — running v2→v3 twice does not duplicate refs[], routes[], or fields', () => {
    const env = v2EnvelopeReady({
      trip: { brief: { entry: 'Keflavík Airport', tbExit: 'Keflavík Airport' } }
    });
    _migrateV2toV3(env);
    const day0 = env.trip.destinations[0].days[0];
    const routesBefore = env.trip.routes.length;
    const refsBefore = day0.refs.length;

    // Reset version flag and re-run.
    delete env.trip._schemaVersion;
    _migrateV2toV3(env);

    assert.strictEqual(env.trip.routes.length, routesBefore);
    assert.strictEqual(day0.refs.length, refsBefore);
  });

  test('full pipeline v0→v1→v2→v3 produces a coherent v3 envelope', () => {
    const env = legacyEnvelope({
      trip: { brief: { entry: 'Keflavík Airport', tbExit: 'Keflavík Airport' } }
    });
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(env.trip._schemaVersion, 3);
    assert.strictEqual(env.trip.kind, 'trip');
    // The Iceland fixture has dayTrips on the destination + brief entry/exit,
    // so v3 ends with: 1 dayTrip route + 1 arrival + 1 departure = 3 routes.
    assert.strictEqual(env.trip.routes.length, 3);
    const subKinds = env.trip.routes.map(r => r.subKind).sort();
    assert.deepStrictEqual(subKinds, ['arrival', 'dayTrip', 'departure']);
    // All routes have kind:"route" now.
    env.trip.routes.forEach(r => assert.strictEqual(r.kind, 'route'));
    // Day has both refs[] (v3) and planItems[type:"route"] (v2 legacy).
    const day0 = env.trip.destinations[0].days[0];
    assert(day0.refs.length >= 1);
  });
});

describe('needsMigration', () => {
  test('legacy envelope needs migration', () => {
    assert.strictEqual(MaxMigration.needsMigration(legacyEnvelope()), true);
  });

  test('migrated envelope does not need migration', () => {
    const env = legacyEnvelope();
    MaxMigration.migrateTripShape(env);
    assert.strictEqual(MaxMigration.needsMigration(env), false);
  });

  test('null / empty envelopes do not need migration', () => {
    assert.strictEqual(MaxMigration.needsMigration(null), false);
    assert.strictEqual(MaxMigration.needsMigration({}), false);
    assert.strictEqual(MaxMigration.needsMigration({ trip: null }), false);
  });
});

// ── Summary ────────────────────────────────────────────────────

console.log('\n');
if (failed === 0) {
  console.log('✓ ' + passed + ' tests passed');
  process.exit(0);
} else {
  console.log('✗ ' + failed + ' failed (' + passed + ' passed)');
  failures.forEach(f => {
    console.log('\n  ' + f.name);
    console.log('    ' + (f.error.stack || f.error.message));
  });
  process.exit(1);
}
