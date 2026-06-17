// @ts-check
import { MaxRoute } from "./engine-routing.mjs";
// menubar-phase.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Mac-style menu bar (File/Edit/Settings) + phase-status chips.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ─── v359.49.4: Mac-style menu bar (File / Edit / Settings) ─────────
// One menu open at a time. Clicking a label opens its dropdown; clicking
// the same label again, an outside click, or any item action closes it.
// While any menu is open, mousing across the sibling labels switches
// which dropdown is shown — matches macOS menu-bar behavior.
var _mwOpenName = null;
function _mwToggle(name){
  if (_mwOpenName === name) { _mwClose(); return; }
  _mwOpen(name);
}
function _mwHoverSwitch(name){
  if (_mwOpenName && _mwOpenName !== name) _mwOpen(name);
}
function _mwOpen(name){
  _mwCloseAllNoListenerReset();
  var btn = document.querySelector('.mw-menu[data-menu="'+name+'"]');
  var dd  = document.getElementById('mw-' + name);
  if (!btn || !dd) return;
  // Round NC.X: gate the Export entry on the trip having destinations.
  // Exporting an empty trip is never the right answer; hiding the item
  // keeps the menu honest about what's available right now.
  var _expBtn = document.getElementById("mw-export-trip");
  if (_expBtn) {
    var _hasDests = !!(trip && Array.isArray(trip.destinations) && trip.destinations.length);
    _expBtn.style.display = _hasDests ? "" : "none";
  }
  btn.classList.add('is-open');
  // Anchor dropdown's left edge under the button so each menu's
  // popout lines up beneath its own label.
  var hdr = btn.closest('.mac-menubar');
  if (hdr) {
    var br = btn.getBoundingClientRect();
    var hr = hdr.getBoundingClientRect();
    dd.style.left  = (br.left - hr.left) + 'px';
    dd.style.right = 'auto';
  }
  dd.style.display = 'block';
  _mwOpenName = name;
  setTimeout(function(){
    document.addEventListener('click', _mwOutsideClick, { once: true, capture: true });
  }, 0);
}
function _mwClose(){
  _mwCloseAllNoListenerReset();
  _mwOpenName = null;
}
function _mwCloseAllNoListenerReset(){
  var btns = document.querySelectorAll('.mw-menu');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('is-open');
  var dds = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.mw-dropdown'));
  for (var j = 0; j < dds.length; j++) dds[j].style.display = 'none';
}
function _mwOutsideClick(e){
  // If the click is inside any dropdown or on any menu label, let it
  // handle itself (item onclick → _mwClose; label onclick → _mwToggle).
  // Re-arm the listener for the next click. Anything else closes.
  var t = e.target;
  var inDd  = t && t.closest && t.closest('.mw-dropdown');
  var onBtn = t && t.closest && t.closest('.mw-menu');
  if (inDd || onBtn) {
    document.addEventListener('click', _mwOutsideClick, { once: true, capture: true });
    return;
  }
  _mwClose();
}

function goHome(){
  if (document.body) document.body.classList.remove("picker-active");
  if(trip.destinations.length>0&&!confirm("Return to trips? Your trip is saved."))return;
  // PD.332: goHome can be invoked from INSIDE Discovery (the picker
  // header's ← Home). showHome only swaps the home/app panels — the
  // picker overlay is fullscreen and reparented to <body>, so it kept
  // covering the home screen and the button looked dead. Close the
  // overlays explicitly, then record the home route so the URL (the
  // screen's source of truth, PD.330) agrees with what's on screen
  // and a refresh stays home.
  try {
    var _ghBrief = document.getElementById("trip-brief-overlay");
    if (_ghBrief) _ghBrief.style.display = "none";
    var _ghCe = document.getElementById("candidate-explorer-overlay");
    if (_ghCe) _ghCe.style.display = "none";
  } catch(_){}
  showHome();
  try {
    if (typeof MaxRoute !== "undefined") {
      MaxRoute.navigate({ screen: MaxRoute.SCREENS.HOME }, { replace: true });
    }
  } catch(_){}
}

