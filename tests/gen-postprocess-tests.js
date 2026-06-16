// tests/gen-postprocess-tests.js — PD.403: the pure post-LLM transforms.
//
// gen-postprocess.js was extracted VERBATIM from
// _generateActivitiesForPlaceImpl. These tests pin:
//   1. Behavior of each transform on a fixture that exercises the tricky
//      cases (mixed overnight refs, denylist override, section merge,
//      coord borrowing).
//   2. A deep-equal snapshot of the full pipeline output, anchored to the
//      pre-refactor inline behavior. Regenerate with UPDATE_SNAPSHOT=1.

"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var M = require("../gen-postprocess.mjs").default;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + e.message); }
}
console.log("gen-postprocess-tests — PD.403\n");

var nrm = function (s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); };
var deny = function (n) { return /gornergrat/i.test(n); };

// Fresh fixture each call (the transforms MUTATE).
function fixtureItems() {
  return [
    { name: "Wonder A", type: "activity", section: "Visit natural wonders", description: "short", iconic: false,
      requiredPlaces: [{ place: "Gullfoss", country: "Iceland", lat: 64.3, lng: -20.1, overnight: false },
                       { place: "Geysir", country: "Iceland", lat: 64.31, lng: -20.3, overnight: false }] },
    { name: "Wonder B", type: "activity", section: "Visit Natural Wonders", description: "a considerably longer canonical description", iconic: true, checked: true,
      requiredPlaces: [{ place: "Gullfoss", country: "Iceland", lat: 64.3, lng: -20.1, overnight: true },
                       { place: "Dettifoss", country: "Iceland", lat: 65.8, lng: -16.4, overnight: false }] },
    { name: "Ride the route", type: "route", section: "Travel on trains", iconic: false,
      endpoints: [{ place: "Reykjavik", country: "Iceland", lat: 64.1, lng: -21.9, overnight: true }, { place: "Akureyri", country: "Iceland", lat: 65.7, lng: -18.1, overnight: true }],
      requiredPlaces: [{ place: "Reykjavik", country: "Iceland", lat: 64.1, lng: -21.9, overnight: true }, { place: "Akureyri", country: "Iceland", lat: 65.7, lng: -18.1, overnight: true }] },
    { name: "Stay", type: "synthetic-stays", section: "Overnight stays",
      requiredPlaces: [{ place: "Vik", country: "Iceland", lat: 63.4, lng: -19.0, overnight: true }] },
    { name: "Summit", type: "activity", section: "Stand at viewpoints", iconic: true,
      requiredPlaces: [{ place: "Gornergrat", country: "Switzerland", lat: 45.98, lng: 7.78, overnight: true }] },
    { name: "Quick stop", type: "activity", section: "Quick stops",
      requiredPlaces: [{ place: "Tiny Village", country: "Iceland", lat: 64.0, lng: -20.0, overnight: false }] }
  ];
}
function fixtureConstructed() {
  return [
    { name: "Your Gullfoss", _userConstructed: true, section: "Your list", requiredPlaces: [{ place: "Gullfoss", overnight: true }] },
    { name: "Your Mystery", _userConstructed: true, section: "Your list", requiredPlaces: [{ place: "Unknown Place", overnight: true }] },
    { name: "Not constructed", section: "x", requiredPlaces: [] }
  ];
}

// ── normalizePlaceArr ──────────────────────────────────────────────
test("normalizePlaceArr promotes string entries to {place,country}", function () {
  var out = M.normalizePlaceArr(["Reykjavik", { place: "Vik", country: "Iceland" }], "Iceland");
  assert.deepStrictEqual(out[0], { place: "Reykjavik", country: "Iceland" });
  assert.deepStrictEqual(out[1], { place: "Vik", country: "Iceland" });
});
test("normalizePlaceArr passes non-arrays through untouched", function () {
  assert.strictEqual(M.normalizePlaceArr(null, "X"), null);
});

