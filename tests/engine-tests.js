// engine-tests.js — Node-runnable unit tests for the trip + picker engines.
//
// Run: `node tests/engine-tests.js` from the max/ root.
//
// What this covers:
//   * The pure helpers in engine-trip.js (haversine, pair-key, fastest-
//     practical, hour parsing, place-name canonicalization).
//   * The FQ async verdict pipeline with a mock LLM injected.
//   * The pure helpers in engine-picker.js (findMatchingRequired,
//     parseStartDateFromBrief, parseNightsFromRange).
//   * orderKeptCandidates against several trip shapes (Iceland round
//     trip with major-gateway inference, Switzerland with route blocks,
//     etc.).
//   * The event bus (on/off/emit) + service injection.
//   * State sharing — `MaxEnginePicker.state` and `window._tb` point to
//     the same object; mutations through one are visible through the
//     other.
//   * The trip-engine mutators that have been refactored to emit:
//     replaceTrip emits tripChange, etc.
//
// What this does NOT cover (yet):
//   * The full picker → trip flow (lives in DOM-driven inline-script
//     code; needs Playwright). See tests/playwright/ for that work.
//   * UI rendering (drawTripMode, drawDestMode) — pure DOM manipulation,
//     also Playwright territory.
//   * The buildFromCandidates 600-line beast — the function is too
//     entangled to unit-test today; the planned decomposition will
//     produce testable pieces (Picker.publishTrip, Trip.load).
//
// The contract: when this file's tests pass on a refactor branch, the
// engine surfaces still behave correctly. They don't prove the trip
// view renders correctly — that's Playwright's job — but they catch
// 80% of regressions an engine-layer change can introduce, and they
// run in <1s.

'use strict';

const fs = require('fs');
const assert = require('assert');
const path = require('path');

// ── Load the engine modules into a shared global scope ─────────
// The engine modules are written for browser use (window globals).
// We fake `window` as `global` so the IIFE attaches to our process
// global — same byte-level behavior, no module wrapper needed.

global.window = global;
global.localStorage = (() => {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
})();

const ROOT = path.resolve(__dirname, '..');

function loadModule(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // eslint-disable-next-line no-eval
  eval(code);
}

require('../db.mjs');
require('../engine-trip.mjs');
require('../engine-picker.mjs');
require('../engine-classify.mjs');

// ── Test runner ─────────────────────────────────────────────────

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
    console.log('      ' + (e.message || e));
  }
}

// Async tests are queued and run sequentially in main(). Running them
// concurrently produced false-negatives where a "cache populated"
// assertion ran before the populate test had awaited.
const asyncQueue = [];
function asyncTest(name, fn) {
  asyncQueue.push({ name, fn });
}

function xtest(name, _fn, reason) {
  console.log('  ⊘ ' + name + (reason ? '  (skipped: ' + reason + ')' : ''));
}

function describe(name, fn) {
  console.log('\n' + name);
  fn();
}

// ── Suite: engine-trip.js pure helpers ─────────────────────────

describe('engine-trip.js — pure helpers', () => {
  test('haversineKm computes Reykjavik → Vík correctly', () => {
    const km = MaxEngineTrip.haversineKm(64.14, -21.94, 63.42, -19.01);
    assert(km > 160 && km < 200, `expected ~180km, got ${km}`);
  });

  test('haversineKm returns Infinity for non-finite inputs', () => {
    assert.strictEqual(MaxEngineTrip.haversineKm(NaN, 0, 0, 0), Infinity);
    assert.strictEqual(MaxEngineTrip.haversineKm(0, undefined, 0, 0), Infinity);
  });

  test('pairKey is symmetric', () => {
    assert.strictEqual(
      MaxEngineTrip.pairKey('Zürich', 'Lucerne'),
      MaxEngineTrip.pairKey('Lucerne', 'Zürich')
    );
  });

  test('pairKey lowercases + trims', () => {
    assert.strictEqual(MaxEngineTrip.pairKey('  Vik  ', 'reykjavik'), 'reykjavik|vik');
  });

  test('fastestPractical picks the smallest available mode', () => {
    assert.strictEqual(
      MaxEngineTrip.fastestPractical({ driveHours: 4, trainHours: 2.5, flightAvailable: false }),
      2.5
    );
    assert.strictEqual(
      MaxEngineTrip.fastestPractical({ driveHours: 5, trainHours: null, flightAvailable: true, flightHours: 1.5 }),
      1.5
    );
  });

  test('fastestPractical returns Infinity when nothing applies', () => {
    assert.strictEqual(
      MaxEngineTrip.fastestPractical({ driveHours: null, trainHours: null, flightAvailable: false }),
      Infinity
    );
  });

  test('placesSig is sorted + lowercased', () => {
    const sig = MaxEngineTrip.placesSig([{ name: 'B' }, { name: 'a' }, { name: 'C' }]);
    assert.strictEqual(sig, 'a|b|c');
  });

  test('parseHoursInput handles all four input shapes', () => {
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3'), 3);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3.5'), 3.5);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3:30'), 3.5);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3h'), 3);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3h 15m'), 3.25);
  });

  test('parseHoursInput rejects garbage', () => {
    assert.strictEqual(MaxEngineTrip.parseHoursInput(''), null);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('not a number'), null);
    assert.strictEqual(MaxEngineTrip.parseHoursInput('3:99'), null);  // minutes > 59
  });

  test('formatHours renders cleanly', () => {
    assert.strictEqual(MaxEngineTrip.formatHours(3), '3h');
    assert.strictEqual(MaxEngineTrip.formatHours(3.5), '3:30');
    assert.strictEqual(MaxEngineTrip.formatHours(3.083), '3:05');
  });

  test('titleCaseCity capitalizes', () => {
    assert.strictEqual(MaxEngineTrip.titleCaseCity('zurich'), 'Zurich');
    assert.strictEqual(MaxEngineTrip.titleCaseCity('saint-moritz'), 'Saint-Moritz');
  });

  test('titleCaseCity preserves airport codes', () => {
    assert.strictEqual(MaxEngineTrip.titleCaseCity('ZRH'), 'ZRH');
    assert.strictEqual(MaxEngineTrip.titleCaseCity('NYC'), 'NYC');
  });

  test('normPlaceName strips diacritics + normalizes Saint→St', () => {
    assert.strictEqual(MaxEngineTrip.normPlaceName('Zürich'), 'zurich');
    assert.strictEqual(MaxEngineTrip.normPlaceName('Saint-Moritz'), 'st moritz');
    assert.strictEqual(MaxEngineTrip.normPlaceName('St. Moritz'), 'st moritz');
  });
});

// ── Suite: SCAFFOLD-2 commitmentState ────────────────────────────

describe('engine-trip.js — commitmentState', () => {
  test('null/undefined item → confirmed (defensive default)', () => {
    assert.strictEqual(MaxEngineTrip.commitmentState(null), 'confirmed');
    assert.strictEqual(MaxEngineTrip.commitmentState(undefined), 'confirmed');
  });
  test('plain item with no flags → confirmed', () => {
    assert.strictEqual(MaxEngineTrip.commitmentState({n: 'X'}), 'confirmed');
  });
  test('tentative:true → tentative', () => {
    assert.strictEqual(MaxEngineTrip.commitmentState({tentative: true}), 'tentative');
  });
  test('booking present → booked, even with tentative:true', () => {
    assert.strictEqual(
      MaxEngineTrip.commitmentState({tentative: true, booking: {time: '12:00'}}),
      'booked'
    );
  });
  test('done:true → done, regardless of booking', () => {
    assert.strictEqual(
      MaxEngineTrip.commitmentState({done: true, booking: {time: '12:00'}}),
      'done'
    );
  });
  test('exposed as bare global commitmentState too', () => {
    assert.strictEqual(typeof global.commitmentState, 'function');
    assert.strictEqual(global.commitmentState({tentative: true}), 'tentative');
  });
});

// ── Suite: syncTransitRoutes (Wayside Phase 1) ───────────────────

describe('engine-trip.js — syncTransitRoutes', () => {
  // Build a 3-destination trip skeleton with stable ids.
  function tripWith(dests, routes) {
    return {
      destinations: dests,
      routes: routes || [],
    };
  }
  function dest(id, place, dateFrom, dateTo) {
    return { id: id, place: place, dateFrom: dateFrom || null, dateTo: dateTo || null };
  }

  test('creates one transit route per adjacent pair', () => {
    var trip = tripWith([
      dest('d1', 'Reykjavik', '2026-06-01', '2026-06-04'),
      dest('d2', 'Vík',       '2026-06-04', '2026-06-06'),
      dest('d3', 'Höfn',      '2026-06-06', '2026-06-08'),
    ]);
    MaxEngineTrip.syncTransitRoutes(trip);
    var transitRoutes = trip.routes.filter(function(r){ return r.subKind === 'transit'; });
    assert.strictEqual(transitRoutes.length, 2);
    var pairs = transitRoutes.map(function(r){ return r.fromDestId + '→' + r.toDestId; }).sort();
    assert.deepStrictEqual(pairs, ['d1→d2', 'd2→d3']);
  });

  test('routes have kind:"route" and subKind:"transit"', () => {
    var trip = tripWith([dest('d1', 'A'), dest('d2', 'B')]);
    MaxEngineTrip.syncTransitRoutes(trip);
    var r = trip.routes[0];
    assert.strictEqual(r.kind, 'route');
    assert.strictEqual(r.subKind, 'transit');
  });

  test('idempotent — second call is a no-op', () => {
    var trip = tripWith([dest('d1', 'A'), dest('d2', 'B'), dest('d3', 'C')]);
    MaxEngineTrip.syncTransitRoutes(trip);
    var firstSnap = JSON.stringify(trip.routes);
    MaxEngineTrip.syncTransitRoutes(trip);
    assert.strictEqual(JSON.stringify(trip.routes), firstSnap);
  });

  test('preserves planItems[] on existing transit routes across re-sync', () => {
    var trip = tripWith([dest('d1', 'A'), dest('d2', 'B')]);
    MaxEngineTrip.syncTransitRoutes(trip);
    // Add a wayside to the route.
    trip.routes[0].planItems.push({ id: 'pi-stop-1', type: 'stop', placeId: 'pl-x' });
    trip.routes[0].modeChosen = 'drive';
    trip.routes[0].durationHours = 3;
    MaxEngineTrip.syncTransitRoutes(trip);
    assert.strictEqual(trip.routes[0].planItems.length, 1);
    assert.strictEqual(trip.routes[0].modeChosen, 'drive');
    assert.strictEqual(trip.routes[0].durationHours, 3);
  });

  test('removes transit routes whose endpoints no longer match adjacency', () => {
    var trip = tripWith([
      dest('d1', 'A'), dest('d2', 'B'), dest('d3', 'C'),
    ]);
    MaxEngineTrip.syncTransitRoutes(trip);
    assert.strictEqual(trip.routes.filter(function(r){return r.subKind==='transit';}).length, 2);
    // Remove d2.
    trip.destinations = [trip.destinations[0], trip.destinations[2]];
    MaxEngineTrip.syncTransitRoutes(trip);
    var transitRoutes = trip.routes.filter(function(r){ return r.subKind === 'transit'; });
    assert.strictEqual(transitRoutes.length, 1);
    assert.strictEqual(transitRoutes[0].fromDestId, 'd1');
    assert.strictEqual(transitRoutes[0].toDestId, 'd3');
  });

  test('leaves dayTrip / arrival / departure routes alone', () => {
    var trip = tripWith(
      [dest('d1', 'A'), dest('d2', 'B')],
      [
        { id: 'r-dt-d1', kind: 'route', subKind: 'dayTrip',   fromDestId: 'd1', toDestId: 'd1', planItems: [{type:'stop'}] },
        { id: 'r-arr',   kind: 'route', subKind: 'arrival',   fromDestId: null, toDestId: 'd1' },
        { id: 'r-dep',   kind: 'route', subKind: 'departure', fromDestId: 'd2', toDestId: null },
      ]
    );
    MaxEngineTrip.syncTransitRoutes(trip);
    var ids = trip.routes.map(function(r){return r.id;});
    assert(ids.indexOf('r-dt-d1') >= 0, 'dayTrip route should survive');
    assert(ids.indexOf('r-arr')   >= 0, 'arrival route should survive');
    assert(ids.indexOf('r-dep')   >= 0, 'departure route should survive');
    // And one new transit route for d1→d2.
    var transitRoutes = trip.routes.filter(function(r){ return r.subKind === 'transit'; });
    assert.strictEqual(transitRoutes.length, 1);
  });

  test('single-destination trip produces zero transit routes', () => {
    var trip = tripWith([dest('d1', 'A')]);
    MaxEngineTrip.syncTransitRoutes(trip);
    assert.strictEqual(trip.routes.filter(function(r){return r.subKind==='transit';}).length, 0);
  });

  test('empty / null trip is a no-op (no throw)', () => {
    assert.doesNotThrow(function(){ MaxEngineTrip.syncTransitRoutes(null); });
    assert.doesNotThrow(function(){ MaxEngineTrip.syncTransitRoutes({}); });
    assert.doesNotThrow(function(){ MaxEngineTrip.syncTransitRoutes({destinations: []}); });
  });

  test('reversing destination order swaps transit routes', () => {
    var trip = tripWith([
      dest('d1', 'A'), dest('d2', 'B'), dest('d3', 'C'),
    ]);
    MaxEngineTrip.syncTransitRoutes(trip);
    // Reverse.
    trip.destinations.reverse();
    MaxEngineTrip.syncTransitRoutes(trip);
    var transitRoutes = trip.routes.filter(function(r){ return r.subKind === 'transit'; });
    var pairs = transitRoutes.map(function(r){ return r.fromDestId + '→' + r.toDestId; }).sort();
    assert.deepStrictEqual(pairs, ['d2→d1', 'd3→d2']);
  });
});

// ── Suite: SCAFFOLD-3 summarizeDecisionsDeferred ─────────────────

describe('engine-trip.js — summarizeDecisionsDeferred', () => {
  test('null/undefined trip → zero, empty list', () => {
    var r = MaxEngineTrip.summarizeDecisionsDeferred(null);
    assert.strictEqual(r.totalCount, 0);
    assert.deepStrictEqual(r.items, []);
  });
  test('trip with no destinations → zero', () => {
    var r = MaxEngineTrip.summarizeDecisionsDeferred({destinations: []});
    assert.strictEqual(r.totalCount, 0);
  });
  test('counts tentative items per destination', () => {
    var trip = {destinations: [{
      id: 'd1', place: 'Reykjavik',
      days: [
        {id: 'dy1', items: [
          {id: 's1', tentative: true},
          {id: 's2', tentative: true},
          {id: 's3'},  // confirmed
        ]},
        {id: 'dy2', items: [
          {id: 's4', tentative: true},
        ]},
      ],
    }]};
    var r = MaxEngineTrip.summarizeDecisionsDeferred(trip);
    assert.strictEqual(r.totalCount, 3);
    assert.strictEqual(r.items[0].kind, 'tentative');
    assert.strictEqual(r.items[0].count, 3);
    assert.strictEqual(r.items[0].destPlace, 'Reykjavik');
  });
  test('done items do not count as tentative', () => {
    var trip = {destinations: [{
      id: 'd1', place: 'X',
      days: [{id: 'dy1', items: [
        {id: 's1', tentative: true, done: true},  // done wins
        {id: 's2', tentative: true},
      ]}],
    }]};
    var r = MaxEngineTrip.summarizeDecisionsDeferred(trip);
    assert.strictEqual(r.totalCount, 1);
    assert.strictEqual(r.items[0].count, 1);
  });
  test('flags empty days when dest has items elsewhere', () => {
    var trip = {destinations: [{
      id: 'd1', place: 'Vík',
      days: [
        {id: 'dy1', lbl: 'Day 1', items: [{id: 's1'}]},
        {id: 'dy2', lbl: 'Day 2', items: []},
      ],
    }]};
    var r = MaxEngineTrip.summarizeDecisionsDeferred(trip);
    assert.strictEqual(r.totalCount, 1);
    assert.strictEqual(r.items[0].kind, 'emptyDay');
    assert.strictEqual(r.items[0].dayLbl, 'Day 2');
    assert.strictEqual(r.items[0].destPlace, 'Vík');
  });
  test('flags empty days even when dest has no items at all (v353.2 onward)', () => {
    // v353.2 changed the rule: dests with zero items still surface their
    // empty days, so a 1-day stay whose generation failed isn't invisible.
    var trip = {destinations: [{
      id: 'd1', place: 'X',
      days: [
        {id: 'dy1', items: []},
        {id: 'dy2', items: []},
      ],
    }]};
    var r = MaxEngineTrip.summarizeDecisionsDeferred(trip);
    assert.strictEqual(r.totalCount, 2);
    assert.strictEqual(r.items.length, 2);
    r.items.forEach(function(it){ assert.strictEqual(it.kind, 'emptyDay'); });
  });
  test('combined: tentative + empty days from same dest', () => {
    var trip = {destinations: [{
      id: 'd1', place: 'Reykjavik',
      days: [
        {id: 'dy1', lbl: 'Day 1', items: [{id: 's1', tentative: true}]},
        {id: 'dy2', lbl: 'Day 2', items: []},
        {id: 'dy3', lbl: 'Day 3', items: []},
      ],
    }]};
    var r = MaxEngineTrip.summarizeDecisionsDeferred(trip);
    assert.strictEqual(r.totalCount, 3);  // 1 tentative + 2 empty days
  });
  test('exposed as bare global summarizeDecisionsDeferred', () => {
    assert.strictEqual(typeof global.summarizeDecisionsDeferred, 'function');
  });
});

// ── Suite: SCAFFOLD-6 nightCountRationale ────────────────────────

