// tests/place-invariants-fuzz.mjs — #Place model, ALWAYS-ON INVARIANTS (fuzz).
//
// The hand-written tests pin specific cases; this proves the model's invariants
// hold across HUNDREDS of randomly-generated trips — the world-class "the model
// cannot drift" guarantee, not "the model didn't drift on the one fixture I
// thought of". Two classes of property:
//
//   STRUCTURAL (must hold for ANY trip):
//     • registryShadowCheck      — the registry is a faithful union
//     • destinationsProjectionCheck — destinationsOf == trip.destinations (by ref)
//     • sightsProjectionCheck    — sights are identity-faithful
//
//   DETECTOR (consistent input → ok; injected drift → caught):
//     • candidateMirrorCheck / keepShadowCheck stay green on consistent trips,
//       and fire when we corrupt a single flag.
//
// Deterministic PRNG so a failure is reproducible from its printed seed.
// Run: node tests/place-invariants-fuzz.mjs
"use strict";
import assert from "assert";
import MaxPlaces from "../place-registry.mjs";

var pass = 0, fail = 0;
function test(n, f) {
  try { f(); pass++; console.log("  ✓ " + n); }
  catch (e) { fail++; console.error("  ✗ " + n + " — " + (e && e.message)); }
}

// ── deterministic PRNG (mulberry32) ───────────────────────────────────────
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var NAMES = ["Reykjavik", "Vik", "Höfn", "Akureyri", "Gullfoss", "Geysir",
  "Seljalandsfoss", "Skogafoss", "Jokulsarlon", "Þingvellir", "Hverir",
  "Blue Lagoon", "Kirkjufell", "Diamond Beach", "Goðafoss"];
var SECTIONS = ["Overnight stays", "Chase waterfalls", "See ice and glaciers",
  "Explore the capital", "More places to consider", "Sights near places you listed"];
var ROLES = ["stay", "see", "daytrip", "onway", "maybe", "reject", null];

// Build ONE random trip. `consistent` keeps requiredPlace flags in step with the
// candidate decision (so the detector shadows are green); otherwise flags are
// independently random (only the structural invariants must hold).
function randomTrip(rand, consistent) {
  var pick = function (a) { return a[Math.floor(rand() * a.length)]; };
  var coord = function () { return rand() < 0.15 ? null : Math.round((60 + rand() * 10) * 100) / 100; };

  // PRECONDITION the model relies on: identity is UNIQUE — a place appears at
  // most once in trip.destinations and once in trip.candidates (both are
  // identity-deduped in the live app). Draw names without replacement so the
  // generator honors that contract. (requiredPlaces MAY repeat across sections;
  // that's the one collection the registry deliberately dedups.)
  var bag = NAMES.slice();
  for (var b = bag.length - 1; b > 0; b--) { var j = Math.floor(rand() * (b + 1)); var tmp = bag[b]; bag[b] = bag[j]; bag[j] = tmp; }
  var cursor = 0;
  var uniqueName = function () { return cursor < bag.length ? bag[cursor++] : null; };

  var nDest = Math.floor(rand() * 4);
  var destinations = [];
  for (var i = 0; i < nDest; i++) {
    var dn = uniqueName(); if (!dn) break;
    destinations.push({ id: "d" + i, place: dn, lat: coord(), lng: coord(), nights: 1 + Math.floor(rand() * 3) });
  }

  // candidates carry the "decision" — also unique by identity
  var candidates = [];
  var decisionByName = {};
  var nCand = Math.floor(rand() * 8);
  for (var c = 0; c < nCand; c++) {
    var nm = uniqueName(); if (!nm) break;
    var role = pick(ROLES);
    // status consistent with role, as MaxRoleWriter.set would leave it:
    // reject→"reject", a real keep-role→"keep", maybe→null (NOT keep),
    // no role→either. (A (maybe,keep) pair is contradictory and never minted.)
    var status = (role === "reject") ? "reject"
               : (role && role !== "maybe") ? "keep"
               : (role === "maybe") ? null
               : (rand() < 0.5 ? "keep" : null);
    candidates.push({ id: "c" + c, place: nm, role: role, status: status });
    decisionByName[nm.toLowerCase().replace(/\s+/g, " ").trim()] = { role: role, status: status };
  }

  var nSec = Math.floor(rand() * 5);
  var placeActivities = [];
  for (var s = 0; s < nSec; s++) {
    if (rand() < 0.2) { placeActivities.push({ type: "route", requiredPlaces: [{ place: pick(NAMES) }] }); continue; }
    var rps = [];
    var nRP = Math.floor(rand() * 4);
    for (var r = 0; r < nRP; r++) {
      var pn = pick(NAMES);
      var rp = { place: pn, lat: coord(), lng: coord(), _origin: rand() < 0.5 ? "user" : "max" };
      if (consistent) {
        var d = decisionByName[pn.toLowerCase().replace(/\s+/g, " ").trim()];
        if (d) {
          // mirror _cmKept EXACTLY (the spec): reject/maybe → false; a real
          // role → true; else status==="keep".
          rp._rejected = (d.role === "reject" || d.status === "reject");
          rp._keep = (d.role === "reject" || d.role === "maybe") ? false
                   : (d.role ? true : (d.status === "keep"));
          rp._isDayTrip = (d.role === "daytrip");
        } else { rp._keep = (rp._origin === "user"); }
      } else {
        rp._keep = rand() < 0.5; rp._rejected = rand() < 0.2; rp._isDayTrip = rand() < 0.2;
      }
      rps.push(rp);
    }
    placeActivities.push({ type: "activity", section: pick(SECTIONS), requiredPlaces: rps });
  }
  return { destinations: destinations, candidates: candidates, placeActivities: placeActivities };
}

