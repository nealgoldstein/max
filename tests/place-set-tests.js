// tests/place-set-tests.js — PD.432: the clean domain model.
//
// Pins the contract of PlaceSet: ONE collection, interned by identity, with
// counts() that reconcile BY CONSTRUCTION, projections for list/map, and BOTH
// modes (a user list, or all-Max) handled without special cases.

"use strict";

var assert = require("assert");
// sameEntity is optional — the module falls back to name equality without it.
try { global.PlaceKey = require("../place-key.mjs").default; } catch (_) {}
try { global.MaxDiscovery = require("../discovery-model.mjs").default; } catch (_) {}
var PS = require("../place-set.js");
var PlaceSet = PS.PlaceSet, Place = PS.Place;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + (e && e.message)); }
}
function set(specs) { var s = new PlaceSet(); (specs || []).forEach(function (p) { s.add(p); }); return s; }

console.log("place-set-tests — PD.432\n");

// ── the atom renders itself ───────────────────────────────────────────
test("a Place renders to a list row and a map pin", function () {
  var p = new Place({ name: "Vík", kind: "destination", source: "user", decision: "kept", coords: { lat: 63.4, lng: -19 }, nights: 2 });
  var row = p.toListRow();
  assert.strictEqual(row.kind, "destination");
  assert.strictEqual(row.checked, true);
  assert.strictEqual(row.mine, true);
  var pin = p.toMapPin();
  assert.strictEqual(pin.color, "blue");     // destinations are blue
  assert.strictEqual(pin.filled, true);      // committed → solid
});
test("a coordless place yields no map pin", function () {
  assert.strictEqual(new Place({ name: "Somewhere" }).toMapPin(), null);
});
test("a sight is green and defaults to 0 nights, unchecked, max", function () {
  var p = new Place({ name: "Goðafoss" });
  assert.strictEqual(p.kind, "sight");
  assert.strictEqual(p.nights, 0);
  assert.strictEqual(p.source, "max");
  assert.strictEqual(p.decision, "unchecked");
});

// ── identity merge on insert ──────────────────────────────────────────
test("two names for one place collapse to ONE, recorded as a duplicate", function () {
  var s = set([
    { name: "Goðafoss", source: "max" },
    { name: "Goðafoss Waterfall", source: "user", decision: "kept" }
  ]);
  assert.strictEqual(s.all().length, 1, "interned to one place");
  assert.strictEqual(s.duplicates().length, 1, "the merge was recorded");
  var p = s.all()[0];
  assert.strictEqual(p.source, "user", "your provenance wins the merge");
  assert.strictEqual(p.decision, "kept", "the commit wins the merge");
});
test("the user's KIND wins: Max can't turn your sight into a destination", function () {
  var s = set([
    { name: "Vík", source: "user", kind: "sight" },
    { name: "Vík", source: "max", kind: "destination", nights: 2 }
  ]);
  assert.strictEqual(s.all().length, 1);
  assert.strictEqual(s.all()[0].kind, "sight", "you said sight; Max's destination-claim doesn't override you");
});
test("between two Max records, a destination-claim upgrades a sight", function () {
  var s = set([
    { name: "Akureyri", source: "max", kind: "sight" },
    { name: "Akureyri", source: "max", kind: "destination", nights: 2 }
  ]);
  assert.strictEqual(s.all().length, 1);
  assert.strictEqual(s.all()[0].kind, "destination", "neither is user → the overnight claim wins");
});

// ── the accounting reconciles BY CONSTRUCTION ─────────────────────────
test("counts reconcile: total === kept + unchecked === the four kind×source buckets", function () {
  var s = set([
    { name: "Vík", source: "user", kind: "destination", decision: "kept" },
    { name: "Höfn", source: "user", kind: "destination", decision: "kept" },
    { name: "Goðafoss", source: "user", kind: "sight", decision: "kept" },
    { name: "Dettifoss", source: "max", kind: "sight", decision: "unchecked" },
    { name: "Hverir", source: "max", kind: "sight", decision: "unchecked" },
    { name: "Akureyri", source: "max", kind: "destination", decision: "unchecked" },
    { name: "Rejected place", source: "max", kind: "sight", decision: "rejected" }
  ]);
  var c = s.counts();
  assert.strictEqual(c.userDestinations, 2);
  assert.strictEqual(c.userSights, 1);
  assert.strictEqual(c.maxDestinations, 1);
  assert.strictEqual(c.maxSights, 2);
  assert.strictEqual(c.total, 6, "rejected is off the page");
  assert.strictEqual(c.rejected, 1);
  // the two partitions of the page both equal total:
  assert.strictEqual(c.kept + c.unchecked, c.total);
  assert.strictEqual(c.userDestinations + c.userSights + c.maxDestinations + c.maxSights, c.total);
});

