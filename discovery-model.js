// discovery-model.js — PD.400: the Discovery domain, re-architected.
//
// WHY THIS EXISTS
// ---------------
// Discovery's data was the emergent result of ~7 imperative mutation
// passes (construct, backstop, reconcile, canonicalize, the stays
// owner, the catchall invariant, the umbrella router), each mutating a
// shared array. With no single owner of "where does this place go,"
// every count surface re-derived the truth differently and the passes
// interacted to spawn a new edge case each round. That is the root of
// the recurring count/placement bugs.
//
// THE ARCHITECTURE (OO / SOA)
// ---------------------------
//   • Place — an ENTITY with stable identity and a few orthogonal,
//     independently-owned attributes (origin, role, decision, themeFit).
//   • DiscoveryModel — the SINGLE SOURCE OF TRUTH (a keyed ledger of
//     Places) and the SINGLE WRITER (every mutation is a method; nobody
//     reaches in and edits the array).
//   • PlacementPolicy — ONE PURE FUNCTION, sectionFor(place) → section.
//     A place's section is DERIVED from its attributes, never stored
//     and never mutated by a pass. Change an attribute → the section
//     follows, deterministically. This single function replaces the
//     entire pass chain's placement logic.
//   • Queries — sections(), considered(), committed(), coverage() are
//     PURE READS over the ledger. Every count comes from here, so they
//     cannot disagree.
//
// Identity is COORDINATE-AWARE (PD.399): two places at the same point
// are the same place even under different names; a place whose name
// merely starts with a destination's name ("Reykjavik Old Harbour" vs
// "Reykjavik") is NOT merged unless the coordinates agree.
//
// This module is pure and standalone (no DOM, no globals beyond an
// optional PlaceKey for name identity), so it is exhaustively unit-
// testable. The picker is migrated onto it incrementally; until then
// it is the authority the new code reads from.

