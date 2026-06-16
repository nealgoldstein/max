// @ts-check
// place-set.js — THE domain model for Discovery (PD.432 architecture).
//
// One atom, one collection, one accounting. Everything the Discovery screen
// shows is a PROJECTION of a single PlaceSet — so the numbers cannot disagree,
// and adding a category or a count is a new filter, not a new pool.
//
// THE MODEL
//   A Place has exactly:
//     name      — display string
//     coords    — { lat, lng } | null   (for the map)
//     kind      — "destination" (somewhere you SLEEP) | "sight" (somewhere you
//                 STOP but don't sleep). THE one distinction the app turns on.
//     source    — "user" (you supplied it) | "max" (Max suggested it)
//     decision  — "kept" (checked) | "unchecked" | "rejected"
//     theme     — activity category for grouping (a sight's section), or null
//     nights    — overnight count (destinations carry > 0; sights are 0)
//   A Place knows how to render itself: toListRow() and toMapPin().
//
//   A PlaceSet interns Places by COORDINATE-AWARE identity (MaxDiscovery
//   .sameEntity). add() merges a duplicate into the place already present —
//   user source wins over max, a kept decision wins, the richer coords/theme
//   win — and records the merge, so duplicates collapse on insert and are
//   reported, never silently doubled.
//
// BOTH MODES FALL OUT OF ONE DESIGN — no special-casing:
//   • You gave a list:  ingest your places (source "user") first, Max merges in.
//   • All Max (a sentence, no list): the set is simply all source "max".
//   Nothing assumes user places exist; counts().userSights is just 0 then.
//
// PURE: DOM-free, async-free, Node-testable. Projections return plain data;
// the view layer maps rows → DOM and pins → markers.