// v359.60.47: cross-phase awareness chips. The four phases —
// Profile / Discovery / Structure / Plan — overlap and feed each
// other, but each surface used to be self-contained. These helpers
// build a compact "where else this trip lives" status bar that
// surfaces can drop into their headers, with click-through to the
// other phases. Style is uniform: small pill row, no visual
// dominance over the page title.
function _phaseStatus() {
  var out = {
    hasTrip:        !!(trip && trip.destinations && trip.destinations.length),
    destCount:      0,
    nights:         0,
    consideredCount: 0,
    discoveredCount: 0
  };
  if (out.hasTrip) {
    out.destCount = trip.destinations.length;
    out.nights = trip.destinations.reduce(function(s, d){ return s + (d.nights || 0); }, 0);
    // PD.430: stays and sights are different kinds of stop and are counted
    // separately — a STAY has nights (the route moves between them); a SIGHT is
    // a 0-night decoration on the route. Never present them as one "N dest".
    out.stayCount  = trip.destinations.filter(function(d){ return (d.nights || 0) > 0; }).length;
    out.sightCount = trip.destinations.filter(function(d){ return !((d.nights || 0) > 0); }).length;
  }
  // v360.1: union-dedupe-filter across both data sources so this
  // count matches MaxTripUI._collectSetAsidePlaces (which feeds the
  // Considered section). Previous behavior was mutually exclusive
  // — mdcItems OR candidates, never both — which caused the chip
  // ("14 set aside") and the section ("(5)") to disagree on
  // tripsthat had data in both arrays.
  //
  //   discoveredCount  = unique places ever surfaced
  //                      (mdcItems[*].requiredPlaces ∪ candidates),
  //                      deduped by case-folded name
  //   consideredCount  = subset of discovered that's NOT in
  //                      destinations AND NOT explicitly rejected
  //                      (status === 'reject' on a candidate)
  try {
    // v360.1: extend the "already on trip" set to include every place
    // adopted onto the trip in any form — destinations, waysides,
    // day-trip targets, sights, legacy day-items — by walking the same
    // sources MaxTripUI._collectSetAsidePlaces uses. Without this, a
    // place that's been kept as a day-trip stop from a hub destination
    // (e.g. Þingvellir / Geysir / Gullfoss as Reykjavík day-trip
    // targets) still counted as "set aside" because it never landed on
    // trip.destinations[]. Chip and section now both reflect the same
    // truth: anything you've already kept anywhere is not set aside.
    var inDest = {};
    function _mark(name) {
      if (!name) return;
      inDest[String(name).toLowerCase().trim()] = true;
    }
    (trip.destinations || []).forEach(function(d){
      if (!d) return;
      _mark(d.place);
      (d.days || []).forEach(function(day){
        (day.items || []).forEach(function(it){
          _mark(it && (it.label || it.name || it.place));
        });
      });
    });
    if (trip.places && typeof trip.places === 'object') {
      Object.keys(trip.places).forEach(function(pid){
        var p = trip.places[pid];
        if (p) _mark(p.name);
      });
    }
    var seenName = {};
    var discovered = 0, considered = 0;
    function _accumulate(p, src) {
      if (!p || !p.place) return;
      var k = String(p.place).toLowerCase().trim();
      if (seenName[k]) return;
      seenName[k] = true;
      discovered++;
      if (inDest[k]) return;
      if (src === 'candidate' && p.status === 'reject') return;
      considered++;
    }
    if (Array.isArray(trip.placeActivities)) {
      trip.placeActivities.forEach(function(it){
        (it && it.requiredPlaces || []).forEach(function(p){ _accumulate(p, 'mdc'); });
      });
    }
    if (Array.isArray(trip.candidates)) {
      trip.candidates.forEach(function(c){ _accumulate(c, 'candidate'); });
    }
    out.consideredCount = considered;
    out.discoveredCount = discovered;
  } catch(_){}
  return out;
}
if (typeof globalThis !== "undefined") globalThis._phaseStatus = _phaseStatus;