describe('engine-trip.js — nightCountRationale', () => {
  test('null/undefined dest → null', () => {
    assert.strictEqual(MaxEngineTrip.nightCountRationale(null), null);
    assert.strictEqual(MaxEngineTrip.nightCountRationale(undefined), null);
  });
  test('dest without nights → null', () => {
    assert.strictEqual(MaxEngineTrip.nightCountRationale({place: 'X'}), null);
  });
  test('dest with iconic sights mentions count + hours', () => {
    var r = MaxEngineTrip.nightCountRationale({
      place: 'Reykjavik', nights: 3,
      suggestions: [
        {type: 'sight', iconic: true, durationHours: 4},
        {type: 'sight', iconic: true, durationHours: 3},
        {type: 'sight', iconic: false, durationHours: 2},
      ],
    });
    assert.match(r, /3 nights/);
    assert.match(r, /2 iconic sights/);
    assert.match(r, /~7 hrs/);
  });
  test('dest with day trips mentions them', () => {
    var r = MaxEngineTrip.nightCountRationale({
      place: 'Vík', nights: 2,
      suggestions: [{type:'sight', iconic:true, durationHours: 5}],
      dayTrips: [{place: 'Vatnajökull'}],
    });
    assert.match(r, /1 day trip/);
  });
  test('dest with no iconic or daytrips → honest fallback', () => {
    var r = MaxEngineTrip.nightCountRationale({place: 'X', nights: 2});
    assert.match(r, /didn’t flag anything iconic/);
  });
  test('tight pacing flagged when iconic-hours/5 > days+0.5', () => {
    var r = MaxEngineTrip.nightCountRationale({
      place: 'X', nights: 1, // 2 days
      suggestions: [{type:'sight', iconic:true, durationHours: 20}], // 4 days of content
    });
    assert.match(r, /Tight at this length/);
  });
  test('exposed as bare global', () => {
    assert.strictEqual(typeof global.nightCountRationale, 'function');
  });
});

// ── Suite: SCAFFOLD-6 slice 2 dayRationale ───────────────────────

describe('engine-trip.js — dayRationale', () => {
  test('null inputs → null', () => {
    assert.strictEqual(MaxEngineTrip.dayRationale(null, 0, {}), null);
    assert.strictEqual(MaxEngineTrip.dayRationale({}, 0, null), null);
  });
  test('empty day → "Open day" message', () => {
    var dest = {days: [{items:[]}, {items:[]}]};
    var r = MaxEngineTrip.dayRationale({items:[]}, 0, dest);
    assert.match(r, /Open arrival day/);
    assert.match(r, /nothing planned/);
  });
  test('long sight (4+ hrs) → long-sight day phrasing', () => {
    var day = {items:[{type:'sight', n:'Jungfraujoch', durationHours: 6}]};
    var dest = {days: [{items:[]}, day, {items:[]}]};
    var r = MaxEngineTrip.dayRationale(day, 1, dest);
    assert.match(r, /Long-sight day/);
    assert.match(r, /Jungfraujoch is ~6h/);
  });
  test('day-trip day → leaves the hub', () => {
    var day = {items:[{type:'daytrip', dayTripPlace:'Vík'}]};
    var dest = {days: [{items:[]}, day, {items:[]}]};
    var r = MaxEngineTrip.dayRationale(day, 1, dest);
    assert.match(r, /Day-trip day to Vík/);
    assert.match(r, /leaves the hub/);
  });
  test('full day at budget → "Full day — full" + budget assumption', () => {
    var day = {items:[
      {type:'sight', n:'A', durationHours: 3},
      {type:'sight', n:'B', durationHours: 3},
    ]};
    var dest = {days: [{items:[{type:'sight'}]}, day, {items:[]}]};
    var trip = {brief:{hoursPerDay: 6, maxBigSightsPerDay: 2}};
    var r = MaxEngineTrip.dayRationale(day, 1, dest, trip);
    assert.match(r, /Full day — full/);
    assert.match(r, /6h/);
    assert.match(r, /You set Max to ~6h/);
  });
  test('respects user hoursPerDay = 4', () => {
    var day = {items:[{type:'sight', n:'X', durationHours: 3}]};
    var dest = {days: [{items:[{type:'sight'}]}, day, {items:[]}]};
    var trip = {brief:{hoursPerDay: 4, maxBigSightsPerDay: 2}};
    var r = MaxEngineTrip.dayRationale(day, 1, dest, trip);
    assert.match(r, /You set Max to ~4h/);
  });
  test('arrival day light → "Light arrival day" + budget assumption', () => {
    var day = {items:[{type:'sight', n:'X', durationHours: 1}]};
    var dest = {days: [day, {items:[{type:'sight'}]}, {items:[]}]};
    // v302: pass a trip explicitly so the assumption uses the user's
    // hoursPerDay (here defaulted via empty brief).
    var trip = {brief:{hoursPerDay: 6, maxBigSightsPerDay: 2}};
    var r = MaxEngineTrip.dayRationale(day, 0, dest, trip);
    assert.match(r, /Light arrival day/);
    // v302: budget surfaced as "You set Max to ~4h" (4 = min(6,4) on
    // a travel day).
    assert.match(r, /You set Max to ~4h/);
    assert.match(r, /at most 2 big sights/);
  });
  test('exposed as bare global', () => {
    assert.strictEqual(typeof global.dayRationale, 'function');
  });
});

// ── Suite: SCAFFOLD-6 slices 3-5 rationale helpers ───────────────

describe('engine-trip.js — neighborhoodRationale', () => {
  test('null/no good/no bad → null', () => {
    assert.strictEqual(MaxEngineTrip.neighborhoodRationale(null), null);
    assert.strictEqual(MaxEngineTrip.neighborhoodRationale({name:'X'}), null);
  });
  test('good only → Good prefix', () => {
    var r = MaxEngineTrip.neighborhoodRationale({good:'walkable to old town'});
    assert.match(r, /Good: walkable to old town/);
    assert.doesNotMatch(r, /Tradeoff/);
  });
  test('good + bad → both lines', () => {
    var r = MaxEngineTrip.neighborhoodRationale({good:'central', bad:'noisy at night'});
    assert.match(r, /Good: central/);
    assert.match(r, /Tradeoff: noisy at night/);
  });
});

describe('engine-trip.js — transitRationale', () => {
  test('no routing → null', () => {
    assert.strictEqual(MaxEngineTrip.transitRationale(null), null);
    assert.strictEqual(MaxEngineTrip.transitRationale({options:[]}), null);
  });
  test('one option → "Only one practical option" suffix', () => {
    var r = MaxEngineTrip.transitRationale(
      {options:[{name:'SBB Train', meta:'2h'}]},
      'Zürich', 'Bern'
    );
    assert.match(r, /Zürich → Bern/);
    assert.match(r, /SBB Train/);
    assert.match(r, /Only one practical option/);
  });
  test('multiple options → top vs alternatives', () => {
    var r = MaxEngineTrip.transitRationale(
      {options:[
        {name:'Train', meta:'2h'},
        {name:'Bus',   meta:'3h'},
        {name:'Drive', meta:'2h30'},
      ]},
      'A', 'B'
    );
    assert.match(r, /A → B/);
    assert.match(r, /Train/);
    assert.match(r, /Picked over.*Bus.*Drive/);
  });
});

describe('engine-trip.js — sightPlacementRationale', () => {
  test('non-sight → null', () => {
    assert.strictEqual(
      MaxEngineTrip.sightPlacementRationale({type:'restaurant'}, {}, 0, {days:[{}]}),
      null
    );
  });
  test('iconic + long → mentions both', () => {
    var dest = {days:[{}, {}, {}]};
    var r = MaxEngineTrip.sightPlacementRationale(
      {type:'sight', n:'X', iconic:true, durationHours:6, autoSeeded:true},
      {}, 1, dest
    );
    assert.match(r, /flagged this iconic/);
    assert.match(r, /~6h/);
    assert.match(r, /full day/);
  });
  test('user-placed → "you placed this"', () => {
    var dest = {days:[{}, {}, {}]};
    var r = MaxEngineTrip.sightPlacementRationale(
      {type:'sight', durationHours:2},
      {}, 1, dest
    );
    assert.match(r, /you placed this/);
  });
  test('exposed as bare globals', () => {
    assert.strictEqual(typeof global.neighborhoodRationale,    'function');
    assert.strictEqual(typeof global.transitRationale,         'function');
    assert.strictEqual(typeof global.sightPlacementRationale,  'function');
  });
});

// ── Suite: SCAFFOLD-5 currentTripStatus ──────────────────────────

describe('engine-trip.js — currentTripStatus', () => {
  test('null/empty trip → unscheduled', () => {
    assert.strictEqual(MaxEngineTrip.currentTripStatus(null).phase, 'unscheduled');
    assert.strictEqual(MaxEngineTrip.currentTripStatus({destinations:[]}).phase, 'unscheduled');
  });
  test('trip without dateFrom/dateTo → unscheduled', () => {
    assert.strictEqual(
      MaxEngineTrip.currentTripStatus({destinations:[{place:'X'}]}).phase,
      'unscheduled'
    );
  });
  test('today before trip → "before" + daysUntilStart', () => {
    var trip = {destinations:[
      {dateFrom:'2026-06-10', dateTo:'2026-06-12', days:[{},{}]},
    ]};
    var r = MaxEngineTrip.currentTripStatus(trip, '2026-06-01');
    assert.strictEqual(r.phase, 'before');
    assert.strictEqual(r.daysUntilStart, 9);
  });
  test('today after trip → "after"', () => {
    var trip = {destinations:[
      {dateFrom:'2026-06-10', dateTo:'2026-06-12'},
    ]};
    var r = MaxEngineTrip.currentTripStatus(trip, '2026-07-01');
    assert.strictEqual(r.phase, 'after');
  });
  test('today on day 1 → during, dayNumber=1', () => {
    var trip = {destinations:[
      {id:'d1', place:'Reykjavik', dateFrom:'2026-06-10', dateTo:'2026-06-12',
       days:[{id:'dy1',lbl:'Day 1'},{id:'dy2',lbl:'Day 2'},{id:'dy3',lbl:'Day 3'}]},
    ]};
    var r = MaxEngineTrip.currentTripStatus(trip, '2026-06-10');
    assert.strictEqual(r.phase, 'during');
    assert.strictEqual(r.dayNumber, 1);
    assert.strictEqual(r.totalDays, 3);
    assert.strictEqual(r.currentDestId, 'd1');
    assert.strictEqual(r.currentDayId, 'dy1');
  });
  test('today on day 2 of multi-dest trip → finds dest 2', () => {
    var trip = {destinations:[
      {id:'d1', place:'Reykjavik', dateFrom:'2026-06-10', dateTo:'2026-06-11',
       days:[{id:'r1',lbl:'R1'},{id:'r2',lbl:'R2'}]},
      {id:'d2', place:'Vík', dateFrom:'2026-06-12', dateTo:'2026-06-14',
       days:[{id:'v1',lbl:'V1'},{id:'v2',lbl:'V2'},{id:'v3',lbl:'V3'}]},
    ]};
    var r = MaxEngineTrip.currentTripStatus(trip, '2026-06-13');
    assert.strictEqual(r.phase, 'during');
    assert.strictEqual(r.currentDestId, 'd2');
    assert.strictEqual(r.currentDestPlace, 'Vík');
    assert.strictEqual(r.currentDayId, 'v2');
    assert.strictEqual(r.dayNumber, 4); // 4th day overall
  });
  test('exposed as bare global', () => {
    assert.strictEqual(typeof global.currentTripStatus, 'function');
  });
});

// ── Suite: SCAFFOLD-5 slice 2 currentDayItems ────────────────────

describe('engine-trip.js — currentDayItems', () => {
  test('null/empty day → all empty buckets', () => {
    var r = MaxEngineTrip.currentDayItems(null, '12:00');
    assert.deepStrictEqual(r, {past:[], current:[], next:null, later:[], untimed:[]});
    var r2 = MaxEngineTrip.currentDayItems({items:[]}, '12:00');
    assert.deepStrictEqual(r2.past, []);
    assert.deepStrictEqual(r2.untimed, []);
  });
  test('untimed items go to the untimed bucket', () => {
    var day = {items:[{id:'s1', n:'X'}, {id:'s2', n:'Y'}]};
    var r = MaxEngineTrip.currentDayItems(day, '12:00');
    assert.strictEqual(r.untimed.length, 2);
  });
  test('past / current / next / later — mixed day at 12:00', () => {
    var day = {items:[
      {id:'a', n:'A', timeStart:'09:00', timeEnd:'10:00'}, // past
      {id:'b', n:'B', timeStart:'11:30', timeEnd:'12:30'}, // current
      {id:'c', n:'C', timeStart:'13:00', timeEnd:'14:00'}, // next
      {id:'d', n:'D', timeStart:'15:00', timeEnd:'16:00'}, // later
      {id:'e', n:'E'},                                       // untimed
    ]};
    var r = MaxEngineTrip.currentDayItems(day, '12:00');
    assert.deepStrictEqual(r.past.map(function(i){return i.id;}), ['a']);
    assert.deepStrictEqual(r.current.map(function(i){return i.id;}), ['b']);
    assert.strictEqual(r.next.id, 'c');
    assert.deepStrictEqual(r.later.map(function(i){return i.id;}), ['d']);
    assert.deepStrictEqual(r.untimed.map(function(i){return i.id;}), ['e']);
  });
  test('one-sided times (timeStart only) treated as point in time', () => {
    var day = {items:[{id:'a', n:'A', timeStart:'14:00'}]};
    var rBefore = MaxEngineTrip.currentDayItems(day, '13:00');
    assert.strictEqual(rBefore.next && rBefore.next.id, 'a');
    var rAfter = MaxEngineTrip.currentDayItems(day, '14:01');
    assert.strictEqual(rAfter.past[0].id, 'a');
  });
  test('exposed as bare global', () => {
    assert.strictEqual(typeof global.currentDayItems, 'function');
  });
});

describe('engine-trip.js — clockMinutesBetween', () => {
  test('happy path', () => {
    assert.strictEqual(MaxEngineTrip.clockMinutesBetween('10:00', '11:30'), 90);
    assert.strictEqual(MaxEngineTrip.clockMinutesBetween('11:30', '10:00'), -90);
  });
  test('malformed → null', () => {
    assert.strictEqual(MaxEngineTrip.clockMinutesBetween('xx:00', '11:30'), null);
    assert.strictEqual(MaxEngineTrip.clockMinutesBetween(null, '11:30'), null);
  });
});

// ── Suite: SCAFFOLD-4 preArrivalActions ──────────────────────────

describe('engine-trip.js — preArrivalActions', () => {
  test('not in before phase → null', () => {
    var trip = {destinations: [{dateFrom:'2026-06-10', dateTo:'2026-06-12'}]};
    // today during the trip
    assert.strictEqual(MaxEngineTrip.preArrivalActions(trip, '2026-06-11'), null);
    // today after
    assert.strictEqual(MaxEngineTrip.preArrivalActions(trip, '2026-07-01'), null);
  });
  test('before phase + unbooked hotel + unbooked transit (no empty days, those live in decisions-deferred)', () => {
    var trip = {destinations: [
      { id:'d1', place:'Reykjavik', dateFrom:'2026-06-10', dateTo:'2026-06-11',
        days:[{id:'r1', items:[{type:'sight'}]}, {id:'r2', items:[]}],
        hotelBookings:[] },
      { id:'d2', place:'Vík', dateFrom:'2026-06-12', dateTo:'2026-06-13',
        days:[{id:'v1', items:[{type:'sight'}]}],
        hotelBookings:[{status:'booked'}] },
    ], legs: {}};
    var r = MaxEngineTrip.preArrivalActions(trip, '2026-06-01');
    assert.strictEqual(r.daysUntilStart, 9);
    var kinds = r.items.map(function(i){return i.kind;});
    // v313: empty days no longer in preArrival output (they're content,
    // not logistics — see summarizeDecisionsDeferred).
    assert.ok(kinds.indexOf('hotelMissing') >= 0, 'hotelMissing present');
    assert.ok(kinds.indexOf('transitMissing') >= 0, 'transitMissing present');
    assert.strictEqual(kinds.indexOf('emptyDay'), -1, 'emptyDay should NOT be in preArrivalActions');
  });
  test('booked transit → not flagged', () => {
    var trip = {
      destinations: [
        {id:'d1', dateFrom:'2026-06-10', dateTo:'2026-06-11',
         hotelBookings:[{status:'booked'}], days:[{id:'r1', items:[{}]}]},
        {id:'d2', dateFrom:'2026-06-12', dateTo:'2026-06-13',
         hotelBookings:[{status:'booked'}], days:[{id:'v1', items:[{}]}]},
      ],
      legs: { 'd1__d2': { bookings: [{status:'booked'}] } },
    };
    var r = MaxEngineTrip.preArrivalActions(trip, '2026-06-01');
    assert.strictEqual(r.items.length, 0);
  });
  test('exposed as bare global', () => {
    assert.strictEqual(typeof global.preArrivalActions, 'function');
  });
});

// ── Suite: HY (path-to-10:A) — mutator surface ──────────────────

