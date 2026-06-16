// tests/candidates-snapshot-tests.js — PD.456 (perfect-model #1/#4/#5).
//
// trip.candidates is the PERSISTED snapshot of the working model. It must be
// born from ONE pure projection (MaxCandidates.snapshotFrom) so it can never
// drift from what _mirrorCandToTrip keeps in step. These are PROPERTY tests:
// they assert invariants over arbitrary candidate inputs, not one fixed case.

"use strict";

var assert = require("assert");
require("../geography-model.mjs");
var MC = globalThis.MaxCandidates;

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + (e && e.message)); }
}

// The durable field subset the snapshot must carry verbatim (the user's
// decision survives reload). _roleTouched is critical: without it the trip-view
// predictor can silently downgrade a committed Stay to a Day trip.
var DECISION_FIELDS = ["role", "status", "_roleTouched", "intent", "dayTripHub", "waysideFromHub"];

// PD.456: the publish projection used to DROP order/manuallyOrdered that the
// applyCandidateChanges projection kept — the two snapshot births diverged.
// One function now carries both, so the manual order survives a publish too.
test("snapshot carries manual ordering (publish no longer drops it)", function () {
  var c = { id: "o1", place: "Vík", role: "stay", order: 3, manuallyOrdered: true };
  var s = MC.snapshotOf(c);
  assert.strictEqual(s.order, 3, "order preserved");
  assert.strictEqual(s.manuallyOrdered, true, "manuallyOrdered preserved");
  var d = MC.snapshotOf({ id: "o2", place: "Höfn" });
  assert.strictEqual(d.order, null, "absent order → null");
  assert.strictEqual(d.manuallyOrdered, false, "absent manuallyOrdered → false");
});

// a spread of working candidates, including the decision permutations
var SAMPLES = [
  { id: "c0", place: "Selfoss", role: "stay", status: "keep", _roleTouched: true, overnightCapable: true, nights: 2 },
  { id: "c1", place: "Gullfoss", role: "see", status: "keep", _roleTouched: true },
  { id: "c2", place: "Landmannalaugar", role: "daytrip", status: "keep", _roleTouched: true, intent: "dayTrip", dayTripHub: "vík" },
  { id: "c3", place: "Vík", role: "onway", status: "keep", _roleTouched: true, intent: "wayside", waysideFromHub: "selfoss" },
  { id: "c4", place: "Höfn", role: null, status: null, _roleTouched: false },
  { id: "c5", place: "Reykjahlíð", role: "stay", status: "reject", _roleTouched: true, _required: true, _requiredFor: ["Mývatn"] }
];

console.log("candidates-snapshot-tests — PD.456\n");

test("module present", function () {
  assert.ok(MC && typeof MC.snapshotFrom === "function" && typeof MC.snapshotOf === "function");
});

test("snapshot preserves every decision field verbatim", function () {
  SAMPLES.forEach(function (c) {
    var s = MC.snapshotOf(c);
    DECISION_FIELDS.forEach(function (f) {
      // normalize undefined/null/"" the way the projection does, then compare intent
      var want = c[f];
      if (f === "_roleTouched") { assert.strictEqual(s._roleTouched, !!want, c.place + "._roleTouched"); return; }
      if (want == null || want === "") { assert.ok(s[f] == null || s[f] === "", c.place + "." + f + " stays empty"); return; }
      assert.strictEqual(s[f], want, c.place + "." + f);
    });
  });
});

test("snapshotFrom preserves count and order (drops nothing)", function () {
  var out = MC.snapshotFrom(SAMPLES);
  assert.strictEqual(out.length, SAMPLES.length);
  out.forEach(function (s, i) { assert.strictEqual(s.place, SAMPLES[i].place); });
});

test("projection is idempotent (snapshot of a snapshot is identical)", function () {
  SAMPLES.forEach(function (c) {
    var once = MC.snapshotOf(c);
    var twice = MC.snapshotOf(once);
    DECISION_FIELDS.forEach(function (f) {
      assert.deepStrictEqual(twice[f], once[f], c.place + "." + f + " idempotent");
    });
    assert.strictEqual(twice.place, once.place);
    assert.strictEqual(twice.id, once.id);
  });
});

test("snapshot is a COPY — mutating it never touches the working candidate", function () {
  var c = { id: "x", place: "Akureyri", role: "stay", status: "keep", _roleTouched: true };
  var s = MC.snapshotOf(c);
  s.role = "see"; s.status = "reject"; s._roleTouched = false;
  assert.strictEqual(c.role, "stay", "working role untouched");
  assert.strictEqual(c.status, "keep", "working status untouched");
  assert.strictEqual(c._roleTouched, true, "working _roleTouched untouched");
});

test("_requiredFor is cloned, not shared", function () {
  var c = { id: "y", place: "Mývatn", _required: true, _requiredFor: ["a", "b"] };
  var s = MC.snapshotOf(c);
  s._requiredFor.push("c");
  assert.strictEqual(c._requiredFor.length, 2, "working array not mutated through the snapshot");
});

test("empty / non-array input yields empty snapshot", function () {
  assert.deepStrictEqual(MC.snapshotFrom([]), []);
  assert.deepStrictEqual(MC.snapshotFrom(null), []);
  assert.deepStrictEqual(MC.snapshotFrom(undefined), []);
});

console.log("\n──────────────────────────────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
