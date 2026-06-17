// @ts-check
// discovery-curation.js — Discovery curation persistence. Extracted verbatim from index.html (PD.473, bloat reduction).

// ── PD.334: Discovery curation is REAL DATA — save it like data ────
// The save/load trace (SAVE-LOAD-MODEL doc) found that keep/reject
// flips, role changes, and stay toggles mutated _tb in memory and
// called NO persist: nothing reached disk until an LLM completion
// (_initialTripSave) or Choreograph happened to run. Close the tab
// mid-curation → the work was gone. This is the single root cause
// behind "I spent days trying to get you to reliably save a trip."
//
// _persistDiscoveryState(): debounced 600ms (coalesces rapid flips).
// Post-mint, _tb.candidates/_tb.placeActivities ARE trip.candidates/
// trip.placeActivities (PD.303 by-reference bridge), so the mutation
// is already on the trip object — the only missing step was WRITING
// it. Route through TripStore (atomic persist + one tripChange),
// then schedule the server push. Pre-mint (no trip yet) there is
// nothing to write into; the mint itself captures the arrays.
var _pdsTimer = null;
function _persistDiscoveryState(opts){
  // PD.354 / v362: only USER curation marks the picker session dirty — the
  // CTA flips "Back to trip" → "Update my trip". SYSTEM normalizations that
  // run on OPEN (the PD.299 stay-fold, hydration) pass {system:true} to SAVE
  // without flipping the CTA — otherwise just opening Discovery to look reads
  // "Update my trip" when nothing changed. Cleared on reopenPickerForEdit +
  // after a rebuild.
  var _system = !!(opts && opts.system);
  try { if (!_system && typeof _tb !== "undefined" && _tb) _tb._editDirty = true; } catch(_){}
  window._placeSetClean = false; // PD.360: in-place mutation — next render re-reconciles
  if (_pdsTimer) clearTimeout(_pdsTimer);
  _pdsTimer = setTimeout(function(){
    _pdsTimer = null;
    try {
      if (!_currentTripId) return; // pre-mint: no storage slot yet
      if (typeof TripStore !== "undefined"
          && typeof TripStore.isLoaded === "function" && TripStore.isLoaded()
          && typeof TripStore.batch === "function") {
        TripStore.batch(function(){
          if (typeof _tb !== "undefined" && _tb) {
            if (Array.isArray(_tb.candidates))      TripStore.setCandidates(_tb.candidates);
            if (Array.isArray(_tb.placeActivities)) {
              // SSOT Phase 5: canonicalize through the ONE dedup door at the
              // persist chokepoint, so no writer can ratchet the saved set across
              // trip↔discovery round-trips (the historical "55 → 149 → 209"
              // growth). Idempotent + coordinate-aware (MaxDiscovery.sameEntity);
              // mutate IN PLACE to keep the PD.303 by-reference bridge intact.
              try {
                if (typeof MaxData !== "undefined" && typeof MaxData.canonicalizePlaceActivities === "function") {
                  var _canonPA = MaxData.canonicalizePlaceActivities(_tb.placeActivities);
                  if (_canonPA !== _tb.placeActivities) {
                    _tb.placeActivities.length = 0;
                    Array.prototype.push.apply(_tb.placeActivities, _canonPA);
                  }
                }
              } catch (e) { if (typeof console !== "undefined") console.warn("[Max Phase5] canonicalize-on-save failed:", e && e.message); }
              TripStore.setPlaceActivities(_tb.placeActivities);
            }
            // PD.358: curation mutates items IN PLACE, so the
            // reassignment above is often a same-ref no-op (PD.356a).
            // touch() makes the persist explicit and unconditional.
            if (typeof TripStore.touch === "function") TripStore.touch("discovery-curate");
            // PD.371: brief edits RIDE THE CURATION SAVE. Picker
            // brief-field changes used to live only on _tb until
            // publish; now any changed field lands on trip.brief with
            // every save. Empty/false picker values never clobber an
            // existing brief value (half-hydrated _tb must not erase
            // the trip's record); objects are cloned so the brief
            // never holds a frozen reference.
            try {
              if (typeof MaxEnginePicker !== "undefined"
                  && typeof MaxEnginePicker.brief === "function"
                  && typeof TripStore.updateBrief === "function") {
                var _bSnap = MaxEnginePicker.brief();
                var _bCur = (TripStore.trip && TripStore.trip.brief) || {};
                var _bDiff = null;
                Object.keys(_bSnap).forEach(function(k){
                  var v = _bSnap[k];
                  if (v && typeof v === "object") {
                    if (JSON.stringify(v) !== JSON.stringify(_bCur[k])) {
                      (_bDiff = _bDiff || {})[k] = Object.assign({}, v);
                    }
                  } else if (v !== "" && v !== false && v !== _bCur[k]) {
                    (_bDiff = _bDiff || {})[k] = v;
                  }
                });
                if (_bDiff) TripStore.updateBrief(_bDiff);
              }
            } catch(e){ console.warn("[Max PD.371] brief ride-along failed:", e && e.message); }
            // PD.357: learned place aliases ride along with every
            // curation save — renames the LLM taught us survive
            // reloads, so badge/keep/dedupe matching stays exact.
            if (typeof PlaceKey !== "undefined" && PlaceKey.isDirty()
                && TripStore.trip && TripStore.trip.brief) {
              TripStore.trip.brief._placeAliases = PlaceKey.serialize();
              PlaceKey.clearDirty();
            }
          }
        }, "discovery-curate");
      } else if (typeof localSave === "function") {
        localSave();
      }
      if (typeof MaxSync !== "undefined" && MaxSync.isSignedIn && MaxSync.isSignedIn()
          && typeof MaxSync.scheduleSave === "function") {
        MaxSync.scheduleSave();
      }
    } catch (e) {
      console.warn("[Max PD.334] discovery persist failed:", e && e.message);
    }
  }, 600);
}
if (typeof globalThis !== "undefined") globalThis._persistDiscoveryState = _persistDiscoveryState;