// Build a clickable HTML chip row that surfaces other phases' state.
// `currentPhase` is one of "profile" / "discovery" / "structure" /
// "plan" — the chip for that phase is suppressed (no point linking
// to yourself). Empty when there's no trip to summarize.
function _phaseChipsHtml(currentPhase) {
  var s = _phaseStatus();
  if (!s.hasTrip && !s.discoveredCount) return "";
  var chips = [];
  var style='display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:600;color:#5a6478;background:#f1f3f7;border:1px solid #dde1ea;border-radius:11px;padding:3px 9px;cursor:pointer;font-family:inherit;text-decoration:none;white-space:nowrap;line-height:1.2;';
  function _chip(label, onclick){
    return '<button type="button" onclick="' + onclick + '" style="' + style + '">' + label + '</button>';
  }
  // v360.1: Profile chip moved into the trip identity block as a
  // right-aligned "Trip profile" button on the same row as the name.
  // Identity + intent belong together; the phase-chips strip kept
  // them visually disconnected.
  // (No-op on this chip now — keeping the branch as a marker.)
  if (currentPhase !== "discovery" && currentPhase !== "structure" && s.discoveredCount > 0) {
    // v360.1: Discovery affordance kept here for Profile / Plan
    // phase views only. On Structure (the trip view), the door back
    // into Discovery is rendered as a panel below the Itinerary
    // panel — parallel style, parallel role — see
    // MaxTripUI.renderDiscoveryPromptPanel. The phase-chip version
    // here was lightweight enough for surfaces that don't carry the
    // full strip stack.
    chips.push(_chip('🧭 Find more places in Discovery', "_reopenPickerAny&&_reopenPickerAny()"));
  }
  if (currentPhase !== "structure" && s.hasTrip) {
    // PD.333 (audit B): this chip is a USER NAVIGATION to the trip
    // view — it stamps the URL itself now that drawTripMode doesn't.
    chips.push(_chip("🗺 " + s.stayCount + " stay" + (s.stayCount === 1 ? "" : "s")
      + (s.sightCount ? (" · " + s.sightCount + " sight" + (s.sightCount === 1 ? "" : "s")) : "")
      + " · " + s.nights + " night" + (s.nights === 1 ? "" : "s"), "(function(){var ov=document.getElementById('trip-brief-overlay');if(ov)ov.style.display='none';var ce=document.getElementById('candidate-explorer-overlay');if(ce)ce.style.display='none';try{if(typeof MaxRoute!=='undefined'&&trip&&trip.id)MaxRoute.navigate({screen:MaxRoute.SCREENS.TRIP,tripId:trip.id});}catch(_){}if(typeof drawTripMode==='function'){_leftMode='trip';drawTripMode();updateMainMap&&updateMainMap();}})()"));
  }
  if (!chips.length) return "";
  return '<div class="phase-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px;">' + chips.join("") + '</div>';
}
if (typeof globalThis !== "undefined") globalThis._phaseChipsHtml = _phaseChipsHtml;

function showNewTripForm(){
  var inp = g("ntp-name");
  if(inp) { inp.focus(); inp.scrollIntoView({behavior:"smooth",block:"center"}); }
}

function hideNewTripForm(){
  var inp = g("ntp-name");
  if(inp){ inp.value=""; }
  var btn = g("ntp-create"); if(btn) btn.disabled=true;
}


function showBriefApiKeyForm(){
  // Inline API key entry that stays on the brief screen
  var existing=document.getElementById("brief-key-overlay");
  if(existing){existing.remove();return;}
  var ov=document.createElement("div");
  ov.id="brief-key-overlay";
  ov.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML='<div style="background:var(--c-bg);border-radius:10px;padding:24px;width:380px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,.2);">'
    +'<div style="font-size:14px;font-weight:700;margin-bottom:8px;">Set Anthropic API key</div>'
    +'<div style="font-size:11px;color:var(--c-ink-3);margin-bottom:14px;">Your key is stored locally in this browser. Max needs it to generate destination suggestions.</div>'
    +'<input id="brief-key-inp" type="password" placeholder="sk-ant-..." style="width:100%;font-size:12px;padding:9px 11px;border:1px solid var(--c-border);border-radius:6px;font-family:monospace;box-sizing:border-box;margin-bottom:10px;">'
    +'<div style="display:flex;gap:8px;">'
    +'<button onclick="saveBriefKey()" style="flex:1;padding:9px;font-size:12px;font-weight:600;background:var(--c-primary-top);color:var(--c-on-dark);border:none;border-radius:6px;cursor:pointer;font-family:inherit;">Save key</button>'
    +'<button onclick="var o=document.getElementById(&quot;brief-key-overlay&quot;);if(o)o.remove();" style="padding:9px 14px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer;font-family:inherit;background:var(--c-bg);color:var(--c-ink-2);">Cancel</button>'
    +'</div>'
    +'</div>';
  document.body.appendChild(ov);
  ov.onclick=function(e){if(e.target===ov)ov.remove();};
  setTimeout(function(){var i=document.getElementById("brief-key-inp");if(i)i.focus();},50);
}

