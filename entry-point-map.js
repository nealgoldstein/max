// entry-point-map.js — Entry-point map. Extracted verbatim from index.html (PD.474, bloat reduction).

// ── ENTRY-POINT MAP ─────────────────────────────────────────
// Surfaces major airports / rail termini / sea ports / long-distance bus
// terminals for the chosen region. Lives on the Places overlay inside the
// Trip Details strip so the user can see arrival options on a map while
// they\u2019re deciding how and where to enter. Data is LLM-generated, cached
// per region in _epCache for the session.
var _epCache = {};          // region -> array of entry points
var _epLoading = {};        // region -> bool
var _edMap = null;          // Leaflet map instance
var _edMarkers = [];        // active markers
var _edActivePopupId = null; // currently-open popup's ep.id, so re-renders can re-show it

// Patch (post-HX.10): when the user types a new arrival/departure
// city, find coords for it so the map can pan. Searches in priority:
//   1. _epCache[region]    — airports / stations / ports / bus terminals
//   2. _tb.candidates      — destination candidates (with lat/lng)
// Both are matched case-insensitively + diacritic-tolerantly via
// _normPlaceName, with a forgiving substring match in either direction
// (so "Reykjavik" matches "Keflavík International Airport (KEF) — Reykjavik").
//
// Returns [lat, lng] or null.
function _findCityCoordsForMap(name){
  if (!name) return null;
  var norm = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){
    return String(s||"").toLowerCase().trim();
  };
  var target = norm(name);
  if (!target) return null;
  var pts = (_tb.region && _epCache && _epCache[_tb.region]) || [];
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (!p || !isFinite(p.lat) || !isFinite(p.lon)) continue;
    var pn = norm(p.name || "");
    if (pn === target || pn.indexOf(target) !== -1 || target.indexOf(pn) !== -1) {
      return [p.lat, p.lon];
    }
  }
  var cands = (_tb && _tb.candidates) || [];
  for (var j = 0; j < cands.length; j++) {
    var c = cands[j];
    if (!c || !isFinite(c.lat) || !isFinite(c.lng)) continue;
    var cn = norm(c.place || "");
    if (cn === target || cn.indexOf(target) !== -1 || target.indexOf(cn) !== -1) {
      return [c.lat, c.lng];
    }
  }
  return null;
}

function _epIconFor(type){
  // Small emoji-based divIcon \u2014 keeps the map light, no custom tile sprites.
  var map = {air:"\u2708\ufe0f", rail:"\ud83d\ude86", sea:"\u26f4\ufe0f", bus:"\ud83d\ude8d"};
  var sym = map[type] || "\ud83d\udccd";
  return L.divIcon({
    className: "ep-pin",
    html: '<div style="font-size:18px;line-height:1;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));">'+sym+'</div>',
    iconSize: [22,22],
    iconAnchor: [11,20],
    popupAnchor: [0,-18]
  });
}