// v360.3 (#124 Turn 4B): hydrate committed day-trips and waysides from
// trip.routes[] onto the picker's candidate lookup maps so existing
// commitments show up pre-checked under each destination card on
// picker re-open. Sources are stashed in reopenPickerForEdit and
// keyed by normalized place name; this pass maps them to picker
// candidate ids (which are only assigned after runCandidateSearch).
// Idempotent — guarded by _tb._committedHydrated.
function _hydratePickerFromCommittedSrc() {
  if (!_tb) return;
  var dtSrc = Array.isArray(_tb._committedDaytripsSrc) ? _tb._committedDaytripsSrc : [];
  var wsSrc = Array.isArray(_tb._committedWaysidesSrc) ? _tb._committedWaysidesSrc : [];
  if (!dtSrc.length && !wsSrc.length) return;
  if (_tb._committedHydrated) return;
  if (!Array.isArray(_tb.candidates) || !_tb.candidates.length) return;

  var normFn = (typeof _normPlaceName === "function")
    ? _normPlaceName
    : function(s){ return String(s||"").toLowerCase().trim(); };

  // Index kept hubs by normalized place name (kept = status==="keep" and
  // not already a dayTrip/wayside intent candidate).
  var hubByNorm = {};
  _tb.candidates.forEach(function(c){
    if (!c || c.intent === "dayTrip" || c.intent === "wayside") return;
    if (c.status === "reject") return;
    if (!c.place) return;
    hubByNorm[normFn(c.place)] = c;
  });

  if (!_tb._hubDayTripCandidates) _tb._hubDayTripCandidates = {};
  if (!_tb._legWaysideCandidates) _tb._legWaysideCandidates = {};

  var dtHydrated = 0, wsHydrated = 0;

  // Day-trips: map hubPlaceNorm → picker hub candidate id; populate the
  // hub's day-trip candidate list AND inject intent:dayTrip candidates
  // into _tb.candidates as status="keep" so publishTrip re-commits them.
  dtSrc.forEach(function(src){
    var hubCand = hubByNorm[src.hubPlaceNorm];
    if (!hubCand) return; // hub no longer kept — skip
    var existing = _tb._hubDayTripCandidates[hubCand.id] || [];
    var existingNames = {};
    existing.forEach(function(s){ if (s && s.name) existingNames[normFn(s.name)] = true; });
    var merged = existing.slice();
    src.stops.forEach(function(stop){
      var k = normFn(stop.name);
      if (existingNames[k]) return;
      merged.push(stop);
      existingNames[k] = true;
    });
    _tb._hubDayTripCandidates[hubCand.id] = merged;

    // Inject intent:dayTrip candidates with status="keep" so publishTrip's
    // day-trip-commit pass re-attaches them on the rebuild.
    src.stops.forEach(function(stop){
      var alreadyIn = _tb.candidates.some(function(x){
        return x && x.intent === "dayTrip" && x.dayTripHub === hubCand.id &&
               x.place && stop.name && normFn(x.place) === normFn(stop.name);
      });
      if (alreadyIn) return;
      _tb.candidates.push({
        id: "c-dt-" + Math.random().toString(36).slice(2, 8),
        place: stop.name,
        country: (_tb.region || hubCand.country || ""),
        intent: "dayTrip",
        dayTripHub: hubCand.id,
        lat: stop.lat,
        lng: stop.lng,
        durationHours: stop.durationHours,
        whyItFits: stop.why || "",
        tags: ["picker-daytrip", "committed"],
        nights: 0,
        status: "keep",
        // NC.9.15: this candidate was hydrated from PREVIOUSLY-COMMITTED
        // trip state — the user already chose day-trip on this place
        // (publishTrip wrote it into trip.routes, which is what we're
        // reading from now). Stamp role + _roleTouched so re-opening
        // the picker doesn't make the cascade treat the committed
        // choice as a fresh predictor suggestion that could be
        // overridden.
        role: "daytrip",
        _roleTouched: true
      });
      dtHydrated++;
    });
  });

  // Waysides: map fromPlaceNorm + toPlaceNorm → picker hub-pair leg key.
  wsSrc.forEach(function(src){
    var fromHub = hubByNorm[src.fromPlaceNorm];
    var toHub   = hubByNorm[src.toPlaceNorm];
    if (!fromHub || !toHub) return; // one of the legs' anchors is gone
    var legKey = fromHub.id + "|" + toHub.id;
    var existing = _tb._legWaysideCandidates[legKey] || [];
    var existingNames = {};
    existing.forEach(function(s){ if (s && s.name) existingNames[normFn(s.name)] = true; });
    var merged = existing.slice();
    src.stops.forEach(function(stop){
      var k = normFn(stop.name);
      if (existingNames[k]) return;
      // Stash fromPlace/toPlace on the stop so the checkbox handler in
      // picker-ui.js can build the waysideLeg correctly.
      merged.push(Object.assign({}, stop, { fromPlace: src.fromPlace, toPlace: src.toPlace }));
      existingNames[k] = true;
    });
    _tb._legWaysideCandidates[legKey] = merged;

    // Inject intent:wayside candidates with status="keep".
    src.stops.forEach(function(stop){
      var alreadyIn = _tb.candidates.some(function(x){
        return x && x.intent === "wayside" && x.waysideLeg &&
               x.waysideLeg.fromPlace === src.fromPlace &&
               x.waysideLeg.toPlace   === src.toPlace &&
               x.place && stop.name && normFn(x.place) === normFn(stop.name);
      });
      if (alreadyIn) return;
      _tb.candidates.push({
        id: "c-ws-" + Math.random().toString(36).slice(2, 8),
        place: stop.name,
        country: (_tb.region || ""),
        intent: "wayside",
        waysideLeg: { fromPlace: src.fromPlace, toPlace: src.toPlace },
        lat: stop.lat,
        lng: stop.lng,
        durationHours: stop.durationHours,
        whyItFits: stop.why || "",
        tags: ["picker-wayside", "committed"],
        nights: 0,
        status: "keep",
        // NC.9.15: previously-committed wayside — see day-trip note above.
        role: "onway",
        _roleTouched: true,
        waysideFromHub: (src.fromPlace || "").toLowerCase()
      });
      // P4.4c: the leg also lands in the decision log (the source publish reads).
      if (typeof _recordWaysideLegDecision === "function") {
        _recordWaysideLegDecision(stop.name, src.fromPlace, src.toPlace);
      }
      wsHydrated++;
    });
  });

  _tb._committedHydrated = true;
  if (dtHydrated || wsHydrated) {
    console.log("[Max] _hydratePickerFromCommittedSrc: pre-checked",
      dtHydrated, "committed day-trips +", wsHydrated, "committed waysides");
  }
}

