// picker-hero-sidebar.js — Picker hero map sidebar list. Extracted verbatim from index.html (PD.474, bloat reduction).

// ── Round HZ (picker hero map, step 4): sidebar list renderer ─────
// Replaces the must-do-grouped cards with a flat ordered list that
// mirrors the sequence visible on the map. Each row shows the
// ordinal badge (matching the map dot's number), place + country,
// an accept checkbox (✓ for status="keep", unchecked for status=null),
// and a ✕ reject button. The user reacts to the proposed itinerary
// rather than opting into stops one by one. Rejected candidates
// collect in a collapsible "Set aside" tray below.
//
// Drag-reorder is deferred to step 4.5 — for now the order comes
// straight from _tbResequenceCandidates (which already runs
// orderKeptCandidates across the active set on every status change).
//
// Side effects preserved from the legacy renderCandidateCards path:
//   * Clears + re-adds map markers
//   * Auto-keeps required candidates via applyRequiredAndAutoKeep
//   * Kicks off geocodeMissingCoords + geocodeMissingCandidates
//   * Fits map bounds to the active set
//   * Redraws the route polyline
//   * Updates the footer counter (updateCEShortlist)
//   * Shows the candidate disclaimer once per session
//   * Renders the Trip Details strip (entry/exit/dates)
//   * Renders the FQ two-destinations banner
function renderPickerSidebar(cands){
  var el = g("ce-cards"); if (!el) return;
  el.innerHTML = "";

  // Clear and reset map markers + selection map
  _ceMarkers.forEach(function(m){
    if (_ceMap) { try { _ceMap.removeLayer(m); } catch(e){} }
  });
  _ceMarkers = [];
  _ceMarkerById = {};

  // v360.3 (#124 Turn 4B): also run hydration here for direct callers
  // (renderCandidateCards delegates to us, but other code paths
  // — e.g. _tbPlacesReRender variants — call renderPickerSidebar
  // directly). Idempotent — guarded by _tb._committedHydrated.
  if (typeof _hydratePickerFromCommittedSrc === "function") {
    try { _hydratePickerFromCommittedSrc(); } catch(e) { console.warn("[Max] picker committed hydration failed:", e); }
  }

  // Auto-keep required candidates (idempotent thanks to _autoKeepApplied)
  MaxEnginePicker.applyRequiredAndAutoKeep(cands, _tb.requiredPlaces);

  // Round HZ (picker hero map) — initial-open fix: _tbResequenceCandidates
  // only fires from setCS on status changes, so on a fresh picker open
  // every candidate has c.order=null and the polyline + sidebar list both
  // come up empty. Run it here so the order field is populated before we
  // filter the active set. Idempotent — re-running on subsequent renders
  // just re-uses the same orderKeptCandidates result on the same input.
  if (typeof _tbResequenceCandidates === "function") _tbResequenceCandidates();

  // Computed sets — active (in route) sorted by candidate.order,
  // rejected (set aside) in their original order.
  var active = MaxEnginePicker.activeCandidates(cands)
    .filter(function(c){ return c && typeof c.order === "number"; })
    .sort(function(a, b){ return a.order - b.order; });
  var rejected = (cands || []).filter(function(c){ return c && c.status === "reject"; });

  // Kick off Nominatim background geocoding for placeholder coords —
  // it re-calls this function when coords land so pins + the polyline
  // extend automatically.
  geocodeMissingCoords(cands);

  // Header: Trip Details strip + Add-a-place input
  var headerWrap = document.createElement("div");
  headerWrap.style.cssText = "padding:4px 4px 8px;border-bottom:1px solid var(--c-border-3);margin-bottom:8px;";

  var detailsStrip = _renderTripDetailsStrip(MaxEnginePicker.keptCandidates(cands));
  if (detailsStrip) headerWrap.appendChild(detailsStrip);

  var addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:6px;margin-top:10px;";
  addRow.innerHTML = '<input id="ce-add-place-inp" placeholder="Heard about a place not on the list? Type it here…" style="flex:1;min-width:0;font-size:11px;padding:7px 10px;border:1px solid var(--c-border);border-radius:5px;font-family:inherit;" onkeydown="if(event.key===&#39;Enter&#39;){event.preventDefault();addPlaceToCandidates();}" />';
  headerWrap.appendChild(addRow);

  el.appendChild(headerWrap);

  // FQ banner when 2+ kept — existing two-destinations note
  (function(){
    var keptCount = MaxEnginePicker.keptCandidates(cands).length;
    if (keptCount < 2) return;
    var banner = document.createElement("div");
    banner.id = "fq-picker-banner";
    banner.style.cssText = "margin:0 0 10px;padding:10px 12px;background:#eaf3fb;border:1px solid #c8dff8;border-radius:7px;font-size:11px;line-height:1.55;color:#1a3f6f;";
    banner.innerHTML = _fqBannerInnerHtml();
    el.appendChild(banner);
  })();

  // Ordered sequence list — accepted + unchecked, both in the route
  if (active.length === 0) {
    var empty = document.createElement("div");
    empty.style.cssText = "padding:24px 12px;text-align:center;font-size:11px;color:var(--c-ink-3);";
    empty.textContent = (cands && cands.length) ? "Resolving sequence…" : "Building your trip…";
    el.appendChild(empty);
  } else {
    var listWrap = document.createElement("div");
    listWrap.style.cssText = "padding:0;";
    active.forEach(function(c){
      listWrap.appendChild(_makePickerSidebarRow(c));
      _addPickerSidebarMarker(c);
    });
    el.appendChild(listWrap);
  }

  // "Set aside" — rejected candidates in a collapsible tray
  if (rejected.length) {
    el.appendChild(_makePickerRejectedSection(rejected));
  }

  // Map bounds — fit to active candidates that have real coords +
  // a sane location relative to the seeded region.
  var bounds = [];
  active.forEach(function(c){
    if (!isFinite(c.lat) || !isFinite(c.lng)) return;
    if (c.lat === 0 && c.lng === 0) return;
    if (typeof _fuCoordSane === "function" && !_fuCoordSane(c.lat, c.lng)) return;
    bounds.push([c.lat, c.lng]);
  });
  if (bounds.length > 1 && _ceMap) {
    setTimeout(function(){ try { _ceMap.fitBounds(bounds, {padding:[28,28]}); } catch(e){} }, 150);
  }

  updateCEShortlist();
  showCandidateDisclaimer();

  // LLM-based geocoding fallback for candidates Nominatim couldn't fill
  var missingCoords = cands.filter(function(c){ return !c.lat || !c.lng || c.lat === 0; });
  if (missingCoords.length > 0) {
    geocodeMissingCandidates(missingCoords, cands);
  }

  // Route polyline through the active sequence
  _redrawCePolyline();
}