// ── BOTH MODES, one design ────────────────────────────────────────────
test("MODE: a user list — your places count as user; Max's as max", function () {
  var s = set([
    { name: "Selfoss", source: "user", kind: "destination", decision: "kept" },
    { name: "Gullfoss", source: "user", kind: "sight", decision: "kept" },
    { name: "Kerið", source: "max", kind: "sight", decision: "unchecked" }
  ]);
  var c = s.counts();
  assert.strictEqual(c.userDestinations, 1);
  assert.strictEqual(c.userSights, 1);
  assert.strictEqual(c.maxSights, 1);
});
test("MODE: all Max (sentence-driven, no list) — zero user, all max, by construction", function () {
  var s = set([
    { name: "Reykjavik", source: "max", kind: "destination", decision: "unchecked" },
    { name: "Blue Lagoon", source: "max", kind: "sight", decision: "unchecked" },
    { name: "Þingvellir", source: "max", kind: "sight", decision: "unchecked" }
  ]);
  var c = s.counts();
  assert.strictEqual(c.userDestinations, 0);
  assert.strictEqual(c.userSights, 0);
  assert.strictEqual(c.maxDestinations, 1);
  assert.strictEqual(c.maxSights, 2);
  assert.strictEqual(c.total, 3);
  assert.deepStrictEqual(s.missing([]), [], "no list → nothing can be missing");
});

// ── projections ───────────────────────────────────────────────────────
test("sections() groups by theme (sights) and kind (stays); rejected excluded", function () {
  var s = set([
    { name: "Vík", kind: "destination", source: "user", decision: "kept" },
    { name: "Goðafoss", kind: "sight", source: "user", decision: "kept", theme: "Chase waterfalls" },
    { name: "Skógafoss", kind: "sight", source: "max", decision: "unchecked", theme: "Chase waterfalls" },
    { name: "Nope", kind: "sight", source: "max", decision: "rejected", theme: "Chase waterfalls" }
  ]);
  var secs = s.sections();
  var waterfalls = secs.find(function (x) { return x.title === "Chase waterfalls"; });
  assert.ok(waterfalls && waterfalls.places.length === 2, "two waterfalls, rejected excluded");
  assert.ok(secs.find(function (x) { return x.title === "Overnight stays"; }), "a stay falls into the stays group");
  // the section chip counts sum to the page total (no place lost or doubled)
  var chipSum = secs.reduce(function (n, x) { return n + x.places.length; }, 0);
  assert.strictEqual(chipSum, s.counts().total);
});
test("mapPins() emits a pin per coord-bearing place; coordless are skipped", function () {
  var s = set([
    { name: "Vík", kind: "destination", coords: { lat: 63.4, lng: -19 } },
    { name: "NoCoords", kind: "sight" }
  ]);
  assert.strictEqual(s.mapPins().length, 1);
});

// ── multi-category membership (slots) ─────────────────────────────────
test("a place in TWO categories appears in both sections but counts ONCE", function () {
  // A waterfall that's both "Chase waterfalls" and "Along the route".
  var s = set([
    { name: "Skógafoss", kind: "sight", source: "max", decision: "unchecked", theme: "Chase waterfalls" },
    { name: "Skógafoss", kind: "sight", source: "max", decision: "unchecked", theme: "Along the route" }
  ]);
  assert.strictEqual(s.all().length, 1, "interned to ONE place");
  assert.deepStrictEqual(s.all()[0].themes, ["Chase waterfalls", "Along the route"], "carries BOTH categories");
  var secs = s.sections();
  assert.strictEqual(secs.length, 2, "appears in two sections");
  assert.ok(secs.every(function (x) { return x.places.length === 1; }), "a slot in each");
  var c = s.counts();
  assert.strictEqual(c.total, 1, "ONE unique place");
  assert.strictEqual(c.slots, 2, "TWO slots");
  // the section chips sum to slots, NOT to the unique total
  var chipSum = secs.reduce(function (n, x) { return n + x.places.length; }, 0);
  assert.strictEqual(chipSum, c.slots, "chips sum to slots");
});
test("PD.438: your base and your same-named sight stay distinct; a Max dup folds into the base", function () {
  var C = { lat: 64.0167, lng: -16.9667 };
  var s = set([
    { name: "Skaftafell", kind: "destination", source: "user", decision: "kept", coords: C },
    { name: "Skaftafell glacier region", kind: "sight", source: "user", decision: "kept", coords: C },
    { name: "Skaftafell", kind: "sight", source: "max", decision: "unchecked", coords: C }
  ]);
  assert.strictEqual(s.all().length, 2, "your base + your sight are two places; Max's same-name dup folds in");
  var c = s.counts();
  assert.strictEqual(c.userDestinations, 1, "Skaftafell the base");
  assert.strictEqual(c.userSights, 1, "Skaftafell glacier region the sight");
});
test("themes accumulate across record merges, never dropped", function () {
  var trip = { placeActivities: [
    { section: "Chase waterfalls", type: "activity", requiredPlaces: [
      { place: "Goðafoss", _origin: "max", _keep: false } ] },
    { section: "Along the route", type: "activity", requiredPlaces: [
      { place: "Goðafoss", _origin: "max", _keep: false } ] }
  ]};
  var s = PS.fromTrip(trip);
  assert.strictEqual(s.all().length, 1);
  assert.deepStrictEqual(s.all()[0].themes, ["Chase waterfalls", "Along the route"]);
  assert.strictEqual(s.counts().slots, 2);
});

