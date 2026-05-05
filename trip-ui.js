// trip-ui.js — Shared trip-view rendering between desktop and mobile.
//
// Where this fits:
//   db.js              persistence + DB-event bus
//   engine-trip.js     trip state + mutators + FQ verdict pipeline
//   engine-picker.js   picker state + orderKept + publishTrip
//   picker-ui.js       picker DOM rendering (desktop-only)
//   trip-ui.js         (THIS FILE) trip-view DOM rendering, used by
//                      both desktop (index.html) and mobile (mobile/index.html)
//   index.html         desktop UI shell — shrinking
//   mobile/index.html  mobile UI shell
//
// Round MA.2 (May 2026) — first piece in. The full mkItinItem
// (~330 lines, with drag handles, time editor, booking forms, day-trip
// sub-rows) stays inline in index.html for now; this file ships the
// SEAM and a `compact` renderer that mobile uses. Future rounds (MA.3+)
// migrate the rich desktop renderer here too, and gate features via
// a `compact` flag — at which point both surfaces call the same code
// and differ only in which buttons render.
//
// Why compact lives here even though it's read-only-ish: the goal is
// "mobile looks like the trip UI." Sharing the day-block structure +
// sight-row visual language is the start. Each round adds capability
// (notes editor, mark-done, etc.); each addition unblocks more of
// path-to-10 Item C.

