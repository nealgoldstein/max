// @ts-check
import MaxDB from "./db.mjs";
// who-avoidances.js — Who's-traveling (party) + Avoidances editors. Extracted from
// index.html (PD.459).

// ── Who's traveling (G) + Avoidances (H) ─────────────────────────────────
// Shared markup so renderTripBrief and renderTripBriefEdit stay in sync.
function _tbPartyFieldHtml(){
  var comp = _tb.partyComposition || "";
  var ability = _tb.physicalAbility || "";
  var compOpts = [
    {id:"solo",       label:"Solo"},
    {id:"couple",     label:"Couple"},
    {id:"family-kids",label:"Family with kids"},
    {id:"multigen",   label:"Multi-generational"},
    {id:"friends",    label:"Group of friends"}
  ];
  var abilityOpts = [
    {id:"fit",      label:"Fit and active"},
    {id:"moderate", label:"Moderate"},
    {id:"limited",  label:"Limited walking"},
    {id:"elderly",  label:"Elderly"},
    {id:"mobility", label:"Mobility aid"},
    {id:"other",    label:"Other"}
  ];
  var compHtml = compOpts.map(function(o){
    return '<span class="tb-toggle'+(comp===o.id?" on":"")+'" data-comp-id="'+o.id+'" onclick="_tbPickPartyComp(\''+o.id+'\')">'+o.label+'</span>';
  }).join("");
  var abilityHtml = abilityOpts.map(function(o){
    return '<span class="tb-toggle'+(ability===o.id?" on":"")+'" data-ability-id="'+o.id+'" onclick="_tbPickAbility(\''+o.id+'\')">'+o.label+'</span>';
  }).join("");
  var showAges = (comp === "family-kids");
  return '<div class="tb-field" style="margin-top:20px;"><label>Who\u2019s coming on this trip</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:6px;line-height:1.55;">What Max shapes the days around \u2014 pace, accommodation, what\u2019s actually practical.</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'+compHtml+'</div>'
    +'<div id="tb-party-ages-row" style="'+(showAges?"":"display:none;")+'margin-top:10px;">'
    +'<input id="tb-party-ages" value="'+(_tb.partyAges||"")+'" placeholder="Kids\u2019 ages \u2014 e.g. 4, 7, 11" />'
    +'</div>'
    +'<div style="display:flex;gap:10px;align-items:center;margin-top:10px;">'
    +'<label style="font-size:10px;color:var(--c-ink-3);font-weight:500;text-transform:none;letter-spacing:0;margin:0;">People, total:</label>'
    +'<input type="number" id="tb-party-size" min="1" max="20" value="'+(_tb.partySize||"")+'" style="width:72px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'</div>'
    +'<div class="tb-field"><label>Physical ability of the group</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:6px;line-height:1.55;">Shape it around what the slowest or least mobile member can manage comfortably.</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'+abilityHtml+'</div>'
    +'<input id="tb-ability-note" value="'+(_tb.abilityNote||"")+'" placeholder="Anything specific Max should know (e.g. bad knees, pregnant, strollers)." style="margin-top:8px;" />'
    +'</div>';
}

function _tbAvoidFieldHtml(){
  var avoid = _tb.avoid || {};
  var opts = [
    {id:"altitude",   label:"High altitude"},
    {id:"crowds",     label:"Crowds / tourist density"},
    {id:"heat",       label:"Extreme heat"},
    {id:"cold",       label:"Extreme cold"},
    {id:"longDrives", label:"Long drives"}
  ];
  var chipHtml = opts.map(function(o){
    return '<span class="tb-chip'+(avoid[o.id]?" on":"")+'" data-avoid-id="'+o.id+'" onclick="_tbToggleAvoid(\''+o.id+'\')">'+o.label+'</span>';
  }).join("");
  // Round DN.4: collapsed three fields (dietary / safety / other) into
  // one textarea. Dietary restrictions are non-negotiable and belong in
  // Hard limits, not soft avoidances. Safety + other share the same
  // contract (weigh-don\u2019t-enforce), so they merge into a single
  // free-text input.
  return '<div class="tb-field">'
    +'<div class="tb-chips">'+chipHtml+'</div>'
    +'<textarea id="tb-avoid-other" rows="3" placeholder="Anything else worth flagging \u2014 neighborhoods, situations, times of year, things that just don\u2019t appeal." style="margin-top:10px;" oninput="_tb.avoidOther=this.value;">'+(_tb.avoidOther||"")+'</textarea>'
    +'</div>';
}

function _tbPickPartyComp(id){
  _tb.partyComposition = id;
  var row = document.querySelectorAll("[data-comp-id]");
  for(var i=0;i<row.length;i++){
    row[i].classList.toggle("on", row[i].getAttribute("data-comp-id")===id);
  }
  var agesRow = document.getElementById("tb-party-ages-row");
  if(agesRow) agesRow.style.display = (id === "family-kids") ? "" : "none";
  // Autofill party size based on composition: solo=1, couple=2, any group=3.
  // User can still edit afterwards; clicking a different composition reseeds.
  var defaultSize = (id === "solo") ? 1 : (id === "couple") ? 2 : 3;
  var sizeInp = document.getElementById("tb-party-size");
  if (sizeInp) sizeInp.value = defaultSize;
  _tb.partySize = String(defaultSize);
}

function _tbPickAbility(id){
  _tb.physicalAbility = id;
  var row = document.querySelectorAll("[data-ability-id]");
  for(var i=0;i<row.length;i++){
    row[i].classList.toggle("on", row[i].getAttribute("data-ability-id")===id);
  }
}

function _tbToggleAvoid(id){
  _tb.avoid = _tb.avoid || {};
  _tb.avoid[id] = !_tb.avoid[id];
  var chips = document.querySelectorAll("[data-avoid-id]");
  for(var i=0;i<chips.length;i++){
    if(chips[i].getAttribute("data-avoid-id")===id){
      chips[i].classList.toggle("on", !!_tb.avoid[id]);
    }
  }
}

// Capture party + avoidance text inputs into _tb. Toggle handlers already
// wrote partyComposition / physicalAbility / avoid.* directly.
function _tbCaptureParty(){
  _tb.partyAges   = g("tb-party-ages")   ? g("tb-party-ages").value.trim()   : (_tb.partyAges||"");
  _tb.partySize   = g("tb-party-size")   ? g("tb-party-size").value.trim()   : (_tb.partySize||"");
  _tb.abilityNote = g("tb-ability-note") ? g("tb-ability-note").value.trim() : (_tb.abilityNote||"");
}
function _tbCaptureAvoid(){
  // Round DN.4: dietary + safety inputs were collapsed into the single
  // avoidOther textarea. Dietary restrictions belong in Hard limits;
  // safety concerns share the same soft-preference contract as "other"
  // and now live in the same field.
  _tb.avoidOther = g("tb-avoid-other") ? g("tb-avoid-other").value.trim() : (_tb.avoidOther||"");
}

// Produce human-readable summaries for LLM prompts.
function _tbPartySummary(){
  var compLabel = {solo:"solo",couple:"couple","family-kids":"family with kids",multigen:"multi-generational",friends:"group of friends"}[_tb.partyComposition] || "";
  var parts = [];
  if(compLabel) parts.push(compLabel);
  if(_tb.partySize) parts.push(_tb.partySize + " people");
  if(_tb.partyAges && _tb.partyComposition === "family-kids") parts.push("kids\u2019 ages: " + _tb.partyAges);
  var abilityLabel = {fit:"fit and active",moderate:"moderate",limited:"limited walking",elderly:"elderly",mobility:"mobility aid",other:"other constraints"}[_tb.physicalAbility] || "";
  if(abilityLabel) parts.push("physical ability: " + abilityLabel);
  if(_tb.abilityNote) parts.push(_tb.abilityNote);
  return parts.join(", ");
}
// Round CU: shared helper that bundles the user's personal preferences
// (party, pace, accommodation, dietary/safety avoidances, hardlimits) into
// a compact prompt fragment. Used by every recommendation call — picker
// activities, narratives, what-to-do, restaurants — so suggestions
// respect "no hostels," "vegetarian," "traveling with elderly parents,"
// etc. Returns "" if no preferences are set so prompts stay clean.
function _briefPersonalContext(){
  var lines = [];
  if (_tb.travelersCount) {
    var n = parseInt(_tb.travelersCount, 10);
    if (n > 0) {
      var sizeStr = n + " " + (n === 1 ? "traveler" : "travelers");
      if (_tb.withKids) sizeStr += ", with kids";
      lines.push("Party: " + sizeStr);
    }
  }
  if (_tb.aboutTrip) lines.push("About this trip and how they travel: " + _tb.aboutTrip);
  if (_tb.transport) lines.push("Transport within region: " + _tb.transport);
  if (_tb.accommodation) lines.push("Lodging preferences: " + _tb.accommodation);
  var avoid = _tbAvoidSummary && _tbAvoidSummary();
  if (avoid) lines.push("Avoid: " + avoid);
  if (_tb.hardlimits) lines.push("Hard limits (never violate): " + _tb.hardlimits);
  if (!lines.length) return "";
  return "\n\nTRAVELER CONTEXT (factor into your suggestions):\n" + lines.map(function(l){return "  • " + l;}).join("\n") + "\n";
}

