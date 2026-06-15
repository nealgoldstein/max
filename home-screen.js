// home-screen.js — Home screen + pasted-list import pipeline (parsePlacesList,
// _buildTripFromPastedList, etc.). Extracted from index.html (PD.456). Self-contained
// globalThis exposures travel with their defs.

// ── Home screen ────────────────────────────────────────────
function showHome(){
  loadTripsIndex();
  // ARCH Phase 3: tell TripStore we're leaving the trip context.
  // emits tripUnloaded for subscribers; clears the canonical reference.
  // The stub-trip assignment below is defensive cover for any reader
  // that doesn't null-check global.trip — those become migration
  // targets in subsequent phases.
  if (typeof TripStore !== "undefined") {
    try { TripStore.unload(); } catch(_) {}
  }
  trip={name:"",destinations:[],legs:{},trackSpending:false,pendingActions:[]};
  activeDest=null; _currentTripId=null; _fileHandle=null;
  // Clear left panel content
  var lpc=g("lp-content"); if(lpc)lpc.innerHTML="";
  // Tear down any floating overlays that belong to the trip view (pace toast,
  // keep toast) so they don't linger on the home screen.
  var pt = document.getElementById("pace-toast"); if (pt) pt.remove();
  var kt = document.getElementById("keep-toast"); if (kt) kt.remove();
  // Hide app, show home
  g("app").style.display="none";
  g("home-screen").style.display="flex";
  renderHomeScreen();
}

// Round DH — read a saved trip WITHOUT mutating the global trip
// variable. Used by the home-screen dashboard so we can inspect
// bookings/pending-actions across all trips.
// v359.60.93: read through MaxDB.trip.readRaw so trips stored in
// IndexedDB (when localStorage spills over quota) still show up on
// the home dashboard. Falls back to raw localStorage if MaxDB isn't
// ready yet.
function _readTripById(tripId){
  if (_inIframe || !tripId) return null;
  try {
    var saved = null;
    if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.readRaw === "function") {
      saved = MaxDB.trip.readRaw(tripId);
    }
    if (!saved) saved = localStorage.getItem("max-trip-" + tripId);
    if (!saved) return null;
    var parsed = JSON.parse(saved);
    return (parsed && parsed.trip) ? parsed.trip : parsed;
  } catch(e) { return null; }
}

// Round DH — pick the user's "current" trip: the one in progress today,
// else the next-upcoming trip (smallest positive startDate − today).
// Returns the trip ID, or null when nothing is relevant.
function _selectCurrentTripId(){
  if (!_tripsIndex || !_tripsIndex.length) return null;
  var today = new Date(); today.setHours(0,0,0,0);
  var msDay = 86400000;
  var inProgress = null;
  var upcoming = null;
  var upcomingDays = Infinity;
  _tripsIndex.forEach(function(e){
    if (!e.startDate || !e.endDate) return;
    var s = new Date(e.startDate + "T12:00:00");
    var en = new Date(e.endDate + "T12:00:00");
    var sDays = Math.round((s - today) / msDay);
    var eDays = Math.round((en - today) / msDay);
    if (sDays <= 0 && eDays >= 0) inProgress = e;
    else if (sDays > 0 && sDays < upcomingDays) { upcoming = e; upcomingDays = sDays; }
  });
  return (inProgress && inProgress.id) || (upcoming && upcoming.id) || null;
}

// Round DH — walk the chosen trip and assemble the four dashboard
// section payloads. Returns { trip, today[], tomorrow[], deadlines[],
// pending[] } where each array can be empty. Each item carries enough
// context to render and to deep-link back into the trip.
function _buildDashboardItems(trip, tripId){
  // v360.1: delegate to MaxTripUI.collectOperationalItems — the
  // canonical "things you need to take care of" collector. Earlier
  // we had a second, slightly-different implementation here:
  //   * deadlines were capped at a 7-day window (this one), but the
  //     trip-view banner counted them all (the other one)
  //   * deadlines required cancelType==="deadline" (this one), but
  //     the trip-view accepted any cancelDeadline (the other one)
  //   * pending was named `pending` here but `actions` over there
  //   * day-item sight bookings + transport-leg deadlines were
  //     handled here directly; over there `collectDeadlines(d)` did
  //     the walk
  // Result: trip-view said 18, dashboard said 17 — same trip. Now
  // both surfaces read from the same source.
  //
  // Returned shape preserves the home-dashboard contract ({today,
  // tomorrow, deadlines, pending}) so renderHomeDashboard and the
  // various consumers below this function don't need to change. The
  // `pending` alias on `ops.actions` keeps the existing render code
  // working unchanged.
  var ops = (typeof MaxTripUI !== "undefined" &&
             typeof MaxTripUI.collectOperationalItems === "function")
    ? MaxTripUI.collectOperationalItems(trip)
    : { actions:[], deadlines:[], today:[], tomorrow:[] };

  // Decorate deadlines for the dashboard's existing render contract.
  // The home dashboard's describeItem switches on .kind (deadline-hotel
  // / deadline-sight / deadline-transport) for icon + "X days left"
  // text, and reads .daysLeft for the urgency colour. collectDeadlines
  // returns .type ("Hotel"/"Activity"/"Transport") instead, so we map
  // both fields here. Keeping the decoration in this thin shim instead
  // of pushing it down into the shared helper means the helper stays
  // surface-neutral.
  var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
  var typeToKind = { Hotel: "deadline-hotel", Activity: "deadline-sight", Transport: "deadline-transport" };
  var deadlines = (ops.deadlines || []).map(function (d) {
    var dd = d.deadline ? new Date(d.deadline + "T12:00:00") : null;
    var daysLeft = dd ? Math.round((dd - todayMid) / 86400000) : null;
    return Object.assign({}, d, {
      daysLeft: daysLeft,
      kind: typeToKind[d.type] || "deadline-hotel",
    });
  });

  // Decorate pending actions with .kind:"pending" + .name (the legacy
  // shape the dashboard's describeItem switches on).
  var pending = (ops.actions || []).map(function (a) {
    return {
      kind: "pending",
      name: a.eventName || "Action",
      destName: a.destName || "",
      detail: a.detail || "",
      confirmation: a.confirmationNumber || null,
      id: a.id,
    };
  });

  return {
    trip:      trip,
    tripId:    tripId,
    today:     ops.today     || [],
    tomorrow:  ops.tomorrow  || [],
    deadlines: deadlines,
    pending:   pending,
  };
}

// v360.1 — Home dashboard demoted. Previously this panel rendered the
// full operational list (Today / Tomorrow / Deadlines / Provider
// actions) for the user's current trip, duplicating what the trip
// view's peek chip + "What needs you" modal now show. The detailed
// list moved to the trip view; home becomes a compact launchpad.
//
// For each trip the user has, we render one row carrying:
//   * the trip name (clickable → opens the trip)
//   * a status line (in-progress · Day N of M / starts in N days / …)
//   * a count chip ("◇ N things need you →") when the trip has open
//     operational items; absent otherwise (calm steady state)
//
// Cross-trip awareness comes for free: any trip with pending items
// surfaces here so you don't have to enter it to know it needs you.
// In-progress trips sort first, then upcoming by proximity. Ended
// trips with nothing pending and far-future trips with nothing
// pending are omitted to keep the surface quiet.
//
// _buildDashboardItems is kept for internal callers that still want
// the structured payload (search etc.); only the rendering changes.
function renderHomeDashboard(){
  var host = g("hs-dashboard");
  if (!host) return;
  host.innerHTML = "";
  if (!_tripsIndex || !_tripsIndex.length) { host.style.display = "none"; return; }

  var t0 = new Date(); t0.setHours(12, 0, 0, 0);
  var msDay = 86400000;
  var rows = [];

  _tripsIndex.forEach(function (e) {
    if (!e || !e.id) return;
    var trip = _readTripById(e.id);
    if (!trip) return;
    var n = (typeof MaxTripUI !== "undefined" &&
             typeof MaxTripUI.countOperationalItems === "function")
            ? MaxTripUI.countOperationalItems(trip) : 0;

    var s  = e.startDate ? new Date(e.startDate + "T12:00:00") : null;
    var en = e.endDate   ? new Date(e.endDate   + "T12:00:00") : null;
    var startDays = s  ? Math.round((s  - t0) / msDay) : null;
    var endDays   = en ? Math.round((en - t0) / msDay) : null;
    var inProgress = (startDays !== null && endDays !== null && startDays <= 0 && endDays >= 0);
    var upcoming   = (startDays !== null && startDays > 0);
    var ended      = (endDays !== null && endDays < 0);

    // Surface filter: only show this trip if it's in-progress, starting
    // within 60 days, OR has pending items. Far-future and long-ago
    // trips with no open items stay hidden — they'd just be noise on
    // the launchpad.
    var hasFocus = inProgress || (upcoming && startDays <= 60) || n > 0;
    if (!hasFocus) return;

    // Sort key: in-progress first; then upcoming by start-proximity;
    // then anything else, ended last by recency.
    var sortKey;
    if (inProgress)      sortKey = 0;
    else if (upcoming)   sortKey = 100 + startDays;
    else if (ended)      sortKey = 1000000 + Math.abs(endDays || 0);
    else                 sortKey = 500000;

    rows.push({
      tripId: e.id,
      name: trip.name || e.name || "Trip",
      n: n,
      startDays: startDays,
      endDays: endDays,
      inProgress: inProgress,
      ended: ended,
      totalDays: (s && en) ? (Math.round((en - s) / msDay) + 1) : null,
      sortKey: sortKey,
    });
  });

  if (!rows.length) { host.style.display = "none"; return; }
  rows.sort(function (a, b) { return a.sortKey - b.sortKey; });
  host.style.display = "block";

  rows.forEach(function (r) {
    // v360.1: row is now a vertical stack — name on top, status line
    // beneath it, then the "X things need your attention" chip on its
    // own line under that. Earlier the chip sat to the right of the
    // name (flex justify-between); placing it under instead gives the
    // chip its own breathing room and reads more naturally: identity
    // first, then state, then the call to action.
    var card = document.createElement("div");
    card.style.cssText =
      "background:var(--c-bg);border:1px solid #e6e2d8;border-radius:10px;" +
      "padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.04);" +
      "margin-bottom:8px;display:flex;flex-direction:column;gap:6px;";

    // Name
    var nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size:14px;font-weight:700;color:#1a1a1a;cursor:pointer;";
    nameEl.textContent = r.name;
    (function (tid) {
      nameEl.onclick = function () { if (typeof selectTrip === "function") selectTrip(tid); };
    })(r.tripId);
    nameEl.onmouseover = function () { nameEl.style.color = "#1a5fa8"; };
    nameEl.onmouseout  = function () { nameEl.style.color = "#1a1a1a"; };
    card.appendChild(nameEl);

    // Status line
    var statusLine = "", statusColor = "#999";
    if (r.inProgress) {
      var dayN = (1 - r.startDays);
      statusLine = "In progress · Day " + dayN + (r.totalDays ? (" of " + r.totalDays) : "");
      statusColor = "#2a7a4e";
    } else if (r.ended) {
      statusLine = "Ended " + Math.abs(r.endDays) + " day" + (Math.abs(r.endDays) !== 1 ? "s" : "") + " ago";
      statusColor = "#999";
    } else if (r.startDays === 0) {
      statusLine = "Starts TODAY"; statusColor = "#b05820";
    } else if (r.startDays === 1) {
      statusLine = "Starts tomorrow"; statusColor = "#b05820";
    } else if (r.startDays !== null && r.startDays > 0) {
      statusLine = "Starts in " + r.startDays + " days";
      statusColor = r.startDays <= 7 ? "#b05820" : "#1a5fa8";
    }
    if (statusLine) {
      var statusEl = document.createElement("div");
      statusEl.style.cssText = "font-size:11.5px;font-weight:600;color:" + statusColor + ";";
      statusEl.textContent = statusLine;
      card.appendChild(statusEl);
    }

    // Chip (or quiet link) — under the name + status block.
    if (r.n > 0) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.style.cssText =
        "background:var(--c-bg);border:1px solid #d8c4a4;color:#5c4520;font-family:inherit;" +
        "font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:14px;" +
        "cursor:pointer;display:inline-flex;align-items:center;gap:6px;align-self:flex-start;" +
        "box-shadow:0 1px 2px rgba(0,0,0,.04);margin-top:2px;";
      chip.innerHTML = "◇ <span style=\"font-weight:700;\">" + r.n + "</span> thing" +
        (r.n === 1 ? "" : "s") + " need your attention <span aria-hidden=\"true\">→</span>";
      chip.title = "Open this trip — the trip view shows the details";
      chip.onmouseover = function () { chip.style.background = "#fff8ed"; };
      chip.onmouseout  = function () { chip.style.background = "#fff"; };
      (function (tid) {
        chip.onclick = function () { if (typeof selectTrip === "function") selectTrip(tid); };
      })(r.tripId);
      card.appendChild(chip);
    } else {
      var calm = document.createElement("button");
      calm.type = "button";
      calm.style.cssText =
        "background:transparent;border:none;color:var(--c-ink-3);font-family:inherit;" +
        "font-size:11.5px;font-style:italic;cursor:pointer;padding:4px 0;align-self:flex-start;";
      calm.textContent = "Nothing pressing →";
      calm.onmouseover = function () { calm.style.color = "#1a5fa8"; };
      calm.onmouseout  = function () { calm.style.color = "#888"; };
      (function (tid) {
        calm.onclick = function () { if (typeof selectTrip === "function") selectTrip(tid); };
      })(r.tripId);
      card.appendChild(calm);
    }

    host.appendChild(card);
  });
}

// PD.407: inline trip-view search engine. Replaces the old modal
// (openTripSearch overlay) with a Discovery-style inline bar wired to
// #trip-inline-search (see the markup above #lp-content). Substring-
// matches across the same surfaces the modal did:
//   - destination place + label + day labels
//   - itinerary item names + notes
//   - laterItems / maybeItems names
//   - per-destination "Keep in mind" research notes
// Navigation: ↓ / Enter = next match, ↑ = previous, with wraparound.
// Going to a match calls selectDest(destId) (so cross-destination
// matches work from any view) then scrolls the matching day into view
// and flashes it — mirroring the old modal's click-to-navigate.
var _tripSearch = { q: "", matches: [], idx: -1, timer: null };

// PD.412: accent/diacritic-insensitive normalizer so "Vik" matches
// "Vík", "Reykjavik" matches "Reykjavík", etc. Mirrors the Discovery
// search's _searchNormalize (which is function-local there, so we
// re-implement the same NFD-strip here).
function _tripSearchNorm(s) {
  try {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  } catch (_) {
    return String(s == null ? "" : s).toLowerCase();
  }
}

// Scan the whole trip for substring matches. Returns lightweight
// navigation targets {destId, dayId, kind, context}; the inline bar
// only needs counts + where-to-jump, not rendered result rows. `q` is
// already lowercased + accent-stripped by the caller.
function _tripSearchScan(q) {
  var out = [];
  if (typeof trip === "undefined" || !trip || !trip.destinations) return out;
  var N = _tripSearchNorm;
  (trip.destinations || []).forEach(function (dest) {
    var destLabel = dest.label || dest.place || "";
    if (N(dest.place).indexOf(q) >= 0 || N(dest.label).indexOf(q) >= 0) {
      out.push({ kind: "dest", destId: dest.id, dayId: null, context: destLabel });
    }
    // PD.416: per-destination notes now live in the unified per-place
    // store (placeMeta.notes); fall back to legacy dest.research.
    var _destNotes = (typeof _pmGetPlaceNotes === "function")
      ? _pmGetPlaceNotes(dest.place) : (dest.research || "");
    if (N(_destNotes).indexOf(q) >= 0) {
      out.push({ kind: "note", destId: dest.id, dayId: null, context: destLabel + " · note" });
    }
    (dest.days || []).forEach(function (day) {
      if (N(day.lbl).indexOf(q) >= 0) {
        out.push({ kind: "day", destId: dest.id, dayId: day.id, context: destLabel + " · day" });
      }
      (day.items || []).forEach(function (it) {
        if (N(it.n).indexOf(q) >= 0) {
          out.push({ kind: "item", destId: dest.id, dayId: day.id, context: destLabel });
        }
        if (N(it.note).indexOf(q) >= 0) {
          out.push({ kind: "item-note", destId: dest.id, dayId: day.id, context: destLabel });
        }
      });
    });
    ["laterItems", "maybeItems"].forEach(function (bucket) {
      (dest[bucket] || []).forEach(function (it) {
        if (N(it.n).indexOf(q) >= 0) {
          out.push({ kind: "bucket", destId: dest.id, dayId: null, context: destLabel });
        }
      });
    });
  });
  return out;
}