async function fetchRegionEntryPoints(region){
  if (!region) return [];
  if (_epCache[region]) return _epCache[region];
  if (_epLoading[region]) return [];
  _epLoading[region] = true;
  var prompt = "List the major entry points an international traveler might use to arrive in or depart from " + region + ". "
    + "Think like a seasoned traveler, not an airline marketer: for many regions, trains or ferries are the realistic way in, not just flights.\n\n"
    + "Cover ALL of these categories that genuinely apply to this region:\n"
    + "- air: international gateway airports (include IATA code in the name)\n"
    + "- rail: stations that handle cross-border high-speed trains, overnight sleepers, or the main domestic long-distance trunk (e.g. Eurostar, TGV, ICE, Frecciarossa, Nightjet, Shinkansen terminals)\n"
    + "- sea: ferry terminals and cruise ports that carry real passenger volume (e.g. Dover, Piraeus, Patras, Stockholm, Helsinki)\n"
    + "- bus: long-distance international/intercity bus terminals if they matter for this region (FlixBus hubs, cross-border terminals)\n\n"
    + "HARD REQUIREMENTS:\n"
    + "- Do NOT return airports only. If the region has meaningful rail entry (most of Europe, Japan, UK), include at least 3\u20135 rail stations.\n"
    + "- If the region is island-connected or coastal with real ferry traffic, include at least 2 sea ports.\n"
    + "- Skip categories that genuinely don't apply (e.g. no sea ports for landlocked Switzerland\u2014don't invent).\n"
    + "- Aim for 10\u201318 entry points total, balanced across applicable modes.\n"
    + "- Pick the ones a thoughtful traveler actually uses, not every regional airstrip.\n\n"
    + "Return strict JSON: {\"points\":[{\"id\":\"unique-slug\",\"name\":\"Zurich Airport (ZRH)\",\"type\":\"air|rail|sea|bus\",\"city\":\"Zurich\",\"country\":\"Switzerland\",\"lat\":47.4647,\"lon\":8.5492,\"notes\":\"Main international gateway; hub for Swiss.\"}]}.\n"
    + "Lat/lon must be accurate. Notes: one short sentence on why this entry point matters (what it connects to, what it's best for).";
  try {
    // callMax returns the assistant text directly (not the raw API response).
    // Earlier versions of this code treated it as { content:[{text}] } which
    // silently made `text` empty every time — and cached [], so no pins.
    var text = await callMax([{role:"user",content:prompt}], 3000, 30000);
    if (typeof text !== "string") text = String(text||"");
    text = text.replace(/```json|```/g, "").trim();
    var m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in entry-points response");
    var parsed = JSON.parse(m[0]);
    var pts = Array.isArray(parsed.points)
      ? parsed.points.filter(function(p){
          // Accept lon or lng — models return either. Normalize to lon since
          // that's what _renderEntryPointsOnCeMap reads.
          if (p && p.lng != null && p.lon == null) p.lon = p.lng;
          return p && p.name && isFinite(p.lat) && isFinite(p.lon);
        })
      : [];
    _epCache[region] = pts;
    _epLoading[region] = false;
    console.log("[Max] entry points for", region, "→", pts.length, "pins",
      pts.reduce(function(acc,p){acc[p.type]=(acc[p.type]||0)+1;return acc;}, {}));
    return pts;
  } catch (e) {
    console.warn("[Max] fetchRegionEntryPoints failed for", region, "—", e && e.message);
    _epLoading[region] = false;
    _epCache[region] = []; // cache empty to avoid infinite retries
    return [];
  }
}

// Map entry-point pin type → canonical trip mode.
var _EP_TYPE_TO_MODE = { air:"fly", rail:"train", sea:"ferry", bus:"bus" };
var _EP_MODE_LABEL   = { fly:"by air", train:"by train", ferry:"by ferry", bus:"by bus", drive:"by car" };

function _tbUseEntryPoint(isEntry, name, mode){
  // Capture any OTHER typed fields FIRST. Order matters: _tbPlacesCaptureFields
  // reads td-entry/td-exit inputs and writes them back to _tb — if we called
  // it after assigning _tb.entry = name below, it'd immediately overwrite the
  // name we just set with whatever (usually empty) was in the DOM input. That
  // was the "pin popup doesn't fill the text field" bug.
  _tbPlacesCaptureFields();
  // Update state — city name AND mode, so "Set as entry by air" actually records
  // the arrival mode. Without this, the user had to separately set the mode pill.
  if (isEntry) {
    _tb.entry = name;
    if (mode) _tb.entryMode = mode;
  } else {
    _tb.tbExit = name;
    if (mode) _tb.exitMode = mode;
  }
  // Mirror into the live DOM input so the user sees the change immediately,
  // even before the re-render below (and in case the input is preserved across
  // re-renders without being rebuilt from _tb).
  var inpId = isEntry ? "td-entry" : "td-exit";
  var inp = document.getElementById(inpId);
  if (inp) inp.value = name;
  // PD.230: ALSO update the Discovery picker's own inputs. The Trip
  // Details strip uses td-entry/td-exit; the Discovery picker uses
  // tb-picker-entry/tb-picker-exit (different DOM, same conceptual
  // value). _tbUseEntryPoint was only updating the strip — clicking
  // "Use Reykjavík Airport (RKV)" in the picker correctly set
  // _tb.entry but the picker's own "Arriving at" input stayed on the
  // user's previously-typed value (e.g. "Kef") because that input was
  // never rewritten.
  var pickerInpId = isEntry ? "tb-picker-entry" : "tb-picker-exit";
  var pickerInp = document.getElementById(pickerInpId);
  if (pickerInp) pickerInp.value = name;
  // Close the open popup so the user can see the map update, and give them
  // clear feedback — the collapsed trip-details strip was too subtle and the
  // popup covers it. Also auto-expand the strip on first use so the change is
  // visible without them hunting for it.
  try { if (_ceMap) _ceMap.closePopup(); } catch(e){}
  _tripDetailsExpanded = true;
  if (typeof showSaveStatus === "function") {
    var lbl = mode && _EP_MODE_LABEL[mode] ? " " + _EP_MODE_LABEL[mode] : "";
    showSaveStatus((isEntry?"Entry":"Exit") + " set to " + name + lbl, 2200);
  }
  _tbPlacesReRender();
}