function _tbAvoidSummary(){
  var avoid = _tb.avoid || {};
  var labels = {altitude:"high altitude",crowds:"crowds",heat:"extreme heat",cold:"extreme cold",longDrives:"long drives"};
  var parts = [];
  Object.keys(labels).forEach(function(k){ if(avoid[k]) parts.push(labels[k]); });
  if(_tb.avoidOther) parts.push(_tb.avoidOther);
  return parts.join("; ");
}

// ─── DATES & DURATION (Stage E) ─────────────────────────────
// Three interlocking values: startDate, days, endDate. Any two determine the
// third. The unset/derived field is flagged via _tb.dateDerived so re-renders
// know which one to leave empty for auto-fill. User can still type in the
// derived field — that flips which other field becomes derived.
//
// Flexible-text mode is preserved: if _tb.dateMode !== "specific" we show the
// original free-text when/duration inputs. Toggle lets the user switch.

function _tbHydrateDates(){
  // Back-fill structured fields from legacy _tb.when / _tb.duration when the
  // brief is re-entered. Specific dates use YYYY-MM-DD in _tb.when.
  if (!_tb.dateMode) {
    _tb.dateMode = (_tb.when && /^\d{4}-\d{2}-\d{2}$/.test(_tb.when)) ? "specific" : "flex";
  }
  if (_tb.dateMode === "specific") {
    if (!_tb.startDate && _tb.when && /^\d{4}-\d{2}-\d{2}$/.test(_tb.when)) _tb.startDate = _tb.when;
    if (!_tb.days && _tb.duration) {
      var m = (_tb.duration || "").match(/(\d+)/);
      if (m) _tb.days = parseInt(m[1], 10);
    }
    _tbRecalcDates();
  }
}

function _tbParseYMD(s){
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var p = s.split("-");
  return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
}
function _tbFormatYMD(d){
  if (!d || isNaN(d.getTime())) return "";
  var y = d.getFullYear();
  var m = (d.getMonth()+1).toString().padStart(2,"0");
  var dd = d.getDate().toString().padStart(2,"0");
  return y + "-" + m + "-" + dd;
}

// Compute the third value from the other two, storing which one was derived
// so it shows the "auto" indicator. When all three are set, leave them as-is
// (user may have typed explicitly). Validates: days >= 1.
function _tbRecalcDates(){
  var s = _tbParseYMD(_tb.startDate);
  var e = _tbParseYMD(_tb.endDate);
  var d = (typeof _tb.days === "number" && _tb.days > 0) ? _tb.days : null;
  var derived = _tb.dateDerived || "";
  // Prefer the two most recently set; if derived flag names a field, recompute it
  function msDay(){ return 1000*60*60*24; }
  if (derived === "endDate" && s && d) {
    var nd = new Date(s.getTime() + (d-1) * msDay());
    _tb.endDate = _tbFormatYMD(nd);
  } else if (derived === "days" && s && e) {
    var delta = Math.round((e.getTime() - s.getTime()) / msDay()) + 1;
    _tb.days = delta > 0 ? delta : null;
  } else if (derived === "startDate" && e && d) {
    var ns = new Date(e.getTime() - (d-1) * msDay());
    _tb.startDate = _tbFormatYMD(ns);
  } else {
    // No explicit derived flag — derive whichever is missing
    if (!_tb.endDate && s && d) { _tb.endDate = _tbFormatYMD(new Date(s.getTime() + (d-1) * msDay())); _tb.dateDerived = "endDate"; }
    else if (!_tb.days && s && e) { var delta2 = Math.round((e.getTime() - s.getTime()) / msDay()) + 1; if (delta2 > 0) { _tb.days = delta2; _tb.dateDerived = "days"; } }
    else if (!_tb.startDate && e && d) { _tb.startDate = _tbFormatYMD(new Date(e.getTime() - (d-1) * msDay())); _tb.dateDerived = "startDate"; }
  }
}

