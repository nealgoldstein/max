// tests/discovery-model-tests.js — PD.400: the re-architected domain.
//
// Pins the contract of the new DiscoveryModel: ONE source of truth,
// ONE writer, ONE pure placement policy, pure queries that can't
// disagree. Every recurring bug from the pass-chain era is expressed
// here as a property the model holds BY CONSTRUCTION.

"use strict";

var assert = require("assert");
global.PlaceKey = require("../place-key.js");
var M = require("../discovery-model.js");
var DiscoveryModel = M.DiscoveryModel;
var Policy = M.PlacementPolicy;
var S = M.SECTION;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + e.message); }
}

console.log("discovery-model-tests — PD.400\n");

function model(places) {
  var m = new DiscoveryModel();
  (places || []).forEach(function (p) { m.upsert(p); });
  return m;
}

// ── PlacementPolicy is a pure function of attributes ─────────────────
test("placement: user stay → Overnight stays", function () {
  assert.strictEqual(Policy.sectionFor({ role: "stay", origin: "user" }), S.STAYS_USER);
});
test("placement: max-hub stay → Recommended overnight stays", function () {
  assert.strictEqual(Policy.sectionFor({ role: "stay", origin: "max-hub" }), S.STAYS_REC);
});
test("placement: checked sight with a theme → that theme", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "checked", themeFit: "Chase waterfalls" }), "Chase waterfalls");
});
test("placement: checked sight with NO theme → Sights you're keeping", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "checked", themeFit: null }), S.KEEPING);
});
test("placement: unchecked sight with a theme → that theme (shown unchecked)", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", themeFit: "Relax in hot springs" }), "Relax in hot springs");
});
test("placement: unchecked USER sight, no theme → From your list", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", origin: "user", themeFit: null }), S.FROM_LIST);
});
test("placement: unchecked MAX sight, no theme → More places to consider", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", origin: "max", themeFit: null }), S.MORE);
});

// ── THE CHECKED-IN-CATCHALL CLASS CANNOT EXIST ───────────────────────
test("invariant: a checked sight is NEVER in a to-consider catchall", function () {
  var m = model([
    { place: "Geysir", origin: "max", role: "sight", decision: "unchecked" }
  ]);
  // section is "More places to consider"
  assert.strictEqual(m.sections().find(function (x) { return x.section === S.MORE; }).places.length, 1);
  // check it → it LEAVES the catchall (by derivation, not a pass)
  m.setDecision("Geysir", "checked");
  var more = m.sections().find(function (x) { return x.section === S.MORE; });
  assert.ok(!more, "the catchall is empty once the only place is checked");
  var keeping = m.sections().find(function (x) { return x.section === S.KEEPING; });
  assert.ok(keeping && keeping.places.length === 1, "the checked sight committed to 'keeping'");
});

// ── COUNTS CANNOT DISAGREE (one derivation) ──────────────────────────
test("counts: chip (section size) == considered for catchalls, by construction", function () {
  var m = model([
    { place: "A", origin: "max", role: "sight", decision: "unchecked" },
    { place: "B", origin: "max", role: "sight", decision: "unchecked" },
    { place: "C", origin: "max", role: "sight", decision: "checked" } // committed → leaves catchall
  ]);
  var cbs = m.consideredBySection();
  var moreSection = m.sections().find(function (x) { return x.section === S.MORE; });
  assert.strictEqual(moreSection.places.length, cbs[S.MORE], "the More chip equals its considered count");
  assert.strictEqual(m.considered().length, 2, "two unchecked sights considered");
});

