// @ts-check
import MaxDB from "./db.mjs";
// logistics.js — Logistics screen (arrival/departure, ground transport, car rentals)
// + resequencing trigger. Extracted from index.html (PD.455).

// ── LOGISTICS SCREEN ──────────────────────────────────────
var _logRentals = [];
var _logRentalCtr = 0;

function showLogisticsScreen() {
  // Retired. Transport info now lives on Step 2 of the trip brief.
  // If an existing trip still calls this, send the user to Constraints instead.
  if (typeof editConstraints === "function") editConstraints();
}


function toggleSameDep(cb) {
  var depFields = document.getElementById("log-dep-fields");
  if (depFields) depFields.style.display = cb.checked ? "none" : "block";
}

function setTransport(mode) {
  ["rail","car","mix"].forEach(function(m){
    var el = document.getElementById("log-t-" + m);
    if (el) el.className = "log-transport-opt" + (m === mode ? " on" : "");
  });
  var rentalSection = document.getElementById("log-rental-section");
  if (rentalSection) rentalSection.style.display = (mode === "car" || mode === "mix") ? "block" : "none";
  if ((mode === "car" || mode === "mix") && _logRentals.length === 0) addRental();
}

function addRental() {
  _logRentalCtr++;
  var id = "r" + _logRentalCtr;
  var tripStart = (trip && trip.destinations && trip.destinations[0]) ? trip.destinations[0].dateFrom : "";
  var tripEnd = (trip && trip.destinations && trip.destinations.length) ? trip.destinations[trip.destinations.length-1].dateTo : "";
  _logRentals.push({ id: id });
  renderRentals();
}

function removeRental(id) {
  _logRentals = _logRentals.filter(function(r){ return r.id !== id; });
  renderRentals();
}

function renderRentals() {
  var container = document.getElementById("log-rentals");
  if (!container) return;
  var tripStart = (trip && trip.destinations && trip.destinations[0]) ? trip.destinations[0].dateFrom : "";
  var tripEnd = (trip && trip.destinations && trip.destinations.length) ? trip.destinations[trip.destinations.length-1].dateTo : "";
  container.innerHTML = _logRentals.map(function(r, i) {
    var label = _logRentals.length > 1 ? "Rental " + (i+1) : "Car rental";
    return '<div class="log-car-rental" id="log-rental-' + r.id + '">'
      + '<div class="log-car-rental-hdr"><div class="log-car-rental-title">' + label + '</div>'
      + (_logRentals.length > 1 ? '<span class="log-car-remove" onclick="removeRental(\'' + r.id + '\')">Remove</span>' : '')
      + '</div>'
      + '<div class="log-row">'
      + '<div class="log-field"><label>Pick-up location</label><input id="log-r-pickup-' + r.id + '" placeholder="e.g. Keflavík Airport" /></div>'
      + '<div class="log-field"><label>Pick-up date</label><input id="log-r-from-' + r.id + '" type="date" value="' + tripStart + '" /></div>'
      + '</div>'
      + '<div class="log-row">'
      + '<div class="log-field"><label>Return location</label><input id="log-r-return-' + r.id + '" placeholder="Same as pick-up" /></div>'
      + '<div class="log-field"><label>Return date</label><input id="log-r-to-' + r.id + '" type="date" value="' + tripEnd + '" /></div>'
      + '</div>'
      + '<div class="log-row">'
      + '<div class="log-field"><label>Car type</label>'
      + '<select id="log-r-type-' + r.id + '">'
      + '<option value="">Any</option>'
      + '<option value="economy">Economy</option>'
      + '<option value="compact">Compact</option>'
      + '<option value="suv">SUV</option>'
      + '<option value="4wd">4WD / Off-road (Iceland F-roads)</option>'
      + '<option value="camper">Campervan</option>'
      + '</select></div>'
      + '<div class="log-field"><label>Company (optional)</label><input id="log-r-co-' + r.id + '" placeholder="e.g. Hertz" /></div>'
      + '</div>'
      + '</div>';
  }).join("");
}

