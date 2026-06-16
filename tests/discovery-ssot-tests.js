// tests/discovery-ssot-tests.js — Discovery SSOT rearchitecture safety net.
//
// Written test-FIRST, before the rearchitecture, to pin the invariants the
// "completely rearchitect this mess" work must satisfy. Each invariant is
// tagged with the STAGE that turns it green. It runs STANDALONE (not yet in
// run.sh) and always exits 0 while staged — read the RED/GREEN tally to watch
// the rearchitecture land. Stage 6 makes it strict and wires it into run.sh.
//
// The fixture is a miniature of the Live Iceland "mess": the same THREE forks
// the live trip exhibits —
//   (1) themed sections (checked + unchecked sights),
//   (2) the "Sights near places you listed" catchall (unchecked),
//   (3) a legacy dest.suggestions._considered pool that lives ONLY on the
//       destinations, never in placeActivities (the live "(none): 55").
//
// Invariants (and the symptom each guards):
//   I1  [Stage 3] map source count == model-over-placeActivities count
//                 (today they diverge: banner/chips read placeActivities,
//                  the map reads placeActivities + legacy absorption).
//   I2  [Stage 5] every considered sight has a real section, never "(none)".
//   I3  [Stage 2] re-deriving after a render-style "bake" is STABLE
//                 (no 17<->131 bistability: f(f(x)) count == f(x) count).
//   I4  [Stage 4] a "more like this" addition survives a
//                 canonicalize -> derive round-trip (it is not dropped).
//   I5  [401V]    no listed sight silently disappears: every non-stay,
//                 non-destination sight in placeActivities is either
//                 considered or committed — never lost.

"use strict";
var assert = require("assert");

// Production script order: window shim, PlaceKey, SectionKind, model, data.
global.window = global;
global.PlaceKey = require("../place-key.mjs").default;
require("../section-kind.mjs").default;          // sets global.SectionKind
require("../discovery-model.mjs").default;       // sets global.MaxDiscovery
require("../max-data.mjs");              // sets global.MaxData
var MaxData = global.MaxData;
var MD = global.MaxDiscovery;

var red = 0, green = 0;
var results = [];
function inv(id, stage, name, fn) {
  try { fn(); green++; results.push("  ✓ [" + stage + "] " + id + " " + name); }
  catch (e) { red++; results.push("  ✗ [" + stage + "] " + id + " " + name + "\n        " + e.message); }
}

// ── Fixture: the three-fork mess in miniature ────────────────────────
function makeTrip() {
  return {
    destinations: [
      { id: "d1", place: "Reykjavik", lat: 64.14, lng: -21.90, suggestions: [
        // legacy considered pool — present ONLY here, not in placeActivities
        { name: "Grótta Lighthouse", _considered: true, lat: 64.16, lng: -22.02 },
        { name: "Viðey Island", _considered: true, lat: 64.16, lng: -21.85 }
      ] },
      { id: "d2", place: "Vik", lat: 63.42, lng: -19.00, suggestions: [
        { name: "Reynisfjara Beach", _considered: false } // not considered → ignore
      ] }
    ],
    placeActivities: [
      { id: "s1", type: "activity", section: "Overnight stays",
        requiredPlaces: [ { place: "Reykjavik", _keep: true } ] },                 // stay (excluded)
      { id: "t1", type: "activity", section: "See natural wonders",
        requiredPlaces: [
          { place: "Gullfoss", _keep: true,  lat: 64.30, lng: -20.10 },            // committed
          { place: "Geysir",   _keep: false, lat: 64.31, lng: -20.30 }             // considered (themed)
        ] },
      { id: "n1", type: "activity", section: "Sights near places you listed",
        requiredPlaces: [
          { place: "Kerið Crater", _keep: false, lat: 64.04, lng: -20.90 },   // considered (catchall)
          { place: "Þingvellir",   _keep: false, lat: 64.25, lng: -21.10 }    // considered (catchall)
        ] }
    ]
  };
}

// model-over-placeActivities considered (what the picker banner/chips SHOULD
// read). SSOT Stage 3: it reads the UNIFIED set — placeActivities with the
// legacy dest.suggestions pool folded in — exactly like _discoveryCountSource.
function modelConsidered(trip) {
  var SK = global.SectionKind;
  var excluded = {};
  (trip.destinations || []).forEach(function (d) { if (d && d.place) excluded[norm(d.place)] = 1; });
  var pa = (typeof MaxData.foldConsideredSuggestionsIntoPlaceActivities === "function")
    ? MaxData.foldConsideredSuggestionsIntoPlaceActivities(trip).placeActivities
    : trip.placeActivities;
  var m = MD.DiscoveryModel.fromPlaceActivities(pa, {
    isStaySection: function (s) { return SK.isStay(s); },
    isDestination: function (p) { return !!(p && p.place && excluded[norm(p.place)]); },
    isHub: function (p) { return !!(p && (p._autoCreated || p._origin === "max-hub")); }
  });
  return m;
}
function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

