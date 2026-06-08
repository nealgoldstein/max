// place-repo.js — PD.401M: the place repository.
//
// THE single store of every place that exists in a trip's discovery
// data — sight, named-route umbrella, stay, region, destination — interned
// ONCE under the canonical `_key` (the identity stamped at the write door).
// It answers existence questions with a single lookup, in one identity:
//
//   repo.has(name)      — is this place present ANYWHERE?
//   repo.find(name)     — the interned record (coverage-fuzz aware)
//   repo.coverage(list) — for each listed name: found? what kind? where?
//   repo.byKind(kind)   — every place of a kind
//
// WHY IT EXISTS
// -------------
// The DiscoveryModel only knows about SIGHTS (routes/stays/regions are
// passthrough), so it cannot answer "is this listed place present?" for a
// place that became a route or a region — which forced a bespoke scan in
// the coverage audit (and a false "missing" warning for "Golden Circle").
// The repository is the superset registry: one keyed store, every kind,
// one identity. "Is X present" is a lookup, not a scan that can drift.
//
// Pure and standalone (DOM-free, Node-testable). Interns by the stamped
// `_key` when present (coordinate-canonical, authored by the write door),
// else by name identity (PlaceKey.resolve).

(function (global) {
  "use strict";

  var PK = global.PlaceKey || null;

  function _norm(s) {
    if (PK && typeof PK.resolve === "function") { try { return PK.resolve(s); } catch (_) {} }
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  // Coverage match: exact key, or the unified relatedTo (exact | token
  // overlap | word-prefix containment) so "Þingvellir" finds "Þingvellir
  // National Park". Permissive because it only LABELS found/missing.
  function _related(a, b) {
    if (PK && typeof PK.relatedTo === "function") return PK.relatedTo(a, b);
    return _norm(a) === _norm(b);
  }

  function PlaceRepository() {
    this._byKey = Object.create(null);   // key → record (SINGLE store)
    this._order = [];
  }

  // add(raw) — the write door of the repository. Idempotent: a place that
  // resolves to an existing `_key` merges in (records its kind + section).
  //   raw: { place, _key?, lat?, lng?, section?, kind?, _keep?, _origin?, src? }
  PlaceRepository.prototype.add = function (raw) {
    if (!raw || !raw.place) return null;
    // PD.401M: the repository keys by NAME identity (PlaceKey.resolve), NOT
    // the coordinate-canonical `_key`. Existence/coverage asks "is this
    // NAME present" — keying by `_key` would merge two differently-named
    // places at one point into a single record and HIDE one of them from
    // coverage (an intermittent false "missing" when async coords shift
    // the merge). Name keying is stable and is the right granularity here.
    var key = _norm(raw.place);
    if (!key) return null;
    var rec = this._byKey[key];
    if (rec) {
      if (raw.kind) rec.kinds[raw.kind] = true;
      if (raw.section && rec.sections.indexOf(raw.section) === -1) rec.sections.push(raw.section);
      if (raw._keep === true) rec.anyKeep = true;
      if (!rec.coords && typeof raw.lat === "number" && typeof raw.lng === "number") rec.coords = { lat: raw.lat, lng: raw.lng };
      if (!rec.origin && raw._origin) rec.origin = raw._origin;
      return rec;
    }
    rec = {
      key: key,
      place: raw.place,
      coords: (typeof raw.lat === "number" && typeof raw.lng === "number") ? { lat: raw.lat, lng: raw.lng } : null,
      kinds: {},
      sections: raw.section ? [raw.section] : [],
      anyKeep: raw._keep === true,
      origin: raw._origin || null,
      src: raw.src || null
    };
    if (raw.kind) rec.kinds[raw.kind] = true;
    this._byKey[key] = rec;
    this._order.push(key);
    return rec;
  };

  PlaceRepository.prototype.all = function () {
    var self = this;
    return this._order.map(function (k) { return self._byKey[k]; });
  };
  PlaceRepository.prototype.get = function (name) {
    var k = _norm(name);
    return (k && this._byKey[k]) ? this._byKey[k] : null;
  };
  // find(name) — present anywhere, with coverage fuzz.
  PlaceRepository.prototype.find = function (name) {
    var hit = this.get(name);
    if (hit) return hit;
    var all = this.all();
    for (var i = 0; i < all.length; i++) {
      if (_related(name, all[i].place) || _related(name, all[i].key)) return all[i];
    }
    return null;
  };
  PlaceRepository.prototype.has = function (name) { return !!this.find(name); };
  PlaceRepository.prototype.byKind = function (kind) {
    return this.all().filter(function (r) { return !!r.kinds[kind]; });
  };
  // coverage(listedNames) — the ONE coverage derivation. For each listed
  // name: found?/kinds/sections/checked. No scan in the caller.
  PlaceRepository.prototype.coverage = function (listed) {
    var self = this;
    return (listed || []).map(function (name) {
      var hit = self.find(name);
      return {
        place: name,
        found: !!hit,
        kinds: hit ? Object.keys(hit.kinds) : [],
        sections: hit ? hit.sections.slice() : [],
        checked: hit ? hit.anyKeep : false
      };
    });
  };

  // fromTrip — build the repository from a trip's placeActivities (EVERY
  // item, every kind) plus its destinations. The classifiers come from the
  // app so "stay section" / "route" mean the same thing they do elsewhere.
  //   opts: { isStaySection(section), isRouteSection(section) }
  PlaceRepository.fromTrip = function (placeActivities, destinations, opts) {
    opts = opts || {};
    var isStaySection = opts.isStaySection || function () { return false; };
    var isRouteSection = opts.isRouteSection || function () { return false; };
    var originOf = opts.originOf || function (p) {
      return (p && p._origin) || (p && p._autoCreated ? "max-hub" : "max");
    };
    var repo = new PlaceRepository();
    (destinations || []).forEach(function (d) {
      if (d && d.place) repo.add({ place: d.place, _key: d._key, lat: d.lat, lng: d.lng, kind: "destination", _keep: true, _origin: "user" });
    });
    (placeActivities || []).forEach(function (it) {
      if (!it) return;
      var sec = it.section || "";
      var kind = "sight";
      if (it.type === "route" || isRouteSection(sec)) kind = "route";
      else if (it.type === "condition") kind = "condition";
      else if (isStaySection(sec)) kind = "stay";
      else if (/regions?\b/i.test(sec)) kind = "region";
      // Route umbrellas are NOT sight-section slots — record the place
      // (so coverage finds it) but not the section, so section counts stay
      // sight-only (matching the picker's section chips).
      var secForCount = (kind === "route") ? undefined : sec;
      (it.requiredPlaces || []).forEach(function (p) {
        if (!p || !p.place) return;
        repo.add({ place: p.place, _key: p._key, lat: p.lat, lng: p.lng,
                   section: secForCount, kind: kind, _keep: p._keep !== false, _origin: originOf(p), src: p });
      });
    });
    return repo;
  };

  var api = { PlaceRepository: PlaceRepository };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PlaceRepo = api;
  global.PlaceRepository = PlaceRepository;

})(typeof globalThis !== "undefined" ? globalThis : this);
