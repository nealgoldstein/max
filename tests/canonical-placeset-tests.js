// tests/canonical-placeset-tests.js — PD.349.
//
// The canonical place-set invariant is the architectural answer to
// the Discovery ratchet (55 → 149 → 209 unchecked across trip↔
// Discovery round-trips): many writers, each appending copies with
// its own ad-hoc dedupe. One owner — MaxData.canonicalizePlaceActivities
// — enforces:
//   1. one entry per place key per item
//   2. themed placement beats catchall stubs
//   3. one catchall per key (From your list > Sights near > More places)
//   4. Recommended stays beat "to consider"
//   5. emptied items drop; routes/synthetics exempt
//   6. IDEMPOTENT: f(f(x)) === f(x) — re-running any pass can't grow the set
//   7. user-owned flags survive merges (_rejected wins, then _keep)

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.js");
// PD.401k: mirror production's script order — discovery-model.js loads
// before max-data.js, so the canonicalizer's interning can use the ONE
// identity (MaxDiscovery.sameEntity, coordinate-aware). Without it,
// max-data degrades gracefully to name-only identity.
require("../discovery-model.js");
require("../max-data.js");
var canon = global.MaxData.canonicalizePlaceActivities;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + e.message); }
}
function P(place, extra) { return Object.assign({ place: place, nights: 0, overnight: false, _keep: true }, extra || {}); }
function item(section, places, extra) {
  return Object.assign({ id: "i" + Math.random().toString(36).slice(2, 7), type: "activity", section: section, requiredPlaces: places }, extra || {});
}
function keysIn(items, section) {
  var out = [];
  items.forEach(function (it) {
    if (it.section !== section) return;
    (it.requiredPlaces || []).forEach(function (p) { out.push(p.place.toLowerCase()); });
  });
  return out.sort();
}
function totalPlaces(items) {
  return items.reduce(function (n, it) { return n + ((it.requiredPlaces || []).length); }, 0);
}

console.log("\ncanonical place-set — invariant rules\n");

test("rule 1: duplicate entries within one item merge (coords/keep survive)", function () {
  var out = canon([item("Hike to waterfalls", [
    P("Gullfoss", { lat: 0, lng: 0 }),
    P("Gullfoss", { lat: 64.3, lng: -20.1, _keep: false })
  ])]);
  assert.strictEqual(out[0].requiredPlaces.length, 1);
  assert.strictEqual(out[0].requiredPlaces[0].lat, 64.3);   // coords filled
  assert.strictEqual(out[0].requiredPlaces[0]._keep, true); // keep survives
});

test("rule 2: themed placement removes catchall stubs", function () {
  var out = canon([
    item("Hike to waterfalls", [P("Goðafoss")]),
    item("From your list", [P("Goðafoss"), P("Gardur")]),
    item("More places to consider", [P("Goðafoss")])
  ]);
  assert.deepStrictEqual(keysIn(out, "From your list"), ["gardur"]);
  assert.strictEqual(keysIn(out, "More places to consider").length, 0);
});

test("rule 3: one catchall per key, by precedence", function () {
  var out = canon([
    item("More places to consider", [P("Hvalnes")]),
    item("Sights near places you listed", [P("Hvalnes")]),
    item("From your list", [P("Hvalnes")])
  ]);
  assert.deepStrictEqual(keysIn(out, "From your list"), ["hvalnes"]);
  assert.strictEqual(keysIn(out, "Sights near places you listed").length, 0);
  assert.strictEqual(keysIn(out, "More places to consider").length, 0);
});

test("rule 4: Recommended stays beat 'to consider'", function () {
  var out = canon([
    item("Recommended overnight stays", [P("Vik", { overnight: true, nights: 2 })]),
    item("Overnight stays to consider", [P("Vik", { overnight: true }), P("Hofn", { overnight: true })])
  ]);
  assert.deepStrictEqual(keysIn(out, "Overnight stays to consider"), ["hofn"]);
});

test("rule 5: emptied items drop; routes and synthetics exempt", function () {
  var out = canon([
    item("Hike to waterfalls", [P("Gullfoss")]),
    item("More places to consider", [P("Gullfoss")]),                 // empties → drops
    item("Drive the ring", [], { type: "route" }),                     // exempt
    item("Stays", [], { type: "synthetic-stays" })                     // exempt
  ]);
  assert.strictEqual(out.length, 3);
  assert.ok(out.some(function (it) { return it.type === "route"; }));
  assert.ok(out.some(function (it) { return it.type === "synthetic-stays"; }));
});

