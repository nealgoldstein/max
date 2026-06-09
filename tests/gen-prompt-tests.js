// tests/gen-prompt-tests.js — PD.402: the activity-generation prompt.
//
// gen-prompt.js was extracted VERBATIM from _generateActivitiesForPlaceImpl
// in index.html. These tests pin two things:
//   1. The structural contract — every block (user-list, brief, budget,
//      completeness, schema) appears, in order, with its HARD-CONSTRAINT
//      wording, and budget math is correct.
//   2. A byte-for-byte snapshot of the assembled prompt, so any future
//      edit to the prompt is a deliberate, reviewed change (regenerate
//      the snapshot with UPDATE_SNAPSHOT=1) rather than a silent drift.

"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var GP = require("../gen-prompt.js");

var pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ✓ " + name); }
  catch (e) { fail++; console.error("  ✗ " + name + " — " + e.message); }
}
console.log("gen-prompt-tests — PD.402\n");

// Representative inputs that exercise EVERY block.
var FULL = {
  place: "Iceland",
  ctx: "We want to complete the ring road, every stop, with kids.",
  briefBits: [
    "Duration: 10 days", "When: September", "Dates: 2026-09-01 to 2026-09-10",
    "Party: 2 adults, 2 kids", "Physical ability: moderate (knee)",
    "Pace: relaxed", "Stays: hotels", "Transport within region: rental car",
    "Hard limits: no red-eye flights", "Soft avoidances: crowds"
  ],
  budgetDays: 10,
  completeness: true,
  userList: [
    { place: "Reykjavik", isStay: true, nights: 3 },
    { place: "Vík", isStay: false },
    { place: "Akureyri", isStay: true }
  ],
  pmChips: ["food", "trains"],
  personalContext: "PERSONAL CONTEXT: traveling with grandparents.\n\n"
};
var MIN = {
  place: "Portugal", ctx: "", briefBits: [], budgetDays: null,
  completeness: false, userList: [], pmChips: [], personalContext: ""
};

// ── detectCompleteness ─────────────────────────────────────────────
test("detectCompleteness fires on every-stop / loop language", function () {
  assert.strictEqual(GP.detectCompleteness("complete the ring road"), true);
  assert.strictEqual(GP.detectCompleteness("EVERY STOP along the way"), true);
  assert.strictEqual(GP.detectCompleteness("the whole loop please"), true);
});
test("detectCompleteness stays quiet on ordinary briefs", function () {
  assert.strictEqual(GP.detectCompleteness("a relaxing beach week"), false);
  assert.strictEqual(GP.detectCompleteness(""), false);
  assert.strictEqual(GP.detectCompleteness(null), false);
});

