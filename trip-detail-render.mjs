// @ts-check
import { _escHtml } from "./util-esc.mjs";
// trip-detail-render.js — Explore pane, Sights section, Day-trips
// section, Later/Maybe bucket builder, Destination-mode renderer, and
// Days-and-sights rendering. Extracted verbatim from index.html
// (PD.453, bloat reduction). Global render functions + a self-contained
// globalThis._renderRestaurantsSection exposure. Loaded after trip-edit.js.

// ── Explore pane ───────────────────────────────────────────
// v359.60.60: shared restaurants renderer — called from the Stay
// & Eat pane builder, used to live inline in buildExplorePane.
// Renders an exp-section block (header + Refresh button + suggestion
// rows) into the given parent. Idempotent: calling Refresh
// re-fetches and re-renders the inner list in place.
function _renderRestaurantsSection(dest, parent) {
  var restSec = document.createElement("div");
  restSec.className = "exp-section";
  restSec.style.borderTop = "1px solid #f0f0f0";
  restSec.style.marginTop = "14px";
  restSec.style.paddingTop = "10px";
  var rHdr = document.createElement("div"); rHdr.className = "exp-section-hdr";
  var rLbl = document.createElement("div"); rLbl.className = "exp-section-lbl"; rLbl.textContent = "Restaurants";
  var rRef = document.createElement("button"); rRef.className = "exp-refresh-btn";
  rRef.textContent = (dest.restaurantSuggestions && dest.restaurantSuggestions.length) ? "Refresh" : "Ask Max";
  (function(d, btn){ rRef.onclick = function(){ refreshRestaurantSuggestions(d, btn); }; })(dest, rRef);
  rHdr.appendChild(rLbl); rHdr.appendChild(rRef);
  restSec.appendChild(rHdr);
  var restInner = document.createElement("div"); restInner.id = "dm-rest-section";
  if (!dest.restaurantSuggestions || dest.restaurantSuggestions.length === 0) {
    var rEmp = document.createElement("div"); rEmp.className = "exp-empty";
    rEmp.textContent = "Restaurant suggestions will appear here.";
    restInner.appendChild(rEmp);
  } else {
    dest.restaurantSuggestions.forEach(function(s){
      restInner.appendChild(mkExploreSuggestion(s, dest, "restaurant"));
    });
  }
  restSec.appendChild(restInner);
  parent.appendChild(restSec);
}
if (typeof globalThis !== "undefined") globalThis._renderRestaurantsSection = _renderRestaurantsSection;

