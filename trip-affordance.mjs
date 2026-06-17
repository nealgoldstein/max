// @ts-check
import MaxDB from "./db.mjs";
// trip-affordance.js — geographic-affordance pass + multi-destination day-trip
// mechanism (Rounds FQ/FT). Extracted from index.html (PD.457).

// ── Round FQ — geographic-affordance pass ──────────────────────────
//
// Computes a verdict on the geometry of the user's picked destinations:
// dense (most pairs reachable in <2h door-to-door), spread (most >4h),
// or mixed. Pairwise distances are exact (haversine, client-side); per-
// pair transit modes & times come from the LLM, cached automatically by
// callMax's IDB cache via the same prompt text.
//
// Replaces Round FO's between-mode pill. Max informs about geography;
// the user decides what kind of trip to build. Both the picker summary
// (live) and the trip-view banner read the same verdict.

// _fqHaversineKm, _fqPairKey moved to engine-trip.js (Round HB / Phase 1).
// _fqInflight, _fqPairMemo, _fqGetTransitInfo, _fqComputeVerdict,
// _fqVerdictForPlaces, _fqLastSig, _fqLastVerdict all moved to
// engine-trip.js (Round HF / Phase 2 step 4) and shared via window
// globals + MaxEngineTrip.* — _ftPeerDayTripCandidates still reads
// _fqPairMemo[_fqPairKey(...)] directly (works because the engine
// module exposes the same object reference).
//
// callMax is injected into the engine right after callMax is defined:
//   if (typeof MaxEngineTrip !== "undefined") MaxEngineTrip.injectService("llm", callMax);

// _fqFastestPractical moved to engine-trip.js (Round HB / Phase 1).

// _fqComputeVerdict, _fqVerdictForPlaces, _fqLastSig, _fqLastVerdict,
// _fqPlacesSig all moved to engine-trip.js (Round HF / Phase 2 step 4).

// Round FQ.2: simplified to a single static note. The verdict-label
// + pair-callouts pattern Max shipped first read as judgmental
// ("Mixed geography" with a list of friction-pair callouts) and
// presumed too much about how the user would plan. Neal's pushback:
// just point out the day-trip option exists, frame it openly so
// either direction feels valid, and let the user discover specifics
// via the Explore tab's per-destination day-trip section.
function _fqBannerInnerHtml(){
  return ''
    + '<div style="font-weight:600;color:var(--c-primary);margin-bottom:6px;">Day trips</div>'
    + '<div>As you explore the various destinations you may find opportunities for day trips. '
    + 'You might want to stay in a larger city and take day trips from there to smaller cities. '
    + 'But sometimes, staying in a smaller city and taking day trips to the larger one may suit you better. '
    + 'Hotels may be cheaper, and the smaller city’s pace may be more to your liking.</div>'
    // v359.60.3: companion paragraph on waysides ("along the way").
    // Same two-direction framing as the day-trip text — open up the
    // option, name the obvious case, then name the counter-case so
    // neither feels like the default.
    + '<div style="font-weight:600;color:var(--c-primary);margin:12px 0 6px;">On the way</div>'
    + '<div>Some places are better experienced as a stop than as a stay &mdash; a waterfall along the route, a viewpoint, '
    + 'a small town with one good lunch spot. As you map the drive between two of your hubs, you may find a place that fits '
    + 'right on the line. Mark it &ldquo;along the way&rdquo; and the night it was claiming frees up for a destination you wish you had more time at. '
    + 'But sometimes the call goes the other direction &mdash; when the sunrise from a small place is the whole reason to be there, '
    + 'or when the silence after the day-trippers leave is what makes it special, an overnight is worth more than the convenience '
    + 'of passing through.</div>';
}

// ── Round FT — multi-destination day-trip mechanism ───────────────
//
// The user can schedule a day-trip from any trip destination to any
// OTHER trip destination within a configurable time threshold (default
// 3h door-to-door). Each schedule transfers one night: hub +1 night,
// target -1 night. Same target can be scheduled on multiple days
// (Liden→Amsterdam Day 2 AND Day 4). Reversal restores the night.
//
// Why a separate mechanism from absorbed chips (Round DA): absorbed
// chips already had their nights folded into the hub at clustering
// time, so scheduling them is a pure placement (no transfer needed).
// Peer day-trips between active destinations are the new operation —
// the user is restructuring the trip on the fly.