// ── Invariants ───────────────────────────────────────────────────────

inv("I1", "Stage 3", "map source count == model-over-placeActivities count", function () {
  var trip = makeTrip();
  var mapCount = MaxData.countConsideredSights(trip);     // includes legacy absorption today
  var picker = modelConsidered(trip).considered().length; // placeActivities only
  assert.strictEqual(mapCount, picker,
    "map=" + mapCount + " vs picker=" + picker + " (legacy dest.suggestions pool is a second source)");
});

inv("I2", "Stage 5", "every considered sight has a real section, never '(none)'", function () {
  var trip = makeTrip();
  var bySection = MaxData.consideredBySection(trip);
  assert.ok(!("(none)" in bySection),
    "found '(none)': " + (bySection["(none)"] || 0) + " sectionless considered sights");
});

inv("I3", "Stage 2", "re-derivation is stable (no 17<->131 bistability)", function () {
  var trip = makeTrip();
  var c1 = modelConsidered(trip).considered().length;
  // "bake" the model back into placeActivities the way the render adapter does,
  // dropping emptied items, then re-derive. The count must not move.
  var baked = bakeSections(trip);
  var trip2 = Object.assign({}, trip, { placeActivities: baked });
  var c2 = modelConsidered(trip2).considered().length;
  assert.strictEqual(c1, c2, "considered changed across a render bake: " + c1 + " -> " + c2);
});

inv("I4", "Stage 4", "'more like this' addition survives canonicalize->derive", function () {
  var trip = makeTrip();
  // enhanceDiscovery appends a synthetic-enhance item of unchecked sights.
  trip.placeActivities.push({
    id: "synth-enh-1", type: "synthetic-enhance", section: "More places to consider",
    requiredPlaces: [ { place: "Skógafoss", _keep: false, lat: 63.53, lng: -19.51 } ]
  });
  var canon = MaxData.canonicalizePlaceActivities(trip.placeActivities);
  var trip2 = Object.assign({}, trip, { placeActivities: canon });
  var keys = Object.keys(MaxData.consideredPlaceKeys(trip2));
  assert.ok(keys.some(function (k) { return /skógafoss/i.test(k); }),
    "the added 'Skógafoss' was dropped by canonicalize/derive");
});

inv("I5", "401V", "no listed sight disappears (considered ∪ committed covers all sights)", function () {
  var trip = makeTrip();
  var m = modelConsidered(trip);
  var seen = {};
  m.considered().forEach(function (p) { seen[norm(p.place)] = 1; });
  m.committed().forEach(function (p) { seen[norm(p.place)] = 1; });
  // every non-stay, non-destination sight present in placeActivities must be accounted for
  var SK = global.SectionKind;
  var excluded = {};
  (trip.destinations || []).forEach(function (d) { if (d && d.place) excluded[norm(d.place)] = 1; });
  var missing = [];
  trip.placeActivities.forEach(function (it) {
    if (SK.isStay(it.section) || it.type === "route") return;
    (it.requiredPlaces || []).forEach(function (p) {
      if (!p || !p.place || p._rejected) return;
      var k = norm(p.place);
      if (excluded[k]) return;
      if (!seen[k]) missing.push(p.place);
    });
  });
  assert.strictEqual(missing.length, 0, "sights vanished from the derivation: " + missing.join(", "));
});

// Simulate the enhanceDiscovery ("more like this") write: append synthetic-enhance
// items, then "persist" = canonicalize into the trip (what _initialTripSave does).
function enhanceAndPersist(trip, places, section) {
  var pa = trip.placeActivities.slice();
  pa.push({
    id: "synth-enh-" + Math.random().toString(36).slice(2, 7), type: "synthetic-enhance",
    section: section || "More places to consider",
    requiredPlaces: places.map(function (p) {
      return { place: p.place, lat: p.lat, lng: p.lng, _keep: false };
    })
  });
  return Object.assign({}, trip, { placeActivities: MaxData.canonicalizePlaceActivities(pa) });
}

inv("I6", "Stage 4", "'more like this' addition survives a persist -> reopen-rehydrate cycle", function () {
  var trip = makeTrip();
  var before = MaxData.countConsideredSights(trip);
  var t2 = enhanceAndPersist(trip, [
    { place: "Skógafoss", lat: 63.53, lng: -19.51 },
    { place: "Dyrhólaey", lat: 63.40, lng: -19.13 }
  ]);
  // "Reopen" rehydrates from the persisted trip — derive considered fresh.
  var keys = Object.keys(MaxData.consideredPlaceKeys(t2));
  var present = ["skógafoss", "dyrhólaey"].every(function (n) {
    return keys.some(function (k) { return k.indexOf(n) !== -1; });
  });
  assert.ok(present, "an added place was lost across persist->rehydrate");
  assert.strictEqual(MaxData.countConsideredSights(t2), before + 2,
    "added 2 considered sights; count moved by " + (MaxData.countConsideredSights(t2) - before));
});