// Update the counter text + show/hide arrows and Clear, matching the
// picker's behavior: arrows appear only when there's more than one
// match (they exist to navigate AMONG matches); the counter reads
// "N matches" before the user has stepped into one, then "i / N".
function _tripSearchSyncCounter() {
  var c = document.getElementById("trip-inline-search-counter");
  var prev = document.getElementById("trip-inline-search-prev");
  var next = document.getElementById("trip-inline-search-next");
  var clr = document.getElementById("trip-inline-search-clear");
  var inp = document.getElementById("trip-inline-search");
  var n = _tripSearch.matches.length;
  var hasQ = !!(inp && inp.value.trim().length >= 2);
  if (c) {
    if (!hasQ) {
      c.style.visibility = "hidden";
      c.textContent = "";
    } else {
      c.style.visibility = "visible";
      if (n === 0) c.textContent = "No matches";
      else if (_tripSearch.idx < 0) c.textContent = n + (n === 1 ? " match" : " matches");
      else c.textContent = (_tripSearch.idx + 1) + " / " + n;
    }
  }
  var showArrows = n > 1;
  if (prev) prev.style.visibility = showArrows ? "visible" : "hidden";
  if (next) next.style.visibility = showArrows ? "visible" : "hidden";
  if (clr) clr.style.visibility = (inp && inp.value.length) ? "visible" : "hidden";
}

