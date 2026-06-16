// @ts-check
// engine-routing.js — MaxRoute. Hash-based screen routing for Max.
//
// PD.330. Before this module, screen state was held in trip._lastScreen,
// a stamp written by each renderer (`_recordScreen("trip")` etc.) and
// read on boot by `_restoreLastScreen`. The model was fragile:
//
//   - Every renderer had to remember to call `_recordScreen`. Discovery
//     never did, which is why a hard refresh in Discovery dropped the
//     user onto an empty trip overview ("the trip opened in the wrong
//     window").
//   - The screen name was a freeform string, typo-prone.
//   - The stamp lived on the trip body, which meant it synced across
//     devices — and a phone's last-screen could overwrite the desktop's.
//   - The restore had policy mixed into mechanism (the "picker +
//     hasDestinations → trip" override).
//
// The URL is a better source of truth. Each screen has a canonical URL:
//
//   #/                           → home screen
//   #/trip/<id>                  → trip overview
//   #/trip/<id>/discovery        → Discovery picker
//   #/trip/<id>/brief            → brief editor
//   #/trip/<id>/dest/<destId>    → destination view
//
// Hash-based (not pathname) because Cloudflare Pages only serves
// index.html at `/`; deep pathnames would 404 on direct load without
// server-side routing. With hash routing, every URL loads the same
// index.html; the app reads the hash on boot and dispatches.
//
// Browser back/forward works naturally — `popstate` fires on
// navigation, the listener re-reads the hash, the app re-renders.
// Refresh holds the screen because the URL is the state. Deep links
// to e.g. a destination view from outside the app work for free.
//
// API:
//   MaxRoute.parse()               → current route object
//   MaxRoute.build(route)          → URL hash for a route
//   MaxRoute.navigate(route, opts) → push (or replace) a new route
//   MaxRoute.on(fn)                → subscribe to route changes
//
// Route shape:
//   { screen: 'home' }
//   { screen: 'trip', tripId: '<id>' }
//   { screen: 'discovery', tripId: '<id>' }
//   { screen: 'brief', tripId: '<id>' }
//   { screen: 'dest', tripId: '<id>', destId: '<destId>' }

const global = /** @type {any} */ (globalThis);
  "use strict";

  var SCREENS = {
    HOME:      'home',
    TRIP:      'trip',
    DISCOVERY: 'discovery',
    BRIEF:     'brief',
    DEST:      'dest'
  };

  // ── Parse ────────────────────────────────────────────────────────

  // Convert window.location.hash → route object. Malformed / unknown
  // shapes default to { screen: 'home' } rather than throwing — the
  // app should never crash on a bad URL.
  function parse(hashStr) {
    var hash = (typeof hashStr === "string")
      ? hashStr
      : ((global.location && global.location.hash) || "");
    // Strip leading "#" and optional "/" so "#/trip/x" and "trip/x" both work.
    hash = hash.replace(/^#\/?/, "").replace(/^\/+/, "");
    if (!hash) return { screen: SCREENS.HOME };
    var segs = hash.split("/").filter(function (s) { return s.length > 0; });
    if (segs[0] !== "trip" || !segs[1]) return { screen: SCREENS.HOME };
    var tripId;
    try { tripId = decodeURIComponent(segs[1]); }
    catch (_) { tripId = segs[1]; }
    if (segs.length === 2) {
      return { screen: SCREENS.TRIP, tripId: tripId };
    }
    var sub = segs[2];
    if (sub === SCREENS.DISCOVERY) {
      return { screen: SCREENS.DISCOVERY, tripId: tripId };
    }
    if (sub === SCREENS.BRIEF) {
      return { screen: SCREENS.BRIEF, tripId: tripId };
    }
    if (sub === SCREENS.DEST && segs[3]) {
      var destId;
      try { destId = decodeURIComponent(segs[3]); }
      catch (_) { destId = segs[3]; }
      return { screen: SCREENS.DEST, tripId: tripId, destId: destId };
    }
    // Unknown sub — fall back to trip overview.
    return { screen: SCREENS.TRIP, tripId: tripId };
  }

  // ── Build ────────────────────────────────────────────────────────

  // Route → "#/..." string. Inverse of parse for any valid route.
  function build(route) {
    if (!route || route.screen === SCREENS.HOME) return "#/";
    if (!route.tripId) return "#/";
    var base = "#/trip/" + encodeURIComponent(route.tripId);
    if (route.screen === SCREENS.TRIP) return base;
    if (route.screen === SCREENS.DISCOVERY) return base + "/discovery";
    if (route.screen === SCREENS.BRIEF)     return base + "/brief";
    if (route.screen === SCREENS.DEST && route.destId) {
      return base + "/dest/" + encodeURIComponent(route.destId);
    }
    return base;
  }

  // ── Navigate ─────────────────────────────────────────────────────

  // Push a new route, or replace the current one. `replace: true` is
  // useful for URL normalization (the caller has already loaded the
  // trip and will render; the URL just needs to match).
  //
  // Idempotent: if the resulting URL is the same as the current one,
  // do nothing. Without this, renderers that call navigate to keep
  // the URL in sync (drawTripMode, drawDestMode, etc.) would loop
  // through the listener → _dispatchRoute → renderer → navigate cycle.
  //
  // `replace` does NOT fire the listener. This matches browser
  // semantics: `history.replaceState` doesn't fire popstate. It's
  // also the right architectural choice — `replace` is bookkeeping
  // ("the URL should match the screen the caller is about to
  // render"), not a navigation request. The caller is responsible
  // for rendering whatever they replaced to. `pushState` IS a
  // navigation, so it fires the listener for screen-swap rendering.
  function navigate(route, opts) {
    var url = build(route);
    var currentHash = (global.location && global.location.hash) || "";
    if (currentHash === url) return true; // no-op
    var replace = !!(opts && opts.replace);
    if (global.history && global.history.pushState) {
      try {
        if (replace) {
          global.history.replaceState(null, "", url);
          // Silent — caller renders.
        } else {
          global.history.pushState(null, "", url);
          _emit();
        }
        return true;
      } catch (e) {
        // Fall through to hash assignment.
      }
    }
    // Fallback for environments without history API.
    if (global.location) {
      global.location.hash = url;
      // location.hash assignment triggers hashchange asynchronously;
      // _emit will fire from the listener for non-replace flows.
    }
    return false;
  }

  // ── Subscribers ──────────────────────────────────────────────────

  var _listeners = [];

  function on(fn) {
    if (typeof fn !== "function") return function () {};
    _listeners.push(fn);
    return function () {
      var i = _listeners.indexOf(fn);
      if (i !== -1) _listeners.splice(i, 1);
    };
  }

  function _emit() {
    var route = parse();
    _listeners.slice().forEach(function (fn) {
      try { fn(route); }
      catch (err) {
        console.warn("[MaxRoute] listener threw:", err && err.message);
      }
    });
  }

  // Browser back/forward and direct hash edits both fire these events.
  // We bind in the browser only; the module is import-safe under Node
  // (for tests) by checking for addEventListener.
  if (global && typeof global.addEventListener === "function") {
    global.addEventListener("popstate", _emit);
    global.addEventListener("hashchange", _emit);
  }

  // ── Export ───────────────────────────────────────────────────────

  global.MaxRoute = {
    SCREENS:  SCREENS,
    parse:    parse,
    build:    build,
    navigate: navigate,
    on:       on,
    // For tests only.
    _reset:   function () { _listeners = []; }
  };


export {};
