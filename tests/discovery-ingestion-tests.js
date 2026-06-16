// tests/discovery-ingestion-tests.js — SSOT Phase 2: the ONE ingestion.
//
// Pins the IngestionService contract: trip → DiscoveryModel through a single
// pipeline that unifies placeActivities with the legacy dest.suggestions pool
// and applies one set of stay/destination/hub opts. Every count surface
// delegates here, so they cannot derive different sets.

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.mjs").default;
require("../section-kind.mjs").default;        // global.SectionKind
require("../discovery-model.js");     // global.MaxDiscovery
require("../max-data.js");            // global.MaxData
var ING = require("../discovery-ingestion.js"); // global.MaxIngestion
var MaxData = global.MaxData;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}
function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

console.log("\ndiscovery-ingestion — the ONE ingestion (Phase 2)\n");

// Fixture: themed + "Sights near" catch-all + a stay, plus a legacy
// dest.suggestions._considered pool that lives ONLY on the destinations.
function makeTrip() {
  return {
    destinations: [
      { id: "d1", place: "Reykjavik", lat: 64.14, lng: -21.90, suggestions: [
        { name: "Grótta Lighthouse", _considered: true, lat: 64.16, lng: -22.02 },
        { name: "Viðey Island", _considered: true, lat: 64.16, lng: -21.85 }
      ] },
      { id: "d2", place: "Vik", lat: 63.42, lng: -19.00, suggestions: [
        { name: "Reynisfjara Beach", _considered: false } // not considered
      ] }
    ],
    placeActivities: [
      { id: "s1", type: "activity", section: "Overnight stays",
        requiredPlaces: [ { place: "Reykjavik", _keep: true } ] },
      { id: "t1", type: "activity", section: "See natural wonders",
        requiredPlaces: [
          { place: "Gullfoss", _keep: true,  lat: 64.30, lng: -20.10 },   // committed
          { place: "Geysir",   _keep: false, lat: 64.31, lng: -20.30 }    // considered
        ] },
      { id: "n1", type: "activity", section: "Sights near places you listed",
        requiredPlaces: [
          { place: "Kerið Crater", _keep: false, lat: 64.04, lng: -20.90 },
          { place: "Þingvellir",   _keep: false, lat: 64.25, lng: -21.10 }
        ] }
    ]
  };
}

test("MaxIngestion.buildModel returns a DiscoveryModel", function () {
  var m = ING.buildModel(makeTrip());
  assert.ok(m && typeof m.considered === "function" && typeof m.sections === "function");
});

test("the ingestion UNIFIES the pools: folded legacy suggestions are considered", function () {
  var keys = Object.keys(ING.buildModel(makeTrip()).consideredKeyedSet());
  // 2 themed/near considered (Geysir, Kerið, Þingvellir = 3) + 2 folded legacy (Grótta, Viðey)
  var names = keys.map(norm);
  ["geysir", "kerið crater", "þingvellir", "grótta lighthouse", "viðey island"].forEach(function (n) {
    assert.ok(names.some(function (k) { return k.indexOf(n) !== -1; }), "missing considered: " + n);
  });
  assert.strictEqual(keys.length, 5, "expected 5 unified considered sights, got " + keys.length);
});

test("MaxData.consideredPlaceKeys delegates to the ingestion (identical set)", function () {
  var trip = makeTrip();
  var viaData = Object.keys(MaxData.consideredPlaceKeys(trip)).sort();
  var viaIng = Object.keys(ING.buildModel(trip).consideredKeyedSet()).sort();
  assert.deepStrictEqual(viaData, viaIng, "MaxData and the ingestion service produced different considered sets");
});

test("committed/stay/destination are excluded by the one opts", function () {
  var m = ING.buildModel(makeTrip());
  var considered = m.considered().map(function (p) { return norm(p.place); });
  assert.ok(considered.indexOf("gullfoss") === -1, "Gullfoss is committed (checked), not considered");
  assert.ok(considered.indexOf("reykjavik") === -1, "Reykjavik is a destination/stay, not considered");
});

test("unifiedPlaceActivities is idempotent (re-folding adds nothing)", function () {
  var trip = makeTrip();
  var once = ING.unifiedPlaceActivities(trip);
  var trip2 = Object.assign({}, trip, { placeActivities: once });
  var twice = ING.unifiedPlaceActivities(trip2);
  function count(pa) { return pa.reduce(function (n, it) { return n + ((it.requiredPlaces || []).length); }, 0); }
  assert.strictEqual(count(twice), count(once), "re-folding grew the set: " + count(once) + " -> " + count(twice));
});

test("buildModel(null) returns an empty model (no throw)", function () {
  var m = ING.buildModel(null);
  assert.ok(m && m.considered().length === 0);
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
