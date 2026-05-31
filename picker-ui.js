// picker-ui.js — UI rendering for the picker (Round HW: Phase 4 of
// the engine/UI split).
//
// Where this fits:
//   db.js              persistence + DB-event bus
//   engine-trip.js     trip state + mutators + FQ verdict pipeline
//   engine-picker.js   picker state + orderKept + publishTrip
//   picker-ui.js       (THIS FILE) picker DOM rendering + UI events
//   index.html (UI)    everything else, shrinking over time
//
// Architectural intent — picker-ui.js is the DOM side of the picker.
// engine-picker.js owns brief/candidate state and the build pipeline;
// picker-ui.js owns the picker's DOM rendering and event wiring.
// Subscribers register via MaxEnginePicker.on('candidatesChange'|
// 'briefChange') and re-render when state changes. The engine never
// touches the DOM; the UI never mutates state directly (it dispatches
// through engine APIs).
//
// Where we are vs. where we want to be:
//   * Today's picker render functions are 800+ lines, deeply tangled
//     with _ceMap (Leaflet), _ceMarkers, FQ verdict rendering, and
//     toggles that mutate _tb.candidates directly. A single big lift-
//     and-shift would risk breaking the build flow (we already saw
//     that pain in HM).
//   * HW lays the foundation: this file exists, exposes MaxPickerUI
//     as the public surface, runs in IIFE, and contains the first
//     concrete UI helper (_renderPickerCategoryNav). Future rounds
//     (HW.1, HW.2, …) move more in — each one small enough to verify
//     against the engine tests + a headed Playwright run before the
//     next move.
//
// The pattern from each move:
//   1. Identify a UI helper that's clean (no _tb mutation, narrow
//      DOM ownership, no deep coupling with the big render).
//   2. Move it physically into this file.
//   3. Alias on window for the inline-script call sites that still
//      reference it by bare name.
//   4. Bump SW, add a comment block, run engine tests.
//
// Window globals consumed (intentionally — back-compat with inline
// script during the migration):
//   _CATEGORIES            — picker category metadata (emoji, label)
//   _ceMap                 — Leaflet map instance for the picker
//   _ceMarkers             — candidate / airport marker array
//   _edMarkers             — entry-point marker array
//   _edActivePopupId       — id of the currently-open entry popup
//   _tb                    — picker draft state (engine)
//   _tbEntryPointsVisible  — flag for whether to draw entry-point pins
//   _epCache               — region → entry points (lazy fetched)
//   _epIconFor             — icon factory by entry-point type
//   _EP_TYPE_TO_MODE       — entry-point type → transport mode
//   _EP_MODE_LABEL         — transport mode → display label
//   L                      — Leaflet