// Plant entry-point markers on the BIG candidate map (_ceMap). These live
// alongside candidate pins so the user sees where they could enter in the
// same geographic context as where they want to go. Show/hide via the
// _tbEntryPointsVisible flag.
var _tbEntryPointsVisible = true;

function _tbToggleEntryPoints(){
  _tbEntryPointsVisible = !_tbEntryPointsVisible;
  _renderEntryPointsOnCeMap(_tb.region || "");
  var btn = document.getElementById("ce-ep-toggle");
  if (btn) btn.textContent = _tbEntryPointsVisible ? "Hide entry points" : "Show entry points";
}

// _renderEntryPointsOnCeMap moved to picker-ui.js (Round HW.1).
// Aliased on window so the call sites here (_ensureEntryPointsForRegion
// and others) keep working unchanged. (Plants entry-point pins —
// airports, rail, sea, bus — on the picker map for the active region.)
// Called after _ceMap is built; fetches entry points if needed, then plants
// markers. Safe to call repeatedly \u2014 it de-dupes and noops without _ceMap.
function _ensureEntryPointsForRegion(region){
  if (!region || !_ceMap) return;
  if (_epCache[region]) {
    _renderEntryPointsOnCeMap(region);
  } else if (!_epLoading[region]) {
    fetchRegionEntryPoints(region).then(function(){
      if (_ceMap && _tb.region === region) _renderEntryPointsOnCeMap(region);
    });
  }
}

// Mode pills rendered inside the Trip Details strip. These call
// _tbPlacesPickMode, which captures in-flight td-* fields and re-renders
// candidate cards while preserving scroll \u2014 matches the Step 2 pattern but
// stays on the Places overlay.
var _tbModeIcon = {
  fly:    "\u2708\ufe0f",     // plane
  train:  "\ud83d\ude82",     // steam train
  drive:  "\ud83d\ude97",     // car
  public: "\ud83d\ude8d",     // trolleybus
  unsure: "?",
  none:   "\u2013"
};
// Old per-direction mode button (kept for backwards compat / Step 2 brief).
// Places overlay now uses the unified _tbPlacesTransportButtonHtml below.
function _tbPlacesModeIconHtml(which){
  var cur = _tb[which] || "";
  var label = cur ? ((_tbTransportModes.filter(function(m){return m.id===cur;})[0]||{}).label || "") : "";
  var popId = "tb-mode-pop-"+which;
  return '<div style="position:relative;display:inline-block;margin-bottom:6px;">'
    + '<button type="button" onclick="_tbPlacesToggleModePopover(&#39;'+which+'&#39;,event)" '
    +   'style="font-size:11px;padding:6px 12px;border:1px solid '+(cur?"#111":"#ccc")+';border-radius:6px;background:#fff;color:'+(cur?"#111":"#666")+';cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;min-width:140px;justify-content:space-between;">'
    +   '<span>'+(cur?label:"Tap to pick how")+'</span>'
    +   '<span style="font-size:9px;color:#999;">\u25BE</span>'
    + '</button>'
    + '<div id="'+popId+'" style="display:none;position:absolute;top:100%;left:0;z-index:1000;margin-top:4px;background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.1);padding:4px;min-width:160px;">'
    +   _tbTransportModes.map(function(m){
          var on = cur === m.id;
          return '<div onclick="_tbPlacesPickMode(&#39;'+which+'&#39;,&#39;'+m.id+'&#39;)" '
            + 'style="padding:6px 10px;font-size:11px;cursor:pointer;border-radius:4px;'
            + (on?"background:#f0f5ff;color:#1a5fa8;font-weight:600;":"color:#333;")+'" '
            + 'onmouseover="this.style.background=&#39;#f5f5f5&#39;" onmouseout="this.style.background=&#39;'+(on?"#f0f5ff":"transparent")+'&#39;">'
            + m.label
            + '</div>';
        }).join("")
    + '</div></div>';
}