test("rule 6: IDEMPOTENT — f(f(x)) === f(x), set can never grow", function () {
  var input = [
    item("Hike to waterfalls", [P("Gullfoss"), P("Gullfoss"), P("Seljalandsfoss")]),
    item("From your list", [P("Gardur"), P("Gullfoss")]),
    item("Sights near places you listed", [P("Gardur"), P("Krafla")]),
    item("More places to consider", [P("Krafla"), P("Hvalnes")]),
    item("Recommended overnight stays", [P("Vik", { overnight: true })]),
    item("Overnight stays to consider", [P("Vik", { overnight: true })])
  ];
  var once = canon(input);
  var n1 = totalPlaces(once);
  var twice = canon(once);
  var n2 = totalPlaces(twice);
  var thrice = canon(twice);
  assert.strictEqual(n2, n1, "second pass changed the count");
  assert.strictEqual(totalPlaces(thrice), n1, "third pass changed the count");
  assert.strictEqual(twice.length, once.length);
});

test("rule 7: user rejection survives a merge (rejected beats keep)", function () {
  var out = canon([item("Hike to waterfalls", [
    P("Dettifoss", { _keep: false, _rejected: true }),
    P("Dettifoss", { _keep: true })
  ])]);
  assert.strictEqual(out[0].requiredPlaces[0]._rejected, true);
  assert.strictEqual(out[0].requiredPlaces[0]._keep, false);
});

test("simulated ratchet: concatenating a regeneration does not grow the canonical set", function () {
  var build1 = [
    item("Hike to waterfalls", [P("Gullfoss")]),
    item("From your list", [P("Gardur")])
  ];
  var c1 = canon(build1.slice());
  // A racing regeneration concatenates near-identical output (the
  // observed PD.348 failure mode).
  var build2 = c1.concat([
    item("Hike to waterfalls", [P("Gullfoss")]),
    item("From your list", [P("Gardur")]),
    item("More places to consider", [P("Gardur")])
  ]);
  var c2 = canon(build2);
  assert.strictEqual(totalPlaces(c2), totalPlaces(c1),
    "regeneration grew the set: " + totalPlaces(c1) + " → " + totalPlaces(c2));
});

console.log("\n" + "─".repeat(50));
test("PD.385: a naming variant in a theme dedupes the catchall copy", function () {
  // The user listed "Þingvellir"; the LLM themed "Þingvellir National
  // Park". Exact-key dedupe missed it. PD.399: containment now
  // collapses it only when the two are at the SAME coordinates (so a
  // distinct place that merely shares a leading word survives). With
  // matching coords, the catchall copy is removed.
  var out = canon([
    item("From your list", [P("Þingvellir", { lat: 64.25, lng: -21.13 })]),
    item("Drive scenic routes", [P("Þingvellir National Park", { lat: 64.25, lng: -21.13 })])
  ]);
  var fromList = out.find(function (it) { return it.section === "From your list"; });
  var theme = out.find(function (it) { return it.section === "Drive scenic routes"; });
  // The catchall item is emptied → dropped entirely.
  assert.ok(!fromList, "the 'From your list' duplicate must be removed");
  assert.ok(theme && theme.requiredPlaces.length === 1, "the theme keeps the place once");
});

test("PD.385: containment dedupe does NOT over-match distinct places", function () {
  // "Diamond Circle" and "Diamond Beach" share one word — they must
  // stay distinct (no false collapse).
  var out = canon([
    item("From your list", [P("Diamond Circle")]),
    item("Visit coastal formations", [P("Diamond Beach")])
  ]);
  var fromList = out.find(function (it) { return it.section === "From your list"; });
  assert.ok(fromList && fromList.requiredPlaces.some(function (p) { return p.place === "Diamond Circle"; }),
    "Diamond Circle must NOT be collapsed into Diamond Beach");
});


test("PD.399: containment does NOT delete a distinct place inside a destination", function () {
  // "Reykjavik Old Harbour" starts with "Reykjavik" but is a DIFFERENT
  // place (~1km away). Name-only containment deleted it (the "no Max
  // recommendations" regression). Coordinate-gating must keep it.
  var out = canon([
    item("Explore Reykjavik", [P("Reykjavik", { lat: 64.14, lng: -21.94 })]),
    item("More places to consider", [
      P("Reykjavik Old Harbour", { lat: 64.15, lng: -21.94, _keep: false }) ])
  ]);
  var more = out.find(function (it) { return it.section === "More places to consider"; });
  assert.ok(more && more.requiredPlaces.some(function (p) { return p.place === "Reykjavik Old Harbour"; }),
    "a distinct place inside a destination must NOT be deleted by containment");
});

test("PD.399: a true variant at the SAME coords still dedupes", function () {
  var out = canon([
    item("See natural wonders", [P("Þingvellir National Park", { lat: 64.25, lng: -21.13 })]),
    item("More places to consider", [P("Þingvellir", { lat: 64.25, lng: -21.13, _keep: false })])
  ]);
  var more = out.find(function (it) { return it.section === "More places to consider"; });
  assert.ok(!more, "the same-coords variant must collapse into the theme");
});

console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