// ── IDENTITY: coordinate-aware, no over-deletion ─────────────────────
test("identity: a distinct place inside a destination is NOT merged", function () {
  // "Reykjavik Old Harbour" must not collapse into "Reykjavik".
  var m = model([
    { place: "Reykjavik", coords: { lat: 64.14, lng: -21.94 }, origin: "user", role: "stay" },
    { place: "Reykjavik Old Harbour", coords: { lat: 64.15, lng: -21.94 }, origin: "max", role: "sight", decision: "unchecked" }
  ]);
  assert.strictEqual(m.all().length, 2, "two distinct places — no over-merge");
});
test("identity (PD.401P): two UNRELATED names at one point do NOT merge", function () {
  // A church and the statue in front of it: same point, different names,
  // no name relation. They must stay distinct — merging would hide one.
  // Coordinates only confirm a name relation; they never merge on their own.
  var m = model([
    { place: "Hallgrimskirkja", coords: { lat: 64.1417, lng: -21.9266 }, origin: "user", role: "sight", decision: "unchecked" },
    { place: "Leif Erikson Statue", coords: { lat: 64.1417, lng: -21.9266 }, origin: "max", role: "sight", decision: "unchecked" }
  ]);
  assert.strictEqual(m.all().length, 2, "distinct names at one point stay distinct — never hide a place");
});
test("identity: a true variant at the same coords merges to ONE entity", function () {
  var m = model([
    { place: "Þingvellir National Park", coords: { lat: 64.25, lng: -21.13 }, origin: "max", role: "sight", themeFit: "See natural wonders", decision: "unchecked" },
    { place: "Þingvellir", coords: { lat: 64.25, lng: -21.13 }, origin: "user", role: "sight", decision: "unchecked" }
  ]);
  assert.strictEqual(m.all().length, 1, "same place, one entity");
  // provenance upgrades to user; theme survives.
  assert.strictEqual(m.all()[0].origin, "user");
  assert.strictEqual(m.all()[0].themeFit, "See natural wonders");
});

// ── COVERAGE: one-word listed place is found via the same identity ───
test("coverage: a one-word listed place matches its qualified theme form", function () {
  var m = model([
    { place: "Þingvellir National Park", coords: { lat: 64.25, lng: -21.13 }, origin: "max", role: "sight", themeFit: "See natural wonders", decision: "unchecked" }
  ]);
  var cov = m.coverage(["Þingvellir"]);
  assert.strictEqual(cov[0].found, true, "Þingvellir is present (as the National Park form)");
});

// ── UPSERT is idempotent (no ratchet) ────────────────────────────────
test("upsert: re-ingesting the same place does not grow the ledger", function () {
  var m = new DiscoveryModel();
  m.upsert({ place: "Gullfoss", origin: "max", role: "sight", decision: "unchecked" });
  m.upsert({ place: "Gullfoss", origin: "max", role: "sight", decision: "unchecked" });
  m.upsert({ place: "gullfoss", origin: "max", role: "sight", decision: "unchecked" });
  assert.strictEqual(m.all().length, 1, "one entity regardless of how many times ingested");
});

// ── STAY SPLIT is provenance-driven ──────────────────────────────────
test("stay split: user stay and max hub never share a section", function () {
  var m = model([
    { place: "Reykjavik", origin: "user", role: "stay" },
    { place: "Grundarfjordur", origin: "max-hub", role: "stay" }
  ]);
  assert.strictEqual(Policy.sectionFor(m._findExisting({ place: "Reykjavik" })), S.STAYS_USER);
  assert.strictEqual(Policy.sectionFor(m._findExisting({ place: "Grundarfjordur" })), S.STAYS_REC);
});

// ── ONE ingestion: fromPlaceActivities is the single derivation ──────
test("fromPlaceActivities: skips stays, routes, hubs, destinations", function () {
  var items = [
    { section: "Overnight stays", requiredPlaces: [ { place: "Reykjavik", _keep: true } ] },
    { section: "Drive scenic routes", type: "route", requiredPlaces: [ { place: "Golden Circle", _keep: false } ] },
    { section: "More places to consider", requiredPlaces: [
      { place: "Geysir", _keep: false, _origin: "max" },
      { place: "Grundarfjordur", _keep: false, _autoCreated: true },  // a hub
      { place: "Vik", _keep: false, _origin: "max" }                  // also a destination
    ] }
  ];
  var m = DiscoveryModel.fromPlaceActivities(items, {
    isStaySection: function (s) { return s === "Overnight stays"; },
    isDestination: function (p) { return p.place === "Vik"; }
  });
  var names = m.all().map(function (p) { return p.place; });
  assert.deepStrictEqual(names, ["Geysir"], "only the genuine unchecked sight is ingested");
});