function saveBriefKey(){
  var inp=/** @type {HTMLInputElement} */ (document.getElementById("brief-key-inp"));
  if(!inp) return;
  var v=inp.value.trim();
  if(v.length<10) return;
  saveApiKey(v);
  var ov=document.getElementById("brief-key-overlay"); if(ov) ov.remove();
  // Show confirmation
  var toast=document.createElement("div");
  toast.style.cssText="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--c-see);color:var(--c-on-dark);padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;z-index:9999;pointer-events:none;";
  toast.textContent="\u2713 API key saved";
  document.body.appendChild(toast);
  setTimeout(function(){toast.remove();},2000);
}


function showHomeApiKeyForm(){
  var existing = document.getElementById("home-key-modal");
  if (existing) { existing.remove(); return; }
  var ov = document.createElement("div");
  ov.id = "home-key-modal";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = '<div style="background:var(--c-bg);border-radius:10px;padding:24px;width:380px;max-width:90vw;">'
    + '<div style="font-size:14px;font-weight:700;margin-bottom:6px;">Set Anthropic API key</div>'
    + '<div style="font-size:11px;color:var(--c-ink-3);margin-bottom:14px;">Your key is stored only in this browser. Get one at <a href="https://console.anthropic.com" target="_blank" style="color:var(--c-primary);">console.anthropic.com</a>.</div>'
    + '<input id="home-key-inp" type="password" placeholder="sk-ant-..." autocomplete="off" style="width:100%;font-size:12px;padding:9px 11px;border:1px solid var(--c-border);border-radius:6px;font-family:monospace;box-sizing:border-box;margin-bottom:10px;">'
    + '<div style="display:flex;gap:8px;">'
    + '<button id="home-key-save" style="flex:1;padding:9px;font-size:12px;font-weight:600;background:var(--c-primary-top);color:var(--c-on-dark);border:none;border-radius:6px;cursor:pointer;font-family:inherit;">Save key</button>'
    + '<button id="home-key-cancel" style="padding:9px 14px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer;font-family:inherit;background:var(--c-bg);">Cancel</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  ov.onclick = function(e){ if(e.target===ov) ov.remove(); };
  document.getElementById("home-key-cancel").onclick = function(){ ov.remove(); };
  document.getElementById("home-key-save").onclick = function(){
    var v = (/** @type {HTMLInputElement} */ (document.getElementById("home-key-inp"))).value.trim();
    if (!v || v.length < 20) { document.getElementById("home-key-inp").style.borderColor="#c05020"; return; }
    saveApiKey(v);
    ov.remove();
    // Hide the notice, show confirmation
    var notice = document.getElementById("hs-key-notice");
    if (notice) notice.style.display = "none";
    var t = document.createElement("div");
    t.style.cssText = "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:var(--c-see);color:var(--c-on-dark);padding:8px 18px;border-radius:6px;font-size:12px;font-weight:600;z-index:9999;";
    t.textContent = "✓ API key saved";
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2500);
  };
  document.getElementById("home-key-inp").onkeydown = function(e){ if(e.key==="Enter") document.getElementById("home-key-save").click(); };
  setTimeout(function(){ document.getElementById("home-key-inp").focus(); }, 50);
}

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._mwClose = _mwClose;
  __expg._mwCloseAllNoListenerReset = _mwCloseAllNoListenerReset;
  __expg._mwHoverSwitch = _mwHoverSwitch;
  __expg._mwOpen = _mwOpen;
  __expg._mwOpenName = _mwOpenName;
  __expg._mwOutsideClick = _mwOutsideClick;
  __expg._mwToggle = _mwToggle;
  __expg._phaseChipsHtml = _phaseChipsHtml;
  __expg._phaseStatus = _phaseStatus;
  __expg.goHome = goHome;
  __expg.hideNewTripForm = hideNewTripForm;
  __expg.saveBriefKey = saveBriefKey;
  __expg.showBriefApiKeyForm = showBriefApiKeyForm;
  __expg.showHomeApiKeyForm = showHomeApiKeyForm;
  __expg.showNewTripForm = showNewTripForm;
}