// PD.412: jump to match i (wraps) and highlight it IN THE LIST — no
// selectDest, so searching never yanks the user into a single
// destination's detail card. If we're currently in a detail view,
// switch back to the overview list first, then scroll+flash the
// matching destination card (.tm-dest[data-id]) or day (#dy-<id>).
function _tripSearchGoTo(i) {
  var m = _tripSearch.matches;
  if (!m.length) return;
  i = ((i % m.length) + m.length) % m.length;
  _tripSearch.idx = i;
  _tripSearchSyncCounter();
  var r = m[i];
  // Ensure the overview LIST is showing (not a single-dest detail card).
  var switched = false;
  if (typeof _leftMode !== "undefined" && _leftMode !== "trip") {
    switched = true;
    if (typeof setLeftMode === "function") setLeftMode("trip");
    else if (typeof drawTripMode === "function") drawTripMode();
  }
  var go = function () {
    var el = null;
    if (r.dayId) { try { el = document.getElementById("dy-" + r.dayId); } catch (_) {} }
    if (!el && r.destId != null) {
      try { el = document.querySelector('.tm-dest[data-id="' + String(r.destId).replace(/"/g, '\\"') + '"]'); } catch (_) {}
    }
    if (!el) {
      var lpc = document.getElementById("lp-content");
      if (lpc) { try { lpc.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) { lpc.scrollTop = 0; } }
      return;
    }
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    catch (_) { el.scrollIntoView(); }
    var _prevTrans = el.style.transition, _prevBg = el.style.backgroundColor;
    el.style.transition = "background-color 0.4s";
    el.style.backgroundColor = "#fff7d4";
    setTimeout(function () {
      el.style.backgroundColor = _prevBg || "";
      el.style.transition = _prevTrans || "";
    }, 1800);
  };
  // If we just switched modes, give drawTripMode a tick to paint.
  if (switched) setTimeout(go, 140); else go();
}

function _tripSearchOnInput() {
  var inp = document.getElementById("trip-inline-search");
  if (!inp) return;
  _tripSearch.q = inp.value;
  // PD.412: normalize the query the same way as the fields (accent-strip)
  // so "Vik" finds "Vík". Length gate uses the raw trimmed input.
  var raw = inp.value.trim();
  var q = _tripSearchNorm(raw);
  clearTimeout(_tripSearch.timer);
  _tripSearch.timer = setTimeout(function () {
    _tripSearch.matches = raw.length >= 2 ? _tripSearchScan(q) : [];
    // Reset to "not yet stepped in" so the counter shows the total and
    // the first down/Enter lands on match 0.
    _tripSearch.idx = -1;
    _tripSearchSyncCounter();
  }, 120);
}

// Wire the inline bar once and keep its visibility in sync. Called from
// drawTripMode / drawDestMode (the two trip-view renderers). The bar
// lives outside #lp-content so it survives their innerHTML rebuilds;
// we just re-toggle display and restore the stored query each render.
function _ensureTripInlineSearch() {
  var bar = document.getElementById("trip-inline-search-bar");
  if (!bar) return;
  var hasTrip = !!(typeof trip !== "undefined" && trip &&
                   Array.isArray(trip.destinations) && trip.destinations.length);
  bar.style.display = hasTrip ? "flex" : "none";
  var inp = document.getElementById("trip-inline-search");
  if (bar._wired) {
    if (inp && _tripSearch.q != null && document.activeElement !== inp) inp.value = _tripSearch.q;
    _tripSearchSyncCounter();
    return;
  }
  bar._wired = true;
  var prev = document.getElementById("trip-inline-search-prev");
  var next = document.getElementById("trip-inline-search-next");
  var clr = document.getElementById("trip-inline-search-clear");
  if (inp) {
    inp.addEventListener("input", _tripSearchOnInput);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        _tripSearchGoTo((_tripSearch.idx < 0 ? 0 : _tripSearch.idx + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _tripSearchGoTo((_tripSearch.idx < 0 ? -1 : _tripSearch.idx - 1));
      } else if (e.key === "Escape") {
        inp.value = ""; _tripSearch.q = ""; _tripSearch.matches = []; _tripSearch.idx = -1;
        _tripSearchSyncCounter(); inp.blur();
      }
    });
  }
  if (prev) prev.onclick = function () { _tripSearchGoTo((_tripSearch.idx < 0 ? -1 : _tripSearch.idx - 1)); };
  if (next) next.onclick = function () { _tripSearchGoTo((_tripSearch.idx < 0 ? 0 : _tripSearch.idx + 1)); };
  if (clr) clr.onclick = function () {
    if (inp) inp.value = "";
    _tripSearch.q = ""; _tripSearch.matches = []; _tripSearch.idx = -1;
    _tripSearchSyncCounter();
    if (inp) inp.focus();
  };
}

// Back-compat: the menu/keyboard entry point now just reveals + focuses
// the inline bar instead of opening a modal. (The 🔍 menu buttons that
// called this were removed in PD.407; kept for any other callers.)
function openTripSearch() {
  var bar = document.getElementById("trip-inline-search-bar");
  if (bar) bar.style.display = "flex";
  var inp = document.getElementById("trip-inline-search");
  if (inp) { inp.focus(); try { inp.select(); } catch (_) {} }
}

// v353: keep the sync-related buttons in sync with sign-in state.
// Called from renderHomeScreen and from any flow that mutates the
// MaxSync session token (sign-in, sign-out). Cheap idempotent
// function — runs once per state change, mutates a few DOM nodes
// in place.
function updateSyncButtons() {
  var signedIn = (typeof MaxSync !== "undefined" &&
                  typeof MaxSync.isSignedIn === "function" &&
                  MaxSync.isSignedIn());
  var email = signedIn && typeof MaxSync.getEmail === "function"
    ? (MaxSync.getEmail() || "")
    : "";

  // (a) Home-screen sync pill (#hs-sync-btn).
  var hsBtn = document.getElementById("hs-sync-btn");
  if (hsBtn) {
    if (signedIn) {
      hsBtn.textContent = "✓ Signed in";
      hsBtn.style.color = "#2a7a4e";
      hsBtn.style.borderColor = "#cfe7d8";
      hsBtn.title = email ? ("Signed in as " + email) : "Signed in — tap to manage";
    } else {
      hsBtn.textContent = "Sign in";
      hsBtn.style.color = "#1a5fa8";
      hsBtn.style.borderColor = "#c8d8f0";
      hsBtn.title = "Sign in to share trips between devices";
    }
  }

  // (b) Trip-view header sync icon (#sync-btn). Stays as the ⇄
  // glyph; only the title changes since this is a tight icon spot.
  var tvBtn = document.getElementById("sync-btn");
  if (tvBtn) {
    tvBtn.title = signedIn
      ? (email ? "Signed in as " + email + " — tap to manage" : "Signed in — tap to manage")
      : "Sign in to sync";
    tvBtn.style.opacity = signedIn ? "1" : "0.6";
  }

  // (c) BYOK 🔑 button (#api-key-btn). With the proxy live (v345),
  // signed-in users don't need a personal Anthropic key. Hide the
  // button entirely when signed in; show it when not, since it's
  // the secondary path for users who'd rather use their own key.
  var akBtn = document.getElementById("api-key-btn");
  if (akBtn) {
    akBtn.style.display = signedIn ? "none" : "";
  }
}

function renderHomeScreen(){

  // PD.333 (audit B6): visible build stamp. Chrome and Safari each
  // keep their own service-worker cache, so two browsers can run
  // different builds against the same synced data for days — which
  // reads as "the app behaves differently in Chrome." The stamp
  // (derived from the ?v= cache-buster deploy.sh writes) makes the
  // running build checkable in one glance. "DEV" = local source.
  try {
    var _bsEl = document.getElementById("hs-build-stamp");
    if (!_bsEl) {
      var _hsRoot = g("home-screen");
      if (_hsRoot) {
        _bsEl = document.createElement("div");
        _bsEl.id = "hs-build-stamp";
        _bsEl.style.cssText = "position:absolute;bottom:6px;right:10px;font-size:9.5px;color:#bbb;font-family:monospace;";
        _hsRoot.appendChild(_bsEl);
      }
    }
    if (_bsEl) {
      var _bsScript = document.querySelector('script[src*="?v="]');
      var _bsStamp = _bsScript ? (_bsScript.getAttribute("src").split("?v=")[1] || "?") : "?";
      _bsEl.textContent = "build " + _bsStamp;
      _bsEl.title = "The build this browser is running. If two browsers show different numbers, hard-reload the older one.";
    }
  } catch(_){}

  // v345.1: hide the "API key needed" notice when the user is signed
  // in via MaxSync. Signed-in users get LLM access through the
  // server proxy — no personal Anthropic key needed.
  var kn=g("hs-key-notice");
  if (kn) {
    var signedIntoSync = (typeof MaxSync !== "undefined" &&
                          typeof MaxSync.isSignedIn === "function" &&
                          MaxSync.isSignedIn());
    kn.style.display = (_apiKey || signedIntoSync) ? "none" : "block";
  }
  // v353: context-aware sync button labels. Both the home-screen
  // pill and the trip-view header icon now reflect the actual state
  // (signed in vs signed out), and the BYOK 🔑 button is hidden
  // when signed in since the proxy means it's not needed.
  // v353.1: also wired up to MaxSync's max-sync-signedIn /
  // max-sync-signedOut window events (see listener at end of file)
  // so the buttons update on actual sign-in/out without polling.
  if (typeof updateSyncButtons === "function") updateSyncButtons();

  // Round DI: welcome card removed. Trip list and dashboard answer
  // "what do you want to do today?" by showing what the user already
  // has and what's on their radar. Bottom action row provides start /
  // browse / import affordances.
  var hw = g("hs-welcome"); if (hw) hw.style.display = "none";

  // Round DH: render the dashboard above the trip cards.
  if (typeof renderHomeDashboard === "function") renderHomeDashboard();

  // Hide the modal-style surfaces (still triggered from the action row)
  g("new-trip-form").style.display="none";
  var bc=g("browse-chat"); if(bc){ bc.style.display="none"; bc.innerHTML=""; }

  // Round DI: trip list shows immediately when there are trips, empty
  // state shows when there aren't.
  var hasTrips = _tripsIndex && _tripsIndex.length > 0;
  g("hs-trips-section").style.display = hasTrips ? "block" : "none";
  g("hs-empty").style.display = hasTrips ? "none" : "block";

  if(hasTrips){
    var lbl=g("ntp-lbl"); if(lbl) lbl.textContent="Name this trip";
    var cards=g("trip-cards"); cards.innerHTML="";
    // Round DI.2: show all trips; the .trip-cards container is
    // scrollable (max-height:280px;overflow-y:auto in CSS) so a long
    // list collapses naturally without a "show all" toggle.
    //
    // v353.2: sort chronologically — "what's happening soon" floats
    // to the top, past trips sink to the bottom. Specifically:
    //   1. In-progress trips first (start ≤ today ≤ end)
    //   2. Upcoming next, soonest first
    //   3. Untimed trips (no startDate yet — still being planned)
    //   4. Past, most recently completed first
    // Was just reverse() of save order, which surfaced "the trip I
    // most recently edited" instead of "the trip I'm about to take."
    var _todayIso = (function(){
      var d = new Date();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + dd;
    })();
    function _bucket(entry) {
      // 0=in-progress, 1=upcoming, 2=untimed, 3=past
      if (!entry.startDate) return 2;
      if (entry.endDate && entry.endDate < _todayIso) return 3;
      if (entry.startDate <= _todayIso && (!entry.endDate || _todayIso <= entry.endDate)) return 0;
      return 1;
    }
    _tripsIndex.slice().sort(function(a, b){
      var ba = _bucket(a), bb = _bucket(b);
      if (ba !== bb) return ba - bb;
      // Within a bucket:
      //   in-progress + upcoming + untimed → ascending by startDate
      //     (soonest first; untimed compares as "" which falls to end
      //      among themselves, doesn't matter)
      //   past → descending by endDate (most recent past first)
      if (ba === 3) {
        return (b.endDate || '').localeCompare(a.endDate || '');
      }
      return (a.startDate || '').localeCompare(b.startDate || '');
    }).forEach(function(entry){
      var card=document.createElement("div"); card.className="trip-card";
      var info=document.createElement("div"); info.style.cssText="flex:1;min-width:0;";
      // Round CK.2: countdown chip on the card if the trip is upcoming.
      // "In 3 days" / "Today!" / "In progress" / "Past" \u2014 at-a-glance status.
      var countdownChip = (function(){
        if (!entry.startDate || !entry.endDate) return null;
        try {
          // v322 fix: align "now" to noon so it matches start/end (which are
          // constructed at T12:00:00). Earlier this was midnight, which left a
          // 12-hour offset that bumped Math.round and made "tomorrow" show as
          // "In 2 days" — out of sync with the top trip card (which already
          // had the v309 fix).
          var now = new Date(); now.setHours(12,0,0,0);
          var start = new Date(entry.startDate + "T12:00:00");
          var end = new Date(entry.endDate + "T12:00:00");
          var msDay = 24 * 60 * 60 * 1000;
          var startDays = Math.round((start - now) / msDay);
          var endDays = Math.round((end - now) / msDay);
          var label, color, bg, border;
          if (startDays > 0) {
            label = "In " + startDays + (startDays === 1 ? " day" : " days");
            if (startDays <= 7) { color = "#b05820"; bg = "#fff5ed"; border = "#f3dcc4"; }
            else if (startDays <= 30) { color = "#1a5fa8"; bg = "#eef5ff"; border = "#cfe1f7"; }
            else { color = "#888"; bg = "#fafafa"; border = "#e6e2d8"; }
          } else if (startDays === 0) {
            label = "Today!"; color = "#b05820"; bg = "#fff5ed"; border = "#f3dcc4";
          } else if (endDays >= 0) {
            label = "In progress \u00b7 day " + (1 - startDays); color = "#2a7a4e"; bg = "#f0f8f4"; border = "#b8dfc9";
          } else {
            label = "Past"; color = "#aaa"; bg = "#fafafa"; border = "#e6e2d8";
          }
          var chip = document.createElement("span");
          chip.style.cssText = "display:inline-block;font-size:10px;font-weight:700;color:"+color+";background:"+bg+";border:1px solid "+border+";padding:2px 8px;border-radius:10px;margin-left:8px;vertical-align:middle;letter-spacing:.02em;";
          chip.textContent = label;
          return chip;
        } catch(_){ return null; }
      })();
      var name=document.createElement("div"); name.className="tc-name"; name.style.display="flex"; name.style.alignItems="center"; name.style.flexWrap="wrap";
      var nameTxt=document.createElement("span"); nameTxt.textContent=entry.name||"Untitled trip"; name.appendChild(nameTxt);
      if (countdownChip) name.appendChild(countdownChip);
      var meta=document.createElement("div"); meta.className="tc-meta";
      var parts=[]; if(entry.dateRange)parts.push(entry.dateRange);
      if(entry.destCount)parts.push(entry.destCount+" place"+(entry.destCount!==1?"s":""));
      meta.textContent=parts.join(" \u00b7 ");
      info.appendChild(name); info.appendChild(meta);

      // Round CK.2: flight info row \u2014 carrier + number + time for arrival
      // and departure. Only renders if at least one is set; reads from the
      // index entry (kept in sync by updateIndexEntry).
      if (entry.entryDetails || entry.exitDetails) {
        var flightRow = document.createElement("div");
        flightRow.style.cssText = "margin-top:6px;font-size:10.5px;color:#666;display:flex;flex-wrap:wrap;gap:12px;";
        function _flightLabel(details, prefix){
          if (!details) return "";
          var bits = [];
          var carrierNum = [details.carrier, details.number].filter(function(x){return !!x;}).join(" ");
          if (carrierNum) bits.push(carrierNum);
          if (details.time) bits.push(typeof _fmtTime12h === "function" ? _fmtTime12h(details.time) : details.time);
          if (!bits.length) return "";
          return '<span><strong style="color:var(--c-ink-3);font-weight:600;">' + prefix + ':</strong> ' + bits.join(" \u00b7 ") + '</span>';
        }
        var arrHtml = _flightLabel(entry.entryDetails, "Arrive");
        var depHtml = _flightLabel(entry.exitDetails, "Depart");
        if (arrHtml || depHtml) {
          flightRow.innerHTML = (arrHtml || "") + (depHtml || "");
          info.appendChild(flightRow);
        }
      }
      // v353.5: duplicate button (\ud83d\udccb) sits between info and delete.
      // Click \u2192 confirm inline \u2192 call duplicateTrip \u2192 new card slides
      // in at the top. Doesn't open the duplicate; the user can click
      // it to enter.
      var dup = document.createElement("button");
      dup.className = "tc-dup";
      // v353.5: text "Copy" instead of a glyph \u2014 \u29c9 falls back to a
      // hollow square in some font stacks (the user couldn't see it).
      // Plain text is universally readable and tells users what
      // happens before they click.
      dup.textContent = "Copy";
      dup.title = "Duplicate this trip";
      dup.style.cssText = "background:var(--c-bg);border:1px solid var(--c-border-blue);color:var(--c-primary);font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;font-family:inherit;border-radius:5px;margin-right:6px;";
      (function(id, c){
        dup.onclick = function(e){
          e.stopPropagation();
          if (c.querySelector(".tc-confirm")) return;
          var cf = document.createElement("div");
          cf.className = "tc-confirm";
          cf.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;padding:4px 0 2px;";
          var msg = document.createElement("span");
          msg.style.cssText = "font-size:11px;color:#666;flex:1;";
          msg.textContent = "Make a copy of \"" + (entry.name || "this trip") + "\"?";
          var yes = document.createElement("button");
          yes.style.cssText = "font-size:11px;padding:3px 10px;border:1px solid var(--c-primary);border-radius:4px;background:var(--c-primary);color:var(--c-on-dark);cursor:pointer;font-family:inherit;";
          yes.textContent = "Duplicate";
          var no = document.createElement("button");
          no.style.cssText = "font-size:11px;padding:3px 8px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-bg);color:#666;cursor:pointer;font-family:inherit;";
          no.textContent = "Cancel";
          yes.onclick = function(e2){
            e2.stopPropagation();
            c.parentNode.removeChild(c); // remove this card; re-render will show both
            duplicateTrip(id, false);
          };
          no.onclick = function(e2){
            e2.stopPropagation();
            c.removeChild(cf);
            info.style.display = "";
            dup.style.display = "";
            del.style.display = "";
          };
          cf.appendChild(msg); cf.appendChild(yes); cf.appendChild(no);
          info.style.display = "none"; dup.style.display = "none"; del.style.display = "none";
          c.appendChild(cf);
        };
      })(entry.id, card);
      var del=document.createElement("button"); del.className="tc-del"; del.textContent="\u2715";
      (function(id,c){del.onclick=function(e){
        e.stopPropagation();
        if(c.querySelector(".tc-confirm"))return;
        var cf=document.createElement("div"); cf.className="tc-confirm";
        cf.style.cssText="display:flex;align-items:center;gap:8px;width:100%;padding:4px 0 2px;";
        var msg=document.createElement("span"); msg.style.cssText="font-size:11px;color:#666;flex:1;";
        msg.textContent="Delete \""+(entry.name||"this trip")+"\"?";
        var yes=document.createElement("button"); yes.style.cssText="font-size:11px;padding:3px 10px;border:1px solid var(--c-danger);border-radius:4px;background:var(--c-danger);color:var(--c-on-dark);cursor:pointer;font-family:inherit;"; yes.textContent="Delete";
        var no=document.createElement("button"); no.style.cssText="font-size:11px;padding:3px 8px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-bg);color:#666;cursor:pointer;font-family:inherit;"; no.textContent="Cancel";
        yes.onclick=function(e2){
          e2.stopPropagation();
          // PD.253: if we're deleting the ACTIVE trip, clear _currentTripId
          // and global.trip BEFORE the delete + tombstone. Otherwise the
          // 1500ms autosave debounce (sync.js _doSave) fires after delete,
          // reads _currentTripId, serializes the still-in-memory trip,
          // PUTs to the server, gets 404, falls through to createTrip,
          // and resurrects the trip we just told to die. That's the
          // smoking-gun resurrection vector. _doSave bails at line 659
          // when _currentTripId is null.
          if (id === _currentTripId) {
            try { if (typeof _saveTimer !== "undefined" && _saveTimer) clearTimeout(_saveTimer); } catch(_){}
            _currentTripId = null;
            try { trip = null; } catch(_){}
          }
          _tripsIndex=_tripsIndex.filter(function(t){return t.id!==id;});
          saveTripsIndex();
          // PD.250: route through MaxDB.trip.delete so the trip is cleared
          // from BOTH localStorage AND IndexedDB. The old raw
          // localStorage.removeItem left the IDB copy intact;
          // hydrateTripIdbMirror() on next page load resurrected the
          // trip in _tripIdbMirrorRaw, and tripReadRaw returned it from
          // there, so deleted trips reappeared after a hard refresh.
          if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.delete === "function") {
            try { MaxDB.trip.delete(id); } catch(ex){
              try{ localStorage.removeItem("max-trip-"+id); }catch(_){}
            }
          } else {
            try{ localStorage.removeItem("max-trip-"+id); }catch(ex){}
          }
          // PD.197: tombstone unconditionally — even offline / signed
          // out / before MaxSync.deleteTrip runs. The next pullAll
          // checks the tombstone and skips resurrection (and retries
          // the server delete). If signed in, also fire the explicit
          // delete now so the round trip happens immediately.
          if (typeof MaxSync !== "undefined" &&
              typeof MaxSync.markDeletedLocally === "function") {
            try { MaxSync.markDeletedLocally(id); } catch(_){}
          }
          if (typeof MaxSync !== "undefined" &&
              typeof MaxSync.isSignedIn === "function" &&
              MaxSync.isSignedIn() &&
              typeof MaxSync.deleteTrip === "function") {
            MaxSync.deleteTrip(id).catch(function (err) {
              console.warn("[Max] server delete failed for trip", id, err);
            });
          }
          c.parentNode.removeChild(c);
          // Regenerate the option list so "Pick up where you left off" is removed if no trips remain
          if(typeof renderHomeOptions === "function") renderHomeOptions();
          if(_tripsIndex.length===0){
            // Round DI: no trips left → show empty state, hide list
            var ts = g("hs-trips-section"); if(ts) ts.style.display="none";
            var em = g("hs-empty"); if(em) em.style.display="block";
            var lbl=g("ntp-lbl"); if(lbl) lbl.textContent="Start your first trip";
            // If the dashboard is showing, refresh — there may be no
            // current trip anymore.
            if (typeof renderHomeDashboard === "function") renderHomeDashboard();
          }
        };
        no.onclick=function(e2){e2.stopPropagation();c.removeChild(cf);};
        cf.appendChild(msg); cf.appendChild(yes); cf.appendChild(no);
        // Replace card content with confirm row
        info.style.display="none"; del.style.display="none";
        c.appendChild(cf);
      };})(entry.id,card);
      card.appendChild(info); card.appendChild(dup); card.appendChild(del);
      (function(id){card.onclick=function(e){if(e.target===del||e.target===dup)return;selectTrip(id);};})(entry.id);
      cards.appendChild(card);

      // ── v356.3: pre-trip pending-actions banner ──────────────
      // For trips departing within 14 days with at least one
      // pending-actions item, render a small amber banner under
      // the card. Quiet style — the dashboard is the loud surface;
      // this just nudges users who haven't opened a specific trip
      // recently. Click jumps into the trip. Wrapped in try/catch
      // so a malformed local trip body never breaks the home list.
      try {
        if (typeof computePendingActions === "function") {
          var _bTrip = _readTripById(entry.id);
          if (_bTrip) {
            var pa = computePendingActions(_bTrip, new Date());
            if (pa && pa.daysUntilDeparture !== null
                  && pa.daysUntilDeparture >= 0
                  && pa.daysUntilDeparture <= 14
                  && pa.items && pa.items.length > 0) {
              var banner = document.createElement("div");
              banner.style.cssText =
                "background:#fff5ed;border:1px solid #f3dcc4;color:#7a3f10;" +
                "border-radius:8px;padding:8px 12px;margin:6px 0 12px;" +
                "font-size:12px;line-height:1.45;cursor:pointer;" +
                "display:flex;align-items:center;gap:10px;";
              var dN = pa.daysUntilDeparture;
              var depTxt = dN === 0 ? "Departing TODAY"
                          : dN === 1 ? "Departing tomorrow"
                          : "Departing in " + dN + " days";
              var kN = pa.items.length;
              var todoTxt = kN + " thing" + (kN === 1 ? "" : "s") + " to do";
              banner.innerHTML =
                '<span style="font-weight:700;">' + depTxt + '</span>' +
                '<span style="color:#a05a25;">· ' + todoTxt + '</span>' +
                '<span style="margin-left:auto;color:#a05a25;font-size:11px;">' +
                'click to see ›</span>';
              (function(id){
                banner.onclick = function(e){
                  e.stopPropagation();
                  if (typeof selectTrip === "function") selectTrip(id);
                };
              })(entry.id);
              cards.appendChild(banner);
            }
          }
        }
      } catch (_bErr) {
        // Non-fatal — banner is opportunistic.
      }
    });
  }
}

function renderHomeOptions(){
  var opts = g("hs-options");
  if(!opts) return;
  var hasTrips = _tripsIndex && _tripsIndex.length > 0;
  var options = [];
  options.push({id:"new",    label:"Start something new",                  sub:"A trip that is still a sentence in your head"});
  if(hasTrips){
    options.push({id:"resume", label:"Pick up where you left off",          sub:"Continue working on one of your trips"});
  }
  options.push({id:"import", label:"Load a trip from a file",              sub:"Import a saved Max trip file"});
  options.push({id:"browse", label:"Or just browse — I’m not planning yet", sub:"Look at places, dream a little, no commitment"});

  opts.innerHTML = options.map(function(o){
    return '<div class="hs-option" data-id="'+o.id+'" onclick="selectHomeOption(\''+o.id+'\')" style="padding:11px 14px;border:1px solid #e0e0e0;border-radius:8px;margin-bottom:6px;cursor:pointer;background:var(--c-bg);transition:all 0.12s;">'
      + '<div style="font-size:13px;font-weight:600;color:var(--c-ink);margin-bottom:2px;">'+o.label+'</div>'
      + '<div style="font-size:11px;color:var(--c-ink-3);">'+o.sub+'</div>'
      + '</div>';
  }).join("");
}

// v359.60.22: paste-a-list importer. Parses a user's research-style
// text block (numbered sections, bullets, sub-headers, parentheticals)
// into a structured list of destinations. Used by two surfaces:
// (1) the home screen "Paste a list" entry that mints a fresh trip,
// (2) the Research notes modal's "Make destinations from this list"
// button that appends to the current trip.
//
// Format the parser understands (best-effort, forgiving):
//   • Section header `N. <title>` — keyword sniff on <title> sets
//     stay/see mode for everything beneath until the next header.
//       "overnight|hub|stay|base|lodging"        → stay (default 1 night)
//       "landmark|sight|see|stop|waterfall|poi"  → see  (0 nights)
//   • Sub-header (line ending with ":", no bullet) — ignored.
//   • Bullet items (lines starting with *, -, •, ▪, ◦, +) — entries.
//   • Plain non-header lines after a section header — also entries.
//   • Parentheticals on an entry — captured as dest.intent.
//   • "(Arrival/Departure point)" auto-wires both trip.brief.entry
//     AND trip.brief.tbExit to that place (round trip).
//     "(Arrival point)" / "(Entry)" → entry only.
//     "(Departure point)" / "(Exit)" → exit only.
//   • Trailing `<N> nights?` or just `<N>` on an entry → nights override.
//   • Trailing "stay" or "see" tag → mode override for that entry.
//   • "A / B" alias on a place — the shorter half wins
//     ("Lake Mývatn / Mývatn" → "Mývatn").
//   • Lines starting with "#" or blank → ignored.
//
// Returns:
//   { destinations: [{place, nights, isStay, intent}], entry, exit,
//     warnings: [string] }
function parsePlacesList(text) {
  var out = { destinations: [], entry: null, exit: null, tripName: null, region: null, startDate: null, when: null, duration: null, warnings: [] };
  if (!text || typeof text !== "string") return out;
  var lines = text.split(/\r?\n/);
  var mode = "stay"; // default before we see a section header
  var seenAnyHeader = false;

  function classifyHeader(headerText) {
    var h = String(headerText || "").toLowerCase();
    // v359.60.23 bugfix: keywords need optional trailing "s" to match
    // the way users actually write section titles. "Specific Landmarks,
    // Waterfalls, and Points of Interest" never matched landmark|
    // waterfall|point because `\b...\b` required a word boundary
    // immediately after, and the trailing "s" defeated it. Result: every
    // line in that section parsed as stay (default mode) instead of see.
    if (/\b(overnight|hub|stay|base|lodging|sleep|hotel|accommodation)s?\b/.test(h)) return "stay";
    if (/\b(landmark|sight|see|stop|waterfall|point|poi|attraction|along the way)s?\b/.test(h)) return "see";
    return null; // unknown — keep current mode
  }

  // v359.60.23: first non-blank, non-bullet, non-section-header,
  // non-sub-header line is the trip name (and region hint). Format:
  //   "Iceland Road Trip 2026"            → tripName = whole line
  //                                          region = whole line (LLM
  //                                          interprets it)
  //   "Iceland Road Trip 2026 (Iceland)"  → tripName = whole line
  //                                          region = "Iceland"
  // The region is used as trip.brief.region and is what the picker
  // candidate-generation LLM gets as its scope constraint. Explicit
  // parenthetical takes precedence over the inferred whole-line.
  var firstLineIdx = -1;
  for (var fi = 0; fi < lines.length; fi++) {
    var fl = lines[fi].replace(/\s+$/g, "").replace(/^\s+/, "");
    if (!fl) continue;
    if (/^#/.test(fl)) continue;
    // Section header `N. <title>` — skip
    if (/^\d+\.\s+/.test(fl) && !/^[\*\-•▪◦+]/.test(fl)) continue;
    // Sub-header (ends with ":", no bullet) — skip
    if (/:$/.test(fl) && !/^[\*\-•▪◦+]/.test(fl)) {
      // PD.218: if the sub-header is a stay/see mode signal (the
      // PD.215 path that makes "stays:" / "sees:" meaningful), the
      // user is diving directly into destinations — there's no trip
      // name above. Bail out so the body loop starts from the top
      // and "Selfoss, Iceland" parses as a destination, not the
      // trip name. Without this, Neal's list (which started with
      // "stays:" then a destination) lost the first destination
      // line to the trip name claimer.
      if (classifyHeader(fl.replace(/:$/, ""))) break;
      continue;
    }
    // Bullet — skip
    if (/^[\*\-•▪◦+]/.test(fl)) continue;
    // Found the first "free" line — this is the trip name.
    firstLineIdx = fi;
    var rawName = fl.trim();
    var nameParen = rawName.match(/\(([^)]+)\)\s*$/);
    if (nameParen) {
      out.region = nameParen[1].trim();
      out.tripName = rawName.replace(/\s*\([^)]+\)\s*$/, "").trim();
    } else {
      out.tripName = rawName;
      // Region defaults to the trip name with the trailing year
      // (4-digit) stripped — "Iceland Road Trip 2026" → "Iceland Road Trip".
      out.region = rawName.replace(/\s+(19|20)\d{2}\s*$/, "").trim();
    }
    break;
  }

  // v359.60.23: optional frontmatter block between the trip-name
  // line and the first section header / bullet. Lines of the form
  // `Key: value` populate fields on the parse result. Recognized
  // keys (case-insensitive):
  //   Start / Starts / From  → out.startDate (ISO YYYY-MM-DD only;
  //                            free-text falls through to .when)
  //   When                   → out.when     (free-text)
  //   Duration               → out.duration (free-text)
  //   Dates                  → both .startDate (if ISO leading) AND
  //                            .when (full text, for context)
  // First non-frontmatter line ends the block. Frontmatter is
  // entirely optional — old paste lists still parse fine.
  var bodyStartIdx = (firstLineIdx >= 0) ? firstLineIdx + 1 : 0;
  for (var fi2 = bodyStartIdx; fi2 < lines.length; fi2++) {
    var fl2 = lines[fi2].replace(/\s+$/g, "").replace(/^\s+/, "");
    if (!fl2) { bodyStartIdx = fi2 + 1; continue; }
    if (/^#/.test(fl2)) { bodyStartIdx = fi2 + 1; continue; }
    var kv = fl2.match(/^([A-Za-z][A-Za-z _-]{0,20})\s*:\s*(.+)$/);
    if (!kv) break; // first non-frontmatter line — stop scanning
    // Sub-headers like "Golden Circle Area:" have NO value after `:`,
    // so the regex above won't match them (it requires `.+` after).
    // But a bare "key: " with empty value would slip through; skip
    // those too.
    var key   = kv[1].toLowerCase().replace(/[\s_-]/g, "");
    var value = kv[2].trim();
    if (!value) break;
    // Don't mistake a section header like "Day 2: Sights" for
    // frontmatter — keys with digits aren't frontmatter.
    if (/\d/.test(kv[1])) break;
    if (key === "start" || key === "starts" || key === "from") {
      var isoStart = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoStart) out.startDate = isoStart[0];
      else out.when = out.when || value;
    } else if (key === "when") {
      out.when = value;
    } else if (key === "duration") {
      out.duration = value;
    } else if (key === "dates") {
      // Try to pull an ISO date out of the front; whole string also
      // captured into .when for context.
      var isoIn = value.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoIn) out.startDate = isoIn[0];
      out.when = out.when || value;
    } else if (key === "end" || key === "ends" || key === "to" || key === "until") {
      // Recognized but not stored separately — trip end is derived
      // from start + total nights. Skip silently so we don't bail
      // out of the frontmatter block.
    } else {
      // Unknown key — stop scanning so we don't accidentally swallow
      // a real destination line that happens to look like Key: Value
      // (e.g. "Höfn: gateway to glacier lagoon").
      break;
    }
    bodyStartIdx = fi2 + 1;
    continue;
  }
  // v359.60.23: natural-language date/duration line. The user said
  // "Start: 2026-08-01" + "Duration: 14 days" was redundant — and
  // also stiff. Allow a free-text frontmatter line like
  //   September 17, 17 nights
  //   Aug 1 for 2 weeks
  //   2026-08-01, 14 days
  // We extract both a date (Month Day [Year] or ISO) AND a
  // "N nights|days|weeks" duration. Anything left over that's not
  // either of those terminates the frontmatter scan (so a real
  // destination line that happens to have a number doesn't get
  // swallowed). Year for bare "September 17" defaults to the year
  // in the trip name ("Iceland Road Trip 2026" → 2026), else
  // current year.
  for (var fi3 = bodyStartIdx; fi3 < lines.length; fi3++) {
    var fl3 = lines[fi3].replace(/\s+$/g, "").replace(/^\s+/, "");
    if (!fl3) { bodyStartIdx = fi3 + 1; continue; }
    if (/^#/.test(fl3)) { bodyStartIdx = fi3 + 1; continue; }
    // Section headers / sub-headers / bullets are body — stop here.
    if (/^\d+\.\s+/.test(fl3) && !/^[\*\-•▪◦+]/.test(fl3)) break;
    if (/:$/.test(fl3) && !/^[\*\-•▪◦+]/.test(fl3)) break;
    if (/^[\*\-•▪◦+]/.test(fl3)) break;
    // Try to pull a date and/or a duration out of this line.
    var beforeS = out.startDate;
    var beforeD = out.duration;
    // Duration first — "N nights|days|weeks" anywhere in the line.
    var durMatch = fl3.match(/(\d+)\s*(nights?|days?|weeks?)\b/i);
    if (durMatch && !out.duration) {
      var dn = parseInt(durMatch[1], 10);
      var unit = durMatch[2].toLowerCase().replace(/s$/, "");
      out.duration = dn + " " + unit + (dn === 1 ? "" : "s");
    }
    if (!out.startDate) {
      var isoM = fl3.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoM) {
        out.startDate = isoM[0];
      } else {
        var monthsRe = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
        var monthRegex = new RegExp("\\b(" + monthsRe + ")[a-z]*\\.?\\s+(\\d{1,2})(?:(?:[\\s,]+)(\\d{4}))?", "i");
        var mm = fl3.match(monthRegex);
        if (mm) {
          var yearHint = ((out.tripName || "").match(/\b(20\d{2})\b/) || [])[1];
          var yyyy = mm[3] ? parseInt(mm[3], 10) : (yearHint ? parseInt(yearHint, 10) : new Date().getFullYear());
          var ts = Date.parse(mm[1] + " " + mm[2] + " " + yyyy);
          if (!isNaN(ts)) {
            out.startDate = new Date(ts).toISOString().slice(0, 10);
          }
        }
      }
    }
    if (out.startDate !== beforeS || out.duration !== beforeD) {
      bodyStartIdx = fi3 + 1;
      continue;
    }
    // Line didn't yield a date or a duration — end frontmatter.
    break;
  }

  // v359.60.23: if Start was provided but When wasn't, auto-derive
  // a humane When ("August 2026") from the start date — it's what
  // the LLM uses for rough-timing context and the user shouldn't
  // have to write it twice.
  if (out.startDate && !out.when) {
    try {
      var _sd = new Date(out.startDate + "T12:00:00");
      if (!isNaN(_sd.getTime())) {
        out.when = _sd.toLocaleString("en-US", { month: "long" }) + " " + _sd.getFullYear();
      }
    } catch(_){}
  }

  for (var li = bodyStartIdx; li < lines.length; li++) {
    var raw = lines[li];
    var trimmed = raw.replace(/\s+$/g, "").replace(/^\s+/, "");
    if (!trimmed) continue;
    if (/^#/.test(trimmed)) continue; // comment

    // Section header: starts with "N." optionally followed by space + title.
    // Must NOT be a bullet line (some lists use "1." for ordered items).
    var sectionMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (sectionMatch && !/^[\*\-•▪◦+]/.test(trimmed)) {
      var inferred = classifyHeader(sectionMatch[2]);
      if (inferred) { mode = inferred; seenAnyHeader = true; continue; }
      // Numbered line but no mode keyword — treat as an entry below.
    }

    // Sub-header: ends with ":" and not a bullet. Used to GROUP entries
    // ("Golden Circle Area:", "South Coast / Southeast Region:") but
    // not destinations themselves.
    //
    // PD.215: ALSO accept sub-headers with stay/see keywords as mode
    // signals ("overnight list:", "sights:", "things to see:"). Before
    // PD.215, "overnight list:" was skipped entirely and the default
    // mode "stay" silently applied — same outcome, but no signal of
    // explicit user intent. Now classifyHeader runs on the sub-header
    // too; if it matches, mode is updated AND seenAnyHeader flips true,
    // which the classifier uses to know the user actually said so
    // (vs. parser default). Non-mode sub-headers like "Golden Circle
    // Area:" still match nothing and pass through unchanged.
    if (/:$/.test(trimmed) && !/^[\*\-•▪◦+]/.test(trimmed)) {
      var _subInferred = classifyHeader(trimmed.replace(/:$/, ""));
      if (_subInferred) {
        mode = _subInferred;
        seenAnyHeader = true;
      }
      continue;
    }

    // Entry: strip bullet marker if present.
    var item = trimmed.replace(/^[\*\-•▪◦+]\s*/, "").trim();
    if (!item) continue;

    // Optional trailing tag "stay" or "see" — case-insensitive, with
    // optional surrounding whitespace.
    var thisMode = mode;
    var tagMatch = item.match(/[\s,;]+(stay|see)\s*$/i);
    if (tagMatch) {
      thisMode = tagMatch[1].toLowerCase();
      item = item.slice(0, tagMatch.index).trim();
    }

    // Optional trailing nights — "Reykjavik 3" / "Reykjavik 3 nights".
    var nights = (thisMode === "see") ? 0 : 1;
    var nightsExplicit = false;
    var nightsMatch = item.match(/[\s,;]+(\d+)\s*(nights?|nts?|nt)?\s*$/i);
    if (nightsMatch) {
      nights = parseInt(nightsMatch[1], 10);
      nightsExplicit = true;
      item = item.slice(0, nightsMatch.index).trim();
      // If nights = 0 and no explicit tag, infer see.
      if (nights === 0 && !tagMatch) thisMode = "see";
      // If nights > 0 and no explicit tag, treat as stay.
      if (nights > 0 && !tagMatch) thisMode = "stay";
    }

    // Capture FIRST parenthetical as intent. "(Arrival/Departure point)"
    // is the round-trip flag — recognize before stripping.
    var intent = null;
    var parenMatch = item.match(/\(([^)]*)\)/);
    if (parenMatch) {
      intent = parenMatch[1].trim();
      item = item.replace(/\s*\([^)]*\)\s*/, " ").trim();
    }

    // Place-alias "A / B" — keep the shorter half (handles
    // "Lake Mývatn / Mývatn" → "Mývatn"). Skip if either half is
    // empty after split.
    if (item.indexOf("/") >= 0) {
      var parts = item.split("/").map(function(s){ return s.trim(); }).filter(Boolean);
      if (parts.length >= 2) {
        parts.sort(function(a,b){ return a.length - b.length; });
        item = parts[0];
      }
    }

    if (!item) continue;

    // Round-trip / entry / exit auto-wire from the parenthetical.
    // PD.436: require an EXPLICIT travel directive. The old test fired on bare
    // "start/begin/end/finish", which appear descriptively ("east end of the
    // ring road", "finish the loop") and wrongly promoted a sight to the
    // arrival/departure gateway. Keep only travel-intent words.
    if (intent) {
      var iLower = intent.toLowerCase();
      var hasArrival   = /\b(arrival|arrive|arriving|entry|fly in|flying in)\b/.test(iLower);
      var hasDeparture = /\b(departure|depart|departing|exit|fly out|flying out)\b/.test(iLower);
      if (hasArrival && !out.entry) out.entry = item;
      if (hasDeparture && !out.exit) out.exit = item;
    }

    // PD.83a (architectural): split "Place, Country" at parse time so
    // downstream consumers get a clean city name in .place and an
    // optional .country hint. Replaces PD.74b, which was splitting
    // on lookup at the role-application site (a patch — the parser
    // is the right place to canonicalize). User-typed
    // "Egilsstaðir, Iceland" -> place="Egilsstaðir", country="Iceland".
    var _pc = String(item).split(/\s*,\s*/);
    var _placeOnly = _pc[0].trim();
    var _countryOnly = (_pc.length > 1) ? _pc.slice(1).join(", ").trim() : "";
    out.destinations.push({
      place: _placeOnly,
      country: _countryOnly,
      nights: nights,
      isStay: thisMode === "stay",
      intent: intent,
      // PD.215: was the mode for this entry set EXPLICITLY by the user
      // (via section header, sub-header, or trailing tag), or is it
      // the parser's default-stay fallback? The classifier reads
      // _userIntent to decide whether to respect the parser's
      // stay/see assignment or override it. A trailing tag always
      // wins (tagMatch); otherwise we trust any header that was seen
      // before this line.
      _userIntent: (tagMatch ? thisMode : (seenAnyHeader ? mode : null))
    });
  }
  // v359.60.23: if nights per destination are all present and the
  // user didn't explicitly set Duration, derive it from the total.
  // Same shape as the Start→When auto-derive earlier — avoids the
  // user having to write a number that's already implicit from
  // their list. Falls back to nothing if no destinations carry
  // explicit nights (so the LLM still gets a free-text hint from
  // a manually-typed Duration in that case).
  if (!out.duration && out.destinations.length) {
    var totalNights = 0;
    var anyExplicitStay = false;
    out.destinations.forEach(function(d){
      var n = d.nights || 0;
      totalNights += n;
      if (d.isStay && n > 0) anyExplicitStay = true;
    });
    if (anyExplicitStay && totalNights > 0) {
      out.duration = totalNights + " night" + (totalNights === 1 ? "" : "s");
    }
  }

  return out;
}
if (typeof globalThis !== "undefined") globalThis.parsePlacesList = parsePlacesList;

