// @ts-check
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

const global = /** @type {any} */ (globalThis);
  "use strict";

  var PK = global.PlaceKey || null;

  // ── Section names (mirrors SectionKind; kept local so the model is
  //    self-contained for Node tests) ─────────────────────────────────
  var SECTION = {
    STAYS_USER:   "Overnight stays",
    STAYS_REC:    "Recommended overnight stays",
    // PD.405: the shared fallback for a KEPT sight that has no theme AND no
    // usable name. Renamed from "Sights you're keeping" — a checked place
    // sitting in a generic bucket reads as a categorizer failure; "Unique
    // sights" frames a one-off as intentional. Most misses now get their OWN
    // single-member category (the place name) instead of pooling here.
    UNIQUE:       "Unique sights",
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

  // Coordinates CONTRADICT a name match: both records carry usable coords AND
  // they sit farther than `km` apart. This is the one veto that subordinates
  // every name heuristic to geography — when it holds, the names are a
  // coincidence (shared generic tokens) and the entities are DIFFERENT.
  function _coordsDisagree(a, b, km) {
    return !!(a && b && a.coords && b.coords && !_coordsClose(a.coords, b.coords, km));
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
  // Generic geographic-FEATURE descriptors (+ Icelandic geological terms). When
  // the longer name is the shorter name followed ONLY by words from this set,
  // they are the SAME place — the suffix merely DESCRIBES what the named place is
  // ("Goðafoss" = "Goðafoss Waterfall", "Strokkur" = "Strokkur Geyser",
  // "Þingvellir" = "Þingvellir National Park", "Kerið Crater" = "Kerið Crater
  // Lake"). Civic / POI types (museum, church, power station, hotel, harbour,
  // airport…) are DELIBERATELY ABSENT: those denote a DISTINCT entity AT a place
  // ("Reykjavik" ≠ "Reykjavik Maritime Museum", "Krafla" ≠ "Krafla Power
  // Station"). This collapses the LLM's name-variant proliferation at the ONE
  // identity, so the write door, the canonicalizer and every count dedup them
  // the same way — proliferation becomes impossible by construction, not patched.
  var _FEATURE_WORDS = Object.create(null);
  ("waterfall falls foss geyser glacier jokull jökull crater lake cave hellir " +
   "volcano fissure gja gjá gorge canyon gljufur gljúfur peninsula lighthouse viti " +
   "beach lagoon fjord mountain peak peaks tindar cliff cliffs arch rock rocks " +
   "spring springs field fields tongue summit ridge plateau valley gully ravine " +
   "national nature reserve park " +
   // PD.432: descriptive geographic qualifiers — a place named "Arnarstapi
   // coastal cliffs" is the same place as "Arnarstapi", and "Reykjanes lava
   // coastal region" the same as "Reykjanes". These only ever DESCRIBE a named
   // place, so they collapse the variant; a coord veto still blocks far-apart heads.
   "coastal coast lava region area")
    .split(/\s+/).forEach(function (w) { if (w) _FEATURE_WORDS[w] = 1; });

  // Two names CONFLICT on identity when, after dropping the tokens they share,
  // EACH still carries a distinctive (non-generic) token the other lacks. That
  // is the signature of two different entities that merely share a city +
  // category word ("Reykjavík MARITIME Museum" vs "Reykjavík ART Museum
  // Hafnarhús"). Generic geographic-feature words don't count as distinctive,
  // so true variants ("Goðafoss" / "Goðafoss WATERFALL") never conflict. Unknown
  // words DO count as distinctive, so the veto errs toward keeping BOTH pins —
  // a recoverable duplicate beats a permanently hidden place (never-hide).
  function _conflictingNames(a, b) {
    var aT = _norm(a).split(/\s+/).filter(Boolean);
    var bT = _norm(b).split(/\s+/).filter(Boolean);
    if (!aT.length || !bT.length) return false;
    var shared = Object.create(null);
    aT.forEach(function (t) { if (bT.indexOf(t) >= 0) shared[t] = 1; });
    function distinctive(list) {
      var out = []; list.forEach(function (t) { if (!shared[t] && !_FEATURE_WORDS[t]) out.push(t); });
      return out;
    }
    return distinctive(aT).length > 0 && distinctive(bT).length > 0;
  }

  function _featureVariant(a, b) {
    var na = _norm(a.place), nb = _norm(b.place);
    if (!na || !nb || na === nb) return false;
    var lo = na.length <= nb.length ? na : nb;
    var hi = na.length <= nb.length ? nb : na;
    if (hi.indexOf(lo + " ") !== 0) return false;          // lo is a whole-word PREFIX of hi
    var rest = hi.slice(lo.length).trim().split(/\s+/);
    if (!rest.length) return false;
    for (var i = 0; i < rest.length; i++) { if (!_FEATURE_WORDS[rest[i]]) return false; }
    // Coord VETO: if both carry coordinates and they're > 5 km apart, they only
    // share a name head and are different places — do NOT merge.
    if (a.coords && b.coords && !_coordsClose(a.coords, b.coords, 5)) return false;
    return true;
  }

  // PD.438: normalize an entity's KIND ("stay"/base vs "sight") from whatever
  // field carries it (kind | role), or null if none is supplied.
  function _entityKind(x) {
    if (!x) return null;
    // _kind is the INTRINSIC stamp authored at the write door; kind/role are
    // accepted too for callers that pass an explicit hint.
    var k = x._kind || x.kind || x.role;
    if (!k) return null;
    k = String(k).toLowerCase();
    if (k === "destination" || k === "stay" || k === "overnight") return "stay";
    if (k === "sight" || k === "see" || k === "daytrip" || k === "onway") return "sight";
    return null;
  }
  function _entityIsUser(x) {
    return !!(x && (x.source === "user" || x._origin === "user" || x.origin === "user"));
  }

  function sameEntity(a, b) {
    // GROUND-TRUTH VETO (first): if both records carry coordinates that disagree
    // beyond 5 km, they are DIFFERENT entities no matter how their names relate.
    // Without this, PK.same merged "Snæfellsjökull National Park" and
    // "Þingvellir National Park" (140 km apart) on shared generic tokens.
    if (_coordsDisagree(a, b, 5)) return false;
    var ka = _norm(a.place), kb = _norm(b.place);
    // EXACT NAME = the SAME place, regardless of kind (PD.440). "Lake Mývatn" the
    // base and a stray "Lake Mývatn" sight record are ONE place — they merge (the
    // base wins), so a base can't keep a same-named duplicate sight. The kind
    // veto below is ONLY for LOOSER name relations.
    if (ka && kb && ka === kb) return true;
    // KIND VETO (PD.438): for looser name relations, a place YOU listed as a base
    // and a place YOU listed as a sight with a DIFFERENT name are different
    // entities — "Skaftafell" the base ≠ "Skaftafell glacier region" the sight.
    // ORIGIN-GATED so a MAX suggestion still merges into your base ("user kind
    // wins"). ADDITIVE: callers without kind/origin are unaffected.
    var _ka = _entityKind(a), _kb = _entityKind(b);
    if (_ka && _kb && _ka !== _kb && _entityIsUser(a) && _entityIsUser(b)) return false;
    // PK.same is loose token-overlap; accept it ONLY when the names don't carry
    // conflicting distinctive tokens (else two distinct civic POIs sharing a
    // city + category word would merge and hide a pin).
    if (PK && typeof PK.same === "function" && PK.same(a.place, b.place)
        && !_conflictingNames(a.place, b.place)) return true;
    // Redundant geographic-feature suffix → same place, by name. No coord gate is
    // needed (the feature word is descriptive, not distinguishing); a coord VETO
    // inside _featureVariant still blocks far-apart name-heads.
    if (_featureVariant(a, b)) return true;
    if (PK && typeof PK.contains === "function" && PK.contains(a.place, b.place)) {
      return (a.coords && b.coords) ? _coordsClose(a.coords, b.coords, 0.6) : false;
    }
    return false;
  }

  // ── PlacementPolicy — ordered PlacementRules ──────────────────────
  // A place's section is the section of the FIRST rule whose match() holds.
  // Each rule is a single, independently-testable decision; ADDING A CATEGORY
  // IS ADDING A RULE (open/closed) — never editing a branch of one function.
  // The default chain below reproduces the historical sectionFor() EXACTLY;
  // order is significant. A PlacementRule is { id, match(place)->bool,
  // section(place)->string }.
  //
  //   origin   : "user" | "max-hub" | "max"
  //   role     : "stay" | "sight"
  //   decision : "checked" | "unchecked" | "rejected"
  //   themeFit : a theme section name (LLM / added / own-category), or null
  var _DEFAULT_PLACEMENT_RULES = [
    { id: "stay-user", match: function (p) { return p.role === "stay" && p.origin === "user"; },
      section: function () { return SECTION.STAYS_USER; } },
    { id: "stay-rec", match: function (p) { return p.role === "stay"; },
      section: function () { return SECTION.STAYS_REC; } },
    // A named-route umbrella (no specific theme) belongs in scenic routes
    // regardless of check state — it is a route, not a sight.
    { id: "scenic-route", match: function (p) { return _inScenic(p); },
      section: function () { return SECTION.SCENIC; } },
    // Committed (checked) sight in its theme.
    { id: "checked-theme", match: function (p) { return p.decision === "checked" && !!p.themeFit; },
      section: function (p) { return p.themeFit; } },
    // PD.406 (reverses PD.405): a kept sight the categorizer missed pools into
    // the shared "Unique sights" bucket — it does NOT get its own single-member
    // category named for the place. Per-place self-named chips ("Kirkjufell (1)",
    // "Húsavík (1)") read as categorizer noise and make the section chips fail to
    // add up; one "Unique sights (N)" chip groups every themeless kept sight,
    // stays countable, and the user can still see each place inside it. (Manual
    // adds are unaffected — they carry themeFit=place via the ingest path and so
    // match checked-theme above, which is the deliberate "Places you added" UX.)
    { id: "checked-unique", match: function (p) { return p.decision === "checked"; },
      section: function () { return SECTION.UNIQUE; } },
    // Unchecked sight shown in its theme. (Rejected places never reach the
    // queries, so no rejected branch is needed.)
    { id: "unchecked-theme", match: function (p) { return !!p.themeFit; },
      section: function (p) { return p.themeFit; } },
    // Enhance leftover near a listed place.
    { id: "near-listed", match: function (p) { return !!p.nearListed; },
      section: function () { return SECTION.SIGHTS_NEAR; } },
    // A Max suggestion with no theme — the catch-all (always matches; keep last).
    { id: "default-more", match: function () { return true; },
      section: function () { return SECTION.MORE; } }
  ];
  // Module-scoped active chain so sectionFor is robust to detached calls.
  var _placementRules = _DEFAULT_PLACEMENT_RULES.slice();

  var PlacementPolicy = {
    rules: _placementRules, // live reference; addRule/resetRules mutate in place
    // Register a new PlacementRule. By default it is inserted BEFORE the
    // catch-all so a specific category wins over "More places to consider";
    // pass { atEnd: true } to append after it. THIS is how a new section type
    // is added — open/closed, no edit to sectionFor.
    addRule: function (rule, opts) {
      if (!rule || typeof rule.match !== "function" || typeof rule.section !== "function") {
        throw new Error("PlacementRule must implement match(place) and section(place)");
      }
      opts = opts || {};
      if (opts.atEnd) { _placementRules.push(rule); return rule; }
      var i = _placementRules.length - 1; // before the final catch-all
      _placementRules.splice(i < 0 ? 0 : i, 0, rule);
      return rule;
    },
    resetRules: function () {
      _placementRules.length = 0;
      Array.prototype.push.apply(_placementRules, _DEFAULT_PLACEMENT_RULES);
    },
    sectionFor: function (p) {
      if (!p) return SECTION.MORE;
      for (var i = 0; i < _placementRules.length; i++) {
        if (_placementRules[i].match(p)) return _placementRules[i].section(p);
      }
      return SECTION.MORE; // defensive — default-more always matches
    }
  };

  // ── DiscoveryModel — SSOT + single writer ─────────────────────────
  function DiscoveryModel() {
    this._byKey = Object.create(null); // key → Place
    this._order = [];                  // insertion order of keys
    this._listeners = Object.create(null); // event → [fn] (observer pattern)
  }

  DiscoveryModel.SECTION = SECTION;
  DiscoveryModel.PlacementPolicy = PlacementPolicy;

  // ── Events (observer pattern) ─────────────────────────────────────
  // Every single-writer mutation emits "change"; the view subscribes and
  // re-projects, persistence subscribes and saves. This is what lets the
  // renderer be a pure read-only projection instead of writing state back.
  DiscoveryModel.prototype.on = function (evt, fn) {
    if (!evt || typeof fn !== "function") return function () {};
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    var self = this;
    return function () { self.off(evt, fn); }; // unsubscribe handle
  };
  DiscoveryModel.prototype.off = function (evt, fn) {
    var ls = this._listeners[evt];
    if (!ls) return;
    var i = ls.indexOf(fn);
    if (i !== -1) ls.splice(i, 1);
  };
  DiscoveryModel.prototype._emit = function (evt, data) {
    var ls = this._listeners[evt];
    if (!ls || !ls.length) return;
    // copy so a handler that unsubscribes mid-emit doesn't skip its neighbors
    ls.slice().forEach(function (fn) {
      try { fn(data); }
      catch (e) { if (typeof console !== "undefined") console.warn("[DiscoveryModel] listener error on " + evt + ":", e && e.message); }
    });
  };

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
      this._emit("change", { type: "upsert", place: existing });
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
    this._emit("change", { type: "upsert", place: place });
    return place;
  };

  // Single-writer mutations. Each emits "change" so views/persistence react.
  DiscoveryModel.prototype.setDecision = function (placeName, decision) {
    var e = this._findExisting({ place: placeName });
    if (e) { e.decision = decision; this._emit("change", { type: "decision", place: e }); }
    return e;
  };
  DiscoveryModel.prototype.setRole = function (placeName, role) {
    var e = this._findExisting({ place: placeName });
    if (e) { e.role = role; this._emit("change", { type: "role", place: e }); }
    return e;
  };
  // setTheme — the single writer for a place's themeFit (used by ThemingService
  // in place of the old applyTheming stamping p._themeFit on raw arrays).
  DiscoveryModel.prototype.setTheme = function (placeName, theme) {
    var e = this._findExisting({ place: placeName });
    if (e) { e.themeFit = theme || null; this._emit("change", { type: "theme", place: e }); }
    return e;
  };

  DiscoveryModel.prototype.all = function () {
    var self = this;
    return this._order.map(function (k) { return self._byKey[k]; });
  };

  // ── Persistence: snapshot()/restore() ─────────────────────────────
  // A plain, serializable view of the ledger (no src back-references, no
  // listeners) that round-trips every domain attribute the queries read.
  // PersistenceService uses these instead of reaching into _byKey.
  DiscoveryModel.prototype.snapshot = function () {
    var self = this;
    return this._order.map(function (k) {
      var p = self._byKey[k];
      return {
        key: p.key, place: p.place,
        coords: p.coords ? { lat: p.coords.lat, lng: p.coords.lng } : null,
        origin: p.origin, role: p.role, decision: p.decision, themeFit: p.themeFit,
        listedRole: p.listedRole, nearListed: p.nearListed,
        routeUmbrella: p.routeUmbrella, _decisionSet: p._decisionSet
      };
    });
  };
  DiscoveryModel.restore = function (snap) {
    var m = new DiscoveryModel();
    (snap || []).forEach(function (rec) {
      if (!rec || !rec.key) return;
      m._byKey[rec.key] = {
        key: rec.key, place: rec.place,
        coords: rec.coords || null,
        origin: rec.origin || "max", role: rec.role || "sight",
        decision: rec.decision || "unchecked", themeFit: rec.themeFit || null,
        listedRole: rec.listedRole || null, nearListed: !!rec.nearListed,
        routeUmbrella: !!rec.routeUmbrella, src: null,
        _decisionSet: !!rec._decisionSet
      };
      m._order.push(rec.key);
    });
    return m;
  };

  // ── Pure queries ──────────────────────────────────────────────────

  // sections() — the rendered shape: ordered list of { section, places }.
  // Section membership is PlacementPolicy.sectionFor for each place.
  // Rejected places are omitted. This is the single derivation the
  // view renders and every count reads.
  var SECTION_ORDER = [
    SECTION.STAYS_USER, SECTION.STAYS_REC, SECTION.UNIQUE
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
  _CATCH_SET[SECTION.FROM_LIST] = 1;  _CATCH_SET[SECTION.UNIQUE] = 1;

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
      // SSOT Stage 5: "Places you added" is NOT a real section — it was a
      // generic bucket for manually-added places. Each such place becomes its
      // OWN single-member category named for the place (the PD.405 pattern),
      // for BOTH checked and unchecked, so the "Places you added" chip never
      // appears and a manual add reads as the real (if unique) thing it is.
      var isAdded = (sec === "Places you added");
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
        // "Places you added" → each place's OWN name is its category.
        var placeTheme = (p._themeFit && String(p._themeFit)) || (isAdded ? p.place : themeFit);
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
  // list that can drift. Includes UNIQUE ("Unique sights"), which SectionKind does not.
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
  global.DiscoveryModel = DiscoveryModel;
  global.MaxDiscovery = api;

export default api;