test("fromPlaceActivities: catchall vs theme drives placement", function () {
  var items = [
    { section: "Chase waterfalls", requiredPlaces: [ { place: "Skogafoss", _keep: false, _origin: "max" } ] },
    { section: "More places to consider", requiredPlaces: [ { place: "Geysir", _keep: false, _origin: "max" } ] },
    { section: "Sights near places you listed", requiredPlaces: [ { place: "Kerid", _keep: false, _origin: "max" } ] }
  ];
  var m = DiscoveryModel.fromPlaceActivities(items, {});
  assert.strictEqual(Policy.sectionFor(m._findExisting({ place: "Skogafoss" })), "Chase waterfalls");
  assert.strictEqual(Policy.sectionFor(m._findExisting({ place: "Geysir" })), S.MORE);
  assert.strictEqual(Policy.sectionFor(m._findExisting({ place: "Kerid" })), S.SIGHTS_NEAR);
});

test("consideredKeyedSet: keyed shape, deduped, section-tagged", function () {
  var items = [
    { section: "More places to consider", requiredPlaces: [
      { place: "Þingvellir", _keep: false, _origin: "max", lat: 64.25, lng: -21.13 } ] },
    { section: "See natural wonders", requiredPlaces: [
      // same coords, qualified name → MUST dedupe to ONE considered entry
      { place: "Þingvellir National Park", _keep: false, _origin: "max", lat: 64.25, lng: -21.13 } ] }
  ];
  var m = DiscoveryModel.fromPlaceActivities(items, {});
  var set = m.consideredKeyedSet();
  assert.strictEqual(Object.keys(set).length, 1, "the two variants collapse to one considered place");
  // and it lands in the theme (themeFit wins over the catchall).
  var only = set[Object.keys(set)[0]];
  assert.strictEqual(only.section, "See natural wonders");
});

// ── ROUTE UMBRELLAS: folded into the model (PD.401e) ─────────────────
test("route umbrella: a named loop is recognized", function () {
  assert.strictEqual(M.isRouteUmbrella("Golden Circle"), true);
  assert.strictEqual(M.isRouteUmbrella("Ring Road"), true);
  assert.strictEqual(M.isRouteUmbrella("Diamond Circle"), true);
  assert.strictEqual(M.isRouteUmbrella("Skogafoss"), false);
});

test("route umbrella: lands in Drive scenic routes, NOT From your list", function () {
  var m = model([
    { place: "Golden Circle", origin: "user", role: "sight", decision: "unchecked" }
  ]);
  assert.strictEqual(Policy.sectionFor(m.all()[0]), S.SCENIC);
});

test("route umbrella: excluded from the considered count", function () {
  var m = model([
    { place: "Golden Circle", origin: "user", role: "sight", decision: "unchecked" },
    { place: "Geysir", origin: "max", role: "sight", decision: "unchecked" }
  ]);
  assert.strictEqual(m.considered().length, 1, "only Geysir is considered; the route umbrella is not");
  assert.strictEqual(m.considered()[0].place, "Geysir");
});

test("route umbrella: a themed place keeps its theme (not hijacked to scenic)", function () {
  // If the LLM gave a route-named place a real theme, respect it.
  var m = model([
    { place: "Golden Circle", origin: "max", role: "sight", decision: "unchecked", themeFit: "See natural wonders" }
  ]);
  assert.strictEqual(Policy.sectionFor(m.all()[0]), "See natural wonders");
});

