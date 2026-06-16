// tests/discovery-enhance-tests.js — SSOT Phase 4: EnhancementService.
//
// Pins the extension point: a SuggestionSource is registered, its results flow
// through model.upsert (so the model's write door dedups), appliesTo gates
// availability, and re-running the same source adds nothing (idempotent —
// "more like this" twice never duplicates). The whole point: a new source is a
// registration, and it inherits dedup + the never-disappear guarantee for free.

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.mjs").default;
require("../section-kind.mjs").default;
require("../discovery-model.js");   // global.MaxDiscovery
var E = require("../discovery-enhance.js"); // global.MaxEnhance
var DM = global.MaxDiscovery.DiscoveryModel;

var pass = 0, fail = 0;
function ok(name) { pass++; console.log("  ✓ " + name); }
function bad(name, e) { fail++; console.error("  ✗ " + name + "\n    " + (e && e.message)); }

console.log("\ndiscovery-enhance — EnhancementService (Phase 4)\n");

function moreLikeThis(seeds) {
  return { id: "more-like-this", label: "More like this", fetch: function () { return seeds; } };
}
var dayTrips = {
  id: "day-trips", label: "Day trips",
  appliesTo: function (ctx) { return (ctx && ctx.hubCount || 0) >= 2; },
  fetch: function () { return [{ place: "Þingvellir day trip", decision: "unchecked" }]; }
};

// Sequential test list (sync + async), each isolated by E.reset().
var TESTS = [
  ["register requires id + fetch; sources() lists them", function () {
    E.reset(); E.register(moreLikeThis([])); E.register(dayTrips);
    assert.strictEqual(E.sources().length, 2);
    assert.throws(function () { E.register({ id: "x" }); }, /fetch/);
  }],
  ["available() gates by appliesTo (day-trips need >= 2 hubs)", function () {
    E.reset(); E.register(moreLikeThis([])); E.register(dayTrips);
    assert.deepStrictEqual(E.available({ hubCount: 0 }).map(function (s) { return s.id; }), ["more-like-this"]);
    assert.deepStrictEqual(E.available({ hubCount: 3 }).map(function (s) { return s.id; }).sort(), ["day-trips", "more-like-this"]);
  }],
  ["run() routes a source's results through model.upsert", function () {
    E.reset();
    E.register(moreLikeThis([
      { place: "Skógafoss", decision: "unchecked", coords: { lat: 63.53, lng: -19.51 } },
      { place: "Dyrhólaey", decision: "unchecked" }
    ]));
    var m = new DM();
    return E.run("more-like-this", m).then(function (r) {
      assert.strictEqual(r.added, 2, "expected 2 added, got " + r.added);
      assert.strictEqual(m.considered().length, 2, "places did not reach the model");
    });
  }],
  ["run() is idempotent: re-running the same source adds nothing (no duplicates)", function () {
    E.reset();
    E.register(moreLikeThis([{ place: "Skógafoss", decision: "unchecked", coords: { lat: 63.53, lng: -19.51 } }]));
    var m = new DM();
    return E.run("more-like-this", m)
      .then(function () { return E.run("more-like-this", m); })
      .then(function (r2) {
        assert.strictEqual(r2.added, 0, "re-running added duplicates: " + r2.added);
        assert.strictEqual(r2.merged, 1, "the re-suggested place should merge into the existing one");
        assert.strictEqual(m.considered().length, 1, "the set grew on re-run");
      });
  }],
  ["run() skips a source whose appliesTo is false", function () {
    E.reset(); E.register(dayTrips);
    var m = new DM();
    return E.run("day-trips", m, { hubCount: 1 }).then(function (r) {
      assert.strictEqual(r.skipped, "not-applicable");
      assert.strictEqual(m.all().length, 0, "a skipped source mutated the model");
    });
  }],
  ["run() of an unknown source rejects", function () {
    return E.run("nope", new DM()).then(
      function () { throw new Error("should have rejected"); },
      function (err) { assert.ok(/no such SuggestionSource/.test(err.message)); });
  }]
];

(function runSeq(i) {
  if (i >= TESTS.length) {
    console.log("\n" + "─".repeat(50));
    console.log("PASS: " + pass + "    FAIL: " + fail);
    if (fail > 0) process.exit(1);
    return;
  }
  var name = TESTS[i][0], fn = TESTS[i][1];
  Promise.resolve().then(fn).then(function () { ok(name); }, function (e) { bad(name, e); })
    .then(function () { runSeq(i + 1); });
})(0);