// ── computeTransitOnly ─────────────────────────────────────────────
test("a place with ANY overnight:true ref is NOT transit-only", function () {
  var items = fixtureItems();
  M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  var g = items[0].requiredPlaces.find(function (p) { return p.place === "Gullfoss"; });
  assert.strictEqual(g._transitOnly, false);
  assert.strictEqual(g.overnight, true);
});
test("a place whose every ref is overnight:false IS transit-only", function () {
  var items = fixtureItems();
  M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  var ge = items[0].requiredPlaces.find(function (p) { return p.place === "Geysir"; });
  assert.strictEqual(ge._transitOnly, true);
  assert.strictEqual(ge.overnight, false);
});
test("denylist overrides overnight:true", function () {
  var items = fixtureItems();
  var stats = M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  var gn = items[4].requiredPlaces[0];
  assert.strictEqual(gn.place, "Gornergrat");
  assert.strictEqual(gn._transitOnly, true);
  assert.strictEqual(gn.overnight, false);
  assert.strictEqual(stats.denylistApplied, 1);
});
test("route refs are never touched by transit aggregation", function () {
  var items = fixtureItems();
  M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  var rey = items[2].requiredPlaces[0];
  assert.strictEqual(rey._transitOnly, undefined); // untouched
});
test("computeTransitOnly returns correct stats", function () {
  var items = fixtureItems();
  var stats = M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  assert.deepStrictEqual(stats, { transitPlaceCount: 4, markedTransit: 4, denylistApplied: 1 });
});

// ── mergeDuplicateSections ─────────────────────────────────────────
test("same-named sections collapse; places dedupe; richer fields win", function () {
  var merged = M.mergeDuplicateSections(fixtureItems(), { normPlaceName: nrm });
  var wonders = merged.filter(function (i) { return /natural wonders/i.test(i.section || ""); });
  assert.strictEqual(wonders.length, 1, "both 'Visit natural wonders' should collapse to one");
  assert.deepStrictEqual(wonders[0].requiredPlaces.map(function (p) { return p.place; }),
    ["Gullfoss", "Geysir", "Dettifoss"]);
  assert.strictEqual(wonders[0].iconic, true);   // from the duplicate
  assert.strictEqual(wonders[0].checked, true);  // from the duplicate
  assert.ok(wonders[0].description.length > "short".length); // richer kept
});
test("route and synthetic-* sections are never merged", function () {
  var dupRoutes = [
    { name: "Train A", type: "route", section: "Scenic trains", requiredPlaces: [] },
    { name: "Train B", type: "route", section: "Scenic trains", requiredPlaces: [] },
    { name: "Stay 1", type: "synthetic-stays", section: "Stays", requiredPlaces: [] },
    { name: "Stay 2", type: "synthetic-stays", section: "Stays", requiredPlaces: [] }
  ];
  var merged = M.mergeDuplicateSections(dupRoutes, { normPlaceName: nrm });
  assert.strictEqual(merged.length, 4, "routes and synthetics stay distinct");
});