function _tbDatesFieldHtml(){
  _tbHydrateDates();
  var mode = _tb.dateMode || "flex";
  var flexOn = mode === "flex";
  var specOn = mode === "specific";
  var header = ''
    +'<div class="tb-field"><label>When you\u2019re going</label>'
    +'<div style="display:flex;gap:5px;margin:2px 0 8px;">'
    +'<span class="tb-toggle'+(flexOn?" on":"")+'" onclick="_tbSetDateMode(&#39;flex&#39;)">Month or season</span>'
    +'<span class="tb-toggle'+(specOn?" on":"")+'" onclick="_tbSetDateMode(&#39;specific&#39;)">Specific dates</span>'
    +'</div>';
  var panel;
  // SCAFFOLD-1: surface the destination name in the duration prompt
  // and remind the user this is a working estimate. The field
  // accepts ranges and rough phrasings on purpose — it's a first
  // guess, not a commitment.
  var _scaffoldPlace = (_tb.region || _tb.placeName || "this place")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  if (flexOn) {
    panel = ''
      +'<input id="tb-when" value="'+(_tb.when||"").replace(/"/g,'&quot;')+'" placeholder="e.g. September\u2013October, shoulder season." />'
      +'<label style="display:block;font-size:10px;font-weight:700;color:var(--c-ink-2);text-transform:uppercase;letter-spacing:.06em;margin-top:14px;margin-bottom:5px;">First guess at how long you want to be in '+_scaffoldPlace+'</label>'
      +'<input id="tb-duration" value="'+(_tb.duration||"").replace(/"/g,'&quot;')+'" placeholder="e.g. 10\u201314 days, three weeks\u2026" />'
      +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:5px;line-height:1.5;font-style:italic;">You can change this as you learn more.</div>';
  } else {
    var startD = _tb.startDate || "";
    var endD = _tb.endDate || "";
    var daysV = (typeof _tb.days === "number" && _tb.days > 0) ? _tb.days : "";
    var derived = _tb.dateDerived || "";
    function mark(id){ return derived === id ? ' <span style="font-size:10px;color:var(--c-ink-3);font-weight:400;font-style:italic;">(auto)</span>' : ""; }
    panel = ''
      +'<div style="font-size:10px;color:var(--c-ink-3);margin-bottom:8px;line-height:1.5;">First guess at when you’ll be in '+_scaffoldPlace+'. Fill any two \u2014 Max fills the third. Edit any field to override. You can change all of this as you learn more.</div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +'<div style="flex:1;min-width:120px;"><label style="display:block;font-size:11px;font-weight:600;color:#333;margin-bottom:4px;">Start date'+mark("startDate")+'</label>'
      +'<input id="tb-startDate" type="date" value="'+startD+'" onchange="_tbOnDateChange(&#39;startDate&#39;)" style="width:100%;box-sizing:border-box;" />'
      +'</div>'
      +'<div style="flex:0 0 92px;"><label style="display:block;font-size:11px;font-weight:600;color:#333;margin-bottom:4px;">Days'+mark("days")+'</label>'
      +'<input id="tb-days" type="number" min="1" max="365" value="'+daysV+'" onchange="_tbOnDateChange(&#39;days&#39;)" style="width:100%;box-sizing:border-box;" />'
      +'</div>'
      +'<div style="flex:1;min-width:120px;"><label style="display:block;font-size:11px;font-weight:600;color:#333;margin-bottom:4px;">End date'+mark("endDate")+'</label>'
      +'<input id="tb-endDate" type="date" value="'+endD+'" onchange="_tbOnDateChange(&#39;endDate&#39;)" style="width:100%;box-sizing:border-box;" />'
      +'</div>'
      +'</div>';
  }
  return header + panel + '</div>';
}

function _tbSetDateMode(mode){
  // Capture anything that might be in the live DOM first
  _tbCaptureDates();
  _tb.dateMode = mode;
  if (_tb._editMode) {
    renderTripBriefEdit();
  } else {
    renderTripBrief();
  }
}

function _tbOnDateChange(which){
  var startInp = document.getElementById("tb-startDate");
  var endInp   = document.getElementById("tb-endDate");
  var daysInp  = document.getElementById("tb-days");
  var startV = startInp ? startInp.value : "";
  var endV   = endInp ? endInp.value : "";
  var daysV  = daysInp ? (daysInp.value ? parseInt(daysInp.value,10) : null) : null;
  // The user edited 'which' — the OTHER not-explicitly-set field becomes derived.
  // Clear the previously-derived field if it isn't the one being edited, so the
  // recalc picks the right target.
  var filled = [];
  if (startV) filled.push("startDate");
  if (endV) filled.push("endDate");
  if (daysV && daysV > 0) filled.push("days");
  _tb.startDate = startV || "";
  _tb.endDate = endV || "";
  _tb.days = (daysV && daysV > 0) ? daysV : null;
  // If all three are filled and one was just edited, the one most recently
  // derived stays derived — unless 'which' IS the derived field, in which
  // case we flip derivation to the oldest untouched field.
  if (filled.length === 3) {
    if (_tb.dateDerived === which) {
      // pick the other of the two untouched — prefer to re-derive endDate
      var candidates = ["endDate","days","startDate"].filter(function(f){ return f !== which; });
      _tb.dateDerived = candidates[0];
      // Clear that one so the recalc recomputes it
      if (_tb.dateDerived === "endDate") _tb.endDate = "";
      else if (_tb.dateDerived === "days") _tb.days = null;
      else _tb.startDate = "";
    }
  } else if (filled.length === 2) {
    // The missing one is the derived target
    _tb.dateDerived = ["startDate","days","endDate"].filter(function(f){ return filled.indexOf(f) < 0; })[0];
  } else {
    _tb.dateDerived = "";
  }
  _tbRecalcDates();
  // Re-render in place so the (auto) labels and filled fields update
  _tb._preserveScrollOnce = true;
  if (_tb._editMode) renderTripBriefEdit(); else renderTripBrief();
}

// ─── ENTRY / EXIT (Stage F) ─────────────────────────────────
// Each endpoint has a city and a mode (fly / drive / train / public / won't
// travel). Stored as _tb.entryMode and _tb.exitMode. Modes are strings so
// the prompt and trip.brief snapshot can include them verbatim.
var _tbTransportModes = [
  {id:"fly",    label:"Fly"},
  {id:"drive",  label:"Car"},
  {id:"train",  label:"Train"},
  {id:"public", label:"Public transport"},
  {id:"unsure", label:"Not sure yet"},
  {id:"none",   label:"Won\u2019t travel"}
];

// Step 2 version of the mode picker. Same icon+popover design as the Places
// overlay version (_tbPlacesModeIconHtml), just wired to _tbPickMode so
// field-capture matches the Step 2 brief-edit form (which has extra fields).
// Named _tbModePillsHtml for historical reasons — it no longer renders pills.
function _tbModePillsHtml(which){
  var cur = _tb[which] || "";
  var label = cur ? ((_tbTransportModes.filter(function(m){return m.id===cur;})[0]||{}).label || "") : "";
  var popId = "tb-mode2-pop-"+which;
  return '<div style="position:relative;display:inline-block;margin:4px 0 6px;">'
    + '<button type="button" onclick="_tbToggleStep2ModePopover(&#39;'+which+'&#39;,event)" '
    +   'style="font-size:11px;padding:6px 12px;border:1px solid '+(cur?"#111":"#ccc")+';border-radius:6px;background:#fff;color:'+(cur?"#111":"#666")+';cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;min-width:140px;justify-content:space-between;">'
    +   '<span>'+(cur?label:"Tap to pick how")+'</span>'
    +   '<span style="font-size:9px;color:#999;">\u25BE</span>'
    + '</button>'
    + '<div id="'+popId+'" style="display:none;position:absolute;top:100%;left:0;z-index:1000;margin-top:4px;background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.1);padding:4px;min-width:160px;">'
    +   _tbTransportModes.map(function(m){
          var on = cur === m.id;
          return '<div onclick="_tbPickMode(&#39;'+which+'&#39;,&#39;'+m.id+'&#39;)" '
            + 'style="padding:6px 10px;font-size:11px;cursor:pointer;border-radius:4px;'
            + (on?"background:#f0f5ff;color:#1a5fa8;font-weight:600;":"color:#333;")+'" '
            + 'onmouseover="this.style.background=&#39;#f5f5f5&#39;" onmouseout="this.style.background=&#39;'+(on?"#f0f5ff":"transparent")+'&#39;">'
            + m.label
            + '</div>';
        }).join("")
    + '</div></div>';
}

function _tbToggleStep2ModePopover(which, evt){
  if (evt && evt.stopPropagation) evt.stopPropagation();
  var pop = document.getElementById("tb-mode2-pop-"+which); if (!pop) return;
  // Round FO: dismiss every OTHER popover, not just the one peer.
  // Round FQ: dropped betweenMode — back to the entry/exit pair.
  ["entryMode","exitMode"].forEach(function(name){
    if (name === which) return;
    var p = document.getElementById("tb-mode2-pop-"+name);
    if (p) p.style.display = "none";
  });
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

function _tbPickMode(which, id){
  // Toggle off if user taps the already-selected mode
  _tb[which] = (_tb[which] === id) ? "" : id;
  // Capture every in-flight input before re-render so nothing gets wiped
  var ids = ["tb-gettingTo","tb-entry","tb-gettingOut","tb-exit","tb-transport",
             "tb-accommodation","tb-pace","tb-compromises","tb-hardlimits","tb-region"];
  var keys = {"tb-gettingTo":"gettingTo","tb-entry":"entry","tb-gettingOut":"gettingOut",
              "tb-exit":"tbExit","tb-transport":"transport","tb-accommodation":"accommodation",
              "tb-pace":"pace","tb-compromises":"compromises","tb-hardlimits":"hardlimits",
              "tb-region":"region"};
  ids.forEach(function(domId){
    var el = document.getElementById(domId);
    if (el) _tb[keys[domId]] = el.value.trim();
  });
  _tbCaptureDates();
  _tbCaptureParty();
  _tbCaptureAvoid();
  // Re-render in place \u2014 preserve scroll so the page doesn\u2019t jump to top.
  _tb._preserveScrollOnce = true;
  if (_tb._editMode) renderTripBriefEdit(); else renderTripBrief();
}

function _tbEntryExitFieldsHtml(){
  var inLabel = "How you\u2019re arriving in " + (_tb.region || "the region");
  var outLabel = "How you\u2019re leaving";
  return ''
    +'<div class="tb-field" style="margin-top:20px;"><label>'+inLabel+'</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:4px;">Pick how. Then say where.</div>'
    + _tbModePillsHtml("entryMode")
    +'<input id="tb-entry" value="'+(_tb.entry||'').replace(/"/g,'&quot;')+'" placeholder="First city or airport \u2014 e.g. Zurich, ZRH" style="margin-bottom:6px;" oninput="_tb.entryInferred=false;" />'
    +(_tb.entryInferred ? '<div style="font-size:10px;color:var(--c-ink-3);margin-bottom:6px;font-style:italic;">\u2728 Max suggested this starting point. Edit to set your actual arrival.</div>' : '')
    +'<input id="tb-gettingTo" value="'+(_tb.gettingTo||'').replace(/"/g,'&quot;')+'" placeholder="Optional: booked flight/train #, date, notes" />'
    +'<div style="display:flex;gap:5px;margin-top:6px;">'
    +'<span class="tb-toggle'+(_tb.entryFixed?' on':'')+'" onclick="_tbSetFixed(&#39;entry&#39;,true)">Booked / fixed</span>'
    +'<span class="tb-toggle'+(!_tb.entryFixed?' on':'')+'" onclick="_tbSetFixed(&#39;entry&#39;,false)">Still flexible</span>'
    +'</div>'
    +'</div>'
    +'<div class="tb-field"><label>'+outLabel+'</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:4px;">Entry and exit can differ \u2014 that\u2019s fine, and shapes the direction.</div>'
    + _tbModePillsHtml("exitMode")
    +'<input id="tb-exit" value="'+(_tb.tbExit||'').replace(/"/g,'&quot;')+'" placeholder="Last city or airport \u2014 e.g. Geneva, GVA" style="margin-bottom:6px;" />'
    +'<input id="tb-gettingOut" value="'+(_tb.gettingOut||'').replace(/"/g,'&quot;')+'" placeholder="Optional: booked flight/train #, date, notes" />'
    +'<div style="display:flex;gap:5px;margin-top:6px;">'
    +'<span class="tb-toggle'+(_tb.exitFixed?' on':'')+'" onclick="_tbSetFixed(&#39;exit&#39;,true)">Booked / fixed</span>'
    +'<span class="tb-toggle'+(!_tb.exitFixed?' on':'')+'" onclick="_tbSetFixed(&#39;exit&#39;,false)">Still flexible</span>'
    +'</div>'
    +'</div>';
}

// Compact version used on Step 2 — just the mode pills (fly/car/train/public/none)
// for entry and exit. Specific cities get decided on the Places overlay once the
// user has seen which candidates they\u2019re keeping.
function _tbEntryExitModesOnlyHtml(){
  return ''
    +'<div class="tb-field" style="margin-top:20px;"><label>How you\u2019re arriving</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:4px;">The specific city comes after you\u2019ve picked places \u2014 it\u2019ll be clearer then.</div>'
    + _tbModePillsHtml("entryMode")
    +'</div>'
    // Round FQ: between-mode pill removed. The geographic-affordance
    // verdict computed at the picker now informs sequencing \u2014 Max
    // reads the geometry of the picked destinations and tells the
    // user what it sees, instead of asking them to declare a mode
    // up front. See the picker banner in renderCandidateCards and
    // the trip-view banner in drawTripMode.
    +'<div class="tb-field"><label>How you\u2019re leaving</label>'
    +'<div style="font-size:10px;color:var(--c-ink-3);margin-top:2px;margin-bottom:4px;">Entry and exit can differ \u2014 that\u2019s fine, and shapes the direction.</div>'
    + _tbModePillsHtml("exitMode")
    +'</div>';
}

function _tbSetFixed(side, val){
  if (side === "entry") _tb.entryFixed = !!val;
  else _tb.exitFixed = !!val;
  // Same in-flight capture as _tbPickMode so switching doesn't wipe typed text
  var ids = ["tb-gettingTo","tb-entry","tb-gettingOut","tb-exit","tb-transport",
             "tb-accommodation","tb-pace","tb-compromises","tb-hardlimits","tb-region"];
  var keys = {"tb-gettingTo":"gettingTo","tb-entry":"entry","tb-gettingOut":"gettingOut",
              "tb-exit":"tbExit","tb-transport":"transport","tb-accommodation":"accommodation",
              "tb-pace":"pace","tb-compromises":"compromises","tb-hardlimits":"hardlimits",
              "tb-region":"region"};
  ids.forEach(function(domId){
    var el = document.getElementById(domId);
    if (el) _tb[keys[domId]] = el.value.trim();
  });
  _tbCaptureDates();
  _tbCaptureParty();
  _tbCaptureAvoid();
  _tb._preserveScrollOnce = true;
  if (_tb._editMode) renderTripBriefEdit(); else renderTripBrief();
}

function _tbEntryExitSummary(){
  function label(id){ var m = _tbTransportModes.filter(function(x){return x.id===id;})[0]; return m ? m.label.toLowerCase() : ""; }
  var parts = [];
  if (_tb.entry || _tb.entryMode) {
    var p = [];
    if (_tb.entryMode) p.push(label(_tb.entryMode));
    if (_tb.entry) p.push("into " + _tb.entry);
    parts.push("Entry: " + p.filter(function(s){return s;}).join(" "));
  }
  if (_tb.tbExit || _tb.exitMode) {
    var q = [];
    if (_tb.exitMode) q.push(label(_tb.exitMode));
    if (_tb.tbExit) q.push("out of " + _tb.tbExit);
    parts.push("Exit: " + q.filter(function(s){return s;}).join(" "));
  }
  return parts.join("; ");
}

function _tbCaptureDates(){
  // Save whatever the DOM currently shows into _tb, without triggering a recalc.
  var when = document.getElementById("tb-when");
  if (when) _tb.when = when.value.trim();
  var dur = document.getElementById("tb-duration");
  if (dur) _tb.duration = dur.value.trim();
  var s = document.getElementById("tb-startDate");
  if (s) _tb.startDate = s.value || "";
  var e = document.getElementById("tb-endDate");
  if (e) _tb.endDate = e.value || "";
  var d = document.getElementById("tb-days");
  if (d) _tb.days = d.value ? parseInt(d.value,10) : null;
  // Serialize specific-mode into legacy _tb.when / _tb.duration for the rest
  // of the app (prompts, parseStartDateFromBrief, date headers).
  if (_tb.dateMode === "specific") {
    if (_tb.startDate) _tb.when = _tb.startDate;
    if (_tb.days) _tb.duration = _tb.days + " days";
  }
}

// Section heading used to visually group B–H on Step 2.
function _tbSectionHead(title, sub){
  return '<div style="margin:26px 0 8px;">'
    +'<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:#999;text-transform:uppercase;">'+title+'</div>'
    +(sub ? '<div style="font-size:11px;color:#777;margin-top:3px;line-height:1.55;">'+sub+'</div>' : '')
    +'</div>';
}

// v359.7: renderTripBrief used to render the second of two brief
// pages ("Shape the trip"). With the consolidation it's now a thin
// alias to the single unified page below \u2014 every call site funnels
// to renderTripStep1Place. Kept callable so external onclick refs
// (and the back-button paths) keep working without rewriting them.
function renderTripBrief(){
  return renderTripStep1Place();
}

// Legacy two-page renderer kept for reference only. Not called.
function _legacyRenderTripBrief(){
  var ov=g("trip-brief-overlay"); ov.className="tb-overlay";
  // Capture scroll position before we blow away innerHTML, so in-place
  // re-renders (e.g. toggling a mode pill) don\u2019t yank the user back to top.
  var _prevScroll = ov.scrollTop || 0;
  var _preserve = !!_tb._preserveScrollOnce;
  _tb._preserveScrollOnce = false;
  ov.style.cssText="position:fixed;inset:0;background:var(--c-panel);z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch;";
  // Reset scroll to top on render (fresh view), then attach the scroll hint
  setTimeout(function(){ ov.scrollTop = _preserve ? _prevScroll : 0; attachScrollHint(ov); }, 0);
  ov.innerHTML='<div class="tb-header">'
    +'<div class="tb-logo"><div class="tb-logo-m">M</div><div><div style="font-size:12px;font-weight:700;">Max</div></div></div>'
    +'<div class="tb-title">Tell Max about your trip</div>'
    +'</div>'
    +'<div class="tb-body">'
    +'<p style="margin:0 0 8px;font-size:12px;color:var(--c-ink-2);line-height:1.65;">How do you want to travel through it? Fill in what matters, skip what doesn\u2019t.</p>'

    // Round DM: Brief Step 2 rebuilt around clearer contracts. Section 1
    // (required): dates + travelers count + with-kids. Sections 2/3
    // (high consequence, easy to skip): transport + lodging with strong
    // nudge copy explaining why they shape everything. Section 4
    // (optional, free text): pace, party detail, perspective,
    // compromises collapsed into one textarea. Section 5: hard limits
    // separated. Section 6: avoid chips.

    // 1. WHEN, HOW LONG, AND HOW MANY (required)
    + _tbSectionHead("When are you going, for how long, and how many of you?", "Required.")
    + _tbDatesFieldHtml()
    +'<div class="tb-field" style="margin-top:14px;"><label>How many travelers?</label>'
    +'<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">'
    +'<input id="tb-travelers-count" type="number" min="1" max="40" inputmode="numeric" value="'+((_tb.travelersCount||_tb.partySize||"2")+"").replace(/"/g,"&quot;")+'" placeholder="e.g. 2" oninput="_tb.travelersCount=this.value;" style="max-width:120px;" />'
    +'<label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;font-size:13px;margin:0;text-transform:none;letter-spacing:0;color:#222;">'
    +'<input id="tb-with-kids" type="checkbox" '+((_tb.withKids||_tb.partyComposition==="family-kids")?"checked":"")+' onchange="_tb.withKids=this.checked;" style="width:auto;margin:0;" /> Traveling with kids?'
    +'</label>'
    +'</div>'
    +'<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.55;">Solo, couple, family of 5, group of 12. Size shapes recommendations a lot \u2014 restaurants for 8 are a different problem than tables for 2; some activities have group caps; multi-room hotels need lead time.</div>'
    +'</div>'

    // 2. HOW YOU GET AROUND (high consequence)
    + _tbSectionHead("How you'd like to get around in " + (_tb.region || "the region"))
    +'<div class="tb-field">'
    +'<input id="tb-transport" value="'+(_tb.transport||"").replace(/"/g,"&quot;")+'" placeholder="e.g. Trains and walking only \u2014 no rental car. Swiss Travel Pass." oninput="_tb.transport=this.value;" />'
    +'<div style="font-size:10.5px;color:var(--c-warn);font-style:italic;margin-top:4px;line-height:1.55;">This shapes everything. Easy to skip even though you wouldn\u2019t want to \u2014 most travelers default to whatever\u2019s familiar from home, but in a different country, \u201cI\u2019ve always done it this way\u201d can limit your experience.</div>'
    +'</div>'

    // 3. WHERE YOU STAY (high consequence)
    + _tbSectionHead("Where you'd like to stay")
    +'<div class="tb-field">'
    +'<textarea id="tb-accommodation" rows="2" placeholder="e.g. Small family hotels, en suite required, no hostels, no shared bathrooms." oninput="_tb.accommodation=this.value;" style="resize:vertical;min-height:54px;">'+(_tb.accommodation||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +'<div style="font-size:10.5px;color:var(--c-warn);font-style:italic;margin-top:4px;line-height:1.55;">Same \u2014 be explicit even if it feels obvious. \u201cHotel is fine\u201d doesn\u2019t tell Max whether you need air conditioning or whether shared bathrooms would ruin the trip.</div>'
    +'</div>'

    // visual divider
    +'<div style="margin:32px 0 6px;border-top:1px dashed #d8d4c8;"></div>'

    // 4. HOW DO YOU TRAVEL?
    // v306: section reordered. Previously the subtitle promised "Party
    // (count, ages, mobility), prior experience, what you'd skip\u2026" but
    // those fields were structured elsewhere (party in Section 1,
    // familiarity in Step 1) and the freeform textarea \u2014 where the
    // remaining prose belonged \u2014 was buried below the structured
    // pace fields. New order:
    //   1. Subtitle
    //   2. Freeform textarea (first, where the user expects to type)
    //   3. Mobility chips (structured \u2014 heavily shapes picker output)
    //   4. Pace (hours/day + max big sights)
    + _tbSectionHead("How do you travel?", "Optional. What you\u2019d skip, what you wouldn\u2019t miss, prior trips, things that just matter \u2014 in your own words. Mobility and pace get their own structured fields below since they shape what Max suggests.")
    +'<div class="tb-field"><textarea id="tb-about-trip" rows="5" placeholder="e.g. Couple in our 60s, both fit but slow paced \u2014 rather linger in one place than rush. First trip to this region. Would skip a famous-but-touristy day-trip to keep an extra night somewhere quieter; wouldn\u2019t skip a once-in-a-lifetime view." oninput="_tb.aboutTrip=this.value;">'+((_tb.aboutTrip||"").replace(/</g,"&lt;"))+'</textarea><div style="font-size:10px;color:var(--c-ink-4);margin-top:4px;line-height:1.5;">The more you share, the better the suggestions. Max reads this as prose \u2014 write naturally.</div></div>'

    // v306: Mobility \u2014 resurrected from the legacy _tb.physicalAbility
    // field (engine still reads it via _briefPersonalContext at line
    // ~5989). It was rolled into freeform aboutTrip in Round DM but
    // mobility shapes too much of what Max can suggest (no cogwheel
    // railways for limited walking, no multi-day hikes for elderly,
    // etc.) to leave it in prose. Now back as chips.
    + (function(){
        var ab = _tb.physicalAbility || "";
        var opts = [
          {id:"fit",      label:"Fit and active"},
          {id:"moderate", label:"Moderate"},
          {id:"limited",  label:"Limited walking"},
          {id:"elderly",  label:"Elderly"},
          {id:"mobility", label:"Mobility aid"},
          {id:"other",    label:"Other"}
        ];
        var chips = opts.map(function(o){
          return '<span class="tb-toggle'+(ab===o.id?" on":"")+'" data-ability-id="'+o.id+'" onclick="_tbPickAbility(\''+o.id+'\')">'+o.label+'</span>';
        }).join("");
        return '<div class="tb-field"><label>Mobility of the slowest member</label>'
          + '<div style="font-size:10.5px;color:#777;margin-top:2px;margin-bottom:6px;line-height:1.55;">Max shapes the trip around what the slowest or least-mobile traveler can manage comfortably. This rules out big climbs, fast cogwheel rides, multi-day hikes when set tight.</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+chips+'</div>'
          + '<input id="tb-ability-note" value="'+((_tb.abilityNote||"").replace(/"/g,"&quot;"))+'" placeholder="Anything specific Max should know \u2014 bad knees, pregnant, strollers, etc." oninput="_tb.abilityNote=this.value;" style="margin-top:8px;" />'
          + '</div>';
      })()

    +'<div class="tb-field"><label>Pace \u2014 typical hours of sightseeing per day</label>'
    +'<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:6px;">'
    +'<div style="display:flex;align-items:center;gap:8px;">'
    +'<label style="font-size:10px;color:var(--c-ink-3);font-weight:500;text-transform:none;letter-spacing:0;margin:0;">Hours/day:</label>'
    +'<input id="tb-hours-per-day" type="number" min="1" max="12" inputmode="numeric" value="'+((_tb.hoursPerDay||_defaultHoursPerDay())+"")+'" oninput="_tb.hoursPerDay=this.value;" style="width:72px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;">'
    +'<label style="font-size:10px;color:var(--c-ink-3);font-weight:500;text-transform:none;letter-spacing:0;margin:0;">Max \u201cbig\u201d sights (2+ hrs) per day:</label>'
    +'<input id="tb-max-big-sights" type="number" min="1" max="6" inputmode="numeric" value="'+((_tb.maxBigSightsPerDay||_defaultMaxBigSightsPerDay())+"")+'" oninput="_tb.maxBigSightsPerDay=this.value;" style="width:72px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'</div>'
    +'<div style="font-size:10.5px;color:#777;margin-top:8px;line-height:1.6;">'
    +'Max will use about <strong>'+((_tb.hoursPerDay||_defaultHoursPerDay())+"")+' hrs</strong> of sightseeing on a full day (lighter on travel days, fuller in the middle), and won\u2019t schedule more than '
    +'<strong>'+((_tb.maxBigSightsPerDay||_defaultMaxBigSightsPerDay())+"")+'</strong> big sight'+((_tb.maxBigSightsPerDay||_defaultMaxBigSightsPerDay())==1?"":"s")+' per day so a single day doesn\u2019t turn into a forced march.'
    +'</div>'
    +'<div style="font-size:10.5px;color:var(--c-warn);font-style:italic;margin-top:6px;line-height:1.55;">'
    +'A note on duration: Max\u2019s per-sight time estimates are LLM best-guesses, not measured data. They assume a committed traveler. If you\u2019re a slower museum-goer, expect to fit less per day; if you\u2019re a look-and-go type, you may want to bump the hours up.'
    +'</div>'
    +'</div>'

    // 5. HARD LIMITS (optional but consequential)
    + _tbSectionHead("Hard limits", "Optional but consequential. Things Max won\u2019t route around \u2014 different from preferences above.")
    +'<div class="tb-field"><textarea id="tb-hardlimits" rows="2" placeholder="e.g. No car rentals under any circumstances. Vegetarian. Wheelchair access required. No flights under 90 minutes." oninput="_tb.hardlimits=this.value;">'+(_tb.hardlimits||"")+'</textarea></div>'

    // 6. WHAT TO AVOID (optional chips)
    + _tbSectionHead("Anything you\u2019d like to avoid?", "Optional. Soft preferences Max will weigh.")
    + _tbAvoidFieldHtml()

    +'</div>'
    +'<div class="tb-footer">'
    +'<div style="display:flex;gap:10px;align-items:stretch;">'
    +'<button class="tb-btn-primary" onclick="goToTripStep2()" style="flex:1;width:auto;">Ask Max to suggest places \u2192</button>'
    +'<button class="tb-btn-paste" onclick="_pasteListFromBrief()" style="flex:1;font-size:12px;font-weight:600;color:var(--c-primary);background:var(--c-bg);border:1px solid var(--c-border-blue);border-radius:6px;padding:10px;cursor:pointer;font-family:inherit;">Add your places \u2192</button>'
    +'</div>'
    +'<div style="display:flex;justify-content:space-between;margin-top:8px;">'
    +'<div class="tb-btn-back" onclick="renderTripStep1()">\u2190 Back</div>'
    +'<div style="font-size:10px;color:var(--c-ink-4);cursor:pointer;" onclick="showBriefApiKeyForm()">\ud83d\udd11 Set API key</div>'
    +'</div>'
    +'</div>';
}

function goToTripStep2(){
  // v359.7: now the SINGLE brief's submit handler (after the old
  // page-1 → page-2 split was consolidated). Captures the destination
  // / why fields that used to live on page 1, plus everything from
  // the old page 2.
  var _pl = g("tb-place-name");
  if (_pl) _tb.placeName = (_pl.value || "").trim();
  var _whySp = g("tb-why-specifically");
  if (_whySp) _tb.whySpecifically = (_whySp.value || "").trim();
  var _whyGen = g("tb-why-generally");
  if (_whyGen) _tb.whyGenerally = (_whyGen.value || "").trim();
  // Mirror placeContext for back-compat with prompts that haven't
  // been updated yet to read the new whySpecifically / whyGenerally
  // fields. The two-line "specifically + generally" reads better in
  // a prompt than either field alone.
  var _ctxBits = [];
  if (_tb.whySpecifically) _ctxBits.push("Specifically: " + _tb.whySpecifically);
  if (_tb.whyGenerally)    _ctxBits.push("Generally: " + _tb.whyGenerally);
  if (_ctxBits.length) _tb.placeContext = _ctxBits.join(". ");
  // Promote placeName → region/intent so downstream flow still
  // works (same logic the deleted continueFromPlaceToBrief had).
  if (!_tb.region && _tb.placeName) _tb.region = _tb.placeName;
  if (_tb.placeContext && !_tb.intent) _tb.intent = _tb.placeContext;
  // If the place changed since picker last ran, blow away stale activities.
  if (Array.isArray(_tb.placeActivities) && _tb.placeActivities.length) {
    var lastPlace = _tb._lastGeneratedFor || "";
    if (lastPlace && _tb.placeName && lastPlace !== _tb.placeName) _tb.placeActivities = [];
  }

  _tbCaptureDates();
  _tb.duration      = g("tb-duration")      ? g("tb-duration").value.trim()      : (_tb.duration||"");
  _tb.when          = g("tb-when")          ? g("tb-when").value.trim()          : (_tb.when||"");
  _tb.gettingTo     = g("tb-gettingTo")     ? g("tb-gettingTo").value.trim()     : (_tb.gettingTo||"");
  _tb.entry         = g("tb-entry")         ? g("tb-entry").value.trim()         : (_tb.entry||"");
  _tb.gettingOut    = g("tb-gettingOut")    ? g("tb-gettingOut").value.trim()    : (_tb.gettingOut||"");
  _tb.tbExit        = g("tb-exit")          ? g("tb-exit").value.trim()          : (_tb.tbExit||"");
  // v359.11: when the brief is in collapsed mode, the per-field inputs
  // aren't in the DOM. Fall through to the global default in that
  // case so the engine sees the user's saved Settings values, not
  // empty strings. Same pattern as the existing hoursPerDay capture
  // below.
  _tb.transport     = g("tb-transport")     ? g("tb-transport").value.trim()     : (_tb.transport || _defaultTransport() || "");
  _tb.accommodation = g("tb-accommodation") ? g("tb-accommodation").value.trim() : (_tb.accommodation || _defaultAccommodation() || "");
  _tb.hardlimits    = g("tb-hardlimits")    ? g("tb-hardlimits").value.trim()    : (_tb.hardlimits||"");
  // Round DM: new fields from the rebuilt Step 2.
  _tb.travelersCount = g("tb-travelers-count") ? g("tb-travelers-count").value.trim() : (_tb.travelersCount || _defaultTravelersCount());
  _tb.withKids       = g("tb-with-kids") ? !!g("tb-with-kids").checked : ((typeof _tb.withKids === "boolean") ? _tb.withKids : _defaultWithKids());
  _tb.aboutTrip      = g("tb-about-trip") ? g("tb-about-trip").value.trim() : (_tb.aboutTrip||"");
  // v302: structured pace fields.
  // v359.8: also capture the two new Settings-backed fields added in
  // the consolidated brief — paceMode (radio) and dayTripHours.
  var _hpdEl = g("tb-hours-per-day");
  var _bigEl = g("tb-max-big-sights");
  _tb.hoursPerDay        = _hpdEl ? Math.max(1, Math.min(12, parseInt(_hpdEl.value, 10) || _defaultHoursPerDay())) : (_tb.hoursPerDay || _defaultHoursPerDay());
  _tb.maxBigSightsPerDay = _bigEl ? Math.max(1, Math.min(6,  parseInt(_bigEl.value, 10) || _defaultMaxBigSightsPerDay())) : (_tb.maxBigSightsPerDay || _defaultMaxBigSightsPerDay());
  var _pmRadio = document.querySelector('input[name="tb-pace-mode"]:checked');
  if (_pmRadio && _pmRadio.value) _tb.paceMode = _pmRadio.value;
  else if (!_tb.paceMode) _tb.paceMode = (typeof _defaultPaceMode === "function") ? _defaultPaceMode() : "enough";
  var _dthEl = g("tb-day-trip-hours");
  if (_dthEl) {
    var _dth = parseFloat(_dthEl.value);
    if (isFinite(_dth) && _dth > 0 && _dth <= 6) _tb.dayTripHours = _dth;
  }
  if (!_tb.dayTripHours) _tb.dayTripHours = (typeof _defaultDayTripHours === "function") ? _defaultDayTripHours() : 3;

  // v359.8: first-time auto-save. If a Settings pref key is still
  // unset, treat the user's typed value as their new default. This
  // makes the system organic — the very first trip's values become
  // the user's defaults, subsequent trips show them as defaults with
  // an override option. Skip when MaxDB.prefs is unavailable (test
  // env) or the value didn't validate.
  try {
    if (window.MaxDB && MaxDB.prefs) {
      function _saveIfUnset(key, value, isValid){
        if (!isValid) return;
        var cur = MaxDB.prefs.get(key);
        if (cur == null || cur === "") MaxDB.prefs.set(key, value);
      }
      _saveIfUnset("paceHours", _tb.hoursPerDay, isFinite(_tb.hoursPerDay) && _tb.hoursPerDay >= 2 && _tb.hoursPerDay <= 10);
      _saveIfUnset("sightsPerDay", _tb.maxBigSightsPerDay, isFinite(_tb.maxBigSightsPerDay) && _tb.maxBigSightsPerDay >= 1 && _tb.maxBigSightsPerDay <= 6);
      _saveIfUnset("paceMode", _tb.paceMode, _tb.paceMode === "loose" || _tb.paceMode === "enough" || _tb.paceMode === "notmuch");
      _saveIfUnset("dayTripHours", _tb.dayTripHours, isFinite(_tb.dayTripHours) && _tb.dayTripHours > 0 && _tb.dayTripHours <= 6);
      // v359.9: also auto-save these on first publish.
      var _tc = parseInt(_tb.travelersCount, 10);
      _saveIfUnset("travelersCount", _tc, isFinite(_tc) && _tc >= 1 && _tc <= 40);
      _saveIfUnset("withKids", !!_tb.withKids, true);
      _saveIfUnset("transport", (_tb.transport || "").trim(), (_tb.transport || "").trim().length > 0);
      _saveIfUnset("accommodation", (_tb.accommodation || "").trim(), (_tb.accommodation || "").trim().length > 0);
      // v359.10: mobility too. Display preferences (units/temp/date/
      // currency) and Personal preferences (dietary/languages) are
      // Settings-only for now — no brief field to capture from yet.
      var validMob = ["fit","moderate","limited","elderly","mobility","other"];
      _saveIfUnset("mobility", _tb.physicalAbility, typeof _tb.physicalAbility === "string" && validMob.indexOf(_tb.physicalAbility) >= 0);
      // v359.15.2: also auto-save avoidances on first submit. If user
      // has toggled any chips OR typed in avoidOther, those become
      // the global defaults — same model as the other Bucket C fields.
      // Object equality: any key set to true counts as "has values."
      var _hasAvoidChips = false;
      if (_tb.avoid && typeof _tb.avoid === "object") {
        for (var _k in _tb.avoid) { if (_tb.avoid[_k]) { _hasAvoidChips = true; break; } }
      }
      _saveIfUnset("avoidDefaults", _tb.avoid || {}, _hasAvoidChips);
      _saveIfUnset("avoidOtherDefaults", (_tb.avoidOther || "").trim(), (_tb.avoidOther || "").trim().length > 0);
      // v359.11: flag that the user has now submitted a brief, so
      // subsequent briefs collapse the Bucket-C sections by default
      // (progressive disclosure). Setting unconditionally is fine —
      // re-setting on every submit is idempotent.
      MaxDB.prefs.set("briefSeenOnce", true);
    }
  } catch(_){}
  // v306: mobility note. _tb.physicalAbility is set by _tbPickAbility on
  // chip click; the note input has its own oninput. Re-read here to be
  // safe across keyboard nav / paste.
  var _abNote = g("tb-ability-note");
  if (_abNote) _tb.abilityNote = _abNote.value.trim();
  // Round DM: legacy fields (pace, compromises, partyComposition,
  // partySize, partyAges, physicalAbility, abilityNote) are no longer
  // collected here — they live inside `aboutTrip` as prose now. Older
  // saves keep their values on _tb so _briefPersonalContext can still
  // surface them when present.
  _tbCaptureAvoid();
  // Fallback: if sentence didn't parse cleanly into region, use the sentence itself
  if(!_tb.region && _tb.tripSentence){ _tb.region = _tb.tripSentence; }
  if(!_tb.region){ maxAlert(_briefMissingFieldMsg()); return; }
  // v360.2 (A.4): capture the user's LITERAL input as initial wisps —
  // before renderActivityPicker / the LLM step contaminate anything.
  // The single-page brief has three free-text user fields: placeName,
  // whyGenerally, whySpecifically. Each gets split on commas/and/or
  // into individual fragments and stashed on _tb._initialWispsRaw.
  // publishTrip seeds the new trip's wisps[] from this — bypassing
  // the legacy migration path that reads contaminated brief.mustDo.
  if (typeof _captureInitialWispsFromForm === "function") {
    _captureInitialWispsFromForm({
      whyGenerally: _tb.whyGenerally || "",
      whySpecifically: _tb.whySpecifically || "",
      placeName: _tb.placeName || "",
    });
  }
  renderActivityPicker();
}

function renderTripStep2(){
  var ov=g("trip-brief-overlay"); ov.className="tb-overlay";
  ov.style.cssText="position:fixed;inset:0;background:var(--c-panel);z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch;";

  // Sentence starters
  var sentences = [
    {id:"narrative",  label:"“I’ve always wanted to…”",      sub:"A stored intention finally becoming a trip"},
    {id:"doing",      label:"“I want to do…”",                     sub:"An experience that requires participation — moving, making, attending"},
    {id:"seeing",     label:"“I want to see…”",                    sub:"A place, a landscape, a work, a thing that already holds meaning"},
    {id:"different",  label:"“I need something different…”",       sub:"Adjusting distance from your current life — direction before destination"},
    {id:"relational", label:"“We should go somewhere that…”",      sub:"The people you’re with are shaping where you go"},
    {id:"signal",     label:"“This would be amazing to have done…”", sub:"The trip matters partly because of what it means to have made it"}
  ];
  var drivers = _tb.drivers || [];
  var sentHtml = sentences.map(function(s){
    var on = drivers.indexOf(s.id) > -1;
    return '<div class="tb-sentence'+(on?' on':'')+'" data-id="'+s.id+'" onclick="toggleSentence(this)">'+
      '<div class="tb-sentence-label">'+s.label+'</div>'+
      '<div class="tb-sentence-sub">'+s.sub+'</div>'+
    '</div>';
  }).join("");

  // Familiarity
  var famOptions = [{id:"first",label:"Not at all"},{id:"before",label:"A passing understanding"},{id:"know",label:"Quite a bit"}];
  var fam = _tb.familiarity || "";
  var famHtml = famOptions.map(function(f){
    var on = fam === f.id;
    return '<span class="tb-toggle tb-fam-chip'+(on?' on':'')+'" data-fam-id="'+f.id+'" onclick="_tbPickFamiliarity(\''+f.id+'\')">'+f.label+'</span>';
  }).join("");

  ov.innerHTML='<div class="tb-header">'
    +'<div class="tb-logo"><div class="tb-logo-m">M</div><div><div style="font-size:12px;font-weight:700;">Max</div><div class="tb-step">What you want</div></div></div>'
    +'<div class="tb-title">What\u2019s the sentence that started this trip?</div>'
    +'<div class="tb-sub">Select as many as feel true. The way you say it reveals what\u2019s actually driving the trip.</div>'
    +'</div>'
    +'<div class="tb-body">'

    +'<div class="tb-field"><div class="tb-sentences">'+sentHtml+'</div></div>'

    +'<div class="tb-field" id="gradient-field" style="'+(drivers.indexOf('different')>-1?'':'display:none;')+'">'
    +'<label>What does \u201cdifferent\u201d mean for you right now?</label>'
    +'<textarea id="tb-gradient" rows="3" placeholder="e.g. My life is loud and busy. I want quiet, slow, and warm. Not a beach resort — something real but simple.">'+((_tb.gradient)||'')+'</textarea>'
    +'<div style="font-size:10px;color:var(--c-ink-4);margin-top:4px;">Max uses this to find candidates at the right distance from your current life — you pick what fits and add what’s missing.</div></div>'

    +'<div class="tb-field"><label>How familiar are you with this part of the world?</label>'
    +'<div style="display:flex;gap:6px;margin-top:5px;">'+famHtml+'</div></div>'

    +'<div class="tb-field"><label>Tell Max more <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<textarea id="tb-intent" rows="3" placeholder="e.g. Going with my partner for three weeks. Want a mix — big mountain scenery but also a city with real cultural depth.">'+(_tb.intent||'')+'</textarea>'
    +'<div style="font-size:10px;color:var(--c-ink-4);margin-top:4px;">You don’t need to have this figured out. Max will help you explore it.</div></div>'

    +'<div class="tb-field"><label>Things you can’t miss <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="tb-anchors" value="'+(_tb.anchors||'')+'" placeholder="e.g. Vienna Philharmonic, Glacier Express…" /></div>'

    +'</div>'
    +'<div class="tb-footer">'
    +'<button class="tb-btn-primary" onclick="saveStep2AndProceed()">Places to think about \u2192</button>'
    +'<div style="display:flex;justify-content:space-between;margin-top:8px;">'
    +'<div class="tb-btn-back" onclick="renderTripBrief()">\u2190 Back</div>'
    +'<div style="font-size:10px;color:var(--c-ink-4);cursor:pointer;" onclick="showBriefApiKeyForm()">\ud83d\udd11 Set API key</div>'
    +'</div>'
    +'</div>';
}

function toggleSentence(el){ /* deprecated — sentence is now a textarea */ }

function saveStep2AndProceed(){
  _tb.intent    = g("tb-intent")  ? g("tb-intent").value.trim()  : (_tb.intent||"");
  _tb.anchors   = g("tb-anchors") ? g("tb-anchors").value.trim() : (_tb.anchors||"");
  _tb.gradient  = g("tb-gradient")? g("tb-gradient").value.trim(): (_tb.gradient||"");
  // v360.2 (A.4): capture the user's LITERAL input as initial wisps —
  // before any LLM step runs. After this point _tb.intent / _tb.anchors
  // may get rewritten with LLM-extracted names (the place-mode flow at
  // ~line 18487 joins mdcItem.name fields into _tb.anchors), so the
  // form's submit moment is the cleanest signal of what the user
  // actually typed. Stash on _tb._initialWispsRaw — publishTrip seeds
  // the new trip's wisps[] from this. Falls back to legacy migration
  // (which reads from brief.intent / brief.mustDo) only if this stash
  // is missing.
  if (typeof _captureInitialWispsFromForm === "function") {
    _captureInitialWispsFromForm(_tb.intent, _tb.anchors);
  }
  var drivers = _tb.drivers || [];
  // If "different" is the only driver and no gradient text yet, open conversation
  if(drivers.indexOf("different") > -1 && drivers.length === 1 && !_tb.gradient){
    openGradientConversation();
  } else {
    // PD.309: route through the orchestrator. Sentence-mode "Create my
    // trip" → candidate-first → expandMustDos extracts must-dos via LLM
    // → runCandidateSearch → mint → enhance.
    if (typeof MaxBuild !== "undefined" && MaxBuild && typeof MaxBuild.findCandidates === "function") {
      MaxBuild.findCandidates({
        mode:     "candidate-first",
        region:   _tb.region || "",
        sentence: _tb.intent || "",
        anchors:  _tb.anchors || "",
        tripMode: "sentence"
      }).catch(function(err){
        console.warn("[Max] saveStep2AndProceed: MaxBuild failed:", err && err.message);
      });
    }
  }
}

// v360.2 (A.4): build the raw wisp list from the user's literal form
// input. The single-page brief (renderTripStep1Place, post v359.7)
// has THREE user-typed fields: placeName (where), whyGenerally (the
// general why), whySpecifically (the place-specific why). Each can
// contain comma / and / or-joined fragments. Splits each, joins into
// one stream — whys become 'why' wisps, placeName becomes 'anchor'.
// Dedupes case-folded. Stashes on _tb._initialWispsRaw. publishTrip
// reads this when creating the trip object so the wisp stream
// carries what the user actually typed, not what the LLM later
// derived from it.
//
// The signature accepts either a single string (legacy 2-arg call) or
// an object {whyGenerally, whySpecifically, placeName} for the modern
// brief. Backward compatible.
function _captureInitialWispsFromForm(intentOrObj, anchorsText) {
  if (typeof _splitIntentString !== "function") return;
  var whys = [], anchors = [];
  if (intentOrObj && typeof intentOrObj === "object" && !Array.isArray(intentOrObj)) {
    if (intentOrObj.whyGenerally)    whys.push(intentOrObj.whyGenerally);
    if (intentOrObj.whySpecifically) whys.push(intentOrObj.whySpecifically);
    if (intentOrObj.intent)          whys.push(intentOrObj.intent);
    if (intentOrObj.placeName)       anchors.push(intentOrObj.placeName);
    if (intentOrObj.anchors)         anchors.push(intentOrObj.anchors);
  } else {
    // Legacy 2-string signature.
    if (intentOrObj) whys.push(intentOrObj);
    if (anchorsText) anchors.push(anchorsText);
  }
  var raws = [];
  whys.forEach(function (s) {
    _splitIntentString(s).forEach(function (f) { raws.push({ text: f, kind: 'why' }); });
  });
  anchors.forEach(function (s) {
    _splitIntentString(s).forEach(function (f) { raws.push({ text: f, kind: 'anchor' }); });
  });
  // Dedupe case-folded.
  var seen = {};
  var deduped = [];
  raws.forEach(function (r) {
    var key = r.text.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    deduped.push(r);
  });
  if (typeof _tb !== "undefined" && _tb) {
    _tb._initialWispsRaw = deduped;
    console.log("[A.4] captured initial wisps from form:", deduped.length, deduped);
  }
}
if (typeof globalThis !== "undefined") {
  globalThis._captureInitialWispsFromForm = _captureInitialWispsFromForm;
}

function openGradientConversation(){
  var ov = g("trip-brief-overlay");
  ov.style.cssText = "position:fixed;inset:0;background:var(--c-panel);z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch;";
  ov.innerHTML = '<div class="tb-header">'
    +'<div class="tb-logo"><div class="tb-logo-m">M</div><div><div style="font-size:12px;font-weight:700;">Max</div><div class="tb-step">Before we find places</div></div></div>'
    +'<div class="tb-title">Let\u2019s find the right distance</div>'
    +'<div class="tb-sub">You said you need something different. Before Max gathers candidates, it needs to understand what different means for you right now.</div>'
    +'</div>'
    +'<div class="tb-body">'
    +'<div class="tb-field"><label>What does your everyday life feel like right now?</label>'
    +'<textarea id="gc-current" rows="2" placeholder="e.g. Loud, busy, cold, routine. Too many obligations, not enough space to think."></textarea></div>'
    +'<div class="tb-field"><label>What quality of experience would feel like relief?</label>'
    +'<textarea id="gc-relief" rows="2" placeholder="e.g. Quiet. Warm. Simple enough that I don\u2019t have to manage anything. Real, not a resort."></textarea></div>'
    +'<div class="tb-field"><label>How far do you want to go from the familiar?</label>'
    +'<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">'
    +'<span class="tb-toggle'+(_tb.gcDistance==="near"?" on":"")+ '" onclick="_tb.gcDistance=\'near\'  ;document.querySelectorAll(\'#gc-distance-row .tb-toggle\').forEach(function(e){e.classList.remove(\'on\')});this.classList.add(\'on\')">Noticeably different, still familiar</span>'
    +'<span class="tb-toggle'+(_tb.gcDistance==="mid" ?" on":"")+ '" onclick="_tb.gcDistance=\'mid\'   ;document.querySelectorAll(\'#gc-distance-row .tb-toggle\').forEach(function(e){e.classList.remove(\'on\')});this.classList.add(\'on\')">Genuinely foreign but navigable</span>'
    +'<span class="tb-toggle'+(_tb.gcDistance==="far" ?" on":"")+ '" onclick="_tb.gcDistance=\'far\'   ;document.querySelectorAll(\'#gc-distance-row .tb-toggle\').forEach(function(e){e.classList.remove(\'on\')});this.classList.add(\'on\')">As different as possible</span>'
    +'</div></div>'
    +'</div>'
    +'<div class="tb-footer">'
    +'<button class="tb-btn-primary" onclick="submitGradientConversation()">Find places at the right distance \u2192</button>'
    +'<div class="tb-btn-back" style="margin-top:8px;" onclick="renderTripStep1()">\u2190 Back</div>'
    +'</div>';
}

async function submitGradientConversation(){
  var current  = g("gc-current") ? g("gc-current").value.trim() : "";
  var relief   = g("gc-relief")  ? g("gc-relief").value.trim()  : "";
  var distance = _tb.gcDistance || "mid";

  // Build the gradient summary Max will use
  _tb.gradient = [
    current  ? "Current life: " + current : "",
    relief   ? "Looking for: " + relief   : "",
    "Distance from familiar: " + {near:"noticeably different but still navigable",mid:"genuinely foreign but manageable",far:"as different as possible"}[distance]
  ].filter(Boolean).join(". ");

  // PD.309: route through the orchestrator. Gradient conversation
  // resolves into sentence-mode candidate-first build.
  if (typeof MaxBuild !== "undefined" && MaxBuild && typeof MaxBuild.findCandidates === "function") {
    MaxBuild.findCandidates({
      mode:     "candidate-first",
      region:   _tb.region || "",
      sentence: _tb.intent || "",
      anchors:  _tb.anchors || "",
      tripMode: "sentence"
    }).catch(function(err){
      console.warn("[Max] submitGradientConversation: MaxBuild failed:", err && err.message);
    });
  }
}
function toggleTag(el){
  el.classList.toggle("on");
  var tag=el.dataset.tag;
  var idx=_tb.interests.indexOf(tag);
  if(idx>-1) _tb.interests.splice(idx,1); else _tb.interests.push(tag);
}

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._briefPersonalContext = _briefPersonalContext;
  __expg._captureInitialWispsFromForm = _captureInitialWispsFromForm;
  __expg._legacyRenderTripBrief = _legacyRenderTripBrief;
  __expg._tbAvoidFieldHtml = _tbAvoidFieldHtml;
  __expg._tbAvoidSummary = _tbAvoidSummary;
  __expg._tbCaptureAvoid = _tbCaptureAvoid;
  __expg._tbCaptureDates = _tbCaptureDates;
  __expg._tbCaptureParty = _tbCaptureParty;
  __expg._tbDatesFieldHtml = _tbDatesFieldHtml;
  __expg._tbEntryExitFieldsHtml = _tbEntryExitFieldsHtml;
  __expg._tbEntryExitModesOnlyHtml = _tbEntryExitModesOnlyHtml;
  __expg._tbEntryExitSummary = _tbEntryExitSummary;
  __expg._tbFormatYMD = _tbFormatYMD;
  __expg._tbHydrateDates = _tbHydrateDates;
  __expg._tbModePillsHtml = _tbModePillsHtml;
  __expg._tbOnDateChange = _tbOnDateChange;
  __expg._tbParseYMD = _tbParseYMD;
  __expg._tbPartyFieldHtml = _tbPartyFieldHtml;
  __expg._tbPartySummary = _tbPartySummary;
  __expg._tbPickAbility = _tbPickAbility;
  __expg._tbPickMode = _tbPickMode;
  __expg._tbPickPartyComp = _tbPickPartyComp;
  __expg._tbRecalcDates = _tbRecalcDates;
  __expg._tbSectionHead = _tbSectionHead;
  __expg._tbSetDateMode = _tbSetDateMode;
  __expg._tbSetFixed = _tbSetFixed;
  __expg._tbToggleAvoid = _tbToggleAvoid;
  __expg._tbToggleStep2ModePopover = _tbToggleStep2ModePopover;
  __expg._tbTransportModes = _tbTransportModes;
  __expg.goToTripStep2 = goToTripStep2;
  __expg.openGradientConversation = openGradientConversation;
  __expg.renderTripBrief = renderTripBrief;
  __expg.renderTripStep2 = renderTripStep2;
  __expg.saveStep2AndProceed = saveStep2AndProceed;
  __expg.submitGradientConversation = submitGradientConversation;
  __expg.toggleSentence = toggleSentence;
  __expg.toggleTag = toggleTag;
}