function buildExplorePane(dest){
  if(!dest.suggestions)dest.suggestions=[];
  if(!dest.restaurantSuggestions)dest.restaurantSuggestions=[];
  var wrap=document.createElement("div");

  // ── Sights section ─────────────────────────────────────
  var sightsSec=document.createElement("div"); sightsSec.className="exp-section";
  var sHdr=document.createElement("div"); sHdr.className="exp-section-hdr";
  var sLbl=document.createElement("div"); sLbl.className="exp-section-lbl"; sLbl.textContent="Sights you identified";
  var sRef=document.createElement("button"); sRef.className="exp-refresh-btn"; sRef.textContent="Refresh";
  var genKey=dest.place.toLowerCase();
  var isGen=_generatedCityData[genKey]&&_generatedCityData[genKey].loading;
  if(isGen){sRef.disabled=true;sRef.textContent="generating\u2026";}
  (function(d,btn){sRef.onclick=function(){
    // Re-trigger city generation to refresh suggestions
    delete _generatedCityData[d.place.toLowerCase()];
    generateCityData(d.place,d.id);
    btn.disabled=true;btn.textContent="generating\u2026";
  };})(dest,sRef);
  sHdr.appendChild(sLbl); sHdr.appendChild(sRef); sightsSec.appendChild(sHdr);
  // PD.353: VISIBLE in-section indicator while city data generates.
  // This list populates seconds after the destination opens (Monument,
  // Harpa appeared "out of nowhere"); the only prior signal was the
  // Refresh button quietly reading "generating…". Say it plainly.
  if(isGen){
    var sGenNote=document.createElement("div");
    sGenNote.style.cssText="font-size:11px;color:#7a6294;font-style:italic;margin:2px 0 6px;";
    sGenNote.textContent="\u231b Max is still filling this in \u2014 sights appear here as they\u2019re found.";
    sightsSec.appendChild(sGenNote);
  }

  // Only true sights belong in Explore — essentials (atm/grocery/tourist-info/pharmacy/bank) live in the Practical section under Info
  var sightOnly=dest.suggestions.filter(function(s){return s.type==="sight";});
  // Count sights already auto-seeded onto days so we can tell the user
  // "iconic picks are already on your plan; here are the optional extras."
  var autoOnDays = 0;
  (dest.days||[]).forEach(function(day){
    (day.items||[]).forEach(function(it){ if (it.type === "sight" && it.autoSeeded) autoOnDays++; });
  });
  if(isGen){
    var genMsg=document.createElement("div"); genMsg.className="exp-generating";
    genMsg.textContent="Max is generating suggestions for "+dest.place+"\u2026"; sightsSec.appendChild(genMsg);
  } else if(sightOnly.length===0 && autoOnDays===0){
    // Distinguish "never generated" from "generated and came back empty/failed."
    // The latter usually means the LLM hedged on an unfamiliar place name or
    // hit a token/parse problem \u2014 Round M's retry helps but isn't always enough.
    var gd = _generatedCityData[genKey];
    var msg, btnLbl;
    if (gd && gd.failed) {
      msg = "Couldn\u2019t load sights for " + dest.place + ". Try again?";
      btnLbl = "Retry";
    } else if (gd && !gd.loading && Array.isArray(gd.sights) && gd.sights.length === 0) {
      msg = "Max didn\u2019t find sights for " + dest.place + " \u2014 could be the place name needs disambiguating. Try again?";
      btnLbl = "Retry";
    } else {
      msg = "No suggestions yet for " + dest.place + ".";
      btnLbl = "Generate";
    }
    var emp = document.createElement("div");
    emp.className = "exp-empty";
    emp.style.cssText = "padding:14px 16px;background:var(--c-panel);border:1px solid var(--c-border-3);border-radius:8px;font-size:11px;color:#666;line-height:1.55;display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
    emp.innerHTML = '<span style="flex:1;min-width:0;">' + msg.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</span>';
    var retryBtn = document.createElement("button");
    retryBtn.style.cssText = "background:var(--c-primary);border:none;color:var(--c-on-dark);font-size:11px;font-weight:600;padding:6px 12px;border-radius:5px;cursor:pointer;font-family:inherit;flex-shrink:0;";
    retryBtn.textContent = btnLbl + " \u2192";
    (function(d){
      retryBtn.onclick = function(){
        delete _generatedCityData[d.place.toLowerCase()];
        generateCityData(d.place, d.id);
        retryBtn.disabled = true; retryBtn.textContent = "generating\u2026";
      };
    })(dest);
    emp.appendChild(retryBtn);
    sightsSec.appendChild(emp);
  } else {
    if (autoOnDays > 0) {
      var seedNote = document.createElement("div");
      // v295.2: copy reframed as "placeholders … across the days you
      // will be in {place}" — makes the scaffold framing explicit and
      // points to the itinerary tab as the home for accept/reject/reorder.
      // Warm gold styling sits in the same visual family as the tentative
      // dashed-gold rows in the trip view.
      seedNote.style.cssText = "font-size:11px;color:#7d5e00;background:#fbf6e8;border:1px solid #e6d5a0;border-radius:6px;padding:8px 11px;margin:0 0 8px;line-height:1.55;";
      var _placeForBanner = (dest && dest.place) ? dest.place : "this destination";
      seedNote.innerHTML = "There " + (autoOnDays===1?"is":"are") + " <strong>"+autoOnDays+"</strong> placeholder"+(autoOnDays!==1?"s":"")+" for the iconic sight"+(autoOnDays!==1?"s":"")+" spread across the days you will be in <strong>"+_placeForBanner.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</strong>. You can accept, reject, or move them around in the Schedule tab.";
      sightsSec.appendChild(seedNote);
    }
    // v359.60.59: the "Already on your days" duplicate list used to render
    // here was redundant — the Schedule tab already shows these sights
    // inline on their scheduled day. Removing it keeps Sights & Eats
    // focused on what's NOT yet on the schedule (the browse-and-choose
    // surface, not a status report).
    // v295.2: always render the Optional/Sights header (when we got past
    // the empty/loading branches above). Earlier the header only rendered
    // when sightOnly.length > 0, so when auto-seed pulled the iconic ones
    // AND the LLM happened to come back with few extras, the section
    // disappeared and the user thought "secondary sights" had gone
    // missing. Now the header always shows here, with an empty-state
    // hint when the pool is exhausted.
    var optHdr = document.createElement("div");
    optHdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-ink-3);margin:14px 0 6px;";
    optHdr.textContent = autoOnDays > 0 ? "Optional picks — not on a day yet" : "Sights";
    sightsSec.appendChild(optHdr);
    if (sightOnly.length > 0) {
      // PD.270: split into kept and considered. Considered sights
      // render below a small divider so the user sees them as
      // "still on the radar" rather than mixed in with active picks.
      var keptSights = sightOnly.filter(function(s){ return !s._considered; });
      var consideredSights = sightOnly.filter(function(s){ return s._considered; });
      keptSights.forEach(function(s){
        sightsSec.appendChild(mkExploreSuggestion(s,dest,"sight"));
      });
      if (consideredSights.length) {
        var consHdr = document.createElement("div");
        consHdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#7a6294;margin:16px 0 6px;padding-top:8px;border-top:1px dashed #e2d4f0;";
        consHdr.textContent = "Things you considered";
        sightsSec.appendChild(consHdr);
        var consNote = document.createElement("div");
        consNote.style.cssText = "font-size:10.5px;color:#7a6294;margin:0 0 8px;line-height:1.5;";
        consNote.textContent = "These were not checked in Discovery. Tap Add to day to add one on a day.";
        sightsSec.appendChild(consNote);
        consideredSights.forEach(function(s){
          sightsSec.appendChild(mkExploreSuggestion(s,dest,"sight"));
        });
      }
    } else {
      var noOpt = document.createElement("div");
      noOpt.style.cssText = "font-size:11px;color:var(--c-ink-3);line-height:1.55;padding:8px 10px;background:var(--c-panel);border:1px dashed #e5e5e5;border-radius:6px;";
      noOpt.innerHTML = (autoOnDays > 0 ? "Initially, Max found no additional interesting sights beyond the iconic placeholders. " : "")
        + "Click <strong>Refresh</strong> above to ask Max to dig deeper, or add your own from the day’s itinerary.";
      sightsSec.appendChild(noOpt);
    }
  }
  wrap.appendChild(sightsSec);

  // v359.60.60: restaurants moved from Explore back to the Stay & Eat
  // tab where the label has always promised them. Sights & restaurants
  // are different cognitive surfaces (sights are about activities and
  // optionally schedulable; restaurants are about a meal slot you book
  // separately), and pairing restaurants with hotels matches the
  // "where I'll be at meal time" mental model better than pairing
  // them with day trips. See _renderRestaurantsSection (global).

  // ── v359.60.67: Day trips section ───────────────────────────────
  // Lists existing day-trip routes from this hub (trip.routes[] where
  // subKind==="dayTrip" and fromDestId===dest.id) with day-picker
  // capsules. Was reading legacy dest.dayTrips[] (empty post-migration)
  // so existing day trips never surfaced on the destination card even
  // though they were on the map. Now reads the modern data.
  // The "Other places that could be day trips" peer section below
  // (was "Could be a day trip from here") sits underneath as the same
  // surface for ADDING new day trips from other trip destinations.
  (function _renderExistingDayTripRoutes(){
    var _isDT = (typeof MaxMigration !== "undefined" && MaxMigration.isDayTripRoute)
      ? MaxMigration.isDayTripRoute
      : function(r){ return r && (r.subKind === "dayTrip" || r.kind === "dayTrip"); };
    var hubRoutes = (trip.routes || []).filter(function(r){
      return _isDT(r) && r.fromDestId === dest.id;
    });
    if (!hubRoutes.length) return;

    var dtSec = document.createElement("div");
    dtSec.style.cssText = "margin-top:18px;";
    var dtHdr = document.createElement("div");
    dtHdr.style.cssText = "padding:6px 10px;background:var(--c-tint-purple);border:1px solid #d8c4e8;border-radius:6px;font-size:13px;font-weight:700;color:var(--c-accent);";
    dtHdr.textContent = "Day trips";
    dtSec.appendChild(dtHdr);

    hubRoutes.forEach(function(route){
      var stops = (route.planItems || []).filter(function(pi){ return pi && pi.type === "stop"; });
      if (!stops.length) return;
      var stopNames = stops.map(function(s){
        var p = (trip.places || {})[s.placeId];
        return (p && p.name) || s.placeId || "?";
      });
      var rowSec = document.createElement("div");
      rowSec.style.cssText = "margin:8px 4px;padding:10px 12px;background:var(--c-tint-purple);border:1px solid #e5d8f0;border-radius:7px;";

      var titleLine = document.createElement("div");
      titleLine.style.cssText = "font-size:13px;font-weight:700;color:#222;";
      titleLine.textContent = stopNames.length > 1
        ? stopNames.join(" · ") + " (loop)"
        : stopNames[0];
      rowSec.appendChild(titleLine);

      var scheduledDayId = (route.transitDays && route.transitDays[0]) || null;
      var scheduledIdx = -1;
      (dest.days || []).forEach(function(d, idx){
        if (d && d.id === scheduledDayId) scheduledIdx = idx;
      });

      var subLine = document.createElement("div");
      subLine.style.cssText = "font-size:10.5px;color:#666;margin-top:3px;";
      var schedTxt;
      if (scheduledIdx >= 0) {
        var schedLbl = ((dest.days || [])[scheduledIdx] && dest.days[scheduledIdx].lbl) || ("Day " + (scheduledIdx + 1));
        schedTxt = '<span style="color:var(--c-accent);font-weight:600;">✓ scheduled on ' + schedLbl + '</span>';
      } else {
        schedTxt = '<span style="color:var(--c-warn);font-weight:600;">⚠ not yet scheduled</span>';
      }
      if (route.distKm) {
        schedTxt += ' &nbsp;·&nbsp; ' + (typeof _fmtDistance === "function" ? _fmtDistance(route.distKm) : route.distKm + "km");
      }
      subLine.innerHTML = schedTxt;
      rowSec.appendChild(subLine);

      // Day-picker capsules: click a different day to reschedule.
      var capsules = document.createElement("div");
      capsules.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;";
      var lblEl = document.createElement("span");
      lblEl.style.cssText = "font-size:10.5px;font-weight:600;color:var(--c-accent);";
      lblEl.textContent = scheduledIdx >= 0 ? "Move to:" : "Place on:";
      capsules.appendChild(lblEl);
      (dest.days || []).forEach(function(day, dIdx){
        var btn = document.createElement("button");
        btn.type = "button";
        var isOn = (dIdx === scheduledIdx);
        var dayLbl = day.lbl || ("Day " + (dIdx + 1));
        btn.textContent = (isOn ? "✓ " : "") + dayLbl;
        btn.style.cssText = "font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid "
          + (isOn ? "#5b3f8f" : "#d8c4e8") + ";background:"
          + (isOn ? "#5b3f8f" : "#fff") + ";color:"
          + (isOn ? "#fff" : "#5b3f8f") + ";cursor:"
          + (isOn ? "default" : "pointer") + ";font-family:inherit;";
        if (!isOn) {
          (function(hub, rt, targetDay){
            btn.onclick = function(){
              if (typeof _moveDayTripRouteToDay === "function") {
                _moveDayTripRouteToDay(hub, rt, targetDay);
              }
            };
          })(dest, route, day);
        }
        capsules.appendChild(btn);
      });
      rowSec.appendChild(capsules);

      dtSec.appendChild(rowSec);
    });
    wrap.appendChild(dtSec);
  })();

  // Round FZ.6: Round EV's "Could be a day trip from here" section
  // (one-shot conversion: all of source's nights move to hub, source
  // disappears from trip.destinations) is replaced by FT.2's
  // gradual per-night transfer below — Neal: "shouldn't [Amsterdam]
  // disappear only after all the days are accounted for in day
  // trips?" The mental model is "shrink as you schedule, vanish
  // when there's nothing left to overnight in." makeDayTrip stays
  // defined for the post-build clustering callers (line 19739) but
  // is no longer surfaced in the Explore tab.

  // Round FN.8.14: DAY TRIPS section is now read-only — header + the
  // day-trip place's sights — without the per-chip management UI
  // (day picker, Change day, Cancel, Stay overnight). All the
  // management actions live on the Itinerary day-trip item now;
  // the Explore section's job is just to surface what to DO at the
  // day-trip city for planning.
  if (Array.isArray(dest.dayTrips) && dest.dayTrips.length) {
    var dtCatHdr = document.createElement("div");
    // Round FN.8.19: sentence case "Day trips" to match other Explore
    // section headers ("Sights", "Restaurants"). Was all-caps which
    // read as a louder banner than the surrounding sections.
    dtCatHdr.style.cssText = "margin:18px 0 4px;padding:6px 10px;background:var(--c-tint-purple);border:1px solid #d8c4e8;border-radius:6px;font-size:13px;font-weight:700;color:var(--c-accent);";
    dtCatHdr.textContent = "Day trips";
    wrap.appendChild(dtCatHdr);
    dest.dayTrips.forEach(function(dt, dtIdx){
      if (!dt || !dt.place) return;
      var chipKey = dt.place.toLowerCase();
      var chipData = _generatedCityData[chipKey];
      var chipSec = document.createElement("div");
      chipSec.className = "exp-section";
      chipSec.style.borderTop = "1px solid #f0f0f0";
      chipSec.style.marginTop = "8px";
      chipSec.style.paddingTop = "8px";
      chipSec.id = "chip-sec-" + chipKey.replace(/\s+/g, '-');
      var cHdr = document.createElement("div"); cHdr.className = "exp-section-hdr";
      cHdr.style.flexDirection = "column";
      cHdr.style.alignItems = "flex-start";
      cHdr.style.gap = "0";
      // Round FN.8.9: two-line header. Lead with the place name as
      // the focal point, then a smaller meta line that tells the
      // user the schedule + distance. Was a single run-on line
      // ("Saas-Fee day trip · on Mon, Jul 11 · 17km away") which
      // Neal flagged as unacceptable — too many qualifiers competing
      // for attention. Two-line treatment makes the place the anchor
      // and demotes the metadata.
      // Round FT.3: support multiple placements. Was a single "placed
      // on day X" lookup; now collects ALL day indices where this
      // day-trip place is scheduled. The meta line lists them; the
      // day picker remains visible for unscheduled days so the user
      // can keep adding more.
      var _placedOnDays = [];
      (dest.days || []).forEach(function(day, dIdx){
        (day.items || []).forEach(function(it){
          if (it && it.type === "daytrip" && it.dayTripPlace === dt.place) {
            if (_placedOnDays.indexOf(dIdx) < 0) _placedOnDays.push(dIdx);
          }
        });
      });
      var titleLine = document.createElement("div");
      titleLine.style.cssText = "font-size:14px;font-weight:700;color:#222;display:flex;align-items:baseline;gap:6px;";
      titleLine.textContent = dt.place;
      var metaLine = document.createElement("div");
      metaLine.style.cssText = "font-size:10.5px;color:#666;margin-top:1px;";
      var schedTxt;
      if (_placedOnDays.length) {
        var dayLbls = _placedOnDays.map(function(dIdx){
          return ((dest.days||[])[dIdx] || {}).lbl || ("Day "+(dIdx+1));
        });
        var word = _placedOnDays.length === 1 ? "day" : "days";
        schedTxt = '<span style="color:var(--c-accent);font-weight:600;">✓ scheduled on '
          + dayLbls.join(", ") + '</span>';
      } else {
        schedTxt = '<span style="color:var(--c-warn);font-weight:600;">⚠ not yet scheduled</span>';
      }
      metaLine.innerHTML = schedTxt + ' &nbsp;·&nbsp; ' + (dt.distKm != null ? _fmtDistance(dt.distKm) + ' away' : '? km away') + ' &nbsp;·&nbsp; sights and transport below';
      cHdr.appendChild(titleLine);
      cHdr.appendChild(metaLine);
      // v359.3.2: "Stay overnight here" button at the top of every
      // day-trip section in Explore. Neal's call: "Any day trip, auto
      // generated or not, needs to be able to be removed and restored
      // as a destination." This was the missing surface — the Itinerary
      // row, the chip menu, and the trip-overview chip all had it, but
      // the Explore-tab section (which is the FIRST place a user lands
      // when looking at what a day-trip means) didn't. Same blue pill
      // styling used elsewhere for the same action; calls ungroupDayTrip
      // directly with no confirm() because the action is undoable via
      // the toast and clearly labeled.
      var convertRow = document.createElement("div");
      convertRow.style.cssText = "margin-top:5px;";
      var convertBtn = document.createElement("button");
      convertBtn.type = "button";
      convertBtn.textContent = "🛏 Stay overnight here";
      convertBtn.title = "Convert this day trip into its own destination (a stay) inserted after " + (dest.place || "the hub");
      convertBtn.style.cssText = "font-size:11px;font-weight:600;color:var(--c-primary);background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:11px;padding:3px 10px;cursor:pointer;font-family:inherit;";
      convertBtn.onmouseover = function(){ convertBtn.style.background = "#dceaf8"; };
      convertBtn.onmouseout = function(){ convertBtn.style.background = "#eef5ff"; };
      (function(hubDest, dayTripIdx, dtName){
        convertBtn.onclick = function(e){
          e.stopPropagation();
          if (typeof ungroupDayTrip !== "function") return;
          ungroupDayTrip(hubDest, dayTripIdx);
        };
      })(dest, dtIdx, dt.place);
      convertRow.appendChild(convertBtn);
      cHdr.appendChild(convertRow);
      chipSec.appendChild(cHdr);
      // Round FT.3: assignRow ALWAYS renders. Each day capsule shows
      // ✓ if this day-trip is already on that day. Clicking a
      // ✓-marked day removes the placement; clicking an unmarked day
      // adds it. (Was: assignRow only rendered when placedOnDay < 0,
      // which made adding a second-day placement impossible.)
      // For backward-compat with downstream loops that used a single
      // placedOnDay scalar (e.g. sight de-dupe below), expose the
      // first placed day here.
      var placedOnDay = _placedOnDays.length ? _placedOnDays[0] : -1;
      var assignRow = document.createElement("div");
      assignRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:10.5px;color:#666;margin:4px 0 8px;padding:6px 8px;background:#fdf6e3;border:1px dashed #e5c870;border-radius:6px;";
      var dayCapsules = document.createElement("div");
      dayCapsules.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;";
      var placeLbl = document.createElement("span");
      placeLbl.style.cssText = "font-weight:600;color:var(--c-accent);";
      placeLbl.textContent = _placedOnDays.length ? "Add another day:" : "Place on:";
      dayCapsules.appendChild(placeLbl);
      (dest.days || []).forEach(function(day, dIdx){
        var dayBtn = document.createElement("button");
        dayBtn.type = "button";
        var isOn = _placedOnDays.indexOf(dIdx) >= 0;
        var dayLbl = day.lbl || "";
        var dayBtnText = dayLbl || ("Day " + (dIdx+1));
        dayBtn.textContent = (isOn ? "✓ " : "") + dayBtnText;
        dayBtn.title = isOn
          ? "Click to remove this day-trip from " + (dayLbl || "Day "+(dIdx+1))
          : "Day " + (dIdx+1) + (dayLbl ? " · " + dayLbl : "");
        dayBtn.style.cssText = "font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid " + (isOn ? "#5b3f8f" : "#d8c4e8") + ";background:" + (isOn ? "#5b3f8f" : "#fff") + ";color:" + (isOn ? "#fff" : "#5b3f8f") + ";cursor:pointer;font-family:inherit;";
        (function(hub, dayTripIdx, dayIndex, currentlyOn){
          dayBtn.onclick = function(){
            if (currentlyOn) {
              // Remove just this day's placement (FT.3 — per-day,
              // not all-instances).
              if (typeof removeDayTripFromDayItem === "function") {
                removeDayTripFromDayItem(hub, hub.dayTrips[dayTripIdx].place, dayIndex);
              }
            } else {
              addDayTripToDay(hub, dayTripIdx, dayIndex);
            }
          };
        })(dest, dtIdx, dIdx, isOn);
        dayCapsules.appendChild(dayBtn);
      });
      assignRow.appendChild(dayCapsules);
      chipSec.appendChild(assignRow);
      if (chipData && Array.isArray(chipData.sights) && chipData.sights.length) {
        // Round FN.8.17: dedup against the day-trip day's existing
        // items (by sight name) so adding a sight here makes the chip
        // / row drop out of view, mirroring the FN.8.15 behavior on
        // the Itinerary item.
        var existingNamesOnDay = {};
        if (placedOnDay >= 0 && (dest.days || [])[placedOnDay]) {
          ((dest.days[placedOnDay].items || [])).forEach(function(it){
            if (it && it.n) existingNamesOnDay[it.n.toLowerCase()] = true;
          });
        }
        chipData.sights.slice(0, 8).forEach(function(sg){
          var sightName = sg.name || sg.n || "";
          if (placedOnDay >= 0 && existingNamesOnDay[sightName.toLowerCase()]) return;
          var row = document.createElement("div"); row.className = "exp-item";
          var ic = document.createElement("div"); ic.className = "exp-item-icon"; ic.style.color = "#7c5cbf"; ic.textContent = "●";
          var bd = document.createElement("div"); bd.className = "exp-item-body";
          var nm = document.createElement("div"); nm.className = "exp-item-name"; nm.textContent = sightName;
          bd.appendChild(nm);
          if (sg.desc || sg.note) {
            var nt = document.createElement("div"); nt.className = "exp-item-note";
            var noteText = sg.desc || sg.note || "";
            nt.textContent = noteText.length > 120 ? noteText.substring(0, 118) + "…" : noteText;
            bd.appendChild(nt);
          }
          row.appendChild(ic); row.appendChild(bd);
          // Round FN.8.17: + Add button on each sight in the Explore
          // DAY TRIPS section. Only fully active when the day trip is
          // scheduled (we know which day to add to); otherwise greyed
          // out with a tooltip that points the user at the picker.
          var acts = document.createElement("div"); acts.className = "exp-item-acts";
          var addBtn = document.createElement("button");
          addBtn.type = "button";
          if (placedOnDay >= 0) {
            var pDayLbl = ((dest.days || [])[placedOnDay] || {}).lbl || ("Day " + (placedOnDay+1));
            addBtn.textContent = "+ Add to " + pDayLbl;
            addBtn.title = "Add this sight to your " + dt.place + " day trip on " + pDayLbl;
            addBtn.style.cssText = "font-size:10.5px;font-weight:600;color:var(--c-accent);background:var(--c-bg);border:1px solid #d8c4e8;border-radius:9px;padding:3px 9px;cursor:pointer;font-family:inherit;white-space:nowrap;";
            addBtn.onmouseover = function(){ addBtn.style.background = "#f4eef9"; };
            addBtn.onmouseout = function(){ addBtn.style.background = "#fff"; };
            (function(sgData, hubDestRef, pDayIdx){
              addBtn.onclick = function(e){
                e.stopPropagation();
                var targetDay = hubDestRef.days[pDayIdx];
                if (!targetDay) return;
                if (typeof sidCtr !== "undefined") sidCtr++;
                var nameStr = sgData.name || sgData.n || "";
                var newItem = {
                  id: "s" + sidCtr, type: "sight", n: nameStr,
                  st: sgData.st || nameStr, p: "nice", done: false, slot: "day",
                  note: sgData.desc || sgData.note || null,
                  lat: sgData.lat || null, lng: sgData.lng || null
                };
                if (!Array.isArray(targetDay.items)) targetDay.items = [];
                targetDay.items.push(newItem);
                if (typeof autoSave === "function") autoSave();
                if (typeof drawDestMode === "function") drawDestMode(hubDestRef.id);
              };
            })(sg, dest, placedOnDay);
          } else {
            addBtn.textContent = "+ Add";
            addBtn.title = "Schedule the day trip first (Place on: above) — then add sights to that day.";
            addBtn.disabled = true;
            addBtn.style.cssText = "font-size:10.5px;font-weight:500;color:#bbb;background:var(--c-panel);border:1px solid var(--c-border-3);border-radius:9px;padding:3px 9px;cursor:not-allowed;font-family:inherit;white-space:nowrap;";
          }
          acts.appendChild(addBtn);
          row.appendChild(acts);
          chipSec.appendChild(row);
        });
      } else {
        var loadHint = document.createElement("div");
        loadHint.style.cssText = "font-size:11px;color:var(--c-ink-3);font-style:italic;padding:4px 0;";
        loadHint.textContent = chipData && chipData.loading
          ? "Max is loading sights for " + dt.place + "…"
          : "Sights for " + dt.place + " will appear here once Max loads them.";
        chipSec.appendChild(loadHint);
        // Trigger generation if we don't have it yet.
        if (!chipData) {
          // Synthesize a temporary id so generateCityData has something
          // to bind to. The chip itself has no dest.id; we use the
          // hub's id but the data will be cached under chipKey.
          // PD.325 note: NOT routed through MaxEnrich. The hub's
          // dest.id already has suggestions, so the queue's
          // alreadyEnriched probe would reject every chip. Chip
          // generation is per-render and small (≤ a few chips per
          // destination view), so direct call is fine here. A future
          // PD could give chips synthetic ids if this becomes hot.
          if (typeof generateCityData === "function") {
            try { generateCityData(dt.place, dest.id); } catch(_){}
          }
        }
      }
      wrap.appendChild(chipSec);
    });
  }

  // Round FT.2/FT.3/FT.5: peer day-trip section. Lists every OTHER
  // trip destination within the user-adjustable threshold (default
  // 3h), with per-day schedule capsules. Scheduling transfers a
  // night from target to this hub via _ftSchedulePeerDayTrip;
  // unscheduling reverses it. Threshold control is free-form
  // ("3:30", "3.5", "3h 30m" all parse) and persists trip-wide on
  // trip.dayTripThreshold. Renders even when empty so the user can
  // adjust the threshold to surface options Max wouldn't have
  // suggested by default.
  (function(){
    if (!trip || !Array.isArray(trip.destinations) || trip.destinations.length < 2) return;
    var peerSec = document.createElement("div");
    peerSec.style.cssText = "margin-top:18px;";
    var peerHdr = document.createElement("div");
    peerHdr.style.cssText = "padding:6px 10px;background:#eef4ee;border:1px solid #c8e0c8;border-radius:6px;font-size:13px;font-weight:700;color:#2d5a2d;";
    // v359.60.67: the existing day-trip routes section above is now
    // labeled "Day trips"; this section sits below as candidate places
    // that COULD be converted into new day trips (other destinations
    // within X hours). The split label keeps the surfaces' roles
    // distinct.
    peerHdr.textContent = "Other places that could be day trips";
    peerSec.appendChild(peerHdr);

    // Threshold control — free-form text input
    var threshRow = document.createElement("div");
    threshRow.style.cssText = "margin:10px 4px;padding:8px 10px;background:#f7faf7;border:1px solid #e0eae0;border-radius:6px;font-size:11px;color:#2d5a2d;display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
    var threshLbl = document.createElement("span");
    threshLbl.textContent = "Show day-trip options reachable within";
    var threshInp = document.createElement("input");
    threshInp.type = "text";
    threshInp.value = _ftFormatHours(_ftGetThresholdHours());
    threshInp.placeholder = "3:00";
    threshInp.style.cssText = "width:64px;font-size:11px;font-weight:600;padding:3px 7px;border:1px solid #c4d8c4;border-radius:5px;background:var(--c-bg);color:#2d5a2d;font-family:inherit;text-align:center;";
    threshInp.title = "Accepts 3, 3.5, 3:30, or 3h 30m";
    threshInp.onchange = function(){
      var parsed = _ftParseHoursInput(this.value);
      if (parsed && parsed > 0) {
        trip.dayTripThreshold = parsed;
        if (typeof autoSave === "function") autoSave();
        if (typeof drawDestMode === "function") drawDestMode(dest.id);
      } else {
        // Invalid — revert input to current setting
        this.value = _ftFormatHours(_ftGetThresholdHours());
      }
    };
    threshInp.onkeydown = function(e){
      if (e.key === "Enter") this.blur();
    };
    var threshHint = document.createElement("span");
    threshHint.style.cssText = "font-size:10px;color:#7a9a7a;";
    threshHint.textContent = "(door-to-door — drive, train, or flight, whichever is fastest)";
    threshRow.appendChild(threshLbl);
    threshRow.appendChild(threshInp);
    threshRow.appendChild(threshHint);
    peerSec.appendChild(threshRow);

    var candidates = _ftPeerDayTripCandidates(dest);
    if (!candidates.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "margin:6px 4px;padding:10px 12px;font-size:11px;color:#666;font-style:italic;";
      empty.textContent = "No other trip destinations within " + _ftFormatHours(_ftGetThresholdHours()) + " of " + dest.place + ". Increase the threshold to see more options.";
      peerSec.appendChild(empty);
    } else {
      candidates.forEach(function(cand){
        var rowSec = document.createElement("div");
        rowSec.style.cssText = "margin:8px 4px;padding:10px 12px;background:#fafdfa;border:1px solid #e0eae0;border-radius:7px;";
        var rowHdr = document.createElement("div");
        rowHdr.style.cssText = "display:flex;align-items:baseline;gap:8px;";
        var rowName = document.createElement("div");
        rowName.style.cssText = "font-size:13px;font-weight:700;color:#222;";
        rowName.textContent = cand.dest.place;
        rowHdr.appendChild(rowName);
        var rowMeta = document.createElement("div");
        rowMeta.style.cssText = "font-size:10.5px;color:#666;";
        var noteTxt = (cand.info && cand.info.note) ? cand.info.note : "~" + _fmtDistance(cand.distKm) + " · est. " + _ftFormatHours(cand.fastestH);
        rowMeta.textContent = noteTxt;
        rowHdr.appendChild(rowMeta);
        rowSec.appendChild(rowHdr);

        var rowSub = document.createElement("div");
        rowSub.style.cssText = "font-size:10.5px;color:var(--c-ink-2);margin-top:4px;";
        var nightWord = (cand.dest.nights === 1) ? "night" : "nights";
        var schedSummary = "";
        if (cand.scheduledDays.length) {
          var dayLbls = cand.scheduledDays.map(function(idx){
            return ((dest.days||[])[idx] || {}).lbl || ("Day "+(idx+1));
          });
          schedSummary = ' &nbsp;·&nbsp; <span style="color:var(--c-accent);font-weight:600;">✓ scheduled on ' + dayLbls.join(", ") + '</span>';
        }
        rowSub.innerHTML = '<strong>' + cand.dest.nights + ' ' + nightWord + '</strong> at ' + cand.dest.place + schedSummary;
        rowSec.appendChild(rowSub);

        // Day picker capsules
        var capsules = document.createElement("div");
        capsules.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;";
        var lbl = document.createElement("span");
        lbl.style.cssText = "font-size:10.5px;font-weight:600;color:#2d5a2d;";
        lbl.textContent = cand.scheduledDays.length ? "Add another day:" : "Schedule on:";
        capsules.appendChild(lbl);
        (dest.days || []).forEach(function(day, dIdx){
          var btn = document.createElement("button");
          btn.type = "button";
          var isOn = cand.scheduledDays.indexOf(dIdx) >= 0;
          var dayBtnText = day.lbl || ("Day " + (dIdx+1));
          btn.textContent = (isOn ? "✓ " : "") + dayBtnText;
          btn.title = isOn
            ? "Click to remove this day-trip from " + (day.lbl || "Day "+(dIdx+1))
            : "Schedule a day-trip to " + cand.dest.place + " on " + (day.lbl || "Day "+(dIdx+1));
          btn.style.cssText = "font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:10px;border:1px solid " + (isOn ? "#2d5a2d" : "#c4d8c4") + ";background:" + (isOn ? "#2d5a2d" : "#fff") + ";color:" + (isOn ? "#fff" : "#2d5a2d") + ";cursor:pointer;font-family:inherit;";
          (function(hub, target, dayIndex, currentlyOn, distKmVal){
            btn.onclick = function(){
              if (currentlyOn) {
                if (typeof removeDayTripFromDayItem === "function") {
                  removeDayTripFromDayItem(hub, target.place, dayIndex);
                }
              } else {
                _ftSchedulePeerDayTrip(hub, target, dayIndex, distKmVal);
              }
            };
          })(dest, cand.dest, dIdx, isOn, cand.distKm);
          capsules.appendChild(btn);
        });
        rowSec.appendChild(capsules);
        peerSec.appendChild(rowSec);
      });
    }
    wrap.appendChild(peerSec);
  })();

  return wrap;
}

