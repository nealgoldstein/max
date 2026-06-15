// @ts-check
// section-kind.js — PD.381: section identity in ONE place.
//
// A "section" string was doing double duty as both a display label AND
// an identity key, with its semantics (is it a stay bucket? a catchall?
// exempt from canonicalization? what's its dedupe precedence?) inferred
// by string-matching scattered across ~30 sites — the constructor, the
// backstop, the synthetic-stays owner, the fold (SYNTHETIC_NAMES), the
// signal collector's regex, the canonicalizer (_CATCHALL_PRECEDENCE),
// the renderer's noun map, and so on. Each was a place a section's
// meaning could silently drift from every other.
//
// This module is the single owner of section identity — the SectionKind
// analogue of PlaceKey. Canonical names live here; every "what kind of
// section is this?" question routes through one of these predicates.
//
//   SectionKind.NAMES                — the canonical section-name strings
//   SectionKind.isStay(s)            — any of the three stay sections
//   SectionKind.isCommittedStay(s)   — user "Overnight stays" OR Max
//                                      "Recommended overnight stays"
//                                      (i.e. a real base, not "to consider")
//   SectionKind.isStayConsider(s)    — "Overnight stays to consider"
//   SectionKind.isCatchall(s)        — one of the leftover/orphan buckets
//   SectionKind.catchallRank(s)      — dedupe precedence (lower wins); 0 if not a catchall
//   SectionKind.catchallPrecedence() — the ordered catchall name list
//   SectionKind.isSynthetic(s)       — a Max-managed structural section
//                                      (stays + catchalls) — never folded
//                                      or canonicalized as an LLM section

(function (global) {
  "use strict";

  var NAMES = {
    STAYS_USER:     "Overnight stays",                 // PD.380: your listed stays (checked)
    STAYS_REC:      "Recommended overnight stays",     // PD.380: Max's proposed bases (unchecked)
    STAYS_CONSIDER: "Overnight stays to consider",     // LLM extra stay candidates
    SIGHTS_NEAR:    "Sights near places you listed",   // catchall: enhance leftovers
    FROM_LIST:      "From your list",                  // catchall: user leftovers
    MORE:           "More places to consider"          // catchall: Max leftovers
  };

  // Catchall dedupe precedence (lower index wins when a place could
  // sit in more than one). MUST match the canonicalizer's intent: a
  // user leftover ("From your list") beats an enhance leftover beats
  // a generic Max leftover.
  var CATCHALL_ORDER = [NAMES.FROM_LIST, NAMES.SIGHTS_NEAR, NAMES.MORE];
  var CATCHALL_RANK = {};
  CATCHALL_ORDER.forEach(function (s, i) { CATCHALL_RANK[s] = i + 1; });

  function isStay(s) {
    return s === NAMES.STAYS_USER || s === NAMES.STAYS_REC || s === NAMES.STAYS_CONSIDER;
  }
  function isCommittedStay(s) {
    return s === NAMES.STAYS_USER || s === NAMES.STAYS_REC;
  }
  function isStayConsider(s) {
    return s === NAMES.STAYS_CONSIDER;
  }
  function isCatchall(s) {
    return Object.prototype.hasOwnProperty.call(CATCHALL_RANK, s);
  }
  function catchallRank(s) {
    return CATCHALL_RANK[s] || 0;
  }
  function catchallPrecedence() {
    return CATCHALL_ORDER.slice();
  }
  // The full set of Max-managed structural sections — never treated as
  // an LLM-generated content section by the fold or signal passes.
  function isSynthetic(s) {
    return isStay(s) || isCatchall(s);
  }

  var api = {
    NAMES: NAMES,
    isStay: isStay,
    isCommittedStay: isCommittedStay,
    isStayConsider: isStayConsider,
    isCatchall: isCatchall,
    catchallRank: catchallRank,
    catchallPrecedence: catchallPrecedence,
    isSynthetic: isSynthetic
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SectionKind = api;

})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