(function (global) {
  "use strict";

  var PK = global.PlaceKey || null;

  // ── Section names (mirrors SectionKind; kept local so the model is
  //    self-contained for Node tests) ─────────────────────────────────
  var SECTION = {
    STAYS_USER:   "Overnight stays",
    STAYS_REC:    "Recommended overnight stays",
    KEEPING:      "Sights you're keeping",
    SIGHTS_NEAR:  "Sights near places you listed",
    MORE:         "More places to consider",
    FROM_LIST:    "From your list"
  };

  function _norm(s) {
    if (PK && typeof PK.resolve === "function") { try { return PK.resolve(s); } catch (_) {} }
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Coordinate proximity (equirectangular, fine at city scale).
  function _coordsClose(a, b, km) {
    if (!a || !b) return false;
    if (typeof a.lat !== "number" || typeof a.lng !== "number"
        || typeof b.lat !== "number" || typeof b.lng !== "number") return false;
    var dLat = (a.lat - b.lat) * 111;
    var dLng = (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180);
    return (dLat * dLat + dLng * dLng) <= (km * km);
  }

  // Are two places the SAME place? Exact/token identity on name OR same
  // coordinates; containment ("X" vs "X Y") only when coords agree.
  function sameEntity(a, b) {
    var ka = _norm(a.place), kb = _norm(b.place);
    if (ka && kb && ka === kb) return true;
    if (PK && typeof PK.same === "function" && PK.same(a.place, b.place)) return true;
    var co = (a.coords && b.coords) ? _coordsClose(a.coords, b.coords, 0.3) : false;
    if (co) return true;
    if (PK && typeof PK.contains === "function" && PK.contains(a.place, b.place)) {
      return (a.coords && b.coords) ? _coordsClose(a.coords, b.coords, 0.6) : false;
    }
    return false;
  }

  // ── PlacementPolicy — the ONE pure function ───────────────────────
  // A place's section is a pure function of its attributes. No state,
  // no mutation, no ordering dependency. THIS replaces the pass chain.
  //
  //   origin   : "user" | "max-hub" | "max"
  //   role     : "stay" | "sight"
  //   decision : "checked" | "unchecked" | "rejected"
  //   themeFit : a theme section name the LLM assigned, or null
  var PlacementPolicy = {
    sectionFor: function (p) {
      if (!p) return SECTION.MORE;
      if (p.role === "stay") {
        return (p.origin === "user") ? SECTION.STAYS_USER : SECTION.STAYS_REC;
      }
      // sight
      if (p.decision === "checked") {
        return p.themeFit || SECTION.KEEPING;        // committed → theme, else "keeping"
      }
      // unchecked (rejected places are excluded from the view entirely)
      if (p.themeFit) return p.themeFit;             // shown unchecked in its theme
      if (p.origin === "user") return SECTION.FROM_LIST;
      if (p.nearListed) return SECTION.SIGHTS_NEAR;  // enhance leftover near a listed place
      return SECTION.MORE;                           // a Max suggestion with no theme
    }
  };

  // ── DiscoveryModel — SSOT + single writer ─────────────────────────
  function DiscoveryModel() {
    this._byKey = Object.create(null); // key → Place
    this._order = [];                  // insertion order of keys
  }

  DiscoveryModel.SECTION = SECTION;
  DiscoveryModel.PlacementPolicy = PlacementPolicy;

  DiscoveryModel.prototype._findExisting = function (raw) {
    var k = _norm(raw.place);
    if (k && this._byKey[k]) return this._byKey[k];
    // coordinate / fuzzy identity against existing entities
    for (var i = 0; i < this._order.length; i++) {
      var e = this._byKey[this._order[i]];
      if (e && sameEntity(e, raw)) return e;
    }
    return null;
  };

  // upsert(raw) — THE write door. Idempotent and identity-merging:
  // re-ingesting the same place (any name variant at the same point)
  // updates the existing entity rather than creating a duplicate.
  //   raw: { place, coords?, origin?, role?, decision?, themeFit?, listedRole? }
  DiscoveryModel.prototype.upsert = function (raw) {
    if (!raw || !raw.place) return null;
    var existing = this._findExisting(raw);
    if (existing) {
      // Fill gaps; never silently downgrade a richer value.
      if (!existing.coords && raw.coords) existing.coords = raw.coords;
      if (raw.themeFit && !existing.themeFit) existing.themeFit = raw.themeFit;
      if (raw.origin && existing.origin === "max" && raw.origin === "user") existing.origin = "user";
      if (raw.role) existing.role = raw.role;
      // A definite decision (checked/rejected) wins over the default
      // "unchecked"; an explicit checked beats a later unchecked of the
      // same place (the user committed it somewhere).
      if (raw.decision === "rejected") existing.decision = "rejected";
      else if (raw.decision === "checked" && existing.decision !== "rejected") existing.decision = "checked";
      else if (raw.decision && !existing._decisionSet) existing.decision = raw.decision;
      if (raw.decision === "checked" || raw.decision === "rejected") existing._decisionSet = true;
      if (raw.listedRole) existing.listedRole = raw.listedRole;
      if (raw.nearListed) existing.nearListed = true;
      if (raw.src && !existing.src) existing.src = raw.src;
      return existing;
    }
    var key = _norm(raw.place);
    var place = {
      key: key,
      place: raw.place,
      coords: raw.coords || null,
      origin: raw.origin || "max",
      role: raw.role || "sight",
      decision: raw.decision || "unchecked",
      themeFit: raw.themeFit || null,
      listedRole: raw.listedRole || null,
      nearListed: !!raw.nearListed,
      src: raw.src || null,
      _decisionSet: (raw.decision === "checked" || raw.decision === "rejected")
    };
    this._byKey[key] = place;
    this._order.push(key);
    return place;
  };

  // Single-writer mutations.
  DiscoveryModel.prototype.setDecision = function (placeName, decision) {
    var e = this._findExisting({ place: placeName });
    if (e) e.decision = decision;
    return e;
  };
  DiscoveryModel.prototype.setRole = function (placeName, role) {
    var e = this._findExisting({ place: placeName });
    if (e) e.role = role;
    return e;
  };

  DiscoveryModel.prototype.all = function () {
    var self = this;
    return this._order.map(function (k) { return self._byKey[k]; });
  };

  // ── Pure queries ──────────────────────────────────────────────────

  // sections() — the rendered shape: ordered list of { section, places }.
  // Section membership is PlacementPolicy.sectionFor for each place.
  // Rejected places are omitted. This is the single derivation the
  // view renders and every count reads.
  var SECTION_ORDER = [
    SECTION.STAYS_USER, SECTION.STAYS_REC, SECTION.KEEPING
    // theme sections fall here, in first-seen order
    // catchalls pinned last:
  ];
  var CATCHALL_LAST = [SECTION.SIGHTS_NEAR, SECTION.FROM_LIST, SECTION.MORE];

  DiscoveryModel.prototype.sections = function () {
    var bucket = Object.create(null);
    var seenOrder = [];
    this.all().forEach(function (p) {
      if (p.decision === "rejected") return;
      var sec = PlacementPolicy.sectionFor(p);
      if (!bucket[sec]) { bucket[sec] = []; seenOrder.push(sec); }
      bucket[sec].push(p);
    });
    // Order: pinned head, then themes (first-seen), then pinned catchalls.
    var head = SECTION_ORDER.filter(function (s) { return bucket[s]; });
    var tail = CATCHALL_LAST.filter(function (s) { return bucket[s]; });
    var mid = seenOrder.filter(function (s) {
      return SECTION_ORDER.indexOf(s) === -1 && CATCHALL_LAST.indexOf(s) === -1;
    });
    return head.concat(mid).concat(tail).map(function (s) {
      return { section: s, places: bucket[s] };
    });
  };

  // considered() — unchecked SIGHTS that are not stays and not already
  // destinations. The one definition every "Considered (N)" surface
  // reads. Excludes hubs (they're stay proposals).
  DiscoveryModel.prototype.considered = function () {
    return this.all().filter(function (p) {
      return p.role === "sight" && p.decision === "unchecked";
    });
  };
  DiscoveryModel.prototype.consideredBySection = function () {
    var out = Object.create(null);
    this.considered().forEach(function (p) {
      var sec = PlacementPolicy.sectionFor(p);
      out[sec] = (out[sec] || 0) + 1;
    });
    return out;
  };

  // committed() — checked sights (the green teardrops).
  DiscoveryModel.prototype.committed = function () {
    return this.all().filter(function (p) {
      return p.role === "sight" && p.decision === "checked";
    });
  };

  // coverage(listedDisplayNames) — for each name the user listed, is it
  // present? Uses the same coordinate-aware identity. Non-destructive.
  DiscoveryModel.prototype.coverage = function (listed) {
    var self = this;
    // Coverage is NON-DESTRUCTIVE (it only labels found/missing), so it
    // may use NAME containment without a coordinate gate — a one-word
    // listed name ("Þingvellir") is "found" in its qualified theme form
    // ("Þingvellir National Park"). The destructive merge stays
    // coordinate-gated; only this read is permissive.
    function _coverageHit(name) {
      var hit = self._findExisting({ place: name });
      if (hit) return hit;
      if (PK && typeof PK.relatedTo === "function") {
        var all = self.all();
        for (var i = 0; i < all.length; i++) {
          if (PK.relatedTo(name, all[i].place)) return all[i];
        }
      }
      return null;
    }
    return (listed || []).map(function (name) {
      var hit = _coverageHit(name);
      return { place: name, found: !!hit,
        checked: hit ? hit.decision === "checked" : false,
        section: hit ? PlacementPolicy.sectionFor(hit) : null };
    });
  };

  var api = {
    DiscoveryModel: DiscoveryModel,
    PlacementPolicy: PlacementPolicy,
    SECTION: SECTION,
    sameEntity: sameEntity,
    _coordsClose: _coordsClose
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DiscoveryModel = DiscoveryModel;
  global.MaxDiscovery = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