// v360.3 (#124): debounced trigger for picker-side secondary
// discovery. Fires ~3s after the user's last keep/reject toggle if
// at least 2 hubs are kept. Calling re-entry safe via _tb flag.
var _pickerSecondaryDiscoveryTimer = null;
function _schedulePickerSecondaryDiscovery() {
  if (!_tb) return;
  if (_pickerSecondaryDiscoveryTimer) {
    clearTimeout(_pickerSecondaryDiscoveryTimer);
    _pickerSecondaryDiscoveryTimer = null;
  }
  var kept = (_tb.candidates || []).filter(function (c) {
    return c && c.status === "keep" && c.intent !== "dayTrip" && c.intent !== "wayside";
  });
  if (kept.length < 2) return; // need at least 2 hubs for any leg
  _pickerSecondaryDiscoveryTimer = setTimeout(async function () {
    _pickerSecondaryDiscoveryTimer = null;
    if (_tb._pickerSecondaryDiscoveryRunning) return;
    _tb._pickerSecondaryDiscoveryRunning = true;
    try {
      // Run both in parallel — they don't interact (different LLM
      // calls, different stashes). Each is itself idempotent across
      // already-discovered hubs/legs.
      var dayTripsPromise = (typeof runPickerDayTripDiscovery === "function")
        ? runPickerDayTripDiscovery(_tb) : Promise.resolve({ addedHubs: 0, addedItems: 0 });
      var waysidesPromise = (typeof runPickerWaysideDiscovery === "function")
        ? runPickerWaysideDiscovery(_tb) : Promise.resolve({ addedLegs: 0, addedItems: 0 });
      var results = await Promise.all([dayTripsPromise, waysidesPromise]);
      var dt = results[0], ws = results[1];
      if ((dt.addedItems || 0) + (ws.addedItems || 0) > 0) {
        console.log("[picker-discovery] day-trips:", dt.addedItems, "across", dt.addedHubs, "hubs · waysides:", ws.addedItems, "across", ws.addedLegs, "legs");
        // Re-render so the new subsections appear under each
        // candidate card / leg row.
        if (typeof renderCandidateCards === "function" && _tb && _tb.candidates) {
          renderCandidateCards(_tb.candidates);
        }
      }
    } catch (e) {
      console.warn("[picker-discovery] secondary discovery failed:", e);
    } finally {
      _tb._pickerSecondaryDiscoveryRunning = false;
    }
  }, 3000);
}