// Build one row of the picker sidebar. Pure DOM construction — no
// state mutation beyond click-handlers that delegate to setCS /
// _ceSelectCandidateOnMap / re-render.
// v359.40 CLEANUP NOTE: hero-sidebar row renderer for the
// candidate-explorer overlay (#candidate-explorer-overlay). This
// surface isn't reached in the current live flow — the active
// picker is the place-mode/destination view rendered by
// _renderPlaceActivityItems. The Wikipedia thumbnail and factual
// description added in v359.31.1 inside this function are dead by
// association. Kept for reference / fallback paths only.
function _makePickerSidebarRow(c){
  var row = document.createElement("div");
  row.className = "ce-sidebar-row";
  row.dataset.candId = c.id;
  var selectedRow = (c.id === _ceSelectedCandId);
  row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:" + (selectedRow ? "#fff8e1" : "#fff") + ";border:1px solid " + (selectedRow ? "#f0d264" : "#e0e6ef") + ";border-radius:7px;margin-bottom:6px;font-size:12px;cursor:pointer;transition:background 120ms ease,border-color 120ms ease;";

  // Ordinal badge — color matches the map dot for the same candidate
  var badge = document.createElement("span");
  var badgeColor = (c.status === "keep") ? "#2a7a4e" : "#1a5fa8";
  badge.style.cssText = "background:" + badgeColor + ";color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px;";
  badge.textContent = String((typeof c.order === "number" ? c.order : 0) + 1);
  row.appendChild(badge);

  // v359.31.1: Wikipedia thumbnail. Small (32x32) so it slots between
  // the ordinal badge and the name without bloating the row. Starts
  // as a grey placeholder; the async fetch below fills the
  // background-image and the expanded-view factual description.
  var thumb = document.createElement("div");
  thumb.className = "ce-sidebar-thumb";
  thumb.style.cssText = "width:32px;height:32px;border-radius:5px;background:#eef2f7;background-size:cover;background-position:center;flex-shrink:0;margin-top:0;";
  row.appendChild(thumb);

  // Main body — name + optional expanded rationale
  var body = document.createElement("div");
  body.style.cssText = "flex:1;min-width:0;";

  var nameLine = document.createElement("div");
  nameLine.style.cssText = "color:#333;line-height:1.4;";
  var country = c.country ? '<span style="color:var(--c-ink-3);font-weight:400;"> · ' + _escapeHtml(c.country) + '</span>' : "";
  var req = c._required ? '<span title="Required by a must-do" style="margin-left:6px;color:var(--c-warn);font-size:10px;">★</span>' : "";
  nameLine.innerHTML = '<span style="font-weight:600;">' + _escapeHtml(c.place || "(unnamed)") + '</span>' + country + req;
  body.appendChild(nameLine);

  // v359.31.1: Wikipedia factual line. Hidden until fetch resolves.
  // Sits between the name and the rationale so it grounds whatever
  // LLM prose follows.
  var wikiDesc = document.createElement("div");
  wikiDesc.className = "ce-sidebar-wiki-desc";
  wikiDesc.style.cssText = "display:none;font-size:10.5px;color:var(--c-ink-3);font-style:italic;line-height:1.4;margin-top:2px;";
  body.appendChild(wikiDesc);

  // Expand for rationale on click — _ceCardExpanded carries state
  var expanded = !!(_ceCardExpanded && _ceCardExpanded[c.id]);
  if (expanded && (c.whyItFits || c.tradeoffs)) {
    var detail = document.createElement("div");
    detail.style.cssText = "margin-top:6px;font-size:11px;color:var(--c-ink-2);line-height:1.5;";
    var html = "";
    if (c.whyItFits) html += '<div>' + _escapeHtml(c.whyItFits) + '</div>';
    if (c.tradeoffs) html += '<div style="margin-top:4px;color:var(--c-ink-3);">⚠ ' + _escapeHtml(c.tradeoffs) + '</div>';
    if (c.stayRange) html += '<div style="margin-top:4px;color:#777;font-size:10px;">' + _escapeHtml(c.stayRange) + '</div>';
    detail.innerHTML = html;
    body.appendChild(detail);
  }
  row.appendChild(body);

  // v359.31.1: kick off Wikipedia fetch and fill thumbnail +
  // description when it lands. MaxPickerUI exposes the helper from
  // picker-ui.js; bail silently if not loaded.
  if (window.MaxPickerUI && typeof MaxPickerUI._fetchWikiSummary === "function") {
    MaxPickerUI._fetchWikiSummary(c.place, c.country).then(function(data){
      if (!data) return;
      if (data.thumbUrl) {
        thumb.style.backgroundImage = "url('" + data.thumbUrl.replace(/'/g, "%27") + "')";
      }
      if (data.description) {
        wikiDesc.textContent = data.description;
        wikiDesc.style.display = "";
      }
    });
  }

  // Actions — accept checkbox + reject ✕
  var actions = document.createElement("div");
  actions.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0;margin-top:1px;";

  var cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = (c.status === "keep");
  cb.title = (c.status === "keep") ? "Accepted — click to uncheck" : "Click to accept";
  cb.style.cssText = "cursor:pointer;margin:0;width:16px;height:16px;";
  cb.onclick = function(e){ e.stopPropagation(); setCS(c.id, "keep"); };
  actions.appendChild(cb);

  var rej = document.createElement("button");
  rej.style.cssText = "background:none;border:none;color:#bbb;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;";
  rej.textContent = "✕";
  rej.title = "Set aside";
  rej.onclick = function(e){ e.stopPropagation(); setCS(c.id, "reject"); };
  actions.appendChild(rej);

  row.appendChild(actions);

  // Clicking the body region (not the actions) toggles the rationale
  // expansion and highlights the marker on the map.
  body.addEventListener("click", function(){
    if (!_ceCardExpanded) _ceCardExpanded = {};
    _ceCardExpanded[c.id] = !_ceCardExpanded[c.id];
    _ceSelectedCandId = c.id;
    _ceSelectCandidateOnMap(c.id);
    renderPickerSidebar(_tb.candidates);
  });

  return row;
}

// Add the candidate's map marker. Mirrors the legacy _addCandidateMarker
// closure inside renderCandidateCards, but the marker's click handler
// scrolls the SIDEBAR row into view + flashes its background instead of
// targeting the (now-gone) #ce-card-* DOM nodes.
function _addPickerSidebarMarker(c){
  if (!c || !c.lat || !c.lng || !_ceMap) return;
  if (c.lat === 0 && c.lng === 0) return;
  var selected = (c.id === _ceSelectedCandId);
  var icon = (typeof _makeCandidateIcon === "function") ? _makeCandidateIcon(c, false, selected) : null;
  if (!icon) return;
  var m = L.marker([c.lat, c.lng], { icon: icon, zIndexOffset: selected ? 1000 : 0 });
  var tipStay = c.stayRange ? " · " + c.stayRange : "";
  m.bindTooltip((c.place || "") + tipStay, { permanent: false, direction: "top", offset: [0, -14], className: "ce-map-tooltip" });
  (function(cand){
    m.on("click", function(){
      _ceSelectedCandId = cand.id;
      _ceSelectCandidateOnMap(cand.id);
      var row = document.querySelector('.ce-sidebar-row[data-cand-id="' + cand.id + '"]');
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "nearest" });
        var prevBg = row.style.background;
        row.style.background = "#fff3c0";
        setTimeout(function(){
          if (row) row.style.background = prevBg || "";
        }, 1500);
      }
    });
  })(c);
  m.addTo(_ceMap);
  _ceMarkers.push(m);
  _ceMarkerById[c.id] = m;
}

// "Set aside" — collapsible tray of rejected candidates with a Restore
// action that un-rejects (toggle setCS off → status becomes null →
// candidate returns to the active sequence as unchecked).
function _makePickerRejectedSection(rejected){
  var wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:14px;padding:8px 10px;background:#f6f7f9;border:1px solid #e0e6ef;border-radius:7px;";
  var collapsed = !_ceRejectedExpanded;
  var hdr = document.createElement("div");
  hdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-ink-3);margin-bottom:" + (collapsed ? "0" : "6px") + ";cursor:pointer;display:flex;justify-content:space-between;align-items:center;";
  hdr.innerHTML = '<span>Set aside · ' + rejected.length + '</span><span style="font-size:11px;">' + (collapsed ? "▸" : "▾") + '</span>';
  hdr.onclick = function(){
    _ceRejectedExpanded = !_ceRejectedExpanded;
    renderPickerSidebar(_tb.candidates);
  };
  wrap.appendChild(hdr);
  if (!collapsed) {
    rejected.forEach(function(c){
      var rRow = document.createElement("div");
      rRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:5px 6px;font-size:11px;color:var(--c-ink-3);";
      var n = document.createElement("span");
      n.style.flex = "1";
      n.textContent = (c.place || "(unnamed)") + (c.country ? " · " + c.country : "");
      rRow.appendChild(n);
      var undo = document.createElement("button");
      undo.style.cssText = "background:none;border:1px solid #d0d0d0;color:var(--c-ink-2);font-size:10px;cursor:pointer;padding:3px 8px;border-radius:4px;font-family:inherit;";
      undo.textContent = "Restore";
      undo.onclick = function(){ setCS(c.id, "reject"); /* toggles off — status becomes null */ };
      rRow.appendChild(undo);
      wrap.appendChild(rRow);
      // Add the gray marker too so rejected candidates remain visible
      // on the map (just dropped from the polyline + numbered set).
      _addPickerSidebarMarker(c);
    });
  }
  return wrap;
}

