// tests/containment-tests.mjs — #Place model, Phase B (OBJECT-MODEL.md G4).
//
// The SUBJECTIVE itinerary relation ("explored-from") is being made an explicit
// edge (decision-model.exploredFromOf), derived from a place record's signals.
// This proves the new edge NEVER CONTRADICTS the existing derivation
// (geography-model._geographyOf): for every role + flag-fallback case, coarsening
// the edge back to the legacy geography vocabulary reproduces _geographyOf's kind
// (and hub). That faithfulness is the precondition for later making the edge the
// source of truth and retiring the loose _dayTripHub/_waysideFromHub strings.
//
// Run: node tests/containment-tests.mjs
"use strict";
import assert from "assert";
import MD from "../decision-model.mjs";
await import("../geography-model.mjs"); // exposes globalThis._geographyOf
const geo = /** @type {any} */ (globalThis)._geographyOf;

var pass = 0, fail = 0;
function test(n, f) {
  try { f(); pass++; console.log("  ✓ " + n); }
  catch (e) { fail++; console.error("  ✗ " + n + " — " + (e && e.message)); }
}

// Object records (so _geographyOf needs no _tb lookup) spanning every case.
var cases = [
  { name: "stay → base",            rec: { place: "Reykjavik", role: "stay", _keep: true } },
  { name: "daytrip (hub)",          rec: { place: "Gullfoss", role: "daytrip", _dayTripHub: "Reykjavik", _keep: true } },
  { name: "onway (wayside)",        rec: { place: "Vik", role: "onway", _waysideFromHub: "Reykjavik", _keep: true } },
  { name: "see → trip",             rec: { place: "Thingvellir", role: "see", _keep: true } },
  { name: "rejected → none",        rec: { place: "X", role: "see", _rejected: true } },
  { name: "maybe (unkept) → none",  rec: { place: "Y", _keep: false } },
  { name: "flag-only daytrip",      rec: { place: "Z", _dayTripHub: "Akureyri", _keep: true } },
  { name: "flag-only wayside",      rec: { place: "W", _waysideFromHub: "Akureyri", _keep: true } },
  { name: "kept, no role → base",   rec: { place: "V", _keep: true } },
];

console.log("\n#Place Phase B — explored-from edges agree with _geographyOf");
cases.forEach(function (c) {
  test("coarsen(exploredFromOf) == _geographyOf.kind — " + c.name, function () {
    var edge = MD.exploredFromOf(c.rec);
    var coarse = MD.coarsenExploredFrom(edge);
    var g = geo(c.rec);
    assert.strictEqual(coarse, g.kind,
      "edge " + JSON.stringify(edge) + " → " + coarse + " but _geographyOf said " + g.kind);
    if (edge.kind === "daytrip") assert.strictEqual(edge.hub || "", g.hub || "", "hub mismatch");
  });
});

// The edge is GENERAL: an anchor is just a place reference, regardless of its own
// role — the model can express a sight anchoring a destination (national-park ⊃
// lodge) once geo-within (Phase C) populates it. Here we assert the edge shape is
// anchor-agnostic (no kind restriction on who the hub names).
test("explored-from edge is anchor-agnostic (general containment)", function () {
  var e = MD.exploredFromOf({ place: "lodge", role: "daytrip", _dayTripHub: "Yellowstone", _keep: true });
  assert.strictEqual(e.kind, "daytrip");
  assert.strictEqual(e.hub, "Yellowstone"); // anchor may itself be a sight/region
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