// Re-order _tb.candidates so rendering reflects the trip sequence Max would
// build right now. Kept items go first in orderKeptCandidates' sequence;
// unset items (not yet decided) follow in their original relative order; then
// rejected items at the end (they render in a collapsed section anyway). Uses
// stable ordering within each group so unrelated moves don't churn the view.
function _tbResequenceCandidates(){
  if (!_tb || !Array.isArray(_tb.candidates) || !_tb.candidates.length) return;
  var all = _tb.candidates;
  // Round HZ (picker hero map, step 3): order the active set —
  // accepted (status === "keep") + unchecked (status === null) — as a
  // single sequence. Both classes are "in the route" the user is
  // shaping, so they share a sequence and both get numbered dots +
  // the polyline drawn through them. Pre-redesign this was kept-only
  // because the route was a kept-only concept; the three-state hero
  // map promotes unchecked candidates to in-route members of the
  // proposal the user is reacting to. Rejected candidates fall out
  // entirely (order = null, no polyline segment). See picker-hero-map.md.
  //
  // v360.3 (#124): intent:dayTrip / intent:wayside candidates are NOT
  // overnight hubs — they're stops attached to hubs (day-trips) or
  // legs (waysides). Exclude them from sequencing so they don't get
  // rendered as sidebar rows, map markers, or polyline waypoints.
  // They still travel on _tb.candidates and survive publishTrip's
  // commit pass; they just don't pretend to be destinations here.
  var active = MaxEnginePicker.activeCandidates(all).filter(function(c){
    return c && c.intent !== "dayTrip" && c.intent !== "wayside";
  });
  var rejected = all.filter(function(c){ return c && c.status === "reject"; });
  var intentAttached = all.filter(function(c){
    return c && (c.intent === "dayTrip" || c.intent === "wayside") && c.status !== "reject";
  });
  var orderedActive = active;
  try {
    var res = orderKeptCandidates(active, _mdcItems||[], _tb.entry||"", _tb.tbExit||"");
    if (res && Array.isArray(res.ordered) && res.ordered.length === active.length) {
      orderedActive = res.ordered;
    }
  } catch(e) { /* fall back to current order */ }
  // Write the explicit `order` field on every active candidate.
  // Rejected and intent-attached get null so _redrawCePolyline +
  // _makeCandidateIcon skip them cleanly. manuallyOrdered is preserved
  // but not yet acted on — that lands in step 4 (drag-reorder).
  orderedActive.forEach(function(c, i){ if (c) c.order = i; });
  rejected.forEach(function(c){ if (c) c.order = null; });
  intentAttached.forEach(function(c){ if (c) c.order = null; });
  _tb.candidates = orderedActive.concat(intentAttached).concat(rejected);
}

function updateCEShortlist(){
  // Pills are retired; this function now just updates the footer counter + Build
  // button disabled state, and refreshes the stay-total line in the summary.
  var kept=MaxEnginePicker.keptCandidates(_tb.candidates);
  var cnt=g("ce-cnt"); if(cnt) cnt.textContent=kept.length+" kept";
  // Only the Apply-changes variant (edit mode) disables on empty keeps;
  // the Close button in the default flow is always clickable.
  var bb=g("ce-build-btn");
  // v359.27: also gate the Create-a-plan button on budget. If the user
  // is over their stated duration here, they need to trim before
  // proceeding. Same firm-budget principle as the place-mode picker.
  var _budgetStatus = null;
  if (MaxEnginePicker && MaxEnginePicker.computeStayTotalSummary && _tb) {
    try {
      var _ss = MaxEnginePicker.computeStayTotalSummary(kept, _tb.duration || '');
      _budgetStatus = _ss && _ss.status;
    } catch(_){}
  }
  if (bb) {
    var disabled = false;
    if (_ceEditMode && kept.length < 1) disabled = true;
    if (_budgetStatus === "over") disabled = true;
    bb.disabled = disabled;
    bb.title = (_budgetStatus === "over")
      ? "Trim picks or extend your dates first — Max won't silently extend your trip."
      : "";
    if (disabled) bb.classList.add("ce-build-btn-disabled");
    else bb.classList.remove("ce-build-btn-disabled");
  }
  renderCEStayTotal(kept);
}