// Small HTML-escape helper — used in the sidebar to prevent place
// names or rationale strings with `<` or `&` from breaking the markup.
// Cheap textContent round-trip; avoids pulling in a dependency.
function _escapeHtml(s){
  if (s == null) return "";
  var d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function renderCandidateCards(cands){
  // v360.3 (#124 Turn 4B): hydrate committed day-trips/waysides onto
  // picker candidates by normalized place name. Idempotent — guarded
  // by _tb._committedHydrated. Has to run AFTER candidates have ids
  // assigned (post-runCandidateSearch), which is always the case by
  // the time render fires.
  if (typeof _hydratePickerFromCommittedSrc === "function") {
    try { _hydratePickerFromCommittedSrc(); } catch(e) { console.warn("[Max] picker committed hydration failed:", e); }
  }
  // Round HZ (picker hero map, step 4): dispatch to the new map-led
  // sidebar renderer when hero mode is on (default). The legacy card
  // body below stays in place as a fallback in case renderPickerSidebar
  // throws — and so reopenCandidateExplorer / any code path we
  // haven't migrated still has something to fall back on if hero mode
  // is explicitly disabled via window._pickerUseHeroSidebar = false.
  if (window._pickerUseHeroSidebar !== false && typeof renderPickerSidebar === "function") {
    try { return renderPickerSidebar(cands); }
    catch (e) { console.warn("[Max] picker sidebar render failed, falling back to legacy cards:", e); }
  }
  var el=g("ce-cards"); if(!el) return;
  el.innerHTML="";
  _ceMarkers.forEach(function(m){if(_ceMap)_ceMap.removeLayer(m);}); _ceMarkers=[];
  // Reset marker lookup — markers are rebuilt from scratch on every render pass.
  // Keep _ceSelectedCandId as-is so the selection survives toggles and re-renders;
  // _addCandidateMarker will re-apply the selected icon when it sees a match.
  _ceMarkerById = {};
  // Round FQ — geographic-affordance verdict banner at the top of the
  // picker. renderCandidateCards is already the toggle hook (line 11043
  // onclick → renderCandidateCards), so the banner updates live as the
  // user adds or removes candidates. Skeleton shows while LLM transit
  // info loads; cached pairs return instantly via callMax's IDB cache
  // and the per-session memo. Replaces the Round FO between-mode pill
  // — Max informs about geography rather than asking the user to label
  // the trip, and the user decides what kind of trip to build from there.
  // Round FQ.2: banner is now a static day-trip note (see
  // _fqBannerInnerHtml). No LLM fetch, no skeleton, no per-trip
  // verdict — just one message, rendered as soon as the user has
  // picked at least two destinations. Specific day-trip options
  // surface in each destination's Explore tab via the FT.2
  // mechanism, where the user can see distances, scheduled days,
  // and act on them.
  (function(){
    var keptCount = MaxEnginePicker.keptCandidates(cands).length;
    if (keptCount < 2) return;
    var banner = document.createElement("div");
    banner.id = "fq-picker-banner";
    banner.style.cssText = "margin:6px 4px 12px;padding:10px 12px;background:#eaf3fb;border:1px solid #c8dff8;border-radius:7px;font-size:11px;line-height:1.55;color:#1a3f6f;";
    banner.innerHTML = _fqBannerInnerHtml();
    el.appendChild(banner);
  })();
  // Kick off geocoding for any candidate with placeholder coords. Runs async in
  // the background; will re-call this function when coords land so pins appear.
  geocodeMissingCoords(cands);
  var bounds=[];
  // Round FU.2: anchor map bounds to the seeded region center when
  // available. If the LLM hallucinated some candidate coords (country
  // mix-up — Iceland places coming back with Swiss lat/lng was the
  // surfacing case), bounds.push pulls the map view to the wrong
  // country. Including the seed center forces fitBounds to span at
  // least that point, keeping the map anchored to the user's stated
  // region. Also filters out individual candidate coords that are
  // wildly far from the seed (>2500km) since they're almost certainly
  // hallucinations rather than legitimate stops.
  // Round HX.2: seed-coord lookup now in MaxEnginePicker.regionSeedCoord.
  var _fuSeed = MaxEnginePicker.regionSeedCoord(_tb && _tb.region, _coarseGeocode);
  if (_fuSeed) bounds.push([_fuSeed[0], _fuSeed[1]]);
  // Round HX: hallucination-distance check moved to MaxEnginePicker.coordSane.
  function _fuCoordSane(lat, lng){ return MaxEnginePicker.coordSane(_fuSeed, lat, lng); }
  // Round HX.1: pre-render pass + status partition now in MaxEnginePicker.
  // applyRequiredAndAutoKeep re-checks _required against _tb.requiredPlaces
  // and auto-keeps required cands once (with the _autoKeepApplied flag to
  // prevent retroactive flips after brief edits). partitionByStatus splits
  // into active/rejected so the rejected ones can render in the collapsible
  // footer while still requiring a decision stays foregrounded.
  MaxEnginePicker.applyRequiredAndAutoKeep(cands, _tb.requiredPlaces);
  var _hxParts    = MaxEnginePicker.partitionByStatus(cands);
  var activeCands = _hxParts.active;
  var rejectedCands = _hxParts.rejected;

  // ── Group candidates by primary must-do ─────────────────────
  // The Candidate Explorer organizes by must-do instead of a flat required/discovery
  // split. Each candidate appears in exactly one section — its FIRST must-do in the
  // user's sentence order. Other must-dos this candidate supports appear as an
  // "You will also find:X, Y" badge on the card itself.
  //
  // Round HX: pure derivation now lives in MaxEnginePicker.groupCandidatesByMustDo.
  // Engine tests cover the algorithm; the renderer just reads the result.
  // Round HX.6: groupCandidatesByMustDo now also returns mustDoOrder
  // (the user-sentence-ordered list of active must-do names). The
  // activity-lens code path below walks it to drive section ordering;
  // before HX.6 a stale local `var mustDoOrder = …` declaration was
  // dropped during HX without re-surfacing the value, leaving the
  // forEach a few lines below as a ReferenceError on the default lens.
  var _hxGrouped = MaxEnginePicker.groupCandidatesByMustDo(activeCands, _mdcItems);
  var candByPrimary   = _hxGrouped.candByPrimary;
  var primaryByCandId = _hxGrouped.primaryByCandId;
  var discoveryCands  = _hxGrouped.discoveryCands;
  var mustDoOrder     = _hxGrouped.mustDoOrder;
  // ── Progressive disclosure ──────────────────────────────
  // Candidate cards render compact by default (name · role · stay · status +
  // Keep/chevron). Full detail (whyItFits, Also here, badges, tags, Reject,
  // Compare) only appears when the user explicitly expands a card. Less noise
  // on first look; same information one tap away.
  // HX.12 (v308): body lifted into picker-ui.js as
  // MaxPickerUI.renderCandidateCard. Inline thin delegator stays
  // because callers reference the local closure name. The lifted
  // version takes primaryByCandId + addMarkerFn + mdcItems as
  // explicit args; the closure call site below threads them
  // through.
  function renderCard(c, container){
    return MaxPickerUI.renderCandidateCard(c, container, primaryByCandId, _addCandidateMarker, _mdcItems);
  }

  // _makeCandidateIcon moved to picker-ui.js (Round HX.3). Aliased on
  // window so the call sites here keep working unchanged.

  // Map marker renderer. Patch (post-HX.10): the `grayed` second arg
  // and its supporting "Show me the best" plumbing was removed when
  // that toggle came out of the UI; nothing now passes grayed=true.
  // The parameter survives in the signature to minimize the diff —
  // every call site already passes a falsy second arg.
  function _addCandidateMarker(c, grayed){
    if(!c.lat || !c.lng || !_ceMap) return;
    var selected = (c.id === _ceSelectedCandId);
    var icon = _makeCandidateIcon(c, grayed, selected);
    var m = L.marker([c.lat,c.lng],{icon:icon, zIndexOffset: selected ? 1000 : 0});
    var tipStay = c.stayRange ? " \u00b7 "+c.stayRange : "";
    m.bindTooltip(c.place + tipStay, {permanent:false,direction:"top",offset:[0,-14],className:"ce-map-tooltip"});
    (function(cand){m.on("click",function(){
      var ce=g("ce-card-"+cand.id);
      if(ce){
        ce.scrollIntoView({behavior:"smooth",block:"nearest"});
        document.querySelectorAll(".ce-card.map-selected").forEach(function(el){el.classList.remove("map-selected");});
        ce.classList.add("map-selected");
        setTimeout(function(){ce.classList.remove("map-selected");},2500);
      }
    });})(c);
    m.addTo(_ceMap); _ceMarkers.push(m);
    // Track by candidate id so card→pin selection can look the marker up later.
    _ceMarkerById[c.id] = m;
    // Round FU.2: only push to bounds if the coord is sane relative to the
    // seeded region. LLM hallucinations (Iceland places returning Swiss
    // lat/lng) used to drag the map view to the wrong country.
    if (typeof _fuCoordSane !== "function" || _fuCoordSane(c.lat, c.lng)) {
      bounds.push([c.lat,c.lng]);
    }
  }

  // Slim header — always visible. One line of context + a Build button + the
  // Show-me-the-best/Show-all density toggle. No summary takeover; sections are
  // the primary view.
  var kept = MaxEnginePicker.keptCandidates(_tb.candidates);
  console.log("[Max] renderCandidateCards: kept.length =", kept.length, "/ _tb.candidates =", (_tb.candidates||[]).length,
    "/ sample status =", (_tb.candidates && _tb.candidates[0]) ? {place:_tb.candidates[0].place, status:_tb.candidates[0].status, required:_tb.candidates[0]._required} : null);
  var headerWrap = document.createElement("div");
  headerWrap.style.cssText = "margin:8px 4px 10px;padding:10px 14px;background:var(--c-bg);border:1px solid #e0e8f0;border-radius:8px;";
  // Round HX.4: day-range summary now MaxEnginePicker.keptDaysRangeText.
  // Returns the formatted "5 days" / "5\u20137 days" string, or empty when any
  // stayRange is unparseable (header omits the time clause rather than
  // misleading the user with a partial total).
  var _dayRangeStr = MaxEnginePicker.keptDaysRangeText(kept);

  var headerLabel = document.createElement("div");
  headerLabel.style.cssText = "font-size:11px;color:var(--c-ink-2);line-height:1.6;margin-bottom:6px;";
  if (!kept.length) {
    headerLabel.innerHTML = '<em>Pick at least one place to build a trip.</em>';
  } else {
    var timeClause = _dayRangeStr
      ? '\u00b7 roughly <strong style="color:var(--c-ink);">' + _dayRangeStr + '</strong>'
      : '';
    headerLabel.innerHTML = kept.length + ' place' + (kept.length!==1?'s':'') + ' kept ' + timeClause;
  }
  headerWrap.appendChild(headerLabel);
  if (kept.length) {
    var keptLine = document.createElement("div");
    keptLine.style.cssText = "font-size:12px;color:var(--c-ink);line-height:1.6;margin-bottom:4px;";
    keptLine.innerHTML = kept.map(function(c){return '<strong>'+c.place+'</strong>';}).join(' \u00b7 ');
    headerWrap.appendChild(keptLine);
  }
  var headerStay = document.createElement("div");
  headerStay.id = "ce-summary-stay";
  headerStay.style.cssText = "font-size:10px;color:var(--c-ink-3);margin-bottom:8px;";
  headerWrap.appendChild(headerStay);
  var headerBtns = document.createElement("div");
  headerBtns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;align-items:center;";
  if (_ceEditMode) {
    var sumBuild = document.createElement("button");
    sumBuild.style.cssText = "font-size:11px;font-weight:700;padding:7px 13px;border-radius:5px;border:1px solid var(--c-border-dark);background:var(--c-primary-top);color:var(--c-on-dark);cursor:pointer;font-family:inherit;"+(kept.length?"":"opacity:0.5;cursor:not-allowed;");
    sumBuild.textContent = "Apply changes \u2192";
    sumBuild.disabled = !kept.length;
    sumBuild.onclick = function(){ if (!sumBuild.disabled) applyCandidateChanges(); };
    headerBtns.appendChild(sumBuild);
  }
  // Patch (post-HX.10): "Show me the best" / "Show all" toggle removed.
  // The button was rendered unconditionally but had been hidden / removed
  // from the visible UI in an earlier round; the supporting engine code
  // (shouldShowAllInSection, _ceBestMode flag, "+N more"/"Collapse" pair
  // in _renderMustDoSection) was dead. All three are gone now.
  headerWrap.appendChild(headerBtns);

  // Trip Details — entry/exit, dates, flight numbers. Replaces the old
  // pre-build modal; it's inline here so the user can fill in (or edit) any
  // of this at any time without leaving the page. Collapsible to stay quiet
  // when not needed.
  var detailsStrip = _renderTripDetailsStrip(kept);
  if (detailsStrip) headerWrap.appendChild(detailsStrip);

  // Add-a-place input — brings in destinations the user has heard about that
  // Max didn't generate. This is where the tourist's knowledge starts sharing
  // the lead with the traveler's planning.
  var addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid var(--c-border-4);";
  addRow.innerHTML =
    '<input id="ce-add-place-inp" placeholder="Heard about a place not on the list? Type it here\u2026" style="flex:1;min-width:0;font-size:11px;padding:7px 10px;border:1px solid var(--c-border);border-radius:5px;font-family:inherit;" onkeydown="if(event.key===&#39;Enter&#39;){event.preventDefault();addPlaceToCandidates();}" />'
    +'<button onclick="addPlaceToCandidates()" style="font-size:11px;font-weight:600;padding:7px 12px;background:var(--c-bg);color:#333;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;white-space:nowrap;">+ Add</button>';
  headerWrap.appendChild(addRow);
  // Lens bar — three different organizations of the same data. Different
  // travelers look for different things; same places, three reorderings.
  // ("Trip order" lens removed from this page — without known entry/exit,
  // any ordering is just a guess. The schedule view appears on the next
  // page, once the user has committed entry and exit.)
  // Round HX.7: lens-bar DOM moved to MaxPickerUI.renderCELensBar.
  headerWrap.appendChild(MaxPickerUI.renderCELensBar());
  el.appendChild(headerWrap);

  // Round HX.6: bestPickFirst now lives at MaxEnginePicker.bestPickFirstSort.
  // Inline declaration kept as a thin alias so the call sites below stay
  // unchanged. The region-lens block at the bottom uses a sibling sort
  // (kept-first then alphabetical-by-place) that's NOT a generalization
  // of this one — left inline for now; can compose on the engine helper
  // in a future round if the second sort gets extracted too.
  function bestPickFirst(group){ return MaxEnginePicker.bestPickFirstSort(group); }

  // ── Lens dispatch ───────────────────────────────────────
  // The same candidate data is reorganized four ways so travelers can look at
  // it the way that matches their current question: by activity (why is this
  // place on my list?), by region (what fits together geographically?), by
  // trip order (what does my trip actually look like?), or by commitment
  // (what have I already decided?).
  if (_ceLens === "activity") {
  // ── SCAFFOLD-1.5: Why you're here ───────────────────────
  // Leads the picker with categories built from the traveler's
  // stated draw (placeContext) — their words first, Max's
  // organization second. Members are pulled from the same candidate
  // list the standard sections use; cards can appear in both
  // (intentional — an activity that fits the user's "Why" AND
  // Max's "Scenic travel" deserves to surface twice). Async: a
  // first paint shows a sketching skeleton; when the LLM returns
  // the picker re-renders with the real categories.
  (function _renderUserReasons(){
    var ctx = (_tb && _tb.placeContext || "").trim();
    if (!ctx || activeCands.length < 2) return;  // nothing to lead with
    var cacheKey = ctx.toLowerCase() + "|" + ((_tb.region||"").toLowerCase()) + "|" + activeCands.length;
    var cache = _tb._userReasonsCache || null;
    var buckets = (cache && cache.key === cacheKey && Array.isArray(cache.value)) ? cache.value : null;
    if (buckets === null) {
      // Cache miss → render skeleton, fire async LLM, re-render on return.
      var sk = document.createElement("div");
      sk.style.cssText = "margin:8px 4px 14px;padding:10px 12px;background:var(--c-panel);border:1px dashed var(--c-border);border-radius:7px;font-size:11px;color:var(--c-ink-3);font-style:italic;";
      sk.textContent = "Sketching what's drawing you here…";
      el.appendChild(sk);
      MaxEnginePicker.deriveUserReasons(_tb.placeContext, activeCands, _mdcItems, _tb.region).then(function(){
        // Re-render the activity lens now that the cache is populated.
        if (_ceLens === "activity") renderCandidateCards(_tb.candidates);
      });
      return;
    }
    if (!buckets.length) return;  // cache hit but empty → user's words don't suggest extra framing

    var urWrap = document.createElement("div");
    urWrap.style.cssText = "margin:8px 4px 16px;";

    var urHeader = document.createElement("div");
    urHeader.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:6px;";
    urHeader.textContent = "Why you're here";
    urWrap.appendChild(urHeader);

    // Need typeLabelMap for cross-reference badges (defined a few lines
    // below). Inline it here so we don't depend on declaration order.
    var _urTypeLabelMap = { route: "Scenic travel", activity: "Activities", condition: "Conditions", manual: "Places you added" };

    buckets.forEach(function(bucket, idx){
      var bHdr = document.createElement("div");
      bHdr.style.cssText = "margin-top:" + (idx ? 14 : 6) + "px;padding:6px 0 4px;font-size:13px;font-weight:700;color:#1a5fa8;letter-spacing:0.01em;";
      bHdr.textContent = bucket.name;
      urWrap.appendChild(bHdr);

      var memberCount = 0;
      (bucket.members || []).forEach(function(memberId){
        var cand = activeCands.find(function(c){ return c && c.id === memberId; });
        if (!cand) return;
        renderCard(cand, urWrap);
        memberCount++;
        // Cross-reference: tell the user which standard section this
        // also lives under, so they can see how the user-reason
        // categories overlap with Max's organization.
        var primaryMust = primaryByCandId[memberId];
        if (primaryMust) {
          var mdItem = (_mdcItems||[]).find(function(m){ return m.name === primaryMust; });
          var mdType = (mdItem && mdItem.type) || "activity";
          var mdLabel = _urTypeLabelMap[mdType] || mdType;
          var crossRef = document.createElement("div");
          crossRef.style.cssText = "font-size:9.5px;color:#999;margin:-2px 0 6px 24px;font-style:italic;";
          crossRef.textContent = "Also under " + mdLabel;
          urWrap.appendChild(crossRef);
        }
      });
    });

    // PD.87: "Beyond what you are coming for…" subhead removed (also
    // here in the candidate-explorer "user's reasons" variant). The
    // box above explains itself; no transition needed.
    el.appendChild(urWrap);
  })();

  // Must-dos summary — the single source of truth for what the user asked for.
  // Lives at the top of the activity lens so the user can always see their
  // train routes and activity names + descriptions, even before candidate cards
  // land and regardless of which ones got matched. Includes items marked
  // checked=false too (grayed) so the user sees the full mental picture.
  // Round HX.9: DOM construction lives in MaxPickerUI.renderMustDosSummary.
  var allMustDos = (_mdcItems||[]).filter(function(m){ return m && m.name && m.name !== "__manual__"; });
  var _hxSumWrap = MaxPickerUI.renderMustDosSummary(allMustDos);
  if (_hxSumWrap) el.appendChild(_hxSumWrap);
  // Group activity sections by type — all TRAINS together, all ACTIVITIES
  // together, all CONDITIONS together. Each type gets one umbrella header; the
  // individual must-dos live as sub-sections underneath. Reduces the "wall of
  // sections" feeling when a user has many must-dos.
  // Section umbrella labels. "Scenic travel" reframes routes as transportation
  // between the real destinations (activities and places), not as activities
  // themselves — matches how a traveler actually thinks about a Glacier Express
  // ride: it's the way you get from Zermatt to St. Moritz, beautifully.
  var typeLabelMap = { route: "Scenic travel", activity: "Activities", condition: "Conditions", manual: "Places you added" };
  // Round HX.7: umbrella partition lives in the engine. Default type
  // for unknown items stays "activity" (a custom chip without an
  // explicit type lands in Activities). The engine returns its own
  // typeOrder so this code path doesn't have to keep two copies in
  // sync — they were drifting (typeOrder was inline; the engine has
  // its own sense of canonical ordering).
  var _hxParted = MaxEnginePicker.partitionMustDosByType(mustDoOrder, _mdcItems);
  var mustDoOrderByType = _hxParted.byType;
  var typeOrder         = _hxParted.typeOrder;
  var renderedAny = false;
  typeOrder.forEach(function(t){
    var names = mustDoOrderByType[t];
    if (!names || !names.length) return;
    // For routes and activities we ALWAYS render the section — the user needs
    // to see their train routes and activity descriptions in Places even before
    // endpoint candidates have been generated. For conditions and manual we
    // keep the old "skip if empty" rule because those have no standalone
    // value without candidate cards.
    // Round HX.9: section-render policy is MaxEnginePicker.mustDoSectionRenderable.
    var hasAnyGroup = names.some(function(n){ return candByPrimary[n] && candByPrimary[n].length; });
    if (!MaxEnginePicker.mustDoSectionRenderable(t, hasAnyGroup)) return;
    // Umbrella type header
    var typeHdr = document.createElement("div");
    typeHdr.style.cssText = "margin-top:18px;padding:10px 4px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--c-ink);border-top:"+(renderedAny?"1px solid #e8e8e8":"none")+";";
    typeHdr.textContent = typeLabelMap[t] || t;
    el.appendChild(typeHdr);
    renderedAny = true;
    // Render each must-do of this type as its sub-section
    names.forEach(function(mdName){
      _renderMustDoSection(mdName, el);
    });
  });

  // HX.11 (v307): body lifted into picker-ui.js as
  // MaxPickerUI.renderMustDoSection. Inline thin delegator stays
  // because callers reference the local closure name. The lifted
  // version takes candByPrimary + _mdcItems as explicit args; the
  // closure call site below threads them through.
  function _renderMustDoSection(mdName, container){
    return MaxPickerUI.renderMustDoSection(mdName, container, candByPrimary, _mdcItems);
  }

  // Discovery section. Canonical destinations (widelyRecommended) appear here
  // alongside thematic picks; the \u2605 marker on the compact card already
  // signals their status. Header wording depends on whether any must-do sections
  // rendered: if activity groups are showing above, these are "Other places
  // worth considering"; if nothing rendered above (no must-dos / no matches),
  // they ARE the list and deserve a plain "Places" header, not a secondary one.
  if (discoveryCands.length) {
    // Patch (post-HX.10): best-mode branch removed; always render the
    // discovery cards.
    var dhdr = document.createElement("div");
    dhdr.style.cssText = "margin-top:14px;padding:10px 4px 6px;font-size:10px;font-weight:700;text-transform:uppercase;color:var(--c-ink);letter-spacing:0.06em;"
      + (renderedAny ? "border-top:1px solid #e8e8e8;" : "");
    dhdr.textContent = renderedAny ? "Other places worth considering" : "Places";
    el.appendChild(dhdr);
    discoveryCands.forEach(function(c){ renderCard(c, el); });
  }
  } else if (_ceLens === "region") {
    // Group candidates by country (fallback: "Unknown"). Within each group, sort
    // kept first, then by place name. Gives the traveler a geographic view —
    // useful for spotting clustering opportunities and cross-border trade-offs.
    // Round HX.7: grouping + country ordering live in the engine
    // (MaxEnginePicker.groupByCountry). Per-country secondary sort
    // (kept-first + alphabetical-by-place) is still inline because
    // the activity-lens uses a different sort (kept-first + required-
    // first via bestPickFirstSort) and we want both lenses to keep
    // their distinct intent visible.
    var _hxRegion = MaxEnginePicker.groupByCountry(activeCands);
    var byCountry = _hxRegion.byCountry;
    var countries = _hxRegion.countriesSortedByCount;
    countries.forEach(function(country, idx){
      var hdr = document.createElement("div");
      hdr.style.cssText = "margin-top:"+(idx?14:6)+"px;padding:10px 4px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#111;"+(idx?"border-top:1px solid #e8e8e8;":"");
      hdr.textContent = country + "  ·  " + byCountry[country].length + " place" + (byCountry[country].length!==1?"s":"");
      el.appendChild(hdr);
      // Round HX.8: per-country secondary sort lives in
      // MaxEnginePicker.regionWithinCountrySort (kept-first then
      // alphabetical by place — the lens emphasizes geography).
      MaxEnginePicker.regionWithinCountrySort(byCountry[country])
        .forEach(function(c){ renderCard(c, el); });
    });
  } else if (_ceLens === "time") {
    // HX.13 (v310): time-lens body lifted into picker-ui.js as
    // MaxPickerUI.renderTimeLensItinerary. Inline now a thin
    // delegator threading activeCands + el + _mdcItems + _tb.
    MaxPickerUI.renderTimeLensItinerary(activeCands, el, _mdcItems, _tb);
    } else if (_ceLens === "commitment") {
    // Split by status: kept first (what you've decided), then undecided. Lets the
    // user see at a glance how many real commitments they've made vs. how many
    // options are still open.
    // Round HX.8: kept/unset partition lives in
    // MaxEnginePicker.partitionActiveByCommitment. Labels stay inline
    // because they're pure user-facing copy (no engine concern).
    var _hxCommit = MaxEnginePicker.partitionActiveByCommitment(activeCands);
    var buckets = [
      {key:"keep",  label:"Kept \u2014 already in your trip", items: _hxCommit.kept},
      {key:"unset", label:"Undecided \u2014 still open",      items: _hxCommit.unset}
    ];
    buckets.forEach(function(b, idx){
      if (!b.items.length) return;
      var hdr = document.createElement("div");
      hdr.style.cssText = "margin-top:"+(idx?14:6)+"px;padding:10px 4px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:"+(b.key==="keep"?"#2a7a4e":"#111")+";"+(idx?"border-top:1px solid #e8e8e8;":"");
      hdr.textContent = b.label + "  \u00b7  " + b.items.length;
      el.appendChild(hdr);
      b.items.forEach(function(c){ renderCard(c, el); });
    });
  }

  // "Maybe later" — rejected candidates. Expanded by default so a freshly
  // rejected place visibly moves here instead of appearing to vanish.
  // Round HX.8: DOM construction lives in MaxPickerUI.renderRejectedSection.
  var _hxRejWrap = MaxPickerUI.renderRejectedSection(rejectedCands);
  if (_hxRejWrap) el.appendChild(_hxRejWrap);

  // Entry-point pins (air + rail + sea + bus) are now planted on _ceMap at
  // map-init time via _ensureEntryPointsForRegion. We no longer call the
  // airports-only _addAirportsToCeMap here — it was shadowing the mixed-mode
  // system and making the map read as airports-only.
  if(bounds.length>1) setTimeout(function(){try{_ceMap.fitBounds(bounds,{padding:[28,28]});}catch(e){}},150);
  updateCEShortlist();
  showCandidateDisclaimer();
  // Geocode any candidates missing lat/lng and add their markers
  var missingCoords = cands.filter(function(c){ return !c.lat || !c.lng || c.lat===0; });
  if (missingCoords.length > 0) {
    geocodeMissingCandidates(missingCoords, cands);
  }
  // Round HZ (picker hero map): draw the route polyline through the
  // ordered sequence. Late-arriving geocodes call this again themselves
  // so the line extends when coords land.
  _redrawCePolyline();
}

function rIcon(r){
  if(!r) return "\uD83D\uDCCD";
  var rl=r.toLowerCase();
  if(rl.indexOf("base")>-1) return "\uD83C\uDFE0";
  if(rl.indexOf("anchor")>-1) return "\u2693";
  if(rl.indexOf("pass")>-1) return "\u2192";
  return "\uD83D\uDCCD";
}

// "Drop this activity" — reject every candidate under a must-do and uncheck the
// must-do itself, so the merged Places page can serve as both the must-do curation
// screen and the destination picker in one view.
// Add a place the user has heard about — something that wasn't in Max's
// generated list. Fires a focused LLM call to produce a candidate card for
// that one place, then slots it into _tb.candidates as a discovery pick
// (not required, not pre-kept) so the user can evaluate it alongside the rest.
// Round HZ (picker hero map, step 5): add-by-name now Nominatim-first.
// Fast path: geocode via Nominatim (~300\u2013500ms), insert the candidate
// immediately with real coords + status="keep" so the new pin lands on
// the map and the row appears in the ordered sequence right away. A
// background LLM call then fills in the rationale (whyItFits, tradeoffs,
// tags) and a follow-up re-render slots them into the sidebar row.
//
// Slow path (Nominatim returns nothing): falls back to a single LLM
// call that returns the full candidate shape \u2014 preserves the original
// flow's "is this a real place" validation via the {error:"..."} sentinel.
//
// User-added candidates default to status="keep" (accepted \u2713): the
// user already showed intent by typing the name, so we don't make
// them check a box afterwards. They can still uncheck or reject.
async function addPlaceToCandidates(){
  var inp = document.getElementById("ce-add-place-inp");
  if (!inp) return;
  var raw = (inp.value||"").trim();
  if (!raw) return;

  // De-dupe: place already on the list \u2192 just highlight it.
  var existing = (_tb.candidates||[]).find(function(c){
    return (c.place||"").toLowerCase() === raw.toLowerCase();
  });
  if (existing) {
    inp.value = "";
    showSaveStatus(existing.place + " is already on the list.", 2500);
    var existingRow = document.querySelector('.ce-sidebar-row[data-cand-id="' + existing.id + '"]')
                   || document.getElementById("ce-card-" + existing.id);
    if (existingRow && existingRow.scrollIntoView) existingRow.scrollIntoView({behavior:"smooth", block:"center"});
    return;
  }

  var btn = inp.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = "Adding\u2026"; }
  inp.disabled = true;
  var prevPh = inp.placeholder;
  inp.placeholder = "Locating " + raw + "\u2026";

  var region = (_tb && _tb.region) || "";

  // \u2500\u2500 Step 5a: Nominatim geocode for fast coord placement \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Mirrors the pattern in geocodeMissingCoords \u2014 region-biased first,
  // bare-name retry as fallback. Country comes from address.country
  // in jsonv2 (cleaner than parsing display_name).
  var geocoded = null;
  try {
    var qBiased = raw + (region ? ", " + region : "");
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=' + encodeURIComponent(qBiased);
    var r = await fetch(url, {headers:{'Accept-Language':'en'}});
    var data = await r.json();
    if ((!data || !data.length) && region) {
      url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=' + encodeURIComponent(raw);
      r = await fetch(url, {headers:{'Accept-Language':'en'}});
      data = await r.json();
    }
    if (data && data.length && data[0].lat) {
      geocoded = {
        place: raw,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        country: (data[0].address && data[0].address.country) || ""
      };
    }
  } catch(e) { /* fall through to LLM-only slow path */ }

  // \u2500\u2500 Fast path: Nominatim found it \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (geocoded) {
    var candidate = {
      id: "c-user-" + Date.now(),
      place: geocoded.place,
      country: geocoded.country || "",
      lat: geocoded.lat,
      lng: geocoded.lng,
      // NOTE: this `role` is the LEGACY "base/anchor/pass" categorization,
      // NOT the NC.3 role vocabulary (stay/see/daytrip/onway/maybe/reject).
      // Keep "base" so the LLM-returned rationale at line ~28327 can
      // overwrite it. The NC.3 role lives on the next two lines.
      role: "base",
      stayRange: "2-3 nights",
      whyItFits: "",
      tradeoffs: null,
      tags: [],
      status: "keep",          // user-added \u2192 accepted \u2713 by default
      _required: false,
      _requiredFor: [],
      _userAdded: true,
      order: null,
      manuallyOrdered: false,
      // NC.9.9: explicitly add as an overnight Stay AND mark
      // _roleTouched=true. Without this, the trip view's pin renderer
      // sees role unset and runs the predictor override (line ~35379),
      // which downgrades a user-added place close to another stay to
      // "daytrip" silently. Neal: "selfos still a problem" \u2014 Selfoss
      // is ~50km from Reykjav\u00edk so it tripped the day-trip range
      // heuristic. User-explicit-add = user-committed = Stay.
    };
    // Override `role` field name collision: above sets the legacy
    // role field; the next assignment is the NC.3 role. The LLM
    // rationale fetch below overwrites legacy `role` again but leaves
    // these alone.
    candidate.role = "stay";
    candidate._roleTouched = true;
    _tb.candidates = _tb.candidates || [];
    _tb.candidates.push(candidate);
    if (typeof _tbResequenceCandidates === "function") _tbResequenceCandidates();
    inp.value = "";
    inp.placeholder = prevPh;
    inp.disabled = false;
    if (btn) { btn.disabled = false; btn.textContent = "+ Add"; }
    inp.focus();
    renderCandidateCards(_tb.candidates);
    setTimeout(function(){
      var row = document.querySelector('.ce-sidebar-row[data-cand-id="' + candidate.id + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({behavior:"smooth", block:"center"});
    }, 100);

    // Background rationale fetch \u2014 focused prompt, no need to re-geocode.
    try {
      var ratPrompt = "A traveler is going to " + (region || "this region") + " and just added "
        + candidate.place + " to their candidate list. Give the rationale fields that a candidate card needs. "
        + "Be specific \u2014 name a museum, a dish, a railway, a view; don't hand-wave with 'major museums' or 'scenic rail.' "
        + "Return ONLY a JSON object (no markdown): "
        + '{"role":"base|anchor|pass","stayRange":"2-3 nights","whyItFits":"why worth visiting","tradeoffs":"one honest downside","tags":["tag1","tag2"]}';
      var t = await callMax([{role:"user", content:ratPrompt}], 400, 20000);
      var cleaned = t.replace(/```json|```/g, "").trim();
      var first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
      if (first > -1 && last > -1) cleaned = cleaned.substring(first, last+1);
      var d = JSON.parse(cleaned);
      // NC.9.9: skip role overwrite. d.role here is the legacy
      // "base|anchor|pass" categorization the LLM was prompted for;
      // nothing in the codebase reads those values anymore (grep
      // confirms: no `role === "base"` etc.), and overwriting would
      // clobber the NC.3 role ("stay") we just set above. Just take
      // the prose fields.
      if (d.stayRange) candidate.stayRange = d.stayRange;
      if (d.whyItFits) candidate.whyItFits = d.whyItFits;
      if (d.tradeoffs) candidate.tradeoffs = d.tradeoffs;
      if (Array.isArray(d.tags)) candidate.tags = d.tags;
      renderCandidateCards(_tb.candidates);
    } catch(e) {
      // Rationale failed \u2014 the candidate is still on the list with
      // empty whyItFits. The user typed the name so they know why
      // they added it; the row stays usable.
      console.warn("addPlace rationale failed:", e && e.message);
    }
    return;
  }

  // \u2500\u2500 Slow path: Nominatim couldn't find it \u2014 defer to LLM \u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Single-shot LLM call that returns the full candidate shape OR an
  // {error:"..."} sentinel for nonsense input. This preserves the
  // pre-step-5 validation behavior.
  inp.placeholder = "Adding " + raw + "\u2026";
  try {
    var prompt = "A traveler is planning a trip to " + (region||"this region") + " and has asked you to add '" + raw + "' to the list of candidate destinations. Return ONLY a JSON object (no markdown) describing this place as a candidate card:\n"
      + '{"place":"...","country":"...","role":"base|anchor|pass","stayRange":"2-3 nights","whyItFits":"Why worth visiting \u2014 specific, named things.","tradeoffs":"One honest downside.","tags":["tag1","tag2"],"otherAttractions":"2-3 other things worth considering here \u2014 named specifics.","widelyRecommended":false,"lat":0.0,"lng":0.0}\n'
      + "BE SPECIFIC. Name the trains, museums, dishes, trails \u2014 don't hand-wave with 'major museums' or 'scenic rail.'\n"
      + "If '"+raw+"' isn't a real place or doesn't make sense for a trip to "+(region||"this region")+", return {\"error\":\"why\"} instead.";
    var text = await callMax([{role:"user",content:prompt}], 600, 25000);
    var cleaned2 = text.replace(/```json|```/g,"").trim();
    var f2 = cleaned2.indexOf("{"), l2 = cleaned2.lastIndexOf("}");
    if (f2 > -1 && l2 > -1) cleaned2 = cleaned2.substring(f2, l2+1);
    var data2 = JSON.parse(cleaned2);
    if (data2.error) throw new Error(data2.error);
    if (!data2.place) throw new Error("No place returned");
    data2.id = "c-user-" + Date.now();
    data2.status = "keep";    // user-added \u2192 accepted \u2713
    data2._required = false;
    data2._requiredFor = [];
    data2._userAdded = true;
    data2.order = null;
    data2.manuallyOrdered = false;
    // NC.9.9: same as the fast path above \u2014 user-explicit-add is a
    // commit. Set NC.3 role="stay" + _roleTouched=true so the trip-
    // view pin renderer's predictor override doesn't reclassify this
    // to "daytrip" when the place sits within day-trip range of
    // another stay. Overwrites the LLM's legacy "base|anchor|pass"
    // role value, which nothing reads anymore.
    data2.role = "stay";
    data2._roleTouched = true;
    _tb.candidates = _tb.candidates || [];
    _tb.candidates.push(data2);
    if (typeof _tbResequenceCandidates === "function") _tbResequenceCandidates();
    inp.value = "";
    renderCandidateCards(_tb.candidates);
    setTimeout(function(){
      var row2 = document.querySelector('.ce-sidebar-row[data-cand-id="' + data2.id + '"]')
              || document.getElementById("ce-card-" + data2.id);
      if (row2 && row2.scrollIntoView) {
        row2.scrollIntoView({behavior:"smooth", block:"center"});
        row2.style.animation = "ce-fade-in 0.4s ease";
      }
    }, 100);
  } catch(e) {
    console.warn("addPlaceToCandidates failed:", e && e.message);
    showSaveStatus("Couldn\u2019t add that place: " + (e.message||"try a more specific name"), 3500);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "+ Add"; }
    if (inp) { inp.disabled = false; inp.placeholder = prevPh; inp.focus(); }
  }
}

