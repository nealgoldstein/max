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

  function _norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  // ── A single user decision about one place ────────────────────────────
  //   kept:     true (committed) | false (explicitly dropped) | null (undecided)
  //   rejected: removed from consideration entirely
  //   role:     how a kept place participates — stay | see | daytrip | onway
  //   hub:      the day-trip / wayside hub, when role needs one
  function Decision(spec) {
    spec = spec || {};
    this.kept     = (spec.kept === true) ? true : (spec.kept === false ? false : null);
    this.rejected = spec.rejected === true;
    this.role     = spec.role || null;
    this.hub      = spec.hub || "";
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

  // ── THE PROJECTION — (facts, decision) -> derived view ────────────────
  // facts: { origin: "user"|"max"|"max-hub", role, kind, themeFit, nearListed }
  // decision: a Decision, or null when the user has not decided.

  function _origin(facts) {
    var o = facts && facts.origin;
    return (o === "user" || o === "max" || o === "max-hub") ? o : "max";
  }

  // keep rule — PD.452, proven live. rejected -> false; a user decision ->
  // their exact choice; otherwise the default by origin (your places on, Max's
  // off). "Max checks nothing" is simply the else-branch.
  function keepOf(facts, decision) {
    if (decision && decision.rejected) return false;
    if (decision && decision.kept !== null) return decision.kept === true;
    return _origin(facts) === "user";
  }

  // role — a decided role wins; else the fact's suggested role; else a default
  // by kind (a place you sleep in is a stay, otherwise a sight).
  function roleOf(facts, decision) {
    if (decision && decision.role) return decision.role;
    if (facts && facts.role) return facts.role;
    return (facts && facts.kind === "destination") ? "stay" : "see";
  }

  // section — delegates to the ONE existing placement policy (sectionFor),
  // which is already a pure function of place attributes. We pass it a place
  // shaped the way PlacementPolicy expects (decision reflected as its string).
  function sectionOf(placeForPolicy) {
    var P = global.MaxDiscovery && global.MaxDiscovery.PlacementPolicy;
    return (P && typeof P.sectionFor === "function") ? P.sectionFor(placeForPolicy) : null;
  }

  // the full derived view in one call
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
    keepOf: keepOf,
    roleOf: roleOf,
    sectionOf: sectionOf,
    project: project
  };

  if (typeof module !== "undefined" && module.exports) module.exports = MaxDecisions;
  if (global && !global.MaxDecisions) global.MaxDecisions = MaxDecisions;
})(typeof globalThis !== "undefined" ? globalThis : this);