// v359.60.22 (rev v359.60.23): mint a fresh trip from a parsed
// paste-list result and enter the trip view. The paste flow is a
// power-user shortcut that bypasses the picker entirely — the user
// already has their list, so we skip discovery and go straight to a
// populated trip. (Earlier rev .23 routed through Research notes
// first for a review beat; reverted on Neal's request — pasting is
// already deliberate enough, the extra click was friction.)
//
// Date handling: start = parseResult.startDate (from frontmatter
// `Start:` or a natural-language date line); else opts.startDate;
// else today. dateFrom/dateTo cascade by accumulated nights.
// 0-night entries occupy a single day (dateFrom === dateTo).

// v359.60.55: shared region normalizer used by every paste/file
// import path. The parser's raw region carries trip-name noise
// ("Iceland Road Trip", "Patagonia Adventure 2028") because it's
// derived from the first line minus the year. Both the picker LLM
// prompt AND Nominatim queries downstream want the canonical
// country/region — "Iceland", "Patagonia" — so the prompt isn't
// nonsensical and Nominatim's region scope doesn't kill matches.
//
// Strategy, in order:
//   1. If the raw lower-cased region is itself a known _coarseGeocode
//      key, use it as-is (already a known country/area).
//   2. Else try each whitespace-split token against _coarseGeocode —
//      "Iceland Road Trip" → "iceland" hits.
//   3. Else scan all _coarseGeocode keys for any that appears as a
//      substring of the raw — handles multi-word countries
//      ("New Zealand Vacation" → "new zealand" hits).
//   4. Else strip common trip-noise tokens (Road Trip, Vacation,
//      Adventure, Holiday, Tour, Getaway, Journey) and any 4-digit
//      year — falls back to a cleaner phrase like "Patagonia" from
//      "Patagonia Adventure 2028". This handles regions Max doesn't
//      have hard-coded in _coarseGeocode.
//   5. Else return the raw value (last resort).
function _normalizeImportedRegion(rawRegion) {
  if (!rawRegion) return "";
  var rk = String(rawRegion).toLowerCase().trim();
  if (!rk) return "";
  if (typeof _coarseGeocode !== "undefined" && _coarseGeocode[rk]) {
    return _titleCaseHelper(rk);
  }
  if (typeof _coarseGeocode !== "undefined") {
    var tokens = rk.split(/[\s,()/\-]+/).filter(Boolean);
    for (var ti = 0; ti < tokens.length; ti++) {
      if (_coarseGeocode[tokens[ti]]) return _titleCaseHelper(tokens[ti]);
    }
    var keys = Object.keys(_coarseGeocode);
    for (var ki = 0; ki < keys.length; ki++) {
      if (rk.indexOf(keys[ki]) >= 0) return _titleCaseHelper(keys[ki]);
    }
  }
  // No coarse-geocode match — strip trip-noise tokens and years.
  var stripped = rk
    .replace(/\b(road\s*trip|vacation|adventure|holiday|getaway|journey|tour|expedition|trek|escape)\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped !== rk) return _titleCaseHelper(stripped);
  return String(rawRegion);
}
function _titleCaseHelper(s) {
  return String(s || "").replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}