// Parser for the user-adjustable threshold input. Accepts: "3",
// "3.5", "3:30", "3h", "3h 30m". Returns decimal hours (or null on
// unparseable input). Default fallback is 3 in callers.
// _ftParseHoursInput, _ftFormatHours moved to engine-trip.js (Round HB / Phase 1).

function _ftGetThresholdHours(){
  // v359.6: fall through to the new MaxDB.prefs.dayTripHours global
  // default before the hardcoded 3. Per-trip trip.dayTripThreshold
  // still wins if it's set — the Settings panel only defines defaults.
  var globalDefault = 3;
  try {
    if (typeof _defaultDayTripHours === "function") globalDefault = _defaultDayTripHours();
  } catch(_){}
  if (typeof trip === "undefined" || !trip) return globalDefault;
  var v = _ftParseHoursInput(trip.dayTripThreshold);
  return (v && v > 0) ? v : globalDefault;
}

// Recompute every destination's dateFrom/dateTo by walking forward
// from the first destination's start date. Total trip length =
// sum of nights, unchanged by night-transfer operations because
// transfers are zero-sum.
function _ftRecomputeTripDates(){
  if (!trip || !trip.destinations || !trip.destinations.length) return;
  var startDate = trip.destinations[0].dateFrom;
  if (!startDate) return;
  var cur = new Date(startDate + "T12:00:00");
  trip.destinations.forEach(function(d){
    d.dateFrom = cur.toISOString().slice(0,10);
    var nx = new Date(cur);
    nx.setDate(nx.getDate() + (d.nights || 0));
    d.dateTo = nx.toISOString().slice(0,10);
    cur = nx;
  });
}