function buildRestaurantSection(dest){
  var restSec=document.createElement("div"); restSec.className="exp-section"; restSec.id="dm-rest-section"; restSec.style.borderTop="1px solid #f0f0f0"; restSec.style.marginTop="4px";
  var rHdr=document.createElement("div"); rHdr.className="exp-section-hdr";
  var rLbl=document.createElement("div"); rLbl.className="exp-section-lbl"; rLbl.textContent="Restaurants";
  var rRef=document.createElement("button"); rRef.className="exp-refresh-btn"; rRef.textContent=dest.restaurantSuggestions.length?"Refresh":"Ask Max";
  (function(d,btn){rRef.onclick=function(){refreshRestaurantSuggestions(d,btn);};})(dest,rRef);
  rHdr.appendChild(rLbl); rHdr.appendChild(rRef); restSec.appendChild(rHdr);
  if(dest.restaurantSuggestions.length===0){
    var rEmp=document.createElement("div"); rEmp.className="exp-empty";
    rEmp.textContent="Restaurant suggestions will appear here."; restSec.appendChild(rEmp);
  } else {
    dest.restaurantSuggestions.forEach(function(s){restSec.appendChild(mkExploreSuggestion(s,dest,"restaurant"));});
  }
  return restSec;
}

function mkExploreSuggestion(s,dest,type){
  var row=document.createElement("div"); row.className="exp-item"; row.id="exp-"+s.id;
  // PD.270: a "considered" sight (the user unchecked it in Discovery
  // but didn't reject it) renders muted with a "Considered" badge.
  // The existing Add-to-day button is the promotion path: when the
  // user adds it to a day, _recomputeSuggestions filters it out of
  // dest.suggestions so it stops appearing here.
  if (s && s._considered) {
    row.style.opacity = "0.72";
    row.style.borderLeft = "3px solid #d8c4e8";
    row.style.paddingLeft = "4px";
    row.title = "You considered this in Discovery but left it unchecked. Add to a day if you want it on the trip.";
  }
  var icon=document.createElement("div"); icon.className="exp-item-icon";
  icon.textContent=type==="restaurant"?"\uD83C\uDF7D":"\u25CF";
  if(type==="sight")icon.style.color="#555";
  if(s && s._considered) icon.style.color = "#a08acf";
  var body=document.createElement("div"); body.className="exp-item-body";
  var nm=document.createElement("div"); nm.className="exp-item-name"; nm.textContent=s.n||s.name||"";
  // PD.270: badge for considered + also-considered. _considered means
  // the user marked it considered (and there's no LLM equivalent
  // currently). _alsoConsidered means BOTH the user considered it AND
  // Max independently surfaced it \u2014 the row is the LLM's record
  // promoted with a "you considered this too" affirmation.
  if (s && s._considered) {
    var consBadge = document.createElement("span");
    consBadge.style.cssText = "display:inline-block;margin-left:8px;font-size:9.5px;font-weight:700;color:var(--c-accent);background:#f3eefa;border:1px solid #ddd0f0;border-radius:4px;padding:1px 6px;letter-spacing:.03em;text-transform:uppercase;vertical-align:middle;";
    consBadge.textContent = "Considered";
    nm.appendChild(consBadge);
  } else if (s && s._alsoConsidered) {
    var alsoBadge = document.createElement("span");
    alsoBadge.style.cssText = "display:inline-block;margin-left:8px;font-size:9.5px;font-weight:700;color:#3a7a4e;background:#eaf5ee;border:1px solid #c4d8c8;border-radius:4px;padding:1px 6px;letter-spacing:.03em;text-transform:uppercase;vertical-align:middle;";
    alsoBadge.textContent = "\u2713 You considered this";
    nm.appendChild(alsoBadge);
  }
  body.appendChild(nm);
  if(s.note){var nt=document.createElement("div");nt.className="exp-item-note";nt.textContent=s.note.length>120?s.note.substring(0,118)+"\u2026":s.note;body.appendChild(nt);}
  var acts=document.createElement("div"); acts.className="exp-item-acts";
  // Story button
  var stb=document.createElement("button"); stb.className="exp-story-btn"; stb.id="ssa-"+s.id;
  stb.setAttribute("data-state","idle"); stb.textContent="story";
  (function(sid,did){stb.onclick=function(){sStory(sid,did);};})(s.id,dest.id);
  acts.appendChild(stb);
  // v359.60.70: Book button on optional sights too \u2014 same booking shape
  // (s.booking) used for scheduled items. Tapping opens an inline form
  // that saves to s.booking. If a booking already exists, the button
  // surfaces it ("booked \u2713") and a click opens the form for editing.
  // The Bookings tab rolls up suggestion-level bookings alongside the
  // scheduled-item ones.
  if (type === "sight") {
    var bkb = document.createElement("button");
    bkb.className = "exp-book-btn";
    bkb.style.cssText = "font-size:10px;font-weight:600;padding:3px 8px;border-radius:5px;cursor:pointer;font-family:inherit;border:1px solid " + (s.booking ? "#2a7a4e" : "#d0d0d0") + ";background:" + (s.booking ? "#eaf5ee" : "#fff") + ";color:" + (s.booking ? "#2a7a4e" : "#666") + ";white-space:nowrap;";
    bkb.textContent = s.booking ? "booked \u2713" : "book";
    bkb.title = s.booking ? "Edit booking" : "Log a booking for this sight";
    (function(item, did){
      bkb.onclick = function(e){
        e.stopPropagation();
        if (typeof toggleSightBookForm === "function") {
          toggleSightBookForm(row, item, did, null);
        }
      };
    })(s, dest.id);
    acts.appendChild(bkb);
  }
  // Add to day button
  var addBtn=document.createElement("button"); addBtn.className="exp-add-btn"; addBtn.textContent="Add to day \u2192";
  (function(item,tp,btn){addBtn.onclick=function(e){
    e.stopPropagation();
    showAddToDay(item,tp,dest,btn);
  };})(s,type,addBtn);
  acts.appendChild(addBtn);
  // v353.2: dismiss button. LLM hallucinations occasionally end up
  // in the suggestions list (e.g., "Pago de duda" instead of
  // Seljalandsfoss for an Iceland trip). Without this, the only
  // recourse was tapping Refresh to regenerate the entire list,
  // which loses any sights the user already considered useful.
  // Tapping \u2715 here splices just THIS item out of dest.suggestions
  // (or .restaurantSuggestions), saves, and re-renders the Explore
  // pane. Confirms via undo toast in case of misclick.
  var dismissBtn = document.createElement("button");
  dismissBtn.className = "exp-dismiss-btn";
  dismissBtn.type = "button";
  dismissBtn.textContent = "\u2715";
  dismissBtn.title = "Dismiss this suggestion";
  dismissBtn.style.cssText = "background:none;border:1px solid transparent;color:#bbb;cursor:pointer;padding:3px 7px;margin-left:4px;border-radius:4px;font-size:11px;line-height:1;font-family:inherit;flex-shrink:0;transition:color .12s ease, background .12s ease, border-color .12s ease;";
  dismissBtn.onmouseover = function () { dismissBtn.style.color = "#c05020"; dismissBtn.style.background = "#fff5f0"; dismissBtn.style.borderColor = "#f0d0c0"; };
  dismissBtn.onmouseout  = function () { dismissBtn.style.color = "#bbb"; dismissBtn.style.background = "none"; dismissBtn.style.borderColor = "transparent"; };
  (function (item, tp) {
    dismissBtn.onclick = function (e) {
      e.stopPropagation();
      var bucket = (tp === "restaurant") ? "restaurantSuggestions" : "suggestions";
      var arr = dest[bucket] || [];
      var idx = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].id === item.id) { idx = i; break; }
      }
      if (idx < 0) return;
      var removed = arr.splice(idx, 1)[0];
      autoSave();
      if (typeof drawDestMode === "function") drawDestMode(dest.id);
      // Undo toast \u2014 restores at the original index. Same pattern
      // as \u2715\u2192Later on scheduled items.
      if (typeof showUndoToast === "function") {
        showUndoToast(item.n || item.name || "suggestion", function () {
          if (!Array.isArray(dest[bucket])) dest[bucket] = [];
          dest[bucket].splice(idx, 0, removed);
          autoSave();
          if (typeof drawDestMode === "function") drawDestMode(dest.id);
        }, "Dismissed {label}");
      }
    };
  })(s, type);
  acts.appendChild(dismissBtn);
  row.appendChild(icon); row.appendChild(body); row.appendChild(acts);
  // Round FN.9: muted-cursor + tooltip when the item has no
  // coordinates, so clicking the row no longer silently does
  // nothing. Was: row.onclick early-returned on missing lat/lng.
  if (!s.lat || !s.lng) {
    row.style.cursor = "default";
    row.title = "No map data for this place yet — Max is still loading coordinates.";
  }
  // Click row: show pin popup on map and pan to it
  (function(item,dest,type){row.onclick=function(e){
    if(e.target.closest('button')) return; // don't intercept button clicks
    if(!item.lat||!item.lng) return;
    // Pan map to item. Round FN.9: clamp zoom so a casual click
    // doesn't yank the user from a wide overview down to street
    // level. Only zoom in if the current zoom is below 13; otherwise
    // keep where they are and just pan.
    if(_mainMap){
      var curZoom = _mainMap.getZoom();
      var targetZoom = curZoom < 13 ? 14 : curZoom;
      _mainMap.setView([item.lat,item.lng], targetZoom, {animate:true});
    }
    // Show pin panel — synthesise a container point from the map
    setTimeout(function(){
      if(!_mainMap) return;
      var pt=_mainMap.latLngToContainerPoint([item.lat,item.lng]);
      var fakeEvent={containerPoint:pt};
      showMapPinPanel(
        {id:item.id,n:item.n||item.name,note:item.note||'',done:false,slot:'day'},
        dest,
        type==='restaurant'?'restaurant-suggestion':'suggestion',
        fakeEvent
      );
    },300);
  };})(s,dest,type);
  return row;
}