// Single Transportation button for Places overlay — one icon that brings up a
// popover with both "Getting there" and "Getting out" mode pickers. Previously
// we rendered one mode button per direction; Neal pointed out that the popup
// should be unified, since the transportation question is "how are you moving
// through the trip" — not two independent choices.
function _tbPlacesTransportButtonHtml(){
  var entryLabel = _tb.entryMode ? ((_tbTransportModes.filter(function(m){return m.id===_tb.entryMode;})[0]||{}).label || "") : "";
  var exitLabel  = _tb.exitMode  ? ((_tbTransportModes.filter(function(m){return m.id===_tb.exitMode;})[0]||{}).label  || "") : "";
  var buttonText;
  if (entryLabel && exitLabel) {
    buttonText = (entryLabel === exitLabel) ? entryLabel : (entryLabel + " in \u00b7 " + exitLabel + " out");
  } else if (entryLabel || exitLabel) {
    buttonText = (entryLabel ? (entryLabel + " in") : "") + (exitLabel ? (exitLabel + " out") : "");
  } else {
    buttonText = "Tap to pick how";
  }
  var set = !!(entryLabel || exitLabel);
  var popId = "tb-transport-pop";
  var rowHtml = function(labelText, which, cur){
    return '<div style="margin-bottom:8px;">'
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--c-ink-3);margin-bottom:4px;">'+labelText+'</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
      + _tbTransportModes.map(function(m){
          var on = cur === m.id;
          return '<span onclick="_tbPlacesPickMode(&#39;'+which+'&#39;,&#39;'+m.id+'&#39;);event.stopPropagation();" '
            + 'style="display:inline-block;font-size:10px;padding:4px 10px;border-radius:10px;border:1px solid '+(on?"#111":"#ddd")+';background:'+(on?"#111":"#fff")+';color:'+(on?"#fff":"#555")+';cursor:pointer;user-select:none;">'
            + m.label + '</span>';
        }).join("")
      + '</div></div>';
  };
  return '<div style="position:relative;display:inline-block;margin-bottom:6px;">'
    + '<button type="button" onclick="_tbPlacesToggleTransportPopover(event)" '
    +   'style="font-size:11px;padding:7px 14px;border:1px solid '+(set?"#111":"#ccc")+';border-radius:6px;background:#fff;color:'+(set?"#111":"#666")+';cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;">'
    +   '<span>\u2708\ud83d\ude82\ud83d\ude97</span>'
    +   '<span>'+buttonText+'</span>'
    +   '<span style="font-size:9px;color:#999;">\u25BE</span>'
    + '</button>'
    + '<div id="'+popId+'" style="display:none;position:absolute;top:100%;left:0;z-index:1000;margin-top:4px;background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.1);padding:10px 12px;min-width:260px;">'
    +   rowHtml("Getting there",  "entryMode", _tb.entryMode || "")
    +   rowHtml("Getting out",    "exitMode",  _tb.exitMode  || "")
    + '</div></div>';
}

function _tbPlacesToggleTransportPopover(evt){
  if (evt && evt.stopPropagation) evt.stopPropagation();
  var pop = document.getElementById("tb-transport-pop"); if (!pop) return;
  var open = pop.style.display === "block";
  pop.style.display = open ? "none" : "block";
  if (!open) {
    setTimeout(function(){
      var h = function(e){
        if (!pop.contains(e.target)) { pop.style.display = "none"; document.removeEventListener("click", h); }
      };
      document.addEventListener("click", h);
    }, 0);
  }
}

function _tbPlacesToggleModePopover(which, evt){
  if (evt && evt.stopPropagation) evt.stopPropagation();
  var pop = document.getElementById("tb-mode-pop-"+which); if (!pop) return;
  var other = document.getElementById("tb-mode-pop-"+(which==="entryMode"?"exitMode":"entryMode"));
  if (other) other.style.display = "none";
  var open = pop.style.display === "block";
  pop.style.display = open ? "none" : "block";
  if (!open) {
    setTimeout(function(){
      var h = function(e){
        if (!pop.contains(e.target)) { pop.style.display = "none"; document.removeEventListener("click", h); }
      };
      document.addEventListener("click", h);
    }, 0);
  }
}