// v359.60.30: trip-level date editor. Opens a modal with the
// current start/end dates pre-filled. Apply rules:
//   - Start changes only        → SHIFT every dest by delta (nights preserved)
//   - End changes only          → SCALE nights proportionally across overnights
//   - Both change               → Anchor at new start, scale nights to fit new total
// Day-trip routes / wayside routes don't carry their own dates — they
// inherit from their hub days, so a date cascade automatically updates
// everything. Stub trips (no destinations) silently no-op.
function _openTripDatesEditor(){
  if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) {
    alert("No destinations yet — add at least one to set dates.");
    return;
  }
  var first = trip.destinations[0];
  var last  = trip.destinations[trip.destinations.length - 1];
  var curStart = (first && first.dateFrom) || "";
  var curEnd   = (last  && last.dateTo)   || "";
  var curNights = trip.destinations.reduce(function(s, d){ return s + (d.nights || 0); }, 0);

  var existing = document.getElementById("trip-dates-editor");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "trip-dates-editor";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.32);z-index:10500;display:flex;align-items:center;justify-content:center;padding:20px;";
  ov.innerHTML = ''
    + '<div style="background:var(--c-bg);border-radius:12px;max-width:420px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.18);">'
    +   '<div style="padding:18px 20px 6px;">'
    +     '<div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--c-ink-3);">Trip dates</div>'
    +     '<div style="font-size:17px;font-weight:700;color:var(--c-ink);margin-top:4px;">' + (trip.name ? String(trip.name).replace(/</g,"&lt;") : "Untitled trip") + '</div>'
    +     '<div style="font-size:11.5px;color:#777;margin-top:3px;line-height:1.5;">Change the start to shift everything by that delta. Change the end to grow or shrink the trip — destinations scale proportionally to their current nights.</div>'
    +   '</div>'
    +   '<div style="padding:12px 20px;display:flex;flex-direction:column;gap:12px;">'
    +     '<label style="display:flex;align-items:center;gap:10px;font-size:12.5px;color:#222;">'
    +       '<span style="min-width:60px;font-weight:600;">Start</span>'
    +       '<input type="date" id="trip-dates-start" value="' + curStart + '" style="flex:1;padding:6px 8px;font-size:12.5px;border:1px solid var(--c-border-strong);border-radius:6px;font-family:inherit;" />'
    +     '</label>'
    +     '<label style="display:flex;align-items:center;gap:10px;font-size:12.5px;color:#222;">'
    +       '<span style="min-width:60px;font-weight:600;">End</span>'
    +       '<input type="date" id="trip-dates-end" value="' + curEnd + '" style="flex:1;padding:6px 8px;font-size:12.5px;border:1px solid var(--c-border-strong);border-radius:6px;font-family:inherit;" />'
    +     '</label>'
    +     '<div id="trip-dates-preview" style="font-size:11.5px;color:#666;line-height:1.5;padding:8px 10px;background:#f8f8f6;border:1px solid #ece8db;border-radius:6px;"></div>'
    +   '</div>'
    +   '<div style="padding:8px 20px 18px;display:flex;justify-content:flex-end;gap:8px;">'
    +     '<button id="trip-dates-cancel" type="button" style="font-size:13px;font-weight:500;color:var(--c-ink-2);background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Cancel</button>'
    +     '<button id="trip-dates-apply" type="button" style="font-size:13px;font-weight:700;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:6px;padding:8px 16px;cursor:pointer;font-family:inherit;">Apply</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(ov);

  function close(){ if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  ov.onclick = function(e){ if (e.target === ov) close(); };
  ov.querySelector("#trip-dates-cancel").onclick = close;

  var startInp = ov.querySelector("#trip-dates-start");
  var endInp   = ov.querySelector("#trip-dates-end");
  var prev     = ov.querySelector("#trip-dates-preview");

  function _diffDays(a, b){
    var da = new Date(a + "T12:00:00"), db = new Date(b + "T12:00:00");
    if (isNaN(+da) || isNaN(+db)) return null;
    return Math.round((+db - +da) / 86400000);
  }
  function _refreshPreview(){
    var s = startInp.value, e = endInp.value;
    if (!s || !e) { prev.textContent = "Pick both dates."; return; }
    var newNights = _diffDays(s, e);
    if (newNights == null) { prev.textContent = "Couldn't parse dates."; return; }
    if (newNights < trip.destinations.length) {
      prev.innerHTML = '<span style="color:#c44;">Too short — you have <strong>' + trip.destinations.length + '</strong> destination' + (trip.destinations.length !== 1 ? 's' : '') + '. Pick an end date at least ' + trip.destinations.length + ' day' + (trip.destinations.length !== 1 ? 's' : '') + ' after start.</span>';
      return;
    }
    var deltaNights = newNights - curNights;
    var deltaStartDays = (s === curStart) ? 0 : _diffDays(curStart, s);
    var parts = [];
    parts.push('<strong>' + (newNights + 1) + ' days</strong> · ' + newNights + ' nights');
    if (deltaStartDays !== 0) parts.push((deltaStartDays > 0 ? 'shifted later by ' : 'shifted earlier by ') + Math.abs(deltaStartDays) + ' day' + (Math.abs(deltaStartDays) !== 1 ? 's' : ''));
    if (deltaNights !== 0) parts.push((deltaNights > 0 ? 'extended by ' : 'shortened by ') + Math.abs(deltaNights) + ' night' + (Math.abs(deltaNights) !== 1 ? 's' : '') + ' (scaled across destinations)');
    if (deltaStartDays === 0 && deltaNights === 0) parts.push('no change');
    prev.innerHTML = parts.join(' · ');
  }
  startInp.oninput = _refreshPreview;
  endInp.oninput   = _refreshPreview;
  _refreshPreview();

  ov.querySelector("#trip-dates-apply").onclick = function(){
    var newStart = startInp.value;
    var newEnd   = endInp.value;
    if (!newStart || !newEnd) return;
    var newNights = _diffDays(newStart, newEnd);
    if (newNights == null || newNights < trip.destinations.length) return;
    close();
    _applyTripDateChange(newStart, newNights);
  };
}
if (typeof globalThis !== "undefined") globalThis._openTripDatesEditor = _openTripDatesEditor;