function showAddToDay(item,type,dest,triggerBtn,opts){
  var existing=document.getElementById("exp-day-picker");
  if(existing)existing.parentNode.removeChild(existing);
  var picker=document.createElement("div"); picker.id="exp-day-picker";
  picker.style.cssText="position:fixed;z-index:9999;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.18);padding:6px 0;min-width:180px;";
  var phdr=document.createElement("div"); phdr.style.cssText="font-size:10px;font-weight:700;color:#333;padding:5px 14px 6px;border-bottom:1px solid var(--c-border-4);margin-bottom:3px;";
  phdr.textContent="Add to which day?"; picker.appendChild(phdr);
  var execDayId=opts&&opts.execDayId;
  dest.days.forEach(function(day){
    [{slot:"day",lbl:"Day"},{slot:"evening",lbl:"Evening"}].forEach(function(sl){
      var isCurrentDay=execDayId&&day.id===execDayId;
      var opt=document.createElement("div");
      opt.style.cssText="padding:6px 14px;font-size:11px;color:#333;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"+(isCurrentDay?"background:#f0f5ff;":"");
      var dLbl=document.createElement("span");
      dLbl.textContent=day.lbl+(isCurrentDay?" ←":"");
      if(isCurrentDay) dLbl.style.cssText="font-weight:600;color:var(--c-primary);";
      opt.appendChild(dLbl);
      var sLbl=document.createElement("span"); sLbl.style.cssText="font-size:9px;color:var(--c-ink-4);"; sLbl.textContent=sl.lbl; opt.appendChild(sLbl);
      opt.onmouseover=function(){opt.style.background="#f5f5f5";};
      opt.onmouseout=function(){opt.style.background=isCurrentDay?"#f0f5ff":"";};
      (function(d,sl2){opt.onclick=function(e){
        e.stopPropagation();
        sidCtr++;
        var ni={id:"s"+sidCtr,type:type,slot:sl2,n:item.n||item.name,p:"nice",done:false,
          st:item.st||item.n||item.name,note:item.note||null,timeStart:null,timeEnd:null,
          lat:item.lat||null,lng:item.lng||null};
        if(!d.items)d.items=[];
        d.items.push(ni);
        if(type==="restaurant"){
          dest.restaurantSuggestions=dest.restaurantSuggestions.filter(function(x){return x.id!==item.id;});
        } else if (typeof _removeSightById === "function") {
          // PD.241: route through sources model.
          _removeSightById(dest, item.id);
        } else {
          dest.suggestions=dest.suggestions.filter(function(x){return x.id!==item.id;});
        }
        var expRow=document.getElementById("exp-"+item.id);
        if(expRow)expRow.parentNode.removeChild(expRow);
        picker.parentNode&&picker.parentNode.removeChild(picker);
        // TM.4 (v329): emit replaces autoSave + updateMainMap + draw.
        // Round DY note (stay on current tab) is preserved by the
        // draw—`_activeDmSection` is global so the same tab re-renders.
        _emitTripMutation();
      };})(day,sl.slot);
      picker.appendChild(opt);
    });
  });
  // Position: use opts.x/y if provided (from map panel), otherwise use triggerBtn
  if(opts&&opts.x!=null){
    picker.style.left=Math.max(8,opts.x-20)+"px";
    picker.style.top=Math.max(8,opts.y-20)+"px";
  } else {
    var r=triggerBtn.getBoundingClientRect();
    picker.style.left=r.left+"px"; picker.style.top=(r.bottom+4)+"px";
  }
  document.body.appendChild(picker);
  setTimeout(function(){document.addEventListener("click",function dismiss(e){if(!picker.contains(/** @type {any} */(e.target))){picker.parentNode&&picker.parentNode.removeChild(picker);document.removeEventListener("click",dismiss,true);}},true);},0);
}

async function refreshRestaurantSuggestions(dest,btn){
  var lockKey='_restLoading_'+dest.id;
  if(window[lockKey]) return;
  window[lockKey]=true;
  if(btn){btn.disabled=true;btn.textContent="thinking\u2026";}
  try{
    var text=await callMax([{role:"user",content:"Suggest 6 restaurants in "+dest.place+". For each: name, neighborhood, one sentence on why it\u2019s worth going, and the one dish or drink to order. Be specific."+(typeof _briefPersonalContext === "function" ? _briefPersonalContext() : "")+"\n\nFormat: one restaurant per line, as: Name | Neighborhood | Why go | What to order"}]);
    var suggestions=[];
    text.trim().split(/\n+/).filter(function(l){return l.trim().length>5;}).forEach(function(line){
      var parts=line.replace(/^\d+\.\s*/,"").split("|").map(function(p){return p.trim();});
      if(parts.length>=2){
        sidCtr++;
        var rname=parts[0].replace(/^[-•*]\s*/,"");
        var neighborhood=parts[1]||"";
        var why=parts[2]||"";
        var order=parts[3]||"";
        // note: "Neighborhood · why it's good. Order: dish"
        var noteParts=[];
        if(neighborhood)noteParts.push(neighborhood);
        if(why)noteParts.push(why);
        var note=noteParts.join(" \u00b7 ");
        if(order)note+=(note?" \u2014 ":"")+order;
        suggestions.push({
          id:"r"+sidCtr,
          type:"restaurant",
          n:rname,
          st:rname+" "+dest.place,
          note:note||null,
          order:order
        });
      }
    });
    if(suggestions.length){
      dest.restaurantSuggestions=suggestions;
      autoSave();
      // Update only the restaurant section in-place — don't wipe sights
      var restSection=document.getElementById("dm-rest-section");
      if(restSection&&activeDest===dest.id){
        restSection.innerHTML="";
        restSection.appendChild(buildRestaurantSection(dest));
      } else if(activeDest===dest.id){
        // Pane not built yet — redraw when map settles
        setTimeout(function(){if(activeDest===dest.id)drawDestMode(dest.id);},100);
      }
    }
  }catch(e){console.error("refreshRestaurantSuggestions:",e);}
  window[lockKey]=false;
  if(btn){btn.disabled=false;btn.textContent="Refresh";}
  if(activeDest===dest.id) updateMainMap();
}

// ── Later / Maybe bucket builder ───────────────────────────
function buildBucketSection(dest,bucketKey,title,subtitle){
  var items=dest[bucketKey+"Items"]||[];
  var sec=document.createElement("div"); sec.className="dm-bucket";

  var hdr=document.createElement("div"); hdr.className="dm-bucket-hdr";
  var lbl=document.createElement("div"); lbl.className="dm-bucket-lbl"; lbl.textContent=title;
  var cnt=document.createElement("div"); cnt.className="dm-bucket-count"; cnt.textContent=items.length||"";
  hdr.appendChild(lbl); hdr.appendChild(cnt); sec.appendChild(hdr);

  if(subtitle&&items.length===0){
    var sub=document.createElement("div"); sub.style.cssText="font-size:10px;color:#ccc;padding:0 14px 6px;font-style:italic;";
    sub.textContent=subtitle; sec.appendChild(sub);
  }

  items.forEach(function(s,idx){
    var row=document.createElement("div"); row.className="dm-bucket-item";
    var dot=document.createElement("div"); dot.className="bi-dot";
    var body=document.createElement("div"); body.style.flex="1";
    var nm=document.createElement("div"); nm.className="bi-name"+(s.done?" "+"done":""); nm.textContent=s.n;
    if(s.done)nm.style.textDecoration="line-through";
    if(s.note){var nd=document.createElement("div");nd.className="bi-note";nd.textContent=s.note.length>70?s.note.substring(0,68)+"\u2026":s.note;body.appendChild(nm);body.appendChild(nd);}
    else{body.appendChild(nm);}
    var acts=document.createElement("div"); acts.className="bi-acts";

    // Story button
    var stb=document.createElement("button"); stb.className="sa ssa"; stb.id="ssa-"+s.id;
    stb.setAttribute("data-state","idle"); stb.textContent="story \u2197";
    (function(sid,did){stb.onclick=function(){sStory(sid,did);};})(s.id,dest.id);
    acts.appendChild(stb);

    // Assign to day button
    var assignBtn=document.createElement("button"); assignBtn.className="sa"; assignBtn.textContent="\uD83D\uDCC5";
    assignBtn.title="Assign to a day";
    (function(item,bk,btn){assignBtn.onclick=function(e){
      e.stopPropagation();
      var existing=document.getElementById("bp-"+item.id);
      if(existing){existing.parentNode.removeChild(existing);return;}
      var picker=document.createElement("div"); picker.id="bp-"+item.id;
      picker.style.cssText="position:fixed;z-index:900;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.14);padding:6px 0;min-width:130px;";
      var phdr=document.createElement("div"); phdr.style.cssText="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#bbb;padding:4px 14px 6px;border-bottom:1px solid var(--c-border-4);margin-bottom:4px;"; phdr.textContent="Assign to day"; picker.appendChild(phdr);
      dest.days.forEach(function(day){
        var opt=document.createElement("div"); opt.style.cssText="padding:6px 14px;font-size:11px;cursor:pointer;color:#444;";
        opt.textContent=day.lbl;
        opt.onmouseover=function(){opt.style.background="#f5f5f5";}; opt.onmouseout=function(){opt.style.background="";};
        (function(d){opt.onclick=function(){
          // v353: push the ORIGINAL item back to the day, preserving
          // its booking, time, note, done state. Earlier code created
          // a new sight with `sidCtr++` and stripped everything,
          // which made sense when bucket items were just LLM
          // "ideas," but lost data once removeSightToLater started
          // sending full sight objects to laterItems via the ✕ button.
          // Now: assigning a Later/Maybe item back to a day restores
          // it verbatim (with booking, etc.) — and falls back to a
          // fresh sight for items that originated as bare suggestions.
          var hasFullState = item && (item.booking || item.timeStart || item.note);
          var toPush;
          if (hasFullState) {
            toPush = item;
          } else {
            sidCtr++;
            toPush = {
              id: "s"+sidCtr,
              type: item.type||"sight",
              slot: item.slot||"day",
              n: item.n,
              p: item.p||"nice",
              done: false,
              st: item.st||item.n,
              note: null,
              time: ""
            };
          }
          if(!day.items) day.items=[];
          day.items.push(toPush);
          dest[bk+"Items"]=dest[bk+"Items"].filter(function(x){return x.id!==item.id;});
          picker.parentNode.removeChild(picker);
          _emitTripMutation();
        };})(day);
        picker.appendChild(opt);
      });
      var r2=btn.getBoundingClientRect(); picker.style.left=r2.left+"px"; picker.style.top=(r2.bottom+4)+"px";
      document.body.appendChild(picker);
      setTimeout(function(){document.addEventListener("click",function dismiss(ev){if(!picker.contains(/** @type {any} */(ev.target))){picker.parentNode&&picker.parentNode.removeChild(picker);document.removeEventListener("click",dismiss);}});},10);
    };})(s,bucketKey,assignBtn);
    acts.appendChild(assignBtn);

    // Move to other bucket
    var otherKey=bucketKey==="later"?"maybe":"later";
    var moveBtn=document.createElement("button"); moveBtn.className="sa"; moveBtn.textContent="\u2192 "+(bucketKey==="later"?"Maybe":"Later");
    (function(item,bk,ok){moveBtn.onclick=function(){
      dest[bk+"Items"]=dest[bk+"Items"].filter(function(x){return x.id!==item.id;});
      if(!dest[ok+"Items"])dest[ok+"Items"]=[];
      dest[ok+"Items"].push(item);
      _emitTripMutation();
    };})(s,bucketKey,otherKey);
    acts.appendChild(moveBtn);

    // Done toggle
    var doneBtn=document.createElement("button"); doneBtn.className="sa "+(s.done?"usa":"dsa");
    doneBtn.textContent=s.done?"undo":"done";
    (function(item){doneBtn.onclick=function(){item.done=!item.done;_emitTripMutation();};})(s);
    acts.appendChild(doneBtn);

    // Delete with undo
    var xb=document.createElement("button"); xb.className="sa"; xb.textContent="\u2715";
    (function(item,bk,i){xb.onclick=function(){
      dest[bk+"Items"]=dest[bk+"Items"].filter(function(x){return x.id!==item.id;});
      autoSave();
      showUndoToast(item.n,function(){
        if(!dest[bk+"Items"])dest[bk+"Items"]=[];
        dest[bk+"Items"].splice(i,0,item);
        _emitTripMutation();
      });
      _emitTripMutation();
    };})(s,bucketKey,idx);
    acts.appendChild(xb);

    row.appendChild(dot); row.appendChild(body); row.appendChild(acts);
    sec.appendChild(row);
  });

  // Add input
  var addRow=document.createElement("div"); addRow.className="dm-bucket-add";
  var inp=document.createElement("input"); inp.className="dm-bucket-inp";
  inp.placeholder="Add to "+title.toLowerCase()+"\u2026";
  var addBtnEl=document.createElement("button"); addBtnEl.className="dm-bucket-addbtn"; addBtnEl.textContent="Add";
  (function(input,btn,bk){
    input.oninput=function(){btn.className=input.value.trim().length>=2?"dm-bucket-addbtn on":"dm-bucket-addbtn";};
    input.onkeydown=function(e){if(e.key==="Enter"&&input.value.trim().length>=2)btn.click();};
    btn.onclick=function(){
      var v=input.value.trim(); if(v.length<2)return;
      sidCtr++;
      var ni={id:"s"+sidCtr,n:v,p:"nice",done:false,st:v,note:null};
      if(!dest[bk+"Items"])dest[bk+"Items"]=[];
      dest[bk+"Items"].push(ni);
      input.value=""; btn.className="dm-bucket-addbtn";
      _emitTripMutation();
    };
  })(inp,addBtnEl,bucketKey);
  addRow.appendChild(inp); addRow.appendChild(addBtnEl); sec.appendChild(addRow);
  return sec;
}

var _hiddenStories = new Set(); // persists story hidden state across re-renders

function mkCachedStoryBox(sid){
  var cached=_sightStories[sid]; if(!cached)return document.createDocumentFragment();
  if(_hiddenStories.has(sid)) return document.createDocumentFragment(); // still hidden
  var box=document.createElement("div"); box.className="story-box"; box.id="stb-"+sid;
  var p=document.createElement("div"); p.style.cssText="margin-bottom:8px;line-height:1.75;"; p.textContent=cached.text;
  var acts=document.createElement("div"); acts.className="story-actions";
  var cls=document.createElement("button"); cls.className="story-btn cb"; cls.textContent="Close";
  (function(id){cls.onclick=function(){
    _hiddenStories.add(id);
    var bx=g("stb-"+id);if(bx)bx.style.display="none";
    var sb=g("ssa-"+id);if(sb){sb.setAttribute("data-state","idle");sb.textContent="story \u2197";}
  };})(sid);
  acts.appendChild(cls); box.appendChild(p); box.appendChild(acts);
  return box;
}