// ── decorateConstructedWithCoords ──────────────────────────────────
test("constructed places borrow coords from a matching LLM place", function () {
  var items = M.mergeDuplicateSections(fixtureItems(), { normPlaceName: nrm });
  var constructed = fixtureConstructed().filter(function (it) { return it._userConstructed; });
  var n = M.decorateConstructedWithCoords(constructed, items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  var yg = constructed[0].requiredPlaces[0];
  assert.strictEqual(yg.lat, 64.3);
  assert.strictEqual(yg.country, "Iceland");
  // no LLM match → left undecorated
  assert.strictEqual(constructed[1].requiredPlaces[0].lat, undefined);
});

// ── PD.404 (#80): applyTheming ─────────────────────────────────────
function themingItems() {
  return [
    { name: "Stop in Gullfoss", section: "From your list", category: "scenery-nature", iconic: false, _userConstructed: true,
      requiredPlaces: [{ place: "Gullfoss", overnight: true, lat: 0, lng: 0 }] },
    { name: "Stop in Mystery", section: "From your list", category: "scenery-nature", _userConstructed: true,
      requiredPlaces: [{ place: "Unknown Place", overnight: true }] },
    { name: "Overnight stays", section: "Overnight stays", _userConstructed: true,
      requiredPlaces: [{ place: "Reykjavik", overnight: true }] },
    { name: "LLM activity", section: "Visit natural wonders",
      requiredPlaces: [{ place: "Dettifoss" }] }
  ];
}
var MOVABLE = ["From your list", "More places to consider"];
// PD.404: applyTheming stamps a per-PLACE _themeFit (the DiscoveryModel then
// splits the grouped catch-all item by placing each place in its own theme).
// It does NOT change the item's section.
test("applyTheming stamps _themeFit on a matched place + fills coords/iconic", function () {
  var items = themingItems();
  var map = [{ place: "Gullfoss", section: "Visit natural wonders", category: "scenery-nature", iconic: true, lat: 64.3, lng: -20.1, country: "Iceland" }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(n, 1);
  var p = items[0].requiredPlaces[0];
  assert.strictEqual(p._themeFit, "Visit natural wonders");
  assert.strictEqual(p._iconic, true);
  assert.strictEqual(p.lat, 64.3);
  assert.strictEqual(p.country, "Iceland");
});
test("applyTheming SPLITS one grouped item: each place gets its own _themeFit (the live sorted:1 bug)", function () {
  // One catch-all item with three places that belong in three different
  // themes — the exact shape of the live "Sights you're keeping" item.
  var items = [{ section: "Sights you're keeping", _userConstructed: true, requiredPlaces: [
    { place: "Gullfoss" }, { place: "Reynisfjara Beach" }, { place: "Harpa Concert Hall" }
  ] }];
  var map = [
    { place: "Gullfoss, Iceland", section: "Visit natural wonders" },
    { place: "Reynisfjara Beach, Iceland", section: "Walk the coast" },
    { place: "Harpa Concert Hall, Iceland", section: "Explore the capital" }
  ];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: ["Sights you're keeping"] });
  assert.strictEqual(n, 3); // all three placed — not 1
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Visit natural wonders");
  assert.strictEqual(items[0].requiredPlaces[1]._themeFit, "Walk the coast");
  assert.strictEqual(items[0].requiredPlaces[2]._themeFit, "Explore the capital");
});
test("applyTheming re-themes a PD.405 per-place fallback category (section === place name)", function () {
  // PD.405 puts a kept, un-themed sight in its own category named for the
  // place. The theming pass must still be able to move it (the PD.404/PD.405
  // clash) even though that category isn't in movableSections.
  var items = [
    { section: "Gullfoss", _userConstructed: true, requiredPlaces: [{ place: "Gullfoss", _keep: true, lat: 0, lng: 0 }] }
  ];
  var map = [{ place: "Gullfoss, Iceland", section: "Chase waterfalls", lat: 64.3, lng: -20.1 }];
  // movableSections does NOT include "Gullfoss" — yet it must still re-theme.
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: ["From your list", "Unique sights"] });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Chase waterfalls");
});
test("applyTheming never disturbs stays sections or non-movable items", function () {
  var items = themingItems();
  var map = [
    { place: "Reykjavik", section: "Explore the city" },   // in a stays section → ignore
    { place: "Dettifoss", section: "Somewhere else" }       // LLM item, not movable → ignore
  ];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[2].requiredPlaces[0]._themeFit, undefined);
  assert.strictEqual(items[3].requiredPlaces[0]._themeFit, undefined);
});
test("applyTheming leaves a place untouched when the entry has no section", function () {
  var items = themingItems();
  var map = [{ place: "Gullfoss", section: "   " }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, undefined);
});
test("consolidateOrphanThemes re-homes a themeless waterfall into the waterfalls theme", function () {
  var items = [
    { section: "Hike to waterfalls", requiredPlaces: [{ place: "Skógafoss", _themeFit: "Hike to waterfalls" }] },
    { section: "Goðafoss", requiredPlaces: [{ place: "Goðafoss" }] }  // themeless → would be a self-named category
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, "Hike to waterfalls");
});
test("consolidateOrphanThemes matches concept across languages (geyser → thermal theme)", function () {
  var items = [
    { section: "Soak in thermal waters", requiredPlaces: [{ place: "Mývatn Nature Baths", _themeFit: "Soak in thermal waters" }] },
    { section: "Geysir", requiredPlaces: [{ place: "Geysir" }] }
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, "Soak in thermal waters");
});
test("consolidateOrphanThemes opens the default concept theme when none exists (recognized feature is never pooled)", function () {
  var items = [
    { section: "Hike to waterfalls", requiredPlaces: [{ place: "Skógafoss", _themeFit: "Hike to waterfalls" }] },
    { section: "Geysir", requiredPlaces: [{ place: "Geysir" }] }  // thermal concept, no thermal theme present
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, "Soak in thermal waters");
});
test("consolidateOrphanThemes groups same-concept orphans into ONE default theme (no per-place forks)", function () {
  var items = [
    { section: "Kirkjufell", requiredPlaces: [{ place: "Kirkjufell" }] },   // mountain (fell)
    { section: "Snæfellsjökull", requiredPlaces: [{ place: "Snæfell Peak" }] } // mountain (peak)
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 2);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Mountains & peaks");
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, "Mountains & peaks");
});
test("consolidateOrphanThemes leaves a CONCEPT-LESS sight alone (a town pools, never mis-filed)", function () {
  var items = [
    { section: "Hike to waterfalls", requiredPlaces: [{ place: "Skógafoss", _themeFit: "Hike to waterfalls" }] },
    { section: "Húsavík", requiredPlaces: [{ place: "Húsavík" }] }  // a town — no feature concept → untouched
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, undefined);
});
test("consolidateOrphanThemes never touches stays or already-themed places", function () {
  var items = [
    { section: "Hike to waterfalls", requiredPlaces: [{ place: "Skógafoss", _themeFit: "Hike to waterfalls" }] },
    { section: "Overnight stays", requiredPlaces: [{ place: "Selfoss", role: "stay" }] }  // 'foss' but a STAY → must not move
  ];
  var n = M.consolidateOrphanThemes(items, { normPlaceName: nrm });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[1].requiredPlaces[0]._themeFit, undefined);
});
test("surfaceRouteOnlySights files a route-only sight into its matching theme", function () {
  var items = [
    { type: "route", section: "Drive scenic routes", requiredPlaces: [
        { place: "Ásbyrgi Canyon", _keep: true, lat: 66.0, lng: -16.5 },
        { place: "Reykjavík", _keep: true } ] },
    // Reykjavík is ALSO a stay → not route-only.
    { type: "synthetic-stays", section: "Overnight stays", requiredPlaces: [ { place: "Reykjavík", _keep: true } ] },
    { type: "activity", section: "Walk in canyons", requiredPlaces: [ { place: "Sigöldugljúfur Canyon", _themeFit: "Walk in canyons" } ] }
  ];
  var n = M.surfaceRouteOnlySights(items, { normPlaceName: nrm, isStaySection: function(s){ return s === "Overnight stays"; } });
  assert.strictEqual(n, 1, "only Ásbyrgi (route-only canyon) surfaces; Reykjavík is a stay, not route-only");
  var canyon = items.find(function(it){ return it.type !== "route" && it.section === "Walk in canyons"; });
  assert.ok(canyon.requiredPlaces.some(function(p){ return /Ásbyrgi/.test(p.place); }), "Ásbyrgi now appears in Walk in canyons");
});
test("surfaceRouteOnlySights puts a concept-less route-only sight into More places to consider", function () {
  var items = [
    { type: "route", section: "Drive scenic routes", requiredPlaces: [ { place: "Diamond Circle", _keep: true } ] },
    { type: "activity", section: "Walk in canyons", requiredPlaces: [ { place: "X Canyon", _themeFit: "Walk in canyons" } ] }
  ];
  var n = M.surfaceRouteOnlySights(items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  var more = items.find(function(it){ return it.type !== "route" && it.section === "More places to consider"; });
  assert.ok(more && more.requiredPlaces.some(function(p){ return /Diamond Circle/.test(p.place); }), "concept-less route sight is at least visible in the catch-all");
});
test("surfaceRouteOnlySights opens the default concept theme for a route-only feature (Kirkjufell → Mountains & peaks)", function () {
  var items = [
    { type: "route", section: "Drive scenic routes", requiredPlaces: [ { place: "Kirkjufell", _keep: true, lat: 64.9, lng: -23.3 } ] }
  ];
  var n = M.surfaceRouteOnlySights(items, { normPlaceName: nrm });
  assert.strictEqual(n, 1);
  var mtn = items.find(function(it){ return it.type !== "route" && it.section === "Mountains & peaks"; });
  assert.ok(mtn && mtn.requiredPlaces.some(function(p){ return /Kirkjufell/.test(p.place); }), "Kirkjufell surfaces into its concept theme, not the catch-all");
});
test("surfaceRouteOnlySights leaves a sight already in a theme alone", function () {
  var items = [
    { type: "route", section: "Drive scenic routes", requiredPlaces: [ { place: "Ásbyrgi Canyon", _keep: true } ] },
    { type: "activity", section: "Walk in canyons", requiredPlaces: [ { place: "Ásbyrgi Canyon", _themeFit: "Walk in canyons" } ] }
  ];
  var n = M.surfaceRouteOnlySights(items, { normPlaceName: nrm });
  assert.strictEqual(n, 0, "already in a non-route section → not route-only, nothing surfaced");
});
test("applyTheming never re-themes a place INTO another catch-all", function () {
  var items = themingItems();
  var map = [{ place: "Gullfoss", section: "More places to consider" }]; // a movable/catch-all target
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: ["From your list", "More places to consider"] });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, undefined);
});
test("applyTheming matches across a trailing country suffix (PD.404 live bug)", function () {
  var items = themingItems();
  var map = [{ place: "Gullfoss, Iceland", section: "Visit natural wonders", lat: 64.3, lng: -20.1 }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Visit natural wonders");
});
test("applyTheming matches when the STUB has the suffix and the map is bare", function () {
  var items = [{ section: "From your list", _userConstructed: true, requiredPlaces: [{ place: "Gullfoss, Iceland", lat: 0, lng: 0 }] }];
  var map = [{ place: "Gullfoss", section: "Visit natural wonders" }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Visit natural wonders");
});
test("applyTheming re-themes the 'Sights you're keeping' bucket when it's movable (PD.404 root cause)", function () {
  var items = [
    { name: "Sights you're keeping", section: "Sights you're keeping", _userConstructed: true,
      requiredPlaces: [{ place: "Goðafoss", _keep: true, lat: 0, lng: 0 }] }
  ];
  var map = [{ place: "Goðafoss, Iceland", section: "Visit natural wonders", lat: 65.7, lng: -17.5 }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: ["Sights you're keeping", "From your list"] });
  assert.strictEqual(n, 1);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, "Visit natural wonders");
});
test("applyTheming leaves 'Sights you're keeping' alone when it is NOT in movableSections", function () {
  var items = [{ section: "Sights you're keeping", _userConstructed: true, requiredPlaces: [{ place: "Goðafoss" }] }];
  var map = [{ place: "Goðafoss", section: "Visit natural wonders" }];
  var n = M.applyTheming(items, map, { normPlaceName: nrm, movableSections: ["From your list"] });
  assert.strictEqual(n, 0);
  assert.strictEqual(items[0].requiredPlaces[0]._themeFit, undefined);
});
test("applyTheming does not overwrite coords a place already has", function () {
  var items = themingItems();
  items[0].requiredPlaces[0].lat = 64.0; items[0].requiredPlaces[0].lng = -20.0;
  var map = [{ place: "Gullfoss", section: "Visit natural wonders", lat: 11.1, lng: 22.2 }];
  M.applyTheming(items, map, { normPlaceName: nrm, movableSections: MOVABLE });
  assert.strictEqual(items[0].requiredPlaces[0].lat, 64.0); // unchanged
});