// v359.60.30: apply a new trip start + total nights. Distributes the
// delta proportionally across overnight destinations (nights > 0)
// using a largest-remainder rounding pass so the final total exactly
// matches the target. 0-night "see" destinations stay at 0. After
// the per-dest nights are settled, _ftRecomputeTripDates cascades
// dateFrom / dateTo from the new start.
function _applyTripDateChange(newStart, newNights){
  if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) return;
  if (!newStart) return;
  newNights = Math.max(trip.destinations.length, parseInt(newNights, 10) || 0);

  // Anchor the first destination at newStart. _ftRecomputeTripDates
  // walks from there.
  trip.destinations[0].dateFrom = newStart;

  // Distribute nights proportionally to current overnights.
  var curNights = trip.destinations.reduce(function(s, d){ return s + (d.nights || 0); }, 0);
  var overnights = trip.destinations.filter(function(d){ return (d.nights || 0) > 0; });
  var zeroNights = trip.destinations.filter(function(d){ return !(d.nights || 0); });

  if (newNights !== curNights) {
    if (overnights.length === 0) {
      // No overnights yet — give every "see" 1 night until budget is consumed.
      // Cheap fallback; user can rebalance manually after.
      var remaining = newNights;
      trip.destinations.forEach(function(d){
        d.nights = remaining > 0 ? 1 : 0;
        remaining -= d.nights;
      });
    } else if (curNights > 0) {
      // Proportional scale with largest-remainder rounding.
      var scale = newNights / curNights;
      var raw = overnights.map(function(d){ return (d.nights || 0) * scale; });
      var floors = raw.map(function(v){ return Math.max(1, Math.floor(v)); });
      var sum = floors.reduce(function(a, b){ return a + b; }, 0);
      var delta = newNights - sum;
      // Indices ranked by fractional remainder (descending) get +1
      // (or -1 when delta < 0; pick smallest remainder first).
      var rems = raw.map(function(v, i){ return { i: i, frac: v - Math.floor(v) }; });
      rems.sort(function(a, b){ return b.frac - a.frac; });
      if (delta > 0) {
        for (var k = 0; k < delta && k < rems.length; k++) floors[rems[k].i]++;
      } else if (delta < 0) {
        var need = -delta;
        // Subtract from smallest-remainder overnights first, but never below 1.
        rems.reverse();
        var rIdx = 0;
        while (need > 0 && rIdx < rems.length) {
          var i = rems[rIdx].i;
          if (floors[i] > 1) { floors[i]--; need--; }
          else rIdx++;
          if (rIdx >= rems.length) rIdx = 0; // wrap once if needed
          // Safety: bail if every overnight is at 1 already.
          if (floors.every(function(v){ return v <= 1; })) break;
        }
      }
      overnights.forEach(function(d, i){ d.nights = floors[i]; });
    } else {
      // curNights === 0 but newNights > 0 — give everyone 1 until consumed.
      var rem = newNights;
      trip.destinations.forEach(function(d){
        d.nights = rem > 0 ? 1 : 0;
        rem -= d.nights;
      });
    }
  }

  // Re-cascade dates and resize day arrays.
  if (typeof _ftRecomputeTripDates === "function") _ftRecomputeTripDates();
  if (typeof _ftResizeDestDays === "function") {
    trip.destinations.forEach(function(d){ _ftResizeDestDays(d); });
  }

  // Mirror to the brief so re-edits stay consistent.
  if (trip.brief) {
    trip.brief.startDate = newStart;
    trip.brief.duration = (newNights + 1) + " days";
    var lastDest = trip.destinations[trip.destinations.length - 1];
    if (lastDest && lastDest.dateTo) trip.brief.endDate = lastDest.dateTo;
  }

  if (typeof _emitTripMutation === "function") {
    /** @type {any} */(_emitTripMutation)({ reason: "tripDatesEdit" });
  } else {
    if (typeof autoSave === "function") try { autoSave(); } catch(_) {}
    if (typeof drawTripMode === "function") drawTripMode();
    if (typeof updateMainMap === "function") updateMainMap();
  }
  if (typeof showSaveStatus === "function") {
    showSaveStatus("Trip dates updated", 2400);
  }
}
if (typeof globalThis !== "undefined") globalThis._applyTripDateChange = _applyTripDateChange;

