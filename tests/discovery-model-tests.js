// tests/discovery-model-tests.js — PD.400: the re-architected domain.
//
// Pins the contract of the new DiscoveryModel: ONE source of truth,
// ONE writer, ONE pure placement policy, pure queries that can't
// disagree. Every recurring bug from the pass-chain era is expressed
// here as a property the model holds BY CONSTRUCTION.

"use strict";

var assert = require("assert");
global.PlaceKey = require("../place-key.mjs").default;
var M = require("../discovery-model.mjs").default;
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
test("placement: checked sight with NO theme → pools into shared 'Unique sights' (PD.406, reverses PD.405)", function () {
  // PD.406: a kept sight the categorizer missed pools into the shared "Unique
  // sights" bucket — it does NOT get its own self-named single-member category
  // ("Kirkjufell (1)" / "Húsavík (1)" read as noise and break the chip math).
  assert.strictEqual(Policy.sectionFor({ place: "Goðafoss Waterfall", role: "sight", decision: "checked", themeFit: null }), S.UNIQUE);
});
test("placement: checked sight with NO theme AND no name → 'Unique sights' fallback", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "checked", themeFit: null }), S.UNIQUE);
});
test("placement: unchecked sight with a theme → that theme (shown unchecked)", function () {
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", themeFit: "Relax in hot springs" }), "Relax in hot springs");
});
test("placement: unchecked USER sight, no theme → More places to consider (PD.405: 'From your list' removed)", function () {
  // PD.405: listed places are always checked (the contract), so there is no
  // dedicated unchecked-user bucket; an unchecked sight falls through like any.
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", origin: "user", themeFit: null }), S.MORE);
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
  // PD.406: a checked, un-themed sight pools into the shared "Unique sights"
  // bucket — never a generic to-consider catchall, and never a self-named
  // single-member category.
  var own = m.sections().find(function (x) { return x.section === "Geysir"; });
  assert.ok(!own, "the checked sight does NOT get a self-named category");
  var uniq = m.sections().find(function (x) { return x.section === S.UNIQUE; });
  assert.ok(uniq && uniq.places.length === 1, "the checked sight pools into 'Unique sights'");
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

test("PD.404/405: catchallSections / isCatchallSection expose the themeFit-null set", function () {
  var cs = M.catchallSections();
  // The four sections the model treats as carrying no theme, INCLUDING the
  // "Unique sights" fallback (which SectionKind omits).
  ["Sights near places you listed", "More places to consider", "From your list", "Unique sights"]
    .forEach(function (s) { assert.ok(cs.indexOf(s) !== -1, "missing catchall: " + s); });
  assert.strictEqual(M.isCatchallSection("Unique sights"), true);
  assert.strictEqual(M.isCatchallSection("Walk to natural wonders"), false);
  // PD.406: a checked, un-themed NAMED sight pools into "Unique sights" (a
  // catchall) — NOT its own self-named single-member category.
  var named = model([{ place: "Goðafoss", origin: "user", role: "sight", decision: "checked" }]);
  assert.strictEqual(Policy.sectionFor(named.all()[0]), "Unique sights");
  assert.strictEqual(M.isCatchallSection(Policy.sectionFor(named.all()[0])), true);
  // A nameless checked miss falls back to "Unique sights", which IS a catchall.
  assert.strictEqual(M.isCatchallSection(Policy.sectionFor({ role: "sight", decision: "checked", themeFit: null })), true);
});

test("PD.404: a per-place _themeFit splits one grouped catch-all item across themes", function () {
  // One grouped catch-all item with three places, each carrying its own
  // _themeFit (stamped by the theming pass). The model must place each in its
  // own theme — not leave them grouped.
  var m = M.DiscoveryModel.fromPlaceActivities([
    { section: "Unique sights", type: "activity", requiredPlaces: [
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
  assert.ok(!secs["Unique sights"], "nothing should remain in the catch-all");
});

test("PD.404: a per-place _themeFit SURVIVES canonicalize + model placement (persistence)", function () {
  // The theming pass stamps _themeFit on places sitting in a catch-all.
  // It must survive the write-door canonicalizer AND the dedupe-merge with
  // an enhance duplicate, then place the sight in its theme on render.
  global.SectionKind = (function () { try { var sk = require("../section-kind.mjs").default; return sk.SectionKind || sk; } catch (_) { return undefined; } })();
  global.MaxDiscovery = M;
  var canon = require("../max-data.js").canonicalizePlaceActivities
    || (global.MaxData && global.MaxData.canonicalizePlaceActivities);
  assert.strictEqual(typeof canon, "function", "canonicalizePlaceActivities must be available");
  var pa = [
    { section: "Unique sights", type: "activity", name: "keep", requiredPlaces: [
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
  assert.ok(!secs["Unique sights"], "must not remain in the catch-all");
});

// ── Phase 1: PlacementRule registry (open/closed extension point) ────
test("PlacementPolicy: default rule chain reproduces the historical sectionFor", function () {
  assert.strictEqual(Policy.sectionFor({ role: "stay", origin: "user" }), S.STAYS_USER);
  assert.strictEqual(Policy.sectionFor({ role: "stay", origin: "max-hub" }), S.STAYS_REC);
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "checked", themeFit: "Chase waterfalls" }), "Chase waterfalls");
  // PD.406: a checked, un-themed sight pools into "Unique sights" (no self-named category).
  assert.strictEqual(Policy.sectionFor({ place: "Goðafoss", role: "sight", decision: "checked" }), S.UNIQUE);
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "checked" }), S.UNIQUE);
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", themeFit: "Relax" }), "Relax");
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked", nearListed: true }), S.SIGHTS_NEAR);
  assert.strictEqual(Policy.sectionFor({ role: "sight", decision: "unchecked" }), S.MORE);
  assert.ok(Array.isArray(Policy.rules) && Policy.rules.length >= 8, "rules are an ordered registry");
});

test("PlacementPolicy.addRule: a new category wins over the catch-all, then resetRules restores", function () {
  var spa = { role: "sight", decision: "unchecked", place: "Blue Lagoon", tags: ["spa"] };
  assert.strictEqual(Policy.sectionFor(spa), S.MORE, "unthemed sight defaults to More");
  Policy.addRule({ id: "spa", match: function (p) { return p.tags && p.tags.indexOf("spa") !== -1; },
    section: function () { return "Relax in hot springs"; } });
  try {
    assert.strictEqual(Policy.sectionFor(spa), "Relax in hot springs", "the registered rule places the spa sight");
    assert.strictEqual(Policy.sectionFor({ role: "stay", origin: "user" }), S.STAYS_USER, "built-in rules still win first");
  } finally {
    Policy.resetRules();
  }
  assert.strictEqual(Policy.sectionFor(spa), S.MORE, "resetRules restores the default chain");
});

// ── Phase 1: change events (observer pattern) ────────────────────────
test("model emits 'change' on upsert/setDecision/setRole/setTheme; off() unsubscribes", function () {
  var m = new DiscoveryModel();
  var events = [];
  var unsub = m.on("change", function (e) { events.push(e.type); });
  m.upsert({ place: "Geysir", decision: "unchecked" });
  m.setDecision("Geysir", "checked");
  m.setRole("Geysir", "sight");
  m.setTheme("Geysir", "See natural wonders");
  assert.deepStrictEqual(events, ["upsert", "decision", "role", "theme"]);
  unsub();
  m.setDecision("Geysir", "unchecked");
  assert.strictEqual(events.length, 4, "no events after unsubscribe");
});

test("setTheme re-places the sight into its new theme (single writer)", function () {
  var m = new DiscoveryModel();
  m.upsert({ place: "Reynisfjara", role: "sight", decision: "unchecked" });
  assert.strictEqual(Policy.sectionFor(m.all()[0]), S.MORE);
  m.setTheme("Reynisfjara", "Walk the coast");
  assert.strictEqual(Policy.sectionFor(m.all()[0]), "Walk the coast");
});

// ── Phase 1: snapshot()/restore() round-trip ─────────────────────────
test("snapshot()/restore() is plain-serializable and round-trips the queries", function () {
  var m = new DiscoveryModel();
  m.upsert({ place: "Gullfoss", role: "sight", decision: "checked", themeFit: "See natural wonders", coords: { lat: 64.3, lng: -20.1 } });
  m.upsert({ place: "Geysir", role: "sight", decision: "unchecked", themeFit: "See natural wonders" });
  m.upsert({ place: "Vik", role: "stay", origin: "user" });
  var snap = JSON.parse(JSON.stringify(m.snapshot())); // proves it's plain JSON
  var r = DiscoveryModel.restore(snap);
  assert.strictEqual(r.considered().length, m.considered().length, "considered round-trips");
  assert.strictEqual(r.committed().length, m.committed().length, "committed round-trips");
  var a = m.sections().map(function (g) { return g.section + ":" + g.places.length; }).join("|");
  var b = r.sections().map(function (g) { return g.section + ":" + g.places.length; }).join("|");
  assert.strictEqual(b, a, "sections round-trip identically");
});

// ── Identity: redundant geographic-feature variants merge (proliferation fix) ──
test("sameEntity MERGES a bare name with its natural-feature variant", function () {
  [["Goðafoss", "Goðafoss Waterfall"], ["Strokkur", "Strokkur Geyser"],
   ["Kerið", "Kerið Crater"], ["Kerið Crater", "Kerið Crater Lake"],
   ["Þingvellir", "Þingvellir National Park"], ["Krafla", "Krafla Volcano"],
   ["Stokksnes", "Stokksnes Peninsula"], ["Falljökull", "Falljökull Glacier"]
  ].forEach(function (p) {
    assert.ok(M.sameEntity({ place: p[0] }, { place: p[1] }), "should merge: " + p[0] + " ↔ " + p[1]);
    assert.ok(M.sameEntity({ place: p[1] }, { place: p[0] }), "merge must be symmetric: " + p[1] + " ↔ " + p[0]);
  });
});

test("sameEntity does NOT merge a place with a distinct CIVIC/POI at that place", function () {
  [["Reykjavik", "Reykjavik Maritime Museum"], ["Krafla", "Krafla Power Station"],
   ["Reykjavik", "Reykjavik Old Harbour"], ["Hallgrímskirkja", "Hallgrímskirkja Church"]
  ].forEach(function (p) {
    assert.ok(!M.sameEntity({ place: p[0] }, { place: p[1] }), "must NOT merge: " + p[0] + " ↔ " + p[1]);
  });
});

test("sameEntity does NOT merge two different features that merely share a name head", function () {
  assert.ok(!M.sameEntity({ place: "Garðskagi Lighthouse" }, { place: "Garðskagi Peninsula" }));
  assert.ok(!M.sameEntity({ place: "Krafla Volcano" }, { place: "Krafla Fissure" }));
});

test("PD.438: a USER base and a USER sight never merge, even with matching name + coords", function () {
  var C = { lat: 64.0167, lng: -16.9667 };
  // The real bug: you listed Skaftafell as an overnight base AND listed a glacier
  // sight that shares its name and geocodes to the same point. Both are YOURS and
  // are DIFFERENT entities — the base must not be absorbed into the sight.
  assert.ok(!M.sameEntity({ place: "Skaftafell", coords: C, kind: "stay", source: "user" },
                          { place: "Skaftafell glacier region", coords: C, kind: "sight", source: "user" }),
    "user base vs user sight must NOT merge");
  assert.ok(!M.sameEntity({ place: "Skaftafell glacier region", coords: C, role: "see", _origin: "user" },
                          { place: "Skaftafell", coords: C, role: "stay", _origin: "user" }),
    "veto is symmetric and reads role + _origin too");
  // ORIGIN-GATED: a MAX suggestion still merges into your base (user kind wins,
  // Max's kind-claim doesn't split your place).
  assert.ok(M.sameEntity({ place: "Skaftafell", coords: C, kind: "stay", source: "user" },
                         { place: "Skaftafell", coords: C, kind: "sight", source: "max" }),
    "a user base still absorbs a Max same-name sight (not both user)");
  // Same kind still merges (the base-name + feature variant within sights).
  assert.ok(M.sameEntity({ place: "Goðafoss", kind: "sight", source: "user" }, { place: "Goðafoss Waterfall", kind: "sight", source: "user" }),
    "two SIGHTS that are name-variants still merge");
  // No kind/origin supplied → behavior unchanged (the veto is additive).
  assert.ok(M.sameEntity({ place: "Skaftafell", coords: C }, { place: "Skaftafell glacier region", coords: C }),
    "without explicit kind/origin, the old name/coord merge still applies");
});

test("PD.440: an EXACT-name base and sight are the same place; only DIFFERENT names are vetoed", function () {
  var My = { lat: 65.6, lng: -17.0 };
  // Exact same name → ONE place, merges (the base absorbs a stray same-name sight).
  assert.ok(M.sameEntity({ place: "Lake Mývatn", coords: My, kind: "stay",  source: "user" },
                         { place: "Lake Mývatn", coords: My, kind: "sight", source: "user" }),
    "an exact-name base and sight are the same place (base wins the merge)");
  // Different names with conflicting kinds → still vetoed (genuinely distinct).
  var Sk = { lat: 64.0167, lng: -16.9667 };
  assert.ok(!M.sameEntity({ place: "Skaftafell", coords: Sk, kind: "stay",  source: "user" },
                          { place: "Skaftafell glacier region", coords: Sk, kind: "sight", source: "user" }),
    "a base and a differently-named sight stay distinct");
});

test("PD.438: dedupeListedNames keeps a base and a same-named sight SEPARATE", function () {
  var MD = require("../max-data.js");
  var dd = MD.dedupeListedNames || (global.MaxData && global.MaxData.dedupeListedNames);
  // "Goðafoss"(base) + "Goðafoss Waterfall"(sight) are a name-variant that
  // sameEntity merges name-only — but they're DIFFERENT roles, so they must
  // stay as two distinct listed places (the base isn't renamed into the sight).
  var out = dd({ "goðafoss": "stay", "goðafoss waterfall": "see" },
               { "goðafoss": "Goðafoss", "goðafoss waterfall": "Goðafoss Waterfall" });
  assert.strictEqual(Object.keys(out.names).length, 2, "a base and a same-named sight remain two distinct listed places");
  assert.strictEqual(out.names["goðafoss"], "stay");
  assert.strictEqual(out.names["goðafoss waterfall"], "see");
  // Same role still merges (two sights that are name-variants collapse to one).
  var out2 = dd({ "goðafoss": "see", "goðafoss waterfall": "see" },
                { "goðafoss": "Goðafoss", "goðafoss waterfall": "Goðafoss Waterfall" });
  assert.strictEqual(Object.keys(out2.names).length, 1, "two SIGHTS that are name-variants still merge to one");
});

test("feature-variant merge is VETOED when coords are far apart (same head, different place)", function () {
  var town = { place: "Vík", coords: { lat: 63.42, lng: -19.0 } };
  var far  = { place: "Vík Beach", coords: { lat: 64.8, lng: -18.0 } }; // ~150 km away
  assert.ok(!M.sameEntity(town, far), "far coords must veto the name-variant merge");
  var near = { place: "Vík Beach", coords: { lat: 63.41, lng: -19.01 } };
  assert.ok(M.sameEntity(town, near), "near coords allow the merge");
});

test("coord veto blocks a PK.same token-overlap merge of two DISTINCT places", function () {
  // Live regression: these two real parks are 140 km apart but share the
  // generic tokens "National Park"; PK.same called them identical and one pin
  // vanished. The ground-truth coord veto must keep them distinct.
  var snae = { place: "Snæfellsjökull National Park", coords: { lat: 64.80, lng: -23.78 } };
  var thing = { place: "Þingvellir National Park",      coords: { lat: 64.26, lng: -21.13 } };
  assert.ok(!M.sameEntity(snae, thing), "far-apart parks sharing generic tokens must NOT merge");
  assert.ok(!M.sameEntity(thing, snae), "veto must be symmetric");
});

test("distinctive-token conflict blocks merging two same-city, same-category POIs", function () {
  // Live regression: PK.same merged these on shared "reykjavík"+"museum", both
  // in the old harbour so coords couldn't separate them — one pin vanished.
  var maritime = { place: "Reykjavík Maritime Museum",        coords: { lat: 64.155, lng: -21.95 } };
  var art      = { place: "Reykjavík Art Museum Hafnarhús",   coords: { lat: 64.149, lng: -21.94 } };
  assert.ok(!M.sameEntity(maritime, art), "maritime vs art museum must NOT merge");
  assert.ok(!M.sameEntity(art, maritime), "veto must be symmetric");
  // But a bare name + its generic-feature variant still merges (no conflict).
  assert.ok(M.sameEntity({ place: "Goðafoss" }, { place: "Goðafoss Waterfall" }), "feature variant unaffected");
});

test("coord veto does NOT fire when coords agree or are absent (names still merge)", function () {
  // Same park, two geocodes within tolerance → still one entity.
  var a = { place: "Þingvellir National Park", coords: { lat: 64.255, lng: -21.13 } };
  var b = { place: "Þingvellir",               coords: { lat: 64.256, lng: -21.131 } };
  assert.ok(M.sameEntity(a, b), "near coords + name relation still merge");
  // No coords → fall back to name identity (unchanged behaviour).
  assert.ok(M.sameEntity({ place: "Goðafoss" }, { place: "Goðafoss Waterfall" }), "missing coords → name rules apply");
});

test("upsert dedups feature-variants into ONE place (proliferation impossible at the write door)", function () {
  var m = new DiscoveryModel();
  m.upsert({ place: "Goðafoss", role: "sight", decision: "unchecked" });
  m.upsert({ place: "Goðafoss Waterfall", role: "sight", decision: "unchecked" });
  m.upsert({ place: "Strokkur Geyser", role: "sight", decision: "unchecked" });
  m.upsert({ place: "Strokkur", role: "sight", decision: "unchecked" });
  assert.strictEqual(m.all().length, 2, "variants must collapse to 2 distinct places, got " + m.all().length);
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