if (typeof globalThis !== "undefined") {
  globalThis._normalizeImportedRegion = _normalizeImportedRegion;
}

function _buildTripFromPastedList(parseResult, opts) {
  opts = opts || {};
  if (!parseResult || !Array.isArray(parseResult.destinations) || !parseResult.destinations.length) return null;
  // PD.297: mint a fresh trip slot. See _buildPickerFromPastedList
  // for the full diagnosis; same architectural fix.
  _currentTripId = null;
  activeDest = null;
  _fileHandle = null;
  var startStr = parseResult.startDate || opts.startDate || new Date().toISOString().slice(0, 10);
  var cur = new Date(startStr + "T12:00:00");
  destCtr = 0;
  sidCtr = 100;
  bkCtr = 0;
  var dests = parseResult.destinations.map(function(p, i) {
    destCtr++;
    var id = "d" + destCtr;
    var dateFromStr = cur.toISOString().slice(0, 10);
    var nx = new Date(cur); nx.setDate(nx.getDate() + (p.nights || 0));
    var dateToStr = nx.toISOString().slice(0, 10);
    var days = (typeof makeDays === "function")
      ? makeDays(id, p.place, p.intent || p.place, dateFromStr, p.nights || 0)
      : [];
    cur = nx;
    return {
      id: id,
      place: p.place,
      intent: p.intent || p.place,
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      nights: p.nights || 0,
      days: days,
      trackerItems: { booked: [], see: [], visited: [] },
      trackerCat: "booked",
      storyState: "idle",
      hotelBookings: [],
      generalBookings: [],
      locations: [],
      execMode: false,
      todayItems: [],
      discoveredItems: [],
      suggestions: []
    };
  });
  var name = parseResult.tripName || opts.name || ("Imported — " + new Date().toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}));
  trip = {
    name: name,
    destinations: dests,
    legs: {},
    trackSpending: false,
    pendingActions: [],
    brief: {
      // v359.60.23: also propagate region / when / duration from the
      // parse so the picker LLM gets scope context if the user later
      // expands the trip via "Add destinations" or rebuild.
      // v359.60.55: normalize via shared helper so the brief gets a
      // canonical region ("Iceland", "Patagonia") rather than the raw
      // "Iceland Road Trip 2026" parser output that breaks downstream
      // LLM prompts and Nominatim queries.
      region:   _normalizeImportedRegion(parseResult.region),
      when:     parseResult.when     || "",
      duration: parseResult.duration || "",
      entry: parseResult.entry || "",
      tbExit: parseResult.exit || "",
      exitBuffer: true
    }
  };
  activeDest = null;
  _currentTripId = "trip-" + Date.now();
  _fileHandle = null;
  // PD.333 (audit C7/A2): one id, one key — the body carries the id
  // it will be stored under; TripStore anchors to THIS trip object.
  trip.id = _currentTripId;
  if (typeof TripStore !== "undefined" && typeof TripStore.replace === "function") {
    try { TripStore.replace(trip); trip = TripStore.trip; } catch(_){}
  }
  // v359.60.23: initialize _tb so a later picker re-entry / Research
  // notes button on this trip doesn't bail out on `if (!_tb) return
  // null` (the same gate that broke the stub-trip flow). Mirror the
  // trip's brief fields onto _tb so the picker brief renders with
  // the right region / name on re-open.
  if (typeof _tb === "undefined" || !_tb) {
    window._tb = _tb = _tbInstall({});
  }
  _tb.name      = name;
  _tb.region    = parseResult.region || "";
  _tb.placeName = parseResult.region || "";
  if (parseResult.when)     _tb.when     = parseResult.when;
  if (parseResult.duration) _tb.duration = parseResult.duration;
  if (!_tb.tripMeta) _tb.tripMeta = { notes: "", links: [] };
  if (!_tb.interests) _tb.interests = [];
  if (!_tb.drivers)   _tb.drivers   = [];
  if (!_tb.tripMode)  _tb.tripMode  = "place";
  if (_tb.entryBuffer === undefined) _tb.entryBuffer = false;
  if (_tb.exitBuffer  === undefined) _tb.exitBuffer  = false;
  // PD.327: single mutator (dedup by id). Was raw _tripsIndex.push.
  _upsertTripIndexEntry({
    id: _currentTripId,
    name: trip.name,
    dateRange: dests[0].dateFrom + " – " + dests[dests.length-1].dateTo,
    destCount: dests.length,
    startDate: dests[0].dateFrom,
    endDate: dests[dests.length-1].dateTo,
    savedAt: new Date().toISOString()
  });
  if (typeof localSave === "function") localSave();
  // PD.325: route bulk enrichment through MaxEnrich queue instead of
  // parallel forEach. Was: dests.forEach(generateCityData) → 46 LLM
  // calls fired in parallel → Anthropic rate-limit → most fail → empty
  // suggestions persisted. Now: serialized, throttled, retried.
  // brief.region is already set above so the Nominatim query in
  // generateCityData scopes correctly (no more rogue France pin for
  // "Selfoss" etc.).
  if (typeof MaxEnrich !== "undefined" && typeof generateCityData === "function") {
    MaxEnrich.enqueueAll(dests);
  } else if (typeof generateCityData === "function") {
    // Fallback if MaxEnrich didn't load (older builds).
    dests.forEach(function(d) { try { generateCityData(d.place, d.id); } catch(_){} });
  }
  if (typeof enterApp === "function") enterApp();
  return { tripId: _currentTripId, destCount: dests.length };
}
if (typeof globalThis !== "undefined") globalThis._buildTripFromPastedList = _buildTripFromPastedList;

// v359.60.23: research-first variant. Mints a STUB trip (no
// destinations yet), drops the raw pasted text into trip.brief.tripMeta.notes
// so the user can review it in the Research notes modal, and auto-opens
// that modal on the trip view. The user then clicks "🪄 Make destinations
// from this list" inside the modal to commit. This replaces the
// build-immediately path for the home-screen Paste flow so imports get
// an editing pass before they alter the trip.
function _buildStubTripFromPastedList(parseResult, rawText, opts) {
  opts = opts || {};
  if (!parseResult) return null;
  // PD.297: same fix as _buildPickerFromPastedList — null out the
  // current trip pointer so this paste mints its own slot instead of
  // overwriting the previously-active trip's storage on next save.
  _currentTripId = null;
  activeDest = null;
  _fileHandle = null;
  destCtr = 0;
  sidCtr = 100;
  bkCtr = 0;
  var name = parseResult.tripName || opts.name
    || ("Imported — " + new Date().toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}));
  trip = {
    name: name,
    destinations: [],
    legs: {},
    trackSpending: false,
    pendingActions: [],
    brief: {
      // v359.60.55: normalize via shared helper (same fix as
      // _buildTripFromPastedList — was carrying raw "Iceland Road
      // Trip" into trip.brief.region, breaking downstream Nominatim
      // scoping).
      region:   _normalizeImportedRegion(parseResult.region),
      entry:    parseResult.entry  || "",
      tbExit:   parseResult.exit   || "",
      exitBuffer: true,
      // v359.60.23: frontmatter from the paste — `When`/`Duration`
      // land directly on the brief; `Start` (ISO date) is stashed
      // separately so the cascade in _addPastedListToCurrentTrip
      // can use it as origin.
      when:     parseResult.when     || "",
      duration: parseResult.duration || "",
      _pendingStartDate: parseResult.startDate || null,
      tripMeta: { notes: rawText || "", links: [] }
    }
  };
  activeDest = null;
  _currentTripId = "trip-" + Date.now();
  _fileHandle = null;
  // PD.333 (audit C7/A2): one id, one key; anchor TripStore.
  trip.id = _currentTripId;
  if (typeof TripStore !== "undefined" && typeof TripStore.replace === "function") {
    try { TripStore.replace(trip); trip = TripStore.trip; } catch(_){}
  }
  // v359.60.23: initialize _tb (the picker's in-flight brief state)
  // so the Research-notes modal helpers can find tripMeta. Without
  // this, _pmTripMeta returns null (it gates on `if (!_tb) return
  // null;`) and _pmOpenTripResearchCard silently early-exits —
  // which is why the auto-open landed the user on the bare trip
  // view instead of the modal.
  if (typeof _tb === "undefined" || !_tb) {
    window._tb = _tb = _tbInstall({});
  }
  _tb.name      = name;
  _tb.region    = parseResult.region || "";
  _tb.placeName = parseResult.region || "";
  _tb.tripMeta  = { notes: rawText || "", links: [] };
  // Initialize fields the picker UI expects so it doesn't trip on
  // re-entry. These default to the same values renderTripStep1Place
  // would set on a fresh brief.
  if (!_tb.interests)    _tb.interests = [];
  if (!_tb.drivers)      _tb.drivers   = [];
  if (!_tb.tripMode)     _tb.tripMode  = "place";
  if (_tb.entryBuffer === undefined) _tb.entryBuffer = false;
  if (_tb.exitBuffer  === undefined) _tb.exitBuffer  = false;
  // PD.327: single mutator (dedup by id). Was raw _tripsIndex.push.
  _upsertTripIndexEntry({
    id: _currentTripId,
    name: trip.name,
    dateRange: "",
    destCount: 0,
    startDate: "",
    endDate: "",
    savedAt: new Date().toISOString()
  });
  if (typeof localSave === "function") localSave();
  if (typeof enterApp === "function") enterApp();
  // Auto-open the Research notes modal after enterApp's drawTripMode
  // settles. The modal has the pasted text and the "🪄 Make destinations
  // from this list" button — the user reviews + commits from there.
  //
  // Defensive: force-set _tb.tripMeta.notes from rawText right before
  // the modal opens (closure over rawText). Empirically the value
  // was getting lost somewhere between the synchronous _tb.tripMeta
  // assignment above and the 250ms-later modal render — possibly a
  // _syncPickerToTrip or autoSave path resetting picker state during
  // enterApp's drawTripMode. Belt-and-suspenders write keeps the
  // textarea populated regardless.
  setTimeout(function () {
    if (typeof _tb !== "undefined" && _tb) {
      if (!_tb.tripMeta || typeof _tb.tripMeta !== "object") {
        _tb.tripMeta = { notes: "", links: [] };
      }
      if (rawText) _tb.tripMeta.notes = rawText;
    }
    if (typeof _pmEnsureResearchMeta === "function") {
      try { _pmEnsureResearchMeta(); } catch(_){}
    }
    if (typeof _pmOpenTripResearchCard === "function") {
      try { _pmOpenTripResearchCard(); } catch(_){}
    }
  }, 250);
  return { tripId: _currentTripId };
}
if (typeof globalThis !== "undefined") globalThis._buildStubTripFromPastedList = _buildStubTripFromPastedList;

