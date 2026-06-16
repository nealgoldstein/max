// tests/discovery-session-tests.js — SSOT Phase 5: the DiscoverySession.
//
// Proves the whole architecture end-to-end at the data layer: open a trip → one
// live model; read-only counts/sections; single-writer mutations flow through
// the model → debounced write-back → save; enhancement upserts through the
// model; and across the full open→mutate→close→reopen cycle nothing ratchets or
// disappears. This is the contract the live picker will be a thin shell over.

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.mjs").default;
require("../section-kind.mjs").default;
require("../discovery-model.mjs").default;
require("../max-data.js");
require("../discovery-ingestion.mjs").default;
require("../discovery-persistence.mjs").default;
require("../discovery-enhance.mjs").default;
var S = require("../discovery-session.mjs").default; // global.MaxDiscoverySession
var E = global.MaxEnhance;
var ING = global.MaxIngestion;

var pass = 0, fail = 0;
function ok(n) { pass++; console.log("  ✓ " + n); }
function bad(n, e) { fail++; console.error("  ✗ " + n + "\n    " + (e && e.message)); }
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

console.log("\ndiscovery-session — the coordinator (Phase 5)\n");

function makeTrip() {
  return {
    destinations: [{ id: "d1", place: "Reykjavik", lat: 64.14, lng: -21.90, suggestions: [] }],
    placeActivities: [
      { id: "s1", type: "activity", section: "Overnight stays", requiredPlaces: [{ place: "Reykjavik", _keep: true }] },
      { id: "t1", type: "activity", section: "See natural wonders", requiredPlaces: [
        { place: "Gullfoss", _keep: true, lat: 64.30, lng: -20.10 },
        { place: "Geysir", _keep: false, lat: 64.31, lng: -20.30 }
      ] }
    ]
  };
}

var TESTS = [
  ["open(trip) builds one live model; counts() projects it", function () {
    var s = S.open(makeTrip(), { debounceMs: 5 });
    var c = s.counts();
    assert.strictEqual(c.total, 1, "Geysir is the one considered sight");
    assert.strictEqual(c.committed, 1, "Gullfoss is committed");
    s.close();
  }],

  ["keep() flows through the model → write-back → save (debounced)", function () {
    var saved = 0, savedTrip = null;
    var s = S.open(makeTrip(), { debounceMs: 5, save: function (t) { saved++; savedTrip = t; } });
    s.keep("Geysir");
    return delay(25).then(function () {
      assert.strictEqual(saved, 1, "exactly one debounced save");
      assert.strictEqual(s.counts().total, 0, "Geysir left the considered set");
      assert.strictEqual(s.counts().committed, 2, "Geysir is now committed");
      // and the trip was written back
      var stillThere = ING.buildModel(savedTrip).committed().some(function (p) { return /geysir/i.test(p.place); });
      assert.ok(stillThere, "the kept decision did not reach the trip");
      s.close();
    });
  }],

  ["reject() preserves the place in the trip but drops it from considered", function () {
    var s = S.open(makeTrip(), { debounceMs: 5 });
    s.reject("Geysir");
    return delay(25).then(function () {
      assert.strictEqual(s.counts().total, 0, "rejected sight left considered");
      var keys = Object.keys(global.MaxData.consideredPlaceKeys(s.trip));
      assert.ok(keys.every(function (k) { return !/geysir/.test(k); }), "rejected reappeared as considered");
      var inTrip = (s.trip.placeActivities || []).some(function (it) {
        return (it.requiredPlaces || []).some(function (p) { return /geysir/i.test(p.place) && p._rejected; });
      });
      assert.ok(inTrip, "rejected place vanished from the trip (Round DX violation)");
      s.close();
    });
  }],

  ["enhance() routes a source through model.upsert; re-running adds nothing", function () {
    E.reset();
    E.register({ id: "more-like-this", label: "More like this",
      fetch: function () { return [{ place: "Skógafoss", decision: "unchecked", coords: { lat: 63.53, lng: -19.51 } }]; } });
    var s = S.open(makeTrip(), { debounceMs: 5 });
    var base = s.counts().total;
    return s.enhance("more-like-this").then(function (r) {
      assert.strictEqual(r.added, 1, "enhance added the place to the model");
      assert.strictEqual(s.counts().total, base + 1, "count reflects the addition");
      return s.enhance("more-like-this"); // re-run
    }).then(function (r2) {
      assert.strictEqual(r2.added, 0, "re-enhance duplicated");
      assert.strictEqual(s.counts().total, base + 1, "count ratcheted on re-enhance");
      s.close();
    });
  }],

  ["full cycle: open → enhance → close → REOPEN preserves the addition, no ratchet", function () {
    E.reset();
    E.register({ id: "more-like-this", label: "More like this",
      fetch: function () { return [{ place: "Dyrhólaey", decision: "unchecked", coords: { lat: 63.40, lng: -19.13 } }]; } });
    var trip = makeTrip();
    var s1 = S.open(trip, { debounceMs: 5 });
    return s1.enhance("more-like-this").then(function () {
      return delay(25); // let write-back persist into `trip`
    }).then(function () {
      s1.close();
      var afterFirst = ING.buildModel(trip).considered().length;
      // REOPEN the same trip
      var s2 = S.open(trip, { debounceMs: 5 });
      assert.strictEqual(s2.counts().total, afterFirst, "reopen lost or grew the set");
      // and an enhance with the same place still adds nothing
      return s2.enhance("more-like-this").then(function (r) {
        assert.strictEqual(r.added, 0, "reopened session ratcheted on re-enhance");
        s2.close();
      });
    });
  }]
];

(function runSeq(i) {
  if (i >= TESTS.length) {
    console.log("\n" + "─".repeat(50));
    console.log("PASS: " + pass + "    FAIL: " + fail);
    if (fail > 0) process.exit(1);
    return;
  }
  Promise.resolve().then(TESTS[i][1]).then(function () { ok(TESTS[i][0]); }, function (e) { bad(TESTS[i][0], e); })
    .then(function () { runSeq(i + 1); });
})(0);