(function (global) {
  'use strict';

  // ── Round HW: _renderPickerCategoryNav ────────────────────
  // Moved from index.html (line ~6730). Reads _CATEGORIES (still
  // inline; consumed by both UI and the heuristic mapper). Writes to
  // #tb-cat-nav. No state mutation — pure DOM.
  //
  // Behavior unchanged from the inline version:
  //   * Hides the nav when fewer than 2 categories are active.
  //   * Renders one chip per active category, with a count badge for
  //     checked items in that category.
  //   * Click on chip scrolls to the matching anchor.

  function _renderPickerCategoryNav(activeMap, items) {
    var nav = document.getElementById("tb-cat-nav");
    if (!nav) return;
    var activeCats = Object.keys(activeMap || {});
    if (activeCats.length < 2) { nav.style.display = "none"; nav.innerHTML = ""; return; }
    nav.innerHTML = "";
    var row = document.createElement("div");
    // v294.4: was flex-wrap:nowrap + overflow-x:auto (horizontal
    // scroll for many chips). On systems with hidden scrollbars
    // (default macOS) this clipped chips off the right edge with
    // no affordance that more existed. Wrap to multiple lines —
    // every chip visible at once, sticky position still works.
    row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding-bottom:4px;";
    var cats = global._CATEGORIES || [];
    // v301: count badges on each chip removed. The number was the count
    // of items the user had just checked themselves — information they
    // already had. Pure decoration. Chips are nav now: click to scroll.
    cats.forEach(function (c) {
      if (!activeMap[c.id]) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.style.cssText = "font-size:11px;font-weight:600;color:#444;background:#fff;border:1px solid #d8d4c8;padding:5px 10px;border-radius:14px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;line-height:1.2;flex-shrink:0;white-space:nowrap;";
      chip.innerHTML = '<span style="font-size:13px;">' + c.emoji + '</span><span>' + (c.shortLabel || c.label) + '</span>';
      chip.onmouseover = function () { chip.style.background = "#f5f5f5"; };
      chip.onmouseout  = function () { chip.style.background = "#fff"; };
      (function (catId) {
        chip.onclick = function () {
          var anchor = document.getElementById("tb-cat-anchor-" + catId);
          if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        };
      })(c.id);
      row.appendChild(chip);
    });
    nav.appendChild(row);
    nav.style.display = "block";
  }

  // ── Round HW.1: _addAirportsToCeMap ───────────────────────
  // Moved from index.html (line ~4976). Adds blue ✈ pins to the
  // picker's Leaflet map for each airport in _tb.airports. Distinct
  // marker style from candidate pins so the user can tell them apart.
  // Pure DOM/Leaflet — no state mutation beyond pushing into the
  // shared _ceMarkers array.

  function _addAirportsToCeMap() {
    if (!global._ceMap || !global._tb || !global._tb.airports || !global._tb.airports.length) return;
    var L = global.L;
    if (!L) return;
    global._tb.airports.forEach(function (a) {
      if (!a.lat || !a.lng) return;
      var iconHtml = '<div style="background:#fff;color:#1a5fa8;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #1a5fa8;box-shadow:0 1px 4px rgba(0,0,0,.2);">✈</div>';
      var icon = L.divIcon({ html: iconHtml, className: "", iconSize: [22, 22], iconAnchor: [11, 11] });
      var m = L.marker([a.lat, a.lng], { icon: icon, zIndexOffset: -100 });
      var label = a.name + (a.code ? " (" + a.code + ")" : "") + (a.city ? " — " + a.city : "");
      m.bindTooltip(label, { permanent: false, direction: "top", offset: [0, -14], className: "ce-map-tooltip" });
      m.addTo(global._ceMap);
      if (global._ceMarkers) global._ceMarkers.push(m);
    });
  }

  // ── Round HW.1: _renderEntryPointsOnCeMap ─────────────────
  // Moved from index.html (line ~10591). Plants entry-point markers
  // (airports, rail stations, ports, bus terminals) on the picker
  // map for the active region. Each marker has a popup with two CTAs
  // ("Enter here" / "Leave here") that call _tbUseEntryPoint.
  //
  // State touched: clears + repopulates _edMarkers; reads _epCache,
  // _tbEntryPointsVisible, _edActivePopupId.

  function _renderEntryPointsOnCeMap(region) {
    if (!global._ceMap) return;
    var L = global.L;
    if (!L) return;
    // Clear existing entry markers + any connectors from a prior render.
    if (global._edMarkers && Array.isArray(global._edMarkers)) {
      global._edMarkers.forEach(function (rec) {
        if (rec.marker && global._ceMap) { try { global._ceMap.removeLayer(rec.marker); } catch (e) {} }
      });
    }
    global._edMarkers = [];
    if (global._edConnectors && Array.isArray(global._edConnectors)) {
      global._edConnectors.forEach(function (line) {
        if (line && global._ceMap) { try { global._ceMap.removeLayer(line); } catch (e) {} }
      });
    }
    global._edConnectors = [];
    if (!global._tbEntryPointsVisible) return;
    var pts = (region && global._epCache && global._epCache[region]) || [];
    var typeToMode  = global._EP_TYPE_TO_MODE || {};
    var modeLabel   = global._EP_MODE_LABEL || {};
    var iconFor     = global._epIconFor;

    // Round FN.C.2: which entry-points are the user's CURRENT picks?
    // The marker(s) matching _tb.entry / _tb.tbExit get the trip-view
    // gateway styling (larger white-bg pin with mode glyph) and a thin
    // dashed connector to the closest kept candidate, so the user can
    // tell at a glance which of the visible airports they actually
    // selected. Alternatives keep the original smaller marker.
    var tb = global._tb || {};
    var curEntryNorm = String(tb.entry  || "").toLowerCase().trim();
    var curExitNorm  = String(tb.tbExit || "").toLowerCase().trim();
    var modeGlyphFn = (typeof global._modeGlyph === "function") ? global._modeGlyph : function(){ return "✈"; };
    var entryGlyph = modeGlyphFn(tb.entryMode || "fly");
    var exitGlyph  = modeGlyphFn(tb.exitMode  || "fly");
    // Compute anchor coordinates for connector lines: first kept
    // candidate (for entry) and last (for exit). Same ordering helper
    // as the realism gate + the Max-suggests card uses.
    var keptCands = (tb.candidates || []).filter(function(c){ return c.status === "keep"; });
    // Edit-mode fallback (matches the card in index.html): when
    // re-entering the picker on an existing trip, candidates may
    // be empty; trip.destinations is the source of truth.
    if (!keptCands.length && global.trip && Array.isArray(global.trip.destinations)
        && global.trip.destinations.length) {
      keptCands = global.trip.destinations.map(function(d){
        return {
          place: d.place,
          lat: (typeof d.lat === "number") ? d.lat : null,
          lng: (typeof d.lng === "number") ? d.lng : null,
          nights: d.nights || 0,
          status: "keep"
        };
      });
    }
    var orderedKeeps = keptCands.slice();
    try {
      var orderFn = (global.MaxEnginePicker && typeof global.MaxEnginePicker.orderKeptCandidates === "function")
                    ? global.MaxEnginePicker.orderKeptCandidates
                    : (typeof global.orderKeptCandidates === "function" ? global.orderKeptCandidates : null);
      if (orderFn && keptCands.length >= 2) {
        var orderRes = orderFn(keptCands, global._mdcItems || [], tb.entry || "", tb.tbExit || "");
        if (orderRes && Array.isArray(orderRes.ordered)) orderedKeeps = orderRes.ordered;
      }
    } catch (e) { /* swallow */ }
    function _anchorOf(c){
      if (!c) return null;
      if (typeof c.lat === "number" && typeof c.lng === "number"
          && isFinite(c.lat) && isFinite(c.lng)) return [c.lat, c.lng];
      var cc = (typeof global.getCityCenter === "function") ? global.getCityCenter(c.place) : null;
      return (cc && isFinite(cc[0]) && isFinite(cc[1])) ? cc : null;
    }
    var entryAnchorCtr = _anchorOf(orderedKeeps[0]);
    var exitAnchorCtr  = _anchorOf(orderedKeeps[orderedKeeps.length - 1]);

    function _selectedGatewayIcon(glyph){
      var size = 28;
      var color = "#1a5fa8";
      var html = '<div style="background:#fff;border:2px solid ' + color + ';border-radius:50%;'
        + 'width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;'
        + 'font-size:15px;line-height:1;color:' + color + ';'
        + 'box-shadow:0 2px 6px rgba(0,0,0,0.3);">' + glyph + '</div>';
      return L.divIcon({
        className: "ce-selected-gateway-pin",
        html: html,
        iconSize: [size, size],
        iconAnchor: [size/2, size/2]
      });
    }

    pts.forEach(function (p) {
      if (typeof iconFor !== 'function') return;
      var nameNorm = String(p.name || "").toLowerCase().trim();
      var isSelectedEntry = curEntryNorm && nameNorm === curEntryNorm;
      var isSelectedExit  = curExitNorm  && nameNorm === curExitNorm;
      // Selected gateway gets a distinct icon + bumped z-index so it
      // sits above alternative markers in the same area.
      var iconForThis = (isSelectedEntry || isSelectedExit)
        ? _selectedGatewayIcon(isSelectedEntry ? entryGlyph : exitGlyph)
        : iconFor(p.type);
      var zIndexForThis = (isSelectedEntry || isSelectedExit) ? 700 : 500;
      var m = L.marker([p.lat, p.lon], { icon: iconForThis, zIndexOffset: zIndexForThis }).addTo(global._ceMap);
      var safeName = (p.name || "").replace(/\\/g, "\\\\").replace(/"/g, '&quot;').replace(/'/g, "\\'");
      var notes = p.notes ? '<div style="font-size:10px;color:#666;margin-top:4px;line-height:1.45;">' + p.notes.replace(/</g, "&lt;") + '</div>' : '';
      var typeLabel = { air: "Airport", rail: "Rail station", sea: "Port", bus: "Bus terminal" }[p.type] || "Entry point";
      var mode = typeToMode[p.type] || "";
      var modeTag = mode && modeLabel[mode] ? " " + modeLabel[mode] : "";
      // Tooltip on selected gateways so the user knows what the
      // distinct icon means without clicking through to the popup.
      if (isSelectedEntry || isSelectedExit) {
        var tipLabel = (p.name || "") + " — " + (isSelectedEntry ? "your arrival" : "your departure");
        m.bindTooltip(tipLabel, { permanent: false, direction: "top", offset: [0, -16], className: "ce-map-tooltip" });
      }
      m.bindPopup(
        '<div style="font-size:12px;font-weight:600;color:#111;">' + (p.name || "").replace(/</g, "&lt;") + '</div>'
        + '<div style="font-size:9px;color:#aaa;text-transform:uppercase;letter-spacing:.05em;margin-top:1px;">' + typeLabel + '</div>'
        + notes
        + '<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">'
        +   '<button onclick="_tbUseEntryPoint(true,&quot;' + safeName + '&quot;,&quot;' + mode + '&quot;)" style="font-size:10px;padding:4px 8px;background:#111;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:inherit;">Enter here' + modeTag + '</button>'
        +   '<button onclick="_tbUseEntryPoint(false,&quot;' + safeName + '&quot;,&quot;' + mode + '&quot;)" style="font-size:10px;padding:4px 8px;background:#fff;color:#111;border:1px solid #111;border-radius:4px;cursor:pointer;font-family:inherit;">Leave here' + modeTag + '</button>'
        + '</div>'
      );
      m.on("popupopen",  function () { global._edActivePopupId = p.id || p.name; });
      m.on("popupclose", function () { if (global._edActivePopupId === (p.id || p.name)) global._edActivePopupId = null; });
      global._edMarkers.push({ ep: p, marker: m });
      if (global._edActivePopupId && (p.id || p.name) === global._edActivePopupId) {
        setTimeout(function () { try { m.openPopup(); } catch (e) {} }, 50);
      }
      // Connector to the closest kept candidate.
      if (isSelectedEntry && entryAnchorCtr) {
        var c1 = L.polyline([[p.lat, p.lon], entryAnchorCtr], {
          color: "#1a5fa8", weight: 1.5, opacity: 0.5,
          dashArray: "4 4", interactive: false
        }).addTo(global._ceMap);
        global._edConnectors.push(c1);
      }
      if (isSelectedExit && exitAnchorCtr) {
        var c2 = L.polyline([[p.lat, p.lon], exitAnchorCtr], {
          color: "#1a5fa8", weight: 1.5, opacity: 0.5,
          dashArray: "4 4", interactive: false
        }).addTo(global._ceMap);
        global._edConnectors.push(c2);
      }
    });
  }

  // ── Round HX.3: _makeCandidateIcon ────────────────────────
  // Moved from index.html (was inside renderCandidateCards). Builds
  // a Leaflet divIcon for a candidate pin. Three variants:
  //   * normal: 24px, blue/green/gray by status, white border.
  //   * grayed: 22px, dashed white border, slight transparency —
  //     used when "Show me the best" hides this candidate.
  //   * selected: 30px with a pulsing gold ring overlay so the user
  //     can spot which candidate they just tapped on a card.
  //
  // No state mutation, no engine reads. Pure factory. The caller is
  // responsible for adding it to the map via L.marker(...).

  // ── Round FN.F.1: single-sight candidate detection ──────────
  // A "single-sight" candidate is a place where there's effectively
  // one thing to see/do — a waterfall, a viewpoint, a hot spring —
  // rather than a city/town worth sleeping in. Max identifies these
  // but DOES NOT pre-assign a role (wayside vs day-trip): the user
  // decides per place. The principle: Max suggests, user decides.
  //
  // Heuristic for MVP:
  //   * Explicit flag: c.singleSight === true (set by future LLM
  //     prompt update; honored now if present).
  //   * c.status === "keep" AND zero nights AND no role committed
  //     yet (intent is null/undefined/"stay" without explicit user
  //     action). A 0-night "stay" is the LLM's way of saying "this
  //     place isn't a hub" — that's the same population we want to
  //     surface as needs-a-role.
  //
  // Returns true when this candidate should render with a "?" pin
  // and surface in the "decide how to fit it" affordance.
  function _isSingleSight(c) {
    if (!c || typeof c !== "object") return false;
    if (c.singleSight === true) return true;
    if (c.status !== "keep") return false;
    var nights = (typeof c.nights === "number") ? c.nights : 0;
    if (nights > 0) return false;
    // If the user has already picked Wayside or Day-trip, it's no
    // longer single-sight — it's assigned.
    if (c.intent === "wayside" || c.intent === "dayTrip") return false;
    return true;
  }
  global._isSingleSight = _isSingleSight;

  function _makeCandidateIcon(c, grayed, selected) {
    var L = global.L;
    if (!L) return null;
    var ME = global.MaxEnginePicker;

    // Round NC.3b: defensive normalization. Ensures c.role and
    // c.overnightCapable are always present before we read them.
    // Idempotent — won't churn already-normalized candidates.
    if (ME && typeof ME.normalizeCandidateRole === "function") {
      ME.normalizeCandidateRole(c);
    }

    // ── See variant (Round NC.3b: replaces legacy singleSight) ──
    // "See" role: a place the user wants to visit but not stay
    // overnight. Renders as the gray "?" pin previously used for
    // singleSight. Only for kept candidates — proposed candidates
    // with role="see" still show as a normal proposed pin so the
    // user sees the LLM's full suggestion set with consistent
    // styling.
    var isSee = (!grayed && c.status === "keep" && c.role === "see");
    if (isSee) {
      var ssSize = selected ? 30 : 24;
      var ssRing = selected
        ? '<div style="position:absolute;top:-6px;left:-6px;width:' + (ssSize + 12) + 'px;height:' + (ssSize + 12) + 'px;border:3px solid #ffb300;border-radius:50%;box-shadow:0 0 10px rgba(255,179,0,0.55);pointer-events:none;animation:max-pin-pulse 1.6s ease-in-out infinite;"></div>'
        : '';
      var ssInner = '<div style="position:relative;background:#9ca3af;color:#fff;border-radius:50%;width:' + ssSize + 'px;height:' + ssSize + 'px;display:flex;align-items:center;justify-content:center;font-size:' + (selected ? 14 : 13) + 'px;font-weight:700;border:2px dashed #fff;box-shadow:0 1px 4px rgba(0,0,0,.25);">?</div>';
      var ssHtml = '<div style="position:relative;width:' + ssSize + 'px;height:' + ssSize + 'px;">' + ssRing + ssInner + '</div>';
      return L.divIcon({ html: ssHtml, className: "ce-see-pin", iconSize: [ssSize, ssSize], iconAnchor: [ssSize / 2, ssSize / 2] });
    }

    // ── Color for circular pins ──
    // Round NC.3b: kept pins read c.role exclusively. Stay → blue,
    // daytrip → purple, onway → teal (NC.3c will swap to an octagon
    // shape). Proposed (status null) stays blue with place-initials
    // label so the user can still tell "this is a suggestion" via
    // the lack-of-sequence-number. Reject stays gray.
    var _keptColor = "#1a5fa8";  // safe default if role missing
    if (c.status === "keep" && c.role && ME && typeof ME.pinColorForRole === "function") {
      _keptColor = ME.pinColorForRole(c.role);
    }
    var mc = grayed ? "#7a8090"
                    : (c.status === "keep" ? _keptColor
                      : c.status === "reject" ? "#888" : "#1a5fa8");
    var opacity = grayed ? 0.85 : 1;
    var borderStyle = grayed ? "2px dashed #fff" : "2px solid #fff";
    // Round HZ (picker hero map): render the candidate's sequence ordinal
    // (1, 2, 3 …) instead of the place-initials when it's in the route —
    // i.e. has an `order` set by _tbResequenceCandidates and isn't rejected.
    // Falls back to place-initials for rejected candidates and any
    // candidate not yet placed in a sequence.
    var hasOrdinal = (typeof c.order === "number" && isFinite(c.order) && c.status !== "reject");
    var pinSize = selected ? 30 : (grayed ? 22 : 24);
    var fontPx = selected ? 11 : (hasOrdinal ? 11 : 9);
    var label = hasOrdinal ? String(c.order + 1) : (c.place || "").substring(0, 2);
    var ring = selected
      ? '<div style="position:absolute;top:-6px;left:-6px;width:' + (pinSize + 12) + 'px;height:' + (pinSize + 12) + 'px;border:3px solid #ffb300;border-radius:50%;box-shadow:0 0 10px rgba(255,179,0,0.55);pointer-events:none;animation:max-pin-pulse 1.6s ease-in-out infinite;"></div>'
      : '';
    // Round NC.3c: onway candidates render as an octagon via CSS
    // clip-path (matches the trip-view onway pin shape).
    var _shapeCss = (c.status === "keep" && c.role === "onway")
      ? "border-radius:0;clip-path:polygon(30% 0%,70% 0%,100% 30%,100% 70%,70% 100%,30% 100%,0% 70%,0% 30%);"
      : "border-radius:50%;";
    var inner = '<div style="position:relative;background:' + mc + ';color:#fff;' + _shapeCss + 'width:' + pinSize + 'px;height:' + pinSize + 'px;display:flex;align-items:center;justify-content:center;font-size:' + fontPx + 'px;font-weight:700;border:' + borderStyle + ';box-shadow:0 1px 4px rgba(0,0,0,.25);opacity:' + opacity + ';">' + label + '</div>';
    var html = '<div style="position:relative;width:' + pinSize + 'px;height:' + pinSize + 'px;">' + ring + inner + '</div>';
    return L.divIcon({ html: html, className: "", iconSize: [pinSize, pinSize], iconAnchor: [pinSize / 2, pinSize / 2] });
  }

  // ── Round HX.9: renderMustDosSummary ─────────────────────
  // Builds the activity-lens "Your trip includes" summary block —
  // shown at the top of the picker so the user always sees their
  // train routes / activities / conditions / manual places they
  // asked for, regardless of whether candidate cards have landed
  // yet. Includes items marked checked=false too (grayed) so the
  // user sees the full mental picture.
  //
  // Each row has a toggle button that flips the must-do's checked
  // state via _toggleMustDoFromSummary (defined inline) — that
  // reconciles _tb.requiredPlaces and any candidate _required flags
  // before re-rendering.
  //
  // Inputs:
  //   allMustDos — pre-filtered (no __manual__, name present).
  //                Caller is responsible for the filter so this
  //                function is purely a renderer.
  //
  // Returns the wrapper element to append, or null if there are no
  // items. Caller decides where in the DOM tree to attach.
  //
  // External deps (window): MaxEnginePicker.routeArrow,
  // _toggleMustDoFromSummary.
  function _renderMustDosSummary(allMustDos) {
    if (!allMustDos || !allMustDos.length) return null;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:4px 4px 12px;padding:10px 12px;background:#fff;border:1px solid #e0e6ef;border-radius:8px;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:6px;';
    hdr.textContent = 'Your trip includes · ' + allMustDos.length;
    wrap.appendChild(hdr);
    // Badge labels. Routes are framed as travel legs, not activities — they
    // move the traveler between real destinations and happen to be scenic.
    var typeBadge = { route: '🚂 Scenic travel', activity: '✨ Activity', condition: '⚠ Condition', manual: '📌 Place' };
    var routeArrow = (global.MaxEnginePicker && global.MaxEnginePicker.routeArrow) || function (d) {
      return d === 'reverse' ? ' ← ' : (d === 'either' ? ' ↔ ' : ' → ');
    };
    allMustDos.forEach(function (m) {
      var row = document.createElement('div');
      var active = !!m.checked;
      row.style.cssText = 'padding:5px 0;font-size:11px;line-height:1.5;border-top:1px dotted #eee;color:'
        + (active ? '#333' : '#999') + ';display:flex;align-items:flex-start;gap:6px;';
      var badge = typeBadge[m.type] || ('• ' + (m.type || 'activity'));
      var desc = m.description ? ' <span style="color:' + (active ? '#666' : '#aaa') + ';">— ' + m.description + '</span>' : '';
      var off = active ? '' : ' <span style="font-size:9px;color:#c05020;font-weight:600;">off</span>';
      var bodyHtml = '<span style="flex:1;min-width:0;">'
        + '<span style="font-size:9px;color:' + (active ? '#1a5fa8' : '#aaa') + ';font-weight:600;margin-right:6px;">' + badge + '</span>'
        + '<strong style="color:' + (active ? '#111' : '#888') + ';">' + m.name + '</strong>'
        + off + desc;
      // Route endpoints on a second line so "Chur → Tirano" is obvious at a glance.
      if (m.type === 'route') {
        var eps = (m.endpoints || m.requiredPlaces || []);
        if (eps.length >= 2) {
          var arrow = routeArrow(m.direction);
          var epLine = '<div style="font-size:10px;color:' + (active ? '#1a5fa8' : '#aaa') + ';margin-top:2px;margin-left:2px;">'
            + eps.map(function (p) { return p.place; }).join(arrow) + '</div>';
          bodyHtml += epLine;
        }
      }
      bodyHtml += '</span>';
      // Toggle button — × when active (drop), ↺ when off (re-add).
      var toggleSym   = active ? '×' : '↺';
      var toggleTitle = active ? 'Drop from your trip' : 'Add back to your trip';
      var btnColor    = active ? '#aaa' : '#1a5fa8';
      var safeMdName = String(m.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      var btnHtml = '<button type="button" class="md-summary-toggle" '
        + 'data-mdname="' + safeMdName + '" '
        + 'title="' + toggleTitle + '" '
        + 'style="background:none;border:1px solid transparent;color:' + btnColor + ';font-size:14px;line-height:1;padding:0 6px;cursor:pointer;border-radius:4px;flex-shrink:0;font-family:inherit;font-weight:bold;">'
        + toggleSym + '</button>';
      row.innerHTML = bodyHtml + btnHtml;
      // Wire the click handler against the row's button.
      var btn = row.querySelector('.md-summary-toggle');
      if (btn) {
        (function (nm) {
          btn.onclick = function (ev) {
            ev.stopPropagation();
            if (typeof global._toggleMustDoFromSummary === 'function') {
              global._toggleMustDoFromSummary(nm);
            }
          };
          btn.onmouseover = function () { this.style.background = '#f5f5f5'; this.style.borderColor = '#e0e6ef'; };
          btn.onmouseout  = function () { this.style.background = 'none';   this.style.borderColor = 'transparent'; };
        })(m.name);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ── Round HX.8: renderRejectedSection ────────────────────
  // Builds the "Maybe later" collapsible section at the foot of the
  // picker — a bullet-list of rejected candidates with a Restore
  // button per row. Expanded by default so a freshly rejected place
  // visibly moves here instead of appearing to vanish.
  //
  // Inputs: an array of rejected candidates (caller is responsible
  // for filtering — typically `_hxParts.rejected` from
  // partitionByStatus). Returns the wrapper element to append, or
  // null if there's nothing to render.
  //
  // Reads window globals:
  //   _ceRejectedExpanded — boolean toggle state (persists across
  //                         re-renders so the user's open/closed
  //                         choice doesn't reset on every status flip)
  //   setCS               — restore handler from inline (status flip)
  //
  // Pure DOM. The toggle's onclick mutates the global flag and the
  // list's display style; no engine state touched beyond that.
  function _renderRejectedSection(rejectedCands) {
    if (!rejectedCands || !rejectedCands.length) return null;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px solid #eee;';
    var toggle = document.createElement('div');
    var expanded = !!global._ceRejectedExpanded;
    toggle.style.cssText = 'font-size:10px;font-weight:600;color:#888;cursor:pointer;padding:6px 8px;user-select:none;background:#f5f5f5;border-radius:5px;display:flex;align-items:center;justify-content:space-between;';
    var hint = '<span style="font-weight:400;color:#aaa;">change your mind</span>';
    function labelHtml(isOpen) {
      return '<span>' + (isOpen ? '▾' : '▸') + '  Maybe later · ' + rejectedCands.length + '</span>' + hint;
    }
    toggle.innerHTML = labelHtml(expanded);
    var list = document.createElement('div');
    list.style.display = expanded ? 'block' : 'none';
    list.style.marginTop = '6px';
    toggle.onclick = function () {
      global._ceRejectedExpanded = !global._ceRejectedExpanded;
      list.style.display = global._ceRejectedExpanded ? 'block' : 'none';
      toggle.innerHTML = labelHtml(global._ceRejectedExpanded);
    };
    list.style.cssText += 'padding:4px 8px;background:#fafafa;border-radius:5px;';
    rejectedCands.forEach(function (c) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:11px;color:#555;border-bottom:1px dotted #eee;';
      var label = document.createElement('span');
      label.innerHTML = '<strong style="color:#333;">' + (c.place || '') + '</strong>'
        + (c.country ? ' <span style="color:#999;">· ' + c.country + '</span>' : '')
        + (c.role    ? ' <span style="color:#aaa;">· ' + c.role + '</span>'    : '');
      var btn = document.createElement('button');
      btn.textContent = 'Restore';
      btn.style.cssText = 'font-size:10px;padding:2px 8px;border:1px solid #cfd8e3;border-radius:4px;background:#fff;color:#1a5fa8;cursor:pointer;font-family:inherit;';
      (function (id) {
        btn.onclick = function () {
          if (typeof global.setCS === 'function') global.setCS(id, 'reject');
        };
      })(c.id);
      row.appendChild(label);
      row.appendChild(btn);
      list.appendChild(row);
    });
    wrap.appendChild(toggle);
    wrap.appendChild(list);
    return wrap;
  }

  // ── Round HX.7: renderCELensBar ──────────────────────────
  // Builds the "Organize by:" lens chip row above the candidate
  // sections. Three chips — Activity / Region / Status — and click
  // wiring that flips the global _ceLens and re-renders the cards.
  //
  // The "time" lens is intentionally NOT rendered here: comment in
  // the source explains it was removed from this page since
  // ordering depends on entry/exit which the user hasn't committed
  // yet at this stage. The schedule view (next page) is where time
  // ordering belongs.
  //
  // Reads: window._ceLens (the active lens key)
  // Writes: window._ceLens; calls window.renderCandidateCards
  //
  // Pure DOM construction — no engine state mutation beyond the
  // single _ceLens flag (which is picker-UI mode state, not
  // candidate state).
  function _renderCELensBar() {
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0;flex-wrap:wrap;align-items:center;';
    var label = document.createElement('span');
    label.style.cssText = 'font-size:9px;color:#999;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;margin-right:4px;';
    label.textContent = 'Organize by:';
    bar.appendChild(label);
    var lenses = [['activity', 'Activity'], ['region', 'Region'], ['commitment', 'Status']];
    lenses.forEach(function (pair) {
      var btn = document.createElement('button');
      var on = global._ceLens === pair[0];
      btn.style.cssText = 'font-size:10px;padding:4px 10px;border-radius:11px;border:1px solid '
        + (on ? '#111' : '#ddd') + ';background:' + (on ? '#111' : '#fff')
        + ';color:' + (on ? '#fff' : '#555')
        + ';cursor:pointer;font-family:inherit;font-weight:' + (on ? '700' : '500') + ';';
      btn.textContent = pair[1];
      (function (k) {
        btn.onclick = function () {
          global._ceLens = k;
          if (typeof global.renderCandidateCards === 'function') {
            global.renderCandidateCards(global._tb && global._tb.candidates);
          }
        };
      })(pair[0]);
      bar.appendChild(btn);
    });
    return bar;
  }

  // ── Round HX.5: renderCEStayTotal ────────────────────────
  // Moved from index.html. The picker summary's "your picks: N nights
  // · trip: M days" line. Pure DOM wrapper now — all the parsing,
  // summing, and over/under classification lives in
  // MaxEnginePicker.computeStayTotalSummary, called from here.
  //
  // Reads window globals:
  //   _tb.duration  — the brief's duration string ("10 days",
  //                   "2 weeks", etc.)
  // Writes:
  //   #ce-summary-stay innerHTML — empty string if there's nothing
  //                   sensible to show, otherwise a span with status-
  //                   based color + the trip clause if duration parsed.
  //
  // Color cues match the original's "subtle hint, no shaming" tone:
  //   over  → #c05020 (warm red — picks exceed trip max)
  //   under → #2a7a4e (green — room to add more)
  //   fit   → #555    (neutral — within or near range)
  function _renderCEStayTotal(kept) {
    var sumHost = document.getElementById('ce-summary-stay');
    if (!sumHost) return;
    var brief = global._tb || {};
    var s = (global.MaxEnginePicker && global.MaxEnginePicker.computeStayTotalSummary)
      ? global.MaxEnginePicker.computeStayTotalSummary(kept, brief.duration || '')
      : { rangeStr: '', tripStr: null, status: 'empty' };
    if (s.status === 'empty' || s.status === 'unknown') {
      sumHost.innerHTML = '';
      return;
    }
    // v359.27: budget meter — clearer status pill + tooltip-like context
    // so the constraint is legible at a glance, not buried in prose.
    // Same status colors as the place-mode summary for consistency.
    if (s.tripStr) {
      var bg = s.status === 'over' ? '#fff3ed'
             : s.status === 'under' ? '#f0f7ec'
             : '#f0f7fc';
      var bd = s.status === 'over' ? '#f5ccb5'
             : s.status === 'under' ? '#cae0bb'
             : '#c8dde8';
      var fg = s.status === 'over' ? '#b0451a'
             : s.status === 'under' ? '#3f6a2a'
             : '#1a5fa8';
      var label = s.status === 'over' ? 'Over budget' : (s.status === 'under' ? 'Under budget' : 'Fits budget');
      sumHost.innerHTML =
        '<span style="display:inline-block;padding:3px 9px;border-radius:11px;background:' + bg + ';border:1px solid ' + bd + ';color:' + fg + ';font-weight:600;font-size:10.5px;letter-spacing:.01em;">'
          + label
        + '</span>'
        + ' <span style="color:#666;">' + s.rangeStr + ' · ' + s.tripStr + '</span>';
    } else {
      sumHost.innerHTML = '<span style="color:#666;">Your picks: ' + s.rangeStr + '</span>';
    }
  }

  // ── HX.11 (v307): _renderMustDoSection ────────────────────
  // Lifted from index.html's inline picker code. Renders a
  // single must-do's section: header + description + endpoint
  // line (for routes) + endpoint highlights + empty-state hint
  // + per-candidate cards.
  //
  // Inline closure deps lifted to explicit args:
  //   - candByPrimary  — { mdName: cand[] } map computed by caller
  //   - mdcItems       — must-do items list (was outer _mdcItems)
  //   - container      — DOM node to append the section to (the
  //                      inline version had `container` as a param
  //                      but ignored it and used outer `el`; fixed)
  //
  // Globals still referenced (intentionally; these are inline-
  // only and not worth lifting in this round):
  //   - global._dropActivity (handler for the Drop button)
  //   - global.renderCard    (HX.12 will lift this; for now
  //                            we read from global)
  //   - MaxEnginePicker.mustDoSectionRenderable, mustDoSectionTitle,
  //     routeArrow (already namespaced)
  function _renderMustDoSection(mdName, container, candByPrimary, mdcItems) {
    if (!container) return;
    var group = (candByPrimary && candByPrimary[mdName]) || [];
    var mdItem = (mdcItems || []).find(function (m) { return m.name === mdName; });
    var sectionType = (mdItem && mdItem.type) || "activity";
    var alwaysRenderSection = global.MaxEnginePicker.mustDoSectionRenderable(sectionType, group.length > 0);
    if (!alwaysRenderSection) return;
    var sectionWrap = document.createElement("div");
    sectionWrap.style.cssText = "margin-top:14px;padding:10px 10px 8px;background:#f7faff;border-radius:8px;border:1px solid #e8f0fc;";

    var hdrRow = document.createElement("div");
    hdrRow.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:8px;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "font-size:13px;font-weight:700;color:#1a5fa8;letter-spacing:0.02em;";
    hdr.textContent = global.MaxEnginePicker.mustDoSectionTitle(mdName, mdItem);
    hdrRow.appendChild(hdr);
    if (mdItem && mdItem.fromChip && mdItem.interest) {
      var chipSrc = document.createElement("div");
      chipSrc.style.cssText = "font-size:10px;color:#888;font-style:italic;";
      chipSrc.textContent = "from: " + mdItem.interest;
      hdrRow.appendChild(chipSrc);
    }
    var drop = document.createElement("button");
    drop.style.cssText = "font-size:10px;color:#888;background:none;border:none;cursor:pointer;font-family:inherit;padding:0;";
    drop.textContent = mdItem && mdItem.type === "route" ? "Drop this travel leg" : "Drop this activity";
    drop.title = mdItem && mdItem.type === "route"
      ? "Remove this travel leg from your plan. Endpoints stay only if kept for other reasons."
      : "Reject every destination under this activity and remove it from your trip.";
    (function (mName) {
      drop.onclick = function () { if (typeof global._dropActivity === "function") global._dropActivity(mName); };
    })(mdName);
    hdrRow.appendChild(drop);
    sectionWrap.appendChild(hdrRow);

    if (mdItem && mdItem.description) {
      var sub = document.createElement("div");
      sub.style.cssText = "font-size:11px;color:#555;line-height:1.55;margin-top:4px;";
      sub.textContent = mdItem.description;
      sectionWrap.appendChild(sub);
    }

    if (mdItem && mdItem.type === "route") {
      var eps = mdItem.endpoints || mdItem.requiredPlaces || [];
      if (eps.length >= 2) {
        var arrow = global.MaxEnginePicker.routeArrow(mdItem.direction);
        var routeLine = document.createElement("div");
        routeLine.style.cssText = "font-size:12px;font-weight:600;color:#1a5fa8;margin-top:6px;";
        routeLine.textContent = eps.map(function (p) { return p.place; }).join(arrow);
        sectionWrap.appendChild(routeLine);
      }
    }

    if (mdItem && mdItem.type === "route" && mdItem.endpointHighlights && typeof mdItem.endpointHighlights === "object") {
      var ehParts = [];
      (mdItem.requiredPlaces || mdItem.endpoints || []).forEach(function (p) {
        var h = mdItem.endpointHighlights[p.place] || mdItem.endpointHighlights[(p.place || "").toLowerCase()];
        if (h) ehParts.push('<div style="font-size:11px;color:#555;line-height:1.5;margin-top:2px;"><strong style="color:#333;">' + p.place + ':</strong> ' + h + '</div>');
      });
      if (ehParts.length) {
        var ehWrap = document.createElement("div");
        ehWrap.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px dashed #d8e4f0;";
        ehWrap.innerHTML = ehParts.join("");
        sectionWrap.appendChild(ehWrap);
      }
    }

    if (alwaysRenderSection && !group.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "font-size:10px;color:#999;font-style:italic;margin-top:6px;padding-top:6px;border-top:1px dashed #e0eaf5;";
      empty.textContent = (sectionType === "route")
        ? "Endpoint places will appear below as they load."
        : "Places for this activity will appear below as they load.";
      sectionWrap.appendChild(empty);
    }

    container.appendChild(sectionWrap);

    // Per-section candidate cards. renderCard is still inline (HX.12
    // will lift it); read from global so the lift order doesn't
    // matter.
    if (typeof global.renderCard === "function") {
      group.forEach(function (c) { global.renderCard(c, container); });
    }
  }


  // ── v359.31: Wikipedia summary fetch ──────────────────────
  // Cheap visual-triage assist for candidate cards. Wikipedia's REST
  // summary API returns a thumbnail + short factual description per
  // page; we use both as a structural anchor under the LLM prose.
  // 7-day localStorage cache keeps this graceful — re-renders are
  // instant, and a single picker session makes at most N fetches
  // (one per unique candidate place).
  //
  // No API key needed. CORS-enabled. Polite usage: caching + < ~20
  // requests per picker open.
  // v359.42: wiki cache moved to IDB via MaxDB.cache.wiki. localStorage
  // was filling up under user trip load and pushing trip writes out;
  // wiki cache is purely a performance optimization (re-fetchable) so
  // it doesn't belong in scarce sync storage. Helpers below delegate
  // to MaxDB and return Promises. _fetchWikiSummary chain awaits them.
  function _wikiCacheKey(place, country) {
    return (place||"").trim().toLowerCase()
      + ":"
      + (country||"").trim().toLowerCase();
  }
  function _wikiCacheGet(place, country) {
    if (window.MaxDB && MaxDB.cache && MaxDB.cache.wiki) {
      return MaxDB.cache.wiki.get(_wikiCacheKey(place, country));
    }
    return Promise.resolve(null);
  }
  function _wikiCacheSet(place, country, data) {
    if (window.MaxDB && MaxDB.cache && MaxDB.cache.wiki) {
      return MaxDB.cache.wiki.set(_wikiCacheKey(place, country), data);
    }
    return Promise.resolve();
  }
  // v359.38: image attribution helpers. The Wikimedia file page
  // carries license + author metadata in `extmetadata`. We fetch
  // these so the lightbox can show "Photo: {Artist} — {License}"
  // and comply with CC-BY / CC-BY-SA terms.
  function _stripHtml(s) {
    if (!s) return "";
    try {
      var d = document.createElement("div");
      d.innerHTML = s;
      return (d.textContent || d.innerText || "").trim();
    } catch(_) {
      return String(s).replace(/<[^>]+>/g, "").trim();
    }
  }
  // Extract the underlying file name from a Wikipedia upload URL.
  // /thumb/X/XX/{filename}/NNNpx-...  → filename
  // /commons/X/XX/{filename}          → filename
  function _wikiFilenameFromUrl(url) {
    if (!url) return null;
    var m = url.match(/\/thumb\/[a-f0-9]\/[a-f0-9]{2}\/([^/]+)\//);
    if (m) return decodeURIComponent(m[1]);
    m = url.match(/\/commons\/[a-f0-9]\/[a-f0-9]{2}\/([^/]+)$/);
    if (m) return decodeURIComponent(m[1]);
    return null;
  }
  function _fetchImageAttribution(thumbUrl) {
    var filename = _wikiFilenameFromUrl(thumbUrl);
    if (!filename) return Promise.resolve(null);
    var fileTitle = encodeURIComponent("File:" + filename);
    var url = "https://en.wikipedia.org/w/api.php?action=query&titles=" + fileTitle + "&prop=imageinfo&iiprop=extmetadata&format=json&origin=*";
    return fetch(url, { headers: { "accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if (!j || !j.query || !j.query.pages) return null;
        var pages = j.query.pages;
        var first = Object.keys(pages).map(function(k){ return pages[k]; })[0];
        var info = first && first.imageinfo && first.imageinfo[0];
        var meta = info && info.extmetadata;
        if (!meta) return null;
        var artist = _stripHtml((meta.Artist && meta.Artist.value) || "");
        var licenseShort = (meta.LicenseShortName && meta.LicenseShortName.value) || "";
        var licenseUrl = (meta.LicenseUrl && meta.LicenseUrl.value) || "";
        if (!artist && !licenseShort) return null;
        return { artist: artist, licenseShort: licenseShort, licenseUrl: licenseUrl };
      })
      .catch(function(){ return null; });
  }

  // v359.34: when the REST summary has no thumbnail, fall back to the
  // Action API's pageimages endpoint — the same image Wikipedia search
  // uses. Catches places whose article has no infobox image but does
  // have photos elsewhere on the page. Keeps the existing description
  // + extract from summary; only fills in thumbUrl on the second hop.
  function _fetchPageImage(title) {
    // origin=* required for CORS on the Action API
    var url = "https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=400&titles=" + title + "&origin=*";
    return fetch(url, { headers: { "accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if (!j || !j.query || !j.query.pages) return null;
        var pages = j.query.pages;
        var first = Object.keys(pages).map(function(k){ return pages[k]; })[0];
        return (first && first.thumbnail && first.thumbnail.source) || null;
      })
      .catch(function(){ return null; });
  }

  // v359.37: Wikipedia search — for places whose verbatim summary
  // returns 404 or a disambiguation page (e.g. "Vik" → disambig,
  // canonical is "Vík í Mýrdal"; "Hofn" → no article, canonical is
  // "Höfn"). Returns the best-match article title, or null.
  function _wikiSearch(place, country) {
    var query = encodeURIComponent((place + (country ? " " + country : "")).trim());
    var url = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + query + "&srlimit=3&format=json&origin=*";
    return fetch(url, { headers: { "accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if (!j || !j.query || !Array.isArray(j.query.search) || !j.query.search.length) return null;
        // Skip search results that look like disambiguation pages by
        // name — the summary endpoint will filter those too, but this
        // saves us a roundtrip.
        for (var i = 0; i < j.query.search.length; i++) {
          var title = j.query.search[i].title;
          if (!title) continue;
          if (/\(disambiguation\)$/i.test(title)) continue;
          return title;
        }
        return null;
      })
      .catch(function(){ return null; });
  }

  // Build the cached data shape from a REST summary response.
  function _buildWikiData(j) {
    return {
      thumbUrl: (j.thumbnail && j.thumbnail.source) || null,
      originalUrl: (j.originalimage && j.originalimage.source) || null,
      description: j.description || null,
      extract: j.extract || null,
    };
  }

  function _fetchSummaryByTitle(title) {
    var url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + title;
    return fetch(url, { headers: { "accept": "application/json" } })
      .then(function(r){ return r.ok ? r.json() : null; });
  }

  // v359.46: detect "looks-like-a-place-not-a-film" from the summary
  // description. Catches the Blue-Lagoon-as-1980-movie case where
  // Wikipedia's direct title lookup returns a non-place article that
  // happens to share the name. When this fires we fall through to
  // _wikiSearch which biases by country and reliably returns the
  // geographic article.
  function _looksLikePlace(j) {
    if (!j || !j.description) return true; // no description — accept (rare)
    var d = j.description.toLowerCase();
    var nonPlace = /\b(film|movie|song|album|book|novel|tv series|video game|comic|band|musician|composer|episode|fictional|character|video|game|series)\b/;
    if (nonPlace.test(d)) return false;
    return true;
  }

  // Round NC.X: in-flight dedupe so concurrent renders of the same
  // place don't issue parallel Wikipedia 404 requests for unknown
  // titles. The async IDB cache only sees stored results AFTER a
  // fetch resolves — two near-simultaneous calls would both miss
  // and each fire its own 404. This memo holds the in-flight promise
  // until the result lands in IDB.
  var _wikiInFlight = {};
  function _fetchWikiSummary(place, country) {
    if (!place) return Promise.resolve(null);
    var key = (place || "") + "|" + (country || "");
    if (_wikiInFlight[key]) return _wikiInFlight[key];
    // v359.42: cache is async now (IDB). Wrap the entire fetch chain
    // in the cache-lookup promise.
    var p = _wikiCacheGet(place, country).then(function (cached) {
      if (cached !== null && cached !== undefined) return cached;
      return _fetchWikiSummaryUncached(place, country);
    }).then(function(result){
      delete _wikiInFlight[key];
      return result;
    }, function(err){
      delete _wikiInFlight[key];
      throw err;
    });
    _wikiInFlight[key] = p;
    return p;
  }

  function _fetchWikiSummaryUncached(place, country) {
    var title = encodeURIComponent(place.trim().replace(/ /g, "_"));

    // Step 1: try the place name verbatim.
    return _fetchSummaryByTitle(title)
      .then(function(j){
        // Accept only if it's a real place article (not a disambig,
        // not a film/book/etc that shares the name).
        if (j && j.type !== "disambiguation" && _looksLikePlace(j)) return j;
        // Otherwise search with country bias.
        return _wikiSearch(place, country).then(function(altTitle){
          if (!altTitle) return null;
          var altEncoded = encodeURIComponent(altTitle.replace(/ /g, "_"));
          return _fetchSummaryByTitle(altEncoded).then(function(j2){
            if (j2 && j2.type !== "disambiguation" && _looksLikePlace(j2)) return j2;
            return null;
          });
        });
      })
      .then(function(j){
        if (!j) {
          _wikiCacheSet(place, country, null);
          return null;
        }
        var data = _buildWikiData(j);
        if (data.thumbUrl) {
          return data;
        }
        // Step 3: no thumbnail in summary — try the Action API
        // pageimages endpoint as a last-resort image source.
        var resolvedTitle = encodeURIComponent((j.title || place).replace(/ /g, "_"));
        return _fetchPageImage(resolvedTitle).then(function(altThumb){
          if (altThumb) data.thumbUrl = altThumb;
          return data;
        });
      })
      .then(function(data){
        if (!data) return null;
        // v359.38: attribution fetch — only when we have an image.
        // Adds ~150ms per place on first fetch; cached afterward.
        var attrSrc = data.thumbUrl || data.originalUrl;
        if (!attrSrc) {
          _wikiCacheSet(place, country, data);
          return data;
        }
        return _fetchImageAttribution(attrSrc).then(function(attr){
          if (attr) data.attribution = attr;
          _wikiCacheSet(place, country, data);
          return data;
        });
      })
      .catch(function(err){
        console.warn("[Max wiki] fetch failed for", place, err && err.message);
        // v359.60.7: cache the failure (null) so the next render
        // doesn't re-fire the same Wikipedia request — that's the
        // path that produces hundreds of 429 errors when the network
        // is down OR Wikipedia is rate-limiting us. The user can
        // refresh the page to retry once conditions improve; without
        // this cache, each render attempt re-fetches and re-fails.
        try { _wikiCacheSet(place, country, null); } catch(_){}
        return null;
      });
  }

  // ── HX.12 (v308): renderCandidateCard ─────────────────────
  // v359.40 CLEANUP NOTE: this card renderer is for the
  // candidate-explorer overlay which is no longer in the active
  // flow. The live picker is the place-mode/destination-view
  // (_renderPlaceActivityItems in index.html), and it does not call
  // this function. Kept as-is so MaxPickerUI.renderCandidateCard
  // still resolves if anything reaches for it.
  //
  // Everything from v359.20 onward inside this function (role chip,
  // thumbnail placeholder, Wikipedia fetch, focus-deep-link) is dead
  // code by association — none of it executes when the function
  // isn't called. New work should target the place-mode picker
  // surfaces instead.
  //
  // Lifted from index.html's inline `renderCard`. Renders a
  // single candidate's compact + expanded card: name, role,
  // stayRange, kept/reject buttons, expand chevron, and on
  // expand the why-it-fits / tags / tradeoffs / Compare button.
  // Also calls back into the closure to add the marker on the
  // picker map after the card is appended.
  //
  // Inline closure deps lifted to explicit args:
  //   - primaryByCandId  — { candId: mdItem } map computed by caller
  //   - addMarkerFn(c, grayed) — closure helper that pushes to
  //     bounds + _ceMarkers; stays inline because of its own
  //     locals
  //   - mdcItems — must-do items list (defaults to global._mdcItems)
  //
  // Globals still referenced (read at call time so reload order
  // doesn't matter):
  //   - global.setCS, global.doCompare, global._ceSelectCandidateOnMap
  //   - global.renderCandidateCards (re-renders the list when expand toggles)
  //   - global._ceCardExpanded, global._tb (state)
  //   - MaxEnginePicker.classifyCandidateBadge / .alsoHereText
  function _renderCandidateCard(c, container, primaryByCandId, addMarkerFn, mdcItems) {
    if (!c || !container) return;
    var ME = global.MaxEnginePicker;
    var ceCardExpanded = global._ceCardExpanded || {};
    mdcItems = mdcItems || global._mdcItems || [];

    var card = document.createElement("div");
    card.className = "ce-card" + (c.status ? " " + c.status : "");
    card.id = "ce-card-" + c.id;
    var expanded = !!ceCardExpanded[c.id];

    var primary = primaryByCandId ? primaryByCandId[c.id] : null;
    var _hxBadge = ME ? ME.classifyCandidateBadge(c, primary, mdcItems) : { kind: 'none' };
    var reqBadge = '';
    if (_hxBadge.kind === 'manual') {
      reqBadge = '<div style="font-size:9px;font-weight:700;color:#2a7a4e;background:#e8f5ee;padding:2px 7px;border-radius:10px;margin:2px 0 4px;display:inline-block;">📌 A must-see for you</div>';
    } else if (_hxBadge.kind === 'also') {
      reqBadge = '<div style="font-size:9px;font-weight:700;color:#1a5fa8;background:#e8f0fc;padding:2px 7px;border-radius:10px;margin:2px 0 4px;display:inline-block;">You will also find:' + _hxBadge.refs.join(", ") + '</div>';
    } else if (_hxBadge.kind === 'required') {
      var label = _hxBadge.isRoute ? "Stop on" : "Required for";
      reqBadge = '<div style="font-size:9px;font-weight:700;color:#1a5fa8;background:#e8f0fc;padding:2px 7px;border-radius:10px;margin:2px 0 4px;display:inline-block;">🚂 ' + label + ': ' + _hxBadge.refs.join(", ") + '</div>';
    }

    var alsoHere = ME ? ME.alsoHereText(c, primary, mdcItems) : '';
    var alsoHereHtml = alsoHere
      ? '<div style="font-size:11px;color:#555;line-height:1.5;margin-top:4px;"><strong style="color:#333;font-weight:600;">Also here:</strong> ' + alsoHere + '</div>'
      : '';

    var keptDot = c.status === "keep"
      ? '<span style="color:#2a7a4e;font-weight:700;margin-right:2px;">✓</span>'
      : (c.status === "reject" ? '<span style="color:#c05020;font-weight:700;margin-right:2px;">×</span>' : '');

    // Round NC.3b: role indicator on the Discovery card. Replaces the
    // legacy "Overnight / Day trip from X" chip with the unified
    // role vocabulary (stay / see / daytrip / onway). Stay & See are
    // toggle-able right here on the card; daytrip & onway are set in
    // the Trip View popover and render as read-only badges here.
    var _roleChip = '';
    if (c.status === "keep") {
      if (c.role === "daytrip") {
        _roleChip = '<span style="font-size:10px;font-weight:600;color:#7c3aed;background:#f3eaff;border:1px solid #d6c2f5;padding:2px 7px;border-radius:10px;display:inline-block;white-space:nowrap;">Day trip</span>';
      } else if (c.role === "onway") {
        _roleChip = '<span style="font-size:10px;font-weight:600;color:#0891b2;background:#e6f6f8;border:1px solid #a7dde6;padding:2px 7px;border-radius:10px;display:inline-block;white-space:nowrap;">On the way</span>';
      } else if (c.overnightCapable === false) {
        // Non-capable: locked to See, no toggle.
        _roleChip = '<span title="No overnight infrastructure — this place is See-only." style="font-size:10px;font-weight:600;color:#666;background:#f0f0f0;border:1px solid #ddd;padding:2px 7px;border-radius:10px;display:inline-block;white-space:nowrap;">👁 See</span>';
      } else {
        // Capable: two-button Stay / See toggle.
        var _staySelected = (c.role === "stay");
        _roleChip = '<span class="ce-role-toggle" data-cand-id="' + c.id + '" style="display:inline-flex;align-items:center;gap:0;border:1px solid #ccc;border-radius:10px;overflow:hidden;font-size:10px;font-weight:600;">'
          + '<button class="ce-role-stay" type="button" style="padding:2px 8px;border:none;background:' + (_staySelected ? "#1a5fa8" : "#fff") + ';color:' + (_staySelected ? "#fff" : "#1a5fa8") + ';cursor:pointer;font-family:inherit;font-weight:600;">Stay</button>'
          + '<button class="ce-role-see"  type="button" style="padding:2px 8px;border:none;background:' + (!_staySelected ? "#666" : "#fff") + ';color:' + (!_staySelected ? "#fff" : "#666") + ';cursor:pointer;font-family:inherit;font-weight:600;border-left:1px solid #ccc;">👁 See</button>'
          + '</span>';
      }
    }

    // v359.22: keep-button tooltip reflects the current role so the
    // commit action couples to the chip. Visual glyph stays compact;
    // the chip carries the visible role context.
    var _roleLabel = _roleInfo
      ? (_roleInfo.intent === "dayTrip"
          ? "as a day trip from " + (_roleInfo.hub ? _roleInfo.hub.place : "?")
          : "as an overnight stop")
      : "";
    var _keepTitle = c.status === "keep"
      ? "Remove from your picks"
      : (c.status === "reject"
          ? "Restore"
          : (_roleLabel ? "Keep " + _roleLabel : "Keep"));

    // v359.31: Wikipedia thumbnail placeholder. Starts as a small
    // colored square; gets a background-image once the fetch
    // resolves. If Wikipedia returns nothing, stays as the
    // placeholder (still gives the card a consistent left rhythm).
    var _thumbHtml = '<div class="ce-card-thumb" data-place="' + (c.place||"").replace(/"/g,"&quot;") + '" style="width:36px;height:36px;border-radius:6px;background:#eef2f7;background-size:cover;background-position:center;flex-shrink:0;margin-right:2px;"></div>';

    var compactHtml = '<div class="ce-card-compact" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;cursor:pointer;">'
      + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + _thumbHtml
      + '<div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">'
      + keptDot
      + '<span class="ce-card-name" style="font-size:13px;font-weight:700;color:#111;">' + c.place + '</span>'
      + (c.widelyRecommended ? '<span style="color:#6a4a80;font-size:10px;" title="widely recommended">★</span>' : '')
      + '<span style="font-size:10px;color:#888;">' + (c.role || '') + (c.stayRange ? ' · ' + c.stayRange : '') + '</span>'
      + _roleChip
      + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">'
      + '<button class="ce-act-compact-keep" style="font-size:10px;font-weight:600;padding:4px 9px;border-radius:5px;border:1px solid ' + (c.status === "keep" ? "#2a7a4e" : "#ddd") + ';background:' + (c.status === "keep" ? "#e8f5ee" : "#fff") + ';color:' + (c.status === "keep" ? "#2a7a4e" : "#333") + ';cursor:pointer;font-family:inherit;" title="' + _keepTitle + '">' + (c.status === "keep" ? "✓" : (c.status === "reject" ? "↺" : "+")) + '</button>'
      + '<button class="ce-act-compact-reject" style="font-size:10px;font-weight:600;padding:4px 9px;border-radius:5px;border:1px solid ' + (c.status === "reject" ? "#c05020" : "#ddd") + ';background:' + (c.status === "reject" ? "#fff0ec" : "#fff") + ';color:' + (c.status === "reject" ? "#c05020" : "#888") + ';cursor:pointer;font-family:inherit;" title="' + (c.status === "reject" ? "Currently rejected" : "Reject") + '">×</button>'
      + '<button class="ce-act-compact-expand" style="font-size:12px;color:#888;background:none;border:none;cursor:pointer;font-family:inherit;padding:0 4px;" title="' + (expanded ? "Hide details" : "See details") + '">' + (expanded ? "▾" : "▸") + '</button>'
      + '</div>'
      + '</div>';

    var detailHtml = expanded
      ? '<div class="ce-card-details" style="padding:4px 11px 10px;border-top:1px solid #f0f0f0;">'
        + reqBadge
        // v359.31: Wikipedia factual anchor — short, structural, sits
        // ABOVE the LLM whyItFits. Empty/hidden until the fetch
        // resolves; replaced/filled in by _fetchWikiSummary below.
        + '<div class="ce-card-wiki-desc" style="display:none;font-size:10.5px;color:#888;font-style:italic;margin-top:4px;letter-spacing:.01em;"></div>'
        + '<div class="ce-card-why" style="font-size:11px;color:#555;line-height:1.55;margin-top:4px;">' + (c.whyItFits || '') + '</div>'
        + alsoHereHtml
        + '<div class="ce-card-tags" style="margin-top:6px;">' + (c.tags || []).map(function (t) { return '<span class="ce-tag">' + t + '</span>'; }).join('') + '</div>'
        + (c.tradeoffs ? '<div class="ce-card-tradeoff" style="margin-top:6px;">⚠ ' + c.tradeoffs + '</div>' : '')
        + '<div class="ce-card-actions" style="margin-top:8px;border-top:none;">'
        + '<button class="ce-act reject' + (c.status === "reject" ? " on" : '') + '">× Reject</button>'
        + '<button class="ce-act compare">⇄ Compare</button>'
        + '</div>'
        + '</div>'
      : '';

    card.innerHTML = compactHtml + detailHtml;

    var keepBtn    = card.querySelector(".ce-act-compact-keep");
    var rejectBtn  = card.querySelector(".ce-act-compact-reject");
    var expandBtn  = card.querySelector(".ce-act-compact-expand");
    var compactRow = card.querySelector(".ce-card-compact");
    // Round NC.3b: Stay/See toggle buttons (replaces the legacy ce-role-chip).
    var stayBtn   = card.querySelector(".ce-role-stay");
    var seeBtn    = card.querySelector(".ce-role-see");
    (function (cand) {
      if (keepBtn)   keepBtn.onclick   = function (e) { e.stopPropagation(); if (typeof global.setCS === "function") global.setCS(cand.id, "keep"); };
      if (rejectBtn) rejectBtn.onclick = function (e) { e.stopPropagation(); if (typeof global.setCS === "function") global.setCS(cand.id, "reject"); };
      if (stayBtn) stayBtn.onclick = function (e) {
        e.stopPropagation();
        if (global.MaxEnginePicker && global.MaxEnginePicker.setRole) {
          global.MaxEnginePicker.setRole(cand.id, "stay");
          if (typeof global.renderCandidateCards === "function" && global._tb) {
            global.renderCandidateCards(global._tb.candidates);
          }
        }
      };
      if (seeBtn) seeBtn.onclick = function (e) {
        e.stopPropagation();
        if (global.MaxEnginePicker && global.MaxEnginePicker.setRole) {
          global.MaxEnginePicker.setRole(cand.id, "see");
          if (typeof global.renderCandidateCards === "function" && global._tb) {
            global.renderCandidateCards(global._tb.candidates);
          }
        }
      };
      if (expandBtn) expandBtn.onclick = function (e) {
        e.stopPropagation();
        global._ceCardExpanded = global._ceCardExpanded || {};
        global._ceCardExpanded[cand.id] = !global._ceCardExpanded[cand.id];
        if (typeof global.renderCandidateCards === "function" && global._tb) {
          global.renderCandidateCards(global._tb.candidates);
        }
      };
      if (compactRow) compactRow.onclick = function (e) {
        if (e.target.closest("button")) return;
        if (typeof global._ceSelectCandidateOnMap === "function") global._ceSelectCandidateOnMap(cand.id);
        global._ceCardExpanded = global._ceCardExpanded || {};
        global._ceCardExpanded[cand.id] = !global._ceCardExpanded[cand.id];
        if (typeof global.renderCandidateCards === "function" && global._tb) {
          global.renderCandidateCards(global._tb.candidates);
        }
      };
    })(c);

    if (expanded) {
      var detailBtns = card.querySelectorAll(".ce-card-details .ce-act");
      (function (cand) {
        if (detailBtns[0]) detailBtns[0].onclick = function () { if (typeof global.setCS === "function") global.setCS(cand.id, "reject"); };
        if (detailBtns[1]) detailBtns[1].onclick = function () { if (typeof global.doCompare === "function") global.doCompare(cand.id); };
      })(c);
    }

    // v360.3 (#124 Turn 2): day-trip candidates subsection. When the
    // user has kept this candidate as an overnight hub AND the picker-
    // side discovery has stashed day-trip candidates for it, render
    // them as a checkable list nested under the card. Checking adds
    // a wisp-like candidate to _tb.candidates with intent=dayTrip +
    // dayTripHub = this card's id. publishTrip's wayside-commit pass
    // already handles intent=wayside; the parallel day-trip-commit
    // is Turn 3.
    var _tb = global._tb;
    var dayTripsForHub = (_tb && _tb._hubDayTripCandidates && _tb._hubDayTripCandidates[c.id]) || null;
    if (c.status === "keep" && dayTripsForHub && dayTripsForHub.length) {
      var dtSection = document.createElement("div");
      dtSection.style.cssText =
        "margin:0 12px 12px 12px;padding:8px 12px;background:#fff4e6;border:1px solid #f0d8a8;border-radius:6px;";
      var dtHdr = document.createElement("div");
      dtHdr.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#a36500;margin-bottom:6px;";
      dtHdr.textContent = "Day trips from " + (c.place || "here");
      dtSection.appendChild(dtHdr);

      dayTripsForHub.forEach(function (dt, dtIdx) {
        // Existing candidate? Find by name + dayTripHub = this hub.
        var existing = (_tb.candidates || []).find(function (x) {
          return x && x.intent === "dayTrip" && x.dayTripHub === c.id &&
                 x.place && dt.name &&
                 String(x.place).toLowerCase() === String(dt.name).toLowerCase();
        });
        var isKept = !!(existing && existing.status === "keep");
        var row = document.createElement("label");
        row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:5px 0;cursor:pointer;font-size:12px;line-height:1.45;color:#5c3f10;";
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isKept;
        checkbox.style.cssText = "margin:3px 0 0;flex-shrink:0;";
        var body = document.createElement("div");
        body.style.cssText = "flex:1;min-width:0;";
        body.innerHTML =
          '<div style="font-weight:600;color:#5c3f10;">' +
            String(dt.name || "?").replace(/</g, "&lt;") +
            (typeof dt.durationHours === "number" ? ' <span style="color:#a36500;font-weight:500;font-size:11px;">· ' +
              (dt.durationHours >= 1 ? Math.round(dt.durationHours) + "h" : Math.round(dt.durationHours * 60) + "m") +
            '</span>' : '') +
          '</div>' +
          (dt.why ? '<div style="font-size:11px;color:#7a5520;margin-top:2px;">' + String(dt.why).replace(/</g, "&lt;").slice(0, 140) + (dt.why.length > 140 ? '…' : '') + '</div>' : '');
        row.appendChild(checkbox);
        row.appendChild(body);
        dtSection.appendChild(row);

        (function (hubCand, dtCand, exists) {
          checkbox.onchange = function () {
            if (!_tb || !Array.isArray(_tb.candidates)) return;
            var match = exists || (_tb.candidates || []).find(function (x) {
              return x && x.intent === "dayTrip" && x.dayTripHub === hubCand.id &&
                     x.place && dtCand.name &&
                     String(x.place).toLowerCase() === String(dtCand.name).toLowerCase();
            });
            if (checkbox.checked) {
              if (match) {
                match.status = "keep";
              } else {
                _tb.candidates.push({
                  id: "c-dt-" + Math.random().toString(36).slice(2, 8),
                  place: dtCand.name,
                  country: (_tb.region || hubCand.country || ""),
                  intent: "dayTrip",
                  dayTripHub: hubCand.id,
                  lat: dtCand.lat,
                  lng: dtCand.lng,
                  durationHours: dtCand.durationHours,
                  whyItFits: dtCand.why || "",
                  tags: ["picker-daytrip"],
                  nights: 0,
                  status: "keep",
                });
              }
            } else if (match) {
              match.status = "reject";
            }
            if (typeof global.renderCandidateCards === "function") {
              global.renderCandidateCards(_tb.candidates);
            }
          };
        })(c, dt, existing);
      });
      card.appendChild(dtSection);
    }

    // v360.3 (#124 Turn 4): wayside candidates subsection. Same shape
    // as day-trips above, but lookup is per-leg: this card's id +
    // "|" + the next kept hub's id. Only renders when this candidate
    // is a kept overnight hub AND there's at least one wayside
    // candidate stashed for the leg ending at the NEXT kept hub.
    var waysidesForLeg = null;
    var nextHubPlace = null;
    if (c.status === "keep" && c.intent !== "dayTrip" && c.intent !== "wayside" &&
        _tb && _tb._legWaysideCandidates) {
      // Compute the ordered kept set so we can find "next kept hub
      // after this one." Use the engine's ordering for consistency
      // with publishTrip's destination order.
      try {
        var orderedKept = [];
        var keptForOrder = (_tb.candidates || []).filter(function (x) {
          return x && x.status === "keep" && x.intent !== "dayTrip" && x.intent !== "wayside";
        });
        if (keptForOrder.length >= 2 && global.MaxEnginePicker && typeof global.MaxEnginePicker.orderKeptCandidates === "function") {
          var orderResult = global.MaxEnginePicker.orderKeptCandidates(
            keptForOrder, _tb.mdcItems || global._mdcItems || [],
            _tb.entry || "", _tb.tbExit || ""
          );
          orderedKept = (orderResult && orderResult.ordered) || keptForOrder;
        } else {
          orderedKept = keptForOrder;
        }
        var myIdx = orderedKept.findIndex(function (x) { return x && x.id === c.id; });
        if (myIdx >= 0 && myIdx < orderedKept.length - 1) {
          var nextHub = orderedKept[myIdx + 1];
          var legKey = c.id + "|" + nextHub.id;
          waysidesForLeg = _tb._legWaysideCandidates[legKey] || null;
          nextHubPlace = nextHub.place;
        }
      } catch (e) {
        console.warn("[picker] wayside subsection: ordering failed:", e && e.message);
      }
    }
    if (waysidesForLeg && waysidesForLeg.length) {
      var wsSection = document.createElement("div");
      wsSection.style.cssText =
        "margin:0 12px 12px 12px;padding:8px 12px;background:#f3edfa;border:1px solid #d8c4e8;border-radius:6px;";
      var wsHdr = document.createElement("div");
      wsHdr.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#5b3f8f;margin-bottom:6px;";
      wsHdr.textContent = "On the way to " + (nextHubPlace || "the next stop");
      wsSection.appendChild(wsHdr);

      waysidesForLeg.forEach(function (ws) {
        // Match by name + same waysideLeg endpoints.
        var existing = (_tb.candidates || []).find(function (x) {
          return x && x.intent === "wayside" && x.waysideLeg &&
                 x.waysideLeg.fromPlace === ws.fromPlace &&
                 x.waysideLeg.toPlace   === ws.toPlace &&
                 x.place && ws.name &&
                 String(x.place).toLowerCase() === String(ws.name).toLowerCase();
        });
        var isKept = !!(existing && existing.status === "keep");
        var row = document.createElement("label");
        row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:5px 0;cursor:pointer;font-size:12px;line-height:1.45;color:#3e2870;";
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isKept;
        checkbox.style.cssText = "margin:3px 0 0;flex-shrink:0;";
        var body = document.createElement("div");
        body.style.cssText = "flex:1;min-width:0;";
        body.innerHTML =
          '<div style="font-weight:600;color:#3e2870;">' +
            String(ws.name || "?").replace(/</g, "&lt;") +
            (typeof ws.durationHours === "number" ? ' <span style="color:#7a5fb0;font-weight:500;font-size:11px;">· ' +
              (ws.durationHours >= 1 ? Math.round(ws.durationHours) + "h" : Math.round(ws.durationHours * 60) + "m") +
            '</span>' : '') +
          '</div>' +
          (ws.why ? '<div style="font-size:11px;color:#5e4595;margin-top:2px;">' + String(ws.why).replace(/</g, "&lt;").slice(0, 140) + (ws.why.length > 140 ? '…' : '') + '</div>' : '');
        row.appendChild(checkbox);
        row.appendChild(body);
        wsSection.appendChild(row);

        (function (wsCand, exists) {
          checkbox.onchange = function () {
            if (!_tb || !Array.isArray(_tb.candidates)) return;
            var match = exists || (_tb.candidates || []).find(function (x) {
              return x && x.intent === "wayside" && x.waysideLeg &&
                     x.waysideLeg.fromPlace === wsCand.fromPlace &&
                     x.waysideLeg.toPlace   === wsCand.toPlace &&
                     x.place && wsCand.name &&
                     String(x.place).toLowerCase() === String(wsCand.name).toLowerCase();
            });
            if (checkbox.checked) {
              if (match) {
                match.status = "keep";
              } else {
                _tb.candidates.push({
                  id: "c-ws-" + Math.random().toString(36).slice(2, 8),
                  place: wsCand.name,
                  country: (_tb.region || ""),
                  intent: "wayside",
                  waysideLeg: {
                    fromPlace: wsCand.fromPlace,
                    toPlace:   wsCand.toPlace,
                  },
                  lat: wsCand.lat,
                  lng: wsCand.lng,
                  durationHours: wsCand.durationHours,
                  whyItFits: wsCand.why || "",
                  tags: ["picker-wayside"],
                  nights: 0,
                  status: "keep",
                });
              }
            } else if (match) {
              match.status = "reject";
            }
            if (typeof global.renderCandidateCards === "function") {
              global.renderCandidateCards(_tb.candidates);
            }
          };
        })(ws, existing);
      });
      card.appendChild(wsSection);
    }

    container.appendChild(card);
    if (typeof addMarkerFn === "function") addMarkerFn(c, false);

    // v359.31: Wikipedia thumbnail + factual description. Fires async
    // after the card is in the DOM so the placeholder layout is already
    // settled. localStorage cache means subsequent renders (toggle
    // expand, keep/reject re-renders) hit cache instantly.
    _fetchWikiSummary(c.place, c.country).then(function(data){
      if (!data) return;
      if (data.thumbUrl) {
        var thumbEl = card.querySelector(".ce-card-thumb");
        if (thumbEl) thumbEl.style.backgroundImage = "url('" + data.thumbUrl.replace(/'/g, "%27") + "')";
      }
      if (data.description) {
        var descEl = card.querySelector(".ce-card-wiki-desc");
        if (descEl) {
          descEl.textContent = data.description;
          descEl.style.display = "";
        }
      }
    });

    // NC.9.16: deep-link "focus this candidate" landing. Previously
    // also called _openRoleChangePopover to auto-open the legacy role
    // popover — that popover is gone (deleted in this round, it wrote
    // cand.intent only and bypassed MaxRoleWriter). Now we just scroll
    // the card into view; the user opens the real role popover via
    // the in-card affordance, which goes through the unified path.
    if (global._tb && global._tb._focusCandidateName
        && c.place && c.place === global._tb._focusCandidateName) {
      delete global._tb._focusCandidateName;
      setTimeout(function(){
        try {
          if (card && typeof card.scrollIntoView === "function") {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (e) {}
      }, 220);
    }
  }

  // NC.9.16: deleted dead code:
  //   _dayTripRadiusKm, _pickerDistKm, _computeCandidateRole — a
  //     parallel role-derivation cascade that disagreed with the
  //     unified _pmDeriveRole. Removed.
  //   _openRoleChangePopover — a parallel role-change popover that
  //     wrote only cand.intent (no role, no _roleTouched), so user
  //     picks here didn't survive _pmDeriveRole's cascade. The modern
  //     role popover lives in index.html and routes through
  //     MaxRoleWriter. Removed.
  // The comments at the OLD positions of these functions (formerly
  // lines 764, 1536) called them "dead code" but they were still
  // reachable via renderCandidateCard's call chain. "Reachable dead"
  // is worse than gone — re-activating the surface would re-introduce
  // the bug silently. So they're gone.

  // ── HX.13 (v310): renderTimeLensItinerary ─────────────────
  // Lifted from inline renderCandidateCards' `_ceLens === "time"`
  // branch. Renders the draft itinerary in trip order:
  //   - Arrival leg (when gettingTo set)
  //   - Each kept candidate as a card, with travel-leg lines
  //     between them (route name when available, else generic
  //     "Travel: A → B")
  //   - Departure leg (when gettingOut set)
  //   - "Also worth considering" section for unkept candidates
  //
  // Anchored in real dates when tb.when carries an ISO date;
  // falls back to "Stop N" numbering otherwise.
  //
  // Closure deps lifted to explicit args:
  //   - activeCands  — list to render
  //   - container    — DOM target (was outer `el`)
  //   - mdcItems     — must-do items list
  //   - tb           — picker brief object (uses .entry, .tbExit,
  //                    .when, .gettingTo, .gettingOut)
  //
  // Globals still referenced (read at call time):
  //   - MaxEnginePicker.keptCandidates
  //   - global.orderKeptCandidates  (engine ordering helper)
  //   - global.parseNightsFromRange (engine helper)
  //   - global.renderCard           (now itself a delegator into
  //                                  MaxPickerUI.renderCandidateCard)
  function _renderTimeLensItinerary(activeCands, container, mdcItems, tb) {
    if (!container) return;
    var ME = global.MaxEnginePicker;
    var kept  = ME ? ME.keptCandidates(activeCands) : (activeCands || []).filter(function(c){return c && c.status === "keep";});
    var unset = (activeCands || []).filter(function (c) { return c.status !== "keep"; });
    if (kept.length) {
      var orderRes, ordered;
      try {
        orderRes = (typeof global.orderKeptCandidates === "function")
          ? global.orderKeptCandidates(kept, mdcItems || [], (tb && tb.entry) || "", (tb && tb.tbExit) || "")
          : null;
        ordered = (orderRes && orderRes.ordered) || kept;
      } catch (e) { ordered = kept; }

      // Route-pair lookup so adjacent stops can label their
      // shared route by name (e.g. "Glacier Express").
      var routeByPair = {};
      (mdcItems || []).filter(function (m) { return m.checked && m.type === "route"; }).forEach(function (m) {
        var eps = (m.endpoints || m.requiredPlaces || []).map(function (p) { return (p.place || "").toLowerCase(); });
        for (var a = 0; a < eps.length; a++) {
          for (var b = 0; b < eps.length; b++) {
            if (a !== b) routeByPair[eps[a] + "→" + eps[b]] = m.name;
          }
        }
      });

      var hdr = document.createElement("div");
      hdr.style.cssText = "margin-top:6px;padding:10px 4px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#111;";
      hdr.textContent = "Draft itinerary — in order";
      container.appendChild(hdr);
      if (orderRes && orderRes.reasoning && orderRes.reasoning.length) {
        var why = document.createElement("div");
        why.style.cssText = "padding:4px 4px 8px;font-size:10px;color:#888;line-height:1.55;";
        why.innerHTML = orderRes.reasoning.map(function (r) { return "• " + r; }).join("<br>");
        container.appendChild(why);
      }

      var hasStartDate = !!(tb && tb.when && /\d{4}-\d{2}-\d{2}/.test(tb.when));
      var dayCursor = 1;
      var dateCursor = hasStartDate ? new Date(tb.when + "T00:00:00") : null;
      var fmtDate = function (d) {
        if (!d || isNaN(d)) return "";
        var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        var mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return days[d.getDay()] + " " + mons[d.getMonth()] + " " + d.getDate();
      };

      if (tb && tb.gettingTo) {
        var arrLeg = document.createElement("div");
        arrLeg.style.cssText = "margin:6px 12px 2px;padding:6px 10px;font-size:10px;color:#555;border-left:2px solid #c8d8ec;background:#f5f9ff;line-height:1.55;border-radius:0 4px 4px 0;";
        arrLeg.innerHTML = '✈ <strong style="color:#1a5fa8;">Arrival</strong> · ' + tb.gettingTo;
        container.appendChild(arrLeg);
      }

      ordered.forEach(function (c, i) {
        if (i > 0) {
          var prev = ordered[i - 1];
          var key = (prev.place || "").toLowerCase() + "→" + (c.place || "").toLowerCase();
          var routeName = routeByPair[key];
          var leg = document.createElement("div");
          leg.style.cssText = "margin:2px 12px 2px;padding:4px 8px;font-size:10px;color:#666;border-left:2px solid #e8e8e8;line-height:1.55;";
          leg.innerHTML = routeName
            ? '↓ <strong style="color:#1a5fa8;">' + routeName + '</strong> · ' + prev.place + ' → ' + c.place
            : '↓ Travel: ' + prev.place + ' → ' + c.place;
          container.appendChild(leg);
        }
        var nights = (typeof global.parseNightsFromRange === "function")
          ? (global.parseNightsFromRange(c.stayRange) || 3) : 3;
        var ix = document.createElement("div");
        ix.style.cssText = "font-size:10px;color:#888;padding:6px 6px 0;font-weight:700;letter-spacing:0.03em;";
        if (hasStartDate && dateCursor && !isNaN(dateCursor)) {
          var endDate = new Date(dateCursor); endDate.setDate(endDate.getDate() + nights);
          var dayEnd = dayCursor + nights - 1;
          var rangeStr = (nights > 1)
            ? ("Day " + dayCursor + "–" + dayEnd + " · " + fmtDate(dateCursor) + " → " + fmtDate(endDate))
            : ("Day " + dayCursor + " · " + fmtDate(dateCursor));
          ix.textContent = rangeStr;
          dayCursor += nights;
          dateCursor = endDate;
        } else {
          ix.textContent = "Stop " + (i + 1);
        }
        container.appendChild(ix);
        if (typeof global.renderCard === "function") global.renderCard(c, container);
      });

      if (tb && tb.gettingOut) {
        var depLeg = document.createElement("div");
        depLeg.style.cssText = "margin:2px 12px 6px;padding:6px 10px;font-size:10px;color:#555;border-left:2px solid #c8d8ec;background:#f5f9ff;line-height:1.55;border-radius:0 4px 4px 0;";
        depLeg.innerHTML = '✈ <strong style="color:#1a5fa8;">Departure</strong> · ' + tb.gettingOut;
        container.appendChild(depLeg);
      }
    }
    if (unset.length) {
      var hdr2 = document.createElement("div");
      hdr2.style.cssText = "margin-top:18px;padding:10px 4px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#111;border-top:1px solid #e8e8e8;";
      hdr2.textContent = "Also worth considering";
      container.appendChild(hdr2);
      var hdr2Sub = document.createElement("div");
      hdr2Sub.style.cssText = "padding:0 4px 8px;font-size:10px;color:#888;";
      hdr2Sub.textContent = "Places not yet in the draft. Keep any that fit; they’ll slot into the order.";
      container.appendChild(hdr2Sub);
      unset.forEach(function (c) { if (typeof global.renderCard === "function") global.renderCard(c, container); });
    }
  }

  // ── HX.14 (v311): renderTripDetailsStrip ──────────────────
  // Lifted from inline _renderTripDetailsStrip. Renders a
  // collapsible "Entry & exit" strip on the candidate explorer:
  // a transportation pill row, two city/airport text inputs,
  // and the blur-to-pan logic that re-centers the map when the
  // user types a new arrival/departure city.
  //
  // No closure deps — all referenced state lives on globals.
  // Returns a DOM box; caller appends it.
  //
  // Globals referenced (read at call time):
  //   - global._tb (entry, tbExit, entryMode, exitMode, candidates, region)
  //   - global._tripDetailsExpanded (toggle flag)
  //   - global._tbPlacesTransportButtonHtml (transport pill HTML)
  //   - global._rebuildGettingToFromFields
  //   - global.renderCandidateCards
  //   - global._ceMap
  //   - global._findCityCoordsForMap
  //   - MaxPickerUI.renderEntryPointsOnCeMap (already in this module)
  function _renderTripDetailsStrip() {
    var box = document.createElement("div");
    box.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid #f0f0f0;";

    var tb = global._tb || {};
    var hasAny = tb.entry || tb.tbExit || tb.entryMode || tb.exitMode;
    var expanded = !!global._tripDetailsExpanded;

    var summaryRow = document.createElement("div");
    summaryRow.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;flex-wrap:wrap;";
    var chev = document.createElement("span");
    chev.style.cssText = "font-size:9px;color:#999;";
    chev.textContent = expanded ? "▾" : "▸";
    summaryRow.appendChild(chev);
    var label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:#999;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;";
    label.textContent = "Entry & exit";
    summaryRow.appendChild(label);
    if (!expanded) {
      var sum = document.createElement("span");
      sum.style.cssText = "font-size:11px;color:#666;margin-left:4px;line-height:1.5;word-break:break-word;";
      if (hasAny) {
        var bits = [];
        if (tb.entry)  bits.push("In: "  + tb.entry);
        if (tb.tbExit) bits.push("Out: " + tb.tbExit);
        sum.textContent = bits.join(" · ");
      } else {
        sum.innerHTML = '<em style="color:#aaa;">Pick a pin on the map, or click to set arrival and departure</em>';
      }
      summaryRow.appendChild(sum);
    }
    summaryRow.onclick = function () {
      global._tripDetailsExpanded = !global._tripDetailsExpanded;
      if (typeof global.renderCandidateCards === "function") {
        global.renderCandidateCards(global._tb && global._tb.candidates);
      }
    };
    box.appendChild(summaryRow);

    if (!expanded) return box;

    var form = document.createElement("div");
    form.style.cssText = "margin-top:10px;padding:10px 12px;background:#fafbfc;border:1px solid #eee;border-radius:6px;";
    var q = function (s) { return (s || "").replace(/"/g, '&quot;'); };
    var defaultEntry = tb.entry || "";
    var defaultExit  = tb.tbExit || "";
    var transportHtml = (typeof global._tbPlacesTransportButtonHtml === "function")
      ? global._tbPlacesTransportButtonHtml() : '';
    form.innerHTML =
       '<div style="font-size:10px;color:#888;line-height:1.5;margin-bottom:10px;">'
      +  'One transportation picker for both directions — tap it for getting-there and getting-out modes. Cities below. Dates and flight numbers come after you’ve committed to entry and exit.'
      + '</div>'
      + '<div style="margin-bottom:12px;">'
      +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin-bottom:6px;">How you’re moving</div>'
      +   transportHtml
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      + '<div>'
      +   '<label style="display:block;font-size:10px;color:#666;margin-bottom:3px;">Getting there — city or airport</label>'
      +   '<input id="td-entry" value="' + q(defaultEntry) + '" placeholder="e.g. Zurich or ZRH" style="width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-family:inherit;" />'
      + '</div>'
      + '<div>'
      +   '<label style="display:block;font-size:10px;color:#666;margin-bottom:3px;">Getting out — city or airport</label>'
      +   '<input id="td-exit" value="' + q(defaultExit) + '" placeholder="e.g. Geneva or GVA" style="width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-family:inherit;" />'
      + '</div>'
      + '</div>';
    box.appendChild(form);

    setTimeout(function () {
      var bind = function (id, key) {
        var inp = document.getElementById(id); if (!inp) return;
        inp.onblur = function () {
          var newVal = inp.value.trim();
          var changed = newVal !== global._tb[key];
          global._tb[key] = newVal;
          if (typeof global._rebuildGettingToFromFields === "function") global._rebuildGettingToFromFields();
          // v355.12: anchor the route to the new entry/exit. Without
          // this, changing the arrival/departure city on the trip-
          // details strip captured the new value but left the
          // numbered candidate sequence (and pin numbers) frozen on
          // the old ordering. _tbResequenceCandidates re-runs
          // orderKeptCandidates against the active set + the new
          // entry/exit, then renderCandidateCards picks up the fresh
          // `order` fields for each card and pin.
          if (changed && typeof global._tbResequenceCandidates === "function") {
            try { global._tbResequenceCandidates(); } catch (e) {}
          }
          if (typeof global.renderCandidateCards === "function") global.renderCandidateCards(global._tb.candidates);
          if (changed && newVal && global._ceMap) {
            try { if (typeof global._renderEntryPointsOnCeMap === "function") global._renderEntryPointsOnCeMap(global._tb.region || ""); } catch (e) {}
            var coords = (typeof global._findCityCoordsForMap === "function") ? global._findCityCoordsForMap(newVal) : null;
            if (coords) {
              try { global._ceMap.flyTo([coords[0], coords[1]], Math.max(global._ceMap.getZoom(), 8), { duration: 0.6 }); }
              catch (e) { try { global._ceMap.setView([coords[0], coords[1]], 8); } catch (_) {} }
            }
          }
        };
      };
      bind("td-entry", "entry");
      bind("td-exit",  "tbExit");
    }, 10);

    return box;
  }

  // ── v359.25: realism check at commit ──────────────────────
  // Quick pre-Choreograph pass that flags rough spots in the kept
  // candidate set before the trip materializes. Pure JS, no LLM —
  // <50ms over the kept set. Returns an array of issues; empty array
  // means the trip looks reasonable and Choreograph proceeds silently.
  //
  // Each issue: { severity: "amber"|"red", title, detail, places: [] }
  //
  // v1 checks:
  //   1. Stacked long segments — 2+ consecutive >250km hops
  //   2. Pace mismatch — relaxed pace but <2 nights/stop on average
  //   3. Fragmentation — >40% of overnight stops are 1-nighters
  //   4. Density — more destinations than (totalNights / 2)
  //
  // Checks are intentionally conservative: false-positives are worse
  // than false-negatives here. A modal that fires on every trip
  // becomes background noise.
  function _runRealismCheck(orderedKeeps, tb) {
    if (!Array.isArray(orderedKeeps) || orderedKeeps.length < 2) return [];
    var issues = [];

    // Filter to overnight stops only (day trips don't count toward
    // segment distance; they're absorbed into hubs).
    var overnights = orderedKeeps.filter(function(c){
      return c && c.intent !== "dayTrip";
    });

    // ── 1. Stacked long segments ──────────────────────────────
    // Compute pairwise distances between consecutive overnights.
    function _dKm(a, b) {
      if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
      var dLat = (a.lat - b.lat) * 111;
      var dLng = (a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
      return Math.sqrt(dLat*dLat + dLng*dLng);
    }
    var segs = [];
    for (var i = 1; i < overnights.length; i++) {
      var d = _dKm(overnights[i-1], overnights[i]);
      if (d != null) segs.push({ from: overnights[i-1], to: overnights[i], km: d });
    }
    // Find runs of 2+ consecutive segments > 250km.
    var STACK_THRESHOLD_KM = 250;
    var runs = [];
    var curRun = [];
    segs.forEach(function(s){
      if (s.km > STACK_THRESHOLD_KM) curRun.push(s);
      else { if (curRun.length >= 2) runs.push(curRun.slice()); curRun = []; }
    });
    if (curRun.length >= 2) runs.push(curRun);
    if (runs.length) {
      runs.forEach(function(run){
        var places = [run[0].from.place].concat(run.map(function(s){ return s.to.place; }));
        var totalKm = run.reduce(function(t,s){ return t + s.km; }, 0);
        issues.push({
          severity: "amber",
          title: run.length + " long hops in a row",
          detail: places.join(" → ") + " — " + Math.round(totalKm) + " km of transit across " + run.length + " consecutive legs. Consider a buffer night between long hauls, or dropping a stop.",
          places: places
        });
      });
    }

    // ── 2. Pace mismatch ──────────────────────────────────────
    var pace = (tb && tb.paceMode) || (typeof global._defaultPaceMode === "function" ? global._defaultPaceMode() : null);
    var totalNights = overnights.reduce(function(t,c){ return t + (typeof c.nights === "number" ? c.nights : 0); }, 0);
    if (pace === "loose" && overnights.length >= 3 && totalNights > 0) {
      var avgNightsPerStop = totalNights / overnights.length;
      if (avgNightsPerStop < 2) {
        issues.push({
          severity: "amber",
          title: "Relaxed pace, but a packed itinerary",
          detail: "You set a relaxed pace, but this trip averages " + avgNightsPerStop.toFixed(1) + " nights per stop across " + overnights.length + " destinations. Most relaxed trips run 2–3+ nights per stop.",
          places: overnights.map(function(c){ return c.place; })
        });
      }
    }

    // ── 3. Single-night fragmentation ─────────────────────────
    var oneNighters = overnights.filter(function(c){ return c.nights === 1; });
    if (overnights.length >= 4 && oneNighters.length / overnights.length > 0.4) {
      issues.push({
        severity: "amber",
        title: oneNighters.length + " single-night stops",
        detail: oneNighters.map(function(c){ return c.place; }).join(", ") + " — that's " + Math.round(100 * oneNighters.length / overnights.length) + "% of your overnight stops. Single nights mean you arrive, sleep, leave — most regions reward a second night.",
        places: oneNighters.map(function(c){ return c.place; })
      });
    }

    // ── 4. Density check ──────────────────────────────────────
    // More destinations than (totalNights / 2) → less than 2 nights
    // per stop on average. Flagged independently of pace so it shows
    // even on intense-pace trips.
    // v359.25.1: dropped the "+1" leeway. 7 nights + 5 stops needs to
    // fire (1.4 nights/stop), and the leeway swallowed it.
    if (totalNights >= 4 && overnights.length > Math.ceil(totalNights / 2)) {
      issues.push({
        severity: "red",
        title: "More stops than the calendar comfortably supports",
        detail: overnights.length + " destinations in " + totalNights + " nights — that's " + (totalNights / overnights.length).toFixed(1) + " nights per stop. Even at an intense pace, the math gets tight.",
        places: overnights.map(function(c){ return c.place; })
      });
    }

    // ── 5. Budget mismatch (v359.25.2) ────────────────────────
    // The picker already shows an inline "N days over your X-day
    // budget" note, but the user can ignore it and Choreograph
    // anyway. This rule surfaces the same mismatch in the modal so
    // it's a deliberate decision, not a missed warning. Uses the
    // same _parseTripDuration helper as the inline note for parity.
    // Day trips don't add to the calendar (absorbed into hubs), so
    // tripDays is overnights' nights + 1.
    try {
      var _parseFn = global._parseTripDuration;
      var _durStr = (tb && (tb.duration || tb.when)) || "";
      var _budget = (typeof _parseFn === "function" && _durStr) ? _parseFn(_durStr) : null;
      if (_budget && _budget.max && totalNights > 0) {
        var tripDays = totalNights + 1;
        if (tripDays > _budget.max) {
          var over = tripDays - _budget.max;
          var budgetLbl = (_budget.min === _budget.max)
            ? (_budget.max + " day" + (_budget.max !== 1 ? "s" : ""))
            : (_budget.min + "–" + _budget.max + " days");
          issues.push({
            severity: "red",
            title: over + " day" + (over !== 1 ? "s" : "") + " over your " + budgetLbl + " budget",
            detail: "Your picks add up to " + tripDays + " days, but you told Max you have " + budgetLbl + ". Drop a destination, reduce nights on a long stay, or extend your dates before locking this in.",
            places: overnights.map(function(c){ return c.place; })
          });
        }
      }
    } catch(e) {
      console.warn("[Max] realism-check: budget rule threw:", e);
    }

    return issues;
  }

  function _showRealismCheckModal(issues, onProceed, onBack) {
    var existing = document.getElementById("realism-check-modal");
    if (existing) existing.remove();

    var ov = document.createElement("div");
    ov.id = "realism-check-modal";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.32);z-index:10800;display:flex;align-items:center;justify-content:center;padding:20px;";

    var issuesHtml = issues.map(function(iss){
      var dotColor = iss.severity === "red" ? "#c44" : "#d59030";
      return ''
        + '<div style="padding:12px 14px;border:1px solid #eee;border-left:3px solid ' + dotColor + ';border-radius:6px;background:#fafafa;margin-bottom:8px;">'
        +   '<div style="font-size:13px;font-weight:700;color:#222;margin-bottom:4px;">' + iss.title + '</div>'
        +   '<div style="font-size:11.5px;color:#555;line-height:1.55;">' + iss.detail + '</div>'
        + '</div>';
    }).join("");

    ov.innerHTML = ''
      + '<div style="background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.18);">'
      +   '<div style="padding:20px 22px 4px;">'
      +     '<div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#888;">Before Max choreographs</div>'
      +     '<div style="font-size:17px;font-weight:700;color:#111;margin-top:4px;">A few rough spots to consider</div>'
      +     '<div style="font-size:12px;color:#666;margin-top:6px;line-height:1.55;">Max spotted some patterns in your picks that might be worth a second look. None of these are deal-breakers — just things travelers usually wish they\'d caught earlier.</div>'
      +   '</div>'
      +   '<div style="padding:14px 22px 8px;">' + issuesHtml + '</div>'
      +   '<div style="padding:8px 22px 18px;display:flex;justify-content:flex-end;gap:8px;">'
      +     '<button id="realism-back" style="font-size:13px;font-weight:500;color:#555;background:#fff;border:1px solid #ccc;border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">← Back to picker</button>'
      +     '<button id="realism-proceed" style="font-size:13px;font-weight:700;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:6px;padding:8px 16px;cursor:pointer;font-family:inherit;">Choreograph anyway →</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(ov);

    function close() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.onclick = function(e){ if (e.target === ov) { close(); if (typeof onBack === "function") onBack(); } };
    var backBtn = ov.querySelector("#realism-back");
    if (backBtn) backBtn.onclick = function(){ close(); if (typeof onBack === "function") onBack(); };
    var procBtn = ov.querySelector("#realism-proceed");
    if (procBtn) procBtn.onclick = function(){ close(); if (typeof onProceed === "function") onProceed(); };
  }

  // ── Public surface ────────────────────────────────────────
  var MaxPickerUI = {
    renderPickerCategoryNav:    _renderPickerCategoryNav,
    addAirportsToCeMap:         _addAirportsToCeMap,
    renderEntryPointsOnCeMap:   _renderEntryPointsOnCeMap,
    makeCandidateIcon:          _makeCandidateIcon,
    renderCEStayTotal:          _renderCEStayTotal,
    renderCELensBar:            _renderCELensBar,
    renderRejectedSection:      _renderRejectedSection,
    renderMustDosSummary:       _renderMustDosSummary,
    renderMustDoSection:        _renderMustDoSection,
    renderCandidateCard:        _renderCandidateCard,
    renderTimeLensItinerary:    _renderTimeLensItinerary,
    renderTripDetailsStrip:     _renderTripDetailsStrip,
    runRealismCheck:            _runRealismCheck,
    showRealismCheckModal:      _showRealismCheckModal,
    _fetchWikiSummary:          _fetchWikiSummary,
  };

  global.MaxPickerUI = MaxPickerUI;

  // Back-compat aliases — the inline script still calls these by
  // their original names. Keep both surfaces alive until later
  // rounds narrow callers to MaxPickerUI.*.
  global._renderPickerCategoryNav  = _renderPickerCategoryNav;
  global._addAirportsToCeMap       = _addAirportsToCeMap;
  global._renderEntryPointsOnCeMap = _renderEntryPointsOnCeMap;
  global._makeCandidateIcon        = _makeCandidateIcon;
  global.renderCEStayTotal         = _renderCEStayTotal;
  global._renderCELensBar          = _renderCELensBar;
  global._renderRejectedSection    = _renderRejectedSection;
  global._renderMustDosSummary     = _renderMustDosSummary;

})(typeof window !== 'undefined' ? window : this);
