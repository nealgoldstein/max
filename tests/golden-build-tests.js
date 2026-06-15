// tests/golden-build-tests.js — the GOLDEN end-to-end invariant test (#1).
//
// Every bug that reached the user this session lived in the FULL pipeline, not
// in any one unit: a base dropped AFTER enhance, a base fabricated as a sight
// AFTER enhance, counts drifting trip↔discovery. Unit tests never exercised the
// chain. This test does: it takes a FIXED pasted list (the real Iceland trip),
// builds the placeActivities a real build+enhance produces — INCLUDING the exact
// noise that broke things (a base copied into a sight section, a base-named
// "sight" the LLM/enhance invented and origin-baking tagged "user") — runs the
// ONE write door (canonicalizePlaceActivities), and asserts the whole invariant
// set. It is deterministic (no LLM, no browser) and is the safety net that lets
// the model refactors proceed without fear.
//
// INVARIANTS (a failure here is a real regression a user would see):
//   G1. Every place you listed as a BASE is present in a stay section.
//   G2. No base appears as a SIGHT (one place, one kind).
//   G3. A differently-named sight at a base's place SURVIVES (not over-merged).
//   G4. A name-variant pair collapses to ONE (Goðafoss / Goðafoss Waterfall).
//   G5. The write door is IDEMPOTENT — re-running changes nothing.
//   G6. The accounting reconciles: total === user + max, and the page total is
//       the unique-place count.

"use strict";
var assert = require("assert");