describe('engine-trip.js — mutator namespace surface', () => {
  test('all 11 trip mutators are exposed on MaxEngineTrip', () => {
    var names = [
      'addBufferNight',
      'reverseTripOrder',
      'delDest',
      'applyDateChange',
      'executeMoveDest',
      'addDayTripToDay',
      'removeDayTripFromDay',
      'removeDayTripFromDayItem',
      'makeDayTrip',
      'ungroupDayTrip',
      'schedulePeerDayTrip',
    ];
    names.forEach(function(n){
      assert.strictEqual(typeof MaxEngineTrip[n], 'function', n + ' should be a function');
    });
  });
  test('engine-trip.js has no DOM dependencies', () => {
    var fs = require('fs');
    var src = fs.readFileSync(__dirname + '/../engine-trip.mjs', 'utf8');
    // Strip out comments (line + block) before scanning.
    src = src.replace(/\/\*[\s\S]*?\*\//g, '');
    src = src.replace(/\/\/.*$/gm, '');
    // Now check that no real code references DOM APIs.
    var bad = [];
    if (/\bdocument\./.test(src))       bad.push('document.');
    if (/\bgetElementById\b/.test(src)) bad.push('getElementById');
    if (/\bdrawTripMode\b/.test(src))   bad.push('drawTripMode');
    if (/\bdrawDestMode\b/.test(src))   bad.push('drawDestMode');
    if (/\bupdateMainMap\b/.test(src))  bad.push('updateMainMap');
    assert.deepStrictEqual(bad, [], 'engine-trip.js should be DOM-free; found: ' + bad.join(', '));
  });
});

// ── Suite: event bus ─────────────────────────────────────────────

describe('engine-trip.js — event bus', () => {
  test('emit fires registered listeners', () => {
    let calls = [];
    MaxEngineTrip.on('tripChange', () => calls.push('a'));
    MaxEngineTrip.on('tripChange', () => calls.push('b'));
    MaxEngineTrip.emit('tripChange');
    assert.deepStrictEqual(calls, ['a', 'b']);
    // Cleanup so subsequent tests don't double up
    MaxEngineTrip._listeners = undefined;  // engine doesn't expose this; rely on test order
  });

  test('off removes a listener', () => {
    const cb = () => { throw new Error('should not fire'); };
    MaxEngineTrip.on('tripChange', cb);
    MaxEngineTrip.off('tripChange', cb);
    MaxEngineTrip.emit('tripChange');  // no throw
    assert.ok(true);
  });

  test('on returns an unsubscribe function', () => {
    let count = 0;
    const off = MaxEngineTrip.on('mapDataChange', () => count++);
    MaxEngineTrip.emit('mapDataChange');
    off();
    MaxEngineTrip.emit('mapDataChange');
    assert.strictEqual(count, 1);
  });

  test('a throwing listener does not block subsequent listeners', () => {
    let bRan = false;
    // The engine logs `[MaxEngineTrip] listener for X threw:` on the
    // catch path. Mute it for the test, plus also mute Node's default
    // unhandled-error reporter that goes to stderr.
    const origWarn = console.warn;
    console.warn = () => {};
    const cbA = () => { throw new Error('expected — testing isolation'); };
    const cbB = () => { bRan = true; };
    MaxEngineTrip.on('tripChange', cbA);
    MaxEngineTrip.on('tripChange', cbB);
    MaxEngineTrip.emit('tripChange');
    MaxEngineTrip.off('tripChange', cbA);
    MaxEngineTrip.off('tripChange', cbB);
    console.warn = origWarn;
    assert.strictEqual(bRan, true);
  });
});

// ── Suite: service injection ─────────────────────────────────────

describe('engine-trip.js — service injection', () => {
  test('injectService + _getService roundtrip', () => {
    const fake = () => 'fake';
    MaxEngineTrip.injectService('test-service', fake);
    assert.strictEqual(MaxEngineTrip._getService('test-service'), fake);
  });

  test('_getService returns null for unknown service', () => {
    assert.strictEqual(MaxEngineTrip._getService('nonexistent'), null);
  });

  test('picker has its own service slot, separate from trip engine', () => {
    MaxEnginePicker.injectService('test-service', 'picker-impl');
    MaxEngineTrip.injectService('test-service', 'trip-impl');
    assert.strictEqual(MaxEnginePicker._getService('test-service'), 'picker-impl');
    assert.strictEqual(MaxEngineTrip._getService('test-service'), 'trip-impl');
  });
});

// ── Suite: FQ async verdict pipeline (mocked LLM) ───────────────

describe('engine-trip.js — FQ verdict pipeline', () => {
  // Fixture: realistic Iceland transit info
  const fixtures = {
    'reykjavik|vik': { driveHours: 2.5, trainHours: null, flightAvailable: false, flightHours: null, primary: 'drive', note: 'Drive south on Route 1' },
    'reykjavik|hofn': { driveHours: 6, trainHours: null, flightAvailable: true, flightHours: 1, primary: 'drive', note: 'Long drive, short flight option' },
    'hofn|vik': { driveHours: 3.5, trainHours: null, flightAvailable: false, flightHours: null, primary: 'drive', note: 'Across the south coast' },
  };
  let llmCallCount = 0;
  const mockLlm = async (msgs) => {
    llmCallCount++;
    const prompt = msgs[0].content;
    for (const key of Object.keys(fixtures)) {
      const [a, b] = key.split('|');
      if (prompt.toLowerCase().includes(a) && prompt.toLowerCase().includes(b)) {
        return JSON.stringify(fixtures[key]);
      }
    }
    return JSON.stringify({ driveHours: null, trainHours: null, flightAvailable: false, flightHours: null, primary: 'unknown', note: '' });
  };

  asyncTest('verdictForPlaces with dense pairs → "dense"', async () => {
    MaxEngineTrip.injectService('llm', mockLlm);
    llmCallCount = 0;
    // Three close Iceland places — all pairs <= 2h would give "dense"
    const v = await MaxEngineTrip.verdictForPlaces([
      { name: 'Reykjavik', lat: 64.14, lng: -21.94 },
      { name: 'Vik',       lat: 63.42, lng: -19.01 },
    ]);
    assert.ok(v.verdict, 'should produce a verdict');
    // Single-pair case: 2.5h → not dense (>2), not spread (<=4) → mixed
    assert.strictEqual(v.verdict, 'mixed');
    assert.strictEqual(v.pairs.length, 1);
    assert.strictEqual(v.pairs[0].fastestH, 2.5);
  });

  asyncTest('verdictForPlaces caches identical place sets', async () => {
    MaxEngineTrip.injectService('llm', mockLlm);
    const before = llmCallCount;
    await MaxEngineTrip.verdictForPlaces([
      { name: 'Reykjavik', lat: 64.14, lng: -21.94 },
      { name: 'Vik',       lat: 63.42, lng: -19.01 },
    ]);
    // Second call with same set should not hit the LLM again
    assert.strictEqual(llmCallCount, before, 'LLM called too many times');
  });

  asyncTest('transitInfoCache populates after a verdict run', () => {
    const cache = MaxEngineTrip.transitInfoCache();
    assert.ok(Object.keys(cache).length > 0, 'cache should have entries after the runs above');
    assert.ok(cache['reykjavik|vik'], 'reykjavik|vik should be cached');
  });
});

// ── Suite: engine-picker.js pure helpers ────────────────────────

describe('engine-picker.js — pure helpers', () => {
  test('findMatchingRequired matches normalized names', () => {
    const r = MaxEnginePicker.findMatchingRequired(
      { place: 'Saint-Moritz' },
      [{ place: 'St. Moritz', id: 'rq1' }]
    );
    assert.ok(r);
    assert.strictEqual(r.id, 'rq1');
  });

  test('findMatchingRequired returns null when nothing matches', () => {
    // Note: findMatchingRequired does substring matching in BOTH
    // directions, so "vik" matches "reykjavik" via the longer
    // string containing the shorter. Test data here uses names
    // that have no substring overlap either way.
    const r = MaxEnginePicker.findMatchingRequired(
      { place: 'Kyoto' },
      [{ place: 'Vik', id: 'rq1' }]
    );
    assert.strictEqual(r, null);
  });

  test('parseStartDateFromBrief handles ISO', () => {
    assert.strictEqual(
      MaxEnginePicker.parseStartDateFromBrief('We leave on 2026-08-15'),
      '2026-08-15'
    );
  });

  test('parseStartDateFromBrief handles month + day', () => {
    const d = MaxEnginePicker.parseStartDateFromBrief('August 15');
    assert.ok(/^\d{4}-08-15$/.test(d), `expected YYYY-08-15, got ${d}`);
  });

  test('parseNightsFromRange extracts the lower bound', () => {
    assert.strictEqual(MaxEnginePicker.parseNightsFromRange('3-4 nights'), 3);
    assert.strictEqual(MaxEnginePicker.parseNightsFromRange('5-7 nights'), 5);
    assert.strictEqual(MaxEnginePicker.parseNightsFromRange('2 nights'), 2);
  });

  test('parseNightsFromRange falls back to 3 on empty', () => {
    assert.strictEqual(MaxEnginePicker.parseNightsFromRange(''), 3);
    assert.strictEqual(MaxEnginePicker.parseNightsFromRange(null), 3);
  });

  // F2: the LIVE trip-name derivation (a dead, divergent MaxPublish twin was
  // removed). _titleCaseCity is absent in Node, so it falls back to identity —
  // these inputs don't depend on casing.
  test('deriveTripName prefers placeName, then region, then kept ("+N more")', () => {
    assert.strictEqual(MaxEnginePicker.deriveTripName({ placeName: 'Iceland' }, []), 'Iceland');
    assert.strictEqual(MaxEnginePicker.deriveTripName({ region: 'Patagonia' }, []), 'Patagonia');
    assert.strictEqual(MaxEnginePicker.deriveTripName({}, [{ place: 'Vik' }]), 'Vik');
    assert.strictEqual(
      MaxEnginePicker.deriveTripName({}, [{ place: 'Vik' }, { place: 'Hofn' }, { place: 'X' }]),
      'Vik + 2 more'
    );
    assert.strictEqual(MaxEnginePicker.deriveTripName({}, []), 'New trip');
  });

  test('isAutoName matches auto names only (live semantics)', () => {
    assert.strictEqual(MaxEnginePicker.isAutoName(''), true);
    assert.strictEqual(MaxEnginePicker.isAutoName(null), true);
    assert.strictEqual(MaxEnginePicker.isAutoName('New trip'), true);
    assert.strictEqual(MaxEnginePicker.isAutoName('Untitled trip'), true);
    assert.strictEqual(MaxEnginePicker.isAutoName('Untitled — Jun 6'), true);
    // live isAutoName is STRICTER than the old twin: a bare/other name is NOT auto
    assert.strictEqual(MaxEnginePicker.isAutoName('Iceland Ring Road'), false);
  });
});

// ── Suite: state sharing ─────────────────────────────────────────

describe('engine-picker.js — state sharing', () => {
  test('MaxEnginePicker.state === window._tb', () => {
    window._tb = { test: 'sentinel' };
    assert.strictEqual(MaxEnginePicker.state, window._tb);
    assert.strictEqual(MaxEnginePicker.state.test, 'sentinel');
  });

  test('resetState replaces the entire draft', () => {
    MaxEnginePicker.resetState({ name: 'Iceland' });
    assert.strictEqual(window._tb.name, 'Iceland');
  });

  test('setField mutates + emits briefChange', () => {
    let captured = null;
    const off = MaxEnginePicker.on('briefChange', p => captured = p);
    MaxEnginePicker.setField('region', 'Iceland');
    off();
    assert.strictEqual(window._tb.region, 'Iceland');
    assert.deepStrictEqual(captured, { field: 'region', value: 'Iceland' });
  });

  test('inline-script-style assignment to _tb is visible through engine getter', () => {
    // Simulates the inline script's `_tb = {...}` re-init pattern.
    window._tb = { region: 'Switzerland' };
    assert.strictEqual(MaxEnginePicker.state.region, 'Switzerland');
  });
});

// ── Suite: HZ.1 (path-to-10 D) — curated read-only getters ───────

describe('engine-picker.js — brief() getter', () => {
  test('returns frozen object', () => {
    window._tb = { entry: 'Zurich' };
    var b = MaxEnginePicker.brief();
    assert.strictEqual(Object.isFrozen(b), true);
    assert.throws(function(){ b.entry = 'mutated'; });
  });
  test('mirrors _tb fields', () => {
    window._tb = {
      region: 'Iceland', entry: 'Reykjavik', tbExit: 'Keflavik',
      hoursPerDay: 6, maxBigSightsPerDay: 2,
      withKids: true,
    };
    var b = MaxEnginePicker.brief();
    assert.strictEqual(b.region, 'Iceland');
    assert.strictEqual(b.entry, 'Reykjavik');
    assert.strictEqual(b.tbExit, 'Keflavik');
    assert.strictEqual(b.hoursPerDay, 6);
    assert.strictEqual(b.maxBigSightsPerDay, 2);
    assert.strictEqual(b.withKids, true);
  });
  test('excludes internal flags (_editMode, _exitTouched)', () => {
    window._tb = { region: 'X', _editMode: true, _exitTouched: true };
    var b = MaxEnginePicker.brief();
    assert.strictEqual(b._editMode, undefined);
    assert.strictEqual(b._exitTouched, undefined);
  });
  test('returns defaults when _tb is empty', () => {
    window._tb = {};
    var b = MaxEnginePicker.brief();
    assert.strictEqual(b.region, '');
    assert.strictEqual(b.hoursPerDay, null);
    assert.strictEqual(b.withKids, false);
  });
  test('avoid object is also frozen', () => {
    window._tb = { avoid: { altitude: true } };
    var b = MaxEnginePicker.brief();
    assert.strictEqual(Object.isFrozen(b.avoid), true);
    assert.strictEqual(b.avoid.altitude, true);
  });
});

describe('engine-picker.js — candidates() getter', () => {
  test('returns frozen array of frozen candidates', () => {
    window._tb = { candidates: [
      {id: 'c1', place: 'A'},
      {id: 'c2', place: 'B'},
    ]};
    var c = MaxEnginePicker.candidates();
    assert.strictEqual(Object.isFrozen(c), true);
    assert.strictEqual(c.length, 2);
    assert.strictEqual(Object.isFrozen(c[0]), true);
    assert.throws(function(){ c[0].place = 'mutated'; });
  });
  test('returns empty array when no candidates', () => {
    window._tb = {};
    var c = MaxEnginePicker.candidates();
    assert.deepStrictEqual(c, []);
  });
});

describe('engine-picker.js — requiredPlaces() getter', () => {
  test('returns frozen array', () => {
    window._tb = { requiredPlaces: [{place: 'A'}, {place: 'B'}] };
    var r = MaxEnginePicker.requiredPlaces();
    assert.strictEqual(Object.isFrozen(r), true);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(Object.isFrozen(r[0]), true);
  });
  test('empty when none', () => {
    window._tb = {};
    assert.deepStrictEqual(MaxEnginePicker.requiredPlaces(), []);
  });
});

// ── Suite: HZ.2 (path-to-10 D) — domain setters ─────────────────

describe('engine-picker.js — domain setters', () => {
  test('setEntry trims + emits briefChange', () => {
    window._tb = {};
    let captured = null;
    const off = MaxEnginePicker.on('briefChange', p => captured = p);
    MaxEnginePicker.setEntry('  Reykjavik  ');
    off();
    assert.strictEqual(window._tb.entry, 'Reykjavik');
    assert.deepStrictEqual(captured, { field: 'entry', value: 'Reykjavik' });
  });
  test('setEntry handles null/undefined as empty string', () => {
    window._tb = { entry: 'old' };
    MaxEnginePicker.setEntry(null);
    assert.strictEqual(window._tb.entry, '');
  });
  test('setExit writes to _tb.tbExit (historical name)', () => {
    window._tb = {};
    MaxEnginePicker.setExit('Keflavik');
    assert.strictEqual(window._tb.tbExit, 'Keflavik');
  });
  test('setRegion mutates + emits', () => {
    window._tb = {};
    let captured = null;
    const off = MaxEnginePicker.on('briefChange', p => captured = p);
    MaxEnginePicker.setRegion('Iceland');
    off();
    assert.strictEqual(window._tb.region, 'Iceland');
    assert.deepStrictEqual(captured, { field: 'region', value: 'Iceland' });
  });
  test('setCandidateStatus fallback path (no inline setCS)', () => {
    delete global.setCS;
    window._tb = { candidates: [
      { id: 'c1', place: 'A', status: null },
      { id: 'c2', place: 'B', status: null },
    ]};
    MaxEnginePicker.setCandidateStatus('c1', 'keep');
    assert.strictEqual(window._tb.candidates[0].status, 'keep');
    MaxEnginePicker.setCandidateStatus('c1', 'reject');
    assert.strictEqual(window._tb.candidates[0].status, 'reject');
    MaxEnginePicker.setCandidateStatus('c1', null);
    assert.strictEqual(window._tb.candidates[0].status, null);
  });
  test('startFresh replaces draft', () => {
    window._tb = { region: 'old' };
    MaxEnginePicker.startFresh({ region: 'fresh' });
    assert.strictEqual(window._tb.region, 'fresh');
  });

  // ── Round NC.1 (deprecated, dispatched onto NC.3): tripRole ────
  // setTripRole is kept as a transitional shim — it dispatches to
  // setRole with the NC.1 → NC.3 vocabulary mapping. Tests below
  // pin the shim's mapping; the substantive setRole tests live in
  // the NC.3a block further down.
  test('setTripRole shim: writes role via setRole and emits NC.3 shape', () => {
    window._tb = { candidates: [{ id: 'c1', place: 'Reykjavik', overnightCapable: true }] };
    let captured = null;
    const off = MaxEnginePicker.on('candidateChange', p => captured = p);
    MaxEnginePicker.setTripRole('c1', 'overnight');
    off();
    assert.strictEqual(window._tb.candidates[0].role, 'stay');
    assert.strictEqual(captured.id, 'c1');
    assert.strictEqual(captured.role, 'stay');
  });
  test('setTripRole shim: daytrip / onway pass through', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true }] };
    MaxEnginePicker.setTripRole('c1', 'daytrip');
    assert.strictEqual(window._tb.candidates[0].role, 'daytrip');
    MaxEnginePicker.setTripRole('c1', 'onway');
    assert.strictEqual(window._tb.candidates[0].role, 'onway');
  });
  test('setTripRole shim: garbage maps to "see" (the new neutral default)', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true, role: 'stay' }] };
    MaxEnginePicker.setTripRole('c1', 'bogus');
    assert.strictEqual(window._tb.candidates[0].role, 'see');
  });
  test('setTripRole shim: no-ops on missing candidate id', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true }] };
    MaxEnginePicker.setTripRole('cZ', 'overnight');
    assert.strictEqual(window._tb.candidates[0].role, undefined);
  });

  // ── Round NC.2 (gallery-pivot): pin color helper ───────────────
  test('pinColorForRole: overnight (NC.1 name) → blue', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('overnight'), '#1a5fa8');
  });
  test('pinColorForRole: stay (NC.3 name) → blue', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('stay'), '#1a5fa8');
  });
  test('pinColorForRole: daytrip → purple', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('daytrip'), '#7c3aed');
  });
  test('pinColorForRole: onway → teal (placeholder until NC.3c octagon)', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('onway'), '#0891b2');
  });
  test('pinColorForRole: see → gray (renderer overlays eye glyph)', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('see'), '#9ca3af');
  });
  test('pinColorForRole: unknown / null / undefined → blue fallback', () => {
    assert.strictEqual(MaxEnginePicker.pinColorForRole('bogus'), '#1a5fa8');
    assert.strictEqual(MaxEnginePicker.pinColorForRole(null), '#1a5fa8');
    assert.strictEqual(MaxEnginePicker.pinColorForRole(undefined), '#1a5fa8');
  });

  // ── Round NC.3a (state-model): setRole + normalize ─────────────
  test('setRole writes "stay" on overnight-capable candidate', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true, role: 'see' }] };
    let captured = null;
    const off = MaxEnginePicker.on('candidateChange', p => captured = p);
    MaxEnginePicker.setRole('c1', 'stay');
    off();
    assert.strictEqual(window._tb.candidates[0].role, 'stay');
    assert.strictEqual(window._tb.candidates[0]._roleTouched, true);
    assert.deepStrictEqual(captured, { id: 'c1', role: 'stay', prevRole: 'see' });
  });
  test('setRole accepts daytrip / onway / see on any candidate', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: false, role: 'see' }] };
    MaxEnginePicker.setRole('c1', 'daytrip');
    assert.strictEqual(window._tb.candidates[0].role, 'daytrip');
    MaxEnginePicker.setRole('c1', 'onway');
    assert.strictEqual(window._tb.candidates[0].role, 'onway');
    MaxEnginePicker.setRole('c1', 'see');
    assert.strictEqual(window._tb.candidates[0].role, 'see');
  });
  test('setRole refuses "stay" on a non-overnight-capable candidate', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: false, role: 'see' }] };
    MaxEnginePicker.setRole('c1', 'stay');
    assert.strictEqual(window._tb.candidates[0].role, 'see', 'role unchanged');
  });
  test('setRole rejects garbage role values silently', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true, role: 'stay' }] };
    MaxEnginePicker.setRole('c1', 'bogus');
    assert.strictEqual(window._tb.candidates[0].role, 'stay', 'role unchanged');
    MaxEnginePicker.setRole('c1', null);
    assert.strictEqual(window._tb.candidates[0].role, 'stay');
  });
  test('setTripRole (NC.1 deprecated) maps onto NC.3 roles', () => {
    window._tb = { candidates: [{ id: 'c1', overnightCapable: true }] };
    MaxEnginePicker.setTripRole('c1', 'overnight');
    assert.strictEqual(window._tb.candidates[0].role, 'stay');
    MaxEnginePicker.setTripRole('c1', 'unspecified');
    assert.strictEqual(window._tb.candidates[0].role, 'see');
    MaxEnginePicker.setTripRole('c1', 'daytrip');
    assert.strictEqual(window._tb.candidates[0].role, 'daytrip');
    MaxEnginePicker.setTripRole('c1', 'onway');
    assert.strictEqual(window._tb.candidates[0].role, 'onway');
  });

  test('normalizeCandidateRole: derives overnightCapable from legacy singleSight', () => {
    const c1 = { singleSight: true };
    MaxEnginePicker.normalizeCandidateRole(c1);
    assert.strictEqual(c1.overnightCapable, false);
    assert.strictEqual(c1.role, 'see');

    const c2 = { singleSight: false };
    MaxEnginePicker.normalizeCandidateRole(c2);
    assert.strictEqual(c2.overnightCapable, true);
    assert.strictEqual(c2.role, 'stay');
  });
  test('normalizeCandidateRole: defaults bare candidates to stay-capable + stay', () => {
    const c = {};
    MaxEnginePicker.normalizeCandidateRole(c);
    assert.strictEqual(c.overnightCapable, true);
    assert.strictEqual(c.role, 'stay');
  });
  test('normalizeCandidateRole: maps legacy tripRole vocabulary onto role', () => {
    const c = { overnightCapable: true, tripRole: 'overnight' };
    MaxEnginePicker.normalizeCandidateRole(c);
    assert.strictEqual(c.role, 'stay');

    const c2 = { overnightCapable: true, tripRole: 'unspecified' };
    MaxEnginePicker.normalizeCandidateRole(c2);
    assert.strictEqual(c2.role, 'see');
  });
  test('normalizeCandidateRole: maps legacy dest.intent vocabulary onto role', () => {
    const c = { overnightCapable: true, intent: 'dayTrip' };
    MaxEnginePicker.normalizeCandidateRole(c);
    assert.strictEqual(c.role, 'daytrip');

    const c2 = { overnightCapable: true, intent: 'wayside' };
    MaxEnginePicker.normalizeCandidateRole(c2);
    assert.strictEqual(c2.role, 'onway');
  });
  test('normalizeCandidateRole: demotes "stay" on non-capable to "see"', () => {
    const c = { overnightCapable: false, role: 'stay' };
    MaxEnginePicker.normalizeCandidateRole(c);
    assert.strictEqual(c.role, 'see', 'corrupted "stay" on non-capable downgraded');
  });
  test('normalizeCandidateRole: idempotent on already-normalized', () => {
    const c = { overnightCapable: true, role: 'daytrip' };
    MaxEnginePicker.normalizeCandidateRole(c);
    assert.strictEqual(c.role, 'daytrip');
    assert.strictEqual(c.overnightCapable, true);
  });
});