function saveLogistics() {
  var arrCity = (document.getElementById("log-arr-city")||{}).value||"";
  var arrDate = (document.getElementById("log-arr-date")||{}).value||"";
  var sameDep = document.getElementById("log-same-dep");
  var sameChecked = sameDep ? sameDep.checked : true;
  var depCity = sameChecked ? arrCity : ((document.getElementById("log-dep-city")||{}).value||"");
  var depDate = sameChecked ? "" : ((document.getElementById("log-dep-date")||{}).value||"");

  // Get transport mode
  var transport = "rail";
  if (document.getElementById("log-t-car") && document.getElementById("log-t-car").classList.contains("on")) transport = "car";
  else if (document.getElementById("log-t-mix") && document.getElementById("log-t-mix").classList.contains("on")) transport = "mix";

  // Collect car rentals
  var rentals = _logRentals.map(function(r) {
    return {
      id: r.id,
      pickupLocation: (document.getElementById("log-r-pickup-" + r.id)||{}).value||"",
      pickupDate: (document.getElementById("log-r-from-" + r.id)||{}).value||"",
      returnLocation: (document.getElementById("log-r-return-" + r.id)||{}).value||"",
      returnDate: (document.getElementById("log-r-to-" + r.id)||{}).value||"",
      carType: (document.getElementById("log-r-type-" + r.id)||{}).value||"",
      company: (document.getElementById("log-r-co-" + r.id)||{}).value||""
    };
  });

  trip.logistics = {
    arrival: { city: arrCity, date: arrDate },
    departure: { city: depCity, date: depDate },
    groundTransport: transport,
    carRentals: rentals
  };

  autoSave();
  var ov = document.getElementById("log-overlay");
  if (ov) ov.remove();
  // Resequence destinations based on train routes + arrival/departure
  if (trip.destinations && trip.destinations.length > 1) {
    resequenceTrip();
  } else {
    _emitTripMutation();
  }
  showLogisticsConfirmation();
}

function skipLogistics() {
  var ov = document.getElementById("log-overlay");
  if (ov) ov.remove();
  _emitTripMutation();
}

function showLogisticsConfirmation() {
  // Show a brief confirmation note in the trip list
  var lpc = g("lp-content");
  if (!lpc) return;
  var b = document.createElement("div");
  b.style.cssText = "background:#f0faf4;border:1px solid #b8e0c8;border-radius:7px;padding:10px 13px;margin-bottom:10px;font-size:11px;line-height:1.6;";
  var log = trip.logistics;
  var lines = [];
  if (log.arrival && log.arrival.city) lines.push("\u2708 Flying into " + log.arrival.city + (log.arrival.date ? " on " + log.arrival.date : ""));
  if (log.departure && log.departure.city && log.departure.city !== log.arrival.city) lines.push("\u2708 Flying out of " + log.departure.city);
  if (log.groundTransport === "car") lines.push("\uD83D\uDE97 Getting around by rental car");
  else if (log.groundTransport === "mix") lines.push("\uD83D\uDE97 Mix of train and rental car");
  else lines.push("\uD83D\uDE86 Getting around by train");
  if (log.carRentals && log.carRentals.length) {
    log.carRentals.forEach(function(r) {
      if (r.pickupLocation) lines.push("  Car: " + r.pickupLocation + (r.pickupDate ? " " + r.pickupDate : "") + " \u2192 " + (r.returnLocation||"same") + (r.returnDate ? " " + r.returnDate : "") + (r.carType ? " (" + r.carType + ")" : ""));
    });
  }
  b.innerHTML = '<div style="font-weight:700;color:var(--c-see);margin-bottom:4px;">\u2713 Logistics saved</div>'
    + lines.map(function(l){ return '<div>' + l + '</div>'; }).join("")
    + '<div style="color:var(--c-ink-3);font-size:10px;margin-top:5px;">You can edit this anytime from the trip settings.</div>'
    + '<button style="margin-top:5px;font-size:10px;padding:2px 8px;border:1px solid #b8e0c8;border-radius:4px;background:var(--c-bg);color:var(--c-see);cursor:pointer;font-family:inherit;" onclick="this.parentNode.remove()">Dismiss</button>';
  lpc.insertBefore(b, lpc.firstChild);
}


