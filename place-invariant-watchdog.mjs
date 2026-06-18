// @ts-check
// place-invariant-watchdog.js — #1 verification loop: ALWAYS-ON structural
// invariants. After EVERY trip mutation (TripStore "tripChange"), assert the
// Place-model invariants the fuzz harness proved hold for ANY trip:
//   • registryShadowCheck        — the registry is a faithful union
//   • destinationsProjectionCheck — destinationsOf == trip.destinations (by ref)
//   • sightsProjectionCheck      — the sight projection is identity-faithful
//
// This catches state CORRUPTION from ANY handler — including the many untested
// interactive ones (toggles, popovers, drag-reorder) — the instant it happens,
// instead of waiting for a user to notice. It closes the "no runtime invariant
// enforcement" gap too.
//
// Deliberately EXCLUDES the keep/candidate-mirror checks: those can legitimately
// differ on candidate-less (loaded/seeded) trips (see OBJECT-MODEL.md §7), so
// they'd false-alarm. Only the structural invariants — proven universal by
// tests/place-invariants-fuzz.mjs — are asserted here.
//
// NON-FATAL: never throws, never breaks the app. Logs [invariant] errors and
// records them on window.__invariantViolations so the Playwright gate can assert
// none occurred during its interactions. (Promote to a hard gate once the wild
// proves clean.)

(function () {
  "use strict";
  var g = /** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : {});

  function check() {
    try {
      var TS = g.TripStore, MP = g.MaxPlaces;
      var trip = TS && TS.trip;
      if (!trip || !MP) return;
      var v = [];
      var reg = MP.registryShadowCheck(trip);
      if (!reg.ok) v.push({ check: "registryShadowCheck", missing: reg.missing, wrongRole: reg.wrongRole });
      var dp = MP.destinationsProjectionCheck(trip);
      if (!dp.ok) v.push({ check: "destinationsProjectionCheck", diffs: dp.diffs });
      var sp = MP.sightsProjectionCheck(trip);
      if (!sp.ok) v.push({ check: "sightsProjectionCheck", missing: sp.missing, invented: sp.invented });
      if (v.length) {
        try { console.error("[invariant] Place-model structural invariant violated after a trip mutation:", v); } catch (_) {}
        (g.__invariantViolations = g.__invariantViolations || []).push.apply(g.__invariantViolations, v);
      }
    } catch (_) { /* the watchdog must NEVER break the app */ }
  }

  function wire() {
    try {
      if (g.TripStore && typeof g.TripStore.on === "function") {
        g.TripStore.on("tripChange", check);
        try { console.log("[invariant] structural watchdog armed"); } catch (_) {}
        return true;
      }
    } catch (_) {}
    return false;
  }

  // TripStore may not be on globalThis yet at this module's load (module order /
  // app boot); retry briefly, then give up quietly.
  if (!wire()) {
    var tries = 0;
    var iv = setInterval(function () { if (wire() || ++tries > 50) clearInterval(iv); }, 100);
  }
})();

export {};