// ── PD.404 (#80): coerceThemingMap (robust LLM-response parsing) ───
test("coerceThemingMap parses a clean array", function () {
  var a = M.coerceThemingMap('[{"place":"Gullfoss","section":"S"}]');
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].place, "Gullfoss");
});
test("coerceThemingMap strips ```json fences", function () {
  var a = M.coerceThemingMap('```json\n[{"place":"Vik","section":"S"}]\n```');
  assert.strictEqual(a.length, 1);
});
test("coerceThemingMap strips surrounding prose", function () {
  var a = M.coerceThemingMap('Sure! Here you go:\n[{"place":"Vik","section":"S"}]\nLet me know!');
  assert.strictEqual(a.length, 1);
});
test("coerceThemingMap unwraps an object that nests the array", function () {
  var a = M.coerceThemingMap('{"places":[{"place":"Vik","section":"S"}]}');
  assert.strictEqual(a.length, 1);
});
test("coerceThemingMap recovers a truncated array", function () {
  var a = M.coerceThemingMap('[{"place":"A","section":"S"},{"place":"B","section":"S"},{"place":"C","sec');
  assert.strictEqual(a.length, 2); // keeps the two complete objects
  assert.strictEqual(a[1].place, "B");
});
test("coerceThemingMap returns [] for junk / empty", function () {
  assert.deepStrictEqual(M.coerceThemingMap("not json at all"), []);
  assert.deepStrictEqual(M.coerceThemingMap("[]"), []);
  assert.deepStrictEqual(M.coerceThemingMap(""), []);
  assert.deepStrictEqual(M.coerceThemingMap(null), []);
});

// ── full-pipeline snapshot ─────────────────────────────────────────
var SNAP = path.join(__dirname, "fixtures", "gen-postprocess.snapshot.json");
test("full pipeline (transit → merge → decorate → concat) matches snapshot", function () {
  var items = fixtureItems();
  var _tb = { placeActivities: fixtureConstructed() };
  M.computeTransitOnly(items, { normPlaceName: nrm, isTransitOnlyByDenylist: deny });
  items = M.mergeDuplicateSections(items, { normPlaceName: nrm });
  var _constructed = (Array.isArray(_tb.placeActivities) ? _tb.placeActivities : [])
    .filter(function (it) { return it && it._userConstructed; });
  if (_constructed.length) {
    M.decorateConstructedWithCoords(_constructed, items, { normPlaceName: nrm });
    items = _constructed.concat(items);
  }
  var got = JSON.parse(JSON.stringify(items)); // drop undefined keys, like the snapshot
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, JSON.stringify(got, null, 2));
    console.log("    (snapshot updated)");
    return;
  }
  assert.ok(fs.existsSync(SNAP), "snapshot missing — run with UPDATE_SNAPSHOT=1");
  var saved = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  assert.deepStrictEqual(got, saved, "pipeline output drifted from snapshot");
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