// Resize a destination's days array in place to match its new
// nights value. Preserves items as much as possible — appends fresh
// empty days when growing; merges trailing items into the last
// surviving day when shrinking. Re-labels every day's date so the
// "Mon, Jul 8" labels stay accurate after the trip's date recompute.
function _ftResizeDestDays(dest){
  if (!dest) return;
  var targetCount = Math.min(dest.nights || 0, 7);
  if (!Array.isArray(dest.days)) dest.days = [];
  // Grow
  while (dest.days.length < targetCount) {
    var idx = dest.days.length;
    dest.days.push({
      id: "dy" + dest.id + "_" + idx + "_ft" + Date.now() + "_" + idx,
      lbl: "",
      note: "",
      items: []
    });
  }
  // Shrink: merge trailing items into the last surviving day
  if (dest.days.length > targetCount) {
    var keep = dest.days.slice(0, targetCount);
    var dropped = dest.days.slice(targetCount);
    var lastSurvivor = keep[keep.length - 1];
    if (lastSurvivor) {
      if (!Array.isArray(lastSurvivor.items)) lastSurvivor.items = [];
      dropped.forEach(function(d){
        if (Array.isArray(d.items)) lastSurvivor.items = lastSurvivor.items.concat(d.items);
      });
    }
    dest.days = keep;
  }
  // Re-label dates
  if (dest.dateFrom) {
    dest.days.forEach(function(d, i){
      try {
        var dd = new Date(dest.dateFrom + "T12:00:00");
        dd.setDate(dd.getDate() + i);
        d.lbl = dd.toLocaleDateString("en-US", {month:"short", day:"numeric"});
        if (i === 0 && !d.note) d.note = "arrival";
      } catch(_){}
    });
  }
}

// Schedule a peer day-trip: from hubDest, take a day-trip to
// targetDest on a specific day index of hubDest. Transfers one
// night (target.nights--, hub.nights++), recomputes trip dates,
// resizes both day arrays, then adds a daytrip-shaped item to the
// chosen day on the hub. The added item carries peerDayTrip:true
// and peerTargetId so removeDayTripFromDayItem can reverse the
// transfer correctly. Refuses if target.nights is already at the
// minimum (1) — see the comment in there for the resurrection
// design we're deferring.
// path-to-10:A done — mutator emits tripChange + mapDataChange via _emitTripMutation; no direct drawXxx calls. See path-to-10.md item A (HY round, May 2026).
function _ftSchedulePeerDayTrip(hubDest, targetDest, dayIdx, distKm){
  if (!hubDest || !targetDest || !hubDest.days || !hubDest.days[dayIdx]) return;
  if (hubDest.id === targetDest.id) return;
  if ((targetDest.nights || 0) <= 0) return;
  // Refuse if the same place is already scheduled on this day
  var alreadyOnThisDay = (hubDest.days[dayIdx].items || []).some(function(it){
    return it && it.type === "daytrip" && it.dayTripPlace === targetDest.place;
  });
  if (alreadyOnThisDay) return;
  // Transfer one night
  targetDest.nights = (targetDest.nights || 0) - 1;
  hubDest.nights = (hubDest.nights || 0) + 1;
  // Round FZ.6: when the target hits 0 nights, splice it out of
  // trip.destinations and stash on trip._absorbedDayTripPlaces with
  // its original index so reversal can restore it. The destination
  // object itself is preserved intact (with its days, suggestions,
  // bookings, etc.) so a future restore brings it back fully.
  if ((targetDest.nights || 0) <= 0) {
    if (!Array.isArray(trip._absorbedDayTripPlaces)) trip._absorbedDayTripPlaces = [];
    var origIdx = trip.destinations.indexOf(targetDest);
    trip._absorbedDayTripPlaces.push({
      dest: targetDest,
      originalIndex: origIdx
    });
    if (origIdx >= 0) trip.destinations.splice(origIdx, 1);
  }
  _ftRecomputeTripDates();
  if ((targetDest.nights || 0) > 0) _ftResizeDestDays(targetDest);
  _ftResizeDestDays(hubDest);
  // Add the day-trip item on hub's chosen day
  if (typeof sidCtr === "undefined") window.sidCtr = 100;
  sidCtr++;
  var newItem = {
    id: "s" + sidCtr,
    type: "daytrip",
    n: targetDest.place + " (day trip)",
    st: targetDest.place,
    note: "Day trip · " + (distKm ? Math.round(distKm) + "km from " + hubDest.place : "from " + hubDest.place),
    lat: targetDest.lat || null,
    lng: targetDest.lng || null,
    dayTripPlace: targetDest.place,
    dayTripFrom: hubDest.place,
    peerDayTrip: true,        // FT.4 reversal flag
    peerTargetId: targetDest.id,
    slot: "day"
  };
  if (!hubDest.days[dayIdx].items) hubDest.days[dayIdx].items = [];
  hubDest.days[dayIdx].items.push(newItem);
  // Round HE: emit instead of direct drawXxx. The peer day-trip
  // flow always runs from hubDest's detail view, so activeDest
  // already equals hubDest.id and the central subscription's
  // drawDestMode(activeDest) renders the same view.
  _emitTripMutation();
}

