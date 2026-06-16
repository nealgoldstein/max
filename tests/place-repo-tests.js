// tests/place-repo-tests.js — PD.401M: the place repository.
//
// Pins the contract: ONE store of every place (sight/route/stay/region/
// destination) keyed by canonical identity; "is X present" is a single
// lookup; a listed place that became a route/region/stay is FOUND.

"use strict";
var assert = require("assert");
global.PlaceKey = require("../place-key.mjs").default;
var Repo = require("../place-repo.mjs").default.PlaceRepository;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + e.message); }
}
console.log("place-repo-tests — PD.401M\n");

function trip() {
  return {
    destinations: [{ place: "Reykjavik", lat: 64.14, lng: -21.94 }],
    placeActivities: [
      { section: "Chase waterfalls", type: "activity", requiredPlaces: [
        { place: "Skogafoss", _key: "skogafoss", lat: 63.5, lng: -19.5, _keep: false } ] },
      { section: "Drive scenic routes", type: "route", requiredPlaces: [
        { place: "Golden Circle", _key: "golden circle", lat: 64.3, lng: -20.3, _keep: true },
        { place: "Diamond Circle", _key: "diamond circle", lat: 65.9, lng: -16.9, _keep: true } ] },
      { section: "Routes & regions", type: "activity", requiredPlaces: [
        { place: "East Fjords", _key: "east fjords", _keep: true } ] },
      { section: "Overnight stays", type: "synthetic-stays", requiredPlaces: [
        { place: "Vik", _key: "vik", _keep: true } ] }
    ]
  };
}
var opts = {
  isStaySection: function (s) { return s === "Overnight stays"; },
  isRouteSection: function () { return false; }
};

test("fromTrip interns every kind under one store", function () {
  var t = trip();
  var repo = Repo.fromTrip(t.placeActivities, t.destinations, opts);
  // Reykjavik(dest) + Skogafoss + Golden + Diamond + East Fjords + Vik
  assert.strictEqual(repo.all().length, 6);
});

test("a route-umbrella listed place is PRESENT (the false-missing bug)", function () {
  var t = trip();
  var repo = Repo.fromTrip(t.placeActivities, t.destinations, opts);
  assert.strictEqual(repo.has("Golden Circle"), true);
  assert.strictEqual(repo.has("Diamond Circle"), true);
  assert.strictEqual(repo.find("Golden Circle").kinds.route, true);
});

test("a region and a stay are present too", function () {
  var t = trip();
  var repo = Repo.fromTrip(t.placeActivities, t.destinations, opts);
  assert.strictEqual(repo.has("East Fjords"), true);
  assert.strictEqual(repo.has("Vik"), true);
  assert.strictEqual(repo.find("Vik").kinds.stay, true);
});

test("coverage() answers found/kind for a listed set in one call", function () {
  var t = trip();
  var repo = Repo.fromTrip(t.placeActivities, t.destinations, opts);
  var cov = repo.coverage(["Golden Circle", "East Fjords", "Atlantis"]);
  assert.strictEqual(cov[0].found, true);
  assert.strictEqual(cov[1].found, true);
  assert.strictEqual(cov[2].found, false); // genuinely absent
});

test("find() is coverage-fuzz aware (Þingvellir ⊂ Þingvellir National Park)", function () {
  var repo = new Repo();
  repo.add({ place: "Þingvellir National Park", _key: "þingvellir national park", section: "See natural wonders", kind: "sight" });
  assert.strictEqual(repo.has("Þingvellir"), true);
});

test("PD.401T: a corrupted alias cannot make a present place 'missing'", function () {
  // A learned alias drifts the accented name off its expected key — the
  // live "8 of your listed places are missing: Vík, Höfn, …" bug. Coverage
  // must still find a place that is genuinely present, by its own name.
  global.PlaceKey.learn("Vík", "Vík Bogus Alias");
  global.PlaceKey.learn("Þingvellir", "Þingvellir Bogus Alias");
  var repo = new Repo();
  repo.add({ place: "Vik", section: "Overnight stays", kind: "stay" });
  repo.add({ place: "Þingvellir National Park", section: "See natural wonders", kind: "sight" });
  repo.add({ place: "Reykjavik", section: "Overnight stays", kind: "stay" });
  repo.add({ place: "Reykjavik Old Harbour", section: "See sights", kind: "sight" });
  assert.strictEqual(repo.has("vik"), true, "accented stay found despite a corrupt alias");
  assert.strictEqual(repo.has("Þingvellir"), true, "one-word listed name finds its qualified record");
  // exact wins over containment: 'reykjavik' is the stay, not the harbour.
  assert.strictEqual(repo.find("reykjavik").kinds.stay, true);
  // word-boundary guard: a prefix that isn't a whole word does NOT match.
  assert.strictEqual(repo.has("viking"), false);
  global.PlaceKey.forget("Vík"); global.PlaceKey.forget("Þingvellir");
});

test("interning is idempotent and merges sections/kinds", function () {
  var repo = new Repo();
  repo.add({ place: "Gullfoss", _key: "gullfoss", section: "A", kind: "sight" });
  repo.add({ place: "Gullfoss", _key: "gullfoss", section: "B", kind: "sight" });
  assert.strictEqual(repo.all().length, 1);
  assert.strictEqual(repo.find("Gullfoss").sections.length, 2);
});

// ── Entity interning (the ONE identity) ───────────────────────────────────
// With the discovery model loaded, the repo interns by sameEntity: true
// name-variants collapse to ONE place, but BOTH names still resolve, and
// genuinely-distinct places that merely share tokens stay separate.
global.MaxDiscovery = require("../discovery-model.mjs").default;

test("name-variants of one place intern to a SINGLE record (Goðafoss)", function () {
  var repo = new Repo();
  repo.add({ place: "Goðafoss", section: "Hike to waterfalls", kind: "sight" });
  repo.add({ place: "Goðafoss Waterfall", section: "See natural wonders", kind: "sight" });
  assert.strictEqual(repo.all().length, 1, "two names for one place = one record");
  assert.strictEqual(repo.has("Goðafoss"), true, "bare name still resolves");
  assert.strictEqual(repo.has("Goðafoss Waterfall"), true, "variant name still resolves");
});

test("distinct places that share tokens do NOT intern together", function () {
  var repo = new Repo();
  repo.add({ place: "Reykjavík Maritime Museum", lat: 64.155, lng: -21.95, kind: "sight" });
  repo.add({ place: "Reykjavík Art Museum",      lat: 64.149, lng: -21.94, kind: "sight" });
  assert.strictEqual(repo.all().length, 2, "two distinct museums stay separate");
});

test("far-apart places sharing generic tokens stay separate (coord veto)", function () {
  var repo = new Repo();
  repo.add({ place: "Snæfellsjökull National Park", lat: 64.80, lng: -23.78, kind: "sight" });
  repo.add({ place: "Þingvellir National Park",      lat: 64.26, lng: -21.13, kind: "sight" });
  assert.strictEqual(repo.all().length, 2, "140km-apart parks stay separate");
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