global.window = global;
global.PlaceKey = require("../place-key.js");
require("../discovery-model.js");           // MaxDiscovery.sameEntity (the ONE identity)
require("../max-data.js");                   // MaxData.canonicalizePlaceActivities (the write door)
var PS = require("../place-set.js");         // MaxPlaceSet.fromTrip / counts
var canon = global.MaxData.canonicalizePlaceActivities;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + "\n    " + (e && e.message)); }
}
function nf(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

// ── THE FIXED INPUT — the real trip's list ────────────────────────────
var STAYS = ["Selfoss", "Vík", "Skaftafell", "Höfn", "Egilsstaðir", "Lake Mývatn",
  "Akureyri", "Snæfellsnes Peninsula", "Reykjanes Peninsula", "Reykjavík", "Gardur", "Stykkishólmur"];
// A representative slice of the sees, chosen to include every hazard:
//   • a base + a DIFFERENT-named sight at the same place (Lake Mývatn / …geothermal region)
//   • a base + a different-named sight (Snæfellsnes Peninsula / Snæfellsjökull region)
//   • a name-variant pair (Goðafoss / Goðafoss Waterfall)
var USER_SIGHTS = ["Goðafoss", "Goðafoss Waterfall", "Gullfoss", "Reynisfjara Beach",
  "Skaftafell glacier region", "glacier outlets near Skaftafell", "Lake Mývatn geothermal region",
  "Snæfellsjökull region", "Reykjanes lava/coastal region", "Þingvellir"];

function P(place, extra) {
  return Object.assign({ place: place, _keep: true, nights: 0, overnight: false }, extra || {});
}
function item(section, places, extra) {
  return Object.assign({ id: "i" + Math.random().toString(36).slice(2, 8), type: "activity",
    section: section, requiredPlaces: places }, extra || {});
}

// Build the placeActivities a real build+enhance would hand the write door,
// INCLUDING the noise that produced the bugs.
function buildDirtyTrip() {
  var stayItem = item("Overnight stays",
    STAYS.map(function (s) { return P(s, { _origin: "user", _kind: "stay", nights: 2, overnight: true }); }));
  var userSightItem = item("From your list",
    USER_SIGHTS.map(function (s) { return P(s, { _origin: "user", _kind: "sight" }); }));
  // Max's recommended base + a few Max sight suggestions (unchecked).
  var recStay = item("Recommended overnight stays", [ P("Reykjahlíð", { _origin: "max-hub", _kind: "stay", _keep: false, nights: 1, overnight: true }) ]);
  var maxSights = item("More places to consider", [
    P("Kerið", { _origin: "max", _kind: "sight", _keep: false }),
    P("Hverir", { _origin: "max", _kind: "sight", _keep: false })
  ]);
  // ── THE NOISE — exactly what broke this session ──────────────────────
  // Enhance/the LLM fabricated base-named "sights" and origin-baking tagged them
  // "user" because the names match listed bases. These must NOT survive.
  var fabricatedDup = item("Catch seasonal phenomena", [
    P("Lake Mývatn", { _origin: "user", _kind: "sight" }),
    P("Reykjanes Peninsula", { _origin: "user", _kind: "sight" }),
    P("Snæfellsnes Peninsula", { _origin: "user", _kind: "sight" })
  ]);
  // The INVERSE noise: a place you listed as a SIGHT that the LLM dropped into a
  // stay section ("Overnight stays to consider"). It must be pulled back out.
  var misplacedSight = item("Overnight stays to consider", [
    P("Reynisfjara Beach", { _origin: "user", _kind: "stay" })   // section says stay; your list says sight
  ]);
  return [stayItem, userSightItem, recStay, maxSights, fabricatedDup, misplacedSight];
}

function sectionPlaces(items, predFn) {
  var out = [];
  items.forEach(function (it) { if (predFn(it)) (it.requiredPlaces || []).forEach(function (p) { if (p && p.place) out.push(p.place); }); });
  return out;
}
function isStaySec(sec) { return /^(overnight stays|recommended overnight stays|overnight stays to consider)$/i.test(String(sec || "").trim()); }

console.log("\ngolden-build — the full-pipeline invariant set\n");

// #4: the write door reads the CANONICAL listed set from the global (the same
// way it reaches MaxDiscovery / _isStaySection) and owns the kind invariant.
global._listedGroundTruth = function () { return { stays: STAYS.slice(), sights: USER_SIGHTS.slice() }; };

var dirty = buildDirtyTrip();
var clean = canon(JSON.parse(JSON.stringify(dirty)));

var stayPlaces = sectionPlaces(clean, function (it) { return it.type !== "route" && isStaySec(it.section); });
var sightPlaces = sectionPlaces(clean, function (it) { return it.type !== "route" && !isStaySec(it.section); });
var stayKeys = stayPlaces.map(nf);
var sightKeys = sightPlaces.map(nf);

test("G1: every listed BASE is present in a stay section", function () {
  STAYS.forEach(function (b) {
    assert.ok(stayKeys.indexOf(nf(b)) >= 0, "base missing from stays: " + b);
  });
});

test("G2: no base appears as a SIGHT (one place, one kind)", function () {
  STAYS.forEach(function (b) {
    assert.ok(sightKeys.indexOf(nf(b)) < 0, "a base leaked into a sight section: " + b);
  });
});

test("G3: a differently-named sight at a base's place SURVIVES", function () {
  ["Lake Mývatn geothermal region", "Skaftafell glacier region", "Snæfellsjökull region"].forEach(function (s) {
    assert.ok(sightKeys.indexOf(nf(s)) >= 0, "a distinct sight was wrongly removed: " + s);
  });
});

test("G4: a name-variant pair collapses to ONE place", function () {
  var god = sightKeys.filter(function (k) { return k.indexOf("goðafoss") === 0 || k.indexOf("godafoss") === 0; });
  assert.strictEqual(god.length, 1, "Goðafoss / Goðafoss Waterfall did not collapse: " + JSON.stringify(god));
});

test("G5: the write door is IDEMPOTENT — re-running changes nothing", function () {
  var twice = canon(JSON.parse(JSON.stringify(clean)));
  var n1 = sectionPlaces(clean, function () { return true; }).length;
  var n2 = sectionPlaces(twice, function () { return true; }).length;
  assert.strictEqual(n2, n1, "re-canonicalize changed the place count " + n1 + " -> " + n2);
});

test("G7: a place you listed as a SIGHT is pulled out of a stay section (#4 write door)", function () {
  // "Reynisfjara Beach" is in your sees; it was dropped into "Overnight stays to
  // consider". The write door, reading your canonical list, removes it from the
  // stay section — and it survives as a sight elsewhere.
  assert.ok(stayKeys.indexOf(nf("Reynisfjara Beach")) < 0, "a listed sight wrongly left in a stay section");
  assert.ok(sightKeys.indexOf(nf("Reynisfjara Beach")) >= 0, "the listed sight should remain a sight");
});

test("G8: a listed place a pass DROPPED is restored at the write door (#2)", function () {
  // Simulate an upstream pass dropping Skaftafell (a base) and Gullfoss (a sight).
  var dropped = buildDirtyTrip().map(function (it) {
    return Object.assign({}, it, {
      requiredPlaces: (it.requiredPlaces || []).filter(function (p) {
        return nf(p.place) !== nf("Skaftafell") && nf(p.place) !== nf("Gullfoss");
      })
    });
  });
  var fixed = canon(JSON.parse(JSON.stringify(dropped)));
  var stays2 = sectionPlaces(fixed, function (it) { return it.type !== "route" && isStaySec(it.section); }).map(nf);
  var sights2 = sectionPlaces(fixed, function (it) { return it.type !== "route" && !isStaySec(it.section); }).map(nf);
  assert.ok(stays2.indexOf(nf("Skaftafell")) >= 0, "a dropped base is restored to a stay section");
  assert.ok(sights2.indexOf(nf("Gullfoss")) >= 0, "a dropped sight is restored to the page");
});

test("G6: the accounting reconciles (PlaceSet over the cleaned trip)", function () {
  var c = PS.fromTrip({ placeActivities: clean }, {
    typedList: { destinations: STAYS, sights: USER_SIGHTS },
    isStaySection: isStaySec
  }).counts();
  assert.strictEqual(c.userDestinations + c.userSights + c.maxDestinations + c.maxSights, c.total,
    "the four buckets don't sum to the total");
  assert.strictEqual(c.kept + c.unchecked, c.total, "kept + unchecked must equal total");
  assert.strictEqual(c.userDestinations, STAYS.length, "all 12 bases counted as user destinations");
});

test("G9: the rendered list's sight grouping EQUALS the model's projection (#3 precondition)", function () {
  // The list renders from placeActivities (grouped by section); the banner/model
  // from PlaceSet.sections(). For the render-from-model cutover (#3) to be safe,
  // they must already agree by construction. Pin it: every sight section's
  // membership matches PlaceSet.sections(), so neither can silently drift.
  var pset = PS.fromTrip({ placeActivities: clean }, {
    typedList: { destinations: STAYS, sights: USER_SIGHTS }, isStaySection: isStaySec
  });
  var modelByTitle = {};
  pset.sections().forEach(function (s) {
    if (s.kind === "destination") return;                 // sights only
    modelByTitle[s.title] = s.places.map(function (p) { return nf(p.name); }).sort();
  });
  var listByTitle = {};
  clean.forEach(function (it) {
    if (!it || it.type === "route" || isStaySec(it.section)) return;
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p || !p.place || p._rejected === true) return;
      (listByTitle[it.section] = listByTitle[it.section] || []).push(nf(p.place));
    });
  });
  Object.keys(listByTitle).forEach(function (t) { listByTitle[t] = listByTitle[t].sort(); });
  // Every list sight-section exists in the model with the same membership.
  Object.keys(listByTitle).forEach(function (title) {
    assert.deepStrictEqual(listByTitle[title], modelByTitle[title] || [],
      "list vs model membership differs for section: " + title);
  });
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
