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
    var checkedByCat = {};
    (items || []).forEach(function (it) {
      if (!it.checked) return;
      var cat = it.category;
      if (!cat) return;
      checkedByCat[cat] = (checkedByCat[cat] || 0) + 1;
    });
    nav.innerHTML = "";
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;align-items:center;-webkit-overflow-scrolling:touch;scrollbar-width:thin;padding-bottom:4px;";
    row.style.scrollbarColor = "#d8d4c8 transparent";
    var cats = global._CATEGORIES || [];
    cats.forEach(function (c) {
      if (!activeMap[c.id]) return;
      var chip = document.createElement("button");
      chip.type = "button";
      var n = checkedByCat[c.id] || 0;
      chip.style.cssText = "font-size:11px;font-weight:600;color:#444;background:#fff;border:1px solid #d8d4c8;padding:5px 10px;border-radius:14px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:5px;line-height:1.2;flex-shrink:0;white-space:nowrap;";
      chip.innerHTML = '<span style="font-size:13px;">' + c.emoji + '</span><span>' + (c.shortLabel || c.label) + '</span>'
        + (n > 0 ? '<span style="font-size:10px;background:#1a5fa8;color:#fff;border-radius:9px;padding:0 6px;line-height:14px;font-weight:600;">' + n + '</span>' : '');
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
    var pinSize = selected ? 30 : (grayed ? 22 : 24);
    var fontPx = selected ? 11 : 9;
    var ring = selected
      ? '<div style="position:absolute;top:-6px;left:-6px;width:' + (pinSize + 12) + 'px;height:' + (pinSize + 12) + 'px;border:3px solid #ffb300;border-radius:50%;box-shadow:0 0 10px rgba(255,179,0,0.55);pointer-events:none;animation:max-pin-pulse 1.6s ease-in-out infinite;"></div>'
      : '';
    var inner = '<div style="position:relative;background:' + mc + ';color:#fff;border-radius:50%;width:' + pinSize + 'px;height:' + pinSize + 'px;display:flex;align-items:center;justify-content:center;font-size:' + fontPx + 'px;font-weight:700;border:' + borderStyle + ';box-shadow:0 1px 4px rgba(0,0,0,.25);opacity:' + opacity + ';">' + (c.place || "").substring(0, 2) + '</div>';
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
    if (s.tripStr) {
      var color = s.status === 'over' ? '#c05020'
                : s.status === 'under' ? '#2a7a4e'
                : '#555';
      sumHost.innerHTML =
        '<span style="color:' + color + ';">Your picks: ' + s.rangeStr + '</span>'
        + ' · Trip: ' + s.tripStr;
    } else {
      sumHost.innerHTML = 'Your picks: ' + s.rangeStr;
    }
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