// ── missing = a genuine drop ──────────────────────────────────────────
test("missing() reports a typed name with NO place in the set; matches variants", function () {
  var s = set([{ name: "Goðafoss Waterfall", source: "user" }]);
  assert.deepStrictEqual(s.missing(["Goðafoss"]), [], "a variant name is NOT missing");
  assert.deepStrictEqual(s.missing(["Djúpalónssandur beach"]), ["Djúpalónssandur beach"], "a truly absent place IS missing");
});

// ── fromTrip ingestion ────────────────────────────────────────────────
test("fromTrip: typed list goes in first, records merge — a listed place can't be missing", function () {
  var trip = {
    placeActivities: [
      { section: "Overnight stays", type: "activity", requiredPlaces: [
        { place: "Vík", _origin: "user", _keep: true, lat: 63.4, lng: -19 } ] },
      { section: "Chase waterfalls", type: "activity", requiredPlaces: [
        { place: "Goðafoss Waterfall", _origin: "user", _keep: true, lat: 65.6, lng: -17.5 },
        { place: "Dettifoss", _origin: "max", _keep: false, lat: 65.8, lng: -16.4 } ] }
    ]
  };
  var s = PS.fromTrip(trip, { typedList: { destinations: ["Vík"], sights: ["Goðafoss", "Selfoss waterfall"] } });
  var c = s.counts();
  // "Goðafoss" (typed) merges with "Goðafoss Waterfall" (record) → one user sight.
  assert.strictEqual(c.userDestinations, 1, "Vík");
  assert.strictEqual(c.userSights, 2, "Goðafoss (merged) + Selfoss waterfall (typed, no record yet)");
  assert.strictEqual(c.maxSights, 1, "Dettifoss");
  // "Selfoss waterfall" was typed but has no record — yet it's in the set
  // (added from the typed list), so it is NOT missing. Missing is impossible.
  assert.deepStrictEqual(s.missing(["Vík", "Goðafoss", "Selfoss waterfall"]), []);
  // accounting reconciles
  assert.strictEqual(c.userDestinations + c.userSights + c.maxDestinations + c.maxSights, c.total);
});
test("fromTrip: kind comes from the SECTION, not the noisy per-place nights field", function () {
  // nights is unreliable here (defaulted to 2 on many sights), so a waterfall in
  // a sight theme stays a SIGHT even with nights set — section is the signal.
  var trip = { placeActivities: [
    { section: "Chase waterfalls", type: "activity", requiredPlaces: [
      { place: "Svartifoss Waterfall", _origin: "max", _keep: false, nights: 2 } ] },
    { section: "Overnight stays", type: "activity", requiredPlaces: [
      { place: "Vík", _origin: "user", _keep: true, nights: 2 } ] }
  ]};
  var c = PS.fromTrip(trip).counts();
  assert.strictEqual(c.maxSights, 1, "the waterfall stays a sight despite nights:2");
  assert.strictEqual(c.userDestinations, 1, "the stay-section place is a destination");
});
test("fromTrip: all-Max mode (no typed list) — every place is a Max suggestion", function () {
  var trip = { placeActivities: [
    { section: "Explore the capital", type: "activity", requiredPlaces: [
      { place: "Reykjavik", _origin: "max", _keep: false, lat: 64.1, lng: -21.9 },
      { place: "Harpa", _origin: "max", _keep: false, lat: 64.15, lng: -21.93 } ] }
  ]};
  var c = PS.fromTrip(trip).counts();
  assert.strictEqual(c.userDestinations + c.userSights, 0, "no list → no user places");
  assert.strictEqual(c.maxSights, 2);
  assert.strictEqual(c.total, 2);
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