function _tbPlacesFixedPillsHtml(side){
  var cur = !!_tb[side+"Fixed"];
  function pill(label, val){
    var on = cur === val;
    var bg = on ? "#111" : "#fff"; var fg = on ? "#fff" : "#555"; var bc = on ? "#111" : "#ddd";
    return '<span style="display:inline-block;font-size:10px;padding:3px 9px;border-radius:12px;border:1px solid '+bc+';background:'+bg+';color:'+fg+';cursor:pointer;user-select:none;" onclick="_tbPlacesSetFixed(&#39;'+side+'&#39;,'+val+')">'+label+'</span>';
  }
  return '<div style="display:flex;gap:4px;margin-bottom:6px;">'+pill("Booked",true)+pill("Flexible",false)+'</div>';
}

function _tbPlacesCaptureFields(){
  // Snapshot every td-* field into _tb so re-rendering doesn\u2019t wipe typed text
  var map = {"td-entry":"entry","td-exit":"tbExit","td-arrNum":"arrivalNumber",
             "td-depNum":"departureNumber","td-arrTime":"arrivalTime","td-depTime":"departureTime"};
  Object.keys(map).forEach(function(id){
    var el = document.getElementById(id); if (el) _tb[map[id]] = el.value.trim();
  });
  var dEl = document.getElementById("td-date");
  if (dEl && dEl.value) _tb.when = dEl.value;
  var ddEl = document.getElementById("td-depDate");
  if (ddEl) _tb.departureDate = ddEl.value;
  _rebuildGettingToFromFields();
}

function _tbPlacesPickMode(which, id){
  // Snapshot any typed text in td-* inputs BEFORE we mutate _tb — otherwise
  // the auto-fill below would race with _tbPlacesCaptureFields' blur-save.
  _tbPlacesCaptureFields();
  _tb[which] = (_tb[which] === id) ? "" : id;
  // Auto-fill the airport when the user picks "fly" and the corresponding
  // city field is empty. The entry-points cache is populated asynchronously,
  // so when the user picks fly right after opening Places, _epCache may still
  // be empty — in that case kick off a fetch and fill once it resolves.
  if (id === "fly" && _tb[which] === "fly") {
    var cityKey = (which === "entryMode") ? "entry" : "tbExit";
    var region = _tb.region || "";
    if (!(_tb[cityKey] || "").trim()) {
      var pts = _epCache[region] || [];
      var airports = pts.filter(function(p){ return p.type === "air"; });
      if (airports.length) {
        _tb[cityKey] = airports[0].name;
      } else if (region && typeof fetchRegionEntryPoints === "function") {
        // Cache miss — fetch now and fill on resolution. Only overwrite if the
        // field is still empty (user may have typed something while waiting).
        fetchRegionEntryPoints(region).then(function(pts2){
          var airs = (pts2 || []).filter(function(p){ return p.type === "air"; });
          if (!airs.length) return;
          if (!(_tb[cityKey] || "").trim() && _tb[which] === "fly") {
            _tb[cityKey] = airs[0].name;
            // Update the live input directly if the strip is still mounted,
            // otherwise re-render to reflect the new value.
            var inpId = (cityKey === "entry") ? "td-entry" : "td-exit";
            var inp = document.getElementById(inpId);
            if (inp) inp.value = _tb[cityKey];
            else _tbPlacesReRender();
          }
        }).catch(function(){});
      }
    }
  }
  // Close whichever popover is open (per-direction or unified transport button)
  var pop = document.getElementById("tb-mode-pop-"+which);
  if (pop) pop.style.display = "none";
  var tpop = document.getElementById("tb-transport-pop");
  if (tpop) tpop.style.display = "none";
  _tbPlacesReRender();
}

function _tbPlacesSetFixed(side, val){
  _tb[side+"Fixed"] = !!val;
  _tbPlacesCaptureFields();
  _tbPlacesReRender();
}

function _tbPlacesReRender(){
  // Preserve scroll on the candidate list so pills don\u2019t jump the view
  var cards = document.getElementById("ce-cards");
  var prev = cards ? cards.scrollTop : 0;
  renderCandidateCards(_tb.candidates);
  setTimeout(function(){
    var c = document.getElementById("ce-cards");
    if (c) c.scrollTop = prev;
  }, 0);
}

// Renders the collapsible Trip Details strip — replaces the old pre-build
// modal. No ceremony: fill this in whenever you want. The summary line is
// the collapsed state.
// HX.14 (v311): body lifted into picker-ui.js as
// MaxPickerUI.renderTripDetailsStrip. Inline thin delegator.
// `kept` arg preserved in the inline signature for back-compat
// even though the body never used it.
function _renderTripDetailsStrip(kept){
  return MaxPickerUI.renderTripDetailsStrip();
}