// Parse "3-4 nights" → {min:3, max:4}; "5 nights" → {min:5, max:5}
// Round HX.4: parseNightRange moved to MaxEnginePicker. Thin delegator
// kept for inline call sites.
function _parseNightRange(s){ return MaxEnginePicker.parseNightRange(s); }

// Parse trip duration string — "10-14 days", "2 weeks", "10 days". Returns
// {min,max} in days, or null if unparseable (e.g. "three weeks").
// Round HX.4: parseTripDuration moved to MaxEnginePicker. Thin delegator
// kept for inline call sites.
function _parseTripDuration(s){ return MaxEnginePicker.parseTripDuration(s); }

// Round HX.5: renderCEStayTotal moved to MaxPickerUI.renderCEStayTotal,
// pure logic to MaxEnginePicker.computeStayTotalSummary. The inline
// function is a thin delegator so the existing in-script call sites
// (updateCEShortlist, etc.) keep working unchanged.
function renderCEStayTotal(kept){ return MaxPickerUI.renderCEStayTotal(kept); }

function cancelCandidateExplorer(){
  g("candidate-explorer-overlay").style.display="none";
  g("trip-brief-overlay").style.display="block";
}

function editWhereWhy(){
  g("candidate-explorer-overlay").style.display="none";
  g("trip-brief-overlay").style.display="block";
  renderTripStep1();
}

function editHowYouTravel(){
  g("candidate-explorer-overlay").style.display="none";
  g("trip-brief-overlay").style.display="block";
  renderTripBrief();
}

// ─── COMPARISON ────────────────────────────────────────────
function doCompare(id){
  var cands=_tb.candidates||[];
  var target=cands.find(function(c){return c.id===id;});
  if(!target) return;
  var others=cands.filter(function(c){return c.id!==id&&c.status!=="reject";});
  if(!others.length){
    var tip=document.createElement("div");
    tip.style.cssText="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#333;color:var(--c-on-dark);padding:7px 13px;border-radius:5px;font-size:11px;z-index:9999;pointer-events:none;";
    tip.textContent="Keep at least one other place to compare";
    document.body.appendChild(tip); setTimeout(function(){tip.remove();},2500);
    return;
  }
  if(others.length===1){openCompareModal(target,others[0]);}
  else{openComparePicker(target,others);}
}

function openComparePicker(target,others){
  var ov=document.createElement("div"); ov.className="cmp-overlay"; ov.id="cmp-ov";
  var modal=document.createElement("div"); modal.className="cmp-modal";
  var hdr=document.createElement("div"); hdr.className="cmp-header";
  hdr.innerHTML='<div class="cmp-title">Compare '+target.place+' with\u2026</div><span class="cmp-close">\u00d7</span>';
  hdr.querySelector(".cmp-close").onclick=function(){ov.remove();};
  var body=document.createElement("div"); body.style.cssText="padding:12px;";
  others.forEach(function(o){
    var row=document.createElement("div");
    row.style.cssText="padding:7px 11px;border:1px solid var(--c-border-3);border-radius:5px;margin-bottom:5px;cursor:pointer;font-size:11px;font-weight:600;";
    row.innerHTML=o.place+' <span style="font-weight:400;color:#999;font-size:10px;">'+o.role+'</span>';
    row.onmouseover=function(){this.style.background="#f5f5f5";};
    row.onmouseout=function(){this.style.background="";};
    (function(other){row.onclick=function(){ov.remove();openCompareModal(target,other);};})(o);
    body.appendChild(row);
  });
  modal.appendChild(hdr); modal.appendChild(body);
  ov.appendChild(modal); document.body.appendChild(ov);
  ov.onclick=function(e){if(e.target===ov)ov.remove();};
}