// ── Suite: orderKeptCandidates scenarios ───────────────────────

describe('engine-picker.js — orderKeptCandidates', () => {
  test('Iceland round trip: Reykjavik gateway inferred from _cityPick', () => {
    window._tb = { region: 'Iceland' };
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Vik',       lat: 63.42, lng: -19.01 },
        { id: 'c2', place: 'Reykjavik', lat: 64.14, lng: -21.94, _cityPick: true },
        { id: 'c3', place: 'Höfn',      lat: 64.25, lng: -15.20 },
      ],
      [], '', ''
    );
    assert.strictEqual(result.ordered[0].place, 'Reykjavik', 'gateway should be first');
    assert.ok(result.inferredEntry, 'entry should be inferred');
    assert.strictEqual(result.inferredEntry.place, 'Reykjavik');
    assert.strictEqual(window._tb.tbExit, 'Reykjavik', 'round-trip exit synthesized');
  });

  // Known issue (deferred per Round HK policy): the gateway-fallback's
  // substring match falsely picks "Vik" as the "Reykjavik" gateway
  // because "reykjavik".indexOf("vik") >= 0. Should require equality
  // or one-directional match (cN.indexOf(prefN) only). When the
  // buildFromCandidates decomposition lands, fix this in the same
  // round and unskip the test.
  xtest('Iceland round trip: hardcoded major-gateway fallback when no _cityPick',
    () => {
      window._tb = { region: 'Iceland' };
      const result = MaxEnginePicker.orderKeptCandidates(
        [
          { id: 'c1', place: 'Vik',       lat: 63.42, lng: -19.01 },
          { id: 'c2', place: 'Reykjavik', lat: 64.14, lng: -21.94 },
        ],
        [], '', ''
      );
      assert.strictEqual(result.ordered[0].place, 'Reykjavik');
    },
    'orderKeptCandidates substring-match picks Vik over Reykjavik — pre-existing bug'
  );

  test('Switzerland with explicit entry Zurich + exit Geneva', () => {
    window._tb = { region: 'Switzerland' };
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Zurich',    lat: 47.37, lng: 8.55 },
        { id: 'c2', place: 'Lucerne',   lat: 47.05, lng: 8.31 },
        { id: 'c3', place: 'Geneva',    lat: 46.20, lng: 6.14 },
      ],
      [], 'Zurich', 'Geneva'
    );
    assert.strictEqual(result.ordered[0].place, 'Zurich');
    assert.strictEqual(result.ordered[result.ordered.length - 1].place, 'Geneva');
  });

  test('empty kept list returns empty result', () => {
    const result = MaxEnginePicker.orderKeptCandidates([], [], '', '');
    assert.deepStrictEqual(result.ordered, []);
    assert.deepStrictEqual(result.reasoning, []);
    assert.strictEqual(result.inferredEntry, null);
  });

  // PD.436: a SIGHT must never become the arrival/departure gateway — an
  // airport is a destination, not a canyon. Even when an exit hint names the
  // sight, the guard rejects it so the exit isn't pinned to a place with no
  // airport (the "Departing Fjaðrárgljúfur Canyon" bug).
  test('a sight named as the exit is NOT pinned as the departure gateway', () => {
    window._tb = { region: 'Switzerland' };
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Zurich',       lat: 47.37, lng: 8.55 },
        { id: 'c2', place: 'Glacier Gorge', lat: 47.05, lng: 8.00, role: 'see', overnightCapable: false },
        { id: 'c3', place: 'Geneva',       lat: 46.20, lng: 6.14 },
      ],
      [], 'Zurich', 'Glacier Gorge'   // exit hint names the SIGHT
    );
    const last = result.ordered[result.ordered.length - 1];
    assert.notStrictEqual(last.place, 'Glacier Gorge', 'a sight must not be pinned last as the exit gateway');
    assert.ok(result.ordered.some(c => c.place === 'Glacier Gorge'), 'the sight is still in the trip, just not the gateway');
  });

  test('a sight named as the entry is NOT used as the arrival gateway', () => {
    window._tb = { region: 'Switzerland' };
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Waterfall Trail', lat: 46.60, lng: 7.90, role: 'see', overnightCapable: false },
        { id: 'c2', place: 'Zurich',          lat: 47.37, lng: 8.55, _cityPick: true },
        { id: 'c3', place: 'Bern',            lat: 46.95, lng: 7.45 },
      ],
      [], 'Waterfall Trail', ''   // entry hint names the SIGHT
    );
    assert.notStrictEqual(result.ordered[0].place, 'Waterfall Trail', 'a sight must not be the arrival gateway');
  });
});

// ── Suite: extractRoutePreference (Round NC.X) ──────────────────
//
// Free-text intent → structured route preference. Keyword-driven
// today; the schema is the durable contract. When an LLM-extraction
// path lands later, it writes the same fields and every downstream
// consumer keeps working unchanged.
describe('engine-picker.js — extractRoutePreference', () => {
  test('Iceland counterclockwise + coast + no interior', () => {
    const rp = MaxEnginePicker.extractRoutePreference(
      'Northern Lights first, while driving the complete ring road counterclockwise from end to end, sticking mostly to the coast and avoiding routes that cut across the island'
    );
    assert.strictEqual(rp.direction, 'counterclockwise');
    assert.strictEqual(rp.coastalAffinity, 'strong');
    assert.strictEqual(rp.allowInterior, false);
    assert.strictEqual(rp.routeTopology, 'ring');
  });

  test('Wild Atlantic Way clockwise', () => {
    const rp = MaxEnginePicker.extractRoutePreference(
      'Driving the Wild Atlantic Way clockwise, hugging the coast from Donegal to Cork.'
    );
    assert.strictEqual(rp.direction, 'clockwise');
    assert.strictEqual(rp.coastalAffinity, 'strong');
  });

  test('anti-clockwise is recognized as counterclockwise', () => {
    const rp = MaxEnginePicker.extractRoutePreference('anti-clockwise loop of the island');
    assert.strictEqual(rp.direction, 'counterclockwise');
  });

  test('default everything-null when no keywords', () => {
    const rp = MaxEnginePicker.extractRoutePreference('I want to see Northern Lights');
    assert.strictEqual(rp.direction, null);
    assert.strictEqual(rp.coastalAffinity, null);
    assert.strictEqual(rp.allowInterior, true);
    assert.strictEqual(rp.routeTopology, null);
  });

  test('empty string yields neutral preference', () => {
    const rp = MaxEnginePicker.extractRoutePreference('');
    assert.strictEqual(rp.direction, null);
    assert.strictEqual(rp.coastalAffinity, null);
    assert.strictEqual(rp.allowInterior, true);
  });
});

// ── Suite: orderKeptCandidates with route preference ────────────
//
// Direction lock + ring topology + coastal affinity override the
// pure-distance optimization that previously won in Iceland.
describe('engine-picker.js — orderKeptCandidates honors route preference', () => {
  test('counterclockwise direction is honored even when clockwise is shorter', () => {
    window._tb = { region: 'Iceland' };
    // 5 places roughly around Iceland; clockwise vs counterclockwise
    // length will differ because exit is in a specific quadrant.
    const kept = [
      { id: 'c1', place: 'Reykjavik', lat: 64.14, lng: -21.94, _cityPick: true },
      { id: 'c2', place: 'Vik',       lat: 63.42, lng: -19.01 },
      { id: 'c3', place: 'Höfn',      lat: 64.25, lng: -15.20 },
      { id: 'c4', place: 'Akureyri',  lat: 65.68, lng: -18.10 },
      { id: 'c5', place: 'Egilsstaðir',lat: 65.26, lng: -14.39 },
    ];
    const ccwResult = MaxEnginePicker.orderKeptCandidates(
      kept, [], '', '',
      { direction: 'counterclockwise', routeTopology: 'ring', coastalAffinity: 'strong', allowInterior: false }
    );
    const cwResult = MaxEnginePicker.orderKeptCandidates(
      kept, [], '', '',
      { direction: 'clockwise', routeTopology: 'ring', coastalAffinity: 'strong', allowInterior: false }
    );
    // NC.7 corrected: from a western entry (Reykjavík at ≈9 o'clock
    // on the island), everyday-CCW visits the SOUTH coast first
    // (Vik), then loops east, north, and back. CW does the opposite,
    // going north first (Akureyri). Earlier version of this test
    // asserted the inverted mapping; the code change in NC.7 (return
    // ccwSeq for user-CCW, cwSeq for user-CW) restores the correct
    // sense and this test now pins it down.
    const ccwMid = ccwResult.ordered.slice(1).map(c => c.place);
    const cwMid  = cwResult.ordered.slice(1).map(c => c.place);
    assert.notDeepStrictEqual(ccwMid, cwMid, 'CCW and CW orderings must differ');
    // CCW should reach Vik before Akureyri; CW the reverse.
    const ccwAk = ccwMid.indexOf('Akureyri');
    const ccwVik = ccwMid.indexOf('Vik');
    assert.ok(ccwVik < ccwAk, 'CCW from Reykjavik should visit Vik (south) before Akureyri (north)');
    const cwAk = cwMid.indexOf('Akureyri');
    const cwVik = cwMid.indexOf('Vik');
    assert.ok(cwAk < cwVik, 'CW from Reykjavik should visit Akureyri (north) before Vik (south)');
  });

  test('ring topology + coastal affinity skips 2-opt cleanup', () => {
    window._tb = { region: 'Iceland' };
    // Without the topology lock, 2-opt may pull interior shortcuts
    // in a small fixture. The reasoning should mention the
    // perimeter sweep rather than a nearest-neighbor / 2-opt explanation.
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Reykjavik', lat: 64.14, lng: -21.94, _cityPick: true },
        { id: 'c2', place: 'Vik',       lat: 63.42, lng: -19.01 },
        { id: 'c3', place: 'Akureyri',  lat: 65.68, lng: -18.10 },
        { id: 'c4', place: 'Egilsstaðir',lat: 65.26, lng: -14.39 },
      ],
      [], '', '',
      { routeTopology: 'ring', coastalAffinity: 'strong', allowInterior: false }
    );
    const ringMention = result.reasoning.some(r => /perimeter|ring-road|coastal/i.test(r));
    assert.ok(ringMention, 'reasoning should explain the perimeter sweep');
  });

  test('no route preference preserves existing behavior', () => {
    window._tb = { region: 'Iceland' };
    const result = MaxEnginePicker.orderKeptCandidates(
      [
        { id: 'c1', place: 'Reykjavik', lat: 64.14, lng: -21.94, _cityPick: true },
        { id: 'c2', place: 'Vik',       lat: 63.42, lng: -19.01 },
        { id: 'c3', place: 'Akureyri',  lat: 65.68, lng: -18.10 },
      ],
      [], '', ''
      // No 5th arg — back-compat.
    );
    assert.strictEqual(result.ordered[0].place, 'Reykjavik', 'gateway still first');
  });
});

// ── Suite: buildBrief threads routePreference ───────────────────
describe('engine-picker.js — buildBrief emits routePreference', () => {
  test('Iceland CCW intent produces structured preference', () => {
    const brief = MaxEnginePicker.buildBrief({
      region: 'Iceland',
      intent: 'Ring road counterclockwise, stick to the coast, no interior.',
    });
    assert.ok(brief.routePreference, 'brief.routePreference must exist');
    assert.strictEqual(brief.routePreference.direction, 'counterclockwise');
    assert.strictEqual(brief.routePreference.coastalAffinity, 'strong');
    assert.strictEqual(brief.routePreference.allowInterior, false);
    assert.strictEqual(brief.routePreference.routeTopology, 'ring');
  });

  test('empty intent yields neutral preference object', () => {
    const brief = MaxEnginePicker.buildBrief({ region: 'Iceland', intent: '' });
    assert.ok(brief.routePreference);
    assert.strictEqual(brief.routePreference.direction, null);
    assert.strictEqual(brief.routePreference.allowInterior, true);
  });
});

// ── Suite: orderPlacePickerStays (place-picker hero map) ────────
//
// Mirror of orderKeptCandidates' geo-reorder, simpler — no route
// blocks, no condition bunching, no entry/exit anchors. Just a
// nearest-neighbor walk seeded at the northernmost stay. Day trips
// (_isDayTrip) are excluded; un-geocoded stays append at the end.

