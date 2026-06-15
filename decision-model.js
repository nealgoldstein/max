// @ts-check
// decision-model.js — P4 (the perfect model): the user's DECISIONS as data,
// separated from facts and from derived views.
//
// THE SPLIT this whole refactor has been driving toward:
//
//   FACTS      immutable per place — name, coords, kind, origin, themeFit,
//              nearListed. Set once at ingestion, never mutated.
//   DECISIONS  the ONLY user-writable surface — per place, did the user keep,
//              drop, reject, or role it. Keyed by place identity. (this file)
//   VIEW       a PURE PROJECTION of (facts + decision): keep, role, section.
//              Never stored; always derived. So "Max checks nothing" and "the
//              render never changes a user's choice" are not enforced — they
//              are just what the projection computes.
//
// Today the live app smears keep/role/status/_decided onto mutable records and
// runs derivations that must "win last." This module is the clean core those
// records will become projections OF (strangler-fig: build + prove here, then
// cut the live app over slice by slice).
//
// PURE: DOM-free, async-free, Node-testable. The keep rule below is exactly the
// one proven live in PD.452 (Reykjahlíð arrives unchecked; a listed stay arrives
// checked; an uncheck is durable) — so the live derivation can be swapped for
// this with confidence.

(function (global) {
  "use strict";
  // The injected global carries app globals (MaxDiscovery, MaxDecisions) that
  // aren't on the lib `globalThis` type — alias as any for the @ts-check pass.
  var _G = /** @type {any} */ (global);

  function _norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  // leg — a wayside's placement: which transit leg (between two named hubs)
  // the user dropped it on. {fromPlace, toPlace} or null. P4.4c: a wayside's
  // leg is a DECISION attribute (where the user put it), not a place fact — so
  // it lives on the decision next to role/hub, not smeared on the candidate.
  function _normLeg(leg) {
    if (!leg || typeof leg !== "object") return null;
    var f = (leg.fromPlace == null) ? "" : String(leg.fromPlace);
    var t = (leg.toPlace == null) ? "" : String(leg.toPlace);
    if (!f && !t) return null;
    return { fromPlace: f, toPlace: t };
  }

  // ── A single user decision about one place ────────────────────────────
  //   kept:     true (committed) | false (explicitly dropped) | null (undecided)
  //   rejected: removed from consideration entirely
  //   role:     how a kept place participates — stay | see | daytrip | onway
  //   hub:      the day-trip / wayside hub, when role needs one
  //   leg:      the wayside's {fromPlace,toPlace} transit leg, or null
  function Decision(spec) {
    spec = spec || {};
    this.kept     = (spec.kept === true) ? true : (spec.kept === false ? false : null);
    this.rejected = spec.rejected === true;
    this.role     = spec.role || null;
    this.hub      = spec.hub || "";
    this.leg      = _normLeg(spec.leg);
  }

  // ── The decision LOG — keyed by place identity; the ONE write door ────
  function Decisions() { this._byKey = {}; }
  Decisions.prototype.key = function (placeNameOrKey) { return _norm(placeNameOrKey); };
  Decisions.prototype.get = function (placeNameOrKey) {
    return this._byKey[this.key(placeNameOrKey)] || null;
  };
  Decisions.prototype.decided = function (placeNameOrKey) {
    return Object.prototype.hasOwnProperty.call(this._byKey, this.key(placeNameOrKey));
  };
  // set — the SOLE surface through which a user choice enters the system.
  Decisions.prototype.set = function (placeNameOrKey, spec) {
    var k = this.key(placeNameOrKey);
    if (!k) return null;
    var d = new Decision(spec);
    this._byKey[k] = d;
    return d;
  };
  Decisions.prototype.clear = function (placeNameOrKey) {
    delete this._byKey[this.key(placeNameOrKey)];
  };
  Decisions.prototype.size = function () { return Object.keys(this._byKey).length; };

  // ── Persistence (P4.5) — the log is the durable decision record ───────
  // toJSON: a plain, storable map keyed by the SAME normalized identity, so a
  // round-trip through storage reconstructs the exact decisions. fromJSON: the
  // inverse, rebuilding Decision instances (re-normalizing each field). Keys are
  // already normalized, so they're preserved verbatim — no re-keying.
  Decisions.prototype.toJSON = function () {
    var out = {};
    for (var k in this._byKey) {
      if (!Object.prototype.hasOwnProperty.call(this._byKey, k)) continue;
      var d = this._byKey[k];
      out[k] = { kept: d.kept, rejected: d.rejected, role: d.role, hub: d.hub, leg: d.leg };
    }
    return out;
  };
  function fromJSON(obj) {
    var D = new Decisions();
    if (obj && typeof obj === "object") {
      for (var k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        if (!k) continue;
        D._byKey[k] = new Decision(obj[k] || {});   // keys already normalized
      }
    }
    return D;
  }

  // ── THE PROJECTION — (facts, decision) -> derived view ────────────────
  // facts: { origin: "user"|"max"|"max-hub", role, kind, themeFit, nearListed }
  // decision: a Decision, or null when the user has not decided.

  /** @param {Facts} facts @returns {string} */
  function _origin(facts) {
    var o = facts && facts.origin;
    return (o === "user" || o === "max" || o === "max-hub") ? o : "max";
  }

  // keep rule — PD.452, proven live. rejected -> false; a user decision ->
  // their exact choice; otherwise the default by origin (your places on, Max's
  // off). "Max checks nothing" is simply the else-branch.
  /** @param {Facts} facts @param {?MaxDecisionSpec} decision @returns {boolean} */
  function keepOf(facts, decision) {
    if (decision && decision.rejected) return false;
    if (decision && decision.kept !== null) return decision.kept === true;
    return _origin(facts) === "user";
  }

  // role — a decided role wins; else the fact's suggested role; else a default
  // by kind (a place you sleep in is a stay, otherwise a sight).
  /** @param {Facts} facts @param {?MaxDecisionSpec} decision @returns {string} */
  function roleOf(facts, decision) {
    if (decision && decision.role) return decision.role;
    if (facts && facts.role) return facts.role;
    return (facts && facts.kind === "destination") ? "stay" : "see";
  }

  // section — delegates to the ONE existing placement policy (sectionFor),
  // which is already a pure function of place attributes. We pass it a place
  // shaped the way PlacementPolicy expects (decision reflected as its string).
  function sectionOf(placeForPolicy) {
    var P = _G.MaxDiscovery && _G.MaxDiscovery.PlacementPolicy;
    return (P && typeof P.sectionFor === "function") ? P.sectionFor(placeForPolicy) : null;
  }

  // the full derived view in one call
  /** @param {Facts} facts @param {?MaxDecisionSpec} decision @param {any} [placeForPolicy] */
  function project(facts, decision, placeForPolicy) {
    return {
      keep: keepOf(facts, decision),
      role: roleOf(facts, decision),
      section: placeForPolicy ? sectionOf(placeForPolicy) : null
    };
  }

  var MaxDecisions = {
    Decision: Decision,
    Decisions: Decisions,
    fromJSON: fromJSON,
    keepOf: keepOf,
    roleOf: roleOf,
    sectionOf: sectionOf,
    project: project
  };

  if (typeof module !== "undefined" && module.exports) module.exports = MaxDecisions;
  if (_G && !_G.MaxDecisions) _G.MaxDecisions = MaxDecisions;
})(typeof globalThis !== "undefined" ? globalThis : this);