inv("I7", "Stage 4", "re-running 'more like this' with the same places does NOT duplicate (idempotent dedup)", function () {
  var trip = makeTrip();
  var adds = [{ place: "Skógafoss", lat: 63.53, lng: -19.51 }];
  var t2 = enhanceAndPersist(trip, adds);
  var afterFirst = MaxData.countConsideredSights(t2);
  // re-enhance the SAME place (LLM re-suggests something already added)
  var t3 = enhanceAndPersist(t2, adds);
  assert.strictEqual(MaxData.countConsideredSights(t3), afterFirst,
    "re-enhancing the same place grew the set: " + afterFirst + " -> " + MaxData.countConsideredSights(t3));
});

inv("I8", "Stage 5", "'Places you added' never appears; each manual add is its own named category", function () {
  var trip = makeTrip();
  trip.placeActivities.push({
    id: "m1", type: "manual", section: "Places you added", checked: false,
    requiredPlaces: [ { place: "Þingvellir", _keep: false, lat: 64.25, lng: -21.1 } ]
  });
  trip.placeActivities.push({
    id: "m2", type: "manual", section: "Places you added", checked: true,
    requiredPlaces: [ { place: "Harpa Concert Hall", _keep: true, lat: 64.15, lng: -21.93 } ]
  });
  var secs = modelConsidered(trip).sections().map(function (g) { return g.section; });
  assert.ok(secs.indexOf("Places you added") === -1, "the 'Places you added' section still exists: " + secs.join(", "));
  assert.ok(secs.indexOf("Þingvellir") !== -1, "unchecked manual add did not become its own category");
  assert.ok(secs.indexOf("Harpa Concert Hall") !== -1, "checked manual add did not become its own category");
});

inv("I9", "Phase 5", "trip↔discovery round-trips never ratchet the set (canonicalize-on-save dedups)", function () {
  var trip = makeTrip();
  var base = MaxData.countConsideredSights(trip);
  for (var round = 0; round < 5; round++) {
    // a writer appends a DUPLICATE of an existing considered place ("Geysir",
    // already in "See natural wonders") into another section — the ratchet's
    // raw material across a trip↔discovery round-trip.
    trip.placeActivities.push({
      id: "dup-" + round, type: "activity", section: "More places to consider",
      requiredPlaces: [{ place: "Geysir", _keep: false, lat: 64.31, lng: -20.30 }]
    });
    // canonicalize-on-save (the persist chokepoint, SSOT Phase 5) dedups it.
    trip.placeActivities = MaxData.canonicalizePlaceActivities(trip.placeActivities);
  }
  assert.strictEqual(MaxData.countConsideredSights(trip), base,
    "the set ratcheted across 5 round-trips: " + base + " -> " + MaxData.countConsideredSights(trip));
});

// Minimal mirror of discovery-adapter._applyDiscoveryModelToSights: rebuild the
// owned sight items from the model's sections, drop emptied items.
function bakeSections(trip) {
  var SK = global.SectionKind;
  var passthrough = trip.placeActivities.filter(function (it) {
    return it && (SK.isStay(it.section) || it.type === "route");
  });
  var m = modelConsidered(trip);
  var sightItems = m.sections().map(function (grp) {
    return { id: "model-" + norm(grp.section).replace(/\s+/g, "-"), type: "activity", section: grp.section,
      requiredPlaces: grp.places.map(function (p) {
        var sp = p.src || { place: p.place };
        sp._keep = (p.decision !== "unchecked");
        sp._rejected = (p.decision === "rejected");
        return (p.decision === "rejected") ? null : sp;
      }).filter(Boolean) };
  });
  return passthrough.concat(sightItems).filter(function (it) {
    return it && Array.isArray(it.requiredPlaces) && (it.requiredPlaces.length || SK.isStay(it.section) || it.type === "route");
  });
}

// ── Report ───────────────────────────────────────────────────────────
console.log("\ndiscovery SSOT rearchitecture — invariants\n");
results.forEach(function (r) { console.log(r); });
console.log("\n  PASS: " + green + "    FAIL: " + red + "\n");
// Stage 6: the rearchitecture has landed — these are now a hard gate. Any
// regression (a count surface drifting from the model, the "Sights near"
// section being overwritten again, "Places you added" reappearing, an addition
// failing to persist, a place disappearing) fails the build.
process.exit(red > 0 ? 1 : 0);