// v359.60.27: picker-first variant for paste/file imports. Routes
// straight into the FULL activity-place picker (renderActivityPicker
// — the same "What to see and do in X" view a from-scratch trip
// produces). The pasted places become the seeded must-do list that
// the LLM organizes into activity themes (Hike to waterfalls / Walk
// in volcanic landscapes / etc.), each one rendered as a grouped
// card with thumbnails, Stay/See toggles, Story links, and a map.
//
// Implementation: mint a stub trip, seed _tb.placeName + placeContext
// (the user's list goes into the context), then call
// generateActivitiesForPlace which fires the same LLM prompt as the
// regular new-trip flow. After generation we walk _tb.placeActivities
// once to honor user-specified nights on listed places (the LLM
// otherwise uses its own defaults).
//
// Replaces three prior paste/file paths:
//   v359.60.23 direct-build         (_buildTripFromPastedList)        — lands on trip view, no review.
//   v359.60.23 stub + Research      (_buildStubTripFromPastedList)    — opened notes modal, not picker.
//   v359.60.26 candidate-explorer   (_llmEnrichPastedCandidates)      — wrong picker (flat list, not themed).
async function _buildPickerFromPastedList(parseResult, rawText, opts) {
  opts = opts || {};
  if (!parseResult || !Array.isArray(parseResult.destinations) || !parseResult.destinations.length) return null;
  // PD.359: the PD.335 localStorage stash is DELETED. The trip now
  // mints at build start (below, right after construction), so the
  // user's list lands on trip.brief._userListedNames before any LLM
  // call — persisted trip state, not a localStorage side channel.
  console.log("[Max PD.359] paste-list: " + parseResult.destinations.length +
    " user-listed place(s) registered (" +
    parseResult.destinations.filter(function(p){ return p && p.isStay; }).length + " stays)");
  // PD.346: instant feedback — the classifier LLM call runs before
  // the picker opens; without this the user stared at a dead screen.
  try {
    if (typeof _maxBuildBannerSet === "function") {
      _maxBuildBannerSet("Max is reading your list…",
        "Your places appear in a moment — classifying stays and sights first.");
    }
  } catch(_){}
  // PD.297: pasting a list MUST mint a fresh trip slot. Without this
  // null-out, _currentTripId still points at whatever trip was active
  // before the paste, the new stub (with destinations:[]) below gets
  // reassigned to `trip`, and the next localSave writes the empty
  // stub back to the existing trip's storage slot — wiping its
  // destinations. _initialTripSave mints a new id whenever
  // _currentTripId is falsy, so clearing here routes the paste into
  // its own slot. Mirror showHome()'s state reset for activeDest +
  // _fileHandle so the prior trip's UI state doesn't leak into the
  // new one either.
  _currentTripId = null;
  activeDest = null;
  _fileHandle = null;
  destCtr = 0;
  sidCtr = 100;
  bkCtr = 0;
  var name = parseResult.tripName || opts.name
    || ("Imported — " + new Date().toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}));

  // v359.60.55: route through the shared _normalizeImportedRegion
  // helper. Same logic as v359.60.32/v359.60.53 but extracted so the
  // other import paths (_buildTripFromPastedList,
  // _buildStubTripFromPastedList) get the same normalization without
  // drift. Also adds a trip-noise-token fallback ("Patagonia
  // Adventure 2028" → "Patagonia") for regions not in _coarseGeocode.
  var _normRegion = _normalizeImportedRegion(parseResult.region);
  // PD.97: if normalization landed empty or doesn't look like a known
  // country / region, fall back to scanning the raw text for any
  // country mention. "We're going to Akureyri and Egilsstaðir in
  // September" → detectCountry returns "Iceland". Beats showing a
  // blank region or guessing wrong.
  try {
    if ((!_normRegion || !_normRegion.trim()) && typeof MaxGeo !== "undefined" && MaxGeo.detectCountry) {
      var _detected = MaxGeo.detectCountry(rawText || "");
      if (_detected) _normRegion = _detected;
    }
  } catch(_){}
  // PD.98: scope validation. Each parsed destination carries its
  // country (post-PD.83a parser splits ", Country" at parse time).
  // Surface a one-time console warning when a pasted destination's
  // country doesn't match the trip region — typo, paste from wrong
  // list, or unintended mix. Non-blocking by design; the user might
  // intentionally span multiple countries.
  try {
    if (typeof MaxGeo !== "undefined" && _normRegion) {
      var _tripCountry = MaxGeo.byName(_normRegion);
      if (_tripCountry) {
        var _mismatched = (parseResult.destinations || []).filter(function(p){
          if (!p || !p.country) return false;
          var pc = MaxGeo.byName(p.country);
          return pc && pc.iso2 !== _tripCountry.iso2;
        });
        if (_mismatched.length) {
          console.warn("[Max PD.98] " + _mismatched.length + " pasted place(s) are outside the trip region (" + _tripCountry.name + "):",
            _mismatched.map(function(p){ return p.place + " ("+ p.country +")"; }));
        }
      }
    }
  } catch(_){}

  // PD.206: Classify the parsed list before building the picker.
  //
  // The parser only knows section-header heuristics and per-line tags;
  // it can't tell a city from a POI from an activity. Run each entry
  // through the classifier so isStay/nights are decided structurally
  // (Reykjavík → city → stay; Harpa → POI → sight under Reykjavík;
  // Geysir-alone → POI → standalone destination with 0 nights). See
  // place-classification-spec.md for the model.
  //
  // The classifier auto-inserts parent cities when a POI's parent isn't
  // in the user's list (Step 2: "Harpa with no Reykjavík" → Reykjavík
  // gets added too). The downstream picker doesn't need to know any
  // of this — it just reads the corrected isStay/nights as if the
  // user had typed them that way.
  //
  // LLM call is injected via callMax (same wrapper generateActivities
  // uses). Failure modes (network error, malformed JSON, missing key)
  // all fall back to the heuristic classifier inside classifyListEntries,
  // which mirrors the parser's old "default to stay" behavior — so we
  // never block a trip build on the classifier.
  try {
    if (typeof MaxEngineClassify !== "undefined" && MaxEngineClassify.classifyListEntries) {
      var _llmFn = (typeof callMax === "function") ? callMax : null;
      var _classifications = await MaxEngineClassify.classifyListEntries(
        parseResult.destinations,
        { llm: _llmFn, region: _normRegion }
      );
      parseResult.destinations = MaxEngineClassify.applyClassificationsToEntries(
        parseResult.destinations, _classifications
      );
      console.log("[Max PD.206] classified " + _classifications.length + " list entries → " +
        parseResult.destinations.length + " final entries " +
        "(auto-created: " + parseResult.destinations.filter(function(e){ return e && e._autoCreated; }).length + ")");
      console.log("[Max PD.206] entries:", parseResult.destinations.map(function(e){
        return {
          place: e.place,
          classification: e._classification,
          isStay: e.isStay,
          nights: e.nights,
          parentRelation: e._parentRelation,
          autoCreated: !!e._autoCreated
        };
      }));
    }
  } catch (e) {
    console.warn("[Max PD.206] classifier wire-up failed; using parser defaults", e);
  }

  // Mint a STUB trip so the import is recoverable on reload — the
  // trip has no destinations yet; those get built when the user
  // commits in the activity-place picker via "What to see and do →".
  trip = {
    name: name,
    destinations: [],
    legs: {},
    trackSpending: false,
    pendingActions: [],
    brief: {
      region:   _normRegion,
      entry:    parseResult.entry  || "",
      tbExit:   parseResult.exit   || "",
      exitBuffer: true,
      when:     parseResult.when     || "",
      duration: parseResult.duration || "",
      _pendingStartDate: parseResult.startDate || null
    }
  };
  activeDest = null;
  _currentTripId = "trip-" + Date.now();
  _fileHandle = null;
  // PD.333 (audit C7/A2): one id, one key; anchor TripStore.
  trip.id = _currentTripId;
  if (typeof TripStore !== "undefined" && typeof TripStore.replace === "function") {
    try { TripStore.replace(trip); trip = TripStore.trip; } catch(_){}
  }

  // Initialize _tb (picker scratch). tripMode "place" so the
  // activity-place picker treats the user's list as the must-have
  // set; LLM discoveries become opt-in extras.
  if (typeof _tb === "undefined" || !_tb) {
    window._tb = _tb = _tbInstall({});
  }
  _tb.name      = name;
  _tb.region    = _normRegion;
  _tb.placeName = _normRegion;
  _tb.tripMode  = "place";
  _tb.when      = parseResult.when     || "";
  _tb.duration  = parseResult.duration || "";
  _tb.startDate = parseResult.startDate || "";
  _tb.entry     = parseResult.entry || "";
  _tb.tbExit    = parseResult.exit  || "";
  if (_tb.entryBuffer === undefined) _tb.entryBuffer = false;
  if (_tb.exitBuffer  === undefined) _tb.exitBuffer  = false;
  if (!Array.isArray(_tb.interests)) _tb.interests = [];
  if (!Array.isArray(_tb.drivers))   _tb.drivers   = [];
  // Carry the raw text on _tb so a later "Research notes" tap
  // (kept as a separate affordance, not auto-opened) has something
  // to show.
  _tb.tripMeta = { notes: rawText || "", links: [] };

  // Build the place context that gets injected into the picker LLM
  // prompt. The model treats this as "what the traveler told me they
  // want" — it'll organize the listed places into themed activities
  // and surface what each place is known for, instead of starting
  // from a blank slate. Including the user-specified nights lets
  // the LLM honor them when it sets requiredPlaces[].nights, though
  // we also do a post-pass override to make sure.
  // PD.74: surface the user's stay-vs-see intent in the prompt so the
  // LLM knows up front which pasted places are overnight hubs and
  // which are sights. Also stash a per-place role map on _tb so the
  // post-candidate pass can write the final role through MaxRoleWriter.
  var _ctxBits = parseResult.destinations.map(function(p){
    // PD.83a: parser stores place + country separately. Recombine for
    // the LLM prompt so it still gets scope ("Egilsstaðir, Iceland").
    var _name = p.country ? (p.place + ", " + p.country) : p.place;
    var bits = [_name];
    if (p.isStay) {
      if (p.nights > 0) bits.push("(overnight stay, " + p.nights + " night" + (p.nights === 1 ? "" : "s") + ")");
      else bits.push("(overnight stay)");
    } else {
      bits.push("(sight to visit, no overnight)");
    }
    if (p.intent) bits.push("— " + p.intent);
    return "  • " + bits.join(" ");
  }).join("\n");
  // Stash user's role intent so post-LLM we can stamp MaxRoleWriter.
  // PD.83a: parser already split off ", Country" at parse time, so
  // p.place is the clean city name. Just normalize via _normPlaceName
  // for diacritic-tolerant lookup against LLM-returned candidates.
  // PD.89: ALSO stash _tb._userListedNames as the durable source of
  // truth for "these places are on the user's list". _pastedRoles
  // gets deleted after one use; _userListedNames persists and is
  // mirrored to trip.brief._userListedNames so reopens still know.
  // _reconcileUserListedKeeps() reads it at every render and forces
  // _keep=true on matching requiredPlaces, unless the user has
  // explicitly rejected that place via the role popover.
  try {
    var nrmKey = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
    _tb._pastedRoles = {};
    _tb._userListedNames = {};
    // PD.149: also keep the user's ORIGINAL spelling for each listed
    // entry, keyed by normalized name. Renderers (umbrella section,
    // popup label, etc.) can show "Snæfellsjökull region" instead of
    // the lossy title-cased "Snaefellsjokull Region" reconstruction.
    _tb._userListedDisplay = {};
    parseResult.destinations.forEach(function(p){
      if (!p || !p.place) return;
      var k = nrmKey(p.place);
      if (!k) return;
      // PD.287: applyClassificationsToEntries (engine-classify.js)
      // inserts _autoCreated:true parent entries to give orphan POIs
      // a home — e.g. Reykjahlíð is inserted as a stay so Mývatn-area
      // POIs have a parent, Grundarfjörður is inserted for Kirkjufell.
      // Those parents need to flow into the LLM context and the stay
      // pipeline (_pastedListPlaces below), but they are NOT places the
      // user typed. Excluding them here keeps _userListedNames honest:
      // it's the "did the user actually paste this name?" oracle that
      // drives the "👁 / 🛏 Your list" badge and the orphan reconciler.
      if (p._autoCreated) return;
      _tb._pastedRoles[k] = { role: p.isStay ? "stay" : "see", displayName: p.place };
      _tb._userListedNames[k] = p.isStay ? "stay" : "see";
      if (!_tb._userListedDisplay[k]) _tb._userListedDisplay[k] = String(p.place).trim();
    });
    // PD.429: the listed set is NOT persisted as a parallel brief map. _tb's
    // copy here is transient BUILD INPUT (drives origin-baking); the durable
    // record is the raw paste text in tripMeta.notes plus the records'
    // _origin:"user" baked at build-done. Reopens re-project from the records.
  } catch(_){}
  // v359.60.28: stronger mandate — EVERY listed place must appear in
  // the output. Previous "anchor your activities around them" was too
  // soft; the model would drop secondary towns (Selfoss, Vík,
  // Egilsstaðir, Akureyri, Snæfellsnes town) in favor of higher-profile
  // ones in the same region. Now stated as a hard constraint, with an
  // explicit "if you're not sure how to slot it, put it in 'Other
  // places to consider'" escape valve so omission isn't an option.
  // A backstop post-pass (_backstopPastedListPlaces) still injects any
  // missing place as a stub activity if the model still drops one.
  var placeContext = "MANDATORY PLACE LIST — read this first:\n"
    + "The traveler has already chosen these specific places for this trip. EVERY ONE of these places "
    + "MUST appear in your output as a requiredPlace under at least one activity. This is a hard "
    + "constraint, not a hint. If you're not sure how to thematically slot a place, put it under an "
    + "\"More places to consider\" section — but never omit a listed place.\n\n"
    + "Use the listed nights as the recommended stay where given. Anchor your activities AROUND these "
    + "places (group them into themed sections like \"Hike to waterfalls,\" \"Walk in volcanic landscapes,\" "
    + "etc.) so the traveler reviews them as activities, not as a flat list. You may add a small "
    + "number of clearly-canonical additional places that the traveler obviously missed, but don't pad.\n\n"
    + "Places the traveler listed (EVERY ONE must appear in your output):\n" + _ctxBits
    // PD.76: when user has tagged some places as overnight stays, ask
    // the model to surface a few MORE overnight hubs the user didn't
    // list — especially in regions of the trip that look thin from the
    // user's choices. PD.77 groups these into "Overnight stays to consider"
    // beneath the user's own stays.
    + (parseResult.destinations.some(function(p){ return p && p.isStay; })
        ? "\n\nADDITIONAL STAYS — surface 2-4 EXTRA overnight hubs the traveler did NOT list but should "
          + "seriously consider, especially in regions of this trip that look thin from the user's list "
          + "(long stretches without an overnight, or major sub-regions with no chosen base). Mark each "
          + "with overnight=true and a stayRange of at least \"1 night\". Place them under a section "
          + "titled EXACTLY \"Overnight stays to consider\" (verbatim string match — do not invent a different title) so the picker shows them grouped.\n"
        : "");
  _tb.placeContext = placeContext;
  // Stash the parsed list so the backstop post-pass can detect any
  // place the LLM dropped despite the mandate.
  // PD.208: also carry classification metadata (set by PD.206) so the
  // backstop's synthesized candidates inherit it, and so any future
  // consumer can look up "what did the classifier say about Harpa?"
  // via _tb._classificationByPlace.
  _tb._pastedListPlaces = parseResult.destinations.map(function(p){
    return {
      place: p.place,
      country: p.country || parseResult.region || "",
      nights: (typeof p.nights === "number") ? p.nights : 0,
      intent: p.intent || "",
      lat: (typeof p.lat === "number") ? p.lat : null,
      lng: (typeof p.lng === "number") ? p.lng : null,
      _classification:        p._classification        || null,
      _parentEntry:           p._parentEntry           || null,
      _parentRelation:        p._parentRelation        || null,
      _promotedToDestination: !!p._promotedToDestination,
      _autoCreated:           !!p._autoCreated,
      _autoCreatedFor:        p._autoCreatedFor        || null
    };
  });
  // PD.337: CONSTRUCT-THEN-DECORATE. The user's places enter the
  // picker data RIGHT NOW, deterministically — before the LLM is even
  // called. The picker re-renders so the user sees their own list
  // immediately while generation runs; the LLM's output is merged
  // around these items later and can only decorate them.
  try {
    // isStay didn't survive the mapping above — restore it from the
    // parse so the constructor routes stays correctly even when the
    // user listed a stay without a night count.
    var _isStayByKey = {};
    var _nrmStay = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
    parseResult.destinations.forEach(function(p){
      if (p && p.place && p.isStay) _isStayByKey[_nrmStay(p.place)] = true;
    });
    _tb._pastedListPlaces.forEach(function(p){
      if (p && p.place && _isStayByKey[_nrmStay(p.place)]) p.isStay = true;
    });
    _constructUserListedItems();
    // PD.359: the trip exists BEFORE the LLM is called. Constructed
    // items are substance; _initialTripSave mints and copies
    // _userListedNames/_userListedDisplay onto trip.brief — the
    // durable record of what the traveler listed. The PD.335 stash
    // existed only because the mint used to happen at LLM completion,
    // AFTER state resets could wipe the in-memory list.
    try {
      if (typeof _initialTripSave === "function") _initialTripSave();
      if (_currentTripId) console.log("[Max PD.359] minted at build start: " + _currentTripId);
    } catch(e){ console.warn("[Max PD.359] mint-at-build-start failed:", e && e.message); }
    if (typeof renderActivityPicker === "function") renderActivityPicker();
  } catch(e){ console.warn("[Max PD.337] construction failed:", e && e.message); }
  try {
    var _nrm = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
    _tb._classificationByPlace = {};
    // PD.234 (architectural): _sightsClassified is the source of truth
    // for "is this place a sight that hangs off a parent?" Every
    // downstream pipeline step (kept-filter, reconciliation, attach,
    // augment) reads from it instead of inferring from candidate roles
    // or placeActivities flags. See sights-rearchitecture-plan.md.
    //
    //   _sightsClassified — Object<key, { parentKey, parentRelation,
    //     displayName, country }>
    //     A POI that hangs off a parent destination (within) OR a
    //     short stop on the route between destinations (from). Never
    //     becomes a top-level destination on its own.
    //
    // Destinations (city/region/promoted-POI/unknown) are NOT bucketed
    // separately — they are simply "not in _sightsClassified" and flow
    // through the legacy candidates pipeline as before. The cleanup
    // pass on 2026-06-04 removed a parallel _destinationsClassified
    // bucket that was written everywhere but never read.
    _tb._sightsClassified = {};
    parseResult.destinations.forEach(function(p){
      if (!p || !p.place) return;
      var k = _nrm(p.place);
      if (!k) return;
      _tb._classificationByPlace[k] = {
        classification:  p._classification || null,
        parentEntry:     p._parentEntry || null,
        parentRelation:  p._parentRelation || null,
        autoCreated:     !!p._autoCreated,
        promoted:        !!p._promotedToDestination
      };
      // PD.234 bucketing — only sights get a bucket entry.
      if (p._classification === "poi" && !p._promotedToDestination) {
        _tb._sightsClassified[k] = {
          parentKey:      p._parentEntry || null,
          parentRelation: p._parentRelation || "within",
          displayName:    p.place,
          country:        p.country || ""
        };
      }
    });
    console.log("[Max PD.234] classified " +
      Object.keys(_tb._sightsClassified).length + " sights " +
      "(from parseResult.destinations.length=" + parseResult.destinations.length + ")");
    // Mirror onto trip.brief so reopens of the trip still know which
    // sights came from "within" vs "from" their parent.
    if (typeof trip !== "undefined" && trip && trip.brief) {
      trip.brief._classificationByPlace  = Object.assign({}, _tb._classificationByPlace);
      trip.brief._sightsClassified       = Object.assign({}, _tb._sightsClassified);
    }
  } catch (e) {
    console.warn("[Max PD.234] classification map write FAILED:", e && e.message);
  }

  // PD.327: single mutator (dedup by id). Was raw _tripsIndex.push.
  _upsertTripIndexEntry({
    id: _currentTripId,
    name: trip.name,
    dateRange: "",
    destCount: 0,
    startDate: "",
    endDate: "",
    savedAt: new Date().toISOString()
  });
  if (typeof localSave === "function") localSave();

  // PD.105 / PD.330: navigate to Discovery so reload-mid-build lands
  // back in the picker, not on the empty trip stub. (Was: stamp
  // trip._lastScreen = "picker" — now the URL is the screen state.)
  try {
    if (typeof MaxRoute !== "undefined" && trip && trip.id) {
      MaxRoute.navigate({ screen: MaxRoute.SCREENS.DISCOVERY, tripId: trip.id });
    }
  } catch(_){}
  // enterApp so closing/canceling the picker drops the user onto a
  // mounted trip view (showing the empty stub) instead of the bare
  // home screen. The picker overlay is position:fixed inset:0, so
  // it sits on top while the user is in it.
  if (typeof enterApp === "function") enterApp();
  // Open the activity-place picker overlay in its loading state, then
  // kick off the LLM generation. renderActivityPicker handles both
  // states (loading + generated) by checking _tb.placeActivities; on
  // first call it's empty so the spinner shows. generateActivitiesForPlace
  // then fires the LLM call, fills _tb.placeActivities, and re-renders.
  var briefOv = document.getElementById("trip-brief-overlay");
  if (briefOv && briefOv.parentElement !== document.body) {
    // Reparent over <body> so a display:none home-screen ancestor
    // (now that enterApp() switched panels) doesn't hide the overlay.
    document.body.appendChild(briefOv);
  }
  // PD.105: explicitly show the overlay. renderActivityPicker writes
  // its DOM into the overlay but doesn't always set display:block —
  // some legacy paths left the overlay display:none from a previous
  // close, and the user got dumped on the trip view underneath.
  if (briefOv) briefOv.style.display = "block";
  if (typeof renderActivityPicker === "function") {
    renderActivityPicker();
  }
  // Stash the user's per-place nights so the post-generation override
  // can apply them. Keyed by normalized place name.
  var normFn = (typeof globalThis._normPlaceName === "function") ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var _userPickedNights = {};
  parseResult.destinations.forEach(function(p){
    if (!p || !p.place) return;
    var k = normFn(p.place);
    if (!k) return;
    _userPickedNights[k] = (typeof p.nights === "number") ? p.nights : 0;
  });
  _tb._pastedListNights = _userPickedNights;

  // PD.309: route through MaxBuild.findCandidates — the single
  // orchestrator for "build a trip." Before Phase 7, this site called
  // generateActivitiesForPlace() directly, and PD.308's auto-Enhance
  // was patched inline inside that function. Now the orchestrator
  // owns the phase sequence (activity-LLM → mint → enhance →
  // reconcile → handoff) and emits buildPhase events so loading UI
  // can subscribe. See architecture-rewrite.md Phase 7.
  //
  // Mode: "activity-first" — paste-list (and place-mode) generate
  // activities first, then mint the trip from them, then enhance.
  // The orchestrator awaits all phases before resolving; the
  // post-build reconcile passes below run after that.
  setTimeout(function() {
    if (typeof MaxBuild !== "undefined" && MaxBuild && typeof MaxBuild.findCandidates === "function") {
      // PD.309: subscribe to phase events for the loading banner.
      // Auto-unsubscribes when the build completes.
      // PD.340: the paste-flow's private enhance banner is GONE — the
      // global phase banner (build:start → build:done) is the single
      // owner of build progress. Two subscribers fighting over one
      // element id produced contradictory copy mid-build.
      MaxBuild.findCandidates({
        mode:         "activity-first",
        region:       _tb.region || _normRegion || "",
        tripMode:     "paste",
        placeName:    _tb.placeName || _tb.region || _normRegion || "",
        placeContext: _tb.placeContext || rawText || "",
        // PD.310: reconcile passes MUST run before enhance so the
        // enhance phase's skip list sees user-listed places that
        // the primary LLM dropped. Before this fix, these ran in
        // the .then() after MaxBuild resolved — i.e., AFTER enhance
        // — and any user-listed place the LLM dropped landed in
        // "Sights near places you listed" as a phantom enrichment
        // (Jökulsárlón canyon, Goðafoss Waterfall, etc.) and stuck.
        // Order: backstop synthesizes stubs for any place the LLM
        // outright dropped → reconciliation pass slots remaining
        // orphan sights into matching activity sections using
        // Wikipedia tokens (PD.257) → nights pass writes user-
        // specified stay lengths onto every requiredPlace.
        reconcile: async function() {
          try { _backstopPastedListPlaces(); } catch(_) {}
          try { await _reconcileListedSightsToSections(); } catch(_) {}
          // PD.404 (#80): LLM theming pass — sorts listed sights the
          // deterministic reconcile left in a catch-all into real themes.
          // Runs here (post-reconcile, pre-enhance) so the section set is
          // final and enhance's own extras aren't disturbed. Flag-gated off.
          try { await _runThemingPass(); } catch(_) {}
          try { _applyPastedListNights(); } catch(_) {}
        }
      }).then(function(){
        // Final picker re-render after the orchestrator has run all
        // phases (primary → mint → reconcile → enhance). Reconcile
        // and enhance both mutate _tb.placeActivities; render here so
        // the user sees the final composed state.
        if (typeof renderActivityPicker === "function") {
          try { renderActivityPicker(); } catch(_) {}
        }
      }).catch(function(err){
        console.warn("[Max] MaxBuild.findCandidates failed for pasted list:", err && err.message);
      }).then(function(){
        // Unsubscribe phase listeners regardless of success/failure.
        if (typeof _offEnhStart === "function") _offEnhStart();
        if (typeof _offEnhDone  === "function") _offEnhDone();
        if (typeof _offError    === "function") _offError();
      });
    }
  }, 50);

  // PD.224 (piece 3 of the Harpa-double-card fix): one-time modal
  // dialog explaining where each user-listed sight will land in the
  // built trip. The classifier has already decided each sight's
  // parent destination (via _classificationByPlace, piece 2 of this
  // series), but the user hasn't been told which sight → which
  // destination. Without this, sights "disappear" from view between
  // picker (where they're in "Sights you listed") and trip view
  // (where they're inside a destination card's See-and-Do tab) and
  // the user has to hunt for them.
  //
  // Format per item: "You'll see <sight> in <destination> when you
  // create the trip." Orphan sights (no in-list parent stay) get a
  // separate line; piece 4 will promote them to 0-night stays, so
  // they'll appear as their own stops.
  try {
    if (typeof _showPostImportSightsModal === "function") {
      _showPostImportSightsModal();
    }
  } catch (_) {}

  return { tripId: _currentTripId, destCount: parseResult.destinations.length };
}
if (typeof globalThis !== "undefined") globalThis._buildPickerFromPastedList = _buildPickerFromPastedList;