async function openCompareModal(a,b){
  var ov=document.createElement("div"); ov.className="cmp-overlay"; ov.id="cmp-ov";
  var modal=document.createElement("div"); modal.className="cmp-modal";
  function col(c){
    return '<div class="cmp-col"><div class="cmp-col-name">'+c.place+'</div>'
      +'<div class="cmp-row"><div class="cmp-row-label">Role</div><div class="cmp-row-val">'+rIcon(c.role)+' '+c.role+'</div></div>'
      +'<div class="cmp-row"><div class="cmp-row-label">Stay</div><div class="cmp-row-val">'+c.stayRange+'</div></div>'
      +'<div class="cmp-row"><div class="cmp-row-label">Why it fits</div><div class="cmp-row-val">'+c.whyItFits+'</div></div>'
      +'<div class="cmp-row"><div class="cmp-row-label">Tradeoffs</div><div class="cmp-row-val" style="color:var(--c-warn);">'+c.tradeoffs+'</div></div>'
      +'<div class="cmp-row"><div class="cmp-row-label">Tags</div><div class="cmp-row-val">'+(c.tags||[]).join(", ")+'</div></div>'
      +'</div>';
  }
  modal.innerHTML='<div class="cmp-header"><div class="cmp-title">'+a.place+' vs '+b.place+'</div><span class="cmp-close">\u00d7</span></div>'
    +'<div class="cmp-body">'+col(a)+col(b)+'</div>'
    +'<div class="cmp-verdict"><div class="cmp-verdict-text" id="cmp-vt">Asking Max\u2026</div>'
    +'<div class="cmp-verdict-acts">'
    +'<button class="cmp-act" id="cmp-both">Keep both</button>'
    +'<button class="cmp-act primary" id="cmp-a">Keep '+a.place+'</button>'
    +'<button class="cmp-act primary" id="cmp-b">Keep '+b.place+'</button>'
    +'<button class="cmp-act" id="cmp-def">Decide later</button>'
    +'</div></div>';
  ov.appendChild(modal); document.body.appendChild(ov);
  ov.onclick=function(e){if(e.target===ov)ov.remove();};
  modal.querySelector(".cmp-close").onclick=function(){ov.remove();};
  modal.querySelector("#cmp-both").onclick=function(){setCS(a.id,"keep");setCS(b.id,"keep");ov.remove();};
  modal.querySelector("#cmp-a").onclick=function(){setCS(a.id,"keep");setCS(b.id,"reject");ov.remove();};
  modal.querySelector("#cmp-b").onclick=function(){setCS(b.id,"keep");setCS(a.id,"reject");ov.remove();};
  modal.querySelector("#cmp-def").onclick=function(){ov.remove();};
  try{
    var p="Compare two destinations for: "+(_tb.intent||_tb.region||"travel")
      +"\n\n"+a.place+": "+a.whyItFits+" Tradeoffs: "+a.tradeoffs
      +"\n"+b.place+": "+b.whyItFits+" Tradeoffs: "+b.tradeoffs
      +"\n\n2-3 sentences: which better fits this trip and why? Be direct.";
    var verdict=await callMax([{role:"user",content:p}],200);
    var vt=document.getElementById("cmp-vt");
    if(vt) vt.textContent=verdict||"Could not load verdict.";
  }catch(e){
    var vt=document.getElementById("cmp-vt"); if(vt) vt.textContent="Could not load verdict.";
  }
}

