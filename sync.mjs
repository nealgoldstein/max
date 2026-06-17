// @ts-check
import { _escHtml } from "./util-esc.mjs";
// max-sync.js — desktop ↔ server bridge.
//
// Where this fits:
//   db.js              persistence + DB-event bus
//   engine-trip.js     trip state + mutators + FQ verdict pipeline
//   engine-picker.js   picker state + orderKept + publishTrip
//   picker-ui.js       picker DOM rendering (desktop-only)
//   trip-ui.js         trip-view DOM rendering (desktop + mobile)
//   sync.js            (THIS FILE) desktop ↔ server bridge
//   index.html         desktop UI shell
//   server/            backend (auth, trip storage, LLM proxy)
//
// Design:
//   - Strictly additive. Existing localStorage flow is untouched.
//     Server sync runs ALONGSIDE it. If the server is unreachable,
//     the app keeps working exactly as before — local-only.
//   - Token-based auth. After sign-in, the token lives in
//     localStorage under "max-server-token" and goes on every
//     request as `Authorization: Bearer <token>`.
//   - Push: debounced. _emitTripMutation calls MaxSync.scheduleSave;
//     after 1.5s of no further changes we PUT the trip body to
//     the server. Prevents thrashing on rapid edits.
//   - Pull: on page load + on demand. MaxSync.pullAll() fetches
//     the trips list and any newer-than-local trips.
//
// What's NOT here yet:
//   - Real auth (this uses POST /auth/dev-login for now)
//   - LLM proxy (callMax still hits api.anthropic.com directly with
//     the user's key; the server's /llm/messages endpoint is the
//     replacement, lands in a follow-up round)
//   - Per-field merge (current strategy is last-write-wins)