// Reverse a peer day-trip night transfer: target gains a night, hub
// loses one, dates and day arrays recompute. Called from
// removeDayTripFromDayItem when the removed item carried
// peerDayTrip:true.
function _ftReverseNightTransfer(hubDest, targetId){
  if (!trip || !trip.destinations) return;
  if (!hubDest) return;
  if ((hubDest.nights || 0) <= 1) return;
  // Look first in trip.destinations
  var target = null;
  for (var i = 0; i < trip.destinations.length; i++) {
    if (trip.destinations[i].id === targetId) { target = trip.destinations[i]; break; }
  }
  // Round FZ.6: if not in trip.destinations, look in the absorbed
  // stash — target was reduced to 0 nights and spliced out. Restore
  // it: nights = 1, splice back at original index (clamped to
  // current array length), drop from stash.
  var restoredFromStash = false;
  if (!target && Array.isArray(trip._absorbedDayTripPlaces)) {
    for (var si = 0; si < trip._absorbedDayTripPlaces.length; si++) {
      var entry = trip._absorbedDayTripPlaces[si];
      if (entry && entry.dest && entry.dest.id === targetId) {
        target = entry.dest;
        target.nights = 1;
        var insertAt = Math.max(0, Math.min(entry.originalIndex || trip.destinations.length, trip.destinations.length));
        trip.destinations.splice(insertAt, 0, target);
        trip._absorbedDayTripPlaces.splice(si, 1);
        restoredFromStash = true;
        break;
      }
    }
  }
  if (!target) return;
  hubDest.nights = (hubDest.nights || 0) - 1;
  if (!restoredFromStash) target.nights = (target.nights || 0) + 1;
  _ftRecomputeTripDates();
  _ftResizeDestDays(hubDest);
  _ftResizeDestDays(target);
}