function sequenceDestinations(destinations, mdcItems, logistics) {
  if (!destinations || destinations.length <= 1) return destinations;

  // Step 1: build ordered chain from train routes (_mdcItems)
  // Each route has requiredPlaces in order e.g. [Zermatt, St.Moritz]
  // Chain them: find where each route starts relative to prior route end
  var chain = []; // ordered place names
  var routes = (mdcItems||[]).filter(function(m){ return m.checked && m.type !== "condition"; });

  routes.forEach(function(route) {
    var places = (route.requiredPlaces||[]).map(function(p){ return p.place; });
    if (!chain.length) {
      chain = chain.concat(places);
    } else {
      // Find overlap: last place in chain that appears in this route
      var lastChain = chain[chain.length-1];
      var overlapIdx = places.indexOf(lastChain);
      if (overlapIdx > -1) {
        // Add the places after the overlap
        chain = chain.concat(places.slice(overlapIdx+1));
      } else {
        // No overlap — append after
        chain = chain.concat(places);
      }
    }
  });

  // Step 2: if logistics says arrival city, put it first
  var arrCity = logistics && logistics.arrival && logistics.arrival.city;
  var depCity = logistics && logistics.departure && logistics.departure.city;

  // Step 3: sort destinations to match chain order
  var ordered = [];
  var remaining = destinations.slice();

  // First: arrival city if not in chain
  if (arrCity) {
    var arrDest = remaining.find(function(d){ return d.place.toLowerCase().indexOf(arrCity.toLowerCase()) > -1; });
    // Arrival city may not be a stop — it's a gateway
  }

  // Place chain destinations in order
  chain.forEach(function(placeName) {
    var idx = remaining.findIndex(function(d){
      return d.place.toLowerCase().indexOf(placeName.toLowerCase()) > -1
          || placeName.toLowerCase().indexOf(d.place.toLowerCase()) > -1;
    });
    if (idx > -1) {
      ordered.push(remaining.splice(idx, 1)[0]);
    }
  });

  // PD.448: actually insert the non-chain destinations GEOGRAPHICALLY,
  // as this comment has always promised. Previously it just concat'd them
  // onto the end — so a highland sight added via Discovery (Ljótipollur,
  // right next to Sigöldugljúfur at #8) landed at #46 beside the airport
  // instead of #9 beside its neighbour. Cheapest-insertion heuristic: drop
  // each stray stop into the ordered chain at the edge where it adds the
  // least driving detour (dist(prev,new)+dist(new,next)-dist(prev,next)).
  // Never insert before the first stop (the arrival anchor); the departure
  // city is re-pinned to the end by Step 4 below. Stops with no usable
  // coords fall back to append, preserving the old behaviour for them.
  function _seqKm(a, b){
    if (!a || !b) return Infinity;
    if (typeof a.lat !== "number" || typeof a.lng !== "number"
     || typeof b.lat !== "number" || typeof b.lng !== "number") return Infinity;
    if (typeof MaxEngineTrip !== "undefined" && typeof MaxEngineTrip.haversineKm === "function") {
      return MaxEngineTrip.haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
    return Infinity;
  }
  remaining.forEach(function(d){
    if (!ordered.length || typeof d.lat !== "number" || typeof d.lng !== "number") {
      ordered.push(d); return;
    }
    var bestPos = ordered.length, bestCost = Infinity;
    // Candidate gaps: after the arrival anchor (i=1) through the end.
    for (var i = 1; i <= ordered.length; i++) {
      var prev = ordered[i-1];
      var next = (i < ordered.length) ? ordered[i] : null;
      var cost = next ? (_seqKm(prev, d) + _seqKm(d, next) - _seqKm(prev, next))
                      : _seqKm(prev, d);
      if (cost < bestCost) { bestCost = cost; bestPos = i; }
    }
    ordered.splice(bestPos, 0, d);
  });

  // Step 4: if departure city is different from arrival, try to end near it
  if (depCity && depCity !== arrCity && ordered.length > 1) {
    var depIdx = ordered.findIndex(function(d){
      return d.place.toLowerCase().indexOf(depCity.toLowerCase()) > -1
          || depCity.toLowerCase().indexOf(d.place.toLowerCase()) > -1;
    });
    if (depIdx > -1 && depIdx !== ordered.length-1) {
      // Move departure-adjacent stop toward end
      var depDest = ordered.splice(depIdx, 1)[0];
      ordered.push(depDest);
    }
  }

  return ordered;
}

function resequenceTrip() {
  if (!trip || !trip.destinations || trip.destinations.length < 2) return;
  var logistics = trip.logistics || {};
  var ordered = sequenceDestinations(trip.destinations, _mdcItems, logistics);
  
  // Reassign dates preserving night counts
  var startDate = logistics.arrival && logistics.arrival.date
    ? new Date(logistics.arrival.date + "T12:00:00")
    : new Date(trip.destinations[0].dateFrom + "T12:00:00");

  var cur = new Date(startDate);
  ordered.forEach(function(dest) {
    // PD.448: preserve a real 0. `dest.nights || 3` turned every 0-night
    // SEE/sight into a 3-night stay on re-sequence — catastrophic on a
    // sight-heavy trip (one resequence and 30 sights each claim 3 nights).
    // Only default to 3 when nights is genuinely absent.
    var nights = (typeof dest.nights === "number") ? dest.nights : 3;
    dest.dateFrom = cur.toISOString().slice(0,10);
    cur.setDate(cur.getDate() + nights);
    dest.dateTo = cur.toISOString().slice(0,10);
    // Rebuild days for new dates
    dest.days = makeDays(dest.id, dest.place, dest.intent, dest.dateFrom, nights);
  });

  trip.destinations = ordered;
  // TM.4 (v328): autoSave + drawTripMode + updateMainMap → emit. The
  // listener routes to the right renderer based on _leftMode and the
  // mapDataChange emit refreshes the map. Same effect, no inline coupling.
  _emitTripMutation();
}

function showTripBrief(){
  var name=g("ntp-name").value.trim(); if(name.length<2) return;
  // Round DK.1: place-mode is the only entry path. Sentence-mode was
  // deleted in TM.6 (v330).
  // exitBuffer defaults to true — buffer night before flying home is
  // the safer pattern, opt-out via checkbox on the picker.
  // Round GA: default both buffer toggles OFF. The auto-create
  // approach (separate _entryStop / _exitStop destination cards)
  // proved clunky in real planning — Neal: "having Reykjavik as
  // two cards is really clunky. It makes it a chore to book a
  // hotel for the whole time." Buffers are now opt-in via the
  // per-card "+ Add arrival/departure buffer" buttons that live on
  // the first/last destination cards in the trip view.
  _tb={name:name,interests:[],drivers:[],tripMode:"place",entryBuffer:false,exitBuffer:false};
  hideNewTripForm();
  var ov=g("trip-brief-overlay");
  ov.style.display="block";
  renderTripStep1Place();
}


// Round DK.1: dispatcher kept as a stable callable name (HTML onclick
// callers reference it). Sentence-mode branch deleted in TM.6 (v330).
function renderTripStep1(){
  return renderTripStep1Place();
}

// v359.8: wire up the four Settings-backed Shape fields on the brief
// with Default/Override badges + "Apply to defaults" promote links.
//   • If MaxDB.prefs has no value for a key → badge hidden, no promote
//     (no default exists to override against; the value will become
//     the default on first publish, see goToTripStep2)
//   • Current matches saved default → grey "Default · X" pill
//   • Current differs from saved default → blue "Override · X (default Y)"
//     pill plus a visible "↑ Apply to defaults" link
// Called via setTimeout after renderTripStep1Place sets innerHTML so
// the badge nodes exist in the DOM by the time we attach handlers.
function _tbSetupShapeBadges(){
  var BADGE_DEFAULT = "display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#eee;color:#888;text-transform:none;letter-spacing:.02em;";
  var BADGE_OVERRIDE = "display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#e8f1fb;color:#1a5fa8;text-transform:none;letter-spacing:.02em;";
  var PROMOTE_LINK = "font-size:10.5px;font-weight:600;color:#1a5fa8;text-decoration:none;cursor:pointer;display:inline-block;";

  function readPref(key){
    try {
      if (!window.MaxDB || !MaxDB.prefs) return null;
      var v = MaxDB.prefs.get(key);
      return (v == null || v === "") ? null : v;
    } catch(_) { return null; }
  }

  function setupNumberField(inputId, badgeId, promoteId, prefKey, unit, fallback){
    var input = document.getElementById(inputId);
    var badge = document.getElementById(badgeId);
    var promote = document.getElementById(promoteId);
    if (!input || !badge) return;
    function fmt(v){ return v + (unit ? " " + unit : ""); }
    function update(){
      // v359.12.3 (reverts v359.8.1): only show a badge when there's
      // an ACTUAL saved default. Showing a badge for the hardcoded
      // fallback made it look like the user had saved a default they
      // hadn't — confusing after Reset. First-trip flow: field shows
      // input only, no badge. After submit the auto-save fires and
      // the pref is saved, so the badge appears on subsequent renders.
      var pref = readPref(prefKey);
      var cur = input.value;
      if (pref == null) {
        badge.style.cssText = "display:none;";
        if (promote) promote.style.display = "none";
        return;
      }
      if (String(cur) === String(pref)) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Default · " + fmt(cur);
        if (promote) promote.style.display = "none";
      } else {
        badge.style.cssText = BADGE_OVERRIDE;
        badge.textContent = "Override · " + fmt(cur) + " (default " + fmt(pref) + ")";
        if (promote) promote.style.cssText = PROMOTE_LINK;
      }
    }
    input.addEventListener("input", update);
    if (promote) {
      promote.onclick = function(e){
        e.preventDefault();
        try { if (window.MaxDB && MaxDB.prefs) MaxDB.prefs.set(prefKey, input.value); } catch(_){}
        update();
      };
    }
    update();
  }

  function setupRadioField(name, badgeId, promoteId, prefKey, labelMap, fallback){
    var radios = document.querySelectorAll('input[name="' + name + '"]');
    var badge = document.getElementById(badgeId);
    var promote = document.getElementById(promoteId);
    if (!radios.length || !badge) return;
    function readCurrent(){
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) return radios[i].value;
      }
      return null;
    }
    function update(){
      // v359.12.3: same reversal as setupNumberField — no badge when
      // no pref is saved.
      var pref = readPref(prefKey);
      var cur = readCurrent();
      if (pref == null) {
        badge.style.cssText = "display:none;";
        if (promote) promote.style.display = "none";
        return;
      }
      if (String(cur) === String(pref)) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Default · " + (labelMap[cur] || cur);
        if (promote) promote.style.display = "none";
      } else {
        badge.style.cssText = BADGE_OVERRIDE;
        badge.textContent = "Override · " + (labelMap[cur] || cur) + " (default " + (labelMap[pref] || pref) + ")";
        if (promote) promote.style.cssText = PROMOTE_LINK;
      }
    }
    radios.forEach(function(rb){ rb.addEventListener("change", update); });
    if (promote) {
      promote.onclick = function(e){
        e.preventDefault();
        var cur = readCurrent();
        try { if (window.MaxDB && MaxDB.prefs && cur) MaxDB.prefs.set(prefKey, cur); } catch(_){}
        update();
      };
    }
    update();
  }

  // Pass the hardcoded fallback as the last arg so the badge can
  // compare against it when no pref has been saved yet.
  // v359.9: text-field setup. Free-text inputs (transport, accommodation)
  // can't show their full value in a 10-line badge so we use a truncated
  // form: "Override (default 'short text…')". The full input shows the
  // user's typed value as usual.
  function setupTextField(inputId, badgeId, promoteId, prefKey){
    var input = document.getElementById(inputId);
    var badge = document.getElementById(badgeId);
    var promote = document.getElementById(promoteId);
    if (!input || !badge) return;
    function effectiveDefault(){
      var pref = readPref(prefKey);
      return (pref != null && pref !== "") ? pref : null;
    }
    function trunc(s){
      s = String(s || "");
      return s.length > 36 ? s.substring(0, 33) + "…" : s;
    }
    function update(){
      var def = effectiveDefault();
      var cur = (input.value || "").trim();
      // No saved default AND no typed value → nothing to show.
      if (!def && !cur) { badge.style.cssText = "display:none;"; if (promote) promote.style.display = "none"; return; }
      // Typed value present but no saved default → offer "Save as default."
      if (!def && cur) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Not saved as default";
        if (promote) { promote.style.cssText = PROMOTE_LINK; promote.textContent = "↑ Save as default"; }
        return;
      }
      if (cur === def) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Default";
        if (promote) promote.style.display = "none";
      } else {
        badge.style.cssText = BADGE_OVERRIDE;
        badge.textContent = "Override (default: " + trunc(def) + ")";
        if (promote) { promote.style.cssText = PROMOTE_LINK; promote.textContent = "↑ Apply to defaults"; }
      }
    }
    input.addEventListener("input", update);
    if (promote) {
      promote.onclick = function(e){
        e.preventDefault();
        try { if (window.MaxDB && MaxDB.prefs) MaxDB.prefs.set(prefKey, (input.value||"").trim()); } catch(_){}
        update();
      };
    }
    update();
  }

  // v359.9: checkbox setup. Compares boolean state to the saved pref.
  // Used by the with-kids checkbox alongside the travelersCount number
  // (their badge is shared at "tb-trav-badge").
  function setupCompoundTravelers(){
    var inp = document.getElementById("tb-travelers-count");
    var chk = document.getElementById("tb-with-kids");
    var badge = document.getElementById("tb-trav-badge");
    var promote = document.getElementById("tb-trav-promote");
    if (!inp || !chk || !badge) return;
    function effectiveDefaults(){
      var n = readPref("travelersCount");
      n = (n != null) ? parseInt(n, 10) : 2;
      if (!isFinite(n) || n < 1 || n > 40) n = 2;
      var k = readPref("withKids");
      k = (k === true || k === "true" || k === 1 || k === "1");
      return { count: n, kids: k };
    }
    function update(){
      var def = effectiveDefaults();
      var cur = { count: parseInt(inp.value, 10), kids: !!chk.checked };
      var sameC = cur.count === def.count;
      var sameK = cur.kids === def.kids;
      if (sameC && sameK) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Default · " + def.count + (def.kids ? ", with kids" : "");
        if (promote) promote.style.display = "none";
      } else {
        var defLabel = def.count + (def.kids ? ", with kids" : "");
        var curLabel = cur.count + (cur.kids ? ", with kids" : "");
        badge.style.cssText = BADGE_OVERRIDE;
        badge.textContent = "Override · " + curLabel + " (default " + defLabel + ")";
        if (promote) promote.style.cssText = PROMOTE_LINK;
      }
    }
    inp.addEventListener("input", update);
    chk.addEventListener("change", update);
    if (promote) {
      promote.onclick = function(e){
        e.preventDefault();
        var n = parseInt(inp.value, 10);
        if (!isFinite(n) || n < 1 || n > 40) n = 2;
        try {
          if (window.MaxDB && MaxDB.prefs) {
            MaxDB.prefs.set("travelersCount", n);
            MaxDB.prefs.set("withKids", !!chk.checked);
          }
        } catch(_){}
        update();
      };
    }
    update();
  }

  // v359.10: mobility chips setup — same Default/Override pattern but
  // driven by chip clicks (which update _tb.physicalAbility via
  // _tbPickAbility) rather than input/change events.
  function setupMobilityChips(){
    var chips = document.querySelectorAll('[data-ability-id]');
    var badge = document.getElementById("tb-mob-badge");
    var promote = document.getElementById("tb-mob-promote");
    if (!chips.length || !badge) return;
    var labelMap = {fit:"Fit and active", moderate:"Moderate", limited:"Limited walking", elderly:"Elderly", mobility:"Mobility aid", other:"Other"};
    function readPref(){
      try {
        if (!window.MaxDB || !MaxDB.prefs) return null;
        var v = MaxDB.prefs.get("mobility");
        return (v == null || v === "") ? null : v;
      } catch(_) { return null; }
    }
    function readCurrent(){
      // _tb.physicalAbility is the source of truth — _tbPickAbility
      // writes there. Fall back to looking for the .on chip.
      if (typeof _tb !== "undefined" && _tb && _tb.physicalAbility) return _tb.physicalAbility;
      var onChip = document.querySelector('[data-ability-id].on');
      return onChip ? onChip.getAttribute("data-ability-id") : "";
    }
    function update(){
      var pref = readPref();
      var cur = readCurrent();
      if (!pref && !cur) { badge.style.cssText = "display:none;"; if (promote) promote.style.display = "none"; return; }
      if (!pref && cur) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Not saved as default";
        if (promote) { promote.style.cssText = PROMOTE_LINK; promote.textContent = "↑ Save as default"; }
        return;
      }
      if (cur === pref) {
        badge.style.cssText = BADGE_DEFAULT;
        badge.textContent = "Default · " + (labelMap[cur] || cur);
        if (promote) promote.style.display = "none";
      } else {
        badge.style.cssText = BADGE_OVERRIDE;
        badge.textContent = "Override · " + (labelMap[cur] || cur || "(none)") + " (default " + (labelMap[pref] || pref) + ")";
        if (promote) { promote.style.cssText = PROMOTE_LINK; promote.textContent = "↑ Apply to defaults"; }
      }
    }
    // Hook chip clicks. The existing inline onclick already calls
    // _tbPickAbility which updates _tb.physicalAbility AND re-renders
    // the brief. Since re-render rebuilds the chips fresh, the badge
    // wires up again via _tbSetupShapeBadges → setupMobilityChips →
    // update(). For the user-initiated click during normal flow,
    // attach a delayed update too.
    chips.forEach(function(c){
      c.addEventListener("click", function(){ setTimeout(update, 0); });
    });
    if (promote) {
      promote.onclick = function(e){
        e.preventDefault();
        var cur = readCurrent();
        try { if (window.MaxDB && MaxDB.prefs && cur) MaxDB.prefs.set("mobility", cur); } catch(_){}
        update();
      };
    }
    update();
  }

  setupNumberField("tb-hours-per-day", "tb-hpd-badge", "tb-hpd-promote", "paceHours", "hrs", 6);
  setupNumberField("tb-max-big-sights", "tb-spd-badge", "tb-spd-promote", "sightsPerDay", "", 2);
  setupRadioField("tb-pace-mode", "tb-pace-badge", "tb-pace-promote", "paceMode", {loose:"Relaxed", enough:"Balanced", notmuch:"Intense"}, "enough");
  setupNumberField("tb-day-trip-hours", "tb-dth-badge", "tb-dth-promote", "dayTripHours", "hrs", 3);
  setupCompoundTravelers();
  // v360.4: transport is per-trip — no default/badge/promote plumbing.
  // setupTextField call removed; the badge + promote elements no
  // longer exist in the rendered HTML.
  setupTextField("tb-accommodation", "tb-accom-badge", "tb-accom-promote", "accommodation");
  setupMobilityChips();
}

// Place-first flow (Stage C). User names a place; Max surfaces what's there;
// user picks what's must-do vs skip. The picked items populate _mdcItems so
// Step 2 → candidate search can run without a second LLM regen.

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._logRentalCtr = _logRentalCtr;
  __expg._logRentals = _logRentals;
  __expg._tbSetupShapeBadges = _tbSetupShapeBadges;
  __expg.addRental = addRental;
  __expg.removeRental = removeRental;
  __expg.renderRentals = renderRentals;
  __expg.renderTripStep1 = renderTripStep1;
  __expg.resequenceTrip = resequenceTrip;
  __expg.saveLogistics = saveLogistics;
  __expg.sequenceDestinations = sequenceDestinations;
  __expg.setTransport = setTransport;
  __expg.showLogisticsConfirmation = showLogisticsConfirmation;
  __expg.showLogisticsScreen = showLogisticsScreen;
  __expg.showTripBrief = showTripBrief;
  __expg.skipLogistics = skipLogistics;
  __expg.toggleSameDep = toggleSameDep;
}