function buildHotelChip(bk, type, destId){
  // type: 'checkin' or 'checkout'
  var wrap=document.createElement('div'); wrap.className='itin-hotel-item';
  // v359.60.38: clickable now. Click → Stay tab of the destination,
  // scrolled to (and amber-pulsing) the specific hotel record so the
  // user can edit it. Was static-display-only before — the user could
  // see "Check-in: Hotel X" on the day card but had no path from there
  // to the edit form for that booking. Mirrors the transport-chip's
  // click → Routing tab behavior at the same level on the day card.
  wrap.style.cursor = 'pointer';
  wrap.title = 'Click to edit this booking';
  var bkId = bk && bk.id ? bk.id : null;
  (function(did, hid){
    wrap.onclick = function(e){
      if (e && e.stopPropagation) e.stopPropagation();
      if (typeof _activeDmSection !== "undefined") _activeDmSection = "stay";
      if (typeof selectDest === "function" && did) selectDest(did);
      // After the dest view renders, scroll to and amber-pulse the
      // specific hotel record. Use a small delay so the Stay tab has
      // finished mounting. The hotel record's DOM id pattern is set
      // by mkHotelRecord (Tracker/Stay tab rendering) — we try a few
      // common forms.
      if (hid) {
        setTimeout(function(){
          var sels = [
            '[data-booking-id="' + hid + '"]',
            '#hotel-record-' + hid,
            '#bk-' + hid
          ];
          var el = null;
          for (var i = 0; i < sels.length && !el; i++) {
            try { el = document.querySelector(sels[i]); } catch(_){}
          }
          if (el && el.scrollIntoView) {
            try {
              el.scrollIntoView({behavior:'smooth', block:'center'});
              el.style.transition = 'background 600ms ease';
              var orig = el.style.background;
              el.style.background = '#fff3c4';
              setTimeout(function(){ el.style.background = orig || ''; }, 1200);
            } catch(_){}
          }
        }, 140);
      }
    };
  })(destId, bkId);
  var icon=document.createElement('span'); icon.className='itin-hotel-icon'; icon.textContent=type==='checkin'?'🛎':'🧳';
  var body=document.createElement('div'); body.style.flex='1';
  var nm=document.createElement('div'); nm.className='itin-hotel-name';
  nm.textContent=(type==='checkin'?'Check-in: ':'Check-out: ')+bk.name;
  var meta=document.createElement('div'); meta.className='itin-hotel-meta';
  var parts=[];
  if(type==='checkin'&&bk.checkIn) parts.push(fmtD(bk.checkIn)+(bk.checkInTime?' '+bk.checkInTime:''));
  if(type==='checkout'&&bk.checkOut) parts.push(fmtD(bk.checkOut)+(bk.checkOutTime?' '+bk.checkOutTime:''));
  if(bk.confirmationNumber) parts.push('Conf: '+bk.confirmationNumber);
  if(bk.notes) parts.push(bk.notes);
  meta.textContent=parts.join(' · ');
  body.appendChild(nm); if(parts.length) body.appendChild(meta);
  wrap.appendChild(icon); wrap.appendChild(body);
  return wrap;
}

function buildTransportChip(bookedBk,routing,label,destId,tabTarget){
  var modeMap={"train":"\uD83D\uDE82","bus":"\uD83D\uDE8C","flight":"\u2708\uFE0F","ferry":"\u26F4\uFE0F"};
  var chip=document.createElement("div"); chip.className="itin-transport";
  // Direction prefix ("Arriving from X" / "Departing to X") — always render
  // so the user can tell which leg this chip refers to. Without this, the
  // May 17 departure-transport chip and a same-day train suggestion looked
  // identical (both just "SBB Regional Train · 1h 25min · CHF 25").
  var dir=document.createElement("span"); dir.className="itin-transport-dir";
  dir.style.cssText="font-size:10px;font-weight:700;color:var(--c-ink-3);margin-right:8px;text-transform:uppercase;letter-spacing:0.04em;";
  dir.textContent=label || "";
  var icon=document.createElement("span"); icon.className="itin-transport-icon";
  var name=document.createElement("span"); name.className="itin-transport-name";
  var meta=document.createElement("span"); meta.className="itin-transport-meta";
  if(bookedBk){
    icon.textContent=modeMap[bookedBk.mode]||"\uD83D\uDE82";
    name.textContent=bookedBk.operator;
    var parts=[];
    if(bookedBk.departure)parts.push(fmtD(bookedBk.departure)+(bookedBk.departureTime?" "+bookedBk.departureTime:""));
    if(bookedBk.confirmationNumber)parts.push("Conf: "+bookedBk.confirmationNumber);
    meta.textContent=parts.join(" \u00b7 ");
    var booked=document.createElement("span"); booked.style.cssText="font-size:9px;color:var(--c-see);margin-left:3px;"; booked.textContent="\u2713";
    name.appendChild(booked);
  } else if(routing&&routing.options.length){
    var opt=routing.options[0];
    icon.textContent=opt.icon;
    name.textContent=opt.name;
    meta.textContent=opt.meta||"";
  } else {
    icon.textContent="\u2194"; name.textContent=label; meta.textContent="see Routing";
    dir.textContent=""; // label already in name slot \u2014 don't double up
  }
  if (dir.textContent) chip.appendChild(dir);
  chip.appendChild(icon); chip.appendChild(name); chip.appendChild(meta);
  // SCAFFOLD-6 slice 4: "?" next to the transport chip → popover with
  // the picked option vs alternatives. Skipped when there's a confirmed
  // booking (the choice is settled) and when routing has only one
  // option (nothing to compare).
  if (!bookedBk && typeof transitRationale === "function" && typeof _sf6Btn === "function") {
    var fromPlaceForRat = (label || "").replace(/^Arrive from |^Depart to /i, "");
    var transitRat = transitRationale(routing, fromPlaceForRat || "from", "to");
    if (transitRat) {
      var transitQ = _sf6Btn(transitRat, {title:"Why this transport"});
      if (transitQ) {
        // Stop the chip's click handler from firing when the user clicks ?.
        transitQ.addEventListener("click", function(e){ e.stopPropagation(); });
        chip.appendChild(transitQ);
      }
    }
  }
  (function(did,tab){chip.onclick=function(){_activeDmSection=tab;selectDest(did);};})(destId,tabTarget||"routing");
  return chip;
}