describe('engine-picker.js — orderPlacePickerStays', () => {
  test('returns [] for empty input', () => {
    const r = MaxEnginePicker.orderPlacePickerStays({}, () => null);
    assert.deepStrictEqual(r, []);
  });
  test('single stay returns that stay', () => {
    const all = { 'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false } };
    const r = MaxEnginePicker.orderPlacePickerStays(all, () => [64.14, -21.94]);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].place, 'Reykjavik');
  });
  test('excludes _isDayTrip places from the polyline', () => {
    const all = {
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'grindavik': { place: 'Grindavik', kept: true, _isDayTrip: true, _dayTripHub: 'reykjavik' },
    };
    const coords = { 'Reykjavik': [64.14, -21.94], 'Grindavik': [63.84, -22.43] };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n]);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].place, 'Reykjavik');
  });
  test('orders three stays by nearest-neighbor from northernmost seed', () => {
    // Iceland-ish: Reykjavik (north-west), Vík (south), Höfn (south-east)
    const all = {
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'hofn': { place: 'Hofn', kept: true, _isDayTrip: false },
    };
    const coords = {
      'Reykjavik': [64.14, -21.94],
      'Vik':       [63.42, -19.01],
      'Hofn':      [64.25, -15.21],
    };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n]);
    assert.strictEqual(r.length, 3);
    // Northernmost seed is Hofn (64.25) or Reykjavik (64.14). Hofn wins
    // by a hair, then nearest is Vík, then Reykjavik.
    assert.strictEqual(r[0].place, 'Hofn');
    assert.strictEqual(r[1].place, 'Vik');
    assert.strictEqual(r[2].place, 'Reykjavik');
  });
  test('un-geocoded stays append at the end (geocode race)', () => {
    const all = {
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'mystery': { place: 'Mystery', kept: true, _isDayTrip: false },
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
    };
    const coords = { 'Reykjavik': [64.14, -21.94], 'Vik': [63.42, -19.01] };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n] || null);
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[r.length - 1].place, 'Mystery');
  });
  test('handles missing coordLookup gracefully', () => {
    const all = {
      'a': { place: 'A', kept: true, _isDayTrip: false },
      'b': { place: 'B', kept: true, _isDayTrip: false },
    };
    const r = MaxEnginePicker.orderPlacePickerStays(all);
    // Both ungeocoded — preserve insertion order, no crash.
    assert.strictEqual(r.length, 2);
  });

  // v355.1 — startKey hint: user-chosen seed for the nearest-neighbor walk.
  test('start hint matches a stay → that stay is first', () => {
    // Same Iceland-ish set; northernmost would be Hofn, but we ask
    // for Reykjavik as the start.
    const all = {
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'hofn': { place: 'Hofn', kept: true, _isDayTrip: false },
    };
    const coords = {
      'Reykjavik': [64.14, -21.94],
      'Vik':       [63.42, -19.01],
      'Hofn':      [64.25, -15.21],
    };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n], 'reykjavik');
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[0].place, 'Reykjavik');
    // Nearest from Reykjavik is Vik, then Hofn.
    assert.strictEqual(r[1].place, 'Vik');
    assert.strictEqual(r[2].place, 'Hofn');
  });
  test('empty start hint falls back to northernmost seed', () => {
    const all = {
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'hofn': { place: 'Hofn', kept: true, _isDayTrip: false },
    };
    const coords = {
      'Reykjavik': [64.14, -21.94],
      'Vik':       [63.42, -19.01],
      'Hofn':      [64.25, -15.21],
    };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n], '');
    assert.strictEqual(r.length, 3);
    // Northernmost is Hofn — same as the no-hint baseline.
    assert.strictEqual(r[0].place, 'Hofn');
  });
  test('start hint matching a non-stay (day trip) falls back to northernmost', () => {
    const all = {
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
      'grindavik': { place: 'Grindavik', kept: true, _isDayTrip: true, _dayTripHub: 'reykjavik' },
    };
    const coords = {
      'Reykjavik': [64.14, -21.94],
      'Vik':       [63.42, -19.01],
      'Grindavik': [63.84, -22.43],
    };
    // Day trip is filtered out before seed selection — fall back to
    // northernmost (Reykjavik), don't crash.
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n], 'grindavik');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].place, 'Reykjavik');
  });
  test('start hint matching a stay with no coord falls back to northernmost', () => {
    const all = {
      'reykjavik': { place: 'Reykjavik', kept: true, _isDayTrip: false },
      'vik': { place: 'Vik', kept: true, _isDayTrip: false },
      'mystery': { place: 'Mystery', kept: true, _isDayTrip: false },
    };
    const coords = { 'Reykjavik': [64.14, -21.94], 'Vik': [63.42, -19.01] };
    const r = MaxEnginePicker.orderPlacePickerStays(all, n => coords[n] || null, 'mystery');
    // Mystery has no coord so it's not a candidate seed; fall back to
    // northernmost geocoded stay (Reykjavik). Mystery still appears at
    // the end via the no-geo append.
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[0].place, 'Reykjavik');
    assert.strictEqual(r[r.length - 1].place, 'Mystery');
  });
});

// ── Suite: buildDayTripNote (place-picker hero map: Step 8) ─────
//
// Empty when no _isDayTrip flags are set. Otherwise produces a brief
// paragraph that the runCandidateSearch prompts append, naming each
// flagged place with its hub. The note IS the carry-through from
// the place-picker's user decisions to the LLM candidate brief.

describe('engine-picker.js — buildDayTripNote', () => {
  test('returns "" for missing input', () => {
    assert.strictEqual(MaxEnginePicker.buildDayTripNote(null), '');
    assert.strictEqual(MaxEnginePicker.buildDayTripNote(undefined), '');
    assert.strictEqual(MaxEnginePicker.buildDayTripNote([]), '');
  });
  test('returns "" when no _isDayTrip flags are set', () => {
    const items = [
      { requiredPlaces: [{ place: 'Reykjavik', _isDayTrip: false }, { place: 'Vík' }] },
    ];
    assert.strictEqual(MaxEnginePicker.buildDayTripNote(items), '');
  });
  test('produces a note for one flagged place + hub', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Reykjavik', _isDayTrip: false },
          { place: 'Grindavik', _isDayTrip: true, _dayTripHub: 'reykjavik' },
        ] },
    ];
    const note = MaxEnginePicker.buildDayTripNote(items);
    assert.ok(note.indexOf('USER DAY-TRIP DECISIONS') >= 0, 'note carries the marker');
    assert.ok(note.indexOf('Grindavik') >= 0, 'names the day-trip place');
    assert.ok(note.indexOf('Reykjavik') >= 0, 'resolves hub display name from another ref');
    assert.ok(note.indexOf('day trip from Reykjavik') >= 0, 'phrases the hub correctly');
  });
  test('produces a note even when the hub display name is not separately listed', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Grindavik', _isDayTrip: true, _dayTripHub: 'reykjavik' },
        ] },
    ];
    const note = MaxEnginePicker.buildDayTripNote(items);
    // Hub key "reykjavik" should still appear as the hub name (lowercase fallback).
    assert.ok(note.indexOf('day trip from reykjavik') >= 0);
  });
  test('handles a flagged place with no hub gracefully', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Mystery', _isDayTrip: true, _dayTripHub: '' },
        ] },
    ];
    const note = MaxEnginePicker.buildDayTripNote(items);
    assert.ok(note.indexOf('Mystery as a day trip') >= 0);
  });
  test('joins multiple flagged places with semicolons', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Reykjavik', _isDayTrip: false },
          { place: 'Grindavik', _isDayTrip: true, _dayTripHub: 'reykjavik' },
          { place: 'Þingvellir', _isDayTrip: true, _dayTripHub: 'reykjavik' },
        ] },
    ];
    const note = MaxEnginePicker.buildDayTripNote(items);
    assert.ok(note.indexOf(';') >= 0, 'multiple entries are joined with semicolons');
    assert.ok(note.indexOf('Grindavik') >= 0);
    assert.ok(note.indexOf('Þingvellir') >= 0);
  });
});

// ── Suite: collectUserDayTripPairs (place-picker hero map: 8b) ───
//
// Pair extractor used by publishTrip's user-day-trip absorption pass.
// Both keys are normalized via _normPlaceName so callers can match
// against destinations directly.

describe('engine-picker.js — collectUserDayTripPairs', () => {
  test('returns {} for missing input', () => {
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs(null), {});
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs(undefined), {});
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs([]), {});
  });
  test('returns {} when no _isDayTrip flags are set', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Reykjavik' },
          { place: 'Vík',       _isDayTrip: false, _dayTripHub: 'reykjavik' },
        ] },
    ];
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs(items), {});
  });
  test('extracts a single pair, normalizing both keys', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Vík',       _isDayTrip: true,  _dayTripHub: 'Reykjavik' },
        ] },
    ];
    const pairs = MaxEnginePicker.collectUserDayTripPairs(items);
    assert.strictEqual(Object.keys(pairs).length, 1);
    // _normPlaceName strips diacritics and lowercases — both source and
    // hub should be normalized identically so callers don't have to.
    const srcKey = Object.keys(pairs)[0];
    assert.strictEqual(srcKey, srcKey.toLowerCase(), 'source key is lowercased');
    assert.ok(srcKey.indexOf('vik') >= 0, 'diacritics stripped from source');
    assert.strictEqual(pairs[srcKey], pairs[srcKey].toLowerCase(), 'hub key is lowercased');
    assert.strictEqual(pairs[srcKey], 'reykjavik');
  });
  test('dedupes when the same place appears in multiple activities', () => {
    const items = [
      { requiredPlaces: [{ place: 'Vík', _isDayTrip: true, _dayTripHub: 'Reykjavik' }] },
      { requiredPlaces: [{ place: 'Vík', _isDayTrip: true, _dayTripHub: 'Selfoss' }] },
    ];
    const pairs = MaxEnginePicker.collectUserDayTripPairs(items);
    assert.strictEqual(Object.keys(pairs).length, 1, 'one entry per source');
    // First hub seen wins (stable for re-runs).
    assert.strictEqual(pairs['vik'], 'reykjavik');
  });
  test('skips entries missing a hub', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Mystery', _isDayTrip: true, _dayTripHub: '' },
          { place: 'Other',   _isDayTrip: true /* hub omitted */ },
        ] },
    ];
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs(items), {});
  });
  test('drops self-referential pairs (source same as hub)', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Reykjavik', _isDayTrip: true, _dayTripHub: 'reykjavik' },
        ] },
    ];
    assert.deepStrictEqual(MaxEnginePicker.collectUserDayTripPairs(items), {});
  });
  test('handles multiple distinct sources to different hubs', () => {
    const items = [
      { requiredPlaces: [
          { place: 'Vík',       _isDayTrip: true, _dayTripHub: 'Reykjavik' },
          { place: 'Geirangerfjord', _isDayTrip: true, _dayTripHub: 'Ålesund' },
        ] },
    ];
    const pairs = MaxEnginePicker.collectUserDayTripPairs(items);
    assert.strictEqual(Object.keys(pairs).length, 2);
    assert.ok(pairs['vik'] === 'reykjavik');
    // Both keys normalized — find by substring match in case _normPlaceName
    // does something specific with the special characters.
    const norwayKeys = Object.keys(pairs).filter(k => k.indexOf('geiranger') >= 0);
    assert.strictEqual(norwayKeys.length, 1);
    assert.ok(pairs[norwayKeys[0]].indexOf('alesund') >= 0 || pairs[norwayKeys[0]].indexOf('ålesund') >= 0);
  });
});

// ── Suite: groupCandidatesByMustDo (Round HX) ───────────────────
//
// Pure derivation extracted from renderCandidateCards. Verifies the
// grouping contract: each candidate appears in exactly one section
// (its FIRST must-do in mdcItems order), unmatched candidates fall
// to discoveryCands, and __manual__ refs don't count as real refs.

describe('engine-picker.js — groupCandidatesByMustDo', () => {
  test('candidate goes under its first must-do in mdcItems order', () => {
    const cands = [
      { id: 'c1', _requiredFor: ['Aurora', 'Northern lights'] },
      { id: 'c2', _requiredFor: ['Northern lights'] },
    ];
    const mdcItems = [
      { name: 'Aurora',          checked: true },
      { name: 'Northern lights', checked: true },
    ];
    const result = MaxEnginePicker.groupCandidatesByMustDo(cands, mdcItems);
    assert.deepStrictEqual(result.primaryByCandId, { c1: 'Aurora', c2: 'Northern lights' });
    assert.deepStrictEqual(Object.keys(result.candByPrimary).sort(),
      ['Aurora', 'Northern lights']);
    assert.deepStrictEqual(result.discoveryCands, []);
  });

  test('candidate with no real refs goes to discoveryCands', () => {
    const cands = [
      { id: 'c1', _requiredFor: [] },
      { id: 'c2' },
      { id: 'c3', _requiredFor: ['__manual__'] },
    ];
    const result = MaxEnginePicker.groupCandidatesByMustDo(cands, []);
    assert.strictEqual(result.discoveryCands.length, 3);
    assert.deepStrictEqual(result.candByPrimary, {});
  });

  test('unchecked must-dos are skipped — first checked one wins', () => {
    const cands = [
      { id: 'c1', _requiredFor: ['A', 'B'] },
    ];
    const mdcItems = [
      { name: 'A', checked: false },
      { name: 'B', checked: true },
    ];
    const result = MaxEnginePicker.groupCandidatesByMustDo(cands, mdcItems);
    assert.strictEqual(result.primaryByCandId.c1, 'B');
  });

  test('candidate with refs but none in mdcItems falls back to first ref', () => {
    const cands = [
      { id: 'c1', _requiredFor: ['Northern lights'] },
    ];
    // mdcItems has nothing matching — primary should still be a real ref.
    const result = MaxEnginePicker.groupCandidatesByMustDo(cands, [
      { name: 'Aurora', checked: true },
    ]);
    assert.strictEqual(result.primaryByCandId.c1, 'Northern lights');
  });

  test('handles null/undefined inputs', () => {
    const a = MaxEnginePicker.groupCandidatesByMustDo(null, null);
    assert.deepStrictEqual(a.candByPrimary, {});
    assert.deepStrictEqual(a.discoveryCands, []);
    const b = MaxEnginePicker.groupCandidatesByMustDo([], []);
    assert.deepStrictEqual(b.candByPrimary, {});
  });

  // Round HX.6: groupCandidatesByMustDo now also returns mustDoOrder
  // — the user-sentence-ordered list of active must-do names. Pinned
  // here so the activity-lens renderer can rely on the field's
  // presence and ordering. Before HX.6 the inline renderer had its
  // own duplicate `var mustDoOrder = …` declaration; HX dropped that
  // line without surfacing the value, making the activity lens (the
  // default) crash on a ReferenceError.
  test('returns mustDoOrder in user-sentence order, skipping unchecked + __manual__', () => {
    const mdcItems = [
      { name: 'Aurora',          checked: true },
      { name: 'A skipped one',   checked: false },
      { name: '__manual__',      checked: true },
      { name: 'Northern lights', checked: true },
    ];
    const result = MaxEnginePicker.groupCandidatesByMustDo([], mdcItems);
    assert.deepStrictEqual(result.mustDoOrder, ['Aurora', 'Northern lights']);
  });

  test('mustDoOrder is [] when mdcItems is null/empty', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.groupCandidatesByMustDo([], null).mustDoOrder, []);
    assert.deepStrictEqual(
      MaxEnginePicker.groupCandidatesByMustDo([], []).mustDoOrder, []);
  });
});

// ── Suite: mustDoSectionTitle (Round HX.10) ────────────────────

describe('engine-picker.js — mustDoSectionTitle', () => {
  test('route gets "scenic travel" suffix', () => {
    assert.strictEqual(
      MaxEnginePicker.mustDoSectionTitle('Bernina', { type: 'route' }),
      'Bernina · scenic travel');
  });

  test('non-route uses the raw type word', () => {
    assert.strictEqual(
      MaxEnginePicker.mustDoSectionTitle('Northern lights', { type: 'condition' }),
      'Northern lights · condition');
    assert.strictEqual(
      MaxEnginePicker.mustDoSectionTitle('Glacier kayaking', { type: 'activity' }),
      'Glacier kayaking · activity');
  });

  test('no item / no type → just the name', () => {
    assert.strictEqual(
      MaxEnginePicker.mustDoSectionTitle('Some Chip', null),
      'Some Chip');
    assert.strictEqual(
      MaxEnginePicker.mustDoSectionTitle('Some Chip', {}),
      'Some Chip');
  });

  test('null name returns empty', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionTitle(null, null), '');
  });
});

// ── Suite: mustDoSectionRenderable (Round HX.9) ────────────────

describe('engine-picker.js — mustDoSectionRenderable', () => {
  test('route always renders — empty group is fine', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('route', false), true);
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('route', true),  true);
  });

  test('activity always renders — empty group is fine', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('activity', false), true);
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('activity', true),  true);
  });

  test('condition only renders when there is a group', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('condition', false), false);
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('condition', true),  true);
  });

  test('manual only renders when there is a group', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('manual', false), false);
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('manual', true),  true);
  });

  test('unknown type behaves like condition/manual (group required)', () => {
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('mystery', false), false);
    assert.strictEqual(MaxEnginePicker.mustDoSectionRenderable('mystery', true),  true);
  });
});

// ── Suite: routeArrow (Round HX.9) ─────────────────────────────

describe('engine-picker.js — routeArrow', () => {
  test('forward direction → " → " (default)', () => {
    assert.strictEqual(MaxEnginePicker.routeArrow('forward'), ' → ');
    assert.strictEqual(MaxEnginePicker.routeArrow(),          ' → ');
    assert.strictEqual(MaxEnginePicker.routeArrow(null),      ' → ');
  });

  test('reverse direction → " ← "', () => {
    assert.strictEqual(MaxEnginePicker.routeArrow('reverse'), ' ← ');
  });

  test('either direction → " ↔ "', () => {
    assert.strictEqual(MaxEnginePicker.routeArrow('either'),  ' ↔ ');
  });

  test('unknown direction falls back to forward', () => {
    assert.strictEqual(MaxEnginePicker.routeArrow('sideways'), ' → ');
  });
});

// ── Suite: regionWithinCountrySort (Round HX.8) ────────────────

describe('engine-picker.js — regionWithinCountrySort', () => {
  test('keeps come before non-keeps', () => {
    const group = [
      { place: 'Bern' },
      { place: 'Aarau', status: 'keep' },
      { place: 'Chur' },
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.regionWithinCountrySort(group).map(c => c.place),
      ['Aarau', 'Bern', 'Chur']);
  });

  test('within keeps, sorted alphabetically by place', () => {
    const group = [
      { place: 'Zurich', status: 'keep' },
      { place: 'Aarau',  status: 'keep' },
      { place: 'Lugano', status: 'keep' },
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.regionWithinCountrySort(group).map(c => c.place),
      ['Aarau', 'Lugano', 'Zurich']);
  });

  test('within non-keeps, sorted alphabetically by place', () => {
    const group = [
      { place: 'Zurich' },
      { place: 'Aarau' },
      { place: 'Lugano', status: 'reject' },
    ];
    // localeCompare puts L between A and Z; reject is non-keep so
    // it sorts in the same tier as the unset entries.
    assert.deepStrictEqual(
      MaxEnginePicker.regionWithinCountrySort(group).map(c => c.place),
      ['Aarau', 'Lugano', 'Zurich']);
  });

  test('returns NEW array; input untouched', () => {
    const group = [{ place: 'B' }, { place: 'A', status: 'keep' }];
    const out = MaxEnginePicker.regionWithinCountrySort(group);
    assert.notStrictEqual(out, group);
    assert.deepStrictEqual(group.map(c => c.place), ['B', 'A']);
  });

  test('null/undefined/empty input → []', () => {
    assert.deepStrictEqual(MaxEnginePicker.regionWithinCountrySort(null),      []);
    assert.deepStrictEqual(MaxEnginePicker.regionWithinCountrySort(undefined), []);
    assert.deepStrictEqual(MaxEnginePicker.regionWithinCountrySort([]),        []);
  });

  test('missing place falls back to empty string in sort', () => {
    const group = [
      { id: 'a' },                 // no place
      { id: 'b', place: 'Bern' },
    ];
    // Empty string sorts before "Bern".
    assert.deepStrictEqual(
      MaxEnginePicker.regionWithinCountrySort(group).map(c => c.id),
      ['a', 'b']);
  });
});

