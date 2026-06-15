// @ts-check
// engine-enrich.js — serialized background enrichment queue.
//
// PD.325. Before this module, every fresh trip fired generateCityData
// for ALL destinations in parallel via forEach. 46 destinations =
// 46 simultaneous LLM POSTs. Anthropic's rate limit responds with
// 429s, most calls fail, the few that land get persisted but the
// rest stay with empty `dest.suggestions`. Every subsequent load
// repeats the bombardment, hits the same rate limit, gets the same
// empty result. Symptom: "the sights the LLM added when I first
// created the trip are gone." They were never there — they never
// landed past rate-limiting.
//
// This queue replaces the parallel bombardment with a serialized
// background processor:
//
//   - Concurrency 1 (one call at a time)
//   - Min interval between calls (default 1200ms — well under
//     Anthropic's per-second budget)
//   - Exponential backoff on 429 / network failure
//   - Persists after each successful landing so progress survives
//     reloads
//   - Idempotent: enqueueing a destId that's already pending or
//     already enriched is a no-op
//
// Usage:
//   MaxEnrich.enqueue(destId, place);          // queue one
//   MaxEnrich.enqueueAll(trip.destinations);   // queue all
//   MaxEnrich.cancel(destId);                  // user opens dest view → priority bump
//   MaxEnrich.priority(destId);                // move to front of queue
//   MaxEnrich.status();                        // diagnostic
//
// The enricher itself is injected — this module knows nothing about
// `generateCityData`'s internals. That keeps it testable and lets
// future enrichers (per-day-plan LLM, restaurants, etc.) share the
// same queue primitive.

