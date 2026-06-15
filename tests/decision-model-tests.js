// tests/decision-model-tests.js — P4: the decision/projection core.
//
// PROPERTY tests over the keep rule + role projection. These pin the exact
// behavior proven LIVE in the prior slices, so when the live app is cut over to
// this module the swap is provably behavior-preserving:
//   • a Max suggestion the user never touched arrives UNCHECKED ("Max checks
//     nothing" — Reykjahlíð), a listed place arrives CHECKED.
//   • a user decision (keep OR drop) is honored verbatim and is DURABLE.
//   • a reject is unchecked regardless of origin.
//   • the projection is pure: deriving never mutates facts or decisions.

"use strict";

var assert = require("assert");
var MD = require("../decision-model.js");
var Decisions = MD.Decisions;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + (e && e.message)); }
}

var USER = { origin: "user", kind: "destination" };
var MAXHUB = { origin: "max-hub", kind: "destination" };
var MAXSIGHT = { origin: "max", kind: "sight" };

console.log("decision-model-tests — P4\n");

// ── keep rule: the defaults (no decision) ─────────────────────────────
test("undecided user place defaults CHECKED", function () {
  assert.strictEqual(MD.keepOf(USER, null), true);
});
test("undecided Max hub defaults UNCHECKED (Max checks nothing)", function () {
  assert.strictEqual(MD.keepOf(MAXHUB, null), false);
});
test("undecided Max sight defaults UNCHECKED", function () {
  assert.strictEqual(MD.keepOf(MAXSIGHT, null), false);
});
test("unknown origin is treated as Max (defaults unchecked)", function () {
  assert.strictEqual(MD.keepOf({ kind: "sight" }, null), false);
});

// ── keep rule: a user decision wins, both directions, durably ─────────
test("user committing a Max hub checks it", function () {
  var d = new MD.Decision({ kept: true });
  assert.strictEqual(MD.keepOf(MAXHUB, d), true);
});
test("user dropping a listed place unchecks it (uncheck is durable)", function () {
  var d = new MD.Decision({ kept: false });
  assert.strictEqual(MD.keepOf(USER, d), false);
});
test("a reject is unchecked regardless of origin", function () {
  assert.strictEqual(MD.keepOf(USER, new MD.Decision({ rejected: true })), false);
  assert.strictEqual(MD.keepOf(MAXHUB, new MD.Decision({ kept: true, rejected: true })), false);
});

// ── the decision LOG is the one write surface, and it's durable ───────
test("Decisions.set records a durable, retrievable decision by identity", function () {
  var D = new Decisions();
  assert.strictEqual(D.decided("Höfn"), false);
  D.set("Höfn", { kept: false });
  assert.strictEqual(D.decided("Höfn"), true);
  assert.strictEqual(D.get("Höfn").kept, false);
  // identity is normalized (case/space-insensitive)
  assert.strictEqual(D.get("  höfn ").kept, false);
});
test("clearing a decision returns the place to its default", function () {
  var D = new Decisions();
  D.set("Reykjahlíð", { kept: true });
  assert.strictEqual(MD.keepOf(MAXHUB, D.get("Reykjahlíð")), true);
  D.clear("Reykjahlíð");
  assert.strictEqual(MD.keepOf(MAXHUB, D.get("Reykjahlíð")), false, "back to Max-default unchecked");
});

// ── end-to-end: a realistic decision set projects correctly ───────────
test("a mixed set projects exactly like the live app does", function () {
  var D = new Decisions();
  // facts for a few places
  var facts = {
    "Selfoss":     { origin: "user", kind: "destination" },   // listed stay
    "Reykjahlíð":  { origin: "max-hub", kind: "destination" },// Max base
    "Goðafoss":    { origin: "max", kind: "sight" },          // Max sight
    "Höfn":        { origin: "user", kind: "destination" }    // listed, user drops it
  };
  D.set("Höfn", { kept: false });          // user unchecks a listed base
  D.set("Reykjahlíð", { kept: true });     // user commits a Max base
  var keep = {};
  Object.keys(facts).forEach(function (name) { keep[name] = MD.keepOf(facts[name], D.get(name)); });
  assert.deepStrictEqual(keep, {
    "Selfoss": true,       // listed, untouched → checked
    "Reykjahlíð": true,    // Max base, user committed → checked
    "Goðafoss": false,     // Max sight, untouched → unchecked
    "Höfn": false          // listed, user dropped → unchecked
  });
});

// ── purity: projecting never mutates inputs ───────────────────────────
test("projection is pure — facts and decision are untouched", function () {
  var facts = Object.freeze({ origin: "user", kind: "destination", role: "stay" });
  var dec = new MD.Decision({ kept: true, role: "see" });
  var snapshot = JSON.stringify(dec);
  var v = MD.project(facts, dec);          // must not throw on frozen facts
  assert.strictEqual(v.keep, true);
  assert.strictEqual(v.role, "see");       // decided role wins
  assert.strictEqual(JSON.stringify(dec), snapshot, "decision not mutated");
});

test("role projection: decided > fact > kind default", function () {
  assert.strictEqual(MD.roleOf({ role: "stay" }, new MD.Decision({ role: "daytrip" })), "daytrip");
  assert.strictEqual(MD.roleOf({ role: "stay" }, null), "stay");
  assert.strictEqual(MD.roleOf({ kind: "destination" }, null), "stay");
  assert.strictEqual(MD.roleOf({ kind: "sight" }, null), "see");
});

// ── P4.4c: a wayside's leg is a decision attribute ────────────────────
test("Decision.leg defaults to null when unspecified", function () {
  assert.strictEqual(new MD.Decision({}).leg, null);
  assert.strictEqual(new MD.Decision({ role: "onway" }).leg, null);
});
test("Decision.leg captures {fromPlace,toPlace} verbatim", function () {
  var d = new MD.Decision({ role: "onway", leg: { fromPlace: "Reykjavik", toPlace: "Vik" } });
  assert.deepStrictEqual(d.leg, { fromPlace: "Reykjavik", toPlace: "Vik" });
});
test("Decision.leg normalizes a half-specified or empty leg", function () {
  assert.deepStrictEqual(new MD.Decision({ leg: { fromPlace: "Selfoss" } }).leg, { fromPlace: "Selfoss", toPlace: "" });
  assert.strictEqual(new MD.Decision({ leg: {} }).leg, null);          // empty → null
  assert.strictEqual(new MD.Decision({ leg: { fromPlace: "", toPlace: "" } }).leg, null);
  assert.strictEqual(new MD.Decision({ leg: "Reykjavik->Vik" }).leg, null); // non-object → null
});
test("Decision.leg survives the log round-trip (set → get)", function () {
  var D = new Decisions();
  D.set("Seljalandsfoss", { role: "onway", leg: { fromPlace: "Reykjavik", toPlace: "Vik" } });
  assert.deepStrictEqual(D.get("Seljalandsfoss").leg, { fromPlace: "Reykjavik", toPlace: "Vik" });
  // identity normalized (case/space-insensitive), like the other fields
  assert.deepStrictEqual(D.get("  seljalandsfoss ").leg, { fromPlace: "Reykjavik", toPlace: "Vik" });
});
test("Decision.leg is a COPY — mutating it never bleeds across decisions", function () {
  var src = { fromPlace: "A", toPlace: "B" };
  var d = new MD.Decision({ leg: src });
  d.leg.fromPlace = "X";
  assert.strictEqual(src.fromPlace, "A", "input leg object not mutated");
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
