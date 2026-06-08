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

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