(function (global) {
  "use strict";

  function _norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  // Coordinate-aware identity — the ONE identity the whole app already uses.
  function _sameEntity(a, b) {
    var SE = global.MaxDiscovery && global.MaxDiscovery.sameEntity;
    if (SE) { try { return SE(a, b); } catch (_) {} }
    return _norm(a && a.place) === _norm(b && b.place);
  }
  // PD.438: carry kind + source so sameEntity's origin-gated kind-veto keeps a
  // user base and a user sight distinct here too — so the banner agrees with the
  // rendered list (both keep "Skaftafell" the base separate from the glacier sight).
  function _asEntity(p) { return { place: p.name, coords: p.coords || null, kind: p.kind, source: p.source }; }

  // ── Place — the atom ──────────────────────────────────────────────
  function Place(spec) {
    spec = spec || {};
    this.name     = spec.name != null ? String(spec.name) : "";
    this.coords   = (spec.coords && typeof spec.coords.lat === "number" && typeof spec.coords.lng === "number")
      ? { lat: spec.coords.lat, lng: spec.coords.lng } : null;
    this.kind     = spec.kind === "destination" ? "destination" : "sight";
    this.source   = spec.source === "user" ? "user" : "max";
    this.decision = (spec.decision === "kept" || spec.decision === "rejected") ? spec.decision : "unchecked";
    // THEMES — a place can belong to SEVERAL activity categories at once (a
    // waterfall in "Chase waterfalls" AND "Along the route"). The list shows it
    // once per category (a "slot"); the accounting counts it once (unique). So a
    // Place carries a SET of themes; `theme` stays as the first, for single-
    // category callers and back-compat.
    this.themes = [];
    if (Array.isArray(spec.themes)) {
      for (var _t = 0; _t < spec.themes.length; _t++) {
        var _tv = spec.themes[_t];
        if (_tv != null && String(_tv) && this.themes.indexOf(String(_tv)) < 0) this.themes.push(String(_tv));
      }
    } else if (spec.theme != null && String(spec.theme).length) {
      this.themes.push(String(spec.theme));
    }
    this.theme    = this.themes.length ? this.themes[0] : null;
    this.nights   = (typeof spec.nights === "number") ? spec.nights : (this.kind === "destination" ? 1 : 0);
  }
  Place.prototype.isOvernight = function () { return this.kind === "destination"; };
  // A place renders itself to a list row …
  Place.prototype.toListRow = function () {
    return {
      name: this.name, kind: this.kind, source: this.source,
      decision: this.decision, checked: this.decision === "kept",
      theme: this.theme, themes: this.themes.slice(), nights: this.nights,
      mine: this.source === "user"
    };
  };
  // … and to a map pin (color by kind, filled when committed). Null without coords.
  Place.prototype.toMapPin = function () {
    if (!this.coords) return null;
    return {
      lat: this.coords.lat, lng: this.coords.lng, name: this.name,
      kind: this.kind,
      color: this.kind === "destination" ? "blue" : "green",
      filled: this.decision === "kept",     // solid = committed; hollow = a suggestion
      source: this.source
    };
  };

  // ── PlaceSet — the one collection ─────────────────────────────────
  function PlaceSet() { this._places = []; this._dupes = []; }

  // add(spec) — THE write door. Idempotent + identity-merging.
  PlaceSet.prototype.add = function (spec) {
    var p = (spec instanceof Place) ? spec : new Place(spec);
    if (!p.name) return null;
    for (var i = 0; i < this._places.length; i++) {
      var e = this._places[i];
      if (_sameEntity(_asEntity(e), _asEntity(p))) {
        // MERGE rules — never silently lose information:
        if (p.source === "user") e.source = "user";                 // your provenance wins
        if (p.decision === "kept") e.decision = "kept";             // a commit wins
        else if (p.decision === "rejected" && e.decision === "unchecked") e.decision = "rejected";
        if (!e.coords && p.coords) e.coords = p.coords;             // richer coords win
        // UNION themes — the same place surfacing under another category adds
        // that category to its set, so sections() can emit it into each (one
        // "slot" per theme). Never drop a membership.
        for (var _ti = 0; _ti < p.themes.length; _ti++) {
          if (e.themes.indexOf(p.themes[_ti]) < 0) e.themes.push(p.themes[_ti]);
        }
        if (!e.theme && e.themes.length) e.theme = e.themes[0];     // a real theme beats none
        // KIND: a destination-claim upgrades a sight ONLY when the place isn't
        // already YOUR designation. You said "sight" → Max claiming "destination"
        // can't override you; but between non-user records the overnight claim
        // (richer info) wins.
        if (p.kind === "destination" && e.kind === "sight" && e.source !== "user") {
          e.kind = "destination"; e.nights = Math.max(e.nights, p.nights || 1);
        }
        this._dupes.push({ kept: e.name, mergedAway: p.name });
        return e;
      }
    }
    this._places.push(p);
    return p;
  };

  PlaceSet.prototype.all = function () { return this._places.slice(); };
  PlaceSet.prototype.duplicates = function () { return this._dupes.slice(); };

  // ── THE accounting — every count is a filter over the one set ─────
  // Rejected places are off the page (not counted in the total). By
  // construction: total === kept + unchecked === userDestinations +
  // userSights + maxDestinations + maxSights — the surfaces cannot disagree.
  PlaceSet.prototype.counts = function () {
    var c = {
      userDestinations: 0, userSights: 0, maxDestinations: 0, maxSights: 0,
      kept: 0, unchecked: 0, rejected: 0, total: 0, slots: 0, duplicates: this._dupes.length
    };
    this._places.forEach(function (p) {
      if (p.decision === "rejected") { c.rejected++; return; }
      c.total++;
      // slots = category memberships (a place in two themes is two slots). The
      // section chips sum to slots; total is the unique-place count.
      c.slots += (p.themes && p.themes.length) ? p.themes.length : 1;
      if (p.decision === "kept") c.kept++; else c.unchecked++;
      if (p.source === "user") {
        if (p.kind === "destination") c.userDestinations++; else c.userSights++;
      } else {
        if (p.kind === "destination") c.maxDestinations++; else c.maxSights++;
      }
    });
    return c;
  };

  // ── Projections — the ONLY way surfaces read the set ──────────────
  // Group non-rejected places by theme (sights) / kind (stays). One section
  // object per group; the chip count is just places.length.
  PlaceSet.prototype.sections = function () {
    var by = Object.create(null), order = [];
    this._places.forEach(function (p) {
      if (p.decision === "rejected") return;
      // A place lands in EACH of its themes (a slot per category). With no
      // theme it falls to the kind's default bucket. So a multi-category sight
      // appears in several sections — the list's "slots" view — while counts()
      // still counts it once (the unique view).
      var titles = (p.themes && p.themes.length) ? p.themes
        : [p.kind === "destination" ? "Overnight stays" : "Other sights"];
      titles.forEach(function (title) {
        if (!by[title]) { by[title] = { title: title, kind: p.kind, places: [] }; order.push(title); }
        by[title].places.push(p);
      });
    });
    return order.map(function (t) { return by[t]; });
  };
  PlaceSet.prototype.listRows = function () {
    return this._places.filter(function (p) { return p.decision !== "rejected"; })
      .map(function (p) { return p.toListRow(); });
  };
  PlaceSet.prototype.mapPins = function () {
    return this._places.map(function (p) { return p.toMapPin(); }).filter(Boolean);
  };

  // missing(typedNames) — listed names with NO place in the set (a genuine
  // drop). Empty in all-Max mode (you typed nothing). Identity-aware.
  PlaceSet.prototype.missing = function (typedNames) {
    if (!Array.isArray(typedNames) || !typedNames.length) return [];
    var self = this;
    return typedNames.filter(function (nm) {
      return !self._places.some(function (p) { return _sameEntity(_asEntity(p), { place: nm }); });
    });
  };

  // ── Ingestion — build the ONE set from a trip ─────────────────────
  // Order matters: your TYPED list goes in FIRST (source "user"), so a place
  // you listed is in the set BY CONSTRUCTION and can never be "missing". Then
  // the discovery records merge in — your records add coords/theme/decision to
  // your typed places; Max's records are new. All-Max mode just has no typed
  // list, so the set is all "max" with nothing to special-case.
  //   opts.typedList     = { destinations:[name…], sights:[name…] }  (from notes)
  //   opts.isStaySection = fn(section)->bool      (defaults to the 3 stay names)
  //   opts.placeOrigin   = fn(reqPlace)->"user"|"max"  (defaults to _origin field)
  function _defaultIsStay(sec) {
    return /^(overnight stays|recommended overnight stays|overnight stays to consider)$/i.test(String(sec || "").trim());
  }
  function fromTrip(trip, opts) {
    opts = opts || {};
    var s = new PlaceSet();
    if (!trip) return s;
    var isStay = (typeof opts.isStaySection === "function") ? opts.isStaySection : _defaultIsStay;
    var originOf = (typeof opts.placeOrigin === "function") ? opts.placeOrigin
      : function (p) { return (p && p._origin === "user") ? "user" : "max"; };
    var typed = opts.typedList;
    if (typed) {
      (typed.destinations || []).forEach(function (nm) { s.add({ name: nm, kind: "destination", source: "user", decision: "kept", nights: 1 }); });
      (typed.sights || []).forEach(function (nm) { s.add({ name: nm, kind: "sight", source: "user", decision: "kept" }); });
    }
    (Array.isArray(trip.placeActivities) ? trip.placeActivities : []).forEach(function (it) {
      if (!it || it.type === "route") return;          // route umbrellas are infra, not page places
      var sec = it.section || "", stay = isStay(sec);
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        // KIND is decided by the SECTION the place lives in — a stay section is
        // a destination, a sight theme is a sight. (We deliberately do NOT use
        // the per-place `nights` field: it's noise in this data — defaulted to a
        // nonzero value on many sights — so trusting it mis-counts waterfalls as
        // bases. Section placement is the reliable signal for trip-role.)
        s.add({
          name: p.place,
          coords: (typeof p.lat === "number" && typeof p.lng === "number") ? { lat: p.lat, lng: p.lng } : null,
          kind: stay ? "destination" : "sight",
          source: originOf(p),
          decision: (p._rejected === true) ? "rejected" : (p._keep === false ? "unchecked" : "kept"),
          theme: stay ? null : sec,
          nights: (typeof p.nights === "number") ? p.nights : (stay ? 1 : 0)
        });
      });
    });
    return s;
  }

  var api = { Place: Place, PlaceSet: PlaceSet, fromTrip: fromTrip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MaxPlaceSet = api;

})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