(function (global) {
  'use strict';

  // ── renderItinItemCompact (Round MA.2) ─────────────────────
  // Minimal sight / restaurant / day-trip row for mobile. Reads:
  //   s.id, s.n, s.p (must|nice), s.type (sight|restaurant|daytrip),
  //   s.done, s.timeStart, s.timeEnd, s.note
  //
  // Renders: priority dot, name, optional time stamp, "done" check.
  // The name has a click handler that calls window.highlightSightOnMap
  // when present (so mobile gets the same tap-to-highlight as desktop's
  // v287). No drag-handle, no edit buttons, no booking forms — those
  // come back in MA.3 once the full mkItinItem is shared.
  function renderItinItemCompact(s, dayId, destId, opts) {
    opts = opts || {};
    var r = document.createElement('div');
    r.className = 'srow' + (s && s.done ? ' done' : '') + (s && s.type === 'daytrip' ? ' daytrip' : '');
    r.id = 'sr-' + (s && s.id);

    // Dot — emoji for restaurants, pin for day-trips, prio dot for sights.
    var dot;
    var isRest = s && s.type === 'restaurant';
    var isDayTrip = s && s.type === 'daytrip';
    if (isRest) {
      dot = document.createElement('span');
      dot.className = 'item-dot-restaurant';
      dot.textContent = '🍽';
      dot.title = 'Restaurant';
    } else if (isDayTrip) {
      dot = document.createElement('span');
      dot.className = 'item-dot-daytrip';
      dot.textContent = '📍';
      dot.title = 'Day trip';
    } else {
      dot = document.createElement('div');
      dot.className = 'item-dot-sight ' + (s && s.p === 'must' ? 'must' : 'nice');
    }

    // Name — taps to highlight on the map (if the helper exists).
    var name = document.createElement('span');
    name.className = 'sname';
    name.textContent = (s && s.n) || '';
    name.title = 'Show on map';
    (function (id) {
      name.onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (typeof global.highlightSightOnMap === 'function') {
          global.highlightSightOnMap(id);
        }
      };
    })(s && s.id);

    var top = document.createElement('div');
    top.className = 'srow-top';
    top.appendChild(dot);
    top.appendChild(name);
    r.appendChild(top);

    // Optional time (read-only in compact).
    if (s && (s.timeStart || s.timeEnd)) {
      var t = document.createElement('div');
      t.className = 'srow-time';
      t.style.opacity = '0.7';
      t.textContent = (s.timeStart || '?') + ' – ' + (s.timeEnd || '?');
      r.appendChild(t);
    }

    // Done indicator. Compact mode shows it as a static check, not a
    // toggle — mark-as-done mutates the trip and we want that
    // capability when MA.3 lands the full row.
    if (s && s.done) {
      var done = document.createElement('div');
      done.style.cssText = 'font-size:10px;color:#2a7a4e;margin-left:18px;margin-top:1px;';
      done.textContent = '✓ done';
      r.appendChild(done);
    }

    // Optional inline note (free-text the LLM stamped on the item, or
    // user added). Plain prose, muted.
    if (s && s.note) {
      var n = document.createElement('div');
      n.style.cssText = 'font-size:11px;color:#777;margin-left:18px;margin-top:2px;line-height:1.4;';
      n.textContent = s.note;
      r.appendChild(n);
    }

    return r;
  }

  // ── renderItinItemFull (Round MA.4 — lifted from index.html) ─
  // The full ~370-line itinerary-item renderer. Used to live inline
  // as window.mkItinItem; lifted here in MA.4 so both desktop (full
  // mode) and mobile (compact mode) flow through one body in one
  // file. Inline desktop's mkItinItem is now a thin delegator that
  // calls MaxTripUI.renderItinItem(s, dayId, destId) (no opts → full).
  //
  // External-global references are prefixed with `global.`:
  //   functions:  fS, autoSave, drawDestMode, getDest,
  //               _sightExternalUrl, _openSightUrlEditor, sStory,
  //               togMov, toggleSightBookForm, delS, fmtD,
  //               checkTimeConflicts, removeDayTripFromDayItem,
  //               ungroupDayTrip, highlightSightOnMap
  //   state:      _generatedCityData (read), _activeDmSection
  //               (write), sidCtr (read+write)
  //
  // Lifted verbatim — every comment, every ternary, every fallback.
  // The Playwright spec in tests/playwright/itin-item.spec.js
  // exercises every button to catch any reference-prefix typo.

  function renderItinItemFull(s, dayId, destId){
    var r=document.createElement("div"); r.className="srow"+(s.done?" done":"")+(s.type==="daytrip"?" daytrip":""); r.id="sr-"+s.id;
    var isRest=s.type==="restaurant";
    var isDayTrip=s.type==="daytrip";
    // Round FN.10: drag handle on every itinerary item. The whole row
    // is draggable; on dragstart we stash the source coords (item id,
    // day id, slot) on the dataTransfer so the drop handler in
    // global.drawDestMode can move the item without re-finding it.
    r.draggable = true;
    r.style.cursor = "grab";
    r.addEventListener("dragstart", function(e){
      r.style.opacity = "0.4";
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify({
          itemId: s.id, dayId: dayId, destId: destId, slot: s.slot || "day", isDayTrip: !!isDayTrip
        }));
      }
      document.body.classList.add("itin-dragging");
    });
    r.addEventListener("dragend", function(){
      r.style.opacity = "";
      document.body.classList.remove("itin-dragging");
      // Clean up any lingering hover styles on drop targets.
      document.querySelectorAll(".slist.drop-target").forEach(function(el){
        el.classList.remove("drop-target");
      });
    });
    // Dot/icon
    var dot;
    if(isRest){
      dot=document.createElement("span"); dot.className="item-dot-restaurant"; dot.textContent="\uD83C\uDF7D";
      dot.title="Restaurant";
    } else if(isDayTrip){
      // Round FN.7.4: distinct purple pin for day-trip items so the user
      // sees at a glance this isn't a sight at the hub but a side trip
      // to a different town. Matches the chip-box color treatment.
      dot=document.createElement("span"); dot.className="item-dot-daytrip"; dot.textContent="📍";
      dot.style.cssText="color:#5b3f8f;font-size:13px;flex-shrink:0;width:14px;text-align:center;";
      dot.title="Day trip — leaves the hub, return same day";
    } else {
      // v290: 7px dot was too small to hit reliably (and the row's
      // draggable was eating fast clicks). Wrap in a button-shaped
      // container with ~22px hit area, transparent padding offset by
      // negative margin so the visual layout doesn't shift. Cursor
      // and hover preview make the affordance discoverable.
      var dotInner = document.createElement("div");
      dotInner.className = "item-dot-sight " + (s.p === "must" ? "must" : "nice");
      var dotBtn = document.createElement("button");
      dotBtn.type = "button";
      dotBtn.className = "item-dot-wrap";
      // v290.2: inline cursor wins over the row's `style.cursor='grab'`
      // even on browsers where class+!important didn't; belt-and-
      // suspenders against drag-cursor leaking onto the dot.
      dotBtn.style.cursor = "pointer";
      dotBtn.draggable = false; // keep this button out of the drag flow entirely
      dotBtn.title = (s.p === "must") ? "Marked must — click to mark nice-to-have" : "Marked nice-to-have — click to mark must";
      dotBtn.appendChild(dotInner);
      (function(id, did){
        dotBtn.onclick = function(e){
          e.stopPropagation();
          var sx = global.fS(id, did);
          if (!sx) return;
          sx.p = sx.p === "must" ? "nice" : "must";
          dotInner.className = "item-dot-sight " + (sx.p === "must" ? "must" : "nice");
          dotBtn.title = (sx.p === "must") ? "Marked must — click to mark nice-to-have" : "Marked nice-to-have — click to mark must";
          if (typeof global.autoSave === "function") global.autoSave();
        };
      })(s.id, destId);
      dot = dotBtn;
    }
    var name=document.createElement("span"); name.className="sname"; name.textContent=s.n;
    // v287.3: tap the item name → highlight its pin on the map. Works
    // for sights, restaurants, and day-trip rows alike — they all
    // share the .sname class and have item ids indexed by addPin.
    // Wired here on mkItinItem (the actually-used renderer); the
    // earlier patch wired it on mkSight, which is a legacy function
    // not on the live render path.
    name.title = "Show on map";
    (function(id){ name.onclick = function(ev){ ev.stopPropagation(); if (typeof global.highlightSightOnMap === "function") global.highlightSightOnMap(id); }; })(s.id);
    // Round DF: external-site link (LLM-supplied URL or Google search fallback)
    var _destForS = (typeof global.getDest === "function" && destId) ? global.getDest(destId) : null;
    var _placeForS = (_destForS && _destForS.place) || "";
    var _extS = !isRest ? global._sightExternalUrl(s, _placeForS) : null;
    var extLink = null;
    var extEdit = null;
    if (_extS) {
      extLink = document.createElement("a");
      extLink.href = _extS.url; extLink.target = "_blank"; extLink.rel = "noopener noreferrer";
      extLink.textContent = _extS.isOfficial ? "\u2197" : "\u2197";
      extLink.title = _extS.isOfficial ? "Official site" : "Search the web for this sight";
      extLink.style.cssText = "margin-left:6px;font-size:10px;color:" + (_extS.isOfficial ? "#1a5fa8" : "#999") + ";text-decoration:none;font-weight:600;";
      extLink.onclick = function(e){ e.stopPropagation(); };
      // Round DG: \u270e \u2014 edit the URL
      extEdit = document.createElement("button");
      extEdit.type = "button";
      extEdit.textContent = "\u270e";
      extEdit.title = s.url ? "Edit URL" : "Set a custom URL";
      extEdit.style.cssText = "margin-left:3px;font-size:10px;color:#aaa;background:none;border:none;cursor:pointer;padding:0 2px;font-family:inherit;line-height:1;";
      (function(item,did){extEdit.onclick = function(e){
        e.stopPropagation();
        global._openSightUrlEditor(extEdit, item, function(){ if (did && typeof global.drawDestMode === "function") global.drawDestMode(did); });
      };})(s, destId);
    }
    var acts=document.createElement("div"); acts.className="sacts";
    // Story button
    var stb=document.createElement("button"); stb.className="sa ssa"; stb.id="ssa-"+s.id;
    stb.setAttribute("data-state","idle"); stb.textContent="story \u2197";
    // Round FN.9: tooltip \u2014 bare "story" was opaque about what it did.
    stb.title = "Story about " + (s.n || "this");
    (function(id,did){stb.onclick=function(){global.sStory(id,did);};})(s.id,destId);
    acts.appendChild(stb);
    // Done button
    var db=document.createElement("button"); db.className="sa "+(s.done?"usa":"dsa");
    db.textContent=s.done?"undo":"done \u2713";
    (function(id,did){db.onclick=function(){var sx=global.fS(id,did);if(!sx)return;sx.done=!sx.done;global.autoSave();global.drawDestMode(did);};})(s.id,destId);
    acts.appendChild(db);
    // Move button (with evening/day slot options)
    var mb=document.createElement("button"); mb.className="sa msa"; mb.textContent="move";
    (function(id,did,ev){mb.onclick=function(e){e.stopPropagation();global.togMov(id,dayId,did,e,ev);};})(s.id,destId,s.slot==="evening");
    acts.appendChild(mb);
    // Book button
    var bkb=document.createElement("button"); bkb.className="sa"; bkb.textContent=s.booking?"booked \u2713":"book";
    if(s.booking) bkb.style.cssText="color:#2a7a4e;font-weight:600;";
    (function(item,did,dId){bkb.onclick=function(e){e.stopPropagation();global.toggleSightBookForm(r,item,did,dId);};})(s,destId,dayId);
    acts.appendChild(bkb);
    // Delete button
    var xb=document.createElement("button"); xb.className="sa"; xb.textContent="\u2715";
    (function(id,did){xb.onclick=function(){global.delS(id,dayId,did);};})(s.id,destId);
    acts.appendChild(xb);
    var top=document.createElement("div"); top.className="srow-top";
    top.appendChild(dot); top.appendChild(name);
    if (extLink) top.appendChild(extLink);
    if (extEdit) top.appendChild(extEdit);
    acts.className="srow-btns";

    // Booking info strip if booked
    var bkStrip=null;
    if(s.booking){
      bkStrip=document.createElement("div"); bkStrip.className="bk-record"; bkStrip.style.cssText="margin:3px 0 2px 12px;";
      var bkMain=document.createElement("div"); bkMain.className="bk-rec-main";
      var bkParts=[];
      if(s.booking.time) bkParts.push(s.booking.time+(s.booking.timeEnd?'\u2013'+s.booking.timeEnd:''));
      if(s.booking.confirmationNumber) bkParts.push('Conf: '+s.booking.confirmationNumber);
      if(s.booking.pricePaid) bkParts.push((s.booking.currency||'')+" "+s.booking.pricePaid);
      bkMain.textContent='\u2713 Reserved'+(bkParts.length?' \u00b7 '+bkParts.join(' \u00b7 '):'');
      bkStrip.appendChild(bkMain);
      if(s.booking.cancelDeadline){
        var cpLine=document.createElement("div"); cpLine.className="bk-rec-meta"; cpLine.style.cssText="color:#d97706;font-weight:600;";
        cpLine.textContent="Cancel by: "+global.fmtD(s.booking.cancelDeadline)+(s.booking.cancelDeadlineTime?" at "+s.booking.cancelDeadlineTime:""); bkStrip.appendChild(cpLine);
      }
    }

    // Time display — click to edit
    var timeRow=document.createElement("div"); timeRow.className="srow-time"; timeRow.id="stime-"+s.id;
    function renderTimeLabel(){
      var hasTime=s.timeStart||s.timeEnd;
      if(hasTime){
        timeRow.textContent=(s.timeStart||"?")+" \u2013 "+(s.timeEnd||"?");
      } else {
        timeRow.textContent="+ add time";
        timeRow.style.opacity="0.4";
      }
    }
    renderTimeLabel();
    (function(item,did){timeRow.onclick=function(e){
      e.stopPropagation();
      var existing=r.querySelector('.stime-edit');
      if(existing){existing.parentNode.removeChild(existing);renderTimeLabel();return;}
      var editRow=document.createElement("div"); editRow.className="stime-edit";
      editRow.style.cssText="display:flex;align-items:center;gap:4px;padding-left:12px;margin-top:2px;";
      var startInp=document.createElement("input"); startInp.type="time"; startInp.className="stime-inp"; startInp.value=item.timeStart||"";
      var sep=document.createElement("span"); sep.style.cssText="font-size:10px;color:#aaa;"; sep.textContent="\u2013";
      var endInp=document.createElement("input"); endInp.type="time"; endInp.className="stime-inp"; endInp.value=item.timeEnd||"";
      var saveBtn=document.createElement("button"); saveBtn.className="sa"; saveBtn.style.cssText="font-size:9px;padding:1px 5px;"; saveBtn.textContent="Save";
      saveBtn.onclick=function(e){
        e.stopPropagation();
        item.timeStart=startInp.value||null;
        item.timeEnd=endInp.value||null;
        editRow.parentNode.removeChild(editRow);
        renderTimeLabel();
        global.autoSave();
        global.checkTimeConflicts(global.getDest(did),dayId);
      };
      editRow.appendChild(startInp); editRow.appendChild(sep); editRow.appendChild(endInp); editRow.appendChild(saveBtn);
      r.appendChild(editRow);
      startInp.focus();
    };})(s,destId);

    r.appendChild(top);
    // Round FN.7.4: transport sub-line for day-trips. Reminds the user
    // this isn't a stroll at the hub — there's a round-trip in/out
    // that needs its own transport. Estimates round-trip km from the
    // distance baked into the item note.
    // Round FN.7.5: include a clickable "→ Plan transport" button that
    // jumps straight to the Routing tab on the hub, where the user can
    // book the in/out leg without hunting for the tab.
    if (isDayTrip) {
      var transportLine = document.createElement("div");
      transportLine.style.cssText = "font-size:10.5px;color:#5b3f8f;margin:2px 0 0 22px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
      var hubName = s.dayTripFrom || "the hub";
      var noteMatch = (s.note || "").match(/(\d+)\s*km/);
      var distNote = noteMatch ? " · ~" + (parseInt(noteMatch[1], 10) * 2) + "km round trip" : "";
      var transportTxt = document.createElement("span");
      transportTxt.style.cssText = "font-style:italic;";
      transportTxt.textContent = "↔ Round trip from " + hubName + distNote;
      var transportBtn = document.createElement("button");
      transportBtn.type = "button";
      transportBtn.textContent = "→ Plan transport";
      transportBtn.style.cssText = "font-size:10px;font-weight:600;color:#5b3f8f;background:#fff;border:1px solid #d8c4e8;border-radius:9px;padding:2px 7px;cursor:pointer;font-family:inherit;";
      transportBtn.onmouseover = function(){ transportBtn.style.background = "#f4eef9"; };
      transportBtn.onmouseout = function(){ transportBtn.style.background = "#fff"; };
      (function(did){
        transportBtn.onclick = function(e){
          e.stopPropagation();
          global._activeDmSection = "routing";
          if (typeof global.drawDestMode === "function") global.drawDestMode(did);
        };
      })(destId);
      transportLine.appendChild(transportTxt);
      transportLine.appendChild(transportBtn);
      // Round FN.8.14: Cancel day trip button on the Itinerary item.
      // Calls global.ungroupDayTrip to restore the place as a destination, so
      // it reappears in "Could be a day trip from here" — letting the
      // user re-add later if they change their mind. The DAY TRIPS
      // section in Explore is now read-only (sights only); this is
      // the canonical management surface.
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel day trip";
      cancelBtn.title = "Restore this place as an option in 'Could be a day trip from here'";
      cancelBtn.style.cssText = "font-size:10px;font-weight:500;color:#888;background:#fff;border:1px solid #d8d4c8;border-radius:9px;padding:2px 7px;cursor:pointer;font-family:inherit;";
      cancelBtn.onmouseover = function(){ cancelBtn.style.background = "#fafafa"; };
      cancelBtn.onmouseout = function(){ cancelBtn.style.background = "#fff"; };
      (function(did, dtPlace, isPeer){
        cancelBtn.onclick = function(e){
          e.stopPropagation();
          var hub = (typeof global.getDest === "function") ? global.getDest(did) : null;
          if (!hub) return;
          // Round FZ.8: handle BOTH paths. Was only chip-based — looked
          // up the place in hub.dayTrips and called global.ungroupDayTrip. FT.2
          // peer day-trips live on hub.days[*].items[] with
          // peerDayTrip:true and don't appear in hub.dayTrips, so the
          // chip lookup returned -1 and the button silently no-op'd.
          // Now: peer items get removed via global.removeDayTripFromDayItem
          // for every day they're placed on (each call reverses one
          // night transfer); chip-based items use the original
          // global.ungroupDayTrip path.
          if (isPeer) {
            // Collect all (dayIdx) where this peer place is placed.
            var dayIdxs = [];
            (hub.days || []).forEach(function(d, di){
              (d.items || []).forEach(function(it){
                if (it && it.type === "daytrip" && it.peerDayTrip && it.dayTripPlace === dtPlace) {
                  dayIdxs.push(di);
                }
              });
            });
            if (!dayIdxs.length) return;
            if (!confirm("Cancel the day trip to " + dtPlace + "?\n\n" + dayIdxs.length + " day-trip placement" + (dayIdxs.length !== 1 ? "s" : "") + " will be removed and " + dayIdxs.length + " night" + (dayIdxs.length !== 1 ? "s" : "") + " will transfer back to " + dtPlace + ".")) return;
            // Remove from highest day index first so indexes stay
            // stable as we splice items out.
            dayIdxs.sort(function(a,b){return b-a;});
            if (typeof global.removeDayTripFromDayItem === "function") {
              dayIdxs.forEach(function(di){
                global.removeDayTripFromDayItem(hub, dtPlace, di);
              });
            }
            return;
          }
          // Chip path (build-time absorbed or makeDayTrip caller).
          if (!Array.isArray(hub.dayTrips)) return;
          var idx = -1;
          for (var i = 0; i < hub.dayTrips.length; i++) {
            if (hub.dayTrips[i] && hub.dayTrips[i].place === dtPlace) { idx = i; break; }
          }
          if (idx < 0) return;
          if (!confirm("Cancel the day trip to " + dtPlace + "?\n\n" + dtPlace + " will move back to 'Could be a day trip from here' so you can decide later.")) return;
          if (typeof global.ungroupDayTrip === "function") global.ungroupDayTrip(hub, idx, {silent: true});
        };
      })(destId, s.dayTripPlace || "", !!s.peerDayTrip);
      transportLine.appendChild(cancelBtn);
      r.appendChild(transportLine);
      // Round FN.8.15: surface the day-trip city's iconic sights as
      // first-class quick-add chips on this day only. The day-trip
      // city isn't in trip.destinations anymore (it's a chip), so its
      // sights wouldn't otherwise be reachable from the Itinerary
      // add-row. Pull from global._generatedCityData[place] (LLM-cached) and
      // render small purple chips. Click → adds as a regular sight
      // item on the same day; chip drops out so the user sees what's
      // left to consider.
      var dtPlaceForSuggest = s.dayTripPlace || "";
      var dtKey = dtPlaceForSuggest.toLowerCase();
      var dtCityData = (typeof global._generatedCityData !== "undefined") ? global._generatedCityData[dtKey] : null;
      if (dtCityData && Array.isArray(dtCityData.sights) && dtCityData.sights.length) {
        // Skip sights already on this day (by name).
        var dayItems = [];
        var hubForDay = (typeof global.getDest === "function") ? global.getDest(destId) : null;
        if (hubForDay && Array.isArray(hubForDay.days)) {
          for (var di = 0; di < hubForDay.days.length; di++) {
            if (hubForDay.days[di] && hubForDay.days[di].id === dayId) {
              dayItems = hubForDay.days[di].items || [];
              break;
            }
          }
        }
        var existingNames = {};
        dayItems.forEach(function(it){ if (it && it.n) existingNames[it.n.toLowerCase()] = true; });
        var availableSights = dtCityData.sights.filter(function(sg){
          var nm = (sg && (sg.name || sg.n || "")).toLowerCase();
          return nm && !existingNames[nm];
        }).slice(0, 8);
        if (availableSights.length) {
          var sightAddRow = document.createElement("div");
          sightAddRow.style.cssText = "margin:3px 0 0 22px;display:flex;flex-wrap:wrap;gap:4px;align-items:baseline;";
          var sightLbl = document.createElement("span");
          sightLbl.style.cssText = "font-size:10px;color:#888;font-weight:500;margin-right:4px;";
          sightLbl.textContent = "Add sights at " + dtPlaceForSuggest + ":";
          sightAddRow.appendChild(sightLbl);
          availableSights.forEach(function(sg){
            var chip = document.createElement("button");
            chip.type = "button";
            chip.textContent = "+ " + (sg.name || sg.n || "");
            chip.title = sg.desc || sg.note || "";
            chip.style.cssText = "font-size:10px;font-weight:500;color:#5b3f8f;background:#fff;border:1px solid #d8c4e8;border-radius:9px;padding:2px 7px;cursor:pointer;font-family:inherit;";
            chip.onmouseover = function(){ chip.style.background = "#f4eef9"; };
            chip.onmouseout = function(){ chip.style.background = "#fff"; };
            (function(sgData, did, dId){
              chip.onclick = function(e){
                e.stopPropagation();
                var d = (typeof global.getDest === "function") ? global.getDest(did) : null;
                if (!d || !Array.isArray(d.days)) return;
                var targetDay = null;
                for (var k = 0; k < d.days.length; k++) {
                  if (d.days[k] && d.days[k].id === dId) { targetDay = d.days[k]; break; }
                }
                if (!targetDay) return;
                if (typeof global.sidCtr !== "undefined") global.sidCtr++;
                var nameStr = sgData.name || sgData.n || "";
                var newItem = {
                  id: "s" + global.sidCtr,
                  type: "sight",
                  n: nameStr,
                  st: sgData.st || nameStr,
                  p: "nice",
                  done: false,
                  slot: "day",
                  note: sgData.desc || sgData.note || null,
                  lat: sgData.lat || null,
                  lng: sgData.lng || null
                };
                if (!Array.isArray(targetDay.items)) targetDay.items = [];
                targetDay.items.push(newItem);
                if (typeof global.autoSave === "function") global.autoSave();
                if (typeof global.drawDestMode === "function") global.drawDestMode(did);
              };
            })(sg, destId, dayId);
            sightAddRow.appendChild(chip);
          });
          r.appendChild(sightAddRow);
        }
      }
    }
    r.appendChild(timeRow);
    r.appendChild(acts);
    if(bkStrip) r.appendChild(bkStrip);
    return r;
  }

  // ── renderItinItem (Round MA.3) ────────────────────────────
  // Unified entry point for sight/restaurant/day-trip rows. Mobile
  // calls with {compact: true}, desktop without.
  //
  //   compact: true  → renderItinItemCompact (inline above)
  //   compact: false → delegate to window.mkItinItem (the inline
  //                    370-line desktop renderer, still living in
  //                    index.html for one more round)
  //
  // MA.3 SCOPE LIMIT — honest disclosure: this round CLAIMS the API
  // surface but does NOT move mkItinItem's body into this file. The
  // inline desktop function references ~17 other inline globals
  // (fS, autoSave, drawDestMode, getDest, _sightExternalUrl,
  // _openSightUrlEditor, sStory, togMov, toggleSightBookForm, delS,
  // fmtD, checkTimeConflicts, removeDayTripFromDayItem,
  // ungroupDayTrip, _generatedCityData, _activeDmSection, sidCtr).
  // Lifting all that needs careful Playwright coverage and is a
  // dedicated round of its own — MA.4. MA.3 sets up the seam so MA.4
  // is mechanical: edit the body in one place, both surfaces stay
  // wired.
  function renderItinItem(s, dayId, destId, opts) {
    opts = opts || {};
    if (opts.compact) {
      return renderItinItemCompact(s, dayId, destId, opts);
    }
    // MA.4: full-mode body now lives in this file. The inline
    // window.mkItinItem (in index.html) is a thin delegator that
    // calls back here, so legacy code paths still work via name.
    return renderItinItemFull(s, dayId, destId);
  }

  // ── renderDay (Round MA.2 + MA.3) ──────────────────────────
  // Wraps a day's items in the same .dayblock / .dayhdr / .slist
  // structure desktop uses, so the visual language matches.
  //
  // MA.3: now picks the item renderer based on `opts.compact` —
  // routing through renderItinItem (which itself dispatches to
  // compact vs. full). Desktop's inline mkDay is still the canonical
  // day-block builder for desktop's destination view; this is the
  // mobile path. MA.4 unifies mkDay too.
  function renderDay(day, destId, opts) {
    opts = opts || {};
    var itemRenderer = opts.itemRenderer || function (s, dId, dest) {
      return renderItinItem(s, dId, dest, opts);
    };
    var w = document.createElement('div');
    w.className = 'dayblock';
    w.id = 'dy-' + (day && day.id);

    var hdr = document.createElement('div');
    hdr.className = 'dayhdr';
    var num = document.createElement('span');
    num.className = 'daynum';
    num.textContent = (day && day.lbl) || '';
    var note = document.createElement('span');
    note.className = 'daynote';
    note.textContent = (day && day.note) || '';
    hdr.appendChild(num);
    hdr.appendChild(note);
    w.appendChild(hdr);

    var list = document.createElement('div');
    list.className = 'slist';
    list.id = 'sl-' + (day && day.id);

    // Day items can come in under .items (newer) or .sights (legacy).
    // Match desktop's mkDay tolerance.
    var items = (day && (day.items || day.sights)) || [];
    items.forEach(function (s) {
      list.appendChild(itemRenderer(s, day && day.id, destId, opts));
    });
    w.appendChild(list);
    return w;
  }

  // ── Public surface ─────────────────────────────────────────
  global.MaxTripUI = {
    renderItinItem:        renderItinItem,         // MA.3 — unified entry
    renderItinItemCompact: renderItinItemCompact,  // MA.2 — direct compact
    renderDay:             renderDay,              // MA.2/MA.3
  };

  // No back-compat aliases yet — desktop still uses its inline
  // mkItinItem / mkDay. MA.4 introduces aliases when those move.

})(typeof window !== 'undefined' ? window : this);
