// @ts-check
// place-key.js — PD.357 (Phase 3): ONE place identity.
//
// Every recurring bug in the "renamed place" family — "Mývatn
// natursone baths" listed but unchecked, user places badged "Max
// suggests", dedupe misses that let the Discovery set ratchet —
// came from place-name matching being scattered: four matchers
// (badge resolver, keep pass, backstop, canonicalizer) each with
// their own normalization and fuzz. This module makes place
// identity a single owned concept:
//
//   PlaceKey.norm(name)        → normalized key (delegates to the
//                                app-wide _normPlaceName when present)
//   PlaceKey.resolve(name)     → canonical key, ALIAS-AWARE: if the
//                                LLM renamed the user's place and we
//                                learned the link, both names resolve
//                                to the same key
//   PlaceKey.same(a, b)        → identity test (resolve + the PD.339
//                                token-overlap fuzz, centralized here)
//   PlaceKey.learn(alias, canonical) → record a rename. Every fuzzy
//                                hit anywhere in the app upgrades to
//                                an exact hit forever after.
//   PlaceKey.serialize() / hydrate(map) → persistence bridge; the
//                                registry travels on trip.brief._placeAliases
//
// The registry is intentionally append-only and one-hop (no chains):
// learn("a","b") then learn("b","c") leaves "a"→"b". Chains would
// let two distinct real places collapse through a chain of weak
// matches; one hop bounds the damage of a bad learn.

const global = /** @type {any} */ (globalThis);
  "use strict";

  var _aliases = Object.create(null); // normAlias → normCanonical
  var _dirty = false;

  function norm(s) {
    if (s == null) return "";
    if (typeof global._normPlaceName === "function") {
      try { return global._normPlaceName(s); } catch (_) {}
    }
    return String(s).toLowerCase()
      .replace(/[’'`´]/g, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function resolve(name) {
    var k = norm(name);
    if (!k) return "";
    var canon = _aliases[k];
    return (typeof canon === "string" && canon) ? canon : k;
  }

  // PD.339's token-overlap matcher, centralized: ≥2 shared tokens
  // covering ≥2/3 of the shorter name. One-token overlaps
  // ("Reykjavík" vs "Reykjavík Old Harbour") deliberately don't match.
  function tokenOverlap(aKey, bKey) {
    var aT = aKey.split(/\s+/).filter(Boolean);
    var bT = bKey.split(/\s+/).filter(Boolean);
    if (aT.length < 2 || bT.length < 2) return false;
    var shared = 0;
    for (var i = 0; i < aT.length; i++) {
      if (bT.indexOf(aT[i]) >= 0) shared++;
    }
    var minLen = Math.min(aT.length, bT.length);
    return shared >= 2 && shared >= Math.ceil(minLen * 2 / 3);
  }

  function same(a, b) {
    var ka = resolve(a), kb = resolve(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    return tokenOverlap(ka, kb);
  }

  // PD.397: word-prefix containment — "Þingvellir" ⊂ "Þingvellir
  // National Park". This is the identity relation that `same` (token
  // overlap, which requires 2+ tokens on BOTH sides) deliberately
  // misses for single-word names. One word-bounded run, so it does
  // NOT over-match ("Diamond" vs "Diamond Beach" only if "Diamond" is
  // a full leading word — which it is, so callers gate on context).
  function contains(a, b) {
    var ka = resolve(a), kb = resolve(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (kb.length > ka.length && kb.indexOf(ka + " ") === 0) return true;
    if (ka.length > kb.length && ka.indexOf(kb + " ") === 0) return true;
    return false;
  }

  // relatedTo — THE identity relation every consumer should use:
  // exact, token-overlap fuzz, OR word-prefix containment. One
  // matcher, so the dedup, the coverage audit, and the badge resolver
  // can never disagree about whether two names are the same place.
  function relatedTo(a, b) {
    return same(a, b) || contains(a, b);
  }

  function learn(aliasName, canonicalName) {
    var a = norm(aliasName);
    var c = resolve(canonicalName); // one hop: store the CANONICAL end
    if (!a || !c || a === c) return false;
    if (_aliases[a] === c) return false;
    _aliases[a] = c;
    _dirty = true;
    return true;
  }

  function serialize() {
    var out = {};
    for (var k in _aliases) out[k] = _aliases[k];
    return out;
  }

  function hydrate(map) {
    if (!map || typeof map !== "object") return;
    for (var k in map) {
      if (typeof map[k] === "string" && map[k]) _aliases[k] = map[k];
    }
    _dirty = false;
  }

  // PD.361: a bad learn is no longer permanent. forget(alias) removes
  // the link; list() makes the registry inspectable. Surfaced in the
  // browser as MaxAliases.list() / MaxAliases.forget("name").
  function forget(aliasName) {
    var a = norm(aliasName);
    if (!a || !(a in _aliases)) return false;
    delete _aliases[a];
    _dirty = true;
    return true;
  }

  function list() {
    var out = [];
    for (var k in _aliases) out.push({ alias: k, canonical: _aliases[k] });
    return out;
  }

  function reset() { _aliases = Object.create(null); _dirty = false; }
  function isDirty() { return _dirty; }
  function clearDirty() { _dirty = false; }

  var api = {
    norm: norm,
    resolve: resolve,
    same: same,
    contains: contains,
    relatedTo: relatedTo,
    tokenOverlap: tokenOverlap,
    learn: learn,
    forget: forget,
    list: list,
    serialize: serialize,
    hydrate: hydrate,
    reset: reset,
    isDirty: isDirty,
    clearDirty: clearDirty
  };

  global.PlaceKey = api;

export default api;