function _dropActivity(mdName){
  if (!mdName) return;
  var cands = (_tb.candidates||[]).filter(function(c){
    return (c._requiredFor||[]).indexOf(mdName) > -1 && c.status !== "reject";
  });
  if (!cands.length) return;
  if (!confirm("Drop " + mdName + "? Every destination under it will be rejected and " + mdName + " removed from your trip.")) return;
  // Uncheck the must-do
  if (typeof _mdcItems !== "undefined" && _mdcItems) {
    _mdcItems.forEach(function(m){ if (m.name === mdName) m.checked = false; });
  }
  // Mark every candidate under it as rejected
  cands.forEach(function(c){
    c.status = "reject";
    // Strip this must-do out of its _requiredFor so other sections don't show "also supports"
    c._requiredFor = (c._requiredFor||[]).filter(function(r){ return r !== mdName; });
    if (!c._requiredFor.length) c._required = false;
  });
  // Keep _tb.requiredPlaces in sync
  if (_tb.requiredPlaces) {
    _tb.requiredPlaces = _tb.requiredPlaces.filter(function(p){
      p.requiredFor = (p.requiredFor||[]).filter(function(r){ return r !== mdName; });
      return p.requiredFor.length > 0;
    });
  }
  renderCandidateCards(_tb.candidates);
}

