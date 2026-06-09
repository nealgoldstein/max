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
    FROM_LIST:    "From your list",
    SCENIC:       "Drive scenic routes"
  };

  // PD.401e: a "route umbrella" is a place whose NAME is itself a named
  // driving route ("Golden Circle", "Ring Road", "Diamond Circle", a
  // scenic loop/drive). These are not considerable sights — they belong
  // in "Drive scenic routes". Folded in from the old
  // _routeUmbrellasToScenicRoutes pre-pass so the decision is the model's.
  var _ROUTE_RE = /\b(circle|ring\s*road|ring\s*route|scenic\s*loop|scenic\s*drive|scenic\s*route)\b/i;
  function isRouteUmbrella(name) { return !!name && _ROUTE_RE.test(String(name)); }
  // A place lands in the scenic-routes section when it is a route umbrella
  // AND the LLM did not give it a more specific theme.
  function _inScenic(p) { return !!(p && p.routeUmbrella && !p.themeFit); }

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

  // Are two places the SAME place? PD.401P: identity is NAME-DRIVEN.
  // Coordinates only ever CONFIRM a name relation (containment) — they
  // never merge two UNRELATED names. The old "same coordinates → same
  // place" branch is gone: it made identity unstable (a place's identity
  // flipped as async coords loaded) AND it false-merged genuinely distinct
  // places that happen to sit close together (a church and the statue in
  // front of it), permanently hiding one. Never merge on a guess; never
  // hide a place.
  //   • exact name (alias-aware resolve) — same.
  //   • token-overlap name (PlaceKey.same) — same.
  //   • word-prefix containment ("Þingvellir" ⊂ "Þingvellir National
  //     Park") — same, but ONLY when coordinates also agree (the name
  //     relation is real, the proximity confirms it).
  function sameEntity(a, b) {
    var ka = _norm(a.place), kb = _norm(b.place);
    if (ka && kb && ka === kb) return true;
    if (PK && typeof PK.same === "function" && PK.same(a.place, b.place)) return true;
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
      // A named-route umbrella (no specific theme) belongs in scenic
      // routes regardless of check state — it is a route, not a sight.
      if (_inScenic(p)) return SECTION.SCENIC;
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
    // PD.401k: prefer the identity stamped at the write door (_key). No
    // reader recomputes identity once the write door has set it; _norm is
    // the fallback for places that haven't passed through canonicalize.
    var k = raw._key || _norm(raw.place);
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
    var key = raw._key || _norm(raw.place);
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
      routeUmbrella: !!raw.routeUmbrella || isRouteUmbrella(raw.place),
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
      // Route umbrellas live in "Drive scenic routes"; they are not
      // considerable sights and never enter the considered count.
      return p.role === "sight" && p.decision === "unchecked" && !_inScenic(p);
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
      return p.role === "sight" && p.decision === "checked" && !_inScenic(p);
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

  // ── ONE ingestion: placeActivities → model ────────────────────────
  // THE single derivation owner. Every surface — the render, the receipt
  // banner, the trip pill, the audit, the section grouping — builds the
  // model through THIS function, so they read one set deduped one way.
  // No consumer re-implements "what's considered and where."
  //
  // opts (all optional, with safe defaults):
  //   isStaySection(section) → bool  (default: false)
  //   originOf(place)        → "user"|"max-hub"|"max"
  //   isDestination(place)   → bool  (a place that is also a trip stop)
  //   isHub(place)           → bool  (a Max overnight proposal, not a sight)
  var _CATCH_SET = {};
  _CATCH_SET[SECTION.SIGHTS_NEAR] = 1; _CATCH_SET[SECTION.MORE] = 1;
  _CATCH_SET[SECTION.FROM_LIST] = 1;  _CATCH_SET[SECTION.KEEPING] = 1;

  function _defaultOrigin(p) {
    if (!p) return "max";
    if (p._origin === "user" || p._origin === "max-hub" || p._origin === "max") return p._origin;
    if (p._autoCreated) return "max-hub";
    return "max";
  }

  DiscoveryModel.fromPlaceActivities = function (items, opts) {
    opts = opts || {};
    var isStaySection = opts.isStaySection || function () { return false; };
    var originOf = opts.originOf || _defaultOrigin;
    var isDestination = opts.isDestination || function () { return false; };
    var isHub = opts.isHub || function (p) { return !!(p && p._autoCreated); };
    var m = new DiscoveryModel();
    (items || []).forEach(function (it) {
      if (!it || it.type === "route" || it.type === "condition") return;
      if (isStaySection(it.section)) return;             // stays own their sections
      if (it.type && /^synthetic-stays$/.test(it.type)) return;
      if (/^routes\s*[&]\s*regions/i.test(String(it.section || ""))) return;
      var sec = String(it.section || "");
      var isCatch = !!_CATCH_SET[sec];
      var themeFit = isCatch ? null : sec;               // a real theme, or null for catchalls
      var nearListed = (sec === SECTION.SIGHTS_NEAR);
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        if (isHub(p)) return;                            // a hub is a stay proposal, not a sight
        if (isDestination(p)) return;                    // a destination is not a considered sight
        var decision = (p._rejected === true) ? "rejected"
          : (p._keep === false ? "unchecked" : "checked");
        // PD.404: a PER-PLACE themeFit overrides the item's section-derived
        // one. A catch-all item (e.g. "Sights you're keeping") groups many
        // places under one section, so the only way to sort individual
        // places into DIFFERENT themes is to carry the assignment on the
        // place itself. The theming pass stamps p._themeFit; the model then
        // splits the group by placing each place in its own theme.
        var placeTheme = (p._themeFit && String(p._themeFit)) || themeFit;
        m.upsert({
          place: p.place,
          _key: p._key,                                  // PD.401k: identity from the write door
          coords: (typeof p.lat === "number" && typeof p.lng === "number") ? { lat: p.lat, lng: p.lng } : null,
          origin: originOf(p),
          role: "sight",
          decision: decision,
          themeFit: placeTheme,
          nearListed: nearListed,
          src: p
        });
      });
    });
    return m;
  };

  // consideredKeyedSet() — the considered set in the legacy keyed shape
  // { normKey: { name, lat, lng, section } } that count consumers expect.
  // Same derivation as sections()/considered(), so the pill == the chips.
  DiscoveryModel.prototype.consideredKeyedSet = function () {
    var out = Object.create(null);
    this.considered().forEach(function (p) {
      var c = p.coords || {};
      out[p.key] = { name: p.place, lat: c.lat, lng: c.lng,
                     section: PlacementPolicy.sectionFor(p) };
    });
    return out;
  };

  // PD.404: the model's own notion of "this section carries no theme"
  // (themeFit is null in it). Exported so other passes — e.g. the theming
  // pass deciding which sights it may re-theme — derive "un-themed" from the
  // SAME source the placement logic uses, instead of a parallel hardcoded
  // list that can drift. Includes KEEPING, which SectionKind does not.
  function isCatchallSection(name) { return !!_CATCH_SET[String(name)]; }
  function catchallSections() { return Object.keys(_CATCH_SET); }

  var api = {
    DiscoveryModel: DiscoveryModel,
    PlacementPolicy: PlacementPolicy,
    SECTION: SECTION,
    sameEntity: sameEntity,
    isRouteUmbrella: isRouteUmbrella,
    isCatchallSection: isCatchallSection,
    catchallSections: catchallSections,
    _coordsClose: _coordsClose
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DiscoveryModel = DiscoveryModel;
  global.MaxDiscovery = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