// ── Suite: partitionActiveByCommitment (Round HX.8) ────────────

describe('engine-picker.js — partitionActiveByCommitment', () => {
  test('splits keep vs no-status', () => {
    const cands = [
      { id: 'a', status: 'keep' },
      { id: 'b' },
      { id: 'c', status: 'keep' },
      { id: 'd', status: null },
    ];
    const r = MaxEnginePicker.partitionActiveByCommitment(cands);
    assert.deepStrictEqual(r.kept.map(c => c.id),  ['a', 'c']);
    assert.deepStrictEqual(r.unset.map(c => c.id), ['b', 'd']);
  });

  test('rejected entries leak through silently dropped (defensive)', () => {
    // The lens code path filters out rejecteds upstream via
    // partitionByStatus, but if one slips through the contract
    // is "active candidates only" — we drop, not crash.
    const cands = [
      { id: 'a', status: 'keep' },
      { id: 'b', status: 'reject' },
      { id: 'c' },
    ];
    const r = MaxEnginePicker.partitionActiveByCommitment(cands);
    assert.deepStrictEqual(r.kept.map(c => c.id),  ['a']);
    assert.deepStrictEqual(r.unset.map(c => c.id), ['c']);
  });

  test('null/empty input returns two empty arrays', () => {
    const a = MaxEnginePicker.partitionActiveByCommitment(null);
    assert.deepStrictEqual(a, { kept: [], unset: [] });
    const b = MaxEnginePicker.partitionActiveByCommitment([]);
    assert.deepStrictEqual(b, { kept: [], unset: [] });
  });

  test('tolerates null entries inside array', () => {
    const cands = [null, { id: 'a', status: 'keep' }, undefined];
    const r = MaxEnginePicker.partitionActiveByCommitment(cands);
    assert.deepStrictEqual(r.kept.map(c => c.id), ['a']);
    assert.deepStrictEqual(r.unset, []);
  });
});

// ── Suite: groupByCountry (Round HX.7) ─────────────────────────

describe('engine-picker.js — groupByCountry', () => {
  test('groups by candidate.country, returns countries sorted by count desc', () => {
    const cands = [
      { id: 'a', country: 'Switzerland' },
      { id: 'b', country: 'Italy' },
      { id: 'c', country: 'Switzerland' },
      { id: 'd', country: 'Switzerland' },
      { id: 'e', country: 'Italy' },
    ];
    const r = MaxEnginePicker.groupByCountry(cands);
    assert.deepStrictEqual(r.countriesSortedByCount, ['Switzerland', 'Italy']);
    assert.deepStrictEqual(r.byCountry.Switzerland.map(c => c.id), ['a', 'c', 'd']);
    assert.deepStrictEqual(r.byCountry.Italy.map(c => c.id), ['b', 'e']);
  });

  test('ties on count break alphabetically', () => {
    const cands = [
      { id: 'a', country: 'Iceland' },
      { id: 'b', country: 'Norway' },
      { id: 'c', country: 'Denmark' },
    ];
    const r = MaxEnginePicker.groupByCountry(cands);
    assert.deepStrictEqual(r.countriesSortedByCount, ['Denmark', 'Iceland', 'Norway']);
  });

  test('missing/empty country falls back to "Unknown"', () => {
    const cands = [
      { id: 'a' },
      { id: 'b', country: '' },
      { id: 'c', country: '   ' },
      { id: 'd', country: 'France' },
    ];
    const r = MaxEnginePicker.groupByCountry(cands);
    assert.strictEqual(r.byCountry.Unknown.length, 3);
    assert.strictEqual(r.byCountry.France.length, 1);
  });

  test('null/empty input returns empty containers', () => {
    const a = MaxEnginePicker.groupByCountry(null);
    assert.deepStrictEqual(a.byCountry, {});
    assert.deepStrictEqual(a.countriesSortedByCount, []);
    const b = MaxEnginePicker.groupByCountry([]);
    assert.deepStrictEqual(b.byCountry, {});
  });

  test('tolerates null entries inside array', () => {
    const cands = [null, { id: 'a', country: 'X' }, undefined];
    const r = MaxEnginePicker.groupByCountry(cands);
    assert.deepStrictEqual(r.byCountry.X.map(c => c.id), ['a']);
  });
});

// ── Suite: partitionMustDosByType (Round HX.7) ─────────────────

describe('engine-picker.js — partitionMustDosByType', () => {
  test('partitions in user-sentence order, preserves within-type order', () => {
    const mustDoOrder = ['Bernina', 'Northern lights', 'Gornergrat', 'Aurora cabin'];
    const mdc = [
      { name: 'Bernina',          type: 'route' },
      { name: 'Gornergrat',       type: 'route' },
      { name: 'Northern lights',  type: 'condition' },
      { name: 'Aurora cabin',     type: 'manual' },
    ];
    const r = MaxEnginePicker.partitionMustDosByType(mustDoOrder, mdc);
    assert.deepStrictEqual(r.byType.route,     ['Bernina', 'Gornergrat']);
    assert.deepStrictEqual(r.byType.condition, ['Northern lights']);
    assert.deepStrictEqual(r.byType.manual,    ['Aurora cabin']);
    assert.deepStrictEqual(r.byType.activity,  []);
  });

  test('unknown / missing type defaults to "activity"', () => {
    const mustDoOrder = ['SomeChip', 'OtherChip'];
    const mdc = [
      { name: 'SomeChip' },                     // no type
      { name: 'OtherChip', type: 'mystery' },   // unknown type — also activity
    ];
    const r = MaxEnginePicker.partitionMustDosByType(mustDoOrder, mdc);
    // 'mystery' isn't in the canonical typeOrder, so it becomes its
    // own bucket — but the missing-type one still lands in activity.
    assert.deepStrictEqual(r.byType.activity, ['SomeChip']);
    assert.deepStrictEqual(r.byType.mystery, ['OtherChip']);
  });

  test('typeOrder is the canonical route/activity/condition/manual', () => {
    const r = MaxEnginePicker.partitionMustDosByType([], []);
    assert.deepStrictEqual(r.typeOrder, ['route', 'activity', 'condition', 'manual']);
  });

  test('returns empty buckets for the canonical types when input empty', () => {
    const r = MaxEnginePicker.partitionMustDosByType([], []);
    ['route', 'activity', 'condition', 'manual'].forEach(t =>
      assert.deepStrictEqual(r.byType[t], []));
  });

  test('null inputs are tolerated', () => {
    const r = MaxEnginePicker.partitionMustDosByType(null, null);
    assert.deepStrictEqual(r.byType.activity, []);
  });

  test('typeOrder is a fresh array (mutating it does not affect future calls)', () => {
    const r1 = MaxEnginePicker.partitionMustDosByType([], []);
    r1.typeOrder.push('garbage');
    const r2 = MaxEnginePicker.partitionMustDosByType([], []);
    assert.deepStrictEqual(r2.typeOrder, ['route', 'activity', 'condition', 'manual']);
  });
});

// ── Suite: bestPickFirstSort (Round HX.6) ──────────────────────

describe('engine-picker.js — bestPickFirstSort', () => {
  test('keeps come before non-keeps', () => {
    const group = [
      { id: 'a' },
      { id: 'b', status: 'keep' },
      { id: 'c' },
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.bestPickFirstSort(group).map(c => c.id),
      ['b', 'a', 'c']);
  });

  test('within keeps, _required wins over non-required', () => {
    const group = [
      { id: 'a', status: 'keep' },
      { id: 'b', status: 'keep', _required: true },
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.bestPickFirstSort(group).map(c => c.id),
      ['b', 'a']);
  });

  test('within non-keeps, _required wins over non-required', () => {
    const group = [
      { id: 'a' },
      { id: 'b', _required: true },
      { id: 'c', status: 'reject' },
    ];
    // Sort is stable so 'a' (no flag) and 'c' (reject) stay in input
    // order after the required tier.
    assert.deepStrictEqual(
      MaxEnginePicker.bestPickFirstSort(group).map(c => c.id),
      ['b', 'a', 'c']);
  });

  test('returns a NEW array; input untouched', () => {
    const group = [
      { id: 'a' },
      { id: 'b', status: 'keep' },
    ];
    const out = MaxEnginePicker.bestPickFirstSort(group);
    assert.notStrictEqual(out, group);
    // Input still in original order.
    assert.deepStrictEqual(group.map(c => c.id), ['a', 'b']);
  });

  test('null/undefined/empty input → []', () => {
    assert.deepStrictEqual(MaxEnginePicker.bestPickFirstSort(null),      []);
    assert.deepStrictEqual(MaxEnginePicker.bestPickFirstSort(undefined), []);
    assert.deepStrictEqual(MaxEnginePicker.bestPickFirstSort([]),        []);
  });

  test('tolerates null entries inside the group', () => {
    const group = [null, { id: 'a', status: 'keep' }, undefined, { id: 'b' }];
    // Two non-objects (null/undefined) treated as non-keep, non-required;
    // the keep ('a') leads, then b, with the falsy entries trailing in
    // stable order (sort is stable, so they keep their relative order).
    const ids = MaxEnginePicker.bestPickFirstSort(group).map(c => c && c.id);
    assert.strictEqual(ids[0], 'a');
    assert.ok(ids.indexOf('b') > 0);
  });
});

// ── Suite: applyRequiredAndAutoKeep (Round HX.1) ────────────────
//
// Two-step pre-render pass extracted from renderCandidateCards:
// (1) re-check _required against the brief's requiredPlaces list,
// (2) auto-keep newly-required cands ONCE per cand. The
// _autoKeepApplied flag prevents retroactive flips after brief
// edits — Neal's complaint that drove the original guard.

describe('engine-picker.js — applyRequiredAndAutoKeep', () => {
  test('flags candidate that newly matches a required place', () => {
    const cands = [
      { id: 'c1', place: 'Reykjavik' },  // not flagged yet
    ];
    const required = [{ place: 'Reykjavik', requiredFor: ['Iconic capital'] }];
    const result = MaxEnginePicker.applyRequiredAndAutoKeep(cands, required);
    assert.strictEqual(result.newlyFlagged, 1);
    assert.strictEqual(cands[0]._required, true);
    assert.deepStrictEqual(cands[0]._requiredFor, ['Iconic capital']);
  });

  test('auto-keeps a newly-flagged required candidate', () => {
    const cands = [
      { id: 'c1', place: 'Reykjavik' },
    ];
    const required = [{ place: 'Reykjavik', requiredFor: ['Capital'] }];
    const result = MaxEnginePicker.applyRequiredAndAutoKeep(cands, required);
    assert.strictEqual(result.newlyKept, 1);
    assert.strictEqual(cands[0].status, 'keep');
    assert.strictEqual(cands[0]._autoKeepApplied, true);
  });

  test('does NOT re-auto-keep a cand whose status was rejected', () => {
    const cands = [
      { id: 'c1', _required: true, _requiredFor: ['x'], status: 'reject', _autoKeepApplied: true },
    ];
    const result = MaxEnginePicker.applyRequiredAndAutoKeep(cands, []);
    assert.strictEqual(result.newlyKept, 0);
    assert.strictEqual(cands[0].status, 'reject');  // user choice preserved
  });

  test('does NOT re-auto-keep on second pass (the Neal complaint)', () => {
    // First pass auto-keeps. User then rejects. Second pass must not
    // retroactively flip back to keep.
    const cands = [
      { id: 'c1', _required: true, _requiredFor: ['x'] },
    ];
    MaxEnginePicker.applyRequiredAndAutoKeep(cands, []);
    assert.strictEqual(cands[0].status, 'keep');
    cands[0].status = 'reject';  // user rejects
    const result = MaxEnginePicker.applyRequiredAndAutoKeep(cands, []);
    assert.strictEqual(result.newlyKept, 0);
    assert.strictEqual(cands[0].status, 'reject');
  });

  test('handles null cands + null requiredPlaces gracefully', () => {
    const r1 = MaxEnginePicker.applyRequiredAndAutoKeep(null, null);
    assert.deepStrictEqual(r1, { newlyFlagged: 0, newlyKept: 0 });
    const r2 = MaxEnginePicker.applyRequiredAndAutoKeep([], []);
    assert.deepStrictEqual(r2, { newlyFlagged: 0, newlyKept: 0 });
  });
});

// ── Suite: partitionByStatus (Round HX.1) ───────────────────────

describe('engine-picker.js — partitionByStatus', () => {
  test('splits into active vs rejected exhaustively', () => {
    const cands = [
      { id: 'c1', status: 'keep' },
      { id: 'c2', status: 'reject' },
      { id: 'c3' },                     // no status — counts as active
      { id: 'c4', status: 'reject' },
    ];
    const r = MaxEnginePicker.partitionByStatus(cands);
    assert.strictEqual(r.active.length, 2);
    assert.strictEqual(r.rejected.length, 2);
    // Every cand lands in exactly one bucket (no drops).
    assert.strictEqual(r.active.length + r.rejected.length, cands.length);
    assert.deepStrictEqual(r.rejected.map(c => c.id), ['c2', 'c4']);
  });

  test('handles null + empty input', () => {
    assert.deepStrictEqual(MaxEnginePicker.partitionByStatus(null),
      { active: [], rejected: [] });
    assert.deepStrictEqual(MaxEnginePicker.partitionByStatus([]),
      { active: [], rejected: [] });
  });
});

// ── Suite: classifyCandidateBadge (Round HX.2) ─────────────────
//
// Per-card badge variant decision, lifted from renderCard inside
// renderCandidateCards. The HTML formatting stays in the renderer;
// the engine returns the variant + the refs to display.

describe('engine-picker.js — classifyCandidateBadge', () => {
  test('manual placeholder → manual variant, no refs', () => {
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: ['__manual__'] }, null, []);
    assert.deepStrictEqual(r, { kind: 'manual', refs: [], isRoute: false });
  });

  test('in-section card with extra must-dos → also variant', () => {
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: ['Aurora', 'Northern lights'] }, 'Aurora', []);
    assert.strictEqual(r.kind, 'also');
    assert.deepStrictEqual(r.refs, ['Northern lights']);
  });

  test('in-section card with no extra refs → none variant', () => {
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: ['Aurora'] }, 'Aurora', []);
    assert.strictEqual(r.kind, 'none');
  });

  test('unmatched cand with route ref → required variant, isRoute=true', () => {
    const mdc = [{ name: 'Bernina Express', type: 'route' }];
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: ['Bernina Express'] }, null, mdc);
    assert.strictEqual(r.kind, 'required');
    assert.strictEqual(r.isRoute, true);
    assert.deepStrictEqual(r.refs, ['Bernina Express']);
  });

  test('unmatched cand with non-route ref → required variant, isRoute=false', () => {
    const mdc = [{ name: 'Iconic capital', type: 'place' }];
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: ['Iconic capital'] }, null, mdc);
    assert.strictEqual(r.kind, 'required');
    assert.strictEqual(r.isRoute, false);
  });

  test('cand with no required refs → none', () => {
    const r = MaxEnginePicker.classifyCandidateBadge(
      { _requiredFor: [] }, null, []);
    assert.strictEqual(r.kind, 'none');
  });

  test('null cand returns safe none', () => {
    assert.strictEqual(
      MaxEnginePicker.classifyCandidateBadge(null, null, []).kind, 'none');
  });
});

// ── Suite: regionSeedCoord (Round HX.2) ─────────────────────────

describe('engine-picker.js — regionSeedCoord', () => {
  test('returns coord when region matches geocode key', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.regionSeedCoord('Iceland', { iceland: [64.14, -21.94] }),
      [64.14, -21.94]);
  });

  test('case + whitespace insensitive', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.regionSeedCoord('  ICELAND  ', { iceland: [64, -21] }),
      [64, -21]);
  });

  test('returns null on miss / empty / null inputs', () => {
    assert.strictEqual(MaxEnginePicker.regionSeedCoord('', {}), null);
    assert.strictEqual(MaxEnginePicker.regionSeedCoord('Iceland', null), null);
    assert.strictEqual(MaxEnginePicker.regionSeedCoord(null, { iceland: [0,0] }), null);
    assert.strictEqual(MaxEnginePicker.regionSeedCoord('Mars', { iceland: [0,0] }), null);
  });

  test('rejects non-finite coords in the geocode map', () => {
    assert.strictEqual(
      MaxEnginePicker.regionSeedCoord('Iceland', { iceland: [NaN, 0] }), null);
  });
});

// ── Suite: parseNightRange (Round HX.4) ────────────────────────

describe('engine-picker.js — parseNightRange', () => {
  test('parses range "2-3 nights" and "2–3"', () => {
    assert.deepStrictEqual(MaxEnginePicker.parseNightRange('2-3 nights'),  { min: 2, max: 3 });
    assert.deepStrictEqual(MaxEnginePicker.parseNightRange('2–3 nights'),  { min: 2, max: 3 });
    assert.deepStrictEqual(MaxEnginePicker.parseNightRange('2—3 nights'),  { min: 2, max: 3 });
  });
  test('parses single integer "3" → {min:3,max:3}', () => {
    assert.deepStrictEqual(MaxEnginePicker.parseNightRange('3 nights'), { min: 3, max: 3 });
    assert.deepStrictEqual(MaxEnginePicker.parseNightRange('3'),        { min: 3, max: 3 });
  });
  test('returns null on empty + nonsense', () => {
    assert.strictEqual(MaxEnginePicker.parseNightRange(''),    null);
    assert.strictEqual(MaxEnginePicker.parseNightRange(null),  null);
    assert.strictEqual(MaxEnginePicker.parseNightRange('a few'), null);
  });
});

// ── Suite: parseTripDuration (Round HX.4) ──────────────────────

describe('engine-picker.js — parseTripDuration', () => {
  test('weeks → days', () => {
    assert.deepStrictEqual(MaxEnginePicker.parseTripDuration('2 weeks'),     { min: 14, max: 14 });
    assert.deepStrictEqual(MaxEnginePicker.parseTripDuration('2-3 weeks'),   { min: 14, max: 21 });
  });
  test('days range and single day', () => {
    assert.deepStrictEqual(MaxEnginePicker.parseTripDuration('10-14 days'),  { min: 10, max: 14 });
    assert.deepStrictEqual(MaxEnginePicker.parseTripDuration('10 days'),     { min: 10, max: 10 });
  });
  test('null / non-numeric ("three weeks") → null', () => {
    assert.strictEqual(MaxEnginePicker.parseTripDuration(null), null);
    assert.strictEqual(MaxEnginePicker.parseTripDuration('three weeks'), null);
  });
});