// ── structural contract ────────────────────────────────────────────
test("build opens by naming the place", function () {
  assert.ok(GP.build(FULL).indexOf("A traveler wants to go to Iceland.\n") === 0);
});
test("user-list block is a HARD CONSTRAINT listing each place", function () {
  var p = GP.build(FULL);
  assert.ok(p.indexOf("THE TRAVELER'S OWN LIST — HARD CONSTRAINT") !== -1);
  assert.ok(p.indexOf("  - Reykjavik — OVERNIGHT STAY (3 nights)") !== -1);
  assert.ok(p.indexOf("  - Vík — see/do") !== -1);
  // isStay:true with no nights → OVERNIGHT STAY, no "(n nights)"
  assert.ok(p.indexOf("  - Akureyri — OVERNIGHT STAY\n") !== -1);
});
test("brief block joins the brief bits", function () {
  var p = GP.build(FULL);
  assert.ok(p.indexOf("TRIP CONTEXT (filter and tune") !== -1);
  assert.ok(p.indexOf("  - Duration: 10 days") !== -1);
  assert.ok(p.indexOf("  - Soft avoidances: crowds") !== -1);
});
test("budget block does the day/night math with 30% headroom", function () {
  var p = GP.build(FULL);
  // 10 days → 9 nights → round(9*1.3)=12
  assert.ok(p.indexOf("HARD BUDGET CONSTRAINT") !== -1);
  assert.ok(p.indexOf("has 10 days (9 nights)") !== -1);
  assert.ok(p.indexOf("approximately 9–12 nights") !== -1);
});
test("completeness block appears only when asked", function () {
  assert.ok(GP.build(FULL).indexOf("GEOGRAPHIC COMPLETENESS") !== -1);
  assert.ok(GP.build(MIN).indexOf("GEOGRAPHIC COMPLETENESS") === -1);
});
test("chips and personal context are woven in", function () {
  var p = GP.build(FULL);
  assert.ok(p.indexOf("General interests they tagged") !== -1 && p.indexOf("food, trains") !== -1);
  assert.ok(p.indexOf("PERSONAL CONTEXT: traveling with grandparents.") !== -1);
});
test("schema + the three item types + six categories are present", function () {
  var p = GP.build(FULL);
  assert.ok(p.indexOf("TYPE 1 — ROUTE") !== -1);
  assert.ok(p.indexOf("TYPE 2 — CONDITION") !== -1);
  assert.ok(p.indexOf("TYPE 3 — ACTIVITY") !== -1);
  ["outdoors-active","scenery-nature","culture-history","food-drink",
   "connection-gatherings","wellness-growth"].forEach(function (c) {
    assert.ok(p.indexOf(c) !== -1, "missing category " + c);
  });
  assert.ok(p.indexOf("Return ONLY a JSON array") !== -1);
});
test("optional blocks vanish cleanly on minimal input", function () {
  var p = GP.build(MIN);
  assert.ok(p.indexOf("A traveler wants to go to Portugal.\n") === 0);
  assert.ok(p.indexOf("THE TRAVELER'S OWN LIST") === -1);
  assert.ok(p.indexOf("TRIP CONTEXT (filter") === -1);
  assert.ok(p.indexOf("HARD BUDGET CONSTRAINT") === -1);
  assert.ok(p.indexOf("General interests they tagged") === -1);
  // the static schema is always present
  assert.ok(p.indexOf("Return ONLY a JSON array") !== -1);
});
test("block ORDER: brief → budget → completeness → user-list → chips", function () {
  var p = GP.build(FULL);
  var iBrief = p.indexOf("TRIP CONTEXT (filter");
  var iBudget = p.indexOf("HARD BUDGET CONSTRAINT");
  var iCompl = p.indexOf("GEOGRAPHIC COMPLETENESS");
  var iList = p.indexOf("THE TRAVELER'S OWN LIST");
  var iChips = p.indexOf("General interests they tagged");
  assert.ok(iBrief < iBudget && iBudget < iCompl && iCompl < iList && iList < iChips,
    "prompt blocks are out of order");
});

// ── byte-for-byte snapshot guard ───────────────────────────────────
// Locks the EXACT assembled prompt for both the full and minimal paths.
// To intentionally change the prompt: UPDATE_SNAPSHOT=1 node tests/gen-prompt-tests.js
var SNAP = path.join(__dirname, "fixtures", "gen-prompt.snapshot.json");
test("assembled prompt matches the byte-for-byte snapshot", function () {
  var current = { full: GP.build(FULL), min: GP.build(MIN) };
  if (process.env.UPDATE_SNAPSHOT === "1") {
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, JSON.stringify(current, null, 2));
    console.log("    (snapshot updated)");
    return;
  }
  assert.ok(fs.existsSync(SNAP), "snapshot missing — run with UPDATE_SNAPSHOT=1");
  var saved = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  assert.strictEqual(current.full, saved.full, "FULL prompt drifted from snapshot");
  assert.strictEqual(current.min, saved.min, "MIN prompt drifted from snapshot");
});

console.log("\n" + "─".repeat(50));
console.log("PASS: " + pass + "    FAIL: " + fail);
if (fail > 0) process.exit(1);
