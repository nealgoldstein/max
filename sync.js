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

    var resp;
    try {
      resp = await fetch(url, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      // Network unreachable — server down, offline, etc. Surface
      // a typed error so callers can distinguish from auth/data errors.
      var err = new Error('Server unreachable: ' + (e && e.message ? e.message : 'unknown'));
      err.code = 'NETWORK';
      throw err;
    }

    if (resp.status === 401) {
      // Token expired or invalid. Clear it so the UI prompts re-sign-in.
      setToken(null);
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
      throw errBad;
    }
    return data;
  }

  // ── Auth ───────────────────────────────────────────────────

  // v350: magic-link sign-in. Server emails a one-time link; user
  // clicks it; comes back with #session=<token> in the URL hash.
  // The boot path detects the hash and stores the token. The
  // legacy dev-login is kept as `signInDev` for local testing.
  async function requestMagicLink(email) {
    if (!email || !email.trim()) throw new Error('Email required');
    return request('/auth/magic-link', {
      method: 'POST',
      skipAuth: true,
      body: { email: email.trim() },
    });
  }

  async function signInDev(email) {
    if (!email || !email.trim()) throw new Error('Email required');
    var data = await request('/auth/dev-login', {
      method: 'POST',
      skipAuth: true,
      body: { email: email.trim() },
    });
    setToken(data.token);
    setEmail(data.user && data.user.email);
    return data;
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
      setToken(token);
      if (email) setEmail(email);
      // Clear the hash so the URL is clean.
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (_) { location.hash = ''; }
      return true;
    } catch (_) { return false; }
  }

  function signOut() {
    setToken(null);
    setEmail(null);
  }

  // ── Trip endpoints ─────────────────────────────────────────

  async function listTrips() {
    return request('/trips');
  }
  async function getTrip(id) {
    return request('/trips/' + encodeURIComponent(id));
  }
  async function createTrip(payload) {
    return request('/trips', { method: 'POST', body: payload });
  }
  async function updateTrip(id, payload) {
    return request('/trips/' + encodeURIComponent(id), {
      method: 'PUT',
      body: payload,
    });
  }
  async function deleteTrip(id) {
    return request('/trips/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // ── Push (debounced save) ──────────────────────────────────
  //
  // Hook: after every _emitTripMutation, the desktop calls
  // MaxSync.scheduleSave(). We debounce 1.5s and then PUT the
  // current trip body. If the server doesn't have this trip yet,
  // we POST first.

  var _saveTimer = null;
  var _saveInFlight = false;

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
        await updateTrip(tripId, { body: body, updatedAt: now, name: name });
        _setStatus('saved ✓', '#2a7a4e');
      } catch (e) {
        if (e.status === 404) {
          // Server doesn't have this trip yet. POST it.
          await createTrip({ id: tripId, name: name, body: body, updatedAt: now });
          _setStatus('saved ✓', '#2a7a4e');
        } else if (e.code === 'CONFLICT') {
          // Server has a newer copy. For v1 we just resave with force,
          // since the user is actively typing here. A future round
          // will surface a "server has newer — keep yours / theirs"
          // chooser.
          await updateTrip(tripId, {
            body: body,
            updatedAt: now,
            name: name,
            force: true,
          });
          _setStatus('saved ✓ (overrode server)', '#b05820');
        } else {
          throw e;
        }
      }
    } catch (e) {
      console.warn('[max-sync] save failed:', e);
      if (e.code === 'AUTH') {
        _setStatus('signed out — sign in again', '#c44');
      } else if (e.code === 'NETWORK') {
        _setStatus('offline — saved locally only', '#aaa');
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

  async function pullAll() {
    if (!isSignedIn()) return { pulled: 0, skipped: 0 };
    var resp = await listTrips();
    var serverTrips = (resp && resp.trips) || [];
    var pulled = 0;
    var skipped = 0;

    for (var i = 0; i < serverTrips.length; i++) {
      var s = serverTrips[i];
      var key = 'max-trip-' + s.id;
      var localTimestamp = 0;
      try {
        var local = localStorage.getItem(key);
        if (local) {
          var parsed = JSON.parse(local);
          // Use the trip's __saved__ timestamp if present, otherwise
          // skip — local always wins for unfetched trips so we don't
          // accidentally clobber unsaved local edits. This is
          // conservative; v1 behavior.
          localTimestamp = (parsed && parsed.__saved__) || 0;
        }
      } catch (_) {}

      var serverTimestamp = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;

      if (serverTimestamp > localTimestamp) {
        // Server is newer — pull full body
        try {
          var full = await getTrip(s.id);
          if (full && full.trip) {
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
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11000;display:flex;align-items:center;justify-content:center;padding:24px;';

    var box = document.createElement('div');
    box.style.cssText =
      'background:#fff;border-radius:12px;max-width:420px;width:100%;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);';

    // v353: title is context-aware. When signed in the modal is a
    // sync-management surface (pull, sign out, list server trips);
    // when signed out it's purely a sign-in form, and "Sync with
    // server" was misleading. Lead with the actual user-facing
    // action in each state.
    var modalTitle = isSignedIn() ? 'Sync with server' : 'Sign in to Max';
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:#1a5fa8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">⇄</div>' +
      '<div style="font-size:14px;font-weight:700;">' + modalTitle + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:#555;line-height:1.55;margin-bottom:14px;">' +
      (isSignedIn()
        ? '<strong>Signed in as ' + (getEmail() || 'user') + '</strong>.'
        : 'Sign in to share trips between devices. We\'ll email you a one-time link — no password.') +
      '</div>' +
      '<label style="display:block;font-size:11px;color:#666;font-weight:600;margin-bottom:6px;">Server URL</label>' +
      '<input id="max-sync-url" type="text" value="' +
      _esc(getServerUrl()) +
      '" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid #ddd;border-radius:5px;font-family:monospace;box-sizing:border-box;margin-bottom:10px;" />' +
      '<label style="display:block;font-size:11px;color:#666;font-weight:600;margin-bottom:6px;">Email</label>' +
      '<input id="max-sync-email" type="email" placeholder="you@example.com" value="' +
      _esc(getEmail() || '') +
      '" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid #ddd;border-radius:5px;box-sizing:border-box;margin-bottom:14px;" />' +
      '<div id="max-sync-msg" style="font-size:11px;color:#888;min-height:14px;margin-bottom:10px;"></div>' +
      '<div style="display:flex;gap:8px;">' +
      (isSignedIn()
        ? '<button id="max-sync-pull" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:#fff;color:#1a5fa8;border:1px solid #1a5fa8;border-radius:5px;cursor:pointer;font-family:inherit;">Pull trips from server</button>' +
          '<button id="max-sync-out" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:#fff;color:#c44;border:1px solid #c44;border-radius:5px;cursor:pointer;font-family:inherit;">Sign out</button>'
        : '<button id="max-sync-in" style="flex:1;padding:8px;font-size:12px;font-weight:600;background:#1a5fa8;color:#fff;border:1px solid #1a5fa8;border-radius:5px;cursor:pointer;font-family:inherit;">Email me a sign-in link</button>') +
      '<button id="max-sync-close" style="padding:8px 14px;font-size:12px;font-weight:600;background:#fff;color:#666;border:1px solid #ddd;border-radius:5px;cursor:pointer;font-family:inherit;">Close</button>' +
      '</div>';

    ov.appendChild(box);
    document.body.appendChild(ov);

    var urlInp = document.getElementById('max-sync-url');
    var emailInp = document.getElementById('max-sync-email');
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
        if (!email) {
          _msg('Enter an email', '#c44');
          return;
        }
        setServerUrl(url);
        _msg('Sending sign-in link…', '#888');
        try {
          var resp = await requestMagicLink(email);
          if (resp && resp.directLink) {
            // v350.1: server didn't send an email (no provider
            // configured) but returned the link directly. Show it
            // as a clickable element so the user can sign in
            // anyway.
            if (msg) {
              msg.innerHTML =
                '<div style="color:#888;margin-bottom:6px;">No email service set up yet. Click this link to sign in:</div>' +
                '<a href="' + _esc(resp.directLink) + '" style="color:#1a5fa8;font-weight:600;text-decoration:none;word-break:break-all;font-size:11px;">' + _esc(resp.directLink) + '</a>';
            }
          } else {
            _msg(
              'Sent! Check your inbox at ' + email + ' for the sign-in link. ' +
                'It\'s good for 15 minutes.',
              '#2a7a4e',
            );
          }
        } catch (e) {
          _msg('Failed: ' + e.message, '#c44');
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
      trashWrap.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid #eee;';
      trashWrap.innerHTML =
        '<div style="font-size:11px;font-weight:600;color:#666;margin-bottom:6px;">Trips on the server</div>' +
        '<div id="max-sync-trips" style="font-size:11px;color:#888;">loading…</div>';
      box.appendChild(trashWrap);
      _renderServerTripList();
    }
    if (closeBtn) {
      closeBtn.onclick = function () {
        ov.remove();
      };
    }
    ov.addEventListener('click', function (e) {
      if (e.target === ov) ov.remove();
    });
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

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
        host.innerHTML = '<div style="color:#aaa;font-style:italic;">No trips on the server.</div>';
        return;
      }
      host.innerHTML = '';
      trips.forEach(function (t) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;';
        var label = document.createElement('div');
        label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333;';
        label.textContent = t.name || 'Untitled';
        var del = document.createElement('button');
        del.textContent = 'Delete';
        del.style.cssText = 'font-size:10px;font-weight:600;color:#c44;background:#fff;border:1px solid #e8c4c4;border-radius:4px;padding:3px 8px;cursor:pointer;font-family:inherit;margin-left:10px;flex-shrink:0;';
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
    pullAll().then(
      function (r) {
        if (r.pulled > 0) {
          console.log('[max-sync] pulled', r.pulled, 'trip(s) from server on boot');
          _refreshHomeScreen();
        }
      },
      function (e) {
        console.warn('[max-sync] boot pull failed:', e);
      },
    );
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
      // Mobile: dispatch a hashchange so its router re-renders.
      if (typeof global.MaxMobile === 'function') {
        global.MaxMobile();
        return;
      }
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
    pullAll: pullAll,
    listTrips: listTrips,
    getTrip: getTrip,
    deleteTrip: deleteTrip,
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
    pullAll().then(
      function (r) {
        if (r.pulled > 0) {
          console.log('[max-sync] poll pulled', r.pulled, 'trip(s)');
          _refreshHomeScreen();
        }
      },
      function () { /* silent on poll failures */ },
    );
  }
  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(_maybePull, 60000); // 60s
  }
  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
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