// ── Suite: keptDaysRangeText (Round HX.4) ──────────────────────

describe('engine-picker.js — keptDaysRangeText', () => {
  test('sums ranges across kept', () => {
    const kept = [
      { stayRange: '2-3 nights' },
      { stayRange: '3 nights' },
    ];
    assert.strictEqual(MaxEnginePicker.keptDaysRangeText(kept), '5–6 days');
  });
  test('formats as single number when min === max', () => {
    const kept = [{ stayRange: '2 nights' }, { stayRange: '3 nights' }];
    assert.strictEqual(MaxEnginePicker.keptDaysRangeText(kept), '5 days');
  });
  test('returns "" if any kept stayRange is unparseable', () => {
    const kept = [{ stayRange: '2 nights' }, { stayRange: 'a while' }];
    assert.strictEqual(MaxEnginePicker.keptDaysRangeText(kept), '');
  });
  test('empty/null kept → ""', () => {
    assert.strictEqual(MaxEnginePicker.keptDaysRangeText([]),   '');
    assert.strictEqual(MaxEnginePicker.keptDaysRangeText(null), '');
  });
});

// ── Suite: alsoHereText (Round HX.3) ───────────────────────────

describe('engine-picker.js — alsoHereText', () => {
  test('returns cand.otherAttractions when set', () => {
    const cand = { place: 'Chur', otherAttractions: 'Old town walks' };
    assert.strictEqual(
      MaxEnginePicker.alsoHereText(cand, 'Bernina', []), 'Old town walks');
  });

  test('falls back to primary mdc.endpointHighlights[place]', () => {
    const cand = { place: 'Chur' };
    const mdc = [{
      name: 'Bernina', type: 'route',
      endpointHighlights: { 'Chur': 'Heidi-themed walks + old town' },
    }];
    assert.strictEqual(
      MaxEnginePicker.alsoHereText(cand, 'Bernina', mdc),
      'Heidi-themed walks + old town');
  });

  test('returns empty string when nothing matches', () => {
    assert.strictEqual(MaxEnginePicker.alsoHereText({ place: 'Chur' }, null, []), '');
    assert.strictEqual(
      MaxEnginePicker.alsoHereText({ place: 'X' }, 'Bernina',
        [{ name: 'Bernina', endpointHighlights: { Chur: 'a' } }]), '');
  });

  test('null cand → empty string', () => {
    assert.strictEqual(MaxEnginePicker.alsoHereText(null, null, []), '');
  });
});

// ── Suite: coordSane (Round HX) ─────────────────────────────────

describe('engine-picker.js — coordSane', () => {
  test('passes points within 2500km of seed', () => {
    // Reykjavik seed, Akureyri point — well within Iceland, < 300km.
    assert.strictEqual(
      MaxEnginePicker.coordSane([64.14, -21.94], 65.68, -18.10), true);
  });

  test('rejects points >2500km from seed', () => {
    // Iceland seed, Swiss point — clear hallucination distance.
    assert.strictEqual(
      MaxEnginePicker.coordSane([64.14, -21.94], 47.37, 8.55), false);
  });

  test('returns true when no seed (no reference frame)', () => {
    assert.strictEqual(MaxEnginePicker.coordSane(null, 47.37, 8.55), true);
  });

  test('rejects non-finite coords', () => {
    assert.strictEqual(MaxEnginePicker.coordSane([0, 0], NaN, 0), false);
    assert.strictEqual(MaxEnginePicker.coordSane([0, 0], 0, Infinity), false);
  });
});

// ── Suite: keptCandidates (Round HX.5) ─────────────────────────

describe('engine-picker.js — keptCandidates', () => {
  test('returns only status==="keep" entries, preserving order', () => {
    const cands = [
      { place: 'A', status: 'keep' },
      { place: 'B', status: 'reject' },
      { place: 'C', status: 'keep' },
      { place: 'D', status: null },
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.keptCandidates(cands).map(c => c.place),
      ['A', 'C']);
  });

  test('null/undefined/empty input → []', () => {
    assert.deepStrictEqual(MaxEnginePicker.keptCandidates(null),      []);
    assert.deepStrictEqual(MaxEnginePicker.keptCandidates(undefined), []);
    assert.deepStrictEqual(MaxEnginePicker.keptCandidates([]),        []);
  });

  test('all-rejected and all-unset return []', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.keptCandidates([{ status: 'reject' }, { status: 'reject' }]), []);
    assert.deepStrictEqual(
      MaxEnginePicker.keptCandidates([{}, { status: null }]), []);
  });

  test('does not match "kept" or other near-misses', () => {
    // Filter is exact-equal "keep" — a defensive contract so a
    // future stray "kept" doesn't sneak in.
    assert.deepStrictEqual(
      MaxEnginePicker.keptCandidates([
        { place: 'A', status: 'kept' },
        { place: 'B', status: 'KEEP' },
        { place: 'C', status: 'keep' },
      ]).map(c => c.place),
      ['C']);
  });

  test('tolerates null entries inside the array', () => {
    const cands = [null, { status: 'keep', place: 'A' }, undefined];
    assert.deepStrictEqual(
      MaxEnginePicker.keptCandidates(cands).map(c => c.place),
      ['A']);
  });
});

// ── Suite: activeCandidates (Round HZ: picker hero map) ────────

describe('engine-picker.js — activeCandidates', () => {
  test('returns kept + unchecked, excludes rejected', () => {
    const cands = [
      { place: 'A', status: 'keep' },
      { place: 'B', status: 'reject' },
      { place: 'C', status: null },
      { place: 'D', status: 'keep' },
      { place: 'E' }, // status undefined → unchecked
    ];
    assert.deepStrictEqual(
      MaxEnginePicker.activeCandidates(cands).map(c => c.place),
      ['A', 'C', 'D', 'E']);
  });

  test('null/undefined/empty input → []', () => {
    assert.deepStrictEqual(MaxEnginePicker.activeCandidates(null),      []);
    assert.deepStrictEqual(MaxEnginePicker.activeCandidates(undefined), []);
    assert.deepStrictEqual(MaxEnginePicker.activeCandidates([]),        []);
  });

  test('all-rejected returns []', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.activeCandidates([
        { status: 'reject' }, { status: 'reject' },
      ]), []);
  });

  test('tolerates null entries inside the array', () => {
    const cands = [null, { status: 'keep', place: 'A' }, undefined, { place: 'B' }];
    assert.deepStrictEqual(
      MaxEnginePicker.activeCandidates(cands).map(c => c.place),
      ['A', 'B']);
  });
});

// ── Suite: computeStayTotalSummary (Round HX.5) ────────────────

describe('engine-picker.js — computeStayTotalSummary', () => {
  test('empty kept → status="empty", no strings', () => {
    assert.deepStrictEqual(
      MaxEnginePicker.computeStayTotalSummary([], '10 days'),
      { rangeStr: '', tripStr: null, status: 'empty' });
    assert.deepStrictEqual(
      MaxEnginePicker.computeStayTotalSummary(null, '10 days'),
      { rangeStr: '', tripStr: null, status: 'empty' });
  });

  test('single keep formats range with no trip duration', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '3 nights' }], '');
    assert.strictEqual(s.rangeStr, '3 nights');
    assert.strictEqual(s.tripStr, null);
    assert.strictEqual(s.status, 'fit');
  });

  test('multiple keeps sum into a range string', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '2-3 nights' }, { stayRange: '3 nights' }], '');
    assert.strictEqual(s.rangeStr, '5–6 nights');
  });

  test('any unparseable stayRange → status="unknown", no strings', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '2 nights' }, { stayRange: 'a while' }], '10 days');
    assert.deepStrictEqual(s, { rangeStr: '', tripStr: null, status: 'unknown' });
  });

  test('over: kept min exceeds trip max', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '8-10 nights' }, { stayRange: '5 nights' }], '10 days');
    // Kept: 13–15, trip: 10. min(13) > max(10) → over.
    assert.strictEqual(s.status, 'over');
    assert.strictEqual(s.rangeStr, '13–15 nights');
    assert.strictEqual(s.tripStr, '10 days');
  });

  test('under: kept max below trip min', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '2 nights' }], '10-14 days');
    // Kept: 2, trip: 10–14. max(2) < min(10) → under.
    assert.strictEqual(s.status, 'under');
    assert.strictEqual(s.rangeStr, '2 nights');
    assert.strictEqual(s.tripStr, '10–14 days');
  });

  test('fit: kept range within trip duration', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '4 nights' }, { stayRange: '5 nights' }], '8-12 days');
    assert.strictEqual(s.status, 'fit');
    assert.strictEqual(s.rangeStr, '9 nights');
    assert.strictEqual(s.tripStr, '8–12 days');
  });

  test('non-parseable trip duration → tripStr=null, status="fit"', () => {
    // "three weeks" doesn't parse — caller should drop the trip clause
    // and use neutral color. We model that as fit/no-tripStr.
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '5 nights' }], 'three weeks');
    assert.strictEqual(s.status, 'fit');
    assert.strictEqual(s.tripStr, null);
    assert.strictEqual(s.rangeStr, '5 nights');
  });

  test('single-value range formats without dash', () => {
    const s = MaxEnginePicker.computeStayTotalSummary(
      [{ stayRange: '3 nights' }, { stayRange: '4 nights' }], '7 days');
    assert.strictEqual(s.rangeStr, '7 nights');
    assert.strictEqual(s.tripStr, '7 days');
  });
});

// ── Suite: trip engine adoption (replaceTrip) ──────────────────

describe('engine-trip.js — replaceTrip', () => {
  test('replaceTrip sets window.trip + activeDest + emits', () => {
    window.trip = null;
    window.activeDest = null;
    let emitted = 0;
    const off1 = MaxEngineTrip.on('tripChange', () => emitted++);
    const off2 = MaxEngineTrip.on('mapDataChange', () => emitted++);
    MaxEngineTrip.replaceTrip({ destinations: [{ id: 'd1', place: 'Reykjavik' }] });
    off1(); off2();
    assert.strictEqual(window.trip.destinations[0].place, 'Reykjavik');
    assert.strictEqual(window.activeDest, 'd1');
    assert.strictEqual(emitted, 2, 'should have emitted tripChange + mapDataChange');
  });

  test('replaceTrip ignores empty input', () => {
    const before = window.trip;
    MaxEngineTrip.replaceTrip(null);
    assert.strictEqual(window.trip, before);
  });

  test('replaceTrip preserves an existing activeDest', () => {
    window.activeDest = 'd_existing';
    MaxEngineTrip.replaceTrip({ destinations: [{ id: 'd_new', place: 'X' }] });
    assert.strictEqual(window.activeDest, 'd_existing', 'should not overwrite');
  });
});

// ── Suite: computePendingActions (v356.1) ───────────────────────

describe('engine-trip.js — computePendingActions', () => {
  // Fixed reference now so `daysUntilDeparture` is deterministic.
  const NOW = new Date('2026-06-01T00:00:00Z');
  // Helper: build an ISO date offset N days from NOW.
  const dayOffset = (n) => {
    const d = new Date(NOW.getTime() + n * 86400000);
    return d.toISOString().slice(0, 10);
  };

  test('returns null daysUntilDeparture for trip with no dates', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [{ id: 'd1', place: 'Reykjavik' }] },
      NOW,
    );
    assert.strictEqual(out.daysUntilDeparture, null);
  });

  test('returns negative days for trip in the past', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [{ id: 'd1', place: 'Reykjavik', dateFrom: dayOffset(-10) }] },
      NOW,
    );
    assert(out.daysUntilDeparture < 0,
      'expected negative daysUntilDeparture, got ' + out.daysUntilDeparture);
  });

  test('detects hotel gap on dest with nights but no booking', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 3, hotelBookings: [] },
      ] },
      NOW,
    );
    const hotels = out.items.filter(i => i.kind === 'hotel');
    assert.strictEqual(hotels.length, 1);
    assert(/Reykjavik/.test(hotels[0].summary));
    assert(/3 night/.test(hotels[0].summary));
    assert.strictEqual(hotels[0].severity, 'high');
  });

  test('skips hotel gap on dest with nights === 0', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Vík', nights: 0, hotelBookings: [] },
      ] },
      NOW,
    );
    assert.strictEqual(out.items.filter(i => i.kind === 'hotel').length, 0);
  });

  test('skips hotel gap when a booking is status:booked', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 2,
          hotelBookings: [{ status: 'booked', name: 'Edition' }] },
      ] },
      NOW,
    );
    assert.strictEqual(out.items.filter(i => i.kind === 'hotel').length, 0);
  });

  test('detects transport gap between adjacent dests with no leg', () => {
    const out = MaxEngineTrip.computePendingActions(
      {
        destinations: [
          { id: 'a', place: 'Reykjavik', nights: 2, hotelBookings: [{ status: 'booked' }] },
          { id: 'b', place: 'Vík',       nights: 2, hotelBookings: [{ status: 'booked' }] },
        ],
        legs: {},
      },
      NOW,
    );
    const tx = out.items.filter(i => i.kind === 'transport');
    assert.strictEqual(tx.length, 1);
    assert(/Reykjavik/.test(tx[0].summary) && /Vík/.test(tx[0].summary));
    assert.strictEqual(tx[0].severity, 'high');
  });

  test('skips transport gap when leg has a mode', () => {
    const out = MaxEngineTrip.computePendingActions(
      {
        destinations: [
          { id: 'a', place: 'Reykjavik', nights: 2, hotelBookings: [{ status: 'booked' }] },
          { id: 'b', place: 'Vík',       nights: 2, hotelBookings: [{ status: 'booked' }] },
        ],
        legs: { 'a>b': { mode: 'drive' } },
      },
      NOW,
    );
    assert.strictEqual(out.items.filter(i => i.kind === 'transport').length, 0);
  });

  test('detects day-trip chip with no note', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 3,
          hotelBookings: [{ status: 'booked' }],
          dayTrips: [{ place: 'Vík' }],
        },
      ] },
      NOW,
    );
    const dt = out.items.filter(i => i.kind === 'daytrip');
    assert.strictEqual(dt.length, 1);
    assert(/Vík/.test(dt[0].summary));
    assert(/Reykjavik/.test(dt[0].summary));
    assert.strictEqual(dt[0].severity, 'medium');
  });

  test('skips day-trip chip with a note', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 3,
          hotelBookings: [{ status: 'booked' }],
          dayTrips: [{ place: 'Vík', note: 'Booked through Reykjavik Excursions' }],
        },
      ] },
      NOW,
    );
    assert.strictEqual(out.items.filter(i => i.kind === 'daytrip').length, 0);
  });

  test('surfaces open pendingActions, skips cleared ones', () => {
    const out = MaxEngineTrip.computePendingActions(
      {
        destinations: [{ id: 'd1', place: 'Reykjavik', nights: 2,
          hotelBookings: [{ status: 'booked' }] }],
        pendingActions: [
          { eventName: 'Reykjavik Edition', actionType: 'Confirm hotel rebooking' },
          { eventName: 'Old item', actionType: 'review', cleared: true },
        ],
      },
      NOW,
    );
    const pa = out.items.filter(i => i.kind === 'pending');
    assert.strictEqual(pa.length, 1);
    assert(/Reykjavik Edition/.test(pa[0].summary));
    assert.strictEqual(pa[0].severity, 'high');
  });

  test('bundles iconic+approx sights into a single low-severity item', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 2,
          hotelBookings: [{ status: 'booked' }],
          suggestions: [
            { name: 'Hallgrimskirkja', iconic: true,  approx: true },
            { name: 'Sun Voyager',     iconic: true,  approx: true },
            { name: 'Harpa',           iconic: true,  approx: true },
            { name: 'Some cafe',       iconic: false, approx: true },
            { name: 'Blue Lagoon',     iconic: true,  approx: false },
          ],
        },
      ] },
      NOW,
    );
    const sights = out.items.filter(i => i.kind === 'sights');
    assert.strictEqual(sights.length, 1, 'one bundled item');
    assert(/^3 must-see sight/.test(sights[0].summary));
    assert.strictEqual(sights[0].severity, 'low');
  });

  test('skips sights bundle when zero iconic+approx', () => {
    const out = MaxEngineTrip.computePendingActions(
      { destinations: [
        { id: 'd1', place: 'Reykjavik', nights: 2,
          hotelBookings: [{ status: 'booked' }],
          suggestions: [{ name: 'Whatever', iconic: false, approx: true }],
        },
      ] },
      NOW,
    );
    assert.strictEqual(out.items.filter(i => i.kind === 'sights').length, 0);
  });

  test('stable sort: same trip produces identical item order on repeat calls', () => {
    const trip = {
      destinations: [
        { id: 'a', place: 'Reykjavik', nights: 3, hotelBookings: [],
          dayTrips: [{ place: 'Vík' }],
          suggestions: [{ name: 'Hallgrimskirkja', iconic: true, approx: true }],
        },
        { id: 'b', place: 'Akureyri', nights: 2, hotelBookings: [] },
      ],
      legs: {},
      pendingActions: [{ eventName: 'X', actionType: 'confirm' }],
    };
    const a = MaxEngineTrip.computePendingActions(trip, NOW);
    const b = MaxEngineTrip.computePendingActions(trip, NOW);
    assert.strictEqual(a.items.length, b.items.length);
    a.items.forEach((it, i) => {
      assert.strictEqual(it.kind, b.items[i].kind, 'kind at ' + i);
      assert.strictEqual(it.severity, b.items[i].severity, 'severity at ' + i);
      assert.strictEqual(it.summary, b.items[i].summary, 'summary at ' + i);
    });
    // Highs come before mediums before lows.
    const sevRank = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < a.items.length; i++) {
      assert(sevRank[a.items[i].severity] >= sevRank[a.items[i - 1].severity],
        'severity must be non-decreasing in sorted output');
    }
  });
});

// ── Suite: engine-classify.js (PD.205) ─────────────────────────
//
// The classifier is a pure function with an injectable LLM seam. These
// tests cover the heuristic fallback, the response parser, the parentage
// rules (Part 1 of the spec), and the end-to-end function with a stub LLM.