// Build the list of peer day-trip candidates for a given hub
// destination: every other trip destination within the threshold,
// using the FQ pairwise transit data we already cache. Returns
// array of {dest, distKm, fastestH, info, scheduledDays:[idx,...]}.
function _ftPeerDayTripCandidates(hubDest){
  if (!trip || !trip.destinations || !hubDest) return [];
  var thresholdH = _ftGetThresholdHours();
  var hubCoord = null;
  if (typeof hubDest.lat === "number" && typeof hubDest.lng === "number") {
    hubCoord = [hubDest.lat, hubDest.lng];
  } else if (trip.candidates) {
    for (var ci = 0; ci < trip.candidates.length; ci++) {
      var c = trip.candidates[ci];
      if (c && c.place === hubDest.place && typeof c.lat === "number" && typeof c.lng === "number") {
        hubCoord = [c.lat, c.lng]; break;
      }
    }
  }
  if (!hubCoord) return [];
  var out = [];
  // Round FZ.5: also exclude any destination that shares the hub's
  // place name. Round-trip cities have entry buffer + main + exit
  // buffer all at the same place; previously only id-match and
  // _exitStop excluded — entry buffer leaked through with a
  // different id and no _exitStop, so Reykjavik appeared as a
  // peer day-trip target from Reykjavik. You can't day-trip to
  // yourself — exclude any same-place sibling regardless of flag.
  var hubPlaceN = (typeof _normPlaceName === "function")
    ? _normPlaceName(hubDest.place || "")
    : (hubDest.place || "").toLowerCase();
  trip.destinations.forEach(function(d){
    if (!d || d.id === hubDest.id) return;
    if (d._exitStop) return;
    if (d._entryStop) return;
    var dPlaceN = (typeof _normPlaceName === "function")
      ? _normPlaceName(d.place || "")
      : (d.place || "").toLowerCase();
    if (hubPlaceN && dPlaceN && hubPlaceN === dPlaceN) return;
    var dCoord = null;
    if (typeof d.lat === "number" && typeof d.lng === "number") dCoord = [d.lat, d.lng];
    else if (trip.candidates) {
      for (var ci2 = 0; ci2 < trip.candidates.length; ci2++) {
        var c2 = trip.candidates[ci2];
        if (c2 && c2.place === d.place && typeof c2.lat === "number" && typeof c2.lng === "number") {
          dCoord = [c2.lat, c2.lng]; break;
        }
      }
    }
    if (!dCoord) return;
    var km = _fqHaversineKm(hubCoord[0], hubCoord[1], dCoord[0], dCoord[1]);
    // Pull cached transit info if we have it (FQ already populated _fqPairMemo
    // for any pair the user has seen the verdict for).
    var info = _fqPairMemo[_fqPairKey(hubDest.place, d.place)] || null;
    var fastestH = info ? _fqFastestPractical(info) : Infinity;
    // If we don't have transit info, fall back to a haversine estimate
    // — assume ~80 km/h average door-to-door (drive or train) so the
    // user can still see candidates while LLM info is loading.
    var estH = (fastestH === Infinity) ? (km / 80) : fastestH;
    if (estH > thresholdH) return;
    // Find which days of the hub already have a daytrip-item targeting
    // this destination
    var scheduledDays = [];
    (hubDest.days || []).forEach(function(day, dIdx){
      (day.items || []).forEach(function(it){
        if (it && it.type === "daytrip" && it.dayTripPlace === d.place) {
          if (scheduledDays.indexOf(dIdx) < 0) scheduledDays.push(dIdx);
        }
      });
    });
    out.push({
      dest: d, distKm: km,
      fastestH: estH,
      info: info,
      scheduledDays: scheduledDays
    });
  });
  // Sort by closest first
  out.sort(function(a,b){return a.fastestH - b.fastestH;});

  // Round HG: kick off async LLM fetches for any pair without cached
  // transit info, then emit 'tripChange' once all resolve so the
  // Explore tab re-renders with refined fastestH values + transit
  // notes. Fire-and-forget; the caller needs the list synchronously
  // for immediate rendering, so the haversine/80 estimate stays as
  // the first-pass display.
  //
  // Only fetches for pairs that passed the threshold filter — pairs
  // that haversine/80 already excluded as too far don't get LLM info
  // because the road is almost always LONGER than straight-line, so
  // the conservative estimate would only overlook a pair if the road
  // is dramatically shorter (rare — water shortcuts, ferries). Worth
  // expanding to all trip pairs in a later round if those edge cases
  // surface.
  if (typeof _fqGetTransitInfo === "function" && hubCoord) {
    var _hgPending = [];
    out.forEach(function(c){
      if (c.info) return; // already cached
      var key = (typeof _fqPairKey === "function") ? _fqPairKey(hubDest.place, c.dest.place) : null;
      if (key && _fqInflight && _fqInflight[key]) return; // already in-flight
      _hgPending.push(_fqGetTransitInfo(hubDest.place, c.dest.place, c.distKm));
    });
    if (_hgPending.length && typeof MaxEngineTrip !== "undefined" && typeof MaxEngineTrip.emit === "function") {
      Promise.all(_hgPending).then(function(){
        // Re-render the active view; central subscription handles the rest.
        MaxEngineTrip.emit("tripChange");
      }).catch(function(){ /* per-pair errors already handled in _fqGetTransitInfo */ });
    }
  }

  return out;
}

// Context stores
var _sightStories = {};
var _destStories  = {};
var _destNotes    = {};  // { destId: {text, hidden, seen, createdAt} }
var _ffHistories  = {};

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._applyTripDateChange = _applyTripDateChange;
  __expg._destNotes = _destNotes;
  __expg._destStories = _destStories;
  __expg._ffHistories = _ffHistories;
  __expg._fqBannerInnerHtml = _fqBannerInnerHtml;
  __expg._ftGetThresholdHours = _ftGetThresholdHours;
  __expg._ftPeerDayTripCandidates = _ftPeerDayTripCandidates;
  __expg._ftRecomputeTripDates = _ftRecomputeTripDates;
  __expg._ftResizeDestDays = _ftResizeDestDays;
  __expg._ftReverseNightTransfer = _ftReverseNightTransfer;
  __expg._ftSchedulePeerDayTrip = _ftSchedulePeerDayTrip;
  __expg._openTripDatesEditor = _openTripDatesEditor;
  __expg._sightStories = _sightStories;
}