// Round FN.10: wire a slot list (.slist) as a drop target for
// drag-and-drop reordering of itinerary items. Called from
// drawDestMode for both the day-slot list and the evening-slot
// list of every day. Reads the dataTransfer payload set by
// mkItinItem's dragstart, finds source/target days, moves the
// item, autoSaves, and redraws.
function _wireItinDropTarget(listEl, dayId, slot, destId) {
  if (!listEl) return;
  listEl.addEventListener("dragover", function(e){
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    listEl.classList.add("drop-target");
  });
  listEl.addEventListener("dragleave", function(e){
    // Only remove on actual leave, not on internal child enter/leave.
    if (e.target === listEl) listEl.classList.remove("drop-target");
  });
  listEl.addEventListener("drop", function(e){
    e.preventDefault();
    listEl.classList.remove("drop-target");
    var raw;
    try { raw = e.dataTransfer && e.dataTransfer.getData("text/plain"); }
    catch(_) { raw = null; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch(_) { return; }
    if (!data || !data.itemId || !data.dayId || !data.destId) return;
    if (data.destId !== destId) return; // No cross-destination moves yet.
    if (data.dayId === dayId && data.slot === slot) return; // No-op self drop.
    // Day-trip items are scoped to a single day — don't allow moving
    // a daytrip to evening slot (semantically odd) or to a different
    // day via drag (use the inline picker / chip menu, since those
    // also clean up the chip's placement metadata).
    if (data.isDayTrip && (slot === "evening" || data.dayId !== dayId)) {
      // Allow same-day-different-slot day→day no-op silently.
      return;
    }
    var dest = (typeof getDest === "function") ? getDest(destId) : null;
    if (!dest || !Array.isArray(dest.days)) return;
    var srcDay = null, tgtDay = null;
    for (var i = 0; i < dest.days.length; i++) {
      if (dest.days[i] && dest.days[i].id === data.dayId) srcDay = dest.days[i];
      if (dest.days[i] && dest.days[i].id === dayId) tgtDay = dest.days[i];
    }
    if (!srcDay || !tgtDay) return;
    // Pluck the item from source day's items.
    var srcItems = srcDay.items || [];
    var idx = -1;
    for (var k = 0; k < srcItems.length; k++) {
      if (srcItems[k] && srcItems[k].id === data.itemId) { idx = k; break; }
    }
    if (idx < 0) return;
    var item = srcItems[idx];
    srcItems.splice(idx, 1);
    item.slot = slot;
    if (!Array.isArray(tgtDay.items)) tgtDay.items = [];
    tgtDay.items.push(item);
    if (typeof autoSave === "function") autoSave();
    if (typeof drawDestMode === "function") drawDestMode(destId);
    // v353.1: explicit conflict check on the target day. The redraw
    // above already triggers _renderDestItineraryPane's
    // setTimeout(checkTimeConflicts, 0), so this is technically
    // redundant — but having it inline at the drop site means a
    // future refactor of the render path can't accidentally drop
    // the conflict surfacing for touch drops. The mobile-drag-drop
    // polyfill goes through this same handler via a synthesized
    // drop event, so this fires on phone too.
    if (typeof checkTimeConflicts === "function") {
      checkTimeConflicts(dest, dayId);
      if (data.dayId !== dayId) checkTimeConflicts(dest, data.dayId);
    }
  });
}

function mkItinItem(s, dayId, destId){
  // Round MA.4 (May 2026): the full ~370-line body lifted to
  // trip-ui.js as MaxTripUI.renderItinItem (no opts → full mode,
  // dispatched via renderItinItemFull). This wrapper preserves the
  // function name so the dozens of inline call sites — mkDay, drag-
  // drop replacements, scheduled-item rebuilds — keep working
  // unchanged. Removing the wrapper itself is a future round; small
  // win, large diff.
  return MaxTripUI.renderItinItem(s, dayId, destId);
}

function toggleSightBookForm(row,item,destId,dayId){
  var existing=row.querySelector('.sight-book-form');
  if(existing){existing.parentNode.removeChild(existing);return;}
  var form=document.createElement("div"); form.className="sight-book-form bk-form";
  form.style.cssText="margin:4px 0 4px 12px;padding:8px;background:var(--c-panel);border-radius:6px;";
  // v359.60.71: derive a sensible default date for the booking. When
  // the sight is on a specific day (dayId set + day has .date), use
  // that. When the sight is unscheduled (suggestion), fall back to
  // the destination's check-in date. The user can override either.
  var _defaultDate = "";
  if (item && item.booking && item.booking.date) {
    _defaultDate = item.booking.date;
  } else if (dayId && typeof getDest === "function") {
    var _dst = getDest(destId);
    if (_dst && Array.isArray(_dst.days)) {
      var _matchDay = _dst.days.find(function(d){ return d && d.id === dayId; });
      if (_matchDay && _matchDay.date) _defaultDate = _matchDay.date;
    }
  }
  if (!_defaultDate && typeof getDest === "function") {
    var _dst2 = getDest(destId);
    if (_dst2 && _dst2.dateFrom) _defaultDate = _dst2.dateFrom;
  }
  var dateInp = document.createElement("input");
  dateInp.type = "date";
  dateInp.className = "bk-inp";
  dateInp.value = _defaultDate;
  var r0 = document.createElement("div"); r0.className="bk-row";
  r0.appendChild(mkField("Date", dateInp));
  var r1=document.createElement("div"); r1.className="bk-row";
  var timeInp=document.createElement("input"); timeInp.type="time"; timeInp.className="bk-inp"; timeInp.value=item.booking?item.booking.time||"":"";
  var timeEndInp=document.createElement("input"); timeEndInp.type="time"; timeEndInp.className="bk-inp"; timeEndInp.value=item.booking?item.booking.timeEnd||"":"";
  var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="Confirmation #"; confInp.value=item.booking?item.booking.confirmationNumber||"":"";
  r1.appendChild(mkField("Start",timeInp)); r1.appendChild(mkField("End",timeEndInp)); r1.appendChild(mkField("Conf #",confInp));
  var r2=document.createElement("div"); r2.className="bk-row";
  var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01"; priceInp.value=item.booking?item.booking.pricePaid||"":"";
  var currSel=mkCurrSel("sbf-cur-"+item.id,item.booking?item.booking.currency||"EUR":"EUR");
  r2.appendChild(mkField("Price",priceInp)); r2.appendChild(mkField("Currency",currSel));
  form.appendChild(r0); form.appendChild(r1); form.appendChild(r2);
  var cancelField=mkCancelField("sbf-cancel-"+item.id); form.appendChild(cancelField);
  if(item.booking&&item.booking.cancelType){
    cancelField._restorePolicy&&cancelField._restorePolicy(item.booking.cancelType,item.booking.cancelDeadline);
  }
  var acts=document.createElement("div"); acts.className="bk-form-actions";
  var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save";
  var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
  if(item.booking){
    var del=document.createElement("button"); del.className="bk-rec-btn danger"; del.style.marginLeft="auto"; del.textContent="Remove booking";
    (function(it,did,dId){del.onclick=function(){
      if(it.booking){
        addPendingAction({eventType:'booking',actionType:'Contact provider to adjust or cancel',
          eventName:it.n,destName:getDest(did)?getDest(did).label||getDest(did).place:'',
          confirmationNumber:it.booking.confirmationNumber||null,
          detail:'Contact provider to cancel reservation',requiresProviderAction:true});
      }
      it.booking=null; _emitTripMutation();
    };})(item,destId,dayId);
    acts.appendChild(del);
  }
  cx.onclick=function(){form.parentNode&&form.parentNode.removeChild(form);};
  sv.onclick=function(){
    var cp=cancelField.getCancelPolicy();
    item.booking={
      date:dateInp.value||null,
      time:timeInp.value||null, timeEnd:timeEndInp.value||null,
      confirmationNumber:confInp.value||null,
      pricePaid:parseFloat(priceInp.value)||null, currency:currSel.value,
      cancelType:cp.type, cancelDeadline:cp.deadline, cancelDeadlineTime:cp.deadlineTime||null
    };
    // Sync time to item timeStart/timeEnd if not already set
    if(timeInp.value&&!item.timeStart){item.timeStart=timeInp.value; item.timeEnd=timeEndInp.value||null;}
    _emitTripMutation();
  };
  acts.appendChild(sv); acts.appendChild(cx); form.appendChild(acts);
  row.appendChild(form);
  confInp.focus();
}

function mkItinAddRow(dayId,destId,slot){
  var wrap=document.createElement("div"); wrap.className="itin-add-row";
  // Evening defaults to restaurant, day defaults to sight
  var defaultType=slot==="evening"?"restaurant":"sight";
  var typeBtn=document.createElement("button");
  var currentType=[defaultType];
  if(defaultType==="restaurant"){typeBtn.className="itin-add-type rest-t";typeBtn.textContent="\uD83C\uDF7D Restaurant";}
  else{typeBtn.className="itin-add-type sight-t";typeBtn.textContent="\u25cf Sight";}
  typeBtn.onclick=function(){
    if(currentType[0]==="sight"){currentType[0]="restaurant";typeBtn.textContent="\uD83C\uDF7D Restaurant";typeBtn.className="itin-add-type rest-t";}
    else{currentType[0]="sight";typeBtn.textContent="\u25cf Sight";typeBtn.className="itin-add-type sight-t";}
  };
  var inp=document.createElement("input"); inp.className="itin-add-inp"; inp.id="ai-"+slot+"-"+dayId;
  // Round FN.9: contextual placeholder uses the destination's place
  // name, so the prompt reads as a natural completion ("Sight in
  // Lucerne\u2026") instead of generic "Sight or activity\u2026". Falls back
  // to the generic copy if dest lookup fails.
  var _addDest = (typeof getDest === "function") ? getDest(destId) : null;
  var _addPlace = _addDest && _addDest.place ? _addDest.place : "";
  if (slot === "evening") {
    inp.placeholder = _addPlace ? ("Restaurant or evening activity in " + _addPlace + "\u2026") : "Restaurant or evening activity\u2026";
  } else {
    inp.placeholder = _addPlace ? ("Sight or activity in " + _addPlace + "\u2026") : "Sight or activity\u2026";
  }
  var btn=document.createElement("button"); btn.className="itin-add-btn"; btn.textContent="Add";
  // Round FN.9: tooltip on the disabled Add so users who tap it
  // know why nothing happens. Toggles when the input has 2+ chars.
  btn.title = "Type a name first";
  (function(dId,dstId,sl,ct,b,i){
    i.oninput=function(){
      var ready = i.value.trim().length>=2;
      b.className = ready ? "itin-add-btn on" : "itin-add-btn";
      b.title = ready ? "Add to " + sl + " slot" : "Type a name first";
    };
    i.onkeydown=function(e){if(e.key==="Enter"&&i.value.trim().length>=2)doAI(dId,dstId,ct[0],sl);};
    b.onclick=function(){doAI(dId,dstId,ct[0],sl);};
  })(dayId,destId,slot,currentType,btn,inp);
  wrap.appendChild(typeBtn); wrap.appendChild(inp); wrap.appendChild(btn);
  return wrap;
}

async function suggestRestaurants(destId,dayId,slot,btn){
  if(btn.disabled)return;
  btn.disabled=true; btn.textContent="thinking\u2026";
  var dest=getDest(destId); if(!dest){btn.disabled=false;btn.textContent="\uD83C\uDF7D Suggest restaurants";return;}
  // Remove any existing suggestion box for this day/slot
  var existId="itin-suggest-"+dayId+"-"+slot;
  var existing=g(existId); if(existing)existing.parentNode.removeChild(existing);
  try{
    var text=await callMax([{role:"user",content:"Suggest 3 restaurants in "+dest.place+". For each give: name, neighborhood, one line on what makes it worth going to, and what to order. Be specific and concrete."+(typeof _briefPersonalContext === "function" ? _briefPersonalContext() : "")+"\n\nFormat as a simple list, no markdown headers."}]);
    var box=document.createElement("div"); box.className="itin-suggest-box"; box.id=existId;
    var bHdr=document.createElement("div"); bHdr.style.cssText="font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c06820;margin-bottom:6px;"; bHdr.textContent="Restaurant suggestions";
    box.appendChild(bHdr);
    // Parse lines and make each tappable to add
    text.trim().split(/\n+/).filter(function(l){return l.trim().length>3;}).forEach(function(line){
      var lineEl=document.createElement("div"); lineEl.style.cssText="font-size:11px;padding:4px 0;border-bottom:1px solid #f5e8d0;line-height:1.5;cursor:pointer;";
      lineEl.textContent=line.replace(/^\d+\.\s*/,'').replace(/^[-•]\s*/,'');
      lineEl.title="Click to add to "+slot;
      lineEl.onmouseover=function(){lineEl.style.background="#fff3e0";};
      lineEl.onmouseout=function(){lineEl.style.background="";};
      (function(ln,did,dId,sl){lineEl.onclick=function(){
        // Extract restaurant name (first part before comma or dash or —)
        var rname=ln.split(/[,\-—]/)[0].trim().replace(/^\d+\.\s*/,'');
        if(rname.length>2){
          sidCtr++;
          var ns={id:"s"+sidCtr,type:"restaurant",slot:sl,n:rname,p:"nice",done:false,st:rname+" "+dest.place,note:ln,time:""};
          var d=getDest(did); if(!d)return;
          for(var i=0;i<d.days.length;i++) if(d.days[i].id===dId){if(!d.days[i].items)d.days[i].items=[];d.days[i].items.push(ns);break;}
          _emitTripMutation();
        }
      };})(lineEl.textContent,destId,dayId,slot);
      box.appendChild(lineEl);
    });
    // Insert after the suggest button
    btn.parentNode.insertBefore(box,btn.nextSibling);
  }catch(e){console.error("suggestRestaurants error:",e);}
  btn.disabled=false; btn.textContent="\uD83C\uDF7D Suggest restaurants";
}

// ── Destination mode renderer ──────────────────────────────
function drawDestMode(destId, opts){
  // PD.83c: see drawTripMode for rationale. Picker-active => no render.
  if (document.body && document.body.classList.contains("picker-active")) return;
  // PD.333 (audit B): stamp the dest route ONLY on a FRESH ARRIVAL —
  // the user just navigated here (_leftMode wasn't 'dest', or a
  // different dest was active). Re-renders of the SAME dest (sight
  // added, task toggled, async data landing) are repaints and must
  // not write the URL. opts.noUrlStamp additionally suppresses the
  // stamp for known-repaint callers (renderTripPage / tripChange).
  // The overlay check covers background renders firing under an open
  // Discovery surface.
  var _navFreshArrival = (_leftMode !== "dest") || (activeDest !== destId);
  if (_navFreshArrival && !(opts && opts.noUrlStamp)
      && typeof MaxRoute !== "undefined" && trip && trip.id && destId) {
    var _ddOv = document.getElementById("trip-brief-overlay");
    var _ddCe = document.getElementById("candidate-explorer-overlay");
    var _ddOverlayUp = (_ddOv && _ddOv.style.display && _ddOv.style.display !== "none")
      || (_ddCe && _ddCe.style.display && _ddCe.style.display !== "none");
    if (!_ddOverlayUp) {
      var _curR = MaxRoute.parse();
      if (!_curR || _curR.screen !== MaxRoute.SCREENS.DEST || _curR.destId !== destId) {
        MaxRoute.navigate({ screen: MaxRoute.SCREENS.DEST, tripId: trip.id, destId: destId });
      }
    }
  }
  // Round ED: only scroll to top when the user is ARRIVING at this
  // destination view — coming from trip view, switching to a different
  // dest, etc. When drawDestMode is called as a re-render (same dest,
  // same leftMode — e.g. after adding a sight from Explore, marking a
  // task done, ungrouping a day trip), preserve the scroll position
  // so the user doesn't get yanked back to the top mid-task. After
  // the function rebuilds the DOM (which resets scrollTop to 0), a
  // requestAnimationFrame restore puts the user back where they were.
  var _isFreshArrival = (_leftMode !== "dest") || (activeDest !== destId);
  var _preservedScroll = null;
  var _preservedWinScroll = null;
  if (!_isFreshArrival) {
    var _lpcSave = g("lp-content");
    if (_lpcSave) _preservedScroll = _lpcSave.scrollTop;
    _preservedWinScroll = window.scrollY || window.pageYOffset || 0;
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        var _lpcRestore = g("lp-content");
        if (_lpcRestore && _preservedScroll != null) _lpcRestore.scrollTop = _preservedScroll;
        if (_preservedWinScroll != null) window.scrollTo(0, _preservedWinScroll);
      });
    });
  }
  activeDest=destId;
  _leftMode="dest";
  _mapExecMode=null;
  if (_isFreshArrival) {
    var _lpc = g("lp-content"); if(_lpc) _lpc.scrollTop = 0;
  }
  // If the post-build throttled city-data generation never completed for this
  // destination (interrupted, timed out), kick it off now so the map picks up
  // suggestions instead of staying blank forever.
  var _dNow = getDest(destId);
  if (_dNow) { try { ensureSuggestions(_dNow); } catch(_){} }
  if (_isFreshArrival) window.scrollTo(0, 0);
  document.querySelectorAll('.bk-form').forEach(function(f){if(f.parentNode)f.parentNode.removeChild(f);});
  // v359.2.3: guarded — mode pills removed from the markup.
  var _trBtn = g("mode-trip-btn"); if (_trBtn) _trBtn.className = "mode-btn";
  var _deBtn = g("mode-dest-btn"); if (_deBtn) _deBtn.className = "mode-btn on";
  var sb=document.getElementById('map-style-btn'); if(sb) sb.style.display='block';
  var dest=getDest(destId); if(!dest)return;
  // Reset transient states that shouldn't persist across reloads
  if(dest.storyState==="asking") dest.storyState="idle";
  if(!dest.todayItems)dest.todayItems=[];
  if(!dest.discoveredItems)dest.discoveredItems=[];
  migrateDest(dest);
  // For saved generated cities missing district/info data, fetch it in background
  if(dest.suggestions&&dest.suggestions.length>0&&
     !dest.generatedDistricts&&!_generatedCityData[dest.place.toLowerCase()]){
    fetchCityMeta(dest);
  }
  // Auto-generate restaurants if none exist — lock prevents concurrent calls
  if(!dest.restaurantSuggestions||dest.restaurantSuggestions.length===0){
    var _rl='_restLoading_'+dest.id;
    if(!window[_rl]) refreshRestaurantSuggestions(dest,null);
  }
  // Ensure suggestions exist and have coords — catches any edge case migrateDest misses
  if((!dest.suggestions||dest.suggestions.length===0||dest.suggestions.every(function(s){return !s.lat;}))){
    if(!_generatedCityData[dest.place.toLowerCase()]){
      // No data at all — trigger generation
      generateCityData(dest.place,dest.id);
    } else if(_generatedCityData[dest.place.toLowerCase()]&&!_generatedCityData[dest.place.toLowerCase()].loading){
      // Re-populate from cached generated data if suggestions are missing
      var cached=_generatedCityData[dest.place.toLowerCase()];
      if(cached.sights&&dest.suggestions.length===0){
        var gc=getCityCenter(dest.place)||cached.cityCenter;
        // PD.241: route through the sources model so the user source
        // survives this replay. The drawDestMode cache-replay used to
        // assign directly to dest.suggestions, wiping any user-listed
        // sights that hadn't been auto-seeded into days yet.
        var _cachedNewListInner = cached.sights.map(function(s){
          sidCtr++;
          return {id:"s"+sidCtr,type:"sight",n:s.name,st:s.st||s.name,note:s.desc||null,
            lat:s.lat||(gc?gc[0]+(Math.random()-.5)*.003:null),
            lng:s.lng||(gc?gc[1]+(Math.random()-.5)*.004:null),approx:!s.lat,iconic:!!s.iconic,durationHours:(typeof s.durationHours==="number"&&s.durationHours>0)?s.durationHours:null,url:s.url||null};
        });
        _setLLMSights(dest, _cachedNewListInner);
      }
    }
  }
  var todayIds=getTodayIds(dest);
  var allSights=getAllSights(dest);
  if (typeof _ensureTripInlineSearch === "function") _ensureTripInlineSearch(); // PD.407
  var c=g("lp-content"); if(!c)return;
  c.innerHTML="";

  // Header
  // v359.53.4: "+ Destination" removed from the dest drill-in \u2014 adding
  // a NEW destination is a trip-level action; cluttering the drill-in
  // with it conflated "I'm editing THIS destination" with "I want to
  // create another one." The button still lives on the trip view.
  var hdr=document.createElement("div"); hdr.className="dm-hdr";
  var navRow=document.createElement("div"); navRow.className="dm-hdr-nav";
  var back=document.createElement("button"); back.className="dm-back";
  back.innerHTML="\u2190 Destinations";
  back.onclick=function(){setLeftMode("trip");};
  navRow.appendChild(back);
  hdr.appendChild(navRow);
  // v353.2: dest-mode title is the canonical rename surface (was in
  // the trip-view destination card; relocated here so trip-view
  // stays clean for navigation/reorder). Title shows the user's
  // chosen label (dest.label) when set, falling back to the place
  // name. A small ✎ pencil sits to the right; tapping the pencil
  // OR the title swaps in an inline input. Saving clears
  // dest.label if the input matches the original place (so
  // "Lisbon" → "Lisbon" stops being a custom label).
  var titleWrap = document.createElement("div");
  titleWrap.style.cssText = "display:flex;align-items:baseline;gap:6px;cursor:text;";
  var title=document.createElement("div"); title.className="dm-title"; title.textContent = dest.label || dest.place;
  title.style.flex = "1";
  title.style.minWidth = "0";
  var renPen = document.createElement("button");
  renPen.type = "button";
  renPen.textContent = "✎";
  renPen.title = "Rename destination";
  renPen.style.cssText = "background:none;border:none;color:#999;font-size:14px;cursor:pointer;padding:2px 6px;font-family:inherit;line-height:1;flex-shrink:0;";
  function _startRename() {
    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "tm-rename-inp";
    inp.value = dest.label || dest.place;
    inp.style.cssText = "font-size:18px;font-weight:600;color:var(--c-ink);background:var(--c-bg);border:1px solid var(--c-primary);border-radius:5px;padding:3px 7px;width:100%;font-family:inherit;outline:none;box-shadow:0 0 0 3px rgba(26,95,168,0.12);";
    titleWrap.replaceChild(inp, title);
    renPen.style.display = "none";
    inp.focus();
    inp.select();
    function commit() {
      var v = inp.value.trim();
      dest.label = (v && v !== dest.place) ? v : null;
      // Re-render the dest-mode header so the new label shows.
      // drawDestMode is the entry — it rebuilds the header.
      autoSave();
      drawDestMode(destId);
    }
    inp.onblur = commit;
    inp.onkeydown = function (e) {
      if (e.key === "Enter") inp.blur();
      else if (e.key === "Escape") {
        // Discard: just re-render with the original label.
        drawDestMode(destId);
      }
    };
  }
  title.onclick = _startRename;
  renPen.onclick = function (e) { e.stopPropagation(); _startRename(); };
  titleWrap.appendChild(title);
  titleWrap.appendChild(renPen);
  var datesRow=document.createElement("div"); datesRow.style.cssText="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;";
  // v359.60.58: dates are clickable to open an inline editor right
  // here on the destination card, so the user doesn't have to bounce
  // back to the trip list view to change dates. Pencil + hover bg
  // match the list-view affordance in trip-ui.js.
  var dates=document.createElement("div"); dates.className="dm-dates dm-dates-clickable"; dates.id="ud-dates-"+destId;
  dates.style.cssText="cursor:pointer;padding:3px 6px;margin:-3px -6px;border-radius:4px;transition:background .12s ease;";
  dates.title="Click to edit dates";
  dates.textContent=fmtD(dest.dateFrom)+" \u2013 "+fmtD(dest.dateTo)+" ("+dest.nights+" night"+(dest.nights!==1?"s":"")+")";
  var _dmDatePencil=document.createElement("span");
  _dmDatePencil.textContent=" \u270e";
  _dmDatePencil.style.cssText="font-size:11px;color:var(--c-ink-3);font-weight:400;margin-left:4px;";
  dates.appendChild(_dmDatePencil);
  dates.onmouseover=function(){ dates.style.background="#f0f6fc"; };
  dates.onmouseout =function(){ dates.style.background="transparent"; };
  datesRow.appendChild(dates);
  // Inline date edit row \u2014 hidden until the user clicks the dates.
  var _dmDateEditRow=document.createElement("div");
  _dmDateEditRow.id="dm-date-edit-row-"+destId;
  _dmDateEditRow.style.cssText="display:none;align-items:center;gap:6px;padding:6px 0 2px;flex-wrap:wrap;width:100%;";
  (function(){
    var _dmFi=null, _dmTi=null;
    if (typeof mkDateInp === "function") {
      _dmFi=mkDateInp("dm-edit-from-"+destId, dest.dateFrom, {onSelect:function(iso){
        if (_dmTi) {
          _dmTi.setMin(iso);
          if (_dmTi.getIso() && _dmTi.getIso() < iso) _dmTi.setIso('');
        }
      }});
      _dmTi=mkDateInp("dm-edit-to-"+destId, dest.dateTo, {minDate:dest.dateFrom});
    }
    var _dmArrow=document.createElement("span");
    _dmArrow.style.cssText="font-size:11px;color:var(--c-ink-4);margin:0 2px;";
    _dmArrow.textContent="\u2192";
    var _dmSave=document.createElement("button");
    _dmSave.type="button";
    _dmSave.className="date-save-btn";
    _dmSave.textContent="Save";
    (function(did){
      _dmSave.onclick=function(e){
        e.stopPropagation();
        if (!_dmFi || !_dmTi) return;
        var nf=_dmFi.getIso(), nt=_dmTi.getIso();
        if (!nf || !nt) return;
        saveDates(did, nf, nt);
      };
    })(destId);
    var _dmCancel=document.createElement("button");
    _dmCancel.type="button";
    _dmCancel.className="date-cancel-btn";
    _dmCancel.textContent="Cancel";
    _dmCancel.onclick=function(e){
      e.stopPropagation();
      _dmDateEditRow.style.display="none";
      dates.style.display="";
    };
    _dmDateEditRow.onclick=function(e){ e.stopPropagation(); };
    if (_dmFi) _dmDateEditRow.appendChild(_dmFi);
    _dmDateEditRow.appendChild(_dmArrow);
    if (_dmTi) _dmDateEditRow.appendChild(_dmTi);
    _dmDateEditRow.appendChild(_dmSave);
    _dmDateEditRow.appendChild(_dmCancel);
    dates.onclick=function(e){
      e.stopPropagation();
      var willShow = _dmDateEditRow.style.display === "none";
      _dmDateEditRow.style.display = willShow ? "flex" : "none";
    };
  })();
  datesRow.appendChild(_dmDateEditRow);
  // v353.2: Map button next to the dates. Pans the map to this
  // destination's pin and pulses it. On mobile, where the map is
  // docked at the top of the viewport, this gives a fast "where is
  // this on the map" affordance without leaving the destination
  // view. On desktop the same button works to re-center the right-
  // panel map on the active destination. If the map is currently
  // collapsed (mobile rp-collapsed state), highlightDestOnMap
  // expands it first.
  var dmMapBtn=document.createElement("button");
  dmMapBtn.type="button";
  dmMapBtn.textContent="\ud83d\udccd";
  dmMapBtn.title="Show on map";
  dmMapBtn.style.cssText="background:none;border:1px solid var(--c-border-2);cursor:pointer;padding:3px 8px;border-radius:5px;font-size:13px;line-height:1;font-family:inherit;color:var(--c-primary);transition:background .12s ease, border-color .12s ease;";
  dmMapBtn.onmouseover=function(){dmMapBtn.style.background="#eef5ff";dmMapBtn.style.borderColor="#c8dff8";};
  dmMapBtn.onmouseout=function(){dmMapBtn.style.background="none";dmMapBtn.style.borderColor="#e8e8e8";};
  (function(did){dmMapBtn.onclick=function(e){e.stopPropagation();if(typeof highlightDestOnMap==="function")highlightDestOnMap(did);};})(destId);
  datesRow.appendChild(dmMapBtn);
  // (Trip-wide running total used to render here; removed because it duplicated
  // the trip-level banner shown on the trip view. The destination view should
  // be about THIS destination, not the whole trip.)

  // Attached events row — shows must-do events anchored to this destination
  // (routes passing through, conditions viable here), plus recovery-day flag
  var events = dest.attachedEvents || [];
  var hasEvents = events.length > 0;
  var hasRecovery = !!dest._recoveryDay;
  if (hasEvents || hasRecovery) {
    var eventsRow = document.createElement("div");
    eventsRow.style.cssText = "margin-bottom:10px;display:flex;flex-wrap:wrap;gap:6px;";
    events.forEach(function(ev){
      var chip = document.createElement("div");
      var isCondition = ev.type === "condition";
      var bg = isCondition ? "#fff8f0" : "#e8f0fc";
      var border = isCondition ? "#f0dcc0" : "#c8d8f0";
      var color = isCondition ? "#b05820" : "#1a5fa8";
      var icon = isCondition ? "\u2728" : "\ud83d\ude82";
      chip.style.cssText = "font-size:10px;font-weight:600;color:"+color+";background:"+bg+";border:1px solid "+border+";padding:3px 9px;border-radius:11px;display:inline-flex;align-items:center;gap:5px;";
      var modeLabel = "";
      if (ev.modeOptions === "both" && !ev.chosenMode) modeLabel = " \u00b7 mode to decide";
      else if (ev.chosenMode === "tourist") modeLabel = " \u00b7 tourist train";
      else if (ev.chosenMode === "regional") modeLabel = " \u00b7 regional";
      chip.innerHTML = icon + " " + ev.name + modeLabel;
      if (ev.description) chip.title = ev.description;
      eventsRow.appendChild(chip);
    });
    if (hasRecovery) {
      var rChip = document.createElement("div");
      var recColor = dest._recoveryDay === "high" ? "#b05820" : "#888";
      var recBg = dest._recoveryDay === "high" ? "#fff8f0" : "#f5f5f5";
      var recBorder = dest._recoveryDay === "high" ? "#f0dcc0" : "#ddd";
      rChip.style.cssText = "font-size:10px;font-weight:600;color:"+recColor+";background:"+recBg+";border:1px solid "+recBorder+";padding:3px 9px;border-radius:11px;font-style:italic;";
      var recText = dest._recoveryDay === "high" ? "easy day \u2014 recovery" : "slower pace";
      if (dest._recoveryFor) rChip.title = "After last night's " + dest._recoveryFor;
      rChip.textContent = recText;
      eventsRow.appendChild(rChip);
    }
    // We'll append this row later, after datesRow, inside hdr
    dest._eventsRowEl = eventsRow;
  }

  // Story + compare map buttons
  var dmActs=document.createElement("div"); dmActs.className="dm-actions";
  var stBtn2=document.createElement("button"); stBtn2.className="dm-act-btn tlink story-tl";
  stBtn2.id="dsb-"+dest.id;
  // Round FI: clearer button copy.
  //   Old: "story: Zurich \u2197"  \u2014 colon-prefixed key/value pattern that
  //        didn't read as an action; the \u2197 glyph implied "external
  //        link" but the narrative actually opens inline.
  //   New: "About Zurich \u2192"  \u2014 verb-fronted phrase, \u2192 glyph correctly
  //        signals "expand inline." Matches the convention used by
  //        other expand-style affordances in the app. Tooltip
  //        previews what clicking will produce so a first-time user
  //        doesn't have to guess.
  // (Compare tiles next door is on its way out, so no need to align
  // the styling against it longer term.)
  stBtn2.title = "Max-voiced narrative \u2014 character, history, travel-relevant context.";
  if(dest.storyState==="done"&&_destStories[dest.id]){
    stBtn2.textContent="About "+dest.place+" \u2713"; stBtn2.className="dm-act-btn tlink story-tl asked";
  } else {
    dest.storyState="idle"; // reset so button works
    stBtn2.textContent="About "+dest.place+" \u2192";
  }
  (function(d){stBtn2.onclick=function(){destStory(d);};})(dest);
  var cmpBtn=document.createElement("button"); cmpBtn.className="dm-act-btn";
  cmpBtn.textContent="Compare tiles";
  (function(did){cmpBtn.onclick=function(){openMap(did);};})(dest.id);
  dmActs.appendChild(stBtn2); dmActs.appendChild(cmpBtn);
  // PD.411: notes affordance is now the shared bare 📓 icon (identical to
  // the Discovery row and the trip overview card) instead of the old wide
  // "📓 {place} notes" text button. One helper, one look, everywhere.
  var notesBtn = (typeof _notesIconBtn === "function")
    ? _notesIconBtn(dest.place)
    : document.createElement("button");
  dmActs.appendChild(notesBtn);

  var dsw=document.createElement("div"); dsw.id="dsw-"+dest.id;
  // Re-render cached story if available
  if(dest.storyState==="done"&&_destStories[dest.id]){
    var cachedStory=_destStories[dest.id];
    var cBox=document.createElement("div"); cBox.className="dest-story-box";
    var cP=document.createElement("div"); cP.style.cssText="margin-bottom:8px;line-height:1.8;"; cP.textContent=cachedStory.text;
    var cActs=document.createElement("div"); cActs.className="story-actions";
    var cDig=document.createElement("button"); cDig.className="story-btn"; cDig.textContent="Dig deeper \u2197";
    var cDcId="dsw-"+dest.id+"-deep";
    (function(pl,did,sp,txt,dcid){cDig.onclick=function(){cDig.disabled=true;cDig.textContent="thinking\u2026";digDeeper(pl,did,sp,txt,dcid).then(function(){cDig.disabled=false;cDig.textContent="Dig deeper \u2197";});};})(dest.place,dest.id,cachedStory.prompt,cachedStory.text,cDcId);
    var cCls=document.createElement("button"); cCls.className="story-btn cb"; cCls.textContent="Hide";
    (function(d,b,box){cCls.onclick=function(){
      box.style.display="none";
      // Keep storyState="done" and _destStories cache intact so it restores on redraw
      b.textContent="About "+d.place+" \u2713";
      b.className="dm-act-btn tlink story-tl asked";
    };})(dest,stBtn2,cBox);
    cActs.appendChild(cDig); cActs.appendChild(cCls);
    var cDd=document.createElement("div"); cDd.id=cDcId;
    cBox.appendChild(cP); cBox.appendChild(cActs); cBox.appendChild(cDd);
    dsw.appendChild(cBox);
  }
  var ovWarn=document.createElement("div"); ovWarn.id="ov-warn-"+dest.id; ovWarn.className="overlap-warn hidden";

  // v353.2: append the title WRAP (which holds title + ✎ pencil) so
  // tapping either opens the inline rename input. See _startRename.
  hdr.appendChild(titleWrap); hdr.appendChild(datesRow);

  // TM.7.4 (v332): logistics block (arrival on first dest, departure
  // on last) lifted into MaxTripUI.renderDestLogistics. Same DOM,
  // same "Add them →" link wiring back to trip view.
  MaxTripUI.renderDestLogistics(trip, dest, hdr);

  if (dest._eventsRowEl) hdr.appendChild(dest._eventsRowEl);

  // Round CQ.4: removed the auto-rendered narrative block from CQ.3.
  // The existing "story:" button on this page already produces a richer
  // narrative on demand (see destStory) — auto-opening was redundant and
  // intrusive. The picker's "?" popup remains for the decision-time
  // version; this page's "story: X ↗" button covers the longer read.

  // v359.60.69: header day-trip chip strip removed. The See and do
  // tab's Day trips section (v359.60.67) now surfaces the same
  // routes with day-picker capsules, so the chip strip duplicated
  // information. _renderDayTripChips still exists if a future
  // surface wants it.

  hdr.appendChild(dmActs); hdr.appendChild(dsw); hdr.appendChild(ovWarn);
  c.appendChild(hdr);

  // Max says... — unsolicited observation, rendered below the header
  renderMaxNoteCard(dest, c);

  // v359.60.60: "Action needed" alert banner — per-destination
  // count of open provider actions + upcoming cancellation
  // deadlines. Click jumps straight to the Action needed tab.
  if (typeof MaxTripUI.renderActionNeededAlert === "function") {
    MaxTripUI.renderActionNeededAlert(dest, c);
  }

  // TM.7.3 (v332): pending-cancellations banner lifted.
  MaxTripUI.renderPendingCancellationsBanner(dest, c);

  // PD.418: the inline "Keep in mind" editor is retired. Notes are now
  // one per-place store (PD.416) reached via the 📓 icon on the card,
  // whose dialog already has notes + links + dictation — so the inline
  // editor was a redundant second surface (and the one showing raw HTML
  // from stale data). The 📓 button remains the single notes affordance.
  // (MaxTripUI.renderResearch / _renderResearch are left defined but
  // unused; trivial to re-enable if we want an inline preview back.)

  // TM.7.6 (v332): destination tab bar lifted into
  // MaxTripUI.renderDestTabBar. Same 6 tabs (Itinerary / Explore /
  // Stay / Routing / On the ground / Tracking…), same lazy-render of
  // execution-mode info on first activation, same map refresh on
  // map-relevant tab switches, same tracker badge driven by
  // pendingCount.
  MaxTripUI.renderDestTabBar(dest, c);

  // Tab panes container
  var paneWrap=document.createElement("div"); paneWrap.className="dm-tab-body"; paneWrap.id="dm-pane-wrap";

  // TM.7.7 (v333): itinerary pane lifted into
  // MaxTripUI.renderDestItineraryPane. Same day-by-day cards
  // (arrival chip, items via mkItinItem, restaurant suggest button,
  // departure transport on the last destination), same Later/Maybe
  // buckets, same delayed checkTimeConflicts pass.
  MaxTripUI.renderDestItineraryPane(trip, dest, paneWrap);

  // EXPLORE pane — v359.60.60: now part of the "See and do" tab
  // alongside the daily schedule (sights pane), since both surfaces
  // are about deciding what to do with this destination's days.
  var explorePane=document.createElement("div"); explorePane.id="dm-pane-explore";
  explorePane.style.display=(typeof MaxTripUI!=="undefined"&&MaxTripUI._isPaneInActiveGroup&&MaxTripUI._isPaneInActiveGroup("explore"))?"block":"none";
  explorePane.appendChild(buildExplorePane(dest));
  paneWrap.appendChild(explorePane);
  // TM.7.8 (v333): stay pane lifted into MaxTripUI.renderDestStayPane.
  MaxTripUI.renderDestStayPane(dest, paneWrap);

  // TM.7.9 (v333): info pane lifted into MaxTripUI.renderDestInfoPane.
  MaxTripUI.renderDestInfoPane(dest, paneWrap);

  // TM.7.10 (v333): routing + tracker panes lifted together.
  MaxTripUI.renderDestRoutingAndTrackerPanes(trip, dest, paneWrap);

  // v359.60.69: Bookings pane (roll-up of all bookings for this dest).
  if (typeof MaxTripUI.renderDestBookingsPane === "function") {
    MaxTripUI.renderDestBookingsPane(trip, dest, paneWrap);
  }

  c.appendChild(paneWrap);

  // Ask Max
  var ffRow2=document.createElement("div"); ffRow2.className="frow"; ffRow2.style.cssText="padding:0 14px 14px;flex-shrink:0;";
  var finp2=document.createElement("input"); finp2.className="finp"; finp2.id="ff-"+dest.id;
  finp2.placeholder="Ask Max about "+dest.place+"\u2026";
  (function(did){finp2.oninput=function(){var v=finp2.value.trim();g("ffb-"+did).className=v.length>=2?"taddBtn on":"taddBtn";};
  finp2.onkeydown=function(e){if(e.key==="Enter")doFF(did);};})(dest.id);
  var ffb2=document.createElement("button"); ffb2.className="taddBtn"; ffb2.id="ffb-"+dest.id; ffb2.textContent="Ask \u2197";
  (function(did){ffb2.onclick=function(){doFF(did);};})(dest.id);
  ffRow2.appendChild(finp2); ffRow2.appendChild(ffb2);
  c.appendChild(ffRow2);
  var ffw2=document.createElement("div"); ffw2.id="ff-wrap-"+dest.id; ffw2.style.cssText="padding:0 14px 8px;"; c.appendChild(ffw2);

  updateMainMap();
  checkAndShowOverlaps();
  setTimeout(function(){if(_mainMap)_mainMap.invalidateSize();},80);

  // Also update mobile sheet
  var shBody=g("mob-sheet-body");
  if(shBody){
    shBody.innerHTML="";
    var shTitle=document.createElement("div"); shTitle.style.cssText="font-size:13px;font-weight:600;padding:8px 6px 4px;"; shTitle.textContent=dest.place;
    shBody.appendChild(shTitle);
    allSights.slice(0,5).forEach(function(s){shBody.appendChild(mkExSight(s,dest,todayIds,allSights,"pool"));});
  }
}