// PD.224: post-import modal — "You'll see <sight> in <destination>".
//
// Reads the classifier's per-place metadata (_tb._classificationByPlace,
// stashed by PD.208) plus the user-listed stays (_tb._userListedNames)
// to compute, for each user-listed sight, where it will surface in the
// built trip. Three buckets:
//
//   • Parent stay is on the user's list  → "in <stay>"  (most cases)
//   • Parent not in list, but classifier had one → "near <city>" (still
//     parented to the LLM's suggested parent, no destination created)
//   • No parent at all  → "as its own stop" (piece 4 will promote
//     orphans to 0-night stays; until then, modal language anticipates
//     that outcome)
//
// Modal styling mirrors _openPasteListBriefModal — same overlay, same
// box dimensions, same button row. Single dismiss button ("Got it").
// Skipped silently when no user-listed sights exist.
function _showPostImportSightsModal() {
  var listedNames = (typeof _tb !== "undefined" && _tb && _tb._userListedNames) || {};
  var clsByPlace = (typeof _tb !== "undefined" && _tb && _tb._classificationByPlace) || {};
  var displayMap = (typeof _tb !== "undefined" && _tb && _tb._userListedDisplay) || {};
  // Find every user-listed sight (role === "see") and figure out
  // where it'll live.
  var sightKeys = Object.keys(listedNames).filter(function (k) {
    return listedNames[k] === "see";
  });
  if (!sightKeys.length) return;

  var nrm = (typeof _normPlaceName === "function")
    ? _normPlaceName
    : function (s) { return String(s || "").toLowerCase().trim(); };

  function _titleCaseFallback(s) {
    return String(s || "").split(/\s+/).map(function (w) {
      if (!w) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  function _displayFor(key, fallbackFromMeta) {
    if (displayMap[key]) return displayMap[key];
    if (fallbackFromMeta) return fallbackFromMeta;
    return _titleCaseFallback(key);
  }

  var inDestRows = []; // {sight, dest}  — parentRelation="within"
  var orphanRows = []; // {sight}        — parentRelation="from" OR no parent
  sightKeys.forEach(function (k) {
    var meta = clsByPlace[k] || {};
    var parentKey = meta.parentEntry || null;
    var sightDisplay = _displayFor(k, null);
    // PD.225: use parentRelation, not just parent presence. Only
    // "within" sights land in a destination's See-and-Do; "from"
    // sights and orphans become their own 0-night stops on the route.
    if (meta.parentRelation === "within" && parentKey && listedNames[parentKey] === "stay") {
      var destDisplay = _displayFor(parentKey, null);
      inDestRows.push({ sight: sightDisplay, dest: destDisplay });
    } else {
      orphanRows.push({ sight: sightDisplay });
    }
  });

  var existing = document.getElementById("pd224-overlay");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "pd224-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10900;display:flex;align-items:center;justify-content:center;padding:24px;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:560px;max-width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 36px rgba(0,0,0,0.22);";

  var hdr = ''
    + '<div style="padding:16px 20px 10px;border-bottom:1px solid var(--c-border-3);">'
    +   '<div style="font-size:15px;font-weight:700;color:var(--c-ink);">Your sights will land with their destinations</div>'
    +   '<div style="font-size:12px;color:#777;margin-top:5px;line-height:1.5;">'
    +     'Each sight you listed shows up under the destination it sits in (or near). '
    +     'You’ll find it on the destination card’s See &amp; Do tab when you create the trip.'
    +   '</div>'
    + '</div>';

  var bodyParts = [];
  if (inDestRows.length) {
    bodyParts.push('<div style="font-size:11.5px;font-weight:700;color:var(--c-ink-2);letter-spacing:.04em;text-transform:uppercase;margin:6px 0 8px;">In a destination</div>');
    inDestRows.forEach(function (row) {
      bodyParts.push(
        '<div style="font-size:13px;color:#222;padding:6px 0;line-height:1.55;">'
        + 'You’ll see <strong>' + _pmEsc(row.sight) + '</strong> in <strong>' + _pmEsc(row.dest) + '</strong>.'
        + '</div>'
      );
    });
  }
  if (orphanRows.length) {
    bodyParts.push('<div style="font-size:11.5px;font-weight:700;color:var(--c-ink-2);letter-spacing:.04em;text-transform:uppercase;margin:14px 0 8px;">On the route as a short stop</div>');
    orphanRows.forEach(function (row) {
      bodyParts.push(
        '<div style="font-size:13px;color:#222;padding:6px 0;line-height:1.55;">'
        + '<strong>' + _pmEsc(row.sight) + '</strong> will be added as its own stop.'
        + '</div>'
      );
    });
  }

  var bodyHtml = ''
    + '<div style="flex:1;overflow-y:auto;padding:14px 20px;">'
    +   bodyParts.join("")
    + '</div>';

  var foot = ''
    + '<div style="padding:12px 20px;border-top:1px solid var(--c-border-3);display:flex;justify-content:flex-end;gap:8px;">'
    +   '<button id="pd224-ok" type="button" style="font-size:13px;font-weight:700;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;">Got it</button>'
    + '</div>';

  box.innerHTML = hdr + bodyHtml + foot;
  ov.appendChild(box);
  document.body.appendChild(ov);

  function close() {
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }
  document.getElementById("pd224-ok").onclick = close;
}
if (typeof globalThis !== "undefined") globalThis._showPostImportSightsModal = _showPostImportSightsModal;

// v359.60.27: post-generation pass. The activity-place LLM picks
// requiredPlaces[].nights from its own knowledge ("Reykjavik:
// 2-3 nights"); for places that came from a pasted list, the user
// already specified the nights they want. Walk _tb.placeActivities
// once and override the nights on any matching requiredPlace.
// Idempotent — safe to call multiple times.
function _applyPastedListNights() {
  if (!_tb || !_tb._pastedListNights) return;
  if (!Array.isArray(_tb.placeActivities)) return;
  var normFn = (typeof globalThis._normPlaceName === "function") ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var picks = _tb._pastedListNights;
  var changes = 0;
  _tb.placeActivities.forEach(function(it){
    if (!it || !Array.isArray(it.requiredPlaces)) return;
    it.requiredPlaces.forEach(function(p){
      if (!p || !p.place) return;
      var k = normFn(p.place);
      if (!Object.prototype.hasOwnProperty.call(picks, k)) return;
      var n = picks[k];
      if (typeof n !== "number") return;
      if (p.nights !== n) {
        p.nights = n;
        // n=0 means "see / day visit"; keep overnight=false in that
        // case so the picker renders it as a See. Otherwise mark
        // overnight=true so it survives as a real base.
        if (n === 0) {
          p.overnight = false;
        } else if (p.overnight !== true) {
          p.overnight = true;
        }
        changes++;
      }
    });
  });
  if (changes > 0 && typeof renderActivityPicker === "function") {
    console.log("[Max] applied user-specified nights to " + changes + " pasted-list place(s)");
    renderActivityPicker();
  }
}
if (typeof globalThis !== "undefined") globalThis._applyPastedListNights = _applyPastedListNights;

// v359.60.28: backstop pass that detects user-listed places the LLM
// failed to surface (despite the MANDATORY PLACE LIST clause in
// placeContext) and injects each missing place as a stub activity
// under an "More places to consider" section. Without this, the
// model occasionally drops secondary hub towns (Selfoss, Vík,
// Egilsstaðir, Akureyri, Snæfellsnes town) in favor of higher-profile
// ones in the same region — but the user listed those places
// explicitly and expects to see them.
//
// Stub shape mirrors the activity-place picker's normal item:
// type="activity", category/section set, iconic:false, checked:true,
// requiredPlaces:[{place, country, nights, overnight, _keep:true}].
// _keep:true so the place survives continuePlaceModeToStep2's filter.
// PD.429: BAKE user provenance onto records — the final-authority pass that
// lets the parallel `_userListedNames` set be retired. Every requiredPlace
// whose name covers a user-listed name (token-subset, same rule the backstop
// uses) gets `_origin:"user"` stamped PERMANENTLY on the record, so "is this
// place yours?" is answered by the record itself — never by a name-map
// fallback inside _placeOrigin. Unlike the backstop, this NEVER injects: it
// only stamps records that already exist. Run it as the LAST step after all
// record creation (incl. route-surfacing into concept themes), so a late-born
// record — e.g. a surfaced route-only sight the user actually listed
// ("Arnarstapi coastal cliffs") — is stamped too, instead of masquerading as
// a Max suggestion. Authority order: the transient pasted list (build), else
// the persisted name-map (one-time migration of an already-built trip on load).
// Idempotent; returns the number of records newly stamped.
function _stampListedOrigin() {
  if (!_tb || !Array.isArray(_tb.placeActivities)) return 0;
  var normFn = (typeof globalThis._normPlaceName === "function") ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  function _toks(name){ var n = normFn(name); return n ? n.split(/\s+/).filter(Boolean) : []; }
  // Authority = what the user typed. Three sources, in order of fidelity:
  //   1. the live build input (_pastedListPlaces), present during a build;
  //   2. a name-map still in _tb (a legacy brief seed restored on hydration);
  //   3. the RAW PASTE TEXT in tripMeta.notes — the durable, user-owned seed
  //      that survives on every trip, so origin-baking never depends on a
  //      persisted parallel map. This is what lets the brief map be retired
  //      while still guaranteeing no listed place loses its provenance.
  var authority = (Array.isArray(_tb._pastedListPlaces) && _tb._pastedListPlaces.length)
    ? _tb._pastedListPlaces.map(function(p){ return { place: p.place, isStay: !!(p.isStay || (typeof p.nights==="number" && p.nights>0)), _autoCreated: !!p._autoCreated }; })
    : (function(){
        var ln = _tb._userListedNames || {}, disp = _tb._userListedDisplay || {};
        return Object.keys(ln).map(function(k){ return { place: disp[k] || k, isStay: ln[k] === "stay" }; });
      })();
  // A classifier-synthesized parent (auto-created) is NOT a thing the user
  // typed — exclude it, exactly as the source builder does.
  authority = authority.filter(function(a){ return a && a.place && !a._autoCreated; });
  // Last resort: parse the raw paste text. Covers a freshly-built trip whose
  // records the build didn't fully stamp, reopened with no in-memory list.
  if (!authority.length && typeof parsePlacesList === "function") {
    try {
      var _notes = (_tb.tripMeta && _tb.tripMeta.notes)
        || (typeof trip !== "undefined" && trip && trip.brief && trip.brief.tripMeta && trip.brief.tripMeta.notes) || "";
      if (_notes) {
        var _pl = parsePlacesList(_notes);
        if (_pl && Array.isArray(_pl.destinations)) {
          authority = _pl.destinations
            .filter(function(d){ return d && d.place && !d._autoCreated; })
            .map(function(d){ return { place: d.place, isStay: !!(d.isStay || (typeof d.nights==="number" && d.nights>0)) }; });
        }
      }
    } catch(_){}
  }
  if (!authority.length) return 0;
  // Index every existing record by its token set. Route items are included:
  // a circuit you listed ("Golden Circle") lives as a route-umbrella place and
  // must be stampable as yours. Max's infra waypoints simply never match an
  // authority name, so they stay un-stamped.
  var recs = [];
  _tb.placeActivities.forEach(function(it){
    if (!it) return;
    (it.requiredPlaces || []).forEach(function(p){
      if (!p || !p.place) return;
      var set = {}; _toks(p.place).forEach(function(tk){ set[tk] = true; });
      recs.push({ set: set, p: p });
    });
  });
  var _isReb = !!(_tb && _tb._isRebuild);
  var stamped = 0;
  authority.forEach(function(up){
    var ut = _toks(up.place); if (!ut.length) return;
    for (var i = 0; i < recs.length; i++) {
      var set = recs[i].set, all = true;
      for (var j = 0; j < ut.length; j++) { if (!set[ut[j]]) { all = false; break; } }
      if (!all) continue;
      var p = recs[i].p;
      // Never downgrade a hub; only stamp where origin is absent or "max".
      // PD.453: this function stamps PROVENANCE only — never check-state. The
      // single keep-derivation (end of _reconcileUserListedKeeps) sets _keep
      // from origin + the user's decision, so a freshly-stamped user place
      // defaults checked there, with no referee here. Removing the old
      // _keep=true write removes a writer (this was a source of the "can't
      // uncheck a base" bug, since it re-asserted keep on every build pass).
      if (p._origin !== "user" && p._origin !== "max-hub") {
        p._origin = "user"; stamped++;
      }
      break; // first covering record wins (mirrors the backstop's _coverReq)
    }
  });
  if (stamped) { try { console.log("[Max PD.429] baked _origin:user onto " + stamped + " record(s) from the listed authority"); } catch(_){} }
  return stamped;
}
if (typeof globalThis !== "undefined") globalThis._stampListedOrigin = _stampListedOrigin;

function _backstopPastedListPlaces(stage) {
  // PD.374: this function serves two roles — CONSTRUCTOR (pre-LLM,
  // builds every listed place into the picker) and BACKSTOP
  // (post-merge, recovers anything the LLM dropped). The log must say
  // which: the constructor run used to print "LLM dropped 47
  // user-listed place(s)" before the LLM had even been called.

  if (!_tb || !Array.isArray(_tb._pastedListPlaces) || !_tb._pastedListPlaces.length) return;
  if (!Array.isArray(_tb.placeActivities)) return;
  var normFn = (typeof globalThis._normPlaceName === "function") ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  // v359.60.32: collect TOKENIZED covered names, not just exact
  // normalized keys. Strict equality was treating "Snæfellsnes" and
  // "Snæfellsnes Peninsula" as different places — they're the same
  // geographic feature with a modifier word. Similarly "Ásbyrgi"
  // (LLM) vs "Ásbyrgi Canyon" (user). Token-subset match: the user's
  // place is considered covered if its tokens are all present in
  // some covered name's tokens. This avoids injecting duplicate
  // entries when the LLM names the same place slightly differently.
  function _tokensOf(name) {
    var n = normFn(name);
    return n ? n.split(/\s+/).filter(Boolean) : [];
  }
  var coveredTokenSets = []; // array of Set-like { [token]: true }
  var coveredReqPlaces = []; // {set, place} — requiredPlace refs we can upgrade
  function _registerCovered(name, reqRef){
    var toks = _tokensOf(name);
    if (!toks.length) return;
    var set = {};
    toks.forEach(function(t){ set[t] = true; });
    coveredTokenSets.push(set);
    if (reqRef) coveredReqPlaces.push({ set: set, place: reqRef });
  }
  _tb.placeActivities.forEach(function(it){
    if (!it) return;
    (it.requiredPlaces || []).forEach(function(p){ if (p && p.place) _registerCovered(p.place, p); });
    (it.endpoints     || []).forEach(function(p){ if (p && p.place) _registerCovered(p.place); });
    (it.viableLocations|| []).forEach(function(p){ if (p && p.place) _registerCovered(p.place); });
  });
  // THE USER'S LISTING WINS. A place you listed that is already present —
  // possibly under a fuller Max name ("Þingvellir" → "Þingvellir National
  // Park") — must carry YOUR provenance and stay KEPT, never show up as an
  // unchecked Max suggestion. So upgrade the covering record in place: origin
  // → user (it's yours, not a Max idea), and keep → true on a first build
  // (a rebuild respects whatever you later unchecked). This also stops the
  // place from masquerading as a "considered" gray pin you never asked to weigh.
  (function _userListingWins(){
    var _isReb = !!(_tb && _tb._isRebuild);
    function _coverReq(userName){
      var ut = _tokensOf(userName);
      if (!ut.length) return null;
      for (var ci = 0; ci < coveredReqPlaces.length; ci++) {
        var set = coveredReqPlaces[ci].set, allHit = true;
        for (var ti = 0; ti < ut.length; ti++) { if (!set[ut[ti]]) { allHit = false; break; } }
        if (allHit) return coveredReqPlaces[ci].place;
      }
      return null;
    }
    _tb._pastedListPlaces.forEach(function(up){
      if (!up || !up.place) return;
      var cov = _coverReq(up.place);
      if (!cov) return;
      if (!cov._origin || cov._origin === "max") cov._origin = "user";
      // PD.453: provenance only — keep is owned by the single derivation, which
      // checks a user-origin undecided place by default. No keep referee here.
      // Adopt the canonical "correct" fuller name for the place (your
      // "Þingvellir" → "Þingvellir National Park") AND record the rename, so the
      // change is transparent rather than a silent substitution. The display
      // name for your listed entry is updated to the canonical; the correction
      // is surfaced in the receipt banner.
      if (cov.place && normFn(cov.place) !== normFn(up.place)) {
        var _k = normFn(up.place);
        _tb._userListedDisplay = _tb._userListedDisplay || {};
        var _from = (_tb._userListedDisplay[_k] != null) ? _tb._userListedDisplay[_k] : up.place;
        if (_from !== cov.place) {
          _tb.brief = _tb.brief || {};
          _tb.brief._listedNameCorrections = _tb.brief._listedNameCorrections || [];
          if (!_tb.brief._listedNameCorrections.some(function(c){ return c.to === cov.place; }))
            _tb.brief._listedNameCorrections.push({ from: _from, to: cov.place });
          _tb._userListedDisplay[_k] = cov.place;
        }
      }
    });
  })();
  // A user-listed place is "covered" if there exists a covered name
  // whose token set ⊇ the user's token set (every token of the user's
  // name appears in some covered name). One-word user names match
  // any covered name containing that word (so "Snæfellsnes" is covered
  // by "Snæfellsnes Peninsula"). Multi-word user names need every
  // token present.
  function _isCovered(userName){
    var userToks = _tokensOf(userName);
    if (!userToks.length) return true; // empty input — don't inject
    for (var ci = 0; ci < coveredTokenSets.length; ci++) {
      var set = coveredTokenSets[ci];
      var allHit = true;
      for (var ti = 0; ti < userToks.length; ti++) {
        if (!set[userToks[ti]]) { allHit = false; break; }
      }
      if (allHit) return true;
    }
    return false;
  }
  var missing = _tb._pastedListPlaces.filter(function(p){
    return p && p.place && !_isCovered(p.place);
  });
  if (!missing.length) return;
  if (stage === "construct") {
    console.log("[Max PD.337] constructing " + missing.length +
      " listed place(s) not yet in the picker: " + missing.map(function(p){return p.place;}).join(", "));
  } else {
    console.warn("[Max] backstop: LLM dropped " + missing.length +
      " user-listed place(s) — recovering: " + missing.map(function(p){return p.place;}).join(", "));
  }
  var nowTs = Date.now();
  // PD.301 (architectural): route by intent, not by one-size-fits-all
  // catchall. The backstop's job is to recover places the LLM dropped;
  // the recovery path should respect what the user originally said
  // those places were for.
  //
  //   • User-listed STAY (hasNights > 0) → append to "Recommended
  //     overnight stays" requiredPlaces. The user explicitly designated
  //     this place as an overnight base; it belongs with the canonical
  //     stays, not in the catchall. Previously Gardur sat in "More
  //     places to consider" forever (PD.211 was a partial fix that
  //     only dedup'd against _userListedNames but didn't route).
  //
  //   • User-listed SIGHT (hasNights == 0) → keep going through the
  //     "More places to consider" stub path. Reconciliation later
  //     promotes any sight that fits an activity section; the rest
  //     stay in catchall as designed.
  //
  // The architectural improvement: the "More places to consider"
  // catchall is now genuinely for sight-shaped places the LLM dropped
  // and that reconciliation couldn't place. Stays don't pollute it.
  // PD.380: route by provenance. User stays → "Overnight stays"
  // (checked). Max's auto-created hubs → "Recommended overnight
  // stays" (unchecked). Find/create each section on demand.
  function _ensureStaySectionItem(sectionName, checked, descr){
    var it = _tb.placeActivities.find(function(x){ return x && x.section === sectionName; });
    if (it) { if (!Array.isArray(it.requiredPlaces)) it.requiredPlaces = []; return it; }
    it = {
      id: (sectionName === window._SEC_STAYS_REC ? "plm_rechubs_" : "plm_userstays_") + Date.now() + "_" + Math.random().toString(36).slice(2,5),
      name: sectionName, type: "activity", category: "scenery-nature",
      section: sectionName, description: descr, iconic: false,
      checked: !!checked, requiredPlaces: [], durationHours: 24, _userConstructed: true
    };
    _tb.placeActivities.push(it);
    return it;
  }
  missing.forEach(function(p, i){
    // PD.337: a listed stay WITHOUT a night count is still a stay —
    // p.isStay (from the parse / two-textarea modal) routes it to the
    // overnight section with a 1-night default instead of demoting it
    // to a sight stub.
    var hasNights = (typeof p.nights === "number" && p.nights > 0) || p.isStay === true;
    var _nightsVal = (typeof p.nights === "number" && p.nights > 0) ? p.nights : (p.isStay ? 1 : 0);
    if (hasNights) {
      // PD.380: Max never checks anything. Auto-created hubs land in
      // the Recommended section UNCHECKED; your own listed stays land
      // in your "Overnight stays" section, checked.
      var _target = p._autoCreated
        ? _ensureStaySectionItem(window._SEC_STAYS_REC, false,
            "Bases Max suggests near sights you listed that had no overnight stay nearby. Unchecked — check one to make it a stay, or leave it and visit those sights along the way.")
        : _ensureStaySectionItem(window._SEC_STAYS_USER, true,
            "The places you listed as overnight stays. These anchor the trip — where you sleep and the bases for day trips.");
      _target.requiredPlaces.push({
        place: p.place,
        country: p.country || "",
        nights: _nightsVal,
        lat: (typeof p.lat === "number") ? p.lat : 0,
        lng: (typeof p.lng === "number") ? p.lng : 0,
        overnight: true,
        _origin: p._autoCreated ? "max-hub" : "user", // PD.382
        _keep: !p._autoCreated,
        _autoCreated: !!p._autoCreated,
        _isDayTrip: false,
        _dayTripHub: ""
      });
      return; // routed to a stay section; skip the catchall stub
    }
    // Sight-shaped, OR stay-shaped with no Recommended section (sentence
    // mode or no other user stays) — create the legacy catchall stub.
    var stub = {
      id: "plm_pasted_" + nowTs + "_" + i,
      name: hasNights ? ("Stay in " + p.place) : ("Stop in " + p.place),
      type: "activity",
      category: "scenery-nature",
      // PD.341: the user's own places never sit in a Max-suggestions
      // bucket. Listed places that haven't found a thematic section
      // yet live under "From your list"; classifier-synthesized
      // (auto-created) entries keep using Max's catchall.
      section: (p._autoCreated ? "More places to consider" : "From your list"),
      description: p.intent
        ? p.intent
        : (hasNights
            ? ("A base the traveler listed for " + _nightsVal + " night" + (_nightsVal === 1 ? "" : "s") + ".")
            : "A stop the traveler listed."),
      iconic: false,
      checked: true,
      requiredPlaces: [{
        place: p.place,
        country: p.country || "",
        nights: _nightsVal,
        lat: (typeof p.lat === "number") ? p.lat : 0,
        lng: (typeof p.lng === "number") ? p.lng : 0,
        overnight: hasNights,
        _origin: p._autoCreated ? "max-hub" : "user", // PD.382
        _keep: true,
        _isDayTrip: false,
        _dayTripHub: ""
      }],
      durationHours: hasNights ? 24 : 4
    };
    _tb.placeActivities.push(stub);
  });
  if (typeof renderActivityPicker === "function") renderActivityPicker();
}
if (typeof globalThis !== "undefined") globalThis._backstopPastedListPlaces = _backstopPastedListPlaces;
