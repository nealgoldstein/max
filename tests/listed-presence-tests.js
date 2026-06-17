// tests/listed-presence-tests.js — 401V / PD.443 hard-constraint guard.
//
// THE INVARIANT (the most important product promise): a place the user LISTED
// must NEVER disappear. Max never unchecks or drops a listed place. The write
// door — MaxData.canonicalizePlaceActivities — owns this: on every save it
// RESTORES a listed stay/sight that a build or curation pass dropped, and does
// so identity-aware + idempotently (a present place is never duplicated).
//
// Why this file exists: mutation-testing showed the restoration block had thin
// behavioral coverage — only the broad golden-build suite caught a regression.
// This is a small, fast, DIRECT guard so a break in 401V fails loudly here.
//
// Run: node tests/listed-presence-tests.js
"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.mjs").default;
require("../discovery-model.mjs").default;   // MaxDiscovery.sameEntity (identity)
require("../max-data.mjs");                   // the write door
var canon = global.MaxData.canonicalizePlaceActivities;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + (e && e.message)); }
}
function nf(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function present(items, name) {
  return items.some(function (it) {
    return it && Array.isArray(it.requiredPlaces) && it.requiredPlaces.some(function (p) {
      return p && p.place && nf(p.place) === nf(name) && p._rejected !== true;
    });
  });
}
function countOf(items, name) {
  var n = 0;
  (items || []).forEach(function (it) {
    if (it && Array.isArray(it.requiredPlaces)) it.requiredPlaces.forEach(function (p) {
      if (p && p.place && nf(p.place) === nf(name) && p._rejected !== true) n++;
    });
  });
  return n;
}

var LISTED_STAY = "Selfoss", LISTED_SIGHT = "Goðafoss";
global._listedGroundTruth = function () { return { stays: [LISTED_STAY], sights: [LISTED_SIGHT] }; };

console.log("\n401V / PD.443 — listed-place presence at the write door");

test("a dropped listed STAY is restored on save", function () {
  var items = [{ id: "a", type: "activity", section: "Recommended overnight stays",
    requiredPlaces: [{ place: "Akureyri", _keep: true }] }];
  assert.ok(present(canon(items), LISTED_STAY), "listed stay vanished from the write-door output");
});

test("a dropped listed SIGHT is restored on save", function () {
  var items = [{ id: "b", type: "activity", section: "Sights",
    requiredPlaces: [{ place: "Gullfoss", _keep: true }] }];
  assert.ok(present(canon(items), LISTED_SIGHT), "listed sight vanished from the write-door output");
});

test("restoration is idempotent — re-canonicalize never duplicates", function () {
  var out2 = canon(canon([]));
  assert.strictEqual(countOf(out2, LISTED_STAY), 1, "listed stay duplicated on re-run");
  assert.strictEqual(countOf(out2, LISTED_SIGHT), 1, "listed sight duplicated on re-run");
});

test("an already-present listed stay is NOT duplicated", function () {
  var items = [{ id: "c", type: "activity", section: "Overnight stays",
    requiredPlaces: [{ place: LISTED_STAY, _origin: "user", _kind: "stay", _keep: true }] }];
  assert.strictEqual(countOf(canon(items), LISTED_STAY), 1, "duplicated an already-present listed stay");
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