// TM.6 (v330): drawItin legacy wrapper deleted. 4 remaining callers
// inlined as `if(activeDest) drawDestMode(activeDest);`. The 7
// mutator-pattern callers were migrated to `_emitTripMutation()` as
// part of TM.4 batch 3 (the wrapper was hiding them from the original
// audit since I was searching for drawTripMode/drawDestMode directly).


function buildRoutingSection(fromDest, toDest, label){
  var fromPlace=fromDest.place, toPlace=toDest.place;
  var fromId=fromDest.id, toId=toDest.id;
  var sec=document.createElement("div"); sec.style.cssText="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--c-border-5);";
  var lbl=document.createElement("div"); lbl.className="gh-lbl"; lbl.textContent=label; sec.appendChild(lbl);
  var routing=getRouting(fromPlace,toPlace);
  if(routing){
    routing.options.forEach(function(opt,oi){
      var row=document.createElement("div"); row.className="gh-option";
      var icon=document.createElement("div"); icon.className="gh-icon"; icon.textContent=opt.icon;
      var bd=document.createElement("div"); bd.className="gh-body";
      var nm=document.createElement("div"); nm.className="gh-name"; nm.textContent=opt.name;
      var mt=document.createElement("div"); mt.className="gh-meta"; mt.textContent=opt.meta;
      var nt=document.createElement("div"); nt.className="gh-note"; nt.textContent=opt.note;
      bd.appendChild(nm); bd.appendChild(mt); bd.appendChild(nt);
      if(opt.book){var bk=document.createElement("a");bk.className="gh-book";bk.href=opt.book;bk.target="_blank";bk.textContent="Book \u2197";bd.appendChild(bk);}
      // Log booking button + records container
      var bkWrap=document.createElement("div");
      var logBtn=document.createElement("button"); logBtn.className="bk-log-btn"; logBtn.textContent="Book";
      var formId="bkf-"+fromId+"-"+toId+"-"+oi;
      (function(btn,wrap,fId,tId,o){
        btn.onclick=function(){toggleTransportForm(btn,wrap,formId,{
          mode:o.mode||"train",operator:o.name,from:fromPlace,to:toPlace,
          fromId:fId,toId:tId,defaultDate:fromDest.dateTo,currency:"EUR"
        });};
      })(logBtn,bkWrap,fromId,toId,opt);
      bkWrap.appendChild(logBtn);
      // Render existing bookings for this leg matching this operator
      var leg=getLeg(fromId,toId);
      leg.bookings.filter(function(b){return b.operator===opt.name;}).forEach(function(b){
        bkWrap.appendChild(mkTransportRecord(b,fromId,toId));
      });
      bd.appendChild(bkWrap);
      row.appendChild(icon); row.appendChild(bd); sec.appendChild(row);
    });
  } else {
    var mr=document.createElement("div"); mr.className="gh-max-row";
    var mb=document.createElement("button"); mb.className="gh-max-btn"; mb.textContent="Ask Max for options \u2197";
    var mresp=document.createElement("div"); mresp.className="gh-max-resp hidden";
    (function(f,t,b,r){b.onclick=async function(){
      b.disabled=true; b.textContent="thinking\u2026";
      try{var txt=await callMax([{role:"user",content:"How do I get from "+f+" to "+t+"? Give 2-3 options with duration and price. Be brief."}]);
        r.textContent=txt;r.classList.remove("hidden");b.style.display="none";
      }catch(e){b.disabled=false;b.textContent="Ask Max for options \u2197";}
    };})(fromPlace,toPlace,mb,mresp);
    mr.appendChild(mb); mr.appendChild(mresp);
    // Always show Log booking even without pre-defined route data
    var genWrap=document.createElement("div"); genWrap.style.marginTop="8px";
    var genLogBtn=document.createElement("button"); genLogBtn.className="bk-log-btn"; genLogBtn.textContent="Book";
    var genFormId="bkf-"+fromId+"-"+toId+"-gen";
    (function(btn,wrap,fId,tId){
      btn.onclick=function(){toggleTransportForm(btn,wrap,genFormId,{
        mode:"train",operator:"",from:fromPlace,to:toPlace,
        fromId:fId,toId:tId,defaultDate:fromDest.dateTo,currency:"EUR"
      });};
    })(genLogBtn,genWrap,fromId,toId);
    genWrap.appendChild(genLogBtn);
    var leg0=getLeg(fromId,toId);
    leg0.bookings.forEach(function(b){genWrap.appendChild(mkTransportRecord(b,fromId,toId));});
    mr.appendChild(genWrap); sec.appendChild(mr);
  }
  return sec;
}