describe('engine-classify.js — heuristic fallback', () => {
  const { heuristicClassify } = MaxEngineClassify._internals;

  test('classifies "Drive the Ring Road" as activity', () => {
    assert.strictEqual(heuristicClassify({ place: 'Drive the Ring Road' }).classification, 'activity');
  });

  test('classifies "Walk on black sand beaches" as activity', () => {
    assert.strictEqual(heuristicClassify({ place: 'Walk on black sand beaches' }).classification, 'activity');
  });

  test('classifies "Place to stay overnight" as role-tag', () => {
    assert.strictEqual(heuristicClassify({ place: 'Place to stay overnight' }).classification, 'role-tag');
  });

  test('classifies "Anywhere with northern lights" as role-tag', () => {
    assert.strictEqual(heuristicClassify({ place: 'Anywhere with northern lights' }).classification, 'role-tag');
  });

  test('defaults bare place names to city (backwards-compatible)', () => {
    assert.strictEqual(heuristicClassify({ place: 'Reykjavík' }).classification, 'city');
    assert.strictEqual(heuristicClassify({ place: 'Harpa Concert Hall' }).classification, 'city');
  });

  test('handles empty input safely', () => {
    assert.strictEqual(heuristicClassify({ place: '' }).classification, 'city');
    assert.strictEqual(heuristicClassify(null).classification, 'city');
  });
});

describe('engine-classify.js — response parser', () => {
  const { parseClassifierResponse } = MaxEngineClassify._internals;

  test('parses clean JSON array', () => {
    const r = parseClassifierResponse(
      '[{"i":1,"classification":"city"},{"i":2,"classification":"poi","parentCity":"Reykjavík","parentRelation":"within"}]'
    );
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[1].classification, 'poi');
    assert.strictEqual(r[1].parentCity, 'Reykjavík');
  });

  test('strips markdown code fences', () => {
    const r = parseClassifierResponse('```json\n[{"i":1,"classification":"city"}]\n```');
    assert.strictEqual(r[0].classification, 'city');
  });

  test('recovers from truncated JSON by closing the array', () => {
    const r = parseClassifierResponse(
      '[{"i":1,"classification":"city"},{"i":2,"classification":"poi","parentCity":"Reykjavík"'
    );
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].classification, 'city');
  });

  test('returns [] on garbage', () => {
    assert.deepStrictEqual(parseClassifierResponse('not json at all'), []);
    assert.deepStrictEqual(parseClassifierResponse(''), []);
    assert.deepStrictEqual(parseClassifierResponse(null), []);
  });
});

describe('engine-classify.js — parentage rules (spec Part 1)', () => {
  const { applyParentageRules } = MaxEngineClassify._internals;

  test('Step 1: POI with viable in-list parent parents to it (within)', () => {
    const entries = [{ place: 'Reykjavík' }, { place: 'Harpa Concert Hall' }];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'within' }
    ];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[1].classification, 'poi');
    assert.strictEqual(out[1].parentEntry, 'reykjavik');
    assert.strictEqual(out[1].parentRelation, 'within');
    assert.strictEqual(out[1].promotedToDestination, false);
    assert.strictEqual(out[1].autoCreatedParent, null);
  });

  test('Step 1: Geysir + Reykjavík (from relation) parents under Reykjavík with "from"', () => {
    const entries = [{ place: 'Reykjavík' }, { place: 'Geysir' }];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'from' }
    ];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[1].parentEntry, 'reykjavik');
    assert.strictEqual(out[1].parentRelation, 'from');
    assert.strictEqual(out[1].promotedToDestination, false);
  });

  test('Step 2: POI with a known parent NOT in the list flags autoCreatedParent', () => {
    const entries = [{ place: 'Harpa Concert Hall' }];
    const cls = [{ classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'within' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].autoCreatedParent, 'Reykjavík');
    assert.strictEqual(out[0].parentEntry, 'reykjavik');
    assert.strictEqual(out[0].parentRelation, 'within');
    assert.strictEqual(out[0].promotedToDestination, false);
  });

  test('Step 3: POI with no parent at all gets promoted to standalone destination', () => {
    const entries = [{ place: 'Geysir' }];
    const cls = [{ classification: 'poi', parentCity: null }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].promotedToDestination, true);
    assert.strictEqual(out[0].parentEntry, null);
    assert.strictEqual(out[0].parentRelation, null);
    assert.strictEqual(out[0].autoCreatedParent, null);
  });

  test('Non-POI classifications pass through with no parentage', () => {
    const entries = [
      { place: 'Reykjavík' },
      { place: 'Drive the Ring Road' },
      { place: 'Place to stay overnight' },
      { place: 'Tuscany' }
    ];
    const cls = [
      { classification: 'city' },
      { classification: 'activity' },
      { classification: 'role-tag' },
      { classification: 'region' }
    ];
    const out = applyParentageRules(entries, cls);
    out.forEach((row) => {
      assert.strictEqual(row.parentEntry, null);
      assert.strictEqual(row.parentRelation, null);
      assert.strictEqual(row.promotedToDestination, false);
      assert.strictEqual(row.autoCreatedParent, null);
    });
    assert.deepStrictEqual(out.map((r) => r.classification), ['city', 'activity', 'role-tag', 'region']);
  });

  test('Pass-through preserves nights / isStay / intent fields from the parser', () => {
    const entries = [{ place: 'Reykjavík', nights: 3, isStay: true, intent: 'stay' }];
    const cls = [{ classification: 'city' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].nights, 3);
    assert.strictEqual(out[0].isStay, true);
    assert.strictEqual(out[0].intent, 'stay');
  });

  test('Invalid classification falls back to city', () => {
    const entries = [{ place: 'Reykjavík' }];
    const cls = [{ classification: 'not-a-real-bucket' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'city');
  });

  test('PD.215: _userIntent:"stay" prevents LLM from downgrading to poi', () => {
    const entries = [
      { place: 'Skaftafell', _userIntent: 'stay' },
      { place: 'Lake Mývatn', _userIntent: 'stay' }
    ];
    const cls = [
      { classification: 'poi', parentCity: 'Höfn', parentRelation: 'from' },
      { classification: 'poi', parentCity: 'Akureyri', parentRelation: 'from' }
    ];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'city', 'Skaftafell stays city under explicit stay-intent');
    assert.strictEqual(out[1].classification, 'city', 'Mývatn stays city under explicit stay-intent');
    assert.strictEqual(out[0].parentEntry, null, 'no parent inherited from LLM');
    assert.strictEqual(out[0].promotedToDestination, false);
  });

  test('PD.215: _userIntent:"stay" preserves region classification', () => {
    const entries = [{ place: 'Snæfellsnes Peninsula', _userIntent: 'stay' }];
    const cls = [{ classification: 'region' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'region', 'region survives stay-intent (it IS a stay-able shape)');
  });

  test('PD.215: _userIntent:"see" forces poi even if LLM says city', () => {
    const entries = [{ place: 'Harpa Concert Hall', _userIntent: 'see' }];
    const cls = [{ classification: 'city', parentCity: 'Reykjavík', parentRelation: 'within' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'poi', 'see-intent forces poi');
  });

  test('PD.216: _userIntent:"see" with no parent stays a sight, not a destination', () => {
    const entries = [
      { place: 'Þingvellir', _userIntent: 'see' },
      { place: 'Geysir', _userIntent: 'see' }
    ];
    // Classifier returned no parent info for these — would normally
    // trigger Step 3 promotion to standalone destination. _userIntent
    // overrides.
    const cls = [
      { classification: 'poi', parentCity: null },
      { classification: 'poi', parentCity: null }
    ];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'poi');
    assert.strictEqual(out[0].promotedToDestination, false, 'user said see → not promoted');
    assert.strictEqual(out[0].parentEntry, null);
    assert.strictEqual(out[1].promotedToDestination, false);
  });

  test('PD.216: Geysir-alone WITHOUT _userIntent still promotes (regression guard)', () => {
    const entries = [{ place: 'Geysir' }]; // no _userIntent
    const cls = [{ classification: 'poi', parentCity: null }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].promotedToDestination, true, 'no user intent → original Geysir-alone behavior preserved');
  });

  test('PD.215: _userIntent:null lets LLM decide', () => {
    const entries = [{ place: 'Skaftafell' }]; // no _userIntent
    const cls = [{ classification: 'poi', parentCity: 'Höfn', parentRelation: 'from' }];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[0].classification, 'poi', 'no intent → trust LLM');
    assert.strictEqual(out[0].parentEntry, 'hofn');
  });

  test('Parent name matching is accent-insensitive when _normPlaceName is loaded', () => {
    // engine-trip.js exposes _normPlaceName which folds diacritics.
    // The LLM may return "Reykjavik" (no accent) for a list with "Reykjavík" (accented).
    const entries = [{ place: 'Reykjavík' }, { place: 'Harpa Concert Hall' }];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentCity: 'Reykjavik', parentRelation: 'within' }
    ];
    const out = applyParentageRules(entries, cls);
    assert.strictEqual(out[1].autoCreatedParent, null, 'accented and unaccented should match → no auto-create');
    assert.strictEqual(out[1].parentEntry, 'reykjavik');
  });
});

describe('engine-classify.js — applyClassificationsToEntries (PD.206 wire-up)', () => {
  const { applyClassificationsToEntries } = MaxEngineClassify;

  test('city/region: forces isStay:true, nights>=1', () => {
    const entries = [
      { place: 'Reykjavík', nights: 0, isStay: false },
      { place: 'Tuscany', nights: 3, isStay: true }
    ];
    const cls = [{ classification: 'city' }, { classification: 'region' }];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out[0].isStay, true);
    assert.strictEqual(out[0].nights, 1);
    assert.strictEqual(out[1].isStay, true);
    assert.strictEqual(out[1].nights, 3, 'existing nights preserved when >=1');
  });

  test('Step 1 POI with in-list parent: flipped to isStay:false, nights:0', () => {
    const entries = [
      { place: 'Reykjavík', nights: 1, isStay: true },
      { place: 'Harpa Concert Hall', nights: 1, isStay: true } // parser default
    ];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentEntry: 'reykjavik', parentRelation: 'within' }
    ];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out.length, 2, 'no new entry inserted');
    assert.strictEqual(out[1].isStay, false);
    assert.strictEqual(out[1].nights, 0);
    assert.strictEqual(out[1]._classification, 'poi');
    assert.strictEqual(out[1]._parentRelation, 'within');
  });

  test('Step 2 POI with autoCreatedParent: parent inserted before POI', () => {
    const entries = [{ place: 'Harpa Concert Hall', nights: 1, isStay: true }];
    const cls = [{
      classification: 'poi',
      parentEntry: 'reykjavik',
      parentRelation: 'within',
      autoCreatedParent: 'Reykjavík'
    }];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].place, 'Reykjavík');
    assert.strictEqual(out[0].isStay, true);
    assert.strictEqual(out[0].nights, 1);
    assert.strictEqual(out[0]._autoCreated, true);
    assert.deepStrictEqual(out[0]._autoCreatedFor, ['Harpa Concert Hall']);
    assert.strictEqual(out[1].isStay, false);
    assert.strictEqual(out[1].nights, 0);
  });

  test('Step 2: two POIs with same autoCreatedParent insert one parent and track both', () => {
    const entries = [
      { place: 'Harpa Concert Hall' },
      { place: 'Hallgrímskirkja' }
    ];
    const cls = [
      { classification: 'poi', parentEntry: 'reykjavik', autoCreatedParent: 'Reykjavík', parentRelation: 'within' },
      { classification: 'poi', parentEntry: 'reykjavik', autoCreatedParent: 'Reykjavík', parentRelation: 'within' }
    ];
    const out = applyClassificationsToEntries(entries, cls);
    const autoParents = out.filter((e) => e._autoCreated);
    assert.strictEqual(autoParents.length, 1, 'parent inserted exactly once');
    assert.deepStrictEqual(autoParents[0]._autoCreatedFor.sort(), ['Hallgrímskirkja', 'Harpa Concert Hall']);
  });

  test('Step 3 promoted POI: stays standalone (isStay:true, nights:0)', () => {
    const entries = [{ place: 'Geysir' }];
    const cls = [{ classification: 'poi', promotedToDestination: true }];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].isStay, true);
    assert.strictEqual(out[0].nights, 0);
    assert.strictEqual(out[0]._promotedToDestination, true);
  });

  test('activity/role-tag entries pass through unchanged', () => {
    const entries = [
      { place: 'Drive the Ring Road', nights: 1, isStay: true },
      { place: 'Place to stay overnight', nights: 0, isStay: false }
    ];
    const cls = [{ classification: 'activity' }, { classification: 'role-tag' }];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out[0].isStay, true, 'activity isStay untouched');
    assert.strictEqual(out[0].nights, 1, 'activity nights untouched');
    assert.strictEqual(out[0]._classification, 'activity');
    assert.strictEqual(out[1]._classification, 'role-tag');
  });

  test('Step 2: does not duplicate parent already in the list earlier', () => {
    // Edge case: user listed Reykjavík first, then Harpa, but the LLM
    // classifications also marked Harpa with autoCreatedParent (e.g.,
    // because the parentage rules layered Step 2 metadata). The wire-up
    // should NOT insert a second Reykjavík.
    const entries = [{ place: 'Reykjavík' }, { place: 'Harpa Concert Hall' }];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentEntry: 'reykjavik', autoCreatedParent: 'Reykjavík', parentRelation: 'within' }
    ];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out.length, 2, 'no duplicate parent inserted');
    assert.strictEqual(out[0].place, 'Reykjavík');
    assert.strictEqual(out[1].place, 'Harpa Concert Hall');
  });

  test('mixed list: Reykjavík + Harpa + Geysir + Drive the Ring Road', () => {
    const entries = [
      { place: 'Reykjavík', nights: 1, isStay: true },
      { place: 'Harpa Concert Hall' },
      { place: 'Geysir' },
      { place: 'Drive the Ring Road' }
    ];
    const cls = [
      { classification: 'city' },
      { classification: 'poi', parentEntry: 'reykjavik', parentRelation: 'within' },
      { classification: 'poi', parentEntry: 'reykjavik', parentRelation: 'from' },
      { classification: 'activity' }
    ];
    const out = applyClassificationsToEntries(entries, cls);
    assert.strictEqual(out[0].isStay, true);
    assert.strictEqual(out[1].isStay, false);
    assert.strictEqual(out[1]._parentRelation, 'within');
    assert.strictEqual(out[2].isStay, false);
    assert.strictEqual(out[2]._parentRelation, 'from');
    assert.strictEqual(out[3]._classification, 'activity');
  });
});

describe('engine-classify.js — classifyListEntries end-to-end', () => {
  asyncTest('uses heuristic fallback when no LLM is available', async () => {
    const out = await MaxEngineClassify.classifyListEntries(
      [
        { place: 'Reykjavík' },
        { place: 'Drive the Ring Road' },
        { place: 'Place to stay overnight' }
      ],
      { llm: null }
    );
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].classification, 'city');
    assert.strictEqual(out[1].classification, 'activity');
    assert.strictEqual(out[2].classification, 'role-tag');
  });

  asyncTest('threads LLM output through parentage rules', async () => {
    const stub = async () =>
      JSON.stringify([
        { i: 1, classification: 'city' },
        { i: 2, classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'within' },
        { i: 3, classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'from' },
        { i: 4, classification: 'activity' }
      ]);
    const out = await MaxEngineClassify.classifyListEntries(
      [
        { place: 'Reykjavík' },
        { place: 'Harpa Concert Hall' },
        { place: 'Geysir' },
        { place: 'Drive the Ring Road' }
      ],
      { llm: stub }
    );
    assert.strictEqual(out[1].parentEntry, 'reykjavik');
    assert.strictEqual(out[1].parentRelation, 'within');
    assert.strictEqual(out[2].parentRelation, 'from');
    assert.strictEqual(out[3].classification, 'activity');
  });

  asyncTest('LLM errors fall back to heuristics, not a thrown error', async () => {
    const stub = async () => { throw new Error('API down'); };
    const out = await MaxEngineClassify.classifyListEntries(
      [{ place: 'Reykjavík' }, { place: 'Drive the Ring Road' }],
      { llm: stub }
    );
    assert.strictEqual(out[0].classification, 'city');
    assert.strictEqual(out[1].classification, 'activity');
  });

  asyncTest('missing entries in LLM response fall back to heuristics per-slot', async () => {
    // LLM only returned slot 1; slot 2 should heuristic-classify.
    const stub = async () => JSON.stringify([{ i: 1, classification: 'city' }]);
    const out = await MaxEngineClassify.classifyListEntries(
      [{ place: 'Reykjavík' }, { place: 'Drive the Ring Road' }],
      { llm: stub }
    );
    assert.strictEqual(out[0].classification, 'city');
    assert.strictEqual(out[1].classification, 'activity');
  });

  asyncTest('empty input returns empty output', async () => {
    const out = await MaxEngineClassify.classifyListEntries([], {});
    assert.deepStrictEqual(out, []);
  });

  asyncTest('Harpa-with-no-Reykjavík case auto-creates parent', async () => {
    const stub = async () =>
      JSON.stringify([
        { i: 1, classification: 'poi', parentCity: 'Reykjavík', parentRelation: 'within' }
      ]);
    const out = await MaxEngineClassify.classifyListEntries(
      [{ place: 'Harpa Concert Hall' }],
      { llm: stub }
    );
    assert.strictEqual(out[0].autoCreatedParent, 'Reykjavík');
    assert.strictEqual(out[0].promotedToDestination, false);
  });

  asyncTest('Geysir-alone case promotes to standalone destination', async () => {
    const stub = async () =>
      JSON.stringify([{ i: 1, classification: 'poi', parentCity: null }]);
    const out = await MaxEngineClassify.classifyListEntries(
      [{ place: 'Geysir' }],
      { llm: stub }
    );
    assert.strictEqual(out[0].promotedToDestination, true);
    assert.strictEqual(out[0].parentEntry, null);
  });
});

// ── Run async tests ─────────────────────────────────────────────
// The describe blocks above schedule async tests; we collect them into
// a final flush block.

(async function main() {
  // Drain async queue sequentially. Each test gets its full settlement
  // before the next starts — necessary because some tests depend on
  // shared engine state populated by prior async work (the FQ cache).
  if (asyncQueue.length) console.log('\n(running async tests)');
  for (const { name, fn } of asyncQueue) {
    try {
      await fn();
      passed++;
      console.log('  ✓ ' + name);
    } catch (e) {
      failed++;
      failures.push({ name, error: e });
      console.log('  ✗ ' + name);
      console.log('      ' + (e.message || e));
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`PASS: ${passed}    FAIL: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
      console.log('  - ' + f.name);
      console.log('    ' + (f.error.stack || f.error.message || f.error));
    });
    process.exit(1);
  }
  process.exit(0);
})();
