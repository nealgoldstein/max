// @ts-check
import { DiscoveryModel } from "./discovery-model.mjs";
import PlaceKey from "./place-key.mjs";
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

const global = /** @type {any} */ (globalThis);
  "use strict";

  var PK = global.PlaceKey || null;

  function _norm(s) {
    if (PK && typeof PK.resolve === "function") { try { return PK.resolve(s); } catch (_) {} }
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  // PD.401T: PURE normalization — accent/case folding ONLY, with NO alias
  // resolution. _norm() above goes through PlaceKey.resolve, which applies
  // the LEARNED ALIAS registry; a corrupted alias can knock an accented
  // name (Vík, Höfn, Þingvellir) onto an unexpected key so the exact-key
  // lookup misses and coverage falsely reports it "missing" (and miscounts
  // it as a Max suggestion). Existence must be decidable by the place's own
  // name, never by mutable learned state — this is the alias-free anchor.
  function _pureNorm(s) {
    if (PK && typeof PK.norm === "function") { try { return PK.norm(s); } catch (_) {} }
    if (typeof global._normPlaceName === "function") { try { return global._normPlaceName(s); } catch (_) {} }
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  // a is a WORD-prefix of b ("thingvellir" of "thingvellir national park").
  // Word-boundary guarded so "vik" does not prefix-match "viking".
  function _purePrefix(a, b) {
    return !!a && !!b && b.length > a.length && b.indexOf(a + " ") === 0;
  }
  // Coverage match: exact key, or the unified relatedTo (exact | token
  // overlap | word-prefix containment) so "Þingvellir" finds "Þingvellir
  // National Park". Permissive because it only LABELS found/missing.
  function _related(a, b) {
    if (PK && typeof PK.relatedTo === "function") return PK.relatedTo(a, b);
    return _norm(a) === _norm(b);
  }

  // PD.476 (data integrity): real coordinates only. The LLM frequently
  // copies the prompt's example JSON (lat:0.0, lng:0.0) verbatim, so a
  // place can arrive with the [0,0] "null island" sentinel — a real point
  // in the Atlantic. We made the MAP robust to it (PD.440), but it should
  // never enter the place registry as if it were a location, or distance /
  // directions / booking code downstream will trust it. Reject near-[0,0].
  function _realLL(lat, lng) {
    return typeof lat === "number" && isFinite(lat)
        && typeof lng === "number" && isFinite(lng)
        && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
  }

  // The ONE canonical place-identity. sameEntity is coordinate-aware: it
  // merges true name-variants ("Goðafoss" / "Goðafoss Waterfall", a bare name
  // and its natural-feature form) but its vetoes (coord-disagreement,
  // conflicting distinctive tokens) NEVER merge two distinct places — so
  // interning by it collapses variants WITHOUT hiding anything (the exact
  // concern that pushed this repo to name-keying originally). Falls back to
  // name identity when the discovery model isn't loaded (e.g. Node unit tests
  // that don't require discovery-model.js).
  function _sameEntity(aPlace, aCoords, bPlace, bCoords) {
    var MD = global.MaxDiscovery;
    if (MD && typeof MD.sameEntity === "function") {
      try { return MD.sameEntity({ place: aPlace, coords: aCoords || null },
                                 { place: bPlace, coords: bCoords || null }); }
      catch (_) {}
    }
    return _norm(aPlace) === _norm(bPlace);
  }

  function PlaceRepository() {
    this._byKey = Object.create(null);   // key → record (SINGLE store)
    this._order = [];
  }

  // Find an already-interned record that is the SAME ENTITY as raw (by the
  // canonical identity). O(n) scan — the registry is small. Returns the
  // record so the new name can be aliased onto it.
  PlaceRepository.prototype._findSameEntity = function (raw) {
    var aCoords = _realLL(raw.lat, raw.lng) ? { lat: raw.lat, lng: raw.lng } : null;
    for (var i = 0; i < this._order.length; i++) {
      var rec = this._byKey[this._order[i]];
      if (rec && _sameEntity(raw.place, aCoords, rec.place, rec.coords)) return rec;
    }
    return null;
  };

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
    // Entity interning: no exact-name record, but the place may already be
    // present under a VARIANT name (Goðafoss ⇄ Goðafoss Waterfall). Alias this
    // name onto that one record so coverage still resolves both names while
    // all()/counts see one place. _order holds only distinct records, so the
    // alias name is added to the index but NOT to _order.
    if (!rec) {
      var _same = this._findSameEntity(raw);
      if (_same) { this._byKey[key] = _same; rec = _same; }
    }
    if (rec) {
      if (raw.kind) rec.kinds[raw.kind] = true;
      if (raw.section && rec.sections.indexOf(raw.section) === -1) rec.sections.push(raw.section);
      if (raw._keep === true) rec.anyKeep = true;
      if (!rec.coords && _realLL(raw.lat, raw.lng)) rec.coords = { lat: raw.lat, lng: raw.lng };
      if (!rec.origin && raw._origin) rec.origin = raw._origin;
      return rec;
    }
    rec = {
      key: key,
      place: raw.place,
      coords: _realLL(raw.lat, raw.lng) ? { lat: raw.lat, lng: raw.lng } : null,
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
    // PD.401T: alias-free anchor. If the alias-aware passes all missed,
    // match on PURE normalization of the place's own name. This guarantees
    // a place that is genuinely present (record.place === the listed name,
    // accents and all) can never be reported "missing" because a learned
    // alias corrupted its key. Exact pure-normalized equality only — no
    // fuzz, so it can't create false matches.
    var pn = _pureNorm(name);
    if (pn) {
      // Pass 1: exact pure-normalized equality (Vík, Höfn, the accented stays).
      for (var j = 0; j < all.length; j++) {
        if (_pureNorm(all[j].place) === pn || _pureNorm(all[j].key) === pn) return all[j];
      }
      // Pass 2: alias-free WORD-PREFIX containment, so a one-word listed
      // name ("Þingvellir") still finds its qualified record ("Þingvellir
      // National Park") even when a corrupted alias has broken the
      // alias-aware relatedTo above. Coverage only LABELS found/missing, so
      // permissive containment is safe; an exact stay record (e.g.
      // "Reykjavik") already matched in pass 1, so this can't mislabel one.
      for (var m = 0; m < all.length; m++) {
        var rp = _pureNorm(all[m].place);
        if (rp && (_purePrefix(pn, rp) || _purePrefix(rp, pn))) return all[m];
      }
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
  global.PlaceRepo = api;
  global.PlaceRepository = PlaceRepository;

export default api;

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.PlaceRepository = PlaceRepository;
  __expg._pureNorm = _pureNorm;
  __expg._purePrefix = _purePrefix;
  __expg._related = _related;
}
