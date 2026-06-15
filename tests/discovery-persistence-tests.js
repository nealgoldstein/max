// tests/discovery-persistence-tests.js — SSOT Phase 3: the persistence seam.
//
// Pins: (1) writeModelToTrip is the clean inverse of the ingestion (round-trip
// preserves the considered set AND the stays/routes passthrough the model
// doesn't own); (2) the event→debounced-save pump fires once per quiet window
// and stops on unbind.

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.js");
require("../section-kind.js");        // global.SectionKind
require("../discovery-model.js");     // global.MaxDiscovery
require("../max-data.js");            // global.MaxData
require("../discovery-ingestion.js"); // global.MaxIngestion
var P = require("../discovery-persistence.js"); // global.MaxPersistence
var ING = global.MaxIngestion;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}
function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

console.log("\ndiscovery-persistence — the persistence seam (Phase 3)\n");

function makeTrip() {
  return {
    destinations: [{ id: "d1", place: "Reykjavik", lat: 64.14, lng: -21.90, suggestions: [] }],
    placeActivities: [
      { id: "s1", type: "activity", section: "Overnight stays", name: "Stays",
        requiredPlaces: [{ place: "Reykjavik", _keep: true }] },                    // stay (passthrough)
      { id: "r1", type: "route", section: "Drive scenic routes", name: "Routes",
        requiredPlaces: [{ place: "Golden Circle", _keep: true }] },                // route (passthrough)
      { id: "t1", type: "activity", section: "See natural wonders", name: "Wonders",
        requiredPlaces: [
          { place: "Gullfoss", _keep: true,  lat: 64.30, lng: -20.10 },
          { place: "Geysir",   _keep: false, lat: 64.31, lng: -20.30 }
        ] }
    ]
  };
}

test("writeModelToTrip preserves the stays/routes passthrough the model doesn't own", function () {
  var trip = makeTrip();
  P.writeModelToTrip(trip, ING.buildModel(trip));
  var sections = trip.placeActivities.map(function (it) { return it.section; });
  assert.ok(sections.indexOf("Overnight stays") !== -1, "stay section dropped");
  assert.ok(sections.indexOf("Drive scenic routes") !== -1, "route section dropped");
});

test("round-trip: ingest → writeModelToTrip → re-ingest preserves the considered set", function () {
  var trip = makeTrip();
  var before = Object.keys(ING.buildModel(trip).consideredKeyedSet()).map(norm).sort();
  P.writeModelToTrip(trip, ING.buildModel(trip));
  var after = Object.keys(ING.buildModel(trip).consideredKeyedSet()).map(norm).sort();
  assert.deepStrictEqual(after, before, "considered set changed across a model→trip→model round-trip");
});

test("writeModelToTrip is idempotent (re-writing the same model doesn't grow the set)", function () {
  var trip = makeTrip();
  function count(t) { return t.placeActivities.reduce(function (a, it) { return a + (it.requiredPlaces || []).length; }, 0); }
  P.writeModelToTrip(trip, ING.buildModel(trip));
  var n1 = count(trip);
  P.writeModelToTrip(trip, ING.buildModel(trip));
  assert.strictEqual(count(trip), n1, "place count grew: " + n1 + " -> " + count(trip));
});

test("writeModelToTrip PRESERVES rejected places (reject must not make a place vanish)", function () {
  var trip = makeTrip();
  var model = ING.buildModel(trip);
  model.setDecision("Geysir", "rejected");   // user rejects a considered sight
  P.writeModelToTrip(trip, model);
  // Geysir must still be in the persisted array (flagged rejected)...
  var found = false;
  trip.placeActivities.forEach(function (it) {
    (it.requiredPlaces || []).forEach(function (p) {
      if (p && /geysir/i.test(p.place)) { found = true; assert.strictEqual(p._rejected, true, "rejected flag lost"); }
    });
  });
  assert.ok(found, "rejected place was dropped from storage (Round DX violation)");
  // ...but it round-trips back as rejected and is NOT considered.
  var m2 = ING.buildModel(trip);
  assert.ok(Object.keys(m2.consideredKeyedSet()).every(function (k) { return !/geysir/.test(k); }),
    "a rejected place reappeared in the considered set");
});

// ── the event → debounced save pump (async) ──────────────────────────
function runAsyncThenFinish() {
  var DM = global.MaxDiscovery.DiscoveryModel;
  var m = new DM();
  var saves = 0, lastArg = null;
  var unbind = P.bind(m, function (model) { saves++; lastArg = model; }, 30);
  m.upsert({ place: "A", decision: "unchecked" });
  m.upsert({ place: "B", decision: "unchecked" });
  m.setDecision("A", "checked"); // 3 rapid changes → 1 debounced save
  setTimeout(function () {
    test("bind(): rapid mutations debounce into ONE save", function () {
      assert.strictEqual(saves, 1, "expected exactly one debounced save, got " + saves);
      assert.strictEqual(lastArg, m, "save received the model");
    });
    unbind();
    m.setDecision("B", "checked"); // after unbind → no save
    setTimeout(function () {
      test("bind(): unbind stops further saves", function () {
        assert.strictEqual(saves, 1, "a save fired after unbind");
      });
      console.log("\n" + "─".repeat(50));
      console.log("PASS: " + pass + "    FAIL: " + fail);
      if (fail > 0) process.exit(1);
    }, 70);
  }, 70);
}
runAsyncThenFinish();