(function (global) {
  "use strict";

  // ── Configuration ───────────────────────────────────────────────

  var DEFAULT_INTERVAL_MS = 1200;     // floor between LLM calls
  var MAX_BACKOFF_MS      = 60000;    // cap exponential backoff
  var BASE_BACKOFF_MS     = 2000;     // 429: 2s, 4s, 8s, 16s, 32s, 60s, 60s…

  // ── State ───────────────────────────────────────────────────────

  // Pending queue. Each entry: { destId, place, attempts, backoffMs }.
  // FIFO by default; cancel/priority can mutate the order.
  var _queue = [];

  // Set of destIds currently enqueued (membership test).
  var _enqueued = Object.create(null);

  // The enricher function (sync or async). Injected via
  // MaxEnrich.setEnricher. Signature: enricher(place, destId) → Promise
  // that resolves on success or rejects with an Error (with `.status`
  // set to 429 / 500 / etc. for backoff classification).
  var _enricher = null;

  // The "is this dest already enriched?" probe — injected. Lets the
  // queue skip dest that already have suggestions. Signature:
  // (destId) → boolean. Defaults to "always re-enrich" (cautious).
  /** @type {(destId?: any) => boolean} */
  var _isAlreadyEnriched = function () { return false; }; // pluggable hook (set via injectHooks)

  // The "persist current state" hook — called after each successful
  // enrichment so progress survives reload. Injected (typically
  // localSave or TripStore-equivalent). Signature: () → void.
  var _persistOnSuccess = function () {};

  // Processor state — single in-flight tick. `_dispatchToken` is
  // incremented every time we schedule a dispatch and every time we
  // reset; in-flight callbacks check their captured token against the
  // current one and bail if it changed. Prevents stale setTimeouts
  // (from a previous reset/cancel) from triggering a second dispatch.
  var _processing = false;
  var _lastCallAt = 0;
  var _dispatchToken = 0;
  var _pendingTimers = [];

  // Subscribers (for UI updates: progress bars, per-dest spinners).
  var _listeners = {};

  // ── Event bus (lightweight) ─────────────────────────────────────

  function on(event, fn) {
    if (!event || typeof fn !== "function") return function () {};
    (_listeners[event] = _listeners[event] || []).push(fn);
    return function () {
      var arr = _listeners[event]; if (!arr) return;
      var i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1);
    };
  }
  function emit(event, payload) {
    var arr = _listeners[event]; if (!arr || !arr.length) return;
    arr.slice().forEach(function (fn) {
      try { fn(payload || {}); }
      catch (err) { console.warn("[MaxEnrich] listener for " + event + ":", err && err.message); }
    });
  }

  // ── Configuration setters ───────────────────────────────────────

  function setEnricher(fn) {
    if (typeof fn !== "function") {
      throw new Error("[MaxEnrich] setEnricher requires a function");
    }
    _enricher = fn;
  }

  function setAlreadyEnrichedProbe(fn) {
    if (typeof fn !== "function") return;
    _isAlreadyEnriched = fn;
  }

  function setPersistHook(fn) {
    if (typeof fn !== "function") return;
    _persistOnSuccess = fn;
  }

  // ── Public API: enqueue ─────────────────────────────────────────

  function enqueue(destId, place) {
    if (!destId || !place) return false;
    if (_enqueued[destId]) return false;        // already pending
    if (_isAlreadyEnriched(destId)) return false; // already done
    _queue.push({ destId: destId, place: place, attempts: 0, backoffMs: 0 });
    _enqueued[destId] = true;
    emit("queue:add", { destId: destId, place: place, queueLen: _queue.length });
    _tick();
    return true;
  }

  function enqueueAll(destinations) {
    if (!Array.isArray(destinations)) return 0;
    var added = 0;
    destinations.forEach(function (d) {
      if (d && d.id && d.place) {
        if (enqueue(d.id, d.place)) added++;
      }
    });
    return added;
  }

  function cancel(destId) {
    if (!_enqueued[destId]) return false;
    _queue = _queue.filter(function (e) { return e.destId !== destId; });
    delete _enqueued[destId];
    emit("queue:cancel", { destId: destId });
    return true;
  }

  // Move a destId to the FRONT of the queue (used when user navigates
  // into a destination's view — their attention is on that dest, so
  // its enrichment should happen next, not wait behind 30 others).
  function priority(destId) {
    if (!_enqueued[destId]) return false;
    var idx = -1;
    for (var i = 0; i < _queue.length; i++) {
      if (_queue[i].destId === destId) { idx = i; break; }
    }
    if (idx <= 0) return false; // not in queue or already at front
    var entry = _queue.splice(idx, 1)[0];
    _queue.unshift(entry);
    emit("queue:priority", { destId: destId });
    return true;
  }

  // ── Processor ──────────────────────────────────────────────────

  function _tick() {
    if (_processing) return;
    if (!_queue.length) {
      emit("queue:idle", {});
      return;
    }
    if (!_enricher) {
      console.warn("[MaxEnrich] no enricher injected; queue has " + _queue.length + " pending");
      return;
    }
    _processing = true;
    // Respect the inter-call interval. If we just made a call, wait.
    var now = Date.now();
    var sinceLast = now - _lastCallAt;
    var delay = Math.max(0, DEFAULT_INTERVAL_MS - sinceLast);
    var myToken = ++_dispatchToken;
    var timerId = setTimeout(function () {
      // Token check: if a reset / cancel happened between schedule and
      // fire, our token is stale and we no-op. Prevents the "stale
      // setTimeout leaks across test/queue reset" bug class.
      if (myToken !== _dispatchToken) return;
      _dispatch();
    }, delay);
    _pendingTimers.push(timerId);
  }

  function _dispatch() {
    var entry = _queue[0];
    if (!entry) {
      _processing = false;
      emit("queue:idle", {});
      return;
    }
    _lastCallAt = Date.now();
    emit("queue:dispatch", {
      destId: entry.destId,
      place: entry.place,
      attempts: entry.attempts,
      remaining: _queue.length
    });

    // Run the enricher. Handle both sync and async by wrapping in
    // Promise.resolve.
    var p;
    try {
      var ret = _enricher(entry.place, entry.destId);
      p = Promise.resolve(ret);
    } catch (syncErr) {
      p = Promise.reject(syncErr);
    }

    p.then(function () {
      _onSuccess(entry);
    }, function (err) {
      _onFailure(entry, err);
    });
  }

  function _onSuccess(entry) {
    _queue.shift();
    delete _enqueued[entry.destId];
    try { _persistOnSuccess(); }
    catch (saveErr) { console.warn("[MaxEnrich] persist hook threw:", saveErr && saveErr.message); }
    emit("queue:success", {
      destId: entry.destId,
      place: entry.place,
      remaining: _queue.length
    });
    _processing = false;
    _tick();
  }

  function _onFailure(entry, err) {
    var status = err && err.status;
    var message = err && err.message || String(err);
    entry.attempts++;
    // 429 (rate limit) and network errors get backed off and retried.
    // Other 4xx (400, 401, 403) are not retried — those are caller
    // errors, retrying won't help.
    var retryable = !status                                  // network / unknown
                 || status === 429                            // rate limit
                 || (status >= 500 && status < 600);          // server error
    var MAX_ATTEMPTS = 5;
    if (retryable && entry.attempts < MAX_ATTEMPTS) {
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at MAX).
      entry.backoffMs = Math.min(
        MAX_BACKOFF_MS,
        BASE_BACKOFF_MS * Math.pow(2, entry.attempts - 1)
      );
      emit("queue:retry", {
        destId: entry.destId,
        place: entry.place,
        attempts: entry.attempts,
        backoffMs: entry.backoffMs,
        reason: message
      });
      // Move to back of queue so other destinations get a chance,
      // then wait the backoff before continuing.
      _queue.shift();
      _queue.push(entry);
      _processing = false;
      setTimeout(_tick, entry.backoffMs);
    } else {
      // Either non-retryable or out of attempts — drop and move on.
      _queue.shift();
      delete _enqueued[entry.destId];
      emit("queue:fail", {
        destId: entry.destId,
        place: entry.place,
        attempts: entry.attempts,
        reason: message
      });
      _processing = false;
      _tick();
    }
  }

  // ── Diagnostics ────────────────────────────────────────────────

  function status() {
    return {
      pending: _queue.length,
      processing: _processing,
      enqueuedDestIds: Object.keys(_enqueued),
      hasEnricher: !!_enricher,
      lastCallAt: _lastCallAt,
      msSinceLast: _lastCallAt ? (Date.now() - _lastCallAt) : null
    };
  }

  // Reset — primarily for tests. Clears the queue, all flags, AND
  // all injected hooks. Bumps _dispatchToken so any setTimeouts
  // scheduled before reset no-op when they fire. Clears pending
  // timers so they don't waste cycles. Resets injected probes /
  // hooks to their defaults so a previous test's probe can't leak
  // into the next test's logic (the "test 2 skipped d2 because
  // test 1's probe said it was done" bug class).
  function _reset() {
    _queue = [];
    _enqueued = Object.create(null);
    _processing = false;
    _lastCallAt = 0;
    _listeners = {};
    _dispatchToken++;
    _pendingTimers.forEach(function (t) {
      try { clearTimeout(t); } catch (_) {}
    });
    _pendingTimers = [];
    _enricher = null;
    _isAlreadyEnriched = function () { return false; };
    _persistOnSuccess = function () {};
  }

  // ── Export ─────────────────────────────────────────────────────

  global.MaxEnrich = {
    setEnricher:            setEnricher,
    setAlreadyEnrichedProbe:setAlreadyEnrichedProbe,
    setPersistHook:         setPersistHook,
    enqueue:                enqueue,
    enqueueAll:             enqueueAll,
    cancel:                 cancel,
    priority:               priority,
    status:                 status,
    on:                     on,
    _reset:                 _reset,
    // For tests: override the defaults.
    _setIntervalMs: function (ms) { DEFAULT_INTERVAL_MS = ms; },
    _setBackoffBase: function (ms) { BASE_BACKOFF_MS = ms; }
  };

})(/** @type {any} */ (typeof globalThis !== "undefined" ? globalThis : window));
