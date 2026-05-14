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
    // Clear existing entry markers
    if (global._edMarkers && Array.isArray(global._edMarkers)) {
      global._edMarkers.forEach(function (rec) {
        if (rec.marker && global._ceMap) { try { global._ceMap.removeLayer(rec.marker); } catch (e) {} }
      });
    }
    global._edMarkers = [];
    if (!global._tbEntryPointsVisible) return;
    var pts = (region && global._epCache && global._epCache[region]) || [];
    var typeToMode  = global._EP_TYPE_TO_MODE || {};
    var modeLabel   = global._EP_MODE_LABEL || {};
    var iconFor     = global._epIconFor;
    pts.forEach(function (p) {
      if (typeof iconFor !== 'function') return;
      var m = L.marker([p.lat, p.lon], { icon: iconFor(p.type), zIndexOffset: 500 }).addTo(global._ceMap);
      var safeName = (p.name || "").replace(/\\/g, "\\\\").replace(/"/g, '&quot;').replace(/'/g, "\\'");
      var notes = p.notes ? '<div style="font-size:10px;color:#666;margin-top:4px;line-height:1.45;">' + p.notes.replace(/</g, "&lt;") + '</div>' : '';
      var typeLabel = { air: "Airport", rail: "Rail station", sea: "Port", bus: "Bus terminal" }[p.type] || "Entry point";
      var mode = typeToMode[p.type] || "";
      var modeTag = mode && modeLabel[mode] ? " " + modeLabel[mode] : "";
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

  function _makeCandidateIcon(c, grayed, selected) {
    var L = global.L;
    if (!L) return null;
    var mc = grayed ? "#7a8090"
                    : (c.status === "keep" ? "#2a7a4e"
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
    var inner = '<div style="position:relative;background:' + mc + ';color:#fff;border-radius:50%;width:' + pinSize + 'px;height:' + pinSize + 'px;display:flex;align-items:center;justify-content:center;font-size:' + fontPx + 'px;font-weight:700;border:' + borderStyle + ';box-shadow:0 1px 4px rgba(0,0,0,.25);opacity:' + opacity + ';">' + label + '</div>';
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

  // ── v359.20: role-chip model — overnight vs day-trip-from-hub ──
  // Each candidate has a *role* on the trip: an overnight stop, or
  // a day trip from some overnight hub. The chip on the card shows
  // Max's suggested role; the popover (v359.21) lets the user
  // override. Required stops, arrival/departure structural stops,
  // and candidates with no hub-in-range get no chip — "what isn't
  // there is also information" (Neal).
  //
  // Persisted on the candidate:
  //   c.intent       "stay" | "dayTrip" | undefined  (user override)
  //   c.dayTripHub   <candidate.id of hub>           (when intent="dayTrip")
  // If neither is set, the default is computed from geometry +
  // kept-overnights set.
  var DAY_TRIP_RADIUS_KM = 60;
  function _pickerDistKm(a, b) {
    if (!a || !b || a[0] == null || a[1] == null || b[0] == null || b[1] == null) return Infinity;
    // Equirectangular approx — fine at Europe scale.
    var dLat = (a[0] - b[0]) * 111;
    var dLng = (a[1] - b[1]) * 111 * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }
  function _computeCandidateRole(c, allCands) {
    if (!c) return null;
    // Structural / required stops have a predetermined role — chip hidden.
    if (c._required) return null;
    if (c.role === "arrival" || c.role === "departure") return null;

    // User override takes precedence.
    if (c.intent === "stay") {
      return { intent: "stay", hub: null, hubAuto: false };
    }
    if (c.intent === "dayTrip") {
      var hubId = c.dayTripHub;
      var hub = (hubId && allCands) ? allCands.find(function(o){ return o && o.id === hubId; }) : null;
      return { intent: "dayTrip", hub: hub || null, hubAuto: false };
    }

    // Compute default. Candidates that want ≥2 nights → stay.
    var wantsLongStay = (typeof c.nights === "number" && c.nights >= 2);
    if (wantsLongStay) {
      return { intent: "stay", hub: null, hubAuto: true };
    }
    // Otherwise look for closest kept-overnight hub within radius.
    if (!allCands || !Array.isArray(allCands) || c.lat == null || c.lng == null) {
      return { intent: "stay", hub: null, hubAuto: true };
    }
    var bestHub = null;
    var bestDist = Infinity;
    for (var i = 0; i < allCands.length; i++) {
      var h = allCands[i];
      if (!h || h.id === c.id) continue;
      if (h.status !== "keep") continue;
      if (h.intent === "dayTrip") continue;  // day trips can't be hubs
      if (h.lat == null || h.lng == null) continue;
      var d = _pickerDistKm([c.lat, c.lng], [h.lat, h.lng]);
      if (d < bestDist && d <= DAY_TRIP_RADIUS_KM) {
        bestDist = d;
        bestHub = h;
      }
    }
    if (bestHub) {
      return { intent: "dayTrip", hub: bestHub, hubAuto: true };
    }
    return { intent: "stay", hub: null, hubAuto: true };
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
  // v359.37: cache prefix bumped to v2 so pre-search-fallback entries
  // (which cached null results for disambig-page places like "Vik")
  // are invalidated and re-tried with the new search behavior.
  var WIKI_CACHE_PREFIX = "max-wiki:v2:";
  var WIKI_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
  function _wikiCacheKey(place, country) {
    return WIKI_CACHE_PREFIX
      + (place||"").trim().toLowerCase()
      + ":"
      + (country||"").trim().toLowerCase();
  }
  function _wikiCacheGet(place, country) {
    try {
      var raw = localStorage.getItem(_wikiCacheKey(place, country));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.ts) return null;
      if (Date.now() - entry.ts > WIKI_CACHE_TTL_MS) return null;
      return entry.data || null;
    } catch(_) { return null; }
  }
  function _wikiCacheSet(place, country, data) {
    try {
      localStorage.setItem(
        _wikiCacheKey(place, country),
        JSON.stringify({ ts: Date.now(), data: data })
      );
    } catch(_) {}
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

  function _fetchWikiSummary(place, country) {
    if (!place) return Promise.resolve(null);
    var cached = _wikiCacheGet(place, country);
    if (cached !== null) return Promise.resolve(cached);
    var title = encodeURIComponent(place.trim().replace(/ /g, "_"));

    // Step 1: try the place name verbatim.
    return _fetchSummaryByTitle(title)
      .then(function(j){
        if (j && j.type !== "disambiguation") return j;
        // Step 2: summary returned 404 or disambig — search for the
        // right article title and re-fetch summary.
        return _wikiSearch(place, country).then(function(altTitle){
          if (!altTitle) return null;
          var altEncoded = encodeURIComponent(altTitle.replace(/ /g, "_"));
          return _fetchSummaryByTitle(altEncoded).then(function(j2){
            if (j2 && j2.type !== "disambiguation") return j2;
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
          _wikiCacheSet(place, country, data);
          return data;
        }
        // Step 3: no thumbnail in summary — try the Action API
        // pageimages endpoint as a last-resort image source.
        var resolvedTitle = encodeURIComponent((j.title || place).replace(/ /g, "_"));
        return _fetchPageImage(resolvedTitle).then(function(altThumb){
          if (altThumb) data.thumbUrl = altThumb;
          _wikiCacheSet(place, country, data);
          return data;
        });
      })
      .catch(function(err){
        console.warn("[Max wiki] fetch failed for", place, err && err.message);
        return null;
      });
  }

  // ── HX.12 (v308): renderCandidateCard ─────────────────────
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

    // v359.20: role chip — shows Max's suggested role (overnight or
    // day-trip-from-X) and signals whether it's auto or user-set.
    // Hidden when role doesn't apply (required / arrival / departure).
    var _allCands = (global._tb && Array.isArray(global._tb.candidates)) ? global._tb.candidates : [];
    var _roleInfo = _computeCandidateRole(c, _allCands);
    var _roleChip = '';
    if (_roleInfo) {
      var _chipBg = _roleInfo.intent === "dayTrip" ? "#fff4e6" : "#eef4fb";
      var _chipBd = _roleInfo.intent === "dayTrip" ? "#f0c98a" : "#bcd2ea";
      var _chipFg = _roleInfo.intent === "dayTrip" ? "#a36500" : "#1a5fa8";
      var _chipText = _roleInfo.intent === "dayTrip"
        ? "Day trip from " + (_roleInfo.hub ? _roleInfo.hub.place : "?")
        : "Overnight";
      var _chipTitle = _roleInfo.hubAuto
        ? "Max's suggested role — click to change"
        : "You set this role — click to change";
      _roleChip = '<span class="ce-role-chip" data-cand-id="' + c.id + '" title="' + _chipTitle + '" style="font-size:10px;font-weight:600;color:' + _chipFg
        + ';background:' + _chipBg + ';border:1px solid ' + _chipBd + ';padding:2px 7px;border-radius:10px;display:inline-block;white-space:nowrap;cursor:pointer;">'
        + _chipText
        + '</span>';
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
    var roleChipEl = card.querySelector(".ce-role-chip");
    (function (cand) {
      if (keepBtn)   keepBtn.onclick   = function (e) { e.stopPropagation(); if (typeof global.setCS === "function") global.setCS(cand.id, "keep"); };
      if (rejectBtn) rejectBtn.onclick = function (e) { e.stopPropagation(); if (typeof global.setCS === "function") global.setCS(cand.id, "reject"); };
      if (roleChipEl) roleChipEl.onclick = function (e) {
        e.stopPropagation();
        _openRoleChangePopover(cand.id);
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

    // v359.23: trip-view deep-link landing. If the user clicked
    // "Change role" on a destination card, _focusCandidateName was
    // stashed in _tb. When the matching candidate's card renders,
    // scroll it into view and open the role popover, then clear
    // the flag so it doesn't re-trigger on every re-render.
    if (global._tb && global._tb._focusCandidateName
        && c.place && c.place === global._tb._focusCandidateName) {
      var _focusName = global._tb._focusCandidateName;
      delete global._tb._focusCandidateName;
      setTimeout(function(){
        try {
          if (card && typeof card.scrollIntoView === "function") {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          _openRoleChangePopover(c.id);
        } catch (e) {
          console.warn("[Max] focus-candidate deep-link failed for", _focusName, e);
        }
      }, 220);
    }
  }

  // ── v359.21: Change role popover ──────────────────────────
  // Opens when the user clicks the role chip on a candidate card.
  // Lets them switch between Overnight stay and Day trip from
  // {hub}, with the hub dropdown auto-populated from kept-overnight
  // candidates ranked by distance. Persists the choice to
  // c.intent / c.dayTripHub and re-renders the picker list.
  function _openRoleChangePopover(candId) {
    var allCands = (global._tb && Array.isArray(global._tb.candidates)) ? global._tb.candidates : [];
    var cand = allCands.find(function(c){ return c && c.id === candId; });
    if (!cand) return;

    // Compute hub options: kept candidates that aren't themselves day trips,
    // sorted by distance from this candidate. Within radius → preferred;
    // outside radius → still listed but flagged as "stretch."
    var hubOptions = [];
    if (cand.lat != null && cand.lng != null) {
      hubOptions = allCands
        .filter(function(h){
          return h && h.id !== cand.id
            && h.status === "keep"
            && h.intent !== "dayTrip"
            && h.lat != null && h.lng != null;
        })
        .map(function(h){
          var d = _pickerDistKm([cand.lat, cand.lng], [h.lat, h.lng]);
          return { hub: h, distKm: d, inRange: d <= DAY_TRIP_RADIUS_KM };
        })
        .sort(function(a, b){ return a.distKm - b.distKm; });
    }
    var inRangeHubs = hubOptions.filter(function(o){ return o.inRange; });
    var stretchHubs = hubOptions.filter(function(o){ return !o.inRange; });
    var dayTripAvailable = inRangeHubs.length > 0 || stretchHubs.length > 0;

    // Current state.
    var curRole = _computeCandidateRole(cand, allCands);
    var curIntent = curRole ? curRole.intent : "stay";
    var curHubId = curRole && curRole.hub ? curRole.hub.id : (inRangeHubs[0] ? inRangeHubs[0].hub.id : (stretchHubs[0] ? stretchHubs[0].hub.id : null));

    // Build the overlay.
    var existing = document.getElementById("role-popover");
    if (existing) existing.remove();

    var ov = document.createElement("div");
    ov.id = "role-popover";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.32);z-index:10500;display:flex;align-items:center;justify-content:center;padding:20px;";

    var hubOpts = hubOptions.map(function(o){
      var label = o.hub.place + " (" + Math.round(o.distKm) + " km)" + (o.inRange ? "" : " — stretch");
      var sel = o.hub.id === curHubId ? " selected" : "";
      return '<option value="' + o.hub.id + '"' + sel + '>' + label + '</option>';
    }).join("");

    var dayTripRow = dayTripAvailable
      ? ('<label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid ' + (curIntent === "dayTrip" ? "#a36500" : "#e0e0e0") + ';border-radius:8px;cursor:pointer;background:' + (curIntent === "dayTrip" ? "#fff4e6" : "#fff") + ';">'
          + '<input type="radio" name="role-pick" value="dayTrip"' + (curIntent === "dayTrip" ? " checked" : "") + ' style="margin:0;" />'
          + '<div style="flex:1;">'
          +   '<div style="font-size:13px;font-weight:600;color:#222;">Day trip from</div>'
          +   '<select id="role-hub-select" style="margin-top:6px;width:100%;padding:6px 8px;font-size:12.5px;border:1px solid #ccc;border-radius:6px;font-family:inherit;">' + hubOpts + '</select>'
          + '</div>'
        + '</label>')
      : ('<div style="padding:10px;border:1px dashed #ddd;border-radius:8px;background:#fafafa;font-size:12px;color:#888;line-height:1.5;">'
          + 'No overnight hub in range for a day trip. Keep an overnight closer than '
          + DAY_TRIP_RADIUS_KM + ' km first.'
        + '</div>');

    ov.innerHTML = ''
      + '<div style="background:#fff;border-radius:12px;max-width:420px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.18);">'
      +   '<div style="padding:18px 20px 4px;">'
      +     '<div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#888;">Role on this trip</div>'
      +     '<div style="font-size:17px;font-weight:700;color:#111;margin-top:4px;">' + cand.place + '</div>'
      +   '</div>'
      +   '<div style="padding:14px 20px;display:flex;flex-direction:column;gap:10px;">'
      +     '<label style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid ' + (curIntent === "stay" ? "#1a5fa8" : "#e0e0e0") + ';border-radius:8px;cursor:pointer;background:' + (curIntent === "stay" ? "#eef4fb" : "#fff") + ';">'
      +       '<input type="radio" name="role-pick" value="stay"' + (curIntent === "stay" ? " checked" : "") + ' style="margin:0;" />'
      +       '<div style="flex:1;">'
      +         '<div style="font-size:13px;font-weight:600;color:#222;">Overnight stay</div>'
      +         '<div style="font-size:11px;color:#777;margin-top:2px;">Its own stop on the trip with hotels and meals.</div>'
      +       '</div>'
      +     '</label>'
      +     dayTripRow
      +   '</div>'
      +   '<div style="padding:8px 20px 18px;display:flex;justify-content:flex-end;gap:8px;">'
      +     '<button id="role-cancel" style="font-size:13px;font-weight:500;color:#555;background:#fff;border:1px solid #ccc;border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Cancel</button>'
      +     '<button id="role-save" style="font-size:13px;font-weight:700;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:6px;padding:8px 16px;cursor:pointer;font-family:inherit;">Apply</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(ov);

    function close() { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }

    ov.onclick = function(e){ if (e.target === ov) close(); };
    var cancelBtn = ov.querySelector("#role-cancel");
    if (cancelBtn) cancelBtn.onclick = close;

    var saveBtn = ov.querySelector("#role-save");
    if (saveBtn) saveBtn.onclick = function(){
      var picked = ov.querySelector('input[name="role-pick"]:checked');
      var newIntent = picked ? picked.value : "stay";
      if (newIntent === "dayTrip") {
        var sel = ov.querySelector("#role-hub-select");
        var newHubId = sel ? sel.value : null;
        if (!newHubId) { close(); return; }
        cand.intent = "dayTrip";
        cand.dayTripHub = newHubId;
      } else {
        cand.intent = "stay";
        delete cand.dayTripHub;
      }
      close();
      if (typeof global.renderCandidateCards === "function" && global._tb) {
        global.renderCandidateCards(global._tb.candidates);
      }
    };
  }

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