// Custom confirmation modal for rejecting a required candidate. Opens immediately
// with a "thinking" state, fires an LLM call for a conversational message naming
// the specific supporters/countries/must-dos, and falls back to a structured
// message if the call fails or times out. Returns Promise<boolean> — true = reject.
function showRejectRequiredModal(c, willDrop, willKeep, hasManual){
  var ov=document.createElement("div");
  ov.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;";
  var modal=document.createElement("div");
  modal.style.cssText="background:var(--c-bg);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-width:480px;width:100%;overflow:hidden;font-family:inherit;";
  modal.innerHTML=
    '<div style="padding:16px 18px 10px;">'
    +'<div style="font-size:14px;font-weight:700;color:var(--c-ink);margin-bottom:10px;">Reject '+c.place+'?</div>'
    +'<div id="rrm-body" style="font-size:12px;line-height:1.65;color:#333;min-height:54px;">'
    +'<span style="color:#999;font-style:italic;">Thinking about the trade-offs\u2026</span>'
    +'</div>'
    +'</div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 18px 16px;">'
    +'<button id="rrm-cancel" style="font-size:11px;padding:7px 14px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);color:#333;cursor:pointer;font-family:inherit;font-weight:600;">Keep it</button>'
    +'<button id="rrm-confirm" style="font-size:11px;padding:7px 14px;border:1px solid #c05020;border-radius:5px;background:#c05020;color:var(--c-on-dark);cursor:pointer;font-family:inherit;font-weight:600;">Reject</button>'
    +'</div>';
  ov.appendChild(modal);
  document.body.appendChild(ov);

  var resolved=false, resolver;
  var decision=new Promise(function(r){resolver=r;});
  function close(v){ if(resolved)return; resolved=true; ov.remove(); resolver(v); }
  modal.querySelector("#rrm-cancel").onclick=function(){close(false);};
  modal.querySelector("#rrm-confirm").onclick=function(){close(true);};
  ov.onclick=function(e){if(e.target===ov)close(false);};
  document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){close(false);document.removeEventListener("keydown",esc);}});

  // Build structured fallback once — used if LLM fails or returns nothing
  function buildFallback(){
    function joinList(arr){
      if (arr.length===1) return arr[0];
      if (arr.length===2) return arr[0]+" or "+arr[1];
      return arr.slice(0,-1).join(", ")+", or "+arr[arr.length-1];
    }
    var parts=[];
    willDrop.forEach(function(n){
      parts.push(n+" would be dropped \u2014 no other place you\u2019ve picked can cover it.");
    });
    willKeep.forEach(function(k){
      parts.push(k.name+" still works \u2014 "+joinList(k.supporters.map(function(s){return s.place+(s.country?" ("+s.country+")":"");}))+" can cover it.");
    });
    if (hasManual) parts.push(c.place+" is a must-see you added; rejecting removes it from the trip.");
    if (!parts.length) parts.push(c.place+" is marked required. Continue?");
    return parts.join(" ");
  }

  // Kick off the LLM call (non-blocking — modal is already up with spinner text)
  (async function(){
    try{
      var ctx={
        rejecting: c.place,
        rejectingCountry: c.country||null,
        rejectingRole: c.role||null,
        tripRegion: (_tb&&_tb.region)||null,
        mustDos: [].concat(
          willDrop.map(function(n){return {name:n, willDrop:true, supporters:[]};}),
          willKeep.map(function(k){return {name:k.name, willDrop:false, supporters:k.supporters};})
        ),
        hasManualMustSee: hasManual
      };
      var lines=[];
      lines.push("Write a short, conversational message (2\u20133 sentences, plain prose, no bullets, no markdown) for a traveler considering rejecting a destination. Voice: a knowledgeable friend who plans trips \u2014 direct, specific, flagging geographic wrinkles.");
      lines.push("");
      lines.push("Rejecting: "+ctx.rejecting+(ctx.rejectingCountry?" ("+ctx.rejectingCountry+")":"")+(ctx.rejectingRole?" \u2014 "+ctx.rejectingRole:""));
      if(ctx.tripRegion) lines.push("Trip region: "+ctx.tripRegion);
      lines.push("");
      lines.push("This destination is part of your trip for:");
      ctx.mustDos.forEach(function(m){
        if(m.willDrop){
          lines.push("- "+m.name+": no other candidate can cover it \u2014 would be DROPPED if this is rejected.");
        } else {
          var subs=m.supporters.map(function(s){return s.place+(s.country?" ("+s.country+")":"");}).join(" or ");
          lines.push("- "+m.name+": could still be covered by "+subs);
        }
      });
      if(ctx.hasManualMustSee) lines.push("Note: also a must-see the user specifically added.");
      lines.push("");
      lines.push("If any surviving supporter is in a different country than the trip region, flag it naturally. End with a direct question (e.g., \"still want to reject it?\"). Do not list options or use bullets. Plain prose only.");
      var prompt=lines.join("\n");
      var text=await callMax([{role:"user",content:prompt}], 250, 10000);
      if(resolved) return;
      var clean=(text||"").trim().replace(/^["\u201c]+|["\u201d]+$/g,"");
      var body=modal.querySelector("#rrm-body");
      if(body) body.textContent=clean||buildFallback();
    } catch(e){
      if(resolved) return;
      var body=modal.querySelector("#rrm-body");
      if(body) body.textContent=buildFallback();
    }
  })();

  return decision;
}