// "One more thing" — collects entry/exit/date before actually building the
// trip. Defers logistics to the moment the user has committed to their
// picks, so the Places page can stay about experience and this step can
// stay about how-you-arrive-and-leave.
function showPreBuildModal(){
  var kept = MaxEnginePicker.keptCandidates(_tb.candidates);
  if (!kept.length) return;

  // Suggest defaults from the current kept set
  var defaultEntry = kept[0] && kept[0].place ? kept[0].place : "";
  var defaultExit  = kept[kept.length-1] && kept[kept.length-1].place ? kept[kept.length-1].place : "";
  var defaultDate  = (typeof parseStartDateFromBrief === "function") ? parseStartDateFromBrief(_tb.when||"") : "";

  var ov = document.createElement("div");
  ov.id = "pre-build-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10050;display:flex;align-items:center;justify-content:center;padding:20px;";
  var q = function(s){return (s||"").replace(/"/g,'&quot;');};
  ov.innerHTML =
    '<div style="background:var(--c-bg);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);max-width:520px;width:100%;max-height:90vh;overflow-y:auto;font-family:inherit;">'
    +'<div style="padding:18px 20px 10px;">'
    +'<div style="font-size:14px;font-weight:700;color:var(--c-ink);margin-bottom:4px;">One more thing</div>'
    +'<div style="font-size:11px;color:#666;line-height:1.55;margin-bottom:14px;">Before Max builds your trip, it needs to know how you arrive and how you leave. Booked details help Max respect what you\u2019ve locked in; rough plans are fine too. You can edit any of this later.</div>'

    +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-ink-3);margin-top:6px;margin-bottom:8px;">Getting there</div>'

    +'<div style="margin-bottom:10px;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Arriving into (city or airport)</label>'
    +'<input id="pbm-entry" type="text" value="'+q(_tb.entry || defaultEntry)+'" placeholder="e.g. Zurich or ZRH" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'

    +'<div style="display:flex;gap:8px;margin-bottom:10px;">'
    +'<div style="flex:1;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Arrival date</label>'
    +'<input id="pbm-date" type="date" value="'+defaultDate+'" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'<div style="flex:1;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Arrival time <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="pbm-arrTime" type="time" value="'+q(_tb.arrivalTime||"")+'" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'</div>'

    +'<div style="margin-bottom:10px;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Flight / train number <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="pbm-arrNum" type="text" value="'+q(_tb.arrivalNumber||"")+'" placeholder="e.g. Swiss 38, Eurostar 9137" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'

    +'<div style="display:flex;gap:5px;margin-bottom:18px;">'
    +'<span id="pbm-entry-fixed" class="tb-toggle'+(_tb.entryFixed?' on':'')+'" onclick="_tb.entryFixed=true;document.getElementById(&quot;pbm-entry-fixed&quot;).classList.add(&quot;on&quot;);document.getElementById(&quot;pbm-entry-flex&quot;).classList.remove(&quot;on&quot;);">Booked / fixed</span>'
    +'<span id="pbm-entry-flex" class="tb-toggle'+(!_tb.entryFixed?' on':'')+'" onclick="_tb.entryFixed=false;document.getElementById(&quot;pbm-entry-flex&quot;).classList.add(&quot;on&quot;);document.getElementById(&quot;pbm-entry-fixed&quot;).classList.remove(&quot;on&quot;);">Still flexible</span>'
    +'</div>'

    +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-ink-3);margin-top:6px;margin-bottom:8px;">Getting out</div>'

    +'<div style="margin-bottom:10px;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Leaving from (city or airport)</label>'
    +'<input id="pbm-exit" type="text" value="'+q(_tb.tbExit || defaultExit)+'" placeholder="e.g. Geneva or GVA" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'

    +'<div style="display:flex;gap:8px;margin-bottom:10px;">'
    +'<div style="flex:1;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Departure date <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="pbm-depDate" type="date" value="'+q(_tb.departureDate||"")+'" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'<div style="flex:1;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Departure time <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="pbm-depTime" type="time" value="'+q(_tb.departureTime||"")+'" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'
    +'</div>'

    +'<div style="margin-bottom:10px;">'
    +'<label style="display:block;font-size:11px;font-weight:600;color:#444;margin-bottom:4px;">Flight / train number <span style="font-weight:400;color:var(--c-ink-4);">(optional)</span></label>'
    +'<input id="pbm-depNum" type="text" value="'+q(_tb.departureNumber||"")+'" placeholder="e.g. Swiss 17" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;" />'
    +'</div>'

    +'<div style="display:flex;gap:5px;margin-bottom:10px;">'
    +'<span id="pbm-exit-fixed" class="tb-toggle'+(_tb.exitFixed?' on':'')+'" onclick="_tb.exitFixed=true;document.getElementById(&quot;pbm-exit-fixed&quot;).classList.add(&quot;on&quot;);document.getElementById(&quot;pbm-exit-flex&quot;).classList.remove(&quot;on&quot;);">Booked / fixed</span>'
    +'<span id="pbm-exit-flex" class="tb-toggle'+(!_tb.exitFixed?' on':'')+'" onclick="_tb.exitFixed=false;document.getElementById(&quot;pbm-exit-flex&quot;).classList.add(&quot;on&quot;);document.getElementById(&quot;pbm-exit-fixed&quot;).classList.remove(&quot;on&quot;);">Still flexible</span>'
    +'</div>'

    +'</div>'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 20px 18px;border-top:1px solid var(--c-border-4);">'
    +'<button id="pbm-cancel" style="font-size:11px;font-weight:600;padding:8px 14px;border:1px solid var(--c-border);background:var(--c-bg);color:var(--c-ink-2);border-radius:6px;cursor:pointer;font-family:inherit;">Back</button>'
    +'<button id="pbm-build" style="font-size:11px;font-weight:700;padding:8px 16px;border:1px solid var(--c-border-dark);background:var(--c-primary-top);color:var(--c-on-dark);border-radius:6px;cursor:pointer;font-family:inherit;">Build my trip \u2192</button>'
    +'</div>'
    +'</div>';
  document.body.appendChild(ov);
  setTimeout(function(){var i=document.getElementById("pbm-entry");if(i)i.focus();},30);

  function close(){ ov.remove(); }
  ov.querySelector("#pbm-cancel").onclick = close;
  ov.onclick = function(e){ if(e.target === ov) close(); };
  ov.querySelector("#pbm-build").onclick = function(){
    var entryVal    = (document.getElementById("pbm-entry")   ||{}).value || "";
    var exitVal     = (document.getElementById("pbm-exit")    ||{}).value || "";
    var dateVal     = (document.getElementById("pbm-date")    ||{}).value || "";
    var arrTimeVal  = (document.getElementById("pbm-arrTime") ||{}).value || "";
    var arrNumVal   = (document.getElementById("pbm-arrNum")  ||{}).value || "";
    var depDateVal  = (document.getElementById("pbm-depDate") ||{}).value || "";
    var depTimeVal  = (document.getElementById("pbm-depTime") ||{}).value || "";
    var depNumVal   = (document.getElementById("pbm-depNum")  ||{}).value || "";
    _tb.entry           = entryVal.trim();
    _tb.tbExit          = exitVal.trim();
    _tb.arrivalTime     = arrTimeVal.trim();
    _tb.arrivalNumber   = arrNumVal.trim();
    _tb.departureDate   = depDateVal.trim();
    _tb.departureTime   = depTimeVal.trim();
    _tb.departureNumber = depNumVal.trim();
    // Build a human-readable gettingTo/gettingOut from the structured fields so
    // the rest of the pipeline (brief block, LLM prompts) still has the summary.
    var gtParts = [];
    if (arrNumVal.trim()) gtParts.push(arrNumVal.trim());
    if (arrTimeVal.trim()) gtParts.push("arriving " + arrTimeVal.trim());
    if (entryVal.trim()) gtParts.push("into " + entryVal.trim());
    if (dateVal) gtParts.push("on " + dateVal);
    _tb.gettingTo = gtParts.join(", ");
    var goParts = [];
    if (depNumVal.trim()) goParts.push(depNumVal.trim());
    if (depTimeVal.trim()) goParts.push("departing " + depTimeVal.trim());
    if (exitVal.trim()) goParts.push("from " + exitVal.trim());
    if (depDateVal.trim()) goParts.push("on " + depDateVal.trim());
    _tb.gettingOut = goParts.join(", ");
    if (dateVal) {
      // Seed `when` with the specific date so parseStartDateFromBrief picks it up
      _tb.when = dateVal;
    }
    close();
    buildFromCandidates();
  };
}

