// @ts-check
// discovery-session.js — SSOT Phase 5: the DiscoverySession coordinator.
//
// ONE live model per picker session, composing all four services. This is the
// API the picker becomes a thin shell over, replacing the _tb pass-chain:
//
//   var s = MaxDiscoverySession.open(trip, { save: persistFn });
//   s.counts(); s.sections();            // read-only projection (the view)
//   s.keep(name) / s.uncheck / s.reject; // single-writer mutations
//   s.enhance("more-like-this");         // extension point → model.upsert
//   s.close();
//
// Every mutation flows: model.<mutate> → "change" → (debounced) writeModelToTrip
// → save. The view never writes state; it subscribes to the model and projects.
// Because all writes funnel through the model's one coordinate-aware upsert,
// nothing can ratchet or disappear — that is enforced, not hoped.
(function (global) {
  "use strict";

  function _ing()    { return global.MaxIngestion; }
  function _persist(){ return global.MaxPersistence; }
  function _enhance(){ return global.MaxEnhance; }
  function _MD()     { return global.MaxDiscovery; }

  function DiscoverySession(trip, opts) {
    opts = opts || {};
    this.trip = trip || null;
    var ING = _ing(), MD = _MD();
    this.model = (ING && ING.buildModel && trip) ? ING.buildModel(trip)
      : (MD && MD.DiscoveryModel ? new MD.DiscoveryModel() : null);
    this._save = (typeof opts.save === "function") ? opts.save : function () {};
    this._writeBack = (opts.writeBack !== false);
    var self = this, P = _persist();
    this._unbind = (P && P.bind && this.model)
      ? P.bind(this.model, function () { self._onChange(); }, opts.debounceMs)
      : function () {};
  }

  DiscoverySession.prototype._onChange = function () {
    var P = _persist();
    if (this._writeBack && this.trip && P && P.writeModelToTrip) {
      P.writeModelToTrip(this.trip, this.model);
    }
    try { this._save(this.trip, this.model); } catch (e) {
      if (typeof console !== "undefined") console.warn("[DiscoverySession] save failed:", e && e.message);
    }
  };

  // ── Read-only projection (what the view renders) ──────────────────
  DiscoverySession.prototype.sections   = function () { return this.model.sections(); };
  DiscoverySession.prototype.considered = function () { return this.model.considered(); };
  DiscoverySession.prototype.committed  = function () { return this.model.committed(); };
  DiscoverySession.prototype.counts = function () {
    var MD = _MD(), S = MD.SECTION, Policy = MD.PlacementPolicy;
    var unchecked = this.model.considered(), catchall = 0;
    unchecked.forEach(function (p) {
      var sec = Policy.sectionFor(p);
      if (sec === S.SIGHTS_NEAR || sec === S.MORE) catchall++;
    });
    return { total: unchecked.length, catchall: catchall,
      other: unchecked.length - catchall, committed: this.model.committed().length };
  };

  // ── Single-writer mutations (user actions) ────────────────────────
  DiscoverySession.prototype.keep    = function (name) { this.model.setDecision(name, "checked");   return this; };
  DiscoverySession.prototype.uncheck = function (name) { this.model.setDecision(name, "unchecked"); return this; };
  DiscoverySession.prototype.reject  = function (name) { this.model.setDecision(name, "rejected");  return this; };
  DiscoverySession.prototype.setTheme= function (name, theme) { this.model.setTheme(name, theme);   return this; };

  // ── Enhancement (the extension point) ─────────────────────────────
  DiscoverySession.prototype.enhance = function (sourceId, ctx) {
    var E = _enhance();
    if (!E || !E.run) return Promise.reject(new Error("EnhancementService not loaded"));
    return E.run(sourceId, this.model, ctx); // upserts → change → write-back → save
  };
  DiscoverySession.prototype.availableSources = function (ctx) {
    var E = _enhance(); return (E && E.available) ? E.available(ctx) : [];
  };

  DiscoverySession.prototype.close = function () { if (this._unbind) this._unbind(); };

  function open(trip, opts) { return new DiscoverySession(trip, opts); }

  var api = { DiscoverySession: DiscoverySession, open: open };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MaxDiscoverySession = api;
})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : this));