async function setCS(id,status){
  var c=(_tb.candidates||[]).find(function(x){return x.id===id;});
  if(!c) return;
  // Guardrail: rejecting a required candidate means at least one of the must-dos
  // that required it may no longer be viable. Smarter cascade: only drop a must-do
  // if no OTHER non-rejected candidate is still required for it. For conditions
  // (northern lights, etc.), the must-do survives as long as any remaining place
  // can host it. For 2-endpoint trains where only one endpoint is being rejected,
  // the user gets a second decision when they consider the other endpoint.
  if (status === "reject" && c._required && c.status !== "reject") {
    var realNames = (c._requiredFor||[]).filter(function(r){return r && r !== "__manual__";});
    var hasManual = (c._requiredFor||[]).some(function(r){return r === "__manual__";});

    // For each must-do this candidate supports, collect the OTHER non-rejected
    // candidates that also satisfy it — so we can name them specifically and
    // pass them to the LLM for a conversational rejection message.
    var supportByName = {}; // { "bernina express": [{place, country}], ... }
    (_tb.candidates||[]).forEach(function(other){
      if (other.id === c.id) return;
      if (other.status === "reject") return;
      (other._requiredFor||[]).forEach(function(r){
        if (r && r !== "__manual__") {
          var k = r.toLowerCase();
          if (!supportByName[k]) supportByName[k] = [];
          supportByName[k].push({place:other.place, country:other.country||null});
        }
      });
    });
    var willDrop = []; // must-dos with no remaining support
    var willKeep = []; // [{name, supporters:[...]}, ...]
    realNames.forEach(function(n){
      var sup = supportByName[n.toLowerCase()];
      if (sup && sup.length) willKeep.push({name:n, supporters:sup});
      else willDrop.push(n);
    });

    var approved = await showRejectRequiredModal(c, willDrop, willKeep, hasManual);
    if (!approved) return;

    // Cascade the drops — only for must-dos with no remaining support.
    if (willDrop.length) {
      var dropSet = {};
      willDrop.forEach(function(n){ dropSet[n.toLowerCase()] = true; });
      // Stash what we're dropping on behalf of this candidate so un-rejecting
      // later can re-offer these must-dos and re-wire the required links.
      // Without this, the only way to get a dropped route back was to edit
      // the brief — which is what Neal ran into with Montreux + Lake Geneva.
      c._priorRequiredFor = (c._requiredFor || []).slice();
      c._droppedMustDos = willDrop.slice();
      if (typeof _mdcItems !== 'undefined' && _mdcItems) {
        _mdcItems.forEach(function(m){
          if (m.checked && m.name && dropSet[m.name.toLowerCase()]) {
            m.checked = false;
          }
        });
      }
      // Clear this candidate's links to dropped must-dos so un-reject won't auto-keep from stale data
      var myReq = (c._requiredFor||[]).filter(function(r){
        if (r === "__manual__") return true;
        return !dropSet[r.toLowerCase()];
      });
      c._requiredFor = myReq;
      if (!myReq.length) c._required = false;
      // Update other candidates' required links for the dropped must-dos
      (_tb.candidates||[]).forEach(function(other){
        if (other.id === c.id) return;
        if (!other._required) return;
        var stillReq = (other._requiredFor||[]).filter(function(r){
          if (r === "__manual__") return true;
          return !dropSet[r.toLowerCase()];
        });
        if (!stillReq.length) {
          other._required = false;
          other._requiredFor = [];
        } else {
          other._requiredFor = stillReq;
        }
      });
      // Keep _tb.requiredPlaces in sync so renderCandidateCards re-match doesn't resurrect dropped entries
      if (_tb.requiredPlaces) {
        _tb.requiredPlaces = _tb.requiredPlaces.filter(function(p){
          var rf = (p.requiredFor||[]).filter(function(r){
            return r === "__manual__" || !dropSet[r.toLowerCase()];
          });
          p.requiredFor = rf;
          return rf.length > 0;
        });
      }
    }
  }
  var prevStatus = c.status;
  c.status=(c.status===status)?null:status;
  // Un-rejecting a candidate that previously cascaded a must-do drop? Re-wire
  // its required links and re-check the dropped must-dos. This matters because
  // rejecting Montreux (endpoint of the Lake Geneva circuit) drops the circuit
  // entirely; without this block, restoring Montreux leaves the circuit off and
  // the card lands in the generic "Other places" section instead of back under
  // its route header. Only fires when leaving the rejected state.
  if (prevStatus === "reject" && c.status !== "reject") {
    if (Array.isArray(c._priorRequiredFor) && c._priorRequiredFor.length) {
      c._requiredFor = c._priorRequiredFor.slice();
      c._required = c._requiredFor.length > 0;
    }
    if (Array.isArray(c._droppedMustDos) && c._droppedMustDos.length && typeof _mdcItems !== 'undefined' && _mdcItems) {
      var reviveSet = {};
      c._droppedMustDos.forEach(function(n){ reviveSet[n.toLowerCase()] = true; });
      _mdcItems.forEach(function(m){
        if (m && m.name && reviveSet[m.name.toLowerCase()] && !m.checked) {
          m.checked = true;
        }
      });
      // Rebuild _tb.requiredPlaces so route-endpoint grouping sees the revived
      // must-dos. Mirrors what expandMustDos does after initial generation.
      if (_tb) {
        var reqMap = {};
        (_mdcItems||[]).forEach(function(item){
          if (!item.checked) return;
          (item.requiredPlaces||[]).forEach(function(p){
            if (!p || !p.place) return;
            if (!reqMap[p.place]) reqMap[p.place] = {place:p.place, country:p.country||'', requiredFor:[], flexible:false};
            reqMap[p.place].requiredFor.push(item.type === "manual" ? "__manual__" : item.name);
            if (item.type === "condition") reqMap[p.place].flexible = true;
          });
        });
        _tb.requiredPlaces = Object.values(reqMap);
      }
    }
    // Consume the stash so repeated toggles don't keep re-applying stale data
    delete c._priorRequiredFor;
    delete c._droppedMustDos;
  }
  // Fire the keep-toast only on transitions INTO "keep" — not un-keeps or
  // restores from the rejected pile back to unset.
  if (c.status === "keep" && prevStatus !== "keep") {
    showKeepToast(c);
  }
  // Re-sequence _tb.candidates so the rendering reflects the current trip
  // order. Without this, restoring a rejected candidate leaves it at whatever
  // index it originally occupied (or, for user-added ones, at the end of the
  // array), which is why Neal saw Montreux land at the bottom of the list
  // after un-rejecting it. Run on every status change so the view stays in
  // sync with what the trip sequencer would build.
  _tbResequenceCandidates();
  renderCandidateCards(_tb.candidates);
  // v360.3 (#124): debounced auto-discovery of day-trips + waysides
  // once the user has settled on a hub set. Discovery is where you
  // decide WHAT to see; the helper functions live in engine-picker.js
  // (runPickerDayTripDiscovery + runPickerWaysideDiscovery). They're
  // idempotent — won't re-run for the same hub/leg combination — so
  // calling them repeatedly during keep/reject toggles is safe.
  _schedulePickerSecondaryDiscovery();
  // PD.334: every curation action SAVES. See _persistDiscoveryState.
  _persistDiscoveryState();
}