// ─── BUILD TRIP FROM CANDIDATES ────────────────────────────
// Round DW: incremental reconcile of trip.destinations.
//
// Given the previous trip.destinations[] and the new ordered candidates
// list, return a new array where:
//   - Unchanged destinations are the SAME JS objects (identity preserved
//     → bookings, day items, locations, etc. survive automatically).
//   - Removed destinations are dropped, and any "booked" hotel /
//     transport bookings are logged as PendingActions for the user to
//     cancel with the provider.
//   - Added destinations are created fresh (same shape as a from-scratch
//     build).
//   - For destinations whose nights changed: nights/days are updated
//     in place; existing day items are clamped onto the new day grid
//     (Round DS-style — items from dropped days dump onto the last
//     surviving day, no de-dup needed since identity preserves uniqueness).
//   - Dates are recomputed from `startDate` for the entire returned
//     sequence.
//
// This eliminates the snapshot/restore cycle from saveActivityPickerEdits
// and Apply Changes — preservation is automatic because unchanged
// destinations were never destroyed in the first place. New state added
// to dest.* survives rebuilds without needing to be added to a snapshot
// list.
// _reconcileDestinations moved to engine-trip.js (Round HO).

// v359.60.10: prior setTimeout-based exports moved to end-of-script
// (v359.60.11) where direct assignment works reliably.

// Round HL.X: buildFromCandidates body lifted into
// MaxEnginePicker.publishTrip() in engine-picker.js. The picker
// engine now owns the full build flow; the inline-script entry
// point delegates so all existing callsites keep working unchanged.
// v359.55: picker no longer gates Choreograph on budget. ALL
// per-destination decisions (nights, role, day-trip / wayside)
// happen in the trip view, which has the reshape banner + the
// destination role popover for those calls. The pre-Choreograph
// modal (v359.54.8) and its earlier inline banner (v359.26) are
// gone; _makeItFit / _extendBudgetToFit / _skipBudgetGate retired.

async function buildFromCandidates(){
  return await MaxEnginePicker.publishTrip();
}


/* #2 Stage 2 interim: expose this module's cross-module bindings as globals
   for other-module/classic consumers. esbuild compiles each .mjs to an isolated
   IIFE, so top-level decls are module-private unless re-exposed; the later
   import-rewiring phase replaces these with real imports. */
globalThis._hydratePickerFromCommittedSrc = _hydratePickerFromCommittedSrc;
globalThis._parseTripDuration = _parseTripDuration;
globalThis._pdsTimer = _pdsTimer;
globalThis._tbResequenceCandidates = _tbResequenceCandidates;
globalThis.updateCEShortlist = updateCEShortlist;

export {};