// ── Days and sights ────────────────────────────────────────
// makeDays moved to engine-trip.js (Round HR).

function mkDay(day, destId){
  // Round MA.4: mkDay routes through MaxTripUI.renderDay (no opts →
  // full mode item renderer). Visual structure (.dayblock / .dayhdr /
  // .slist) is identical because renderDay was modeled on this.
  // SCAFFOLD-6 slice 2: compute the per-day rationale here (we have
  // dest + dayIdx context that renderDay's signature lacks) and pass
  // it through opts. renderDay renders the "?" affordance when
  // opts.rationale is non-null.
  var dest = (typeof getDest === "function") ? getDest(destId) : null;
  var dayIdx = -1;
  if (dest && Array.isArray(dest.days)) {
    for (var _di = 0; _di < dest.days.length; _di++) {
      if (dest.days[_di] && dest.days[_di].id === day.id) { dayIdx = _di; break; }
    }
  }
  var rationale = (typeof dayRationale === "function" && dest && dayIdx >= 0)
    ? dayRationale(day, dayIdx, dest)
    : null;
  // SCAFFOLD-5 slice 2: now/next widget. Only renders on today's day
  // during a 'during' phase trip. Computes a small HTML block that
  // renderDay drops between the day header and the items list.
  // v304 also computes a per-item time-state map (past/current/next/
  // later) keyed by item.id and passes it to renderItinItemFull via
  // opts so the rows themselves get visual cues — past dimmed,
  // current outlined, next marked.
  var todayWidget = null;
  var itemTimeStates = null;
  if (typeof currentTripStatus === "function" && typeof currentDayItems === "function") {
    var status = currentTripStatus(trip);
    if (status && status.phase === "during" && status.currentDayId === day.id) {
      var split = currentDayItems(day);
      todayWidget = _buildNowNextWidgetHtml(split);
      itemTimeStates = {};
      split.past.forEach(function(it){    if (it.id) itemTimeStates[it.id] = "past";    });
      split.current.forEach(function(it){ if (it.id) itemTimeStates[it.id] = "current"; });
      if (split.next && split.next.id) itemTimeStates[split.next.id] = "next";
      split.later.forEach(function(it){   if (it.id) itemTimeStates[it.id] = "later";   });
    }
  }
  return MaxTripUI.renderDay(day, destId, {
    rationale: rationale,
    todayWidget: todayWidget,
    itemTimeStates: itemTimeStates,
  });
}

// SCAFFOLD-5 slice 2: builds the now/next widget HTML from
// currentDayItems output. Returns "" when there's nothing useful
// to show (no current item, no upcoming items, no past items).
function _buildNowNextWidgetHtml(split) {
  if (!split) return "";
  function _esc(s){ return _escHtml(s); }
  function _now() {
    var d = new Date();
    return ('0'+d.getHours()).slice(-2) + ':' + ('0'+d.getMinutes()).slice(-2);
  }
  var nowStr = _now();
  var lines = [];
  // CURRENT — "Right now: X · 47 min left"
  if (split.current && split.current.length) {
    split.current.forEach(function(it){
      var endTime = it.timeEnd || it.timeStart;
      var minsLeft = (typeof clockMinutesBetween === "function" && endTime)
        ? clockMinutesBetween(nowStr, endTime) : null;
      var tail = "";
      if (minsLeft !== null && minsLeft >= 0) {
        if (minsLeft >= 60) {
          var h = Math.floor(minsLeft / 60), m = minsLeft % 60;
          tail = " · " + h + "h" + (m ? " " + m + "m" : "") + " left";
        } else {
          tail = " · " + minsLeft + " min left";
        }
      }
      lines.push('<div style="font-size:11.5px;color:#0e3a6a;line-height:1.55;">'
        + '<span style="font-size:9.5px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;margin-right:8px;">Right now</span>'
        + '<strong>' + _esc(it.n || "") + '</strong>'
        + tail
        + '</div>');
    });
  }
  // NEXT — "Next: Y at 1pm · in 1h 13m"
  if (split.next) {
    var n = split.next;
    var startTime = n.timeStart || n.timeEnd;
    var minsUntil = (typeof clockMinutesBetween === "function" && startTime)
      ? clockMinutesBetween(nowStr, startTime) : null;
    var until = "";
    if (minsUntil !== null && minsUntil >= 0) {
      if (minsUntil >= 60) {
        var hh = Math.floor(minsUntil / 60), mm = minsUntil % 60;
        until = " · in " + hh + "h" + (mm ? " " + mm + "m" : "");
      } else {
        until = " · in " + minsUntil + " min";
      }
    }
    var atTime = startTime ? " at " + startTime : "";
    lines.push('<div style="font-size:11.5px;color:#444;line-height:1.55;margin-top:3px;">'
      + '<span style="font-size:9.5px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-right:8px;">Next</span>'
      + '<strong>' + _esc(n.n || "") + '</strong>'
      + atTime
      + until
      + '</div>');
  }
  // LATER — "Later: A, B, C"
  if (split.later && split.later.length) {
    var laterNames = split.later.map(function(it){ return _esc(it.n||""); }).join(", ");
    lines.push('<div style="font-size:10.5px;color:var(--c-ink-3);line-height:1.55;margin-top:3px;">'
      + '<span style="font-size:9.5px;font-weight:700;color:var(--c-ink-4);text-transform:uppercase;letter-spacing:0.05em;margin-right:8px;">Later today</span>'
      + laterNames
      + '</div>');
  }
  // PAST — when there are past items but nothing current/next, mention them.
  // Otherwise skip — they're already visible struck-through in the list below.
  if (!split.current.length && !split.next && split.past.length) {
    lines.push('<div style="font-size:10.5px;color:var(--c-ink-4);line-height:1.55;margin-top:3px;font-style:italic;">'
      + 'All scheduled items today are done.'
      + '</div>');
  }
  // UNTIMED — note count if there are untimed items not surfaced above.
  if (split.untimed.length && (split.current.length || split.next || split.past.length)) {
    var u = split.untimed.length;
    lines.push('<div style="font-size:10px;color:#999;line-height:1.55;margin-top:3px;">'
      + u + ' untimed item' + (u === 1 ? '' : 's') + ' on today — see list below.'
      + '</div>');
  }
  if (!lines.length) return "";
  // v353.6: Today's weather slot — empty placeholder span that
  // renderDay populates asynchronously via renderDayWeatherChip.
  // Sits inside the widget header row so it reads "Today, May 10
  // 🌤️ 18°/9°" at a glance.
  var wxRow = '<div class="now-next-wx-row" style="font-size:10.5px;color:#5a7a9a;margin-bottom:4px;display:flex;align-items:center;gap:6px;">'
    + '<span style="font-weight:700;text-transform:uppercase;letter-spacing:0.05em;font-size:9.5px;color:var(--c-primary);">Today</span>'
    + '<span class="now-next-wx-slot"></span>'
    + '</div>';
  return '<div class="now-next-widget" style="margin:6px 0 8px;padding:8px 11px;background:linear-gradient(135deg,#eaf3fb 0%,#dcecf8 100%);border:1px solid var(--c-border-blue);border-radius:6px;">'
    + wxRow
    + lines.join("")
    + '</div>';
}

function mkSight(s,dayId,destId){
  var r=document.createElement("div");
  r.className="srow"+(s.done?" done":""); r.id="sr-"+s.id;
  var dot=document.createElement("div"); dot.className="pdot "+s.p;
  (function(id,did){dot.onclick=function(){togP(id,did);};})(s.id,destId);
  var name=document.createElement("span"); name.className="sname"; name.textContent=s.n;
  // v287: tap the name to highlight the matching pin on the map
  // (pan + zoom + open tooltip + brief pulse animation).
  name.title = "Show on map";
  (function(id){ name.onclick = function(){ if (typeof highlightSightOnMap === "function") highlightSightOnMap(id); }; })(s.id);
  var acts=document.createElement("div"); acts.className="sacts";
  if(s.st){
    var stb=document.createElement("button"); stb.className="sa ssa"; stb.id="ssa-"+s.id;
    stb.setAttribute("data-state","idle"); stb.textContent="story \u2197";
    (function(id,did){stb.onclick=function(){sStory(id,did);};})(s.id,destId);
    acts.appendChild(stb);
  }
  var db=document.createElement("button"); db.className="sa "+(s.done?"usa":"dsa");
  db.textContent=s.done?"undo":"done \u2713";
  (function(id,did){db.onclick=function(){s.done?uDone(id,did):mDone(id,did);};})(s.id,destId);
  acts.appendChild(db);
  var mb=document.createElement("button"); mb.className="sa msa"; mb.textContent="move";
  (function(id,did){mb.onclick=function(e){e.stopPropagation();togMov(id,dayId,did,e);};})(s.id,destId);
  acts.appendChild(mb);
  var xb=document.createElement("button"); xb.className="sa"; xb.textContent="\u2715";
  (function(id,did){xb.onclick=function(){delS(id,dayId,did);};})(s.id,destId);
  acts.appendChild(xb);
  var top2=document.createElement("div"); top2.className="srow-top";
  top2.appendChild(dot); top2.appendChild(name);
  acts.className="srow-btns";
  r.appendChild(top2); r.appendChild(acts);
  return r;
}

function fS(sid,destId){
  var dest=getDest(destId);if(!dest)return null;
  for(var i=0;i<dest.days.length;i++){var _items=dest.days[i].items||dest.days[i].sights||[];for(var j=0;j<_items.length;j++) if(_items[j].id===sid) return _items[j];}
  if(dest.discoveredItems) for(var k=0;k<dest.discoveredItems.length;k++) if(dest.discoveredItems[k].id===sid) return dest.discoveredItems[k];
  if(dest.suggestions) for(var m=0;m<dest.suggestions.length;m++) if(dest.suggestions[m].id===sid) return dest.suggestions[m];
  if(dest.restaurantSuggestions) for(var n=0;n<dest.restaurantSuggestions.length;n++) if(dest.restaurantSuggestions[n].id===sid) return dest.restaurantSuggestions[n];
  if(dest.laterItems) for(var p=0;p<dest.laterItems.length;p++) if(dest.laterItems[p].id===sid) return dest.laterItems[p];
  if(dest.maybeItems) for(var q=0;q<dest.maybeItems.length;q++) if(dest.maybeItems[q].id===sid) return dest.maybeItems[q];
  return null;
}
function fDayOf(sid,destId){
  var dest=getDest(destId);if(!dest)return null;
  for(var i=0;i<dest.days.length;i++){var _items2=dest.days[i].items||dest.days[i].sights||[];for(var j=0;j<_items2.length;j++) if(_items2[j].id===sid) return dest.days[i];}
  return null;
}

function togP(sid,destId){
  var s=fS(sid,destId);if(!s)return;
  s.p=s.p==="must"?"nice":"must";
  var dot=document.querySelector("#sr-"+sid+" .pdot");
  if(dot)dot.className="pdot "+s.p;
}
function mDone(sid,destId){
  var s=fS(sid,destId);if(!s)return; s.done=true;
  var dest=getDest(destId);if(dest){dest.trackerItems.visited.push(s.n);renderTList(dest,"visited");}
  var day=fDayOf(sid,destId);var old=g("sr-"+sid);
  if(old&&day)old.parentNode.replaceChild(mkSight(s,day.id,destId),old);
}
function uDone(sid,destId){
  var s=fS(sid,destId);if(!s)return; s.done=false;
  var day=fDayOf(sid,destId);var old=g("sr-"+sid);
  if(old&&day)old.parentNode.replaceChild(mkSight(s,day.id,destId),old);
}

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._buildNowNextWidgetHtml = _buildNowNextWidgetHtml;
  __expg._hiddenStories = _hiddenStories;
  __expg._renderRestaurantsSection = _renderRestaurantsSection;
  __expg._wireItinDropTarget = _wireItinDropTarget;
  __expg.buildBucketSection = buildBucketSection;
  __expg.buildExplorePane = buildExplorePane;
  __expg.buildHotelChip = buildHotelChip;
  __expg.buildRestaurantSection = buildRestaurantSection;
  __expg.buildRoutingSection = buildRoutingSection;
  __expg.buildTransportChip = buildTransportChip;
  __expg.drawDestMode = drawDestMode;
  __expg.fDayOf = fDayOf;
  __expg.fS = fS;
  __expg.mDone = mDone;
  __expg.mkCachedStoryBox = mkCachedStoryBox;
  __expg.mkDay = mkDay;
  __expg.mkExploreSuggestion = mkExploreSuggestion;
  __expg.mkItinAddRow = mkItinAddRow;
  __expg.mkItinItem = mkItinItem;
  __expg.mkSight = mkSight;
  __expg.refreshRestaurantSuggestions = refreshRestaurantSuggestions;
  __expg.showAddToDay = showAddToDay;
  __expg.suggestRestaurants = suggestRestaurants;
  __expg.togP = togP;
  __expg.toggleSightBookForm = toggleSightBookForm;
  __expg.uDone = uDone;
}