(function (global) {
  'use strict';

  // ── Config ─────────────────────────────────────────────────
  // v344: default to the api.travelingwithmax.app subdomain. The
  // workers.dev URL still works as a fallback (set explicitly via
  // the Server URL field), so local dev or pre-DNS-cutover testing
  // doesn't break. Once DNS propagates, every fresh device hits
  // the friendlier URL.
  var DEFAULT_URL = 'https://api.travelingwithmax.app';
  var URL_KEY = 'max-server-url';
  var TOKEN_KEY = 'max-server-token';
  var EMAIL_KEY = 'max-server-email';
  // PD.429: when true, a 401 from a BACKGROUND sync call (the page-load
  // auto-pull, prefs hydrate) does NOT clear the token. A background sync
  // failure must never sign the user out — that was prompting a sign-in on
  // EVERY refresh. Only an explicit, user-initiated sync clears + re-prompts
  // on a genuine 401. Same principle as PD.421 (API key) / PD.424 (LLM
  // proxy session): a persistent credential survives a transient/background
  // error.
  var _bgAuthTolerant = false;

  function getServerUrl() {
    try {
      return localStorage.getItem(URL_KEY) || DEFAULT_URL;
    } catch (_) {
      return DEFAULT_URL;
    }
  }
  function setServerUrl(url) {
    try {
      localStorage.setItem(URL_KEY, url);
    } catch (_) {}
  }
  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || null;
    } catch (_) {
      return null;
    }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }
  function getEmail() {
    try {
      return localStorage.getItem(EMAIL_KEY) || null;
    } catch (_) {
      return null;
    }
  }
  function setEmail(email) {
    try {
      if (email) localStorage.setItem(EMAIL_KEY, email);
      else localStorage.removeItem(EMAIL_KEY);
    } catch (_) {}
  }
  function isSignedIn() {
    return !!getToken();
  }

  // ── HTTP helpers ───────────────────────────────────────────

  async function request(path, opts) {
    opts = opts || {};
    var url = getServerUrl().replace(/\/+$/, '') + path;
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {},
    );
    var token = getToken();
    if (token && !opts.skipAuth) headers['Authorization'] = 'Bearer ' + token;

    // PD.252: alarm when any client code tries to upload a trip ID
    // that's been tombstoned — that's the resurrection smoking gun.
    // The stack trace tells us which code path triggered the bad
    // upload (autosave? sync push? share-link? something else?). Kept
    // as a defensive guard; if it fires, something's wrong.
    var method = opts.method || 'GET';
    var tripIdMatch = path.match(/^\/trips\/([^\/\?]+)/);
    var pdTripId = tripIdMatch ? decodeURIComponent(tripIdMatch[1]) : null;
    if (pdTripId && (method === 'PUT' || method === 'POST')) {
      try {
        var tomb = _readTombstones();
        if (tomb[pdTripId]) {
          console.error('[PD.252 RESURRECTION] uploading tombstoned trip', pdTripId, method, path);
          console.trace('[PD.252 RESURRECTION] stack:');
        }
      } catch (_) {}
    }

    var resp;
    try {
      resp = await fetch(url, {
        method: method,
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        // PD.334: keepalive lets a save PUT issued during pagehide
        // survive the tab teardown (the flush-on-close path). Bodies
        // over the ~64KB keepalive cap fall back silently — browsers
        // ignore the flag rather than reject, except Chrome which
        // throws; guarded below.
        keepalive: !!(opts.keepalive && (!opts.body || JSON.stringify(opts.body).length < 60000)),
      });
    } catch (e) {
      // Network unreachable — server down, offline, CORS preflight,
      // etc. Surface a typed error NAMING THE OPERATION so a console
      // log can distinguish "the POST after the 404 died" from "the
      // prefs pull died" (PD.373 — the bare message made transient
      // failures undiagnosable).
      var err = new Error('Server unreachable on ' + (opts.method || 'GET') + ' ' + path
        + ': ' + (e && e.message ? e.message : 'unknown'));
      err.code = 'NETWORK';
      throw err;
    }

    if (resp.status === 401) {
      // Token expired or invalid. Clear it so the UI prompts re-sign-in.
      // v359.60.91: before nuking the token, capture WHY the server
      // rejected it. The server returns { reason: 'no_session' | ... }
      // on every 401 now (see server/src/lib/auth.ts resolveSession),
      // so we can stash a breadcrumb in localStorage that survives the
      // reload-and-re-sign-in cycle. The user can dump it later via:
      //   JSON.parse(localStorage.getItem('max-auth-debug') || '[]')
      // to see the trail of "you got booted because X" events.
      try {
        var reasonBody = null;
        try { reasonBody = await resp.clone().json(); } catch (_) { reasonBody = null; }
        var existingTok = (function () {
          try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
        })();
        var crumb = {
          at: new Date().toISOString(),
          url: url,
          reason: (reasonBody && reasonBody.reason) || 'unknown',
          tokenPrefix: existingTok ? existingTok.slice(0, 8) : null,
          tokenLength: existingTok ? existingTok.length : 0,
        };
        console.warn('[max-sync] 401 — clearing token', crumb);
        var trail = [];
        try { trail = JSON.parse(localStorage.getItem('max-auth-debug') || '[]'); } catch (_) {}
        if (!Array.isArray(trail)) trail = [];
        trail.push(crumb);
        // Cap at 20 so this doesn't grow unbounded.
        while (trail.length > 20) trail.shift();
        try { localStorage.setItem('max-auth-debug', JSON.stringify(trail)); } catch (_) {}
      } catch (_) { /* breadcrumb is best-effort */ }
      // PD.429: only nuke the token (→ "sign in" prompt) for an EXPLICIT,
      // user-initiated sync. A background/auto-pull 401 keeps the token so
      // a transient blip doesn't sign the user out on every refresh.
      if (!_bgAuthTolerant && !opts.tolerateAuth) {
        setToken(null);
      } else {
        console.warn('[max-sync] 401 on a background/tolerant call — keeping token (no re-prompt)');
      }
      var err401 = new Error('Sign-in required');
      err401.code = 'AUTH';
      throw err401;
    }

    var data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }

    if (!resp.ok) {
      var msg = (data && data.error) || ('HTTP ' + resp.status);
      var errBad = new Error(msg);
      errBad.code = resp.status === 409 ? 'CONFLICT' : 'HTTP';
      errBad.status = resp.status;
      errBad.data = data;
      // PD.334: surface the server's revision on conflicts so the
      // save path can log/record the real divergence.
      if (data && typeof data.serverRev === 'number') errBad.serverRev = data.serverRev;
      throw errBad;
    }
    return data;
  }

  // PD.61: attachment upload / fetch. Distinct from request() because
  // it sends multipart for upload and expects a raw blob for download
  // — both incompatible with the JSON-only path.
  async function uploadAttachment(file) {
    if (!isSignedIn()) throw new Error('Not signed in');
    var url = getServerUrl().replace(/\/+$/, '') + '/attachments';
    var fd = new FormData();
    fd.append('file', file, file.name || 'attachment');
    var resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() },
      // NB: do NOT set Content-Type — the browser sets a boundary
      // automatically for multipart/form-data.
      body: fd,
    });
    if (!resp.ok) {
      var data = null; try { data = await resp.json(); } catch (_) {}
      var err = new Error((data && data.error) || ('HTTP ' + resp.status));
      err.code = resp.status === 401 ? 'AUTH' : 'HTTP';
      err.status = resp.status;
      throw err;
    }
    return resp.json();  // { id, name, mime, sizeBytes }
  }
  async function fetchAttachment(id) {
    if (!isSignedIn()) throw new Error('Not signed in');
    var url = getServerUrl().replace(/\/+$/, '') + '/attachments/' + encodeURIComponent(id);
    var resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + getToken() },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      var err = new Error('HTTP ' + resp.status);
      err.code = resp.status === 401 ? 'AUTH' : 'HTTP';
      err.status = resp.status;
      throw err;
    }
    return resp.blob();
  }
  async function deleteAttachment(id) {
    if (!isSignedIn()) return;
    var url = getServerUrl().replace(/\/+$/, '') + '/attachments/' + encodeURIComponent(id);
    try {
      await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + getToken() },
      });
    } catch (_) { /* best-effort */ }
  }

  // PD.63: URL metadata. Returns { title, description, image, favicon,
  // domain } or null on hard failure. The server caches 1h; this is a
  // thin client wrapper.
  async function fetchUrlMetadata(targetUrl) {
    if (!isSignedIn() || !targetUrl) return null;
    var url = getServerUrl().replace(/\/+$/, '') + '/url-metadata?url=' + encodeURIComponent(targetUrl);
    try {
      var resp = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + getToken() },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_) {
      return null;
    }
  }

  // ── Auth ───────────────────────────────────────────────────

  // v350: magic-link sign-in. Server emails a one-time link; user
  // clicks it; comes back with #session=<token> in the URL hash.
  // The boot path detects the hash and stores the token. The
  // legacy dev-login is kept as `signInDev` for local testing.
  // v359.60.82: name optional in the API but the UI requires it for
  // new sign-ups; the server returns 400 "Name is required for new
  // sign-ups" when missing for a never-seen-before email. Returning
  // users skip the requirement — they already have a name on file.
  // v359.60.87: marketingOptIn — boolean from the sign-up checkbox.
  // Defaults to false (opt-out unless user actively checks the box).
  async function requestMagicLink(email, name, marketingOptIn) {
    if (!email || !email.trim()) throw new Error('Email required');
    return request('/auth/magic-link', {
      method: 'POST',
      skipAuth: true,
      body: {
        email: email.trim(),
        name: name ? name.trim() : undefined,
        marketingOptIn: !!marketingOptIn,
      },
    });
  }

  async function signInDev(email) {
    if (!email || !email.trim()) throw new Error('Email required');
    var data = await request('/auth/dev-login', {
      method: 'POST',
      skipAuth: true,
      body: { email: email.trim() },
    });
    // v353.2: wipe stale local trip cache before adopting the new
    // session. Otherwise trips from a previous account leak into
    // the new account's view (privacy + correctness issue). UI
    // prefs and onboarded flag are device-level and stay.
    var newEmail = data.user && data.user.email;
    if (newEmail && newEmail !== getEmail()) _wipeLocalTripCache();
    setToken(data.token);
    setEmail(newEmail);
    // v353.3: hydrate prefs from server into MaxDB. Fire-and-forget;
    // the local cache (whatever's left from the previous account or
    // empty for fresh sign-in) is the fallback if the network fails.
    pullPrefs().catch(function () {});
    _emitMaxSyncEvent('signedIn');
    return data;
  }

  // v353.2: clear all max-trip-* and the trips index from
  // localStorage. Used on account-switch (sign-out, or sign-in as
  // a different account) so the next user doesn't see the
  // previous user's data. Per-device UI prefs (legend collapsed,
  // research-collapsed-*, popup-route, prefs blob, onboarded
  // flag, SW cache) are intentionally NOT cleared — those follow
  // the device, not the account.
  function _wipeLocalTripCache() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf('max-trip-') === 0) keys.push(k);
        if (k === 'max-trips-index') keys.push(k);
      }
      keys.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      // Also reset the in-memory index that index.html holds — done
      // by the caller via location.reload or a manual loadTripsIndex
      // call after signedIn fires. We only handle the storage layer.
    } catch (e) {
      console.warn('[max-sync] wipe local trip cache failed:', e);
    }
  }

  // v353.1: dispatch a window event whenever the sign-in state
  // changes. Listeners (e.g., updateSyncButtons in index.html)
  // can hook these instead of polling MaxSync.isSignedIn() on a
  // timer. Using a custom event on window keeps the API surface
  // small — no MaxSync.on(...) bus to maintain.
  function _emitMaxSyncEvent(name) {
    try {
      if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
      window.dispatchEvent(new CustomEvent('max-sync-' + name, {
        detail: {
          signedIn: isSignedIn(),
          email: getEmail() || null,
        },
      }));
    } catch (_) { /* event dispatch failures are not fatal */ }
  }

  // Legacy alias — old callers expect signIn(email) to log in
  // immediately. Maps to dev-login during transition.
  async function signIn(email) { return signInDev(email); }

  // v350: pick up session token from URL hash on boot. After clicking
  // the magic link, the server redirects to /?signin=ok#session=...
  // We grab the token, store it, then strip the hash so it doesn't
  // leak into bookmarks / history.
  function _consumeMagicLinkHash() {
    try {
      var hash = location.hash || '';
      if (!hash.indexOf) return false;
      var sIdx = hash.indexOf('session=');
      if (sIdx < 0) return false;
      var rest = hash.substring(sIdx + 'session='.length);
      var amp = rest.indexOf('&');
      var token = decodeURIComponent(amp >= 0 ? rest.substring(0, amp) : rest);
      var emailMatch = hash.match(/email=([^&]+)/);
      var email = emailMatch ? decodeURIComponent(emailMatch[1]) : null;
      if (!token) return false;
      // v353.2: wipe stale local trip cache when the email differs
      // from what we previously stored — i.e., this magic link is
      // for a different account than was last signed in. Prevents
      // trips from leaking across accounts.
      if (email && email !== getEmail()) _wipeLocalTripCache();
      setToken(token);
      if (email) setEmail(email);
      // Clear the hash so the URL is clean.
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (_) { location.hash = ''; }
      // v353.3: hydrate prefs from server. Best-effort — if the
      // network's down we keep using the local cache.
      pullPrefs().catch(function () {});
      // v353.1: fire the same signedIn event the dev-login path does
      // so listeners (sync buttons, banners) update for the magic-
      // link path too.
      _emitMaxSyncEvent('signedIn');
      return true;
    } catch (_) { return false; }
  }

  function signOut(opts) {
    opts = opts || {};
    // v353.2: an EXPLICIT user sign-out clears the local trip cache so the
    // next user (or this user signing in as a different account) doesn't
    // see these trips. UI prefs / onboarded flag / SW cache stay.
    //
    // PD.434 (T1.1): but an AUTOMATIC sign-out triggered by a transient or
    // misclassified 401 must NEVER wipe local trips — that was deleting
    // every max-trip-* (including not-yet-pushed work) because an Anthropic
    // overload surfaced as a 401. Such callers pass {keepLocalTrips:true}
    // to clear only the session token, not the user's data.
    if (!opts.keepLocalTrips) _wipeLocalTripCache();
    setToken(null);
    setEmail(null);
    _emitMaxSyncEvent('signedOut');
  }

  // ── Trip endpoints ─────────────────────────────────────────

  async function listTrips() {
    return request('/trips');
  }
  async function getTrip(id) {
    return request('/trips/' + encodeURIComponent(id));
  }
  async function createTrip(payload) {
    return request('/trips', { method: 'POST', body: payload, keepalive: _flushing });
  }
  async function updateTrip(id, payload) {
    return request('/trips/' + encodeURIComponent(id), {
      method: 'PUT',
      body: payload,
      // PD.334: keepalive during the flush-on-close path so the PUT
      // survives tab teardown.
      keepalive: _flushing,
    });
  }
  async function deleteTrip(id) {
    // PD.251: tombstones are PERMANENT. The old behavior cleared them
    // on a successful server DELETE, on the assumption that "200 OK
    // means the trip is gone from the server forever." That assumption
    // fails in real life: trips came back later — backup restores,
    // replication catching up, another device re-uploading, a server
    // write retry. Once the user deletes a trip, the local tombstone
    // shields pullAll permanently. The storage cost is a 36-byte UUID
    // per delete, which is negligible.
    _tombstoneAdd(id);
    return await request('/trips/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // v353.5: share-link endpoints. Mint creates a fresh token bound
  // to a trip. List returns active (non-revoked) tokens. Revoke
  // marks all active tokens revoked. Public read uses /share/:token
  // and bypasses the bearer-token auth header (the share token IS
  // the auth).
  async function mintShareToken(tripId) {
    return request('/trips/' + encodeURIComponent(tripId) + '/share', {
      method: 'POST',
    });
  }
  async function listShareTokens(tripId) {
    return request('/trips/' + encodeURIComponent(tripId) + '/share');
  }
  async function revokeShareTokens(tripId) {
    return request('/trips/' + encodeURIComponent(tripId) + '/share', {
      method: 'DELETE',
    });
  }
  async function fetchSharedTrip(token) {
    return request('/share/' + encodeURIComponent(token), { skipAuth: true });
  }

  // ── Prefs endpoints ────────────────────────────────────────
  //
  // v353.3 (Path B): user-level prefs (paceHours, future cross-device
  // settings) live on the server at /user/prefs. localStorage holds
  // only an offline cache. Hydration order: on sign-in, we pull from
  // the server and call MaxDB.prefs.replace(...) — that's the source
  // of truth for the session. Local writes (MaxDB.prefs.set(...)
  // emits 'prefsChanged' with source='local') get write-through-PATCHed
  // back here.

  async function getPrefsRemote() {
    return request('/user/prefs');
  }
  async function pushPrefsPatchRemote(patch) {
    return request('/user/prefs', { method: 'PATCH', body: { patch: patch } });
  }
  async function replacePrefsRemote(prefs) {
    return request('/user/prefs', { method: 'PUT', body: { prefs: prefs } });
  }

  // pullPrefs — fetch from server, push into MaxDB. Source='remote'
  // so listeners (e.g., the welcome modal's slider) re-render without
  // echoing the just-fetched values back to the server.
  async function pullPrefs() {
    if (!isSignedIn()) return null;
    // Flush any pending local pushes before pulling — otherwise a
    // pull racing ahead of a debounced push would overwrite the
    // user's just-changed value with stale server state. At boot
    // and at sign-in this is a no-op (no local sets have queued
    // anything); the safety matters when pull becomes a periodic
    // trigger.
    if (_prefsPushPending && Object.keys(_prefsPushPending).length) {
      try { await _flushPrefsPush(); } catch (_) {}
    }
    try {
      var resp = await getPrefsRemote();
      // Round NC.X: reset the failure counter so the polling interval
      // returns to its 60s base after a recovered server.
      global._maxSyncFailCount = 0;
      var remotePrefs = (resp && resp.prefs) || {};
      // If we have local prefs that the server doesn't (e.g., user
      // changed paceHours offline), the server is the source of
      // truth here — but that's fine, because the local change
      // would have been pushed before sign-out, and on sign-in
      // we trust the server. If we want to merge in the future,
      // the right place is here.
      if (global.MaxDB && global.MaxDB.prefs &&
          typeof global.MaxDB.prefs.replace === 'function') {
        global.MaxDB.prefs.replace(remotePrefs);
      }
      return remotePrefs;
    } catch (e) {
      // Network unreachable / 401 — keep using local cache. Prefs
      // sync is best-effort; the UI must work offline.
      // Round NC.X: only log the FIRST failure per session, then go
      // quiet. Logging every minute spammed the console for users
      // whose sync server is down or who never set one up.
      if (!global._maxSyncFailLogged) {
        console.warn('[max-sync] pullPrefs failed (suppressing further failures this session):', e && e.message);
        global._maxSyncFailLogged = true;
      }
      global._maxSyncFailCount = (global._maxSyncFailCount || 0) + 1;
      return null;
    }
  }

  // Push queue: prefsChanged events fire one key at a time, but we
  // debounce so rapid back-to-back sets coalesce into one PATCH.
  // The pending object accumulates the latest value for each key
  // touched during the debounce window.
  var _prefsPushPending = null;
  var _prefsPushTimer = null;
  var _prefsPushInFlight = false;
  // v353.4: circuit-breaker. After repeated failures (e.g., server
  // doesn't accept PATCH because of CORS), back off exponentially
  // and eventually stop retrying until the next sign-in / page load.
  // Prevents the runaway "retry every 200ms forever" storm we saw
  // when the worker's CORS allowlist was missing PATCH.
  var _prefsPushFails = 0;
  var _prefsPushBackoff = 0;

  function _schedulePrefsPush(key, value) {
    if (!isSignedIn()) return;
    if (!_prefsPushPending) _prefsPushPending = {};
    if (value === undefined) {
      // MaxDB.prefs.set(key, undefined) deletes — but the server's
      // PATCH endpoint shallow-merges and has no concept of "delete
      // a key." For now we send `null`; the server stores it as
      // null. If we ever need true delete-keys-from-blob, switch to
      // a PUT with the full prefs minus the key.
      _prefsPushPending[key] = null;
    } else {
      _prefsPushPending[key] = value;
    }
    if (_prefsPushTimer) clearTimeout(_prefsPushTimer);
    _prefsPushTimer = setTimeout(_flushPrefsPush, 600);
  }

  async function _flushPrefsPush() {
    _prefsPushTimer = null;
    if (_prefsPushInFlight) {
      // Another push is already running — re-arm so the next tick
      // catches up. Don't drop the pending object; it gets flushed
      // when the in-flight push returns.
      _prefsPushTimer = setTimeout(_flushPrefsPush, 400);
      return;
    }
    if (!_prefsPushPending || !Object.keys(_prefsPushPending).length) return;
    if (!isSignedIn()) return;
    var patch = _prefsPushPending;
    _prefsPushPending = null;
    _prefsPushInFlight = true;
    try {
      await pushPrefsPatchRemote(patch);
      _prefsPushFails = 0;
      _prefsPushBackoff = 0;
    } catch (e) {
      // Best-effort. If the network is down the local cache still
      // has the new value; next sign-in (or next successful push)
      // will reconcile. For 401 we drop the patch — the user is
      // signed out and prefs sync isn't meaningful.
      if (e.code === 'AUTH') {
        console.warn('[max-sync] prefs push: signed out, dropping patch');
      } else {
        _prefsPushFails++;
        // Exponential backoff capped at 30s. After 6 consecutive
        // failures (~1 min), stop trying — the next sign-in or
        // page load will reset and try again.
        _prefsPushBackoff = Math.min(30000, 500 * Math.pow(2, _prefsPushFails));
        if (_prefsPushFails === 1 || _prefsPushFails % 5 === 0) {
          console.warn('[max-sync] prefs push failed (attempt ' +
            _prefsPushFails + ', next retry in ' + _prefsPushBackoff + 'ms):', e.message);
        }
        if (_prefsPushFails >= 6) {
          console.warn('[max-sync] prefs push: giving up after 6 failures; ' +
            'will retry on next sign-in or page load');
          _prefsPushPending = null;
          return;
        }
        // Re-queue so a future flush retries. Merge with anything
        // that landed during the failed call.
        _prefsPushPending = Object.assign({}, patch, _prefsPushPending || {});
      }
    } finally {
      _prefsPushInFlight = false;
      // If something accumulated during the in-flight call, kick
      // another flush — using the backoff if we just failed.
      if (_prefsPushPending && Object.keys(_prefsPushPending).length) {
        _prefsPushTimer = setTimeout(_flushPrefsPush, _prefsPushBackoff || 200);
      }
    }
  }

  // Wire MaxDB → MaxSync. db.js doesn't know about HTTP; we listen
  // for its 'prefsChanged' event and write through. Source='local'
  // means the user just changed something; source='remote' means we
  // just hydrated and there's nothing to push.
  function _wirePrefsBridge() {
    if (!global.MaxDB || typeof global.MaxDB.on !== 'function') return;
    global.MaxDB.on('prefsChanged', function (e) {
      if (!e || e.source !== 'local') return;
      // Wholesale clear (key === null) — push the full empty blob.
      if (e.key == null) {
        _prefsPushPending = null;
        if (_prefsPushTimer) { clearTimeout(_prefsPushTimer); _prefsPushTimer = null; }
        replacePrefsRemote({}).catch(function (err) {
          console.warn('[max-sync] prefs clear push failed:', err);
        });
        return;
      }
      _schedulePrefsPush(e.key, e.value);
    });
  }
  _wirePrefsBridge();

  // ── Per-trip UI state ──────────────────────────────────────
  //
  // PATCH /trips/:id/ui-state for cheap UI flips that should follow
  // the trip across devices but don't change trip content. Used by
  // banners-expanded, research-collapsed-{destId}, hide-trip-intro.
  // Server merges keys into trip.ui_state without bumping
  // trip.updated_at, so it doesn't trigger a full pull-down of body
  // on the other device.
  async function patchTripUiStateRemote(tripId, patch) {
    if (!tripId || !patch) return null;
    return request('/trips/' + encodeURIComponent(tripId) + '/ui-state', {
      method: 'PATCH',
      body: { patch: patch },
    });
  }

  // ── Push (debounced save) ──────────────────────────────────
  //
  // Hook: after every _emitTripMutation, the desktop calls
  // MaxSync.scheduleSave(). We debounce 1.5s and then PUT the
  // current trip body. If the server doesn't have this trip yet,
  // we POST first.

  var _saveTimer = null;
  var _netRetryCount = 0; // PD.373: transient-failure retry budget
  var _saveInFlight = false;
  var _flushing = false; // PD.334: true while flushNow() runs (pagehide path)

  // ── PD.334: revision tracking ──────────────────────────────
  // The server owns a monotonic `rev` per trip, bumped on every
  // successful write. We record the rev each save/pull was based on;
  // pullAll compares revs instead of wall clocks (device clocks
  // can't be trusted — a fast clock made stale data look fresh under
  // pure last-write-wins). Falls back to timestamps when the server
  // hasn't sent a rev (pre-migration rows).
  var REVS_KEY = 'max-sync-revs';
  function _readRevs() {
    try { return JSON.parse(localStorage.getItem(REVS_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function _getRev(tripId) {
    var r = _readRevs()[tripId];
    return (typeof r === 'number') ? r : 0;
  }
  function _setRev(tripId, rev) {
    if (typeof rev !== 'number') return;
    try {
      var m = _readRevs();
      m[tripId] = rev;
      localStorage.setItem(REVS_KEY, JSON.stringify(m));
    } catch (e) {
      // R7: a dropped rev write makes the local baseRev diverge from the
      // server's, so the next save can spuriously CONFLICT (then force-
      // overwrite). Surface it instead of masking it silently.
      try { console.warn('[Max sync] failed to persist rev for', tripId, (e && e.message) || e); } catch (_) {}
    }
  }

  function _setStatus(text, color) {
    // v337: don't cache the element. drawTripMode rebuilds the
    // header on every emit, so the cached reference becomes a
    // detached node and the visible span stays empty. Look up
    // fresh each time.
    var el = document.getElementById('max-sync-status');
    if (el) {
      el.textContent = text || '';
      el.style.color = color || '#888';
    }
  }

  function scheduleSave() {
    if (!isSignedIn()) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _setStatus('changes pending…', '#aaa');
    _saveTimer = setTimeout(_doSave, 1500);
  }

  // PD.334: flush the pending debounce NOW. The save/load trace found
  // that a pending _saveTimer was simply ABANDONED when the tab closed
  // — any edit made within 1.5s of closing never reached the server.
  // Called from the pagehide/visibilitychange handler (index.html).
  // The request uses fetch keepalive semantics where available so the
  // PUT survives the page teardown.
  function flushNow() {
    if (!isSignedIn()) return;
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _flushing = true;
    try { _doSave(); } catch (_) {}
    // _doSave is async; clear the flag on the next tick — the fetch
    // (with keepalive) has been issued by then.
    setTimeout(function () { _flushing = false; }, 0);
  }

  async function _doSave() {
    console.log('[_doSave] entering', {inFlight: _saveInFlight, tripId: global._currentTripId, hasTrip: !!global.trip, hasSerialize: typeof global.serializeTrip});
    if (_saveInFlight) {
      console.log('[_doSave] EXIT: another save in flight');
      _saveTimer = setTimeout(_doSave, 500);
      return;
    }
    var tripId = global._currentTripId;
    if (!tripId || !global.trip) { console.log('[_doSave] EXIT: no tripId or trip', {tripId, hasTrip: !!global.trip}); return; }
    var serializeTrip = global.serializeTrip;
    if (typeof serializeTrip !== 'function') { console.log('[_doSave] EXIT: serializeTrip not function'); return; }
    console.log('[_doSave] proceeding to PUT');

    var bodyJson = serializeTrip();
    var body;
    try {
      body = JSON.parse(bodyJson);
    } catch (e) {
      console.warn('[max-sync] cannot parse trip body:', e);
      return;
    }
    // v336: resolve the trip name the same way the home screen does.
    // The desktop's _tripsIndex entry has the canonical user-facing
    // name (set by updateIndexEntry from trip.name). Fall back to the
    // trip object's own .name, then brief.name, then "Untitled."
    var name = 'Untitled';
    try {
      var idx = (global._tripsIndex || []).find(function (e) { return e && e.id === tripId; });
      if (idx && idx.name) name = idx.name;
      else if (global.trip && global.trip.name) name = global.trip.name;
      else if (global.trip && global.trip.brief && global.trip.brief.name) name = global.trip.brief.name;
    } catch (_) {}
    var now = Date.now();

    _saveInFlight = true;
    _setStatus('saving…', '#888');
    try {
      try {
        // PD.334: send the rev this edit was based on; record the
        // server's new rev from the response as the next base.
        var _putResp = await updateTrip(tripId, {
          body: body, updatedAt: now, name: name, baseRev: _getRev(tripId),
        });
        if (_putResp && _putResp.trip && typeof _putResp.trip.rev === 'number') {
          _setRev(tripId, _putResp.trip.rev);
        }
        _setStatus('saved ✓', '#2a7a4e');
        _netRetryCount = 0;
      } catch (e) {
        if (e.status === 404) {
          // Server doesn't have this trip yet. POST it.
          var _postResp = await createTrip({ id: tripId, name: name, body: body, updatedAt: now });
          if (_postResp && _postResp.trip && typeof _postResp.trip.rev === 'number') {
            _setRev(tripId, _postResp.trip.rev);
          }
          _setStatus('saved ✓', '#2a7a4e');
        } else if (e.code === 'CONFLICT') {
          // PD.362: a REAL conflict (rev mismatch, not clock skew) is
          // the USER'S decision, not the sync layer's. If the app
          // registered a chooser (MaxSync.onConflict), ask: 'mine'
          // forces this device's version; 'theirs' adopts the
          // server's copy. Without a chooser, keep the v1 behavior
          // (force local) so headless/test contexts never block.
          console.warn('[max-sync] REAL sync conflict on', tripId,
            '— serverRev=', e.serverRev, 'baseRev=', _getRev(tripId));
          var _choice = 'mine';
          var _mx = global.MaxSync;
          if (_mx && typeof _mx.onConflict === 'function') {
            try {
              _choice = await _mx.onConflict({
                tripId: tripId, name: name,
                serverRev: e.serverRev, baseRev: _getRev(tripId),
              });
            } catch (_) { _choice = 'mine'; }
          }
          if (_choice === 'theirs') {
            // Adopt the server's copy: fetch, store locally through
            // MaxDB (fires tripWritten so the UI reloads), record rev.
            var _srv = await getTrip(tripId);
            var _srvTrip = _srv && (_srv.trip || _srv);
            if (_srvTrip && _srvTrip.body) {
              var _parsed = (typeof _srvTrip.body === 'string')
                ? JSON.parse(_srvTrip.body) : _srvTrip.body;
              if (global.MaxDB && global.MaxDB.trip &&
                  typeof global.MaxDB.trip.writeRaw === 'function') {
                global.MaxDB.trip.writeRaw(tripId, _parsed);
              }
              if (typeof _srvTrip.rev === 'number') _setRev(tripId, _srvTrip.rev);
              if (_mx && typeof _mx.onAdoptedServerTrip === 'function') {
                try { _mx.onAdoptedServerTrip(tripId, _parsed); } catch (_) {}
              }
              _setStatus('using other device\u2019s version \u2713', '#2a7a4e');
            } else {
              _setStatus('could not fetch other version — kept yours', '#b05820');
            }
          } else {
            var _forceResp = await updateTrip(tripId, {
              body: body,
              updatedAt: now,
              name: name,
              baseRev: _getRev(tripId),
              force: true,
            });
            if (_forceResp && _forceResp.trip && typeof _forceResp.trip.rev === 'number') {
              _setRev(tripId, _forceResp.trip.rev);
            }
            _setStatus('saved \u2713 (kept this device\u2019s version)', '#b05820');
          }
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.warn('[max-sync] save failed:', e);
      if (e.code === 'AUTH') {
        _setStatus('signed out — sign in again', '#c44');
      } else if (e.code === 'NETWORK') {
        // PD.373: a transient blip must not strand the trip locally
        // until the next curation action. Retry with backoff — 10s,
        // 30s, 90s — and stop after three attempts (the pagehide
        // flush still covers tab close; a real outage shows the
        // offline status without hammering).
        _netRetryCount = (_netRetryCount || 0) + 1;
        if (_netRetryCount <= 3) {
          var _delay = [10000, 30000, 90000][_netRetryCount - 1];
          console.log('[max-sync] retrying save in ' + (_delay / 1000) + 's (attempt '
            + _netRetryCount + '/3)');
          setTimeout(function () { _doSave(); }, _delay);
          _setStatus('offline — will retry', '#aaa');
        } else {
          _setStatus('offline — saved locally only', '#aaa');
        }
      } else {
        _setStatus('save failed: ' + e.message, '#c44');
      }
    } finally {
      _saveInFlight = false;
      // Clear the status after a few seconds (look up fresh — see
      // the v337 note above).
      setTimeout(function () {
        var el = document.getElementById('max-sync-status');
        if (el && el.textContent && el.textContent.indexOf('saved ✓') === 0) {
          el.textContent = '';
        }
      }, 2500);
    }
  }

  // ── Pull (fetch + merge from server) ───────────────────────
  //
  // Strategy: on sign-in or manual refresh, list server trips. For
  // each one, if the server's updatedAt is newer than what we have
  // locally, fetch the full body and store it. We never delete
  // local trips just because they're missing from the server — the
  // user might have offline-only drafts.

  // PD.197 (architectural): deleted-trip tombstones. Without this,
  // the fire-and-forget server delete in the UI can silently fail
  // (network blip, transient 5xx) and the next pullAll resurrects
  // the trip. The tombstone list persists in localStorage; pullAll
  // skips any tombstoned ID. Tombstones drain when the server
  // confirms deletion (or when MaxSync.deleteTrip succeeds on a
  // retry path).
  var _TOMBSTONE_KEY = 'max-deleted-trips';
  function _readTombstones() {
    try {
      var raw = localStorage.getItem(_TOMBSTONE_KEY);
      if (!raw) return {};
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return {};
      var out = {};
      arr.forEach(function(id){ if (id) out[id] = true; });
      return out;
    } catch (_) { return {}; }
  }
  function _writeTombstones(map) {
    try {
      var arr = Object.keys(map || {});
      localStorage.setItem(_TOMBSTONE_KEY, JSON.stringify(arr));
    } catch (_) {}
  }
  function _tombstoneAdd(id) {
    if (!id) return;
    var m = _readTombstones();
    m[id] = true;
    _writeTombstones(m);
  }
  function _tombstoneRemove(id) {
    if (!id) return;
    var m = _readTombstones();
    if (m[id]) { delete m[id]; _writeTombstones(m); }
  }

  async function pullAll() {
    if (!isSignedIn()) return { pulled: 0, skipped: 0 };
    var resp = await listTrips();
    var serverTrips = (resp && resp.trips) || [];
    var tombstones = _readTombstones();
    var pulled = 0;
    var skipped = 0;

    for (var i = 0; i < serverTrips.length; i++) {
      var s = serverTrips[i];
      // PD.197: skip tombstoned trips; retry the server delete so
      // they eventually drain. Without this, every pull would
      // resurrect a trip whose server delete failed.
      if (s && s.id && tombstones[s.id]) {
        // PD.251: tombstones are PERMANENT — see deleteTrip for
        // rationale. Still fire the server DELETE on every pull as
        // belt-and-suspenders (helps drain a server-side write queue
        // or replication lag), but don't remove the tombstone even
        // if the server returns 200. If the trip ever reappears in a
        // later listTrips response, this branch skips it again.
        try {
          await request('/trips/' + encodeURIComponent(s.id), { method: 'DELETE' });
        } catch (_) {
          // Server still won't accept the delete; tombstone stays
          // (it would stay regardless under the new permanent policy).
        }
        skipped++;
        continue;
      }
      var key = 'max-trip-' + s.id;
      var localTimestamp = 0;
      var hasLocalBody = false;
      try {
        var local = localStorage.getItem(key);
        if (local) {
          hasLocalBody = true;
          var parsed = JSON.parse(local);
          // Use the trip's __saved__ timestamp if present, otherwise
          // skip — local always wins for unfetched trips so we don't
          // accidentally clobber unsaved local edits. This is
          // conservative; v1 behavior.
          localTimestamp = (parsed && parsed.__saved__) || 0;
        }
      } catch (_) {}

      var serverTimestamp = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;

      // PD.334: revision-based decision when the server sends a rev.
      // Pull the body ONLY if the server has revisions we haven't
      // recorded (s.rev > our recorded rev) — device clocks play no
      // part. If we have no local body at all, always pull. Falls
      // back to the legacy clock comparison for pre-rev servers.
      var shouldPull;
      if (typeof s.rev === 'number') {
        shouldPull = !hasLocalBody || s.rev > _getRev(s.id);
      } else {
        shouldPull = serverTimestamp > localTimestamp;
      }

      if (shouldPull) {
        // Server is newer — pull full body
        try {
          var full = await getTrip(s.id);
          if (full && full.trip) {
            // PD.478 (data integrity): re-check local BEFORE overwriting.
            // The shouldPull decision + the localTimestamp read happened
            // BEFORE the `await getTrip` above — a network round-trip. If
            // the user edited THIS trip locally during that window
            // (localSave bumped __saved__), installing the server body now
            // would silently clobber their just-made change. Re-read local;
            // if it's newer than when we decided to pull, skip the
            // overwrite and let the next push reconcile. Conservative:
            // local edits win over a concurrent server change.
            try {
              var _localNow = localStorage.getItem(key);
              if (_localNow) {
                var _tsNow = (JSON.parse(_localNow) || {}).__saved__ || 0;
                if (_tsNow > localTimestamp) {
                  console.warn('[max-sync] pull skipped for', s.id,
                    '— local was edited during the fetch (race avoided)');
                  skipped++;
                  continue;
                }
              }
            } catch (_) {}
            var serialized = JSON.stringify(
              Object.assign({}, full.trip.body, {
                __saved__: serverTimestamp,
              }),
            );
            // v352.1: route through MaxDB.trip.writeRaw instead of a
            // raw localStorage.setItem. The raw write put the bytes
            // in storage but never fired MaxDB's `tripWritten` event,
            // so engine-trip.js's subscriber (which updates global.trip
            // and emits `tripChange` to trigger re-render) never ran.
            // The visible bug: an edit made on the phone landed on
            // the server and was pulled by the desktop poll, but the
            // desktop's open trip view kept showing stale content
            // until the user manually reloaded. writeRaw fires
            // tripWritten with the parsed envelope, the subscriber
            // adopts it, the UI re-renders.
            if (global.MaxDB && global.MaxDB.trip &&
                typeof global.MaxDB.trip.writeRaw === 'function') {
              global.MaxDB.trip.writeRaw(s.id, serialized);
            } else {
              // Defense in depth: if MaxDB isn't loaded for some
              // reason, fall back to the legacy raw write so at
              // least the bytes land. The UI won't auto-update in
              // that case but the next manual reload will pick it up.
              localStorage.setItem(key, serialized);
            }
            _ensureIndexEntry(s.id, full.trip.name, full.trip.body, serverTimestamp);
            // PD.334: record the rev this body corresponds to — the
            // base for our next push.
            if (typeof full.trip.rev === 'number') _setRev(s.id, full.trip.rev);
            else if (typeof s.rev === 'number') _setRev(s.id, s.rev);
            pulled++;
          }
        } catch (e) {
          console.warn('[max-sync] pull failed for', s.id, e);
        }
      } else {
        // v341: even when the server is older or equal, ensure an
        // index entry exists. This covers the case where another
        // device wrote the trip body to localStorage (cross-tab
        // sync) but didn't update the trips index — without this,
        // the trip is in storage but invisible in the trip list.
        try {
          if (global.MaxDB && MaxDB.index && typeof MaxDB.index.entry === 'function') {
            if (!MaxDB.index.entry(s.id)) {
              // Need the body to populate destCount / dates. Fetch
              // since we don't have it cached. (Adds one extra GET
              // per missing-index-entry trip; acceptable.)
              var full2 = await getTrip(s.id);
              if (full2 && full2.trip && full2.trip.body) {
                _ensureIndexEntry(s.id, full2.trip.name, full2.trip.body, serverTimestamp);
              }
            }
          }
        } catch (e) {
          console.warn('[max-sync] index repair failed for', s.id, e);
        }
        skipped++;
      }
    }
    return { pulled: pulled, skipped: skipped };
  }

  // v341: actually populate the trips index. Reads core fields off
  // the body (destinations, brief.duration) so the trip list shows
  // proper labels. Uses MaxDB.index.upsert if present, falls back
  // to direct localStorage manipulation otherwise.
  function _ensureIndexEntry(id, name, body, savedAtMs) {
    if (!id) return;
    var savedAtIso = new Date(savedAtMs || Date.now()).toISOString();
    var dests = (body && body.trip && body.trip.destinations) || [];
    var entry = {
      id: id,
      name: name || (body && body.trip && body.trip.name) || 'Untitled trip',
      savedAt: savedAtIso,
      destCount: dests.length,
      dateRange: '',
      startDate: '',
      endDate: '',
    };
    if (dests.length) {
      var first = dests[0];
      var last = dests[dests.length - 1];
      entry.startDate = first.dateFrom || '';
      entry.endDate = last.dateTo || '';
      // Mimic updateIndexEntry's date-range string ("May 7 – May 21").
      function _fmt(iso) {
        if (!iso) return '';
        try {
          var d = new Date(iso + 'T12:00:00');
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (_) { return iso; }
      }
      entry.dateRange = _fmt(entry.startDate) + (dests.length > 1 ? ' – ' + _fmt(entry.endDate) : '');
      var brief = (body && body.trip && body.trip.brief) || {};
      if (brief.entry) entry.entryCity = brief.entry;
      if (brief.tbExit) entry.exitCity = brief.tbExit;
    }
    try {
      if (global.MaxDB && MaxDB.index && typeof MaxDB.index.upsert === 'function') {
        MaxDB.index.upsert(entry);
        return;
      }
    } catch (_) {}
    // Fallback: direct localStorage write.
    try {
      var key = 'max-trips-index';
      var arr = [];
      try { arr = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (_) {}
      var found = false;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === id) { arr[i] = entry; found = true; break; }
      }
      if (!found) arr.push(entry);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (_) {}
  }

  // ── UI: sign-in modal + status pill ────────────────────────
  //
  // Invoked from a header button. Shows email input → calls signIn
  // → on success, attempts a pull. Caller can then refresh the
  // home screen to see new trips.

  function showSignInModal() {
    var existing = document.getElementById('max-sync-modal');
    if (existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = 'max-sync-modal';
    // v353.4: overflow-y on the overlay so on phone (where the modal
    // can be taller than the viewport because of server-trip list +
    // preferences link) the user can scroll the whole sheet. align-
    // items:flex-start keeps the modal at the top so the upper part
    // is always visible.
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11000;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;';

    var box = document.createElement('div');
    // max-height on the box itself plus overflow-y as a fallback in
    // case the overlay scroll is suppressed by some UA.
    box.style.cssText =
      'background:var(--c-bg);border-radius:12px;max-width:420px;width:100%;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);max-height:calc(100vh - 48px);overflow-y:auto;-webkit-overflow-scrolling:touch;';

    // v353: title is context-aware. When signed in the modal is a
    // sync-management surface (pull, sign out, list server trips);
    // when signed out it's purely a sign-in form, and "Sync with
    // server" was misleading. Lead with the actual user-facing
    // action in each state.
    var modalTitle = isSignedIn() ? 'Sync with server' : 'Sign in to Max';
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--c-primary);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">⇄</div>' +
      '<div style="font-size:14px;font-weight:700;">' + modalTitle + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:14px;">' +
      (isSignedIn()
        ? '<strong>Signed in as ' + (getEmail() || 'user') + '</strong>.'
        : 'Sign in to share trips between devices. Enter your name and email — we\'ll send a one-time sign-in link. No password required. <span style="color:#666;">Sign-in lasts 30 days; you\'ll get a fresh link after that.</span>') +
      '</div>' +
      // v359.60.82: Name field shown only for signed-out state. New
      // sign-ups need it; returning users (server already has them)
      // can leave it blank or fill it to update their display name.
      (isSignedIn() ? '' :
        '<label style="display:block;font-size:11px;color:#666;font-weight:600;margin-bottom:6px;">Name <span style="color:#c44;">*</span></label>' +
        '<input id="max-sync-name" type="text" placeholder="Your name" value="" autocomplete="name" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--c-border);border-radius:5px;box-sizing:border-box;margin-bottom:10px;" />'
      ) +
      '<label style="display:block;font-size:11px;color:#666;font-weight:600;margin-bottom:6px;">Email <span style="color:#c44;">*</span></label>' +
      '<input id="max-sync-email" type="email" placeholder="you@example.com" value="' +
      _esc(getEmail() || '') +
      '" autocomplete="email" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--c-border);border-radius:5px;box-sizing:border-box;margin-bottom:14px;" />' +
      // v359.60.87: marketing opt-in checkbox shown only for signed-out
      // state. Unchecked by default — affirmative opt-in only.
      // v359.60.88: sharper value prop — concrete frequency, specific
      // content type. Earns higher voluntary opt-in than the generic
      // "occasional emails" pitch.
      (isSignedIn() ? '' :
        '<label style="display:flex;align-items:flex-start;gap:8px;font-size:11px;font-weight:400;color:#444;margin-bottom:14px;cursor:pointer;text-transform:none;letter-spacing:0;line-height:1.45;">' +
          '<input id="max-sync-marketing" type="checkbox" style="margin:2px 0 0;width:auto;flex-shrink:0;" />' +
          '<span><strong style="color:#222;">Send me travel-planning tips and Max updates.</strong> About one email a month — destination ideas, new features, and shortcuts to help you plan better trips. Unsubscribe any time, one click.</span>' +
        '</label>'
      ) +
      '<label style="display:block;font-size:11px;color:#666;font-weight:600;margin-bottom:6px;">Server URL</label>' +
      '<input id="max-sync-url" type="text" value="' +
      _esc(getServerUrl()) +
      '" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--c-border);border-radius:5px;font-family:monospace;box-sizing:border-box;margin-bottom:14px;" />' +
      '<div id="max-sync-msg" style="font-size:11px;color:var(--c-ink-3);min-height:14px;margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:8px;">' +
      (isSignedIn()
        ? '<button id="max-sync-pull" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:5px;cursor:pointer;font-family:inherit;">Pull trips from server</button>' +
          '<button id="max-sync-out" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:var(--c-bg);color:#c44;border:1px solid #c44;border-radius:5px;cursor:pointer;font-family:inherit;">Sign out</button>'
        : '<button id="max-sync-in" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:var(--c-primary);color:var(--c-on-dark);border:1px solid var(--c-primary);border-radius:5px;cursor:pointer;font-family:inherit;">Get sign-in link</button>') +
      '<button id="max-sync-close" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Close</button>' +
      '</div>' +
      // v353.4: Preferences link — opens the welcome modal so the
      // user can change pace / sights without leaving the trip view
      // (the home-screen "Welcome" link is invisible from inside a
      // trip).
      '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border-3);text-align:center;">' +
        '<span id="max-sync-prefs" style="font-size:12px;color:var(--c-primary);cursor:pointer;text-decoration:underline;">⚙ Preferences (pace, sights)</span>' +
      '</div>';

    ov.appendChild(box);
    document.body.appendChild(ov);

    var urlInp = /** @type {HTMLInputElement} */ (document.getElementById('max-sync-url'));
    var emailInp = /** @type {HTMLInputElement} */ (document.getElementById('max-sync-email'));
    var msg = document.getElementById('max-sync-msg');
    var inBtn = document.getElementById('max-sync-in');
    var outBtn = document.getElementById('max-sync-out');
    var pullBtn = document.getElementById('max-sync-pull');
    var closeBtn = document.getElementById('max-sync-close');

    function _msg(text, color) {
      if (msg) {
        msg.textContent = text;
        msg.style.color = color || '#888';
      }
    }

    if (urlInp) {
      urlInp.addEventListener('change', function () {
        setServerUrl(urlInp.value.trim() || DEFAULT_URL);
      });
    }

    if (inBtn) {
      inBtn.onclick = async function () {
        var url = (urlInp && urlInp.value.trim()) || DEFAULT_URL;
        var email = emailInp && emailInp.value.trim();
        // v359.60.82: name input only renders in the signed-out state.
        var nameInp = /** @type {HTMLInputElement} */ (document.getElementById('max-sync-name'));
        var name = nameInp ? nameInp.value.trim() : '';
        // v359.60.87: marketing opt-in checkbox only renders in the
        // signed-out state.
        var marketingInp = /** @type {HTMLInputElement} */ (document.getElementById('max-sync-marketing'));
        var marketingOptIn = marketingInp ? !!marketingInp.checked : false;
        if (!email) {
          _msg('Enter an email', '#c44');
          return;
        }
        setServerUrl(url);
        _msg('Sending sign-in link…', '#888');
        try {
          var resp = await requestMagicLink(email, name, marketingOptIn);
          // v359.60.81: handle approval-workflow states.
          // status: "pending" — request submitted to admin, no link sent yet.
          // status: "denied" / "revoked" — sign-in unavailable.
          if (resp && resp.status === 'pending') {
            _msg(
              resp.message || 'Your sign-in request has been sent for approval. You\'ll receive an email once it\'s reviewed.',
              '#b05820',
            );
          } else if (resp && resp.directLink) {
            // v350.1: server didn't send an email (no provider
            // configured) but returned the link directly. Render
            // as a big tappable button instead of raw URL text so
            // it looks like an action, not a typo.
            // v359.60.84: when server returns sendError, surface it —
            // otherwise the user can't tell whether the fallback is
            // because email isn't configured, or because Resend
            // rejected the send (e.g. domain not verified).
            if (msg) {
              var fallbackBlurb = resp.sendError
                ? 'Email send failed: <strong>' + _esc(resp.sendError) + '</strong>. Use the link below to sign in directly.'
                : 'Click below to sign in. (Email delivery is not configured for this build, so we\'re skipping the inbox step.)';
              msg.innerHTML =
                '<div style="color:' + (resp.sendError ? '#c44' : '#555') + ';margin-bottom:10px;font-size:12px;line-height:1.55;">' + fallbackBlurb + '</div>' +
                '<a href="' + _esc(resp.directLink) + '" style="display:block;background:var(--c-primary);color:var(--c-on-dark);padding:11px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;text-align:center;">Sign in →</a>';
            }
          } else {
            _msg(
              'Sent! Check your inbox at ' + email + ' for the sign-in link. ' +
                'It\'s good for 15 minutes.',
              '#2a7a4e',
            );
          }
        } catch (e) {
          // v359.60.81: server returns 403 with a friendly error for
          // denied / revoked emails. Surface that text verbatim.
          // v359.60.83: when the server returns { error, detail }
          // (the unhandled-error path), show the detail so debugging
          // doesn't require wrangler tail. Falls back to just `error`
          // when no detail is present.
          var raw = e && e.message ? String(e.message) : 'Sign-in failed.';
          var friendly = raw.replace(/^HTTP \d+:\s*/, '');
          // Try to parse the JSON envelope: {"error":"...","detail":"..."}.
          try {
            var parsed = JSON.parse(friendly);
            if (parsed && parsed.error) {
              friendly = parsed.detail
                ? parsed.error + ' — ' + parsed.detail
                : parsed.error;
            }
          } catch (_) {
            // not JSON; leave friendly as-is
          }
          _msg(friendly, '#c44');
        }
      };
    }
    if (outBtn) {
      outBtn.onclick = function () {
        signOut();
        _msg('Signed out.', '#888');
        setTimeout(function () {
          showSignInModal();
        }, 200);
      };
    }
    if (pullBtn) {
      pullBtn.onclick = async function () {
        _msg('Pulling…', '#888');
        try {
          var r = await pullAll();
          _msg(
            'Pulled ' + r.pulled + ', skipped ' + r.skipped + '.',
            '#2a7a4e',
          );
          if (r.pulled > 0) {
            setTimeout(function () {
              ov.remove();
              _refreshHomeScreen();
            }, 700);
          }
        } catch (e) {
          _msg('Pull failed: ' + e.message, '#c44');
        }
      };
    }

    // v350: list server trips with delete buttons. The trip list
    // on the home screen shows local trips (which can be different
    // from the server's). This affordance lets the user prune
    // server-side trips without having to curl.
    if (isSignedIn()) {
      var trashWrap = document.createElement('div');
      trashWrap.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border-3);';
      trashWrap.innerHTML =
        '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:6px;">Trips on the server</div>' +
        '<div id="max-sync-trips" style="font-size:11px;color:var(--c-ink-3);">loading…</div>';
      box.appendChild(trashWrap);
      _renderServerTripList();
    }
    if (closeBtn) {
      closeBtn.onclick = function () {
        ov.remove();
      };
    }
    // v353.4: Preferences link — opens the welcome modal (which
    // hosts the pace + sights sliders) on top. Closes the sync
    // modal first so the welcome modal isn't fighting it for focus.
    var prefsLink = document.getElementById('max-sync-prefs');
    if (prefsLink) {
      prefsLink.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        ov.remove();
        try {
          if (typeof global.showWelcomeOnboarding === 'function') {
            global.showWelcomeOnboarding();
          } else {
            alert('Preferences screen unavailable.');
          }
        } catch (err) {
          console.warn('[max-sync] preferences open failed:', err);
        }
      };
    }
    ov.addEventListener('click', function (e) {
      if (e.target === ov) ov.remove();
    });
  }

  function _esc(s){ return _escHtml(s); }

  // v350: list server-side trips with per-row delete buttons.
  // Renders into #max-sync-trips inside the modal. Each delete:
  // confirms, calls DELETE /trips/:id, removes from local
  // localStorage too so the trip doesn't reappear on next pull.
  async function _renderServerTripList() {
    var host = document.getElementById('max-sync-trips');
    if (!host) return;
    try {
      var resp = await listTrips();
      var trips = (resp && resp.trips) || [];
      if (!trips.length) {
        host.innerHTML = '<div style="color:var(--c-ink-4);font-style:italic;">No trips on the server.</div>';
        return;
      }
      host.innerHTML = '';
      trips.forEach(function (t) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--c-border-4);';
        var label = document.createElement('div');
        label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333;';
        label.textContent = t.name || 'Untitled';
        var del = document.createElement('button');
        del.textContent = 'Delete';
        del.style.cssText = 'font-size:10px;font-weight:600;color:#c44;background:var(--c-bg);border:1px solid #e8c4c4;border-radius:4px;padding:3px 8px;cursor:pointer;font-family:inherit;margin-left:10px;flex-shrink:0;';
        (function (id, name) {
          del.onclick = async function () {
            if (!confirm('Delete "' + name + '" from the server?\n\nThis also removes the local copy. Cannot be undone.')) return;
            del.disabled = true;
            del.textContent = 'deleting…';
            try {
              await deleteTrip(id);
              try { localStorage.removeItem('max-trip-' + id); } catch (_) {}
              try {
                if (global.MaxDB && MaxDB.index && typeof MaxDB.index.remove === 'function') {
                  MaxDB.index.remove(id);
                }
              } catch (_) {}
              row.remove();
              _refreshHomeScreen();
            } catch (e) {
              del.disabled = false;
              del.textContent = 'Delete';
              alert('Delete failed: ' + e.message);
            }
          };
        })(t.id, t.name);
        row.appendChild(label);
        row.appendChild(del);
        host.appendChild(row);
      });
    } catch (e) {
      host.innerHTML = '<div style="color:#c44;">Could not load: ' + _esc(e.message) + '</div>';
    }
  }

  // ── Auto-pull on page load if signed in ────────────────────
  // Runs once at module init. Doesn't block anything; logs only.
  // v343: also auto-prompts sign-in on first visit (no token in
  // localStorage). Skip the prompt when the URL has ?signin=skip,
  // useful for embedded contexts.
  function _bootPull() {
    // v350: if we just came back from a magic link, grab the
    // session token from the URL hash before doing anything else.
    var fromMagic = _consumeMagicLinkHash();

    if (!isSignedIn()) {
      try {
        var qs = new URLSearchParams(location.search);
        if (qs.get('signin') === 'skip') return;
      } catch (_) {}
      // v355.4: only auto-prompt for truly first-time visitors. If the
      // user has any local trips already, they've used the app before
      // and don't need to be greeted by a sign-in modal every visit —
      // they know where the Sync button is. This also fixes the
      // Playwright MA.4 spec: bootSeeded loads a trip into
      // max-trips-index, and the 600ms timer was popping the modal
      // mid-interaction and intercepting pointer events on adjacent
      // buttons (a real UX bug, not just a test artifact).
      var hasLocalTrips = false;
      try {
        var idx = JSON.parse(localStorage.getItem('max-trips-index') || '[]');
        hasLocalTrips = Array.isArray(idx) && idx.length > 0;
      } catch (_) {}
      if (hasLocalTrips) return;
      // PD.437: do not auto-prompt sign-in on EVERY refresh for a RETURNING
      // visitor. The old gate only skipped users who currently have local
      // trips, so a returning user whose token expired (or who cleared
      // their trips between runs) got the modal on every single refresh
      // (Neal: "refresh still causes signup dialog to show"). Only offer
      // sign-in unprompted to a GENUINELY first-time visitor — anyone who
      // has been onboarded, visited before, or signed in before already
      // knows the ⇄ Sync button and should not be greeted by a modal.
      var _returningVisitor = false;
      try {
        _returningVisitor = (localStorage.getItem('max-onboarded') === '1')
          || ((parseInt(localStorage.getItem('max-visit-count') || '0', 10) || 0) > 1)
          || !!localStorage.getItem('max-server-email');
      } catch (_) {}
      if (_returningVisitor) return;
      // Wait until the page has rendered something, then offer
      // sign-in. 600ms gives enough time for the home screen to
      // mount but not so long the user starts wondering what
      // they're looking at.
      setTimeout(function () {
        showSignInModal();
      }, 600);
      return;
    }
    // If we just signed in via magic link, refresh the home screen
    // after the pull lands so the trip list updates from local
    // state with the new session.
    if (fromMagic) {
      setTimeout(function () { _refreshHomeScreen(); }, 300);
    }
    // PD.429: the boot auto-pull is a BACKGROUND op — a 401 here must not
    // sign the user out (was re-prompting on every refresh). Mark the
    // window tolerant, then clear it once both pulls settle.
    _bgAuthTolerant = true;
    var _bootPulls = [];
    _bootPulls.push(pullAll().then(
      function (r) {
        if (r.pulled > 0) {
          console.log('[max-sync] pulled', r.pulled, 'trip(s) from server on boot');
          _refreshHomeScreen();
        }
      },
      function (e) {
        console.warn('[max-sync] boot pull failed:', e);
      },
    ));
    // v353.3: also hydrate prefs on boot so a returning device picks
    // up changes another device pushed (e.g., paceHours bumped on
    // the laptop, opened the phone next morning). Independent of
    // pullAll so a trip-pull failure doesn't block prefs.
    _bootPulls.push(pullPrefs().catch(function () {}));
    Promise.allSettled(_bootPulls).then(function () { _bgAuthTolerant = false; });
  }

  // v343: re-render the home screen / trip list after a pull so
  // the user doesn't have to manually refresh. Tries the desktop
  // home renderer first, then mobile's, then falls back to a
  // hard reload.
  function _refreshHomeScreen() {
    try {
      // Desktop: goHome rebuilds the trip list from MaxDB.
      if (typeof global.goHome === 'function' && global._currentTripId == null) {
        global.goHome();
        return;
      }
      // PD.482 (dead-code): removed a vestigial `global.MaxMobile()` branch
      // here — MaxMobile is never defined anywhere in the codebase, so the
      // typeof check was always false and the branch never ran. The generic
      // storage-event fallback below was already the real mobile path.
      // Generic fallback: synthetic storage event (mobile listens
      // for these to re-render on cross-tab sync).
      var ev = new StorageEvent('storage', { key: 'max-trips-index' });
      window.dispatchEvent(ev);
    } catch (e) {
      console.warn('[max-sync] could not refresh after pull:', e);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  global.MaxSync = {
    isSignedIn: isSignedIn,
    getEmail: getEmail,
    getServerUrl: getServerUrl,
    signIn: signIn,
    signOut: signOut,
    showSignInModal: showSignInModal,
    scheduleSave: scheduleSave,
    flushNow: flushNow, // PD.334: flush pending debounce (pagehide path)
    pullAll: pullAll,
    listTrips: listTrips,
    getTrip: getTrip,
    deleteTrip: deleteTrip,
    // PD.197: tombstone API. markDeletedLocally adds the ID to the
    // local tombstone list unconditionally — call this from any UI
    // delete path so the trip can't resurrect via pullAll even if
    // we're offline or signed out at delete time. drainTombstones
    // (optional) lets a caller proactively retry pending server
    // deletes; pullAll already does this implicitly per-pull.
    markDeletedLocally: _tombstoneAdd,
    drainTombstones: async function() {
      var m = _readTombstones();
      var ids = Object.keys(m);
      for (var i = 0; i < ids.length; i++) {
        try {
          await request('/trips/' + encodeURIComponent(ids[i]), { method: 'DELETE' });
          _tombstoneRemove(ids[i]);
        } catch (_) {}
      }
    },
    // v353.3: prefs sync. UI shouldn't need to call these directly
    // — MaxDB.prefs.set() auto-pushes via the prefsChanged bridge,
    // and pullPrefs runs on sign-in/boot. Exposed for tests and for
    // the welcome modal's "load my pace before showing the slider"
    // case.
    pullPrefs: pullPrefs,
    // v353.3: per-trip UI state. Use for cheap UI flips (banners
    // expanded, research collapsed) that should follow a trip
    // across devices but don't change trip content. Server merges
    // the patch into trip.ui_state without bumping trip.updatedAt.
    patchTripUiState: patchTripUiStateRemote,
    // v353.5: share-link operations.
    mintShareToken: mintShareToken,
    listShareTokens: listShareTokens,
    revokeShareTokens: revokeShareTokens,
    fetchSharedTrip: fetchSharedTrip,
    // PD.61: cross-device attachment storage.
    uploadAttachment: uploadAttachment,
    fetchAttachment: fetchAttachment,
    deleteAttachment: deleteAttachment,
    // PD.63: URL metadata fetch for smart link paste.
    fetchUrlMetadata: fetchUrlMetadata,
    // For the LLM proxy round — exposed now so callMax can switch
    // over without another file edit.
    _request: request,
  };

  // Defer boot pull until window load so we don't fight first paint.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', _bootPull);
  } else {
    setTimeout(_bootPull, 100);
  }

  // v346.1: poll for changes from other devices.
  //
  // Two triggers:
  //   - visibility change → pull when the tab/app becomes active
  //     (covers "I planned on laptop, picked up the phone")
  //   - 60-second interval while the tab is visible (covers
  //     "two browsers open, I edit on one, look at the other")
  //
  // No-op when not signed in or when the page is hidden — saves
  // cost and battery.
  var _pollTimer = null;
  function _maybePull() {
    if (!isSignedIn()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    // PD.429b (T1.2): the poll / visibility-change pull is a BACKGROUND op
    // — a transient 401 here must NOT clear the token and sign the user out
    // (this fires on every tab-focus, including right after a refresh, so it
    // was a recurring silent sign-out). Same tolerant window as the boot
    // pull. v353.4: also pull prefs so cross-device pref changes flow in.
    _bgAuthTolerant = true;
    var _polls = [];
    _polls.push(pullAll().then(
      function (r) {
        if (r.pulled > 0) {
          console.log('[max-sync] poll pulled', r.pulled, 'trip(s)');
          _refreshHomeScreen();
        }
      },
      function () { /* silent on poll failures */ },
    ));
    _polls.push(pullPrefs().catch(function () { /* silent */ }));
    Promise.allSettled(_polls).then(function () { _bgAuthTolerant = false; });
  }
  function _startPolling() {
    if (_pollTimer) return;
    // Round NC.X: exponential backoff on persistent failures. Base
    // 60s; doubles up to 30min when the server is unreachable.
    // Resets to 60s on any successful pull (success path runs in
    // pullPrefs, where _maxSyncFailCount is set to 0 on the happy
    // path — see line 397 area).
    function _nextInterval() {
      var fails = global._maxSyncFailCount || 0;
      if (fails < 3) return 60000;           // first 3 failures: stay at 60s
      if (fails < 6) return 5 * 60000;       // next 3: 5 min
      if (fails < 10) return 15 * 60000;     // next 4: 15 min
      return 30 * 60000;                     // beyond that: 30 min
    }
    function _scheduleNext(){
      if (_pollTimer) { clearTimeout(_pollTimer); _pollTimer = null; }
      _pollTimer = setTimeout(function(){
        _maybePull();
        _scheduleNext();
      }, _nextInterval());
    }
    _scheduleNext();
  }
  function _stopPolling() {
    // Either setInterval or setTimeout — clearing both is safe.
    if (_pollTimer) { clearInterval(_pollTimer); clearTimeout(_pollTimer); _pollTimer = null; }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        _stopPolling();
      } else {
        // Tab/app just became active — pull immediately, then start
        // the regular interval.
        _maybePull();
        _startPolling();
      }
    });
    // Start polling on initial load too (visibility may already be
    // 'visible' so visibilitychange won't fire).
    if (!document.hidden) _startPolling();
  }
})(typeof window !== 'undefined' ? window : this);


export {};