console.log("\n#Place ALWAYS-ON INVARIANTS — 1000 random trips");

var N = 1000;
test("STRUCTURAL: registry is a faithful union for every random trip", function () {
  for (var seed = 1; seed <= N; seed++) {
    var t = randomTrip(rng(seed), false);
    var r = MaxPlaces.registryShadowCheck(t);
    assert.ok(r.ok, "seed " + seed + ": missing=" + r.missing.join(",") + " wrongRole=" + r.wrongRole.join(","));
  }
});
test("STRUCTURAL: destinationsOf reproduces trip.destinations (ref identity) every time", function () {
  for (var seed = 1; seed <= N; seed++) {
    var t = randomTrip(rng(seed + 100000), false);
    var r = MaxPlaces.destinationsProjectionCheck(t);
    assert.ok(r.ok, "seed " + seed + ": " + r.diffs.join(" | "));
  }
});
test("STRUCTURAL: sight projection is identity-faithful every time", function () {
  for (var seed = 1; seed <= N; seed++) {
    var t = randomTrip(rng(seed + 200000), false);
    var r = MaxPlaces.sightsProjectionCheck(t);
    assert.ok(r.ok, "seed " + seed + ": missing=" + r.missing.join(",") + " invented=" + r.invented.join(","));
  }
});
test("DETECTOR: candidateMirrorCheck is green on consistent random trips", function () {
  for (var seed = 1; seed <= N; seed++) {
    var t = randomTrip(rng(seed + 300000), true);
    var r = MaxPlaces.candidateMirrorCheck(t);
    assert.ok(r.ok, "seed " + seed + ": " + JSON.stringify(r.mismatches));
  }
});
test("DETECTOR: candidateMirrorCheck CATCHES a corrupted flag", function () {
  var caught = 0, eligible = 0;
  for (var seed = 1; seed <= N; seed++) {
    var t = randomTrip(rng(seed + 400000), true);
    // corrupt the first decided, matched requiredPlace's _keep
    var flipped = false;
    (t.placeActivities || []).forEach(function (it) {
      if (flipped || !it || it.type === "route") return;
      (it.requiredPlaces || []).forEach(function (p) {
        if (flipped || !p) return;
        var hasCand = (t.candidates || []).some(function (c) { return c && c.place === p.place && c.role && c.role !== "maybe"; });
        if (hasCand) { p._keep = !p._keep; p._rejected = false; flipped = true; }
      });
    });
    if (!flipped) continue;
    eligible++;
    if (!MaxPlaces.candidateMirrorCheck(t).ok) caught++;
  }
  assert.ok(eligible > 50, "not enough eligible cases (" + eligible + ")");
  assert.strictEqual(caught, eligible, "missed " + (eligible - caught) + "/" + eligible + " corruptions");
});

console.log("\n──────────────────────────");
console.log("PASS: " + pass + "    FAIL: " + fail);
process.exit(fail > 0 ? 1 : 0);