test("PD.404: catchallSections / isCatchallSection expose the themeFit-null set", function () {
  var cs = M.catchallSections();
  // The four sections the model places themeFit-null sights into, INCLUDING
  // the generic "Sights you're keeping" bucket (which SectionKind omits).
  ["Sights near places you listed", "More places to consider", "From your list", "Sights you're keeping"]
    .forEach(function (s) { assert.ok(cs.indexOf(s) !== -1, "missing catchall: " + s); });
  assert.strictEqual(M.isCatchallSection("Sights you're keeping"), true);
  assert.strictEqual(M.isCatchallSection("Walk to natural wonders"), false);
  // It must agree with the placement policy: a checked sight with no themeFit
  // lands in a section isCatchallSection() reports true for.
  var m = model([{ place: "Goðafoss", origin: "user", role: "sight", decision: "checked" }]);
  assert.strictEqual(M.isCatchallSection(Policy.sectionFor(m.all()[0])), true);
});

test("PD.404: a per-place _themeFit splits one grouped catch-all item across themes", function () {
  // One "Sights you're keeping" item with three places, each carrying its own
  // _themeFit (stamped by the theming pass). The model must place each in its
  // own theme — not leave them grouped.
  var m = M.DiscoveryModel.fromPlaceActivities([
    { section: "Sights you're keeping", type: "activity", requiredPlaces: [
      { place: "Gullfoss", _keep: true, _themeFit: "Visit natural wonders" },
      { place: "Reynisfjara Beach", _keep: true, _themeFit: "Walk the coast" },
      { place: "Harpa Concert Hall", _keep: true, _themeFit: "Explore the capital" }
    ] }
  ], {});
  var secs = {};
  m.sections().forEach(function (g) { secs[g.section] = g.places.map(function (p) { return p.place; }); });
  assert.deepStrictEqual(secs["Visit natural wonders"], ["Gullfoss"]);
  assert.deepStrictEqual(secs["Walk the coast"], ["Reynisfjara Beach"]);
  assert.deepStrictEqual(secs["Explore the capital"], ["Harpa Concert Hall"]);
  assert.ok(!secs["Sights you're keeping"], "nothing should remain in the catch-all");
});

test("PD.404: a per-place _themeFit SURVIVES canonicalize + model placement (persistence)", function () {
  // The theming pass stamps _themeFit on places sitting in a catch-all.
  // It must survive the write-door canonicalizer AND the dedupe-merge with
  // an enhance duplicate, then place the sight in its theme on render.
  global.SectionKind = (function () { try { var sk = require("../section-kind.js"); return sk.SectionKind || sk; } catch (_) { return undefined; } })();
  global.MaxDiscovery = M;
  var canon = require("../max-data.js").canonicalizePlaceActivities
    || (global.MaxData && global.MaxData.canonicalizePlaceActivities);
  assert.strictEqual(typeof canon, "function", "canonicalizePlaceActivities must be available");
  var pa = [
    { section: "Sights you're keeping", type: "activity", name: "keep", requiredPlaces: [
      { place: "Gullfoss", country: "Iceland", lat: 64.3, lng: -20.1, _keep: true, _themeFit: "Visit natural wonders" } ] },
    // an enhance leftover duplicate with NO theme — the merge must not strip the theme
    { section: "Sights near places you listed", type: "activity", name: "near", requiredPlaces: [
      { place: "Gullfoss", country: "Iceland", lat: 64.3, lng: -20.1, _keep: false } ] }
  ];
  var out = canon(pa);
  var m2 = M.DiscoveryModel.fromPlaceActivities(out, {});
  var secs = {};
  m2.sections().forEach(function (g) { secs[g.section] = g.places.map(function (p) { return p.place; }); });
  assert.deepStrictEqual(secs["Visit natural wonders"], ["Gullfoss"], "themed sight must land in its theme after canonicalize+merge");
  assert.ok(!secs["Sights you're keeping"], "must not remain in the catch-all");
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
