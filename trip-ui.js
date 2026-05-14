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

  // v353.2: per-sight research panel. Inserted as a sibling of
  // the .srow when the user taps the 📚 button. Read-only view
  // shows text with auto-detected URLs as clickable links; tap
  // anywhere outside an <a> to enter edit mode (textarea); blur
  // saves and re-renders the view. Stored on s.research, persists
  // through the standard autoSave path.
  function _buildSightResearchPanel(s, destId) {
    var wrap = document.createElement("div");
    wrap.className = "sight-research-panel";
    wrap.style.cssText = "margin:4px 0 10px 18px;padding:8px 10px;background:#f7f4ec;border:1px solid #e6e0cc;border-radius:6px;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8a7440;margin-bottom:5px;display:flex;align-items:center;justify-content:space-between;";
    var lbl = document.createElement("span");
    lbl.textContent = "Research · " + (s.n || "this sight");
    var status = document.createElement("span");
    status.style.cssText = "font-size:8px;font-weight:500;color:#aaa;text-transform:none;letter-spacing:0;";
    hdr.appendChild(lbl);
    hdr.appendChild(status);
    wrap.appendChild(hdr);

    var saved = (typeof s.research === "string") ? s.research : "";
    var view = document.createElement("div");
    view.style.cssText = "font-size:12px;line-height:1.55;color:#333;min-height:30px;padding:5px 7px;background:#fff;border:1px solid #e8e1c8;border-radius:4px;cursor:text;white-space:pre-wrap;word-wrap:break-word;";
    view.title = "Tap to edit";

    function _esc(x) {
      return String(x == null ? "" : x)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function renderViewMode() {
      if (!saved) {
        view.innerHTML = '<span style="color:#bbb;">Tap to add research, links, hours, reservation notes…</span>';
        return;
      }
      var html = "";
      var lastIdx = 0;
      var urlRe = /(https?:\/\/[^\s<>"']+)/g;
      var m;
      while ((m = urlRe.exec(saved)) !== null) {
        html += _esc(saved.substring(lastIdx, m.index));
        var u = m[1], trail = "";
        while (/[)\.,;:!?]$/.test(u)) { trail = u.charAt(u.length - 1) + trail; u = u.substring(0, u.length - 1); }
        var safe = _esc(u);
        html += '<a href="' + safe + '" target="_blank" rel="noopener noreferrer" style="color:#1a5fa8;text-decoration:underline;word-break:break-all;">' + safe + '</a>' + _esc(trail);
        lastIdx = m.index + m[1].length;
      }
      html += _esc(saved.substring(lastIdx));
      view.innerHTML = html;
    }
    renderViewMode();

    var ta = document.createElement("textarea");
    ta.placeholder = "Hours, reservation URL, friend's tip, the side entrance…";
    ta.style.cssText = "width:100%;min-height:60px;max-height:200px;font:inherit;font-size:12px;line-height:1.5;padding:5px 7px;border:1px solid #1a5fa8;border-radius:4px;background:#fff;color:#111;resize:vertical;box-sizing:border-box;font-family:inherit;display:none;outline:none;box-shadow:0 0 0 3px rgba(26,95,168,.12);";

    function enterEdit() {
      ta.value = saved;
      view.style.display = "none";
      ta.style.display = "block";
      setTimeout(function(){ ta.focus(); }, 30);
    }
    function exitEdit() {
      var nextVal = ta.value;
      if (nextVal !== saved) {
        s.research = nextVal;
        saved = nextVal;
        var ok = false;
        try {
          if (typeof global.localSave === "function") { global.localSave(); ok = true; }
          else if (global.MaxDB && global._currentTripId && typeof global.serializeTrip === "function") {
            ok = global.MaxDB.trip.writeRaw(global._currentTripId, global.serializeTrip());
          }
        } catch (e) { ok = false; }
        if (ok && typeof global.MaxSync !== "undefined" &&
            typeof global.MaxSync.scheduleSave === "function") {
          global.MaxSync.scheduleSave();
        }
        status.textContent = ok ? "saved" : "save failed";
        status.style.color = ok ? "#2a7a4e" : "#c05020";
        if (ok) setTimeout(function(){
          if (status.textContent === "saved") status.textContent = "";
        }, 1800);
        // Update the 📚• indicator on the action button.
        var btn = document.querySelector('#sr-' + s.id + ' .sa[title="Research notes for this sight"]');
        if (btn) btn.textContent = saved ? "📚•" : "📚";
      }
      ta.style.display = "none";
      view.style.display = "block";
      renderViewMode();
    }
    view.onclick = function (e) {
      if (e && e.target && e.target.tagName === "A") return;
      enterEdit();
    };
    ta.addEventListener("blur", exitEdit);
    wrap.appendChild(view);
    wrap.appendChild(ta);
    return wrap;
  }

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
    // v353.2: Open in Maps. Hands off to the user's preferred maps
    // app via the universal Google Maps URL — iOS opens Apple Maps
    // via Universal Link, Android opens Google Maps app, desktop
    // opens google.com/maps. Coords win when present; fall back to
    // a name+place text search.
    if (s && (typeof s.lat === 'number' && typeof s.lng === 'number') ||
        (s && s.n)) {
      var _dest = (typeof global.getDest === 'function' && destId) ? global.getDest(destId) : null;
      var _place = (_dest && _dest.place) || '';
      var _href;
      if (typeof s.lat === 'number' && typeof s.lng === 'number') {
        _href = 'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(s.lat + ',' + s.lng);
      } else {
        _href = 'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(s.n + (_place ? ', ' + _place : ''));
      }
      var ml = document.createElement('a');
      ml.href = _href;
      ml.target = '_blank';
      ml.rel = 'noopener noreferrer';
      ml.textContent = '📍';
      ml.title = 'Get directions in Maps';
      ml.style.cssText = 'margin-left:4px;font-size:11px;text-decoration:none;line-height:1;';
      ml.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); };
      top.appendChild(ml);
    }
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

  function renderItinItemFull(s, dayId, destId, opts){
    // SCAFFOLD-2: commitment-state class drives the visual layer.
    // commitmentState() lives in engine-trip.js; falls back to "confirmed"
    // when the engine isn't loaded yet (test contexts).
    var commitState = (typeof global.commitmentState === "function")
      ? global.commitmentState(s) : "confirmed";
    // v304: time-state class for items on today's day. opts.itemTimeStates
    // is a {id → 'past'|'current'|'next'|'later'} map; applied as
    // time-{state} class. Items not in the map (untimed, or rendering for
    // a non-today day) get no time-state class and look normal.
    var timeState = (opts && opts.itemTimeStates && s && s.id && opts.itemTimeStates[s.id]) || null;
    var r=document.createElement("div");
    r.className="srow"+(s.done?" done":"")+(s.type==="daytrip"?" daytrip":"")+" commit-"+commitState
      + (timeState ? (" time-" + timeState) : "");
    r.id="sr-"+s.id;
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
    // v353.2: "Open in Maps" link. Hands off to the user's preferred
    // maps app (Apple Maps on iOS, Google Maps elsewhere) with the
    // item's location pre-filled. Uses the universal Google Maps URL
    // (https://www.google.com/maps/search/?api=1&query=...) which on
    // iOS opens Apple Maps via Universal Link, on Android opens Google
    // Maps app, and on desktop opens google.com/maps. Falls back to
    // a name+place text search when lat/lng aren't set.
    var mapsLink = null;
    var hasCoords = (typeof s.lat === "number" && typeof s.lng === "number");
    if (hasCoords || (s.n && _placeForS)) {
      var mapsHref;
      if (hasCoords) {
        // Coords win when present — most accurate.
        mapsHref = "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent(s.lat + "," + s.lng);
      } else {
        // Search by name + place; the maps app picks the best match.
        var q = s.n + (_placeForS ? ", " + _placeForS : "");
        mapsHref = "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent(q);
      }
      mapsLink = document.createElement("a");
      mapsLink.href = mapsHref;
      mapsLink.target = "_blank";
      mapsLink.rel = "noopener noreferrer";
      mapsLink.textContent = "📍";
      mapsLink.title = "Get directions in Maps";
      mapsLink.style.cssText = "margin-left:4px;font-size:11px;text-decoration:none;cursor:pointer;line-height:1;";
      mapsLink.onclick = function(e){ e.stopPropagation(); };
    }
    var acts=document.createElement("div"); acts.className="sacts";
    // Story button
    var stb=document.createElement("button"); stb.className="sa ssa"; stb.id="ssa-"+s.id;
    stb.setAttribute("data-state","idle"); stb.textContent="story \u2197";
    // Round FN.9: tooltip \u2014 bare "story" was opaque about what it did.
    stb.title = "Story about " + (s.n || "this");
    (function(id,did){stb.onclick=function(){global.sStory(id,did);};})(s.id,destId);
    acts.appendChild(stb);
    // v353.2: per-sight Research button. Toggles an inline research
    // panel below this row — distinct from the destination-level
    // Research strip (which is for whole-city research). This one
    // captures sight-specific notes: opening hours, reservation URLs,
    // friend's tip about the side entrance, etc. Stored on s.research.
    // Same URL auto-detection + voice input as the dest-level version.
    var resBtn = document.createElement("button");
    resBtn.className = "sa";
    resBtn.textContent = (s.research && s.research.length) ? "📚•" : "📚";
    resBtn.title = "Research notes for this sight";
    (function (item, did) {
      resBtn.onclick = function (e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var rowEl = document.getElementById("sr-" + item.id);
        if (!rowEl) return;
        var existing = rowEl.parentNode.querySelector('.sight-research-panel[data-for="' + item.id + '"]');
        if (existing) {
          existing.parentNode.removeChild(existing);
          return;
        }
        var panel = _buildSightResearchPanel(item, did);
        panel.setAttribute("data-for", item.id);
        rowEl.parentNode.insertBefore(panel, rowEl.nextSibling);
        // Focus the textarea (or the view, then click into it).
        var ta = panel.querySelector("textarea");
        if (ta) setTimeout(function(){ ta.focus(); }, 30);
      };
    })(s, destId);
    acts.appendChild(resBtn);
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
    // v353: \u2715 no longer hard-deletes \u2014 routes through removeSightToLater
    // which moves the sight to dest.laterItems (preserving the full
    // object: booking, times, notes, priority). Undo toast restores it
    // to its original day. Matches the data model's "nothing is really
    // gone, just unscheduled" intent \u2014 and the explicit "\u2192 Later"
    // option in the move popup uses the same destination. Hard delete
    // (delS) is still defined for any caller that explicitly wants it.
    var xb=document.createElement("button"); xb.className="sa"; xb.textContent="\u2715";
    xb.title="Send to Later (undo available for a few seconds)";
    (function(id,did){xb.onclick=function(){
      if (typeof global.removeSightToLater === "function") {
        global.removeSightToLater(id,dayId,did);
      } else if (typeof global.delS === "function") {
        // Defensive: pre-v353 builds didn't have removeSightToLater.
        // Fall back to the legacy hard delete so the button still does
        // *something* if these files are ever served out of sync.
        global.delS(id,dayId,did);
      }
    };})(s.id,destId);
    acts.appendChild(xb);
    var top=document.createElement("div"); top.className="srow-top";
    top.appendChild(dot); top.appendChild(name);
    if (extLink) top.appendChild(extLink);
    if (extEdit) top.appendChild(extEdit);
    if (mapsLink) top.appendChild(mapsLink);  // v353.2: Open in Maps
    // SCAFFOLD-2: Keep button on tentative items. Sits between the name
    // and the action buttons so it reads as "the answer to: is this
    // staying?" Click flips s.tentative to false (advances to confirmed)
    // and re-renders the destination so the visual styling updates.
    if (commitState === "tentative") {
      var keepBtn = document.createElement("button");
      keepBtn.type = "button";
      keepBtn.className = "keep-btn";
      keepBtn.textContent = "✓ Keep";
      keepBtn.title = "Max suggested this. Click to keep — or edit/remove if it doesn't fit.";
      (function(id, did){
        keepBtn.onclick = function(e){
          e.stopPropagation();
          var sx = global.fS(id, did);
          if (!sx) return;
          sx.tentative = false;
          if (typeof global.autoSave === "function") global.autoSave();
          if (typeof global.drawDestMode === "function") global.drawDestMode(did);
        };
      })(s.id, destId);
      top.appendChild(keepBtn);
      // v301: per-item placement "?" removed — the rationale was nearly
      // identical to the day-shape "?" on the day header (slice 2),
      // just one row down. Two popovers saying close to the same thing
      // is noise. The per-day "?" carries the explanation for the
      // whole day; per-item explanation duplicated it.
    }
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
        // SCAFFOLD-2: setting a time is engagement — auto-confirm a tentative
        // item. Keeps "Keep" available but means most users won't even need it.
        if (item.tentative && (item.timeStart || item.timeEnd)) item.tentative = false;
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
      // v359.3: "Stay overnight here" button on the Itinerary day-trip
      // item. Previously labeled "Cancel day trip" — which read as
      // delete, not convert — and the confirm message said the place
      // "will move back to 'Could be a day trip from here'", which is
      // misleading. ungroupDayTrip actually creates a new standalone
      // destination (a real stay) inserted after the hub. This button
      // is the canonical day-trip → stay conversion path, and the
      // label/copy/style now match that semantic.
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "🛏 Stay overnight here";
      // v359.3.3: `dest` isn't in scope here — only `destId`. Use a
      // generic title rather than looking up the hub name (would
      // require getDest + null guard for a tooltip not worth it).
      cancelBtn.title = "Convert this day trip into its own destination (a stay) inserted after the hub";
      cancelBtn.style.cssText = "font-size:11px;font-weight:600;color:#1a5fa8;background:#eef5ff;border:1px solid #cfe1f7;border-radius:11px;padding:3px 10px;cursor:pointer;font-family:inherit;";
      cancelBtn.onmouseover = function(){ cancelBtn.style.background = "#dceaf8"; };
      cancelBtn.onmouseout = function(){ cancelBtn.style.background = "#eef5ff"; };
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
            if (!confirm("Stay overnight in " + dtPlace + "?\n\n" + dtPlace + " will become its own destination. " + dayIdxs.length + " day-trip placement" + (dayIdxs.length !== 1 ? "s" : "") + " will be removed and " + dayIdxs.length + " night" + (dayIdxs.length !== 1 ? "s" : "") + " will transfer to the new stay.")) return;
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
          if (!confirm("Stay overnight in " + dtPlace + "?\n\n" + dtPlace + " will become its own destination, inserted after " + (hub.place || "the hub") + ".")) return;
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
    // v304: pass opts through so renderItinItemFull can read
    // itemTimeStates for the past/current/next time-state CSS class.
    return renderItinItemFull(s, dayId, destId, opts);
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
    // v353.6: per-day weather chip. Appended inline next to the day
    // number; renderDayWeatherChip handles the async fetch via the
    // shared getDestWeather cache and silently skips for climate-only
    // dates (>16 days out) where day-by-day data isn't meaningful.
    var _destForDayWx = (typeof global.getDest === 'function' && destId) ? global.getDest(destId) : null;
    if (_destForDayWx && day && day.date && typeof global.renderDayWeatherChip === 'function') {
      try { global.renderDayWeatherChip(_destForDayWx, day, hdr); } catch (_) {}
    }
    // SCAFFOLD-6 slice 2: per-day "?" rationale popover. Shown when
    // opts.rationale is non-null; mkDay (in index.html) computes the
    // rationale via dayRationale() and passes it through. Same
    // position:fixed pattern as the dest-card popover (v297.1) so
    // the popover escapes #lp's overflow:hidden.
    if (opts && opts.rationale) {
      var rationale = opts.rationale;
      var qBtn = document.createElement('button');
      qBtn.type = 'button';
      qBtn.textContent = '?';
      // v301: reframed from "Why this day looks like this" — that wasn't
      // really what the popover answered. It explains how Max distributed
      // the sights across the days you have, against a working budget.
      qBtn.title = 'How this day was shaped';
      qBtn.style.cssText = 'font-size:9px;font-weight:700;width:14px;height:14px;line-height:1;padding:0;border-radius:50%;border:1px solid #c8b888;background:#fbf6e8;color:#7d5e00;cursor:pointer;font-family:inherit;vertical-align:middle;margin-left:6px;flex-shrink:0;';
      qBtn.onmouseover = function () { qBtn.style.background = '#f0e3b8'; };
      qBtn.onmouseout  = function () { qBtn.style.background = '#fbf6e8'; };
      var qPop = null;
      function ensureQPop() {
        if (qPop) return qPop;
        qPop = document.createElement('div');
        qPop.className = 'sf6-pop';
        qPop.style.cssText = 'display:none;position:fixed;width:280px;max-width:calc(100vw - 24px);font-size:11px;line-height:1.55;color:#5a4520;background:#fff;border:1px solid #e6d5a0;border-radius:6px;padding:9px 11px;box-shadow:0 4px 14px rgba(0,0,0,.18);z-index:8500;font-weight:500;text-align:left;white-space:normal;';
        qPop.textContent = rationale;
        document.body.appendChild(qPop);
        return qPop;
      }
      function positionQ() {
        var p = ensureQPop();
        var r = qBtn.getBoundingClientRect();
        var popW = 280, margin = 8;
        var top = r.bottom + 4;
        var left = r.left;
        if (left + popW > window.innerWidth - margin) {
          left = window.innerWidth - popW - margin;
        }
        if (left < margin) left = margin;
        p.style.top = top + 'px';
        p.style.left = left + 'px';
      }
      qBtn.onclick = function (e) {
        e.stopPropagation();
        var p = ensureQPop();
        var wasOpen = p.style.display === 'block';
        document.querySelectorAll('.sf6-pop-open').forEach(function (el) {
          el.style.display = 'none';
          el.classList.remove('sf6-pop-open');
        });
        if (!wasOpen) {
          positionQ();
          p.style.display = 'block';
          p.classList.add('sf6-pop-open');
        }
      };
      // Outside-click + resize closers — installed once globally; the
      // dest-card popover (v297.1) uses the same window flag.
      if (!global._sf6PopCloser) {
        global._sf6PopCloser = true;
        document.addEventListener('click', function () {
          document.querySelectorAll('.sf6-pop-open').forEach(function (el) {
            el.style.display = 'none';
            el.classList.remove('sf6-pop-open');
          });
        });
        window.addEventListener('resize', function () {
          document.querySelectorAll('.sf6-pop-open').forEach(function (el) {
            el.style.display = 'none';
            el.classList.remove('sf6-pop-open');
          });
        });
      }
      hdr.appendChild(qBtn);
    }
    w.appendChild(hdr);

    // SCAFFOLD-5 slice 2: now/next widget. Inserted between the day
    // header and the items list when opts.todayWidget is non-empty.
    // mkDay (in index.html) computes the HTML — only on today's day
    // during a 'during' phase trip — and passes it through opts.
    if (opts && opts.todayWidget) {
      var todayWrap = document.createElement('div');
      todayWrap.innerHTML = opts.todayWidget;
      // Append the children, not the wrapper, so we don't add an extra div layer.
      while (todayWrap.firstChild) {
        w.appendChild(todayWrap.firstChild);
      }
      // v353.6: populate the today-widget weather slot. _buildNowNextWidgetHtml
      // emits an empty .now-next-wx-slot span; we hand it to renderDayWeatherChip
      // which fills in icon + high/low for today by reading the same Open-Meteo
      // cache the per-day chips use.
      var _wxSlot = w.querySelector('.now-next-wx-slot');
      if (_wxSlot && _destForDayWx && day && day.date && typeof global.renderDayWeatherChip === 'function') {
        try { global.renderDayWeatherChip(_destForDayWx, day, _wxSlot); } catch (_) {}
      }
    }

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

  // ── TM.2 (v316): trip-overview strips ─────────────────────
  // The four horizontal strips that appear at the top of the
  // trip view today: dates, Today banner, pre-arrival banner,
  // decisions-deferred panel. Each lifted from inline IIFEs in
  // drawTripMode; each takes (trip, container) and appends DOM.
  // No closure deps — all referenced functions are read off the
  // global namespace (currentTripStatus, preArrivalActions,
  // summarizeDecisionsDeferred, selectDest, _generatedCityData,
  // _parseTripDuration). Step toward Item 16 / TM.x: making the
  // strips reusable so drawTripMode/drawDestMode can be merged.

  // (a) Dates strip — date range + total days/nights + dest count.
  // Under-budget annotation rides along; over-budget gets its own
  // action banner elsewhere (banner has fix-it buttons).
  function _renderTripDatesStrip(trip, container) {
    if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) return;
    if (!container) return;
    var first = trip.destinations[0];
    var last  = trip.destinations[trip.destinations.length - 1];
    if (!first || !first.dateFrom || !last || !last.dateTo) return;
    var fmt = function (iso) {
      try {
        var d = new Date(iso + "T12:00:00");
        return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      } catch (_) { return iso; }
    };
    var year;
    try { year = new Date(last.dateTo + "T12:00:00").getFullYear(); }
    catch (_) { year = ""; }
    var totalNights = trip.destinations.reduce(function (s, d) { return s + (d.nights || 0); }, 0);
    var totalDays   = totalNights + 1;
    var budget      = (typeof global._parseTripDuration === "function")
      ? global._parseTripDuration((trip.brief && trip.brief.duration) || "")
      : null;
    var underHtml = "";
    if (budget && totalDays < budget.min) {
      var tripStr = (budget.min === budget.max) ? (budget.max + "-day") : (budget.min + "–" + budget.max + "-day");
      var diff = budget.min - totalDays;
      underHtml = ' <span style="font-size:12px;color:#2a6b3e;">'
        + '· ' + diff + ' day' + (diff !== 1 ? 's' : '') + ' under your ' + tripStr + ' budget'
        + '</span>';
    }
    var datesBar = document.createElement("div");
    datesBar.style.cssText = "margin:0 2px 12px;padding:14px 16px;background:#fff;border:1px solid #e6e2d8;border-radius:8px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;";
    datesBar.innerHTML = ''
      + '<div style="font-size:18px;font-weight:700;color:#1a1a1a;">'
      +   fmt(first.dateFrom) + ' – ' + fmt(last.dateTo) + (year ? ', ' + year : '')
      + '</div>'
      + '<div style="font-size:12px;color:#666;">'
      +   '<strong>' + totalDays + ' days</strong> · ' + totalNights + ' nights · '
      +   trip.destinations.length + ' destination' + (trip.destinations.length !== 1 ? 's' : '')
      +   underHtml
      + '</div>';
    container.appendChild(datesBar);
  }

  // (b) Today banner — SCAFFOLD-5 first slice. Renders only in
  // 'during' phase. Click "Today's plan →" → selectDest +
  // scroll-into-view + amber pulse.
  function _renderTodayBanner(trip, container) {
    if (!container) return;
    if (typeof global.currentTripStatus !== "function") return;
    var status = global.currentTripStatus(trip);
    if (!status || status.phase !== "during") return;
    var wrap = document.createElement("div");
    wrap.id = "today-banner";
    wrap.style.cssText = "margin:0 2px 12px;padding:11px 14px;border:1px solid #c8dff8;background:linear-gradient(135deg,#eaf3fb 0%,#dcecf8 100%);border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;";
    var leftCol = document.createElement("div");
    leftCol.style.cssText = "flex:1;min-width:0;line-height:1.4;";
    var topLine = document.createElement("div");
    topLine.style.cssText = "font-size:11px;font-weight:700;color:#1a5fa8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;";
    topLine.textContent = "📍 You're on day " + status.dayNumber + " of " + status.totalDays;
    var bottomLine = document.createElement("div");
    bottomLine.style.cssText = "font-size:13px;font-weight:600;color:#0e3a6a;display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;";
    if (status.currentDestPlace) {
      var locSpan = document.createElement("span");
      locSpan.textContent = "In " + status.currentDestPlace
        + (status.currentDayLbl ? " · " + status.currentDayLbl : "");
      bottomLine.appendChild(locSpan);
      // v353.6: weather chip inline. Uses the current dest's coords +
      // today's date. renderDayWeatherChip handles the cache, the
      // forecast-vs-climate branch, and silently bails when there's
      // no data — same behavior as the per-day chips.
      if (status.currentDestId && typeof global.getDest === 'function'
          && typeof global.renderDayWeatherChip === 'function') {
        try {
          var _destForBanner = global.getDest(status.currentDestId);
          if (_destForBanner) {
            // Find the day object that matches today; we need its .date
            // for renderDayWeatherChip's lookup against the daily array.
            var _todayDay = null;
            if (status.currentDayId && Array.isArray(_destForBanner.days)) {
              for (var _di = 0; _di < _destForBanner.days.length; _di++) {
                if (_destForBanner.days[_di] && _destForBanner.days[_di].id === status.currentDayId) {
                  _todayDay = _destForBanner.days[_di];
                  break;
                }
              }
            }
            if (_todayDay && _todayDay.date) {
              var _wxSpan = document.createElement("span");
              _wxSpan.style.cssText = "font-weight:500;";
              global.renderDayWeatherChip(_destForBanner, _todayDay, _wxSpan);
              bottomLine.appendChild(_wxSpan);
            }
          }
        } catch (_) {}
      }
      var tailSpan = document.createElement("span");
      tailSpan.style.cssText = "font-weight:500;color:#3a5a80;";
      tailSpan.textContent = (status.daysUntilEnd > 1
        ? "· " + (status.daysUntilEnd - 1) + " day"
            + (status.daysUntilEnd === 2 ? "" : "s") + " left after today"
        : "· last day of the trip");
      bottomLine.appendChild(tailSpan);
    } else {
      bottomLine.textContent = "Between destinations";
    }
    leftCol.appendChild(topLine);
    leftCol.appendChild(bottomLine);
    wrap.appendChild(leftCol);
    if (status.currentDestId) {
      var jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.textContent = "Today's plan →";
      jumpBtn.style.cssText = "font-size:11px;font-weight:600;padding:6px 12px;border:1px solid #1a5fa8;border-radius:5px;background:#1a5fa8;color:#fff;cursor:pointer;font-family:inherit;flex-shrink:0;";
      jumpBtn.onmouseover = function () { jumpBtn.style.background = "#0e3a6a"; jumpBtn.style.borderColor = "#0e3a6a"; };
      jumpBtn.onmouseout  = function () { jumpBtn.style.background = "#1a5fa8"; jumpBtn.style.borderColor = "#1a5fa8"; };
      (function (destId, dayId) {
        jumpBtn.onclick = function () {
          if (typeof global.selectDest === "function") global.selectDest(destId);
          if (dayId) {
            // v353.2: retry until the day block actually mounts.
            // selectDest → drawDestMode renders synchronously, but
            // subsequent layout (Leaflet invalidate, tab pane swap,
            // image loads) can shift things; the previous 250ms
            // setTimeout sometimes fired BEFORE dy-<id> appeared
            // and silently no-op'd. Now we poll every 80ms for up
            // to 1.5s and scroll the moment the element exists.
            var attempts = 0;
            var maxAttempts = 18; // 18 × 80ms ≈ 1.5s
            (function tryScroll() {
              var el = document.getElementById("dy-" + dayId);
              if (el && el.scrollIntoView) {
                try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
                el.style.transition = "background-color 0.4s";
                el.style.backgroundColor = "#fff7d4";
                setTimeout(function () { el.style.backgroundColor = ""; }, 1800);
                return;
              }
              if (++attempts < maxAttempts) setTimeout(tryScroll, 80);
            })();
          }
        };
      })(status.currentDestId, status.currentDayId);
      wrap.appendChild(jumpBtn);
    }
    container.appendChild(wrap);
  }

  // (c) Pre-arrival LOGISTICS banner. Renders only in 'before'
  // phase, within 21 days. Collapsible chip; localStorage-persisted
  // expand state. SCAFFOLD-4.
  function _renderPreArrivalBanner(trip, container) {
    if (!container) return;
    if (typeof global.preArrivalActions !== "function") return;
    var actions = global.preArrivalActions(trip);
    if (!actions) return;
    if (actions.daysUntilStart > 21) return;
    if (!actions.items.length) return;
    var expanded = false;
    try { expanded = localStorage.getItem("max-prearrival-expanded") === "1"; } catch (e) {}
    var wrap = document.createElement("div");
    wrap.id = "pre-arrival-banner";
    wrap.style.cssText = "margin:0 2px 12px;border:1px solid #e6d5a0;border-radius:8px;background:#fbf6e8;overflow:hidden;";
    var chip = document.createElement("button");
    chip.type = "button";
    chip.style.cssText = "width:100%;text-align:left;padding:10px 14px;background:transparent;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:#7d5e00;display:flex;align-items:center;gap:10px;";
    var caretSpan = document.createElement("span");
    caretSpan.style.cssText = "font-size:9px;opacity:0.7;flex-shrink:0;transition:transform 0.15s ease;display:inline-block;";
    caretSpan.textContent = "▸";
    if (expanded) caretSpan.style.transform = "rotate(90deg)";
    var labelSpan = document.createElement("span");
    labelSpan.style.cssText = "flex:1;";
    var dCount = actions.daysUntilStart;
    var when = dCount === 0 ? "Trip starts today"
             : dCount === 1 ? "Trip starts tomorrow"
             : (dCount + " days until your trip starts");
    // v353.2: explicit category. "Bookings" = real-world
    // reservations with a provider (hotel rooms, train tickets,
    // flights). They cost money. Each one is a separate
    // transaction outside the app. Distinct from the
    // Decisions-deferred panel below, which is about your
    // itinerary plan (no money — just "do I want to do this?").
    // Break out hotels vs transit in the count so it's obvious
    // what's actually missing.
    var hotelN = 0, transitN = 0;
    actions.items.forEach(function (it) {
      if (it.kind === "hotelMissing") hotelN++;
      else if (it.kind === "transitMissing") transitN++;
    });
    var bookBits = [];
    if (hotelN) bookBits.push('<strong>' + hotelN + '</strong> hotel' + (hotelN !== 1 ? 's' : ''));
    if (transitN) bookBits.push('<strong>' + transitN + '</strong> transit leg' + (transitN !== 1 ? 's' : ''));
    var preTail = bookBits.join(' · ') + ' to reserve';
    labelSpan.innerHTML = "📅 " + when + " — Bookings: " + preTail;
    var hintSpan = document.createElement("span");
    hintSpan.style.cssText = "font-size:10px;font-weight:500;color:#a89055;font-style:italic;";
    hintSpan.textContent = expanded ? "Hide" : "Show";
    chip.appendChild(caretSpan);
    chip.appendChild(labelSpan);
    chip.appendChild(hintSpan);
    wrap.appendChild(chip);

    var list = document.createElement("div");
    list.style.cssText = "padding:10px 14px 12px;border-top:1px solid #e6d5a0;display:" + (expanded ? "block" : "none") + ";";
    // v353.2: enrich each line with the destination's date range so
    // the user can prioritize "what to book first." preArrivalActions
    // doesn't include dates, so we look up the dest by id from the
    // trip object that was passed in to this render.
    var fmtD = global.fmtD;
    function _destById(id) {
      if (!id || !trip || !Array.isArray(trip.destinations)) return null;
      for (var i = 0; i < trip.destinations.length; i++) {
        if (trip.destinations[i] && trip.destinations[i].id === id) return trip.destinations[i];
      }
      return null;
    }
    function _destRange(d) {
      if (!d || !fmtD) return '';
      if (d.dateFrom && d.dateTo && d.dateFrom !== d.dateTo) {
        return fmtD(d.dateFrom) + ' – ' + fmtD(d.dateTo);
      }
      if (d.dateFrom) return fmtD(d.dateFrom);
      return '';
    }
    actions.items.forEach(function (item) {
      var line = document.createElement("button");
      line.type = "button";
      line.style.cssText = "display:block;width:100%;text-align:left;padding:7px 10px;margin-bottom:4px;font-family:inherit;font-size:11.5px;color:#5a4520;background:#fff;border:1px solid #ead7a3;border-radius:5px;cursor:pointer;line-height:1.45;";
      line.onmouseover = function () { line.style.background = "#fdf3cf"; };
      line.onmouseout  = function () { line.style.background = "#fff"; };
      var text = "";
      var _esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      if (item.kind === "hotelMissing") {
        var d = _destById(item.destId);
        var rng = _destRange(d);
        text = (rng ? "<strong>" + _esc(rng) + "</strong> · " : "")
             + "No hotel booked for <strong>" + _esc(item.destPlace || "this destination") + "</strong>";
      } else if (item.kind === "transitMissing") {
        // For transit between A and B, the relevant date is A's
        // dateTo (the day you're leaving A, also when you'd take
        // the transit to arrive at B).
        var fromD = _destById(item.fromId);
        var transitDate = (fromD && fromD.dateTo && fmtD) ? fmtD(fromD.dateTo) : '';
        text = (transitDate ? "<strong>" + _esc(transitDate) + "</strong> · " : "")
             + "Transit not booked: <strong>" + _esc(item.fromPlace || "") + " → " + _esc(item.toPlace || "") + "</strong>";
      }
      line.innerHTML = text + ' <span style="color:#a89055;font-size:10px;">→</span>';
      (function (it) {
        line.onclick = function () {
          var did = it.destId || it.fromId;
          if (!did) return;
          if (it.kind === "hotelMissing") global._activeDmSection = "stay";
          else if (it.kind === "transitMissing") global._activeDmSection = "routing";
          if (typeof global.selectDest === "function") global.selectDest(did);
        };
      })(item);
      list.appendChild(line);
    });
    wrap.appendChild(list);
    chip.onclick = function () {
      var nowExpanded = list.style.display === "none";
      list.style.display = nowExpanded ? "block" : "none";
      caretSpan.style.transform = nowExpanded ? "rotate(90deg)" : "rotate(0deg)";
      hintSpan.textContent = nowExpanded ? "Hide" : "Show";
      try { localStorage.setItem("max-prearrival-expanded", nowExpanded ? "1" : "0"); } catch (e) {}
    };
    container.appendChild(wrap);
  }

  // (d) Decisions-deferred panel — SCAFFOLD-3 with v296.1
  // "(still gathering…)" indicator while async destination data
  // is loading. Collapsible chip; localStorage-persisted expand
  // state.
  function _renderDecisionsDeferredPanel(trip, container) {
    if (!container) return;
    if (typeof global.summarizeDecisionsDeferred !== "function") return;
    var summary = global.summarizeDecisionsDeferred(trip);
    if (!summary || !summary.totalCount) return;
    var anyGenerating = false;
    if (typeof global._generatedCityData !== "undefined" && trip && trip.destinations) {
      for (var i = 0; i < trip.destinations.length; i++) {
        var d = trip.destinations[i];
        if (!d || !d.place) continue;
        var k = d.place.toLowerCase();
        var s = global._generatedCityData[k];
        if (s && s.loading) { anyGenerating = true; break; }
        if (!s && (!Array.isArray(d.suggestions) || d.suggestions.length === 0)) {
          anyGenerating = true; break;
        }
      }
    }
    var expanded = false;
    try { expanded = localStorage.getItem("max-decisions-expanded") === "1"; } catch (e) {}
    var wrap = document.createElement("div");
    wrap.id = "decisions-deferred";
    wrap.style.cssText = "margin:0 2px 12px;border:1px solid #e6d5a0;border-radius:8px;background:#fbf6e8;overflow:hidden;";
    var chip = document.createElement("button");
    chip.type = "button";
    chip.style.cssText = "width:100%;text-align:left;padding:10px 14px;background:transparent;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;color:#7d5e00;display:flex;align-items:center;gap:10px;";
    var caretSpan = document.createElement("span");
    caretSpan.style.cssText = "font-size:9px;opacity:0.7;flex-shrink:0;transition:transform 0.15s ease;display:inline-block;";
    caretSpan.textContent = "▸";
    if (expanded) caretSpan.style.transform = "rotate(90deg)";
    var labelSpan = document.createElement("span");
    labelSpan.style.cssText = "flex:1;";
    // v353.2: header reworded. Was "N suggestions to review" which
    // (a) conflicts with the Explore tab's actual "suggestions"
    // section (LLM-generated places to consider) and (b) collapsed
    // two unrelated things — placeholder items vs empty days —
    // into one ambiguous count. Now shows the breakdown explicitly.
    var tCount = 0, eCount = 0;
    (summary.items || []).forEach(function (it) {
      if (it.kind === 'tentative') tCount += (it.count || 0);
      else if (it.kind === 'emptyDay') eCount += 1;
    });
    var bits = [];
    if (tCount) bits.push('<strong>' + tCount + '</strong> sight' + (tCount !== 1 ? 's' : '') + ' to keep or skip');
    if (eCount) bits.push('<strong>' + eCount + '</strong> empty day' + (eCount !== 1 ? 's' : ''));
    // v353.2: explicit category. "Itinerary" = the plan of what
    // you're going to do day-by-day. No money involved. Distinct
    // from the Bookings banner above (which is about reservations
    // with money + providers). "Sights to keep or skip" is the
    // plain-English version of "tentative placeholders."
    labelSpan.innerHTML = '🔧 Itinerary: ' + bits.join(' · ')
      + (anyGenerating ? ' <span style="font-weight:500;color:#a89055;font-style:italic;font-size:11px;">(still gathering…)</span>' : '');
    var hintSpan = document.createElement("span");
    hintSpan.style.cssText = "font-size:10px;font-weight:500;color:#a89055;font-style:italic;";
    hintSpan.textContent = expanded ? "Hide" : "Show";
    chip.appendChild(caretSpan);
    chip.appendChild(labelSpan);
    chip.appendChild(hintSpan);
    wrap.appendChild(chip);

    var list = document.createElement("div");
    list.style.cssText = "padding:0 14px 12px;display:" + (expanded ? "block" : "none") + ";";
    list.style.borderTop = "1px solid #e6d5a0";
    list.style.paddingTop = "10px";

    summary.items.forEach(function (item) {
      var line = document.createElement("button");
      line.type = "button";
      line.style.cssText = "display:block;width:100%;text-align:left;padding:7px 10px;margin-bottom:4px;font-family:inherit;font-size:11.5px;color:#5a4520;background:#fff;border:1px solid #ead7a3;border-radius:5px;cursor:pointer;line-height:1.45;";
      line.onmouseover = function () { line.style.background = "#fdf3cf"; };
      line.onmouseout  = function () { line.style.background = "#fff"; };
      // v353.2: each line leads with a date reference so the panel
      // reads like a calendar — chronological order (already in the
      // shape returned by summarizeDecisionsDeferred), date-first
      // entries, dest name as secondary context.
      //
      // Tentative items are per-dest aggregates (no specific day),
      // so we use the dest's date range as the lead. Empty days
      // already carry a day label which is usually "Jul 8" or
      // similar (set in mkDay), perfect for the calendar voice.
      var text;
      var _esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      // Pull date context from the trip when the engine summary
      // doesn't include it directly.
      var _destObj = null;
      if (trip && Array.isArray(trip.destinations)) {
        for (var di = 0; di < trip.destinations.length; di++) {
          if (trip.destinations[di] && trip.destinations[di].id === item.destId) {
            _destObj = trip.destinations[di];
            break;
          }
        }
      }
      var fmtD = global.fmtD;
      function _destRange(d) {
        if (!d || !fmtD) return '';
        if (d.dateFrom && d.dateTo && d.dateFrom !== d.dateTo) {
          return fmtD(d.dateFrom) + ' – ' + fmtD(d.dateTo);
        }
        if (d.dateFrom) return fmtD(d.dateFrom);
        return '';
      }
      if (item.kind === "tentative") {
        var range = _destRange(_destObj);
        text = (range ? "<strong>" + _esc(range) + "</strong> · " : "")
             + _esc(item.destPlace || "this destination") + ' — '
             + "<strong>" + item.count + "</strong> placeholder"
             + (item.count !== 1 ? "s" : "") + " to keep or skip";
      } else if (item.kind === "emptyDay") {
        text = "<strong>" + _esc(item.dayLbl || "a day") + "</strong> · "
             + _esc(item.destPlace || "this destination") + ' — empty';
      }
      line.innerHTML = (text || "") + " <span style=\"color:#a89055;font-size:10px;\">→</span>";
      (function (it) {
        line.onclick = function () {
          if (!it.destId) return;
          if (typeof global.selectDest === "function") global.selectDest(it.destId);
          if (it.kind === "emptyDay" && it.dayId) {
            setTimeout(function () {
              var el = document.getElementById("dy-" + it.dayId);
              if (el && el.scrollIntoView) {
                try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
              }
            }, 250);
          }
        };
      })(item);
      list.appendChild(line);
    });

    wrap.appendChild(list);
    chip.onclick = function () {
      var nowExpanded = list.style.display === "none";
      list.style.display = nowExpanded ? "block" : "none";
      caretSpan.style.transform = nowExpanded ? "rotate(90deg)" : "rotate(0deg)";
      hintSpan.textContent = nowExpanded ? "Hide" : "Show";
      try { localStorage.setItem("max-decisions-expanded", nowExpanded ? "1" : "0"); } catch (e) {}
    };
    container.appendChild(wrap);
  }

  // (e) FQ geographic-affordance banner — TM.3a (v317). Day-trip
  // note that mirrors the picker's FQ banner. Renders only when
  // trip has 2+ destinations and the notice hasn't been dismissed.
  // Reads global._fqBannerInnerHtml for the body content and
  // global.autoSave for the dismiss persistence.
  function _renderGeoAffordanceBanner(trip, container) {
    if (!container) return;
    if (!trip || !trip.destinations || trip.destinations.length < 2) return;
    if (trip.geoAffordanceNotice && trip.geoAffordanceNotice.dismissed) return;
    var nb = document.createElement("div");
    nb.id = "fq-trip-banner";
    nb.style.cssText = "margin:6px 2px 10px;padding:10px 12px;background:#eaf3fb;border:1px solid #c8dff8;border-radius:7px;font-size:11px;line-height:1.55;color:#1a3f6f;";
    nb.innerHTML = (typeof global._fqBannerInnerHtml === "function") ? global._fqBannerInnerHtml() : "";
    var dismissRow = document.createElement("div");
    dismissRow.style.cssText = "margin-top:8px;display:flex;justify-content:flex-end;";
    var dismissBtn = document.createElement("button");
    dismissBtn.style.cssText = "font-size:10px;font-weight:500;padding:4px 10px;border:1px solid #cfd8e2;border-radius:5px;background:#fff;color:#666;cursor:pointer;font-family:inherit;";
    dismissBtn.textContent = "Dismiss";
    dismissBtn.onmouseover = function () { dismissBtn.style.background = "#f5f7fa"; };
    dismissBtn.onmouseout  = function () { dismissBtn.style.background = "#fff"; };
    dismissBtn.onclick = function () {
      if (!trip.geoAffordanceNotice) trip.geoAffordanceNotice = {};
      trip.geoAffordanceNotice.dismissed = true;
      if (typeof global.autoSave === "function") global.autoSave();
      if (nb.parentNode) nb.parentNode.removeChild(nb);
    };
    dismissRow.appendChild(dismissBtn);
    nb.appendChild(dismissRow);
    container.appendChild(nb);
  }

  // (f) Coordinator — calls all five in canonical order. Convenience
  // for callers (drawTripMode, future unified renderer) that want
  // the standard top-of-trip-view header.
  function _renderTripOverviewStrips(trip, container) {
    _renderTripDatesStrip(trip, container);
    _renderTodayBanner(trip, container);
    _renderPreArrivalBanner(trip, container);
    _renderDecisionsDeferredPanel(trip, container);
    _renderGeoAffordanceBanner(trip, container);
  }

  // ── TM.3d (v320): arrival/departure logistics panel ──────
  // Lifted from inline drawTripMode. Renders only when the trip
  // has a saved candidate snapshot (trip.candidates present —
  // means it came through the picker, so re-applying entry/exit
  // can rebuild the route).
  //
  // Renders: entry/exit inputs + Apply button (calls
  // buildFromCandidates with rebuild flag), logistics
  // expand/collapse for flight/train numbers / times /
  // confirmation #s. Auto-fills departure from arrival on first
  // input as the round-trip default.
  //
  // Globals referenced (read at click time):
  //   - global._tb, trip.brief (state)
  //   - global._titleCaseCity, global._fmtTime12h (utilities)
  //   - global._renderLogisticsCol (column HTML helper)
  //   - global.buildFromCandidates (rebuild action)
  //   - global.drawTripMode (post-rebuild re-render fallback)
  function _renderArrivalDeparturePanel(trip, container) {
    if (!container) return;
    if (!trip || !trip.candidates || !trip.candidates.length) return;
    var aeRow = document.createElement("div");
    var tb = global._tb || {};
    var curEntry  = (trip.brief && trip.brief.entry)        || tb.entry  || "";
    var curExit   = (trip.brief && trip.brief.tbExit)       || tb.tbExit || "";
    var curBuffer = (trip.brief && trip.brief.exitBuffer === false) ? false : true;
    var entryDetails = (trip.brief && trip.brief.entryDetails) || {};
    var exitDetails  = (trip.brief && trip.brief.exitDetails)  || {};
    function hasLogistics(d) {
      return !!(d && (d.carrier || d.number || d.time || d.confirmation || d.notes));
    }
    var hasEntryLogistics = hasLogistics(entryDetails);
    var hasExitLogistics  = hasLogistics(exitDetails);
    var detailsExpanded   = hasEntryLogistics || hasExitLogistics || (tb && tb._logisticsOpen);
    var esc = function (s) { return String(s || "").replace(/"/g, '&quot;'); };
    function summaryLine(label, d) {
      var bits = [];
      if (d.carrier) bits.push(d.carrier);
      if (d.number)  bits.push(d.number);
      if (d.time && typeof global._fmtTime12h === "function") bits.push(global._fmtTime12h(d.time));
      else if (d.time) bits.push(d.time);
      if (!bits.length) return "";
      return '<span style="margin-right:8px;"><strong style="color:#555;">' + label + ':</strong> ' + bits.join(" · ") + '</span>';
    }
    var summaryHtml = '';
    if (hasEntryLogistics || hasExitLogistics) {
      summaryHtml = '<div id="tm-logistics-summary" style="font-size:10.5px;color:#666;margin-top:6px;' + (detailsExpanded ? 'display:none;' : '') + '">'
        + summaryLine("Arrive", entryDetails)
        + summaryLine("Depart", exitDetails)
        + '</div>';
    }
    var missing = !curEntry || !curExit;
    aeRow.style.cssText = "margin:0 2px 12px;padding:11px 14px;background:" + (missing ? "#fff8ee" : "#fafafa") + ";border:1px solid " + (missing ? "#f0d9aa" : "#e6e2d8") + ";border-radius:8px;";
    var renderLogisticsColFn = (typeof global._renderLogisticsCol === "function") ? global._renderLogisticsCol : function () { return ''; };
    // v358.3: build a datalist of cities / airports / rail stations /
    // ports / bus terminals for the current region so the entry/exit
    // inputs autocomplete as the user types. Sources: trip.destinations
    // (the actual stops on this trip — most likely matches) +
    // global._epCache[region] (LLM-fetched entry points like KEF /
    // Zurich HB / Dover). Falls back to an empty datalist if entry
    // points haven't been fetched yet, then kicks off the fetch and
    // re-renders when they land.
    var _region = (trip && trip.brief && trip.brief.region) || "";
    var _epCacheLocal = (typeof global._epCache !== "undefined") ? global._epCache : {};
    // v358.3.1: gate the cold-cache fetch on KEY PRESENCE in the
    // cache (not on emptiness of the value). fetchRegionEntryPoints
    // sets _epCache[region] = [] on failure / no-results — checking
    // ".length" alone caused an infinite render loop in regions
    // with no entry points: render → fetch returns [] → .then fires
    // drawTripMode → render checks empty array → fetches again.
    var _hasFetched = _region && _epCacheLocal && (_region in _epCacheLocal);
    var _epLoadingLocal = (typeof global._epLoading !== "undefined") ? global._epLoading : {};
    var _epPts = (_hasFetched && _epCacheLocal[_region]) || [];
    var _datalistOpts = [];
    var _seenOpts = {};
    function _addOpt(label, hint){
      if (!label) return;
      var k = String(label).toLowerCase();
      if (_seenOpts[k]) return;
      _seenOpts[k] = true;
      _datalistOpts.push('<option value="' + esc(label) + '"' + (hint ? ' label="' + esc(hint) + '"' : '') + '>');
    }
    (trip.destinations || []).forEach(function(d){ _addOpt(d.place, "destination on this trip"); });
    _epPts.forEach(function(p){
      var typeLbl = ({air:"airport", rail:"rail", sea:"port", bus:"bus"})[p.type] || "";
      _addOpt(p.name, typeLbl);
    });
    var _datalistHtml = '<datalist id="tm-arrdep-suggestions">' + _datalistOpts.join('') + '</datalist>';
    // Cold-cache fetch: only fire if we haven't fetched for this
    // region yet (key-presence check above) AND no in-flight fetch
    // is already running. This makes the fetch one-shot per region.
    if (_region && !_hasFetched && !_epLoadingLocal[_region]
        && typeof global.fetchRegionEntryPoints === "function") {
      global.fetchRegionEntryPoints(_region).then(function(){
        if (typeof global.drawTripMode === "function") global.drawTripMode();
      });
    }
    aeRow.innerHTML = ''
      + (missing
          ? '<div style="font-size:11px;font-weight:700;color:#a06010;margin-bottom:8px;">⚠ Set arrival and departure to lock in the calendar</div>'
          : '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#777;margin-bottom:8px;">Arrival / Departure</div>'
        )
      + _datalistHtml
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      +   '<label style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;">Arriving at'
      +     '<input id="tm-entry-inp" placeholder="e.g. Zurich" list="tm-arrdep-suggestions" autocomplete="off" value="' + esc(curEntry) + '" style="font-size:12px;padding:5px 9px;border:1px solid #ccc;border-radius:4px;width:160px;font-family:inherit;" />'
      +   '</label>'
      +   '<label style="font-size:11px;color:#555;display:flex;align-items:center;gap:5px;">Departing from'
      +     '<input id="tm-exit-inp" placeholder="e.g. Zurich" list="tm-arrdep-suggestions" autocomplete="off" value="' + esc(curExit) + '" style="font-size:12px;padding:5px 9px;border:1px solid #ccc;border-radius:4px;width:160px;font-family:inherit;" />'
      +   '</label>'
      +   '<button id="tm-arrdep-apply" style="font-size:11px;font-weight:600;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:4px;padding:5px 12px;cursor:pointer;font-family:inherit;">Apply</button>'
      +   '<span id="tm-arrdep-status" style="font-size:10px;color:#888;"></span>'
      + '</div>'
      + '<div style="margin-top:10px;border-top:1px dashed #d8d4c8;padding-top:8px;">'
      +   '<button id="tm-logistics-toggle" type="button" onclick="_toggleLogistics(&#39;trip&#39;)" style="font-size:11px;color:#1a5fa8;background:none;border:none;padding:2px 0;cursor:pointer;font-family:inherit;font-weight:600;">'
      +     (detailsExpanded ? '▿ Hide arrival/departure details' : '▸ Add arrival/departure details')
      +   '</button>'
      +   summaryHtml
      +   '<div id="tm-logistics-form" style="margin-top:10px;' + (detailsExpanded ? '' : 'display:none;') + '">'
      +     '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:14px;">'
      +       renderLogisticsColFn("entry", "Arrival", entryDetails, "trip")
      +       renderLogisticsColFn("exit", "Departure", exitDetails, "trip")
      +     '</div>'
      +     '<div style="font-size:10px;color:#999;margin-top:8px;">Saved automatically. These don\'t change the trip calendar.</div>'
      +   '</div>'
      + '</div>';
    container.appendChild(aeRow);

    setTimeout(function () {
      var applyBtn = document.getElementById("tm-arrdep-apply");
      var entryInp = document.getElementById("tm-entry-inp");
      var exitInp  = document.getElementById("tm-exit-inp");
      var bufferInp = document.getElementById("tm-exit-buffer");
      var statusEl = document.getElementById("tm-arrdep-status");
      var exitTouched = !!curExit;
      var titleCase = (typeof global._titleCaseCity === "function") ? global._titleCaseCity : function (s) { return (s || ""); };

      if (entryInp) {
        entryInp.addEventListener("input", function () {
          if (!exitTouched && exitInp) exitInp.value = entryInp.value;
        });
      }
      if (exitInp) exitInp.addEventListener("input", function () { exitTouched = true; });

      async function applyArrDep() {
        // v359.5.5: more verbose console logging + ensure trip.brief
        // exists before mutating. Neal's report: "On the trip view
        // changing the arrival does not work." Trip.brief was assumed
        // to exist; on older trips or after certain rebuild paths it
        // can be null/undefined, which silently dropped the brief
        // update (publishTrip's _typedEntry restore relied on the new
        // value already being in trip.brief).
        var DBG = "[Max arr/dep]";
        var tb2 = global._tb || (global._tb = {});
        if (tb2._applyInFlight) {
          console.log(DBG, "skipped — already in flight");
          if (statusEl) { statusEl.style.color = "#888"; statusEl.textContent = "Already rebuilding…"; }
          return;
        }
        var newEntry  = titleCase((entryInp && entryInp.value || "").trim());
        var newExit   = titleCase((exitInp && exitInp.value || "").trim());
        var newBuffer = !!(bufferInp && bufferInp.checked);
        if (entryInp) entryInp.value = newEntry;
        if (exitInp)  exitInp.value  = newExit;
        console.log(DBG, "Apply", { newEntry: newEntry, newExit: newExit, curEntry: curEntry, curExit: curExit });
        var changed = (newEntry !== curEntry) || (newExit !== curExit) || (newBuffer !== curBuffer);
        if (!changed) {
          if (statusEl) { statusEl.style.color = "#888"; statusEl.textContent = "No change."; }
          return;
        }
        tb2._applyInFlight = true;
        tb2.entry  = newEntry;
        tb2.tbExit = newExit;
        tb2.exitBuffer = newBuffer;
        // v359.5.5: initialize trip.brief if it's missing so the
        // brief-level entry/tbExit also get the new value. Without
        // this, publishTrip's restore step (which copies
        // _tb._typedEntry → trip.brief.entry) was the only place
        // trip.brief got touched — and if trip.brief itself was
        // missing on entry, the restore was a silent no-op.
        if (!trip.brief) trip.brief = {};
        trip.brief.entry = newEntry;
        trip.brief.tbExit = newExit;
        trip.brief.exitBuffer = newBuffer;
        if (statusEl) { statusEl.style.color = "#888"; statusEl.textContent = "Rebuilding…"; }
        if (trip.candidates && trip.candidates.length) {
          tb2.candidates = trip.candidates.map(function (c) { return Object.assign({}, c); });
        } else if (trip.destinations && trip.destinations.length) {
          // v358.4: synthesize pseudo-candidates from existing
          // destinations when trip.candidates is empty (which happens
          // when the trip was built without a candidate-explorer phase
          // OR after a previous rebuild drained it). Without this,
          // publishTrip's `kept` filter returns [], orderKeptCandidates
          // returns ordered=[], and _reconcileDestinations strips every
          // surviving destination because nothing in the new ordered
          // list matches them — wiping the user's trip on what should
          // be a benign "I changed my arrival/departure city" edit.
          // Same shape as resequenceWithCurrentBrief at index.html
          // ~13095 (the Parameters-edit path that uses pseudo-candidates
          // for exactly this reason).
          tb2.candidates = trip.destinations.map(function (d) {
            var rf = (d.attachedEvents || []).map(function (e) { return e.name; });
            return {
              id: d.id, place: d.place, country: d.country || "",
              lat: (typeof d.lat === "number") ? d.lat : null,
              lng: (typeof d.lng === "number") ? d.lng : null,
              _required: !!(d.attachedEvents && d.attachedEvents.length),
              _requiredFor: rf,
              stayRange: (d.nights || 3) + " nights",
              nights: d.nights || 3,
              status: "keep",
              whyItFits: d.intent || ""
            };
          });
        }
        tb2._isRebuild = true;
        try {
          console.log(DBG, "buildFromCandidates: starting", { entry: tb2.entry, exit: tb2.tbExit, candidateCount: (tb2.candidates||[]).length });
          if (typeof global.buildFromCandidates === "function") await global.buildFromCandidates();
          console.log(DBG, "buildFromCandidates: done; rendering trip view");
          if (typeof global.drawTripMode === "function") global.drawTripMode();
          // v359.5.5: visible success status. Without this the user
          // had no confirmation the rebuild ran — just the trip view
          // redrew silently. If the typed entry didn't change the
          // visible destinations (because it doesn't match a kept
          // candidate), the silent redraw read as "nothing happened."
          if (statusEl) {
            statusEl.style.color = "#3a7a4a";
            statusEl.textContent = "✓ Trip rebuilt — arrival is now " + (newEntry || "unset") + (newExit ? ", departure " + newExit : "");
          }
        } catch (e) {
          console.error("[Max] applyArrDep buildFromCandidates failed:", e);
          if (statusEl) { statusEl.style.color = "#c44"; statusEl.textContent = "Couldn't rebuild: " + (e && e.message ? e.message : "unknown error"); }
        } finally {
          tb2._applyInFlight = false;
        }
      }
      if (applyBtn) applyBtn.addEventListener("click", applyArrDep);
      if (bufferInp) bufferInp.addEventListener("change", applyArrDep);
      [entryInp, exitInp].forEach(function (inp) {
        if (inp) inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); applyArrDep(); }
        });
        if (inp) inp.addEventListener("blur", function () {
          this.value = titleCase(this.value);
        });
      });
    }, 0);
  }

  // ── TM.3b (v318): destinations-list header section ────────
  // Returns a new <div class="tm-section"> containing the
  // "Destinations" label, day/night/dest total line, and the
  // "↺ Reverse order" + "✎ Edit destinations" buttons (each
  // shown only when its preconditions are met). Caller appends
  // destination cards directly to the returned element, then
  // appends the element to the lp-content container.
  //
  // Globals referenced (read at click time):
  //   - global.reverseTripOrder   (engine mutator)
  //   - global.reopenPickerForEdit, global.reopenCandidateExplorer
  //     (picker-edit re-entry path; falls back to legacy explorer
  //      when the trip pre-dates the place-mode picker)
  function _renderDestinationsListHeader(trip) {
    var listSec = document.createElement("div");
    listSec.className = "tm-section";
    var listHdr = document.createElement("div");
    listHdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;";
    var lbl = document.createElement("div");
    lbl.className = "tm-sec-title";
    lbl.style.marginBottom = "0";
    lbl.textContent = "Destinations";
    listHdr.appendChild(lbl);

    var dests = (trip && trip.destinations) || [];
    var totalNights = dests.reduce(function (s, d) { return s + (d.nights || 0); }, 0);
    var totalDays = totalNights + (dests.length ? 1 : 0);
    var totalLine = document.createElement("div");
    totalLine.style.cssText = "font-size:11px;color:#666;margin-bottom:10px;";
    totalLine.innerHTML = dests.length
      ? '<strong style="color:#111;">' + totalDays + ' days</strong> · ' + totalNights + ' nights · ' + dests.length + ' destination' + (dests.length !== 1 ? 's' : '')
      : '<span style="color:#aaa;font-style:italic;">No destinations yet.</span>';

    // Reverse-order button — only on trips with 3+ destinations.
    if (dests.length >= 3) {
      var revBtn = document.createElement("button");
      revBtn.style.cssText = "font-size:11px;font-weight:500;color:#1a5fa8;background:#fff;border:1px solid #c8d8f0;border-radius:6px;padding:6px 11px;cursor:pointer;font-family:inherit;margin-right:6px;white-space:nowrap;";
      revBtn.textContent = "↺ Reverse order";
      revBtn.title = "Flip the order of destinations on this trip";
      revBtn.onmouseover = function () { revBtn.style.background = "#f0f5fc"; };
      revBtn.onmouseout  = function () { revBtn.style.background = "#fff"; };
      revBtn.onclick = function () { if (typeof global.reverseTripOrder === "function") global.reverseTripOrder(); };
      listHdr.appendChild(revBtn);
    }

    // Round HZ (picker hero map, step 8): "Considered (N)" button.
    // Surfaces the carry-forward set — candidates Max suggested that
    // the user neither accepted nor rejected at picker time. Only
    // shows when there's at least one such candidate. Clicking opens
    // a modal listing them with one-click Add; Add promotes to keep
    // and reopens the picker for confirmation/commit.
    if (trip && Array.isArray(trip.candidates) && trip.candidates.length) {
      var consideredCount = trip.candidates.filter(function(c){
        return c && c.status !== "keep" && c.status !== "reject";
      }).length;
      if (consideredCount > 0) {
        var conBtn = document.createElement("button");
        conBtn.style.cssText = "font-size:11px;font-weight:500;color:#1a5fa8;background:#fff;border:1px solid #c8d8f0;border-radius:6px;padding:6px 11px;cursor:pointer;font-family:inherit;margin-right:6px;white-space:nowrap;";
        conBtn.textContent = "Considered (" + consideredCount + ")";
        conBtn.title = "Places Max suggested that you didn't accept or reject — add any of them to this trip";
        conBtn.onmouseover = function () { conBtn.style.background = "#f0f5fc"; };
        conBtn.onmouseout  = function () { conBtn.style.background = "#fff"; };
        conBtn.onclick = function () {
          if (typeof global.showConsideredCandidatesModal === "function") {
            global.showConsideredCandidatesModal();
          }
        };
        listHdr.appendChild(conBtn);
      }
    }

    // Edit destinations — only when there's a saved candidate snapshot.
    // v359.5: bumped from a 12px secondary button to a 14px primary
    // CTA. With all mode pills removed (v359.2.3), this is the only
    // path back to the picker — it should look like the heaviest
    // action in the destinations header, not an afterthought tucked
    // next to "Considered (N)" and "Reverse order". Dropped the ✎
    // glyph per Neal's call: just "Edit destinations", plain.
    if (trip && trip.candidates && trip.candidates.length) {
      var editBtn = document.createElement("button");
      editBtn.style.cssText = "font-size:14px;font-weight:700;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:8px;padding:10px 18px;cursor:pointer;font-family:inherit;white-space:nowrap;box-shadow:0 1px 3px rgba(26,95,168,0.18);";
      editBtn.textContent = "Edit destinations";
      editBtn.title = "Re-open the picker with your current keep/reject decisions";
      editBtn.onmouseover = function () { editBtn.style.background = "#134a8a"; };
      editBtn.onmouseout  = function () { editBtn.style.background = "#1a5fa8"; };
      editBtn.onclick = function () {
        if (typeof global.reopenPickerForEdit === "function" && trip && Array.isArray(trip.mdcItems) && trip.mdcItems.length) {
          global.reopenPickerForEdit();
        } else if (typeof global.reopenCandidateExplorer === "function") {
          global.reopenCandidateExplorer();
        }
      };
      listHdr.appendChild(editBtn);
    }

    listSec.appendChild(listHdr);
    listSec.appendChild(totalLine);

    // v359.19: single trip-level banner surfacing the user's
    // accommodation preference + avoidances. Replaces both the
    // per-card box (v359.15.1) and the per-Stay-tab box (v359.17).
    // The filter applies trip-wide, so one mention is enough — and
    // the destinations list is the first thing the user sees on a
    // built trip, so it's the natural place.
    (function(){
      var prefsLines = [];
      try {
        if (window.MaxDB && MaxDB.prefs) {
          var acc = MaxDB.prefs.get("accommodation");
          if (typeof acc === "string" && acc.trim().length) {
            var accShort = acc.trim();
            if (accShort.length > 120) accShort = accShort.substring(0, 117) + "…";
            prefsLines.push({ label: "Stay preference", value: accShort });
          }
          var avoidObj = MaxDB.prefs.get("avoidDefaults");
          var avoidOther = MaxDB.prefs.get("avoidOtherDefaults");
          var picks = [];
          if (avoidObj && typeof avoidObj === "object") {
            var labels = { altitude:"high altitude", crowds:"crowds", heat:"extreme heat", cold:"extreme cold", longDrives:"long drives" };
            Object.keys(avoidObj).forEach(function(k){ if (avoidObj[k] && labels[k]) picks.push(labels[k]); });
          }
          if (typeof avoidOther === "string" && avoidOther.trim().length) {
            var aoShort = avoidOther.trim();
            if (aoShort.length > 80) aoShort = aoShort.substring(0, 77) + "…";
            picks.push(aoShort);
          }
          if (picks.length) prefsLines.push({ label: "Avoiding", value: picks.join(", ") });
        }
      } catch(_){}
      if (prefsLines.length) {
        var banner = document.createElement("div");
        banner.style.cssText = "margin:0 0 12px;padding:9px 12px;background:#fafafa;border:1px solid #ececec;border-radius:6px;font-size:11.5px;color:#555;line-height:1.6;";
        banner.innerHTML = prefsLines.map(function(p){
          return '<div><strong style="color:#777;font-weight:600;">' + p.label + ':</strong> ' + p.value.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</div>';
        }).join("");
        listSec.appendChild(banner);
      }
    })();

    return listSec;
  }

  // ── TM.3f (v323): per-destination card render ─────────────
  // The biggest TM lift — ~408 lines moved from inline drawTripMode
  // helper into the unified renderer. Body is the v322 version verbatim;
  // only change is `global.` prefix on the ~20 top-level references
  // (executeMoveDest, addBufferNight, mkDateInp, toggleListDateEdit,
  // saveDates, selectDest, delDestWithUndo, getRouting, getLeg,
  // _generatedCityData, _routingFetchInFlight, _activeDmSection,
  // activeDest, _tb, autoSave, drawTripMode, _modeLabels, fmtD,
  // _fmtTime12h, ungroupDayTrip, _wireDragHandlers, closeListDateEdit).
  //
  // Caller passes (dest, idx, trip, listSec). The function appends both
  // the card and the route chip to listSec — same shape as the inline
  // forEach callback it replaces. Returns nothing.
  function _renderTripDestinationCard(dest, idx, trip, listSec) {
    var activeDest = global.activeDest;
    var _tb = global._tb;

    var card=document.createElement("div"); card.className="tm-dest"+(dest.id===activeDest?" active":""); card.setAttribute("data-id",dest.id);
    // Draggable on fine-pointer devices (gate enforced by CSS). Listeners are safe on any device — they just won't fire without HTML5 DnD.
    card.setAttribute("draggable", "true");
    // Tooltip signals the drag affordance now that the visible grip icon is gone.
    card.title = "Drag to reorder, or use the ↑↓ arrows";
    global._wireDragHandlers(card, dest);
    // Body: name + optional label + dates
    var bodyDiv=document.createElement("div"); bodyDiv.className="tm-dest-body";
    // Up/down arrow buttons — visible on hover (or always on touch),
    // convey reorder-ability more clearly than a drag-grip glyph.
    // v353.2: arrows moved out of the top "name row" into the dates
    // row below. The card's primary visual is now the destination
    // name; the arrows live alongside the smaller dates row where
    // they read as "this is the order, here's how to change it."
    var total = (trip.destinations||[]).length;
    var upBtn = document.createElement("button");
    upBtn.className = "tm-reorder-btn";
    upBtn.textContent = "↑";
    upBtn.title = "Move up";
    upBtn.disabled = (idx === 0);
    (function(d, fromIdx){
      upBtn.onclick = function(e){
        e.stopPropagation();
        if (fromIdx <= 0) return;
        global.executeMoveDest(d, fromIdx, fromIdx - 1);
      };
    })(dest, idx);
    var downBtn = document.createElement("button");
    downBtn.className = "tm-reorder-btn";
    downBtn.textContent = "↓";
    downBtn.title = "Move down";
    downBtn.disabled = (idx === total - 1);
    (function(d, fromIdx){
      downBtn.onclick = function(e){
        e.stopPropagation();
        if (fromIdx >= (trip.destinations||[]).length - 1) return;
        global.executeMoveDest(d, fromIdx, fromIdx + 1);
      };
    })(dest, idx);
    // v353.2: prominent destination-name row. The whole card is
    // tappable to drill in; this row is the visual anchor for that
    // affordance — large bold name on the left, chevron on the
    // right hinting "tap to open." Rename moved out of trip-view
    // entirely (now lives on the dest-mode title); arrows moved
    // down to the dates row.
    var nameRow = document.createElement("div");
    nameRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px;";
    var nameEl=document.createElement("div"); nameEl.className="tm-dest-name";
    nameEl.style.cssText = "flex:1;min-width:0;font-size:17px;font-weight:700;color:#111;line-height:1.25;letter-spacing:-0.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    nameEl.textContent = dest.label || dest.place;
    var chev = document.createElement("span");
    chev.textContent = "›";
    chev.style.cssText = "color:#bbb;font-size:20px;font-weight:400;line-height:1;flex-shrink:0;padding-right:2px;";
    nameRow.appendChild(nameEl);
    nameRow.appendChild(chev);
    // Arrival / Departure tags on first / last cards (Round BT).
    var isFirst = (idx === 0);
    var isLast = (idx === (trip.destinations||[]).length - 1);
    if (isFirst || isLast) {
      var tag = document.createElement("div");
      tag.style.cssText = "font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#888;margin-bottom:3px;display:flex;align-items:center;gap:5px;";
      var entryCity = (trip.brief && trip.brief.entry) || (_tb && _tb.entry) || "";
      var exitCity = (trip.brief && trip.brief.tbExit) || (_tb && _tb.tbExit) || "";
      if (isFirst && isLast) {
        tag.innerHTML = "✈ Arrival · Departure";
        tag.style.color = "#1a5fa8";
      } else if (isFirst) {
        tag.innerHTML = "✈ Arrival" + (entryCity ? ' <span style="color:#bbb;font-weight:500;">into ' + entryCity + '</span>' : '');
        tag.style.color = "#1a5fa8";
      } else {
        tag.innerHTML = "✈ Departure" + (exitCity ? ' <span style="color:#bbb;font-weight:500;">from ' + exitCity + '</span>' : '');
        tag.style.color = "#b05820";
      }
      bodyDiv.appendChild(tag);

      // Round CK.1: render flight/train logistics on the first (arrival) and
      // last (departure) cards.
      (function renderLogisticsLine(){
        var details = isFirst
          ? (trip.brief && trip.brief.entryDetails) || null
          : (trip.brief && trip.brief.exitDetails) || null;
        if (!details) return;
        var mode = isFirst
          ? ((trip.brief && trip.brief.entryMode) || (_tb && _tb.entryMode) || "fly")
          : ((trip.brief && trip.brief.exitMode) || (_tb && _tb.exitMode) || "fly");
        var ml = global._modeLabels(mode, isFirst ? "arrival" : "departure");
        var verb = isFirst ? ml.arrivalVerb : ml.departureVerb;
        var bits = [];
        var carrierNum = [details.carrier, details.number].filter(function(x){return !!x;}).join(" ");
        if (carrierNum) bits.push('<strong style="color:#333;">'+carrierNum+'</strong>');
        var dateBit = "";
        if (details.date && typeof global.fmtD === "function") {
          dateBit = global.fmtD(details.date);
        }
        var fmt12 = global._fmtTime12h;
        if (details.time && dateBit) bits.push(verb + " " + fmt12(details.time) + " on " + dateBit);
        else if (details.time) bits.push(verb + " " + fmt12(details.time));
        else if (dateBit) bits.push(verb + " on " + dateBit);
        if (!bits.length && !details.confirmation && !details.notes) return;
        var line = document.createElement("div");
        line.style.cssText = "font-size:11px;color:#555;margin:1px 0 4px;line-height:1.45;";
        var html = bits.join(' · ');
        if (details.confirmation) {
          html += ' <span style="color:#888;">conf. ' + details.confirmation + '</span>';
        }
        if (details.url) {
          var safeUrl = String(details.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += ' <a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="margin-left:6px;font-size:10px;color:#1a5fa8;text-decoration:none;font-weight:600;">↗ booking</a>';
        }
        if (details.notes) {
          html += '<div style="font-size:10.5px;color:#888;margin-top:1px;">' + details.notes + '</div>';
        }
        line.innerHTML = html;
        bodyDiv.appendChild(line);
      })();
    }
    // v353.2: name comes FIRST now (was below dates). The
    // destination's name is the primary identifier — what the user
    // is reading on each card to find the right one. Arrows and
    // dates are secondary metadata.
    bodyDiv.appendChild(nameRow);
    // If the user gave the destination a custom label, show the
    // canonical place name in small grey text below the label so
    // the connection ("My birthday weekend → Lisbon") is visible.
    if (dest.label && dest.label !== dest.place) {
      var plLbl = document.createElement("div");
      plLbl.className = "tm-dest-label";
      plLbl.style.cssText = "font-size:11px;color:#888;margin-top:-2px;margin-bottom:4px;";
      plLbl.textContent = dest.place;
      bodyDiv.appendChild(plLbl);
    }
    // Dates row — flex container holding the dates+pencil click
    // target on the left and the ↑↓ reorder arrows on the right.
    // v327: dates row has its own hover treatment (light blue bg +
    // slight inset padding) so it reads as a distinct clickable
    // region for date editing. v353.2: arrows moved into this row
    // on the right; dates click target now has flex:1 so it fills
    // remaining space and the arrows stay anchored right.
    var dateLineWrap = document.createElement("div");
    dateLineWrap.style.cssText = "display:flex;align-items:center;gap:6px;";
    var dates=document.createElement("div"); dates.className="tm-dest-dates tm-dest-dates-clickable";
    dates.style.cssText = "flex:1;min-width:0;font-size:13px;font-weight:600;color:#444;cursor:pointer;padding:3px 6px;margin:-3px -6px;border-radius:4px;transition:background .12s ease;";
    dates.title="Click to edit dates";
    dates.onmouseover = function(){ dates.style.background = "#f0f6fc"; };
    dates.onmouseout  = function(){ dates.style.background = "transparent"; };
    (function(did){ dates.onclick=function(e){ e.stopPropagation(); global.toggleListDateEdit(did); }; })(dest.id);
    var _chipNights = (dest.dayTrips || []).reduce(function(s, dt){ return s + (dt && dt.sourceNights || 0); }, 0);
    var _baseNights = Math.max(0, (dest.nights || 0) - _chipNights);
    var _nightsLabel = "(" + dest.nights + " night" + (dest.nights !== 1 ? "s" : "");
    if (_chipNights > 0 && _baseNights > 0) {
      _nightsLabel += " · +" + _chipNights + " from day trip" + (_chipNights !== 1 ? "s" : "");
    }
    _nightsLabel += ")";
    var fmtDFn = global.fmtD;
    dates.textContent=fmtDFn(dest.dateFrom)+" – "+fmtDFn(dest.dateTo)+" "+_nightsLabel;
    var datePencil = document.createElement("span");
    datePencil.textContent = "✎";
    datePencil.style.cssText = "font-size:11px;color:#888;font-weight:400;margin-left:6px;";
    dates.appendChild(datePencil);
    dateLineWrap.appendChild(dates);
    dateLineWrap.appendChild(upBtn);
    dateLineWrap.appendChild(downBtn);
    bodyDiv.appendChild(dateLineWrap);

    // v353.6: weather strip — quick forecast (within 16 days) or
    // climate normals (further out) so the user can see at a
    // glance what the trip will be like at this destination on
    // these dates. Async fetch via Open-Meteo, cached locally.
    if (typeof global.renderDestWeatherStrip === "function") {
      try { global.renderDestWeatherStrip(dest, bodyDiv); } catch (_) {}
    }

    // Required-for badges
    if(dest.attachedEvents && dest.attachedEvents.length){
      var evRow=document.createElement("div");
      evRow.style.cssText="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;";
      dest.attachedEvents.forEach(function(ev){
        if(!ev || !ev.name) return;
        var isCondition = ev.type === "condition";
        var isManual = ev.type === "manual" || ev.name === "__manual__";
        if(isManual) return;
        var chip=document.createElement("div");
        var icon = isCondition ? "✨" : "🚂";
        var color = isCondition ? "#b05820" : "#1a5fa8";
        var bg    = isCondition ? "#fff8f0" : "#e8f0fc";
        var border= isCondition ? "#f0dcc0" : "#c8d8f0";
        chip.style.cssText="font-size:9px;font-weight:600;color:"+color+";background:"+bg+";border:1px solid "+border+";padding:2px 7px;border-radius:10px;display:inline-flex;align-items:center;gap:4px;";
        var isRouteEv = ev.type === "route";
        var labelText = isRouteEv ? (ev.name + " stop") : ev.name;
        chip.innerHTML = icon + " " + labelText;
        var titleParts = [];
        if (isRouteEv) titleParts.push(dest.place + " is a stop on the " + ev.name + ".");
        if (ev.description) titleParts.push(ev.description);
        if (titleParts.length) chip.title = titleParts.join(" ");
        evRow.appendChild(chip);
      });
      if(evRow.children.length) bodyDiv.appendChild(evRow);
    }

    // v359.17.1: pref reminder box removed from destination cards.
    // It now lives only under the Stay tab (see _renderDestStayPane),
    // which is the relevant context for accommodation + avoidance
    // signals. Keeping it on every card was visual noise.

    // v359.45 Phase 1 (hard cut): render day-trip chips from
    // PlanItems with type:dayTrip instead of dest.dayTrips. Walks
    // every day's planItems[] and collects dayTrip entries. The
    // place name comes from trip.places[placeId].name, and the
    // legacy bookkeeping (distKm, sourceNights) is on pi.legacy.
    (function _renderDayTripChips(){
      if (!Array.isArray(dest.days) || !dest.days.length) return;
      var dayTripItems = [];
      dest.days.forEach(function(day, dayIdx){
        (day.planItems || []).forEach(function(pi, piIdx){
          if (pi && pi.type === 'dayTrip') {
            dayTripItems.push({ pi: pi, dayIdx: dayIdx, piIdx: piIdx });
          }
        });
      });
      if (!dayTripItems.length) return;
      var places = (trip && trip.places) || {};
      var dtRow = document.createElement("div");
      dtRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;align-items:center;";
      var dtLabel = document.createElement("span");
      dtLabel.style.cssText = "font-size:9px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-right:2px;";
      dtLabel.textContent = "Day trips:";
      dtRow.appendChild(dtLabel);
      dayTripItems.forEach(function(entry){
        var pi = entry.pi;
        var place = places[pi.placeId];
        var placeName = (place && place.name) || pi.placeId || "(unknown)";
        var distKm = (pi.legacy && pi.legacy.distKm) || 0;
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "tm-day-trip-chip";
        var placeSpan = document.createElement("span");
        placeSpan.textContent = "📍 " + placeName;
        var actionSpan = document.createElement("span");
        actionSpan.className = "dtc-action";
        actionSpan.textContent = "↩ stay overnight";
        chip.appendChild(placeSpan);
        chip.appendChild(actionSpan);
        chip.title = "Day trip from " + dest.place
          + (distKm ? " · " + (typeof global._fmtDistance === "function" ? global._fmtDistance(distKm) + " away" : distKm + "km away") : "")
          + " · Click to make this an overnight stay instead.";
        (function(hubDest, planItem){
          chip.onclick = function(e){
            e.stopPropagation();
            if (typeof global.ungroupDayTripByPlanItem === "function") {
              global.ungroupDayTripByPlanItem(hubDest, planItem);
            } else if (typeof global.ungroupDayTrip === "function") {
              // Legacy path — kept temporarily for trips that still
              // have dest.dayTrips populated. New PlanItem-based
              // ungroup function will be added when the trip-view
              // refactor lands.
              console.warn("[Max] ungroupDayTripByPlanItem not defined; legacy ungroup may not work");
            }
          };
        })(dest, pi);
        dtRow.appendChild(chip);
      });
      bodyDiv.appendChild(dtRow);
    })();

    // Round GA: per-card buffer-night buttons.
    if (isFirst || isLast) {
      var bufRow = document.createElement("div");
      bufRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;";
      if (isFirst) {
        var arrBtn = document.createElement("button");
        arrBtn.type = "button";
        arrBtn.textContent = "+ Add arrival buffer";
        arrBtn.title = "Add a 1-night buffer at the start of the trip — for arrival recovery, jet lag, etc. Same city extends this stay; different city adds a separate stop.";
        arrBtn.style.cssText = "font-size:10.5px;font-weight:500;color:#1a5fa8;background:#fff;border:1px solid #c8d8f0;border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;";
        arrBtn.onmouseover = function(){ arrBtn.style.background = "#f0f5fc"; };
        arrBtn.onmouseout = function(){ arrBtn.style.background = "#fff"; };
        (function(defaultCity){
          arrBtn.onclick = function(e){
            e.stopPropagation();
            var city = prompt("Add an arrival buffer night.\n\nWhere? (Same city — " + defaultCity + " — extends this stay by 1 night. Different city — e.g., an airport hotel — adds a separate stop.)", defaultCity);
            if (city == null) return;
            global.addBufferNight("arrival", city);
          };
        })(dest.place);
        bufRow.appendChild(arrBtn);
      }
      if (isLast) {
        var depBtn = document.createElement("button");
        depBtn.type = "button";
        depBtn.textContent = "+ Add departure buffer";
        depBtn.title = "Add a 1-night buffer at the end of the trip — so a late arrival from your last stop doesn't push you onto same-day flying. Same city extends this stay; different city adds a separate stop.";
        depBtn.style.cssText = "font-size:10.5px;font-weight:500;color:#b05820;background:#fff;border:1px solid #e8c8b0;border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;";
        depBtn.onmouseover = function(){ depBtn.style.background = "#fcf5ee"; };
        depBtn.onmouseout = function(){ depBtn.style.background = "#fff"; };
        (function(defaultCity){
          depBtn.onclick = function(e){
            e.stopPropagation();
            var city = prompt("Add a departure buffer night.\n\nWhere? (Same city — " + defaultCity + " — extends this stay by 1 night. Different city — e.g., an airport hotel — adds a separate stop.)", defaultCity);
            if (city == null) return;
            global.addBufferNight("departure", city);
          };
        })(dest.place);
        bufRow.appendChild(depBtn);
      }
      bodyDiv.appendChild(bufRow);
    }

    // v359.23: "Change role" deep-link — opens the picker focused on
    // this destination so the user can switch overnight ↔ day trip.
    // Role changes cascade (nights redistribute, day-trip hub
    // assignment, etc.), so they live in the picker rather than in
    // the trip view itself. This link is the discoverability surface.
    //
    // v359.24.1: shown on every destination, including first/last.
    // For arrival/departure candidates the picker's role chip is
    // already hidden (per _computeCandidateRole) — the popover will
    // simply have nothing meaningful to change. Better to over-show
    // than under-show, since "where's the change role link?" is a
    // worse failure than "the popover doesn't apply here." Falls
    // back to reopenCandidateExplorer if there's no candidate
    // snapshot on the trip.
    (function(){
      var roleRow = document.createElement("div");
      roleRow.style.cssText = "display:flex;justify-content:flex-end;margin-top:6px;";
      var link = document.createElement("a");
      link.href = "#";
      link.textContent = "↺ Change role";
      link.title = "Open the picker to switch overnight ↔ day trip";
      link.style.cssText = "font-size:10.5px;font-weight:500;color:#1a5fa8;text-decoration:none;cursor:pointer;";
      (function(destPlace){
        link.onclick = function(e){
          e.preventDefault();
          e.stopPropagation();
          // Stash the candidate name so picker-ui can auto-scroll +
          // pop the role popover for it on render.
          if (global._tb) global._tb._focusCandidateName = destPlace;
          if (typeof global.reopenPickerForEdit === "function" && trip && Array.isArray(trip.mdcItems) && trip.mdcItems.length) {
            global.reopenPickerForEdit();
          } else if (typeof global.reopenCandidateExplorer === "function") {
            global.reopenCandidateExplorer();
          }
        };
      })(dest.place);
      roleRow.appendChild(link);
      bodyDiv.appendChild(roleRow);
    })();

    card.appendChild(bodyDiv);
    // Show generating indicator for unknown cities
    var genData=(global._generatedCityData||{})[dest.place.toLowerCase()];
    if(genData&&genData.loading){
      var genLbl=document.createElement("div"); genLbl.className="max-thinking"; genLbl.style.cssText="font-size:10px;color:#7c5cbf;padding:2px 0;font-style:italic;";
      genLbl.textContent="Max is generating data…"; card.appendChild(genLbl);
    }

    // Edit dates inline — Pikaday date picker
    var editRow=document.createElement("div"); editRow.id="di-edit-row-"+dest.id; editRow.style.display="none";
    editRow.style.cssText="display:none;padding:5px 0 2px;";
    var mkInpFn = global.mkDateInp;
    var fi, ti;
    if (mkInpFn) {
      fi=mkInpFn("edit-from-"+dest.id, dest.dateFrom, {onSelect:function(iso){
        ti.setMin(iso);
        if(ti.getIso()&&ti.getIso()<iso) ti.setIso('');
      }});
      ti=mkInpFn("edit-to-"+dest.id, dest.dateTo, {minDate:dest.dateFrom});
    }
    var arrow=document.createElement("span"); arrow.style.cssText="font-size:10px;color:#aaa;margin:0 4px;"; arrow.textContent="→";
    var sv=document.createElement("button"); sv.className="date-save-btn"; sv.textContent="Save";
    sv.onclick=function(e){
      e.stopPropagation();
      if (!fi || !ti) return;
      var newFrom=fi.getIso(); var newTo=ti.getIso();
      if(!newFrom||!newTo) return;
      global.saveDates(dest.id, newFrom, newTo);
    };
    var cx=document.createElement("button"); cx.className="date-cancel-btn"; cx.textContent="Cancel";
    cx.onclick=function(e){e.stopPropagation();global.closeListDateEdit(dest.id);};
    editRow.onclick=function(e){e.stopPropagation();};
    if (fi) editRow.appendChild(fi);
    editRow.appendChild(arrow);
    if (ti) editRow.appendChild(ti);
    editRow.appendChild(document.createElement("br")); editRow.appendChild(sv); editRow.appendChild(cx);
    card.appendChild(editRow);

    // Action buttons
    var acts=document.createElement("div"); acts.className="tm-dest-acts";
    var openBtn=document.createElement("button"); openBtn.className="tm-dest-btn";
    openBtn.textContent=(dest.id===activeDest?"Resume ↩":"Open →");
    if(dest.id===activeDest) openBtn.style.cssText="font-weight:600;border-color:#aac4e8;color:#1a5fa8;";
    (function(did){openBtn.onclick=function(e){e.stopPropagation();global.selectDest(did);};})(dest.id);
    var editBtn=document.createElement("button"); editBtn.className="tm-dest-btn"; editBtn.id="di-edit-btn-"+dest.id; editBtn.textContent="Edit dates";
    (function(did){editBtn.onclick=function(e){e.stopPropagation();global.toggleListDateEdit(did);};})(dest.id);
    var delBtn=document.createElement("button"); delBtn.className="tm-dest-btn"; delBtn.style.color="#c05020"; delBtn.textContent="✕ Remove";
    (function(did){delBtn.onclick=function(e){e.stopPropagation();global.delDestWithUndo(e,did);};})(dest.id);
    acts.appendChild(openBtn); acts.appendChild(editBtn); acts.appendChild(delBtn);
    card.appendChild(acts);

    // Overlap warning
    var ov=document.createElement("div"); ov.id="ov-warn-"+dest.id; ov.className="overlap-warn hidden"; card.appendChild(ov);

    card.onclick=function(){global.selectDest(dest.id);};
    listSec.appendChild(card);

    // Route chip to next
    if(idx<trip.destinations.length-1){
      var next=trip.destinations[idx+1];
      var chip2=document.createElement("div"); chip2.className="route-chip";
      var dot=document.createElement("div"); dot.className="route-dot";
      var inner=document.createElement("div"); inner.className="route-chip-inner";
      var routing=(typeof global.getRouting === "function") ? global.getRouting(dest.place,next.place) : null;
      var leg=(typeof global.getLeg === "function") ? global.getLeg(dest.id,next.id) : null;
      var bookedBk=leg&&leg.bookings&&leg.bookings.find(function(b){return b.status==="booked";});

      var row=document.createElement("div"); row.style.cssText="display:flex;align-items:center;gap:4px;flex-wrap:wrap;";

      if(bookedBk){
        var modeMap={"train":"🚂","bus":"🚌","flight":"✈️","ferry":"⛴️"};
        var bkLabel=document.createElement("span"); bkLabel.style.cssText="font-size:11px;";
        bkLabel.textContent=(modeMap[bookedBk.mode]||"🚂")+" "+bookedBk.operator;
        var bkBadge=document.createElement("span"); bkBadge.style.cssText="font-size:9px;color:#2a7a4e;font-weight:600;";
        bkBadge.textContent="✓ booked";
        if(bookedBk.departure) bkLabel.textContent+=" · "+fmtDFn(bookedBk.departure)+(bookedBk.departureTime?" "+bookedBk.departureTime:"");
        row.appendChild(bkLabel); row.appendChild(bkBadge);
      } else if(routing&&routing.options&&routing.options.length){
        routing.options.forEach(function(opt,i){
          var pill=document.createElement("span");
          pill.style.cssText="font-size:10px;color:#444;white-space:nowrap;";
          pill.textContent=opt.icon+" "+opt.name.split(" ")[0]+(opt.meta?" · "+opt.meta.split(" ")[0]:"");
          row.appendChild(pill);
          if(i<routing.options.length-1){
            var sep=document.createElement("span"); sep.style.cssText="font-size:10px;color:#ccc;"; sep.textContent="|";
            row.appendChild(sep);
          }
        });
      } else {
        var _legKey = [dest.place.toLowerCase(), next.place.toLowerCase()].sort().join("|");
        var _isFetching = (global._routingFetchInFlight||{})[_legKey];
        var _cachedFail = trip._routingCache && trip._routingCache[_legKey] && trip._routingCache[_legKey]._failed;
        var unk=document.createElement("span");
        if(_isFetching){
          unk.className="max-thinking";
          unk.style.cssText="font-size:10px;color:#888;";
          unk.textContent="⇄ finding options…";
        } else if(_cachedFail){
          unk.style.cssText="font-size:10px;color:#aaa;";
          unk.textContent="↔ route unknown";
        } else {
          unk.style.cssText="font-size:10px;color:#aaa;";
          unk.textContent="↔ route unknown";
        }
        row.appendChild(unk);
      }

      // Routing → button
      var rtBtn=document.createElement("span");
      rtBtn.style.cssText="font-size:10px;color:#1a6fb0;font-weight:600;margin-left:auto;white-space:nowrap;cursor:pointer;padding:1px 5px;border:1px solid #cce;border-radius:4px;background:#f0f5ff;flex-shrink:0;";
      rtBtn.textContent="Routing →";
      row.appendChild(rtBtn);

      inner.appendChild(row);

      // Click anywhere: open Routing tab
      (function(did){inner.onclick=function(){
        global._activeDmSection="routing";
        global.selectDest(did);
      };})(dest.id);

      chip2.appendChild(dot); chip2.appendChild(inner);
      listSec.appendChild(chip2);
    }
  }

  // ── TM.7.2 (v331): Notes from the road strip ───────────────
  // Lifted verbatim from drawDestMode. Self-contained: takes the
  // destination object + parent container, appends a <div> with a
  // textarea backed by `dest.travelerNotes`. Save-on-blur via the
  // top-level `localSave` (same path mobile uses); cross-tab
  // storage events propagate to any open mobile tabs within ~1s.
  // Closure deps lifted to globals: localSave, MaxDB, _currentTripId,
  // serializeTrip. (All read at blur time, not at render time.)
  function _renderTravelerNotes(dest, container) {
    var notesWrap = document.createElement("div");
    notesWrap.style.cssText = "margin:8px 0 10px;padding:10px 12px;background:#fafafa;border:1px solid #ececec;border-radius:8px;";
    var notesHdr = document.createElement("div");
    notesHdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;";
    var notesLabel = document.createElement("span");
    notesLabel.textContent = "Notes from the road";
    var notesStatus = document.createElement("span");
    // v351: was id="dm-notes-status" — singular ID broke when mobile
    // renders one note block per destination on the same page. Status
    // node is now closure-captured, so each call to renderTravelerNotes
    // owns its own status element. Desktop's single-card rendering is
    // unaffected; mobile can now render the full destination list with
    // working per-card status.
    notesStatus.style.cssText = "font-size:9px;font-weight:500;color:#aaa;text-transform:none;letter-spacing:0;";
    notesHdr.appendChild(notesLabel);
    notesHdr.appendChild(notesStatus);
    notesWrap.appendChild(notesHdr);
    var notesTa = document.createElement("textarea");
    // v351: dropped the singular id="dm-notes-textarea" for the same
    // reason as the status node above. Nothing else in the codebase
    // looked up the textarea by ID.
    notesTa.placeholder = "Things to remember from this stop…";
    notesTa.value = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
    notesTa.style.cssText = "width:100%;min-height:48px;max-height:240px;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 8px;border:1px solid #ddd;border-radius:5px;background:#fff;color:#111;resize:vertical;box-sizing:border-box;font-family:inherit;";
    notesTa.onfocus = function(){ this.style.borderColor = "#1a5fa8"; this.style.boxShadow = "0 0 0 3px rgba(26,95,168,.12)"; };

    // v347: extracted save logic so the explicit Save button can call
    // it without waiting for blur. Also called on blur so the
    // existing save-on-blur behavior keeps working.
    function _saveNote() {
      var prev = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
      var nextVal = notesTa.value;
      if (prev === nextVal) return;
      dest.travelerNotes = nextVal;
      var ok = false;
      try {
        if (typeof global.localSave === "function") {
          global.localSave();
          ok = true;
        } else if (global.MaxDB && global._currentTripId && typeof global.serializeTrip === "function") {
          ok = global.MaxDB.trip.writeRaw(global._currentTripId, global.serializeTrip());
        }
      } catch(e) { ok = false; }
      // v347: explicitly fire MaxSync.scheduleSave so the note pushes
      // to the server even if localSave's autoSave hook somehow
      // didn't (defense in depth).
      if (ok && typeof global.MaxSync !== "undefined" &&
          typeof global.MaxSync.scheduleSave === "function") {
        global.MaxSync.scheduleSave();
      }
      // v351: closure-captured notesStatus instead of getElementById.
      notesStatus.textContent = ok ? "saved" : "save failed";
      notesStatus.style.color = ok ? "#2a7a4e" : "#c05020";
      if (ok) setTimeout(function(){
        if (notesStatus.textContent === "saved") notesStatus.textContent = "";
      }, 1800);
    }

    notesTa.onblur = function(){
      this.style.borderColor = "#ddd"; this.style.boxShadow = "none";
      _saveNote();
    };
    notesWrap.appendChild(notesTa);

    // v347: explicit Save button. Some users (especially on mobile)
    // weren't sure when blur fired, so the note appeared "lost" until
    // they realized they had to tap somewhere else. The button is the
    // unambiguous "I'm done, save it" affordance.
    // v353.2: voice input lives next to the save button. Web Speech
    // API recognition pipes recognized text into the textarea —
    // useful for in-the-moment capture on phone without typing.
    // Feature-detect: only show the mic when the API is available.
    var saveRow = document.createElement("div");
    saveRow.style.cssText = "margin-top:6px;display:flex;justify-content:flex-end;align-items:center;gap:6px;";
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (typeof SR === 'function') {
      var micBtn = document.createElement('button');
      micBtn.type = 'button';
      micBtn.textContent = '🎤';
      micBtn.title = 'Dictate';
      micBtn.style.cssText = 'font-size:14px;background:#fff;border:1px solid #ddd;border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;line-height:1;min-height:28px;';
      var rec = null;
      var listening = false;
      micBtn.onclick = function () {
        if (listening) {
          // Tap again to stop early. onend fires below to clean up.
          if (rec) try { rec.stop(); } catch (_) {}
          return;
        }
        try {
          rec = new SR();
          rec.lang = (navigator.language || 'en-US');
          rec.interimResults = true;
          rec.continuous = true;
          var startLen = notesTa.value.length;
          var leadingSpace = (startLen > 0 && !/\s$/.test(notesTa.value)) ? ' ' : '';
          var finalText = '';
          rec.onstart = function () {
            listening = true;
            micBtn.textContent = '🎙';
            micBtn.style.background = '#fbeae3';
            micBtn.style.borderColor = '#c05020';
            micBtn.title = 'Listening — tap to stop';
            notesTa.focus();
          };
          rec.onresult = function (ev) {
            var interim = '';
            for (var i = ev.resultIndex; i < ev.results.length; i++) {
              var r = ev.results[i];
              if (r.isFinal) finalText += r[0].transcript;
              else interim += r[0].transcript;
            }
            // Re-render the textarea: original prefix + leading space
            // + finalized + (interim, will be replaced as it firms up).
            notesTa.value = notesTa.value.substring(0, startLen) +
              leadingSpace + finalText + interim;
          };
          rec.onerror = function () { /* swallow; onend handles cleanup */ };
          rec.onend = function () {
            listening = false;
            micBtn.textContent = '🎤';
            micBtn.style.background = '#fff';
            micBtn.style.borderColor = '#ddd';
            micBtn.title = 'Dictate';
            // Trim any still-interim text by setting the textarea to
            // prefix + final only.
            notesTa.value = notesTa.value.substring(0, startLen) +
              (finalText ? leadingSpace + finalText : '');
            _saveNote();
          };
          rec.start();
        } catch (e) {
          listening = false;
          micBtn.textContent = '🎤';
          // Permission denied or unsupported — best-effort feedback.
          notesStatus.textContent = 'mic unavailable';
          notesStatus.style.color = '#c05020';
        }
      };
      saveRow.appendChild(micBtn);
    }
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save note";
    saveBtn.style.cssText = "font-size:11px;font-weight:600;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:5px;padding:5px 12px;cursor:pointer;font-family:inherit;transition:opacity 0.18s ease, background 0.12s ease;";
    saveBtn.onmouseover = function(){ saveBtn.style.background = "#134a8a"; };
    saveBtn.onmouseout  = function(){ saveBtn.style.background = "#1a5fa8"; };
    // v353.2: button visibility tied to "is there an unsaved change?"
    // On load, the textarea matches the persisted value, so no save
    // affordance is needed — start hidden. The 'input' listener below
    // shows it as soon as the user types. On save: brief "✓ Saved"
    // confirmation, then hide.
    var _savedSnapshot = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
    function _showSaveBtn() {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save note";
      saveBtn.style.background = "#1a5fa8";
      saveBtn.style.borderColor = "#1a5fa8";
      saveBtn.style.opacity = "1";
      saveBtn.style.display = "";
    }
    function _hideSaveBtn() {
      saveBtn.style.display = "none";
    }
    function _showSavedThenHide() {
      saveBtn.disabled = true;
      saveBtn.textContent = "✓ Saved";
      saveBtn.style.background = "#2a7a4e";
      saveBtn.style.borderColor = "#2a7a4e";
      saveBtn.style.opacity = "1";
      setTimeout(function () {
        saveBtn.style.opacity = "0";
        setTimeout(function () {
          // Only hide if the textarea is still in sync (user hasn't
          // started typing in the 800ms window).
          if (notesTa.value === _savedSnapshot) _hideSaveBtn();
          else _showSaveBtn();
        }, 200);
      }, 800);
    }
    // Initial state: hidden because textarea matches saved value.
    _hideSaveBtn();
    // Re-show on any input. Cheap; listener fires per keystroke but
    // the work is just a string compare.
    notesTa.addEventListener('input', function () {
      if (notesTa.value !== _savedSnapshot) _showSaveBtn();
      else _hideSaveBtn();
    });
    saveBtn.onclick = function(){
      _saveNote();
      // Update the snapshot to the just-saved value, then run the
      // confirmation animation.
      _savedSnapshot = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
      _showSavedThenHide();
      // Blur the textarea too so the focus ring goes away — feels
      // like a "done" gesture.
      try { notesTa.blur(); } catch(_){}
    };
    saveRow.appendChild(saveBtn);
    notesWrap.appendChild(saveRow);

    // Also catch the blur-save path: when the user blurs (focus
    // leaves the textarea), _saveNote runs. Update the snapshot so
    // the button doesn't sit there asking to save what's already
    // saved. We can't easily reach _saveNote's success/failure flag
    // from here, but a simple "if textarea matches dest.travelerNotes
    // post-blur, hide the button" does the right thing.
    notesTa.addEventListener('blur', function () {
      // _saveNote already ran via the existing onblur handler above.
      // Re-read what was persisted and sync our snapshot.
      _savedSnapshot = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
      if (notesTa.value === _savedSnapshot) _hideSaveBtn();
    });

    container.appendChild(notesWrap);
  }

  // v353.2: per-destination research surface. Distinct from
  // traveler notes (which is the on-the-road diary). Research
  // is the homework — what the user read about the place,
  // links they found useful, opening hours / reservation
  // requirements / friend's recommendations they don't want to
  // forget. Rendered in dest-mode below the traveler-notes
  // strip. URLs in the saved text are auto-detected and
  // displayed as clickable links when not in edit mode; when
  // editing, the textarea shows raw text so the user can paste
  // and edit URLs naturally.
  function _renderResearch(dest, container) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "margin:0 0 10px;padding:10px 12px;background:#f7f4ec;border:1px solid #e6e0cc;border-radius:8px;";

    // v353.2: collapsible. Research is a less-frequently-used
    // surface than Notes from the road; collapsed by default keeps
    // dest-mode quieter, but the user can expand it any time. State
    // persists per-destination in localStorage so a research-heavy
    // destination stays expanded across page loads.
    var collapsedKey = "max-research-collapsed-" + (dest.id || dest.place || "x");
    var collapsed;
    try {
      var sv = localStorage.getItem(collapsedKey);
      if (sv === "0") collapsed = false;
      else if (sv === "1") collapsed = true;
      else {
        // No saved choice: default to collapsed if empty, expanded
        // if there's already research (so the user sees it).
        collapsed = !((typeof dest.research === "string") && dest.research.length > 0);
      }
    } catch (_) { collapsed = true; }

    var hdr = document.createElement("div");
    hdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#8a7440;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;";
    var hdrLeft = document.createElement("span");
    hdrLeft.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
    var caret = document.createElement("span");
    caret.style.cssText = "font-size:8px;display:inline-block;transition:transform 0.12s ease;";
    caret.textContent = "▾";
    var lbl = document.createElement("span");
    lbl.textContent = "Research";
    var meta = document.createElement("span");
    meta.style.cssText = "font-size:9px;font-weight:500;color:#bbb;text-transform:none;letter-spacing:0;margin-left:4px;";
    hdrLeft.appendChild(caret);
    hdrLeft.appendChild(lbl);
    hdrLeft.appendChild(meta);
    var status = document.createElement("span");
    status.style.cssText = "font-size:9px;font-weight:500;color:#aaa;text-transform:none;letter-spacing:0;";
    hdr.appendChild(hdrLeft);
    hdr.appendChild(status);
    wrap.appendChild(hdr);

    // Body container — everything that lives inside the collapsible
    // region. Header stays visible; body's display toggles.
    var body = document.createElement("div");
    body.style.cssText = "margin-top:8px;";
    wrap.appendChild(body);

    function _applyCollapsed() {
      caret.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
      body.style.display = collapsed ? "none" : "block";
      // Update the meta hint with a length cue when collapsed.
      var s = (typeof dest.research === "string") ? dest.research : "";
      if (collapsed) {
        meta.textContent = s ? "(" + s.length + " chars)" : "(empty — tap to add)";
      } else {
        meta.textContent = "";
      }
    }
    hdr.onclick = function () {
      collapsed = !collapsed;
      try { localStorage.setItem(collapsedKey, collapsed ? "1" : "0"); } catch (_){}
      _applyCollapsed();
    };
    _applyCollapsed();

    var saved = (typeof dest.research === "string") ? dest.research : "";
    var view = document.createElement("div"); // Read-only view: text + clickable URLs.
    view.style.cssText = "font-size:12.5px;line-height:1.55;color:#333;min-height:36px;padding:6px 8px;background:#fff;border:1px solid #e8e1c8;border-radius:5px;cursor:text;white-space:pre-wrap;word-wrap:break-word;";
    view.title = "Tap to edit";

    function renderViewMode() {
      if (!saved) {
        view.innerHTML = '<span style="color:#bbb;">Tap to add research, links, opening hours, reservations…</span>';
        return;
      }
      // URL auto-detection. Plain text + clickable <a> for any
      // http(s):// substring. Escape everything else so HTML in
      // the saved text isn't interpreted.
      var html = "";
      var lastIdx = 0;
      var urlRe = /(https?:\/\/[^\s<>"']+)/g;
      var m;
      while ((m = urlRe.exec(saved)) !== null) {
        html += _esc(saved.substring(lastIdx, m.index));
        var u = m[1];
        // Trim common trailing punctuation that isn't part of a URL.
        var trail = "";
        while (/[)\.,;:!?]$/.test(u)) { trail = u.charAt(u.length - 1) + trail; u = u.substring(0, u.length - 1); }
        var safe = _esc(u);
        html += '<a href="' + safe + '" target="_blank" rel="noopener noreferrer" style="color:#1a5fa8;text-decoration:underline;word-break:break-all;">' + safe + '</a>' + _esc(trail);
        lastIdx = m.index + m[1].length;
      }
      html += _esc(saved.substring(lastIdx));
      view.innerHTML = html;
    }
    function _esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    renderViewMode();

    var ta = document.createElement("textarea");
    ta.placeholder = "What you've read, links, opening hours, reservation deadlines…";
    ta.style.cssText = "width:100%;min-height:80px;max-height:320px;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 8px;border:1px solid #1a5fa8;border-radius:5px;background:#fff;color:#111;resize:vertical;box-sizing:border-box;font-family:inherit;display:none;outline:none;box-shadow:0 0 0 3px rgba(26,95,168,.12);";

    function enterEdit() {
      ta.value = saved;
      view.style.display = "none";
      ta.style.display = "block";
      setTimeout(function(){ ta.focus(); }, 30);
    }
    function exitEdit() {
      // Save if changed, then re-render the view.
      var nextVal = ta.value;
      if (nextVal !== saved) {
        dest.research = nextVal;
        saved = nextVal;
        var ok = false;
        try {
          if (typeof global.localSave === "function") { global.localSave(); ok = true; }
          else if (global.MaxDB && global._currentTripId && typeof global.serializeTrip === "function") {
            ok = global.MaxDB.trip.writeRaw(global._currentTripId, global.serializeTrip());
          }
        } catch(e) { ok = false; }
        if (ok && typeof global.MaxSync !== "undefined" &&
            typeof global.MaxSync.scheduleSave === "function") {
          global.MaxSync.scheduleSave();
        }
        status.textContent = ok ? "saved" : "save failed";
        status.style.color = ok ? "#2a7a4e" : "#c05020";
        if (ok) setTimeout(function(){
          if (status.textContent === "saved") status.textContent = "";
        }, 1800);
      }
      ta.style.display = "none";
      view.style.display = "block";
      renderViewMode();
    }
    view.onclick = function (e) {
      // Don't open edit when the user clicks an inner <a> link.
      if (e && e.target && e.target.tagName === "A") return;
      enterEdit();
    };
    ta.addEventListener("blur", function(){
      exitEdit();
      // After saving, refresh the collapsed-state meta hint so it
      // shows the new char count if user collapses.
      var s = (typeof dest.research === "string") ? dest.research : "";
      if (collapsed) meta.textContent = s ? "(" + s.length + " chars)" : "(empty — tap to add)";
    });
    body.appendChild(view);
    body.appendChild(ta);

    // Voice input row (shown only when SpeechRecognition is available).
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (typeof SR === "function") {
      var micRow = document.createElement("div");
      micRow.style.cssText = "margin-top:6px;display:flex;justify-content:flex-end;";
      var micBtn = document.createElement("button");
      micBtn.type = "button";
      micBtn.textContent = "🎤 Dictate research";
      micBtn.title = "Dictate (Web Speech API)";
      micBtn.style.cssText = "font-size:11px;background:#fff;border:1px solid #e6e0cc;border-radius:5px;padding:5px 10px;cursor:pointer;font-family:inherit;color:#8a7440;";
      var rec = null, listening = false;
      micBtn.onclick = function () {
        if (listening) { if (rec) try { rec.stop(); } catch(_){} return; }
        try {
          rec = new SR();
          rec.lang = (navigator.language || "en-US");
          rec.interimResults = true;
          rec.continuous = true;
          if (ta.style.display === "none") enterEdit();
          var startLen = ta.value.length;
          var leadingSpace = (startLen > 0 && !/\s$/.test(ta.value)) ? " " : "";
          var finalText = "";
          rec.onstart = function () {
            listening = true;
            micBtn.textContent = "🎙 Listening — tap to stop";
            micBtn.style.background = "#fbeae3";
          };
          rec.onresult = function (ev) {
            var interim = "";
            for (var i = ev.resultIndex; i < ev.results.length; i++) {
              if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
              else interim += ev.results[i][0].transcript;
            }
            ta.value = ta.value.substring(0, startLen) + leadingSpace + finalText + interim;
          };
          rec.onerror = function () {};
          rec.onend = function () {
            listening = false;
            micBtn.textContent = "🎤 Dictate research";
            micBtn.style.background = "#fff";
            ta.value = ta.value.substring(0, startLen) + (finalText ? leadingSpace + finalText : "");
            // Stay in edit mode after dictation ends — user may
            // want to clean up. They commit by tapping outside.
          };
          rec.start();
        } catch (e) {
          listening = false;
          micBtn.textContent = "🎤 Dictate research";
          status.textContent = "mic unavailable";
          status.style.color = "#c05020";
        }
      };
      micRow.appendChild(micBtn);
      body.appendChild(micRow);
    }

    container.appendChild(wrap);
  }

  // ── TM.7.3 (v332): pending-cancellations banner ────────────
  // Renders only if dest.pendingCancellations.items has entries.
  // Click of "View checklist" calls global.showCancellationChecklist.
  function _renderPendingCancellationsBanner(dest, container) {
    if (!(dest.pendingCancellations && dest.pendingCancellations.items && dest.pendingCancellations.items.length)) return;
    var pcBanner = document.createElement('div');
    pcBanner.style.cssText = 'background:#fff8f0;border:1px solid #f0dcc0;border-radius:6px;padding:8px 10px;margin:8px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    var pcTxt = document.createElement('div');
    pcTxt.style.cssText = 'font-size:11px;color:#b05820;';
    var n = dest.pendingCancellations.items.length;
    pcTxt.innerHTML = '<strong>⚠ Pending cancellations</strong> — ' + n + ' booking' + (n !== 1 ? 's' : '') + ' need provider action';
    var pcBtn = document.createElement('button');
    pcBtn.className = 'bk-log-btn';
    pcBtn.textContent = 'View checklist';
    (function(d){ pcBtn.onclick = function(){ if (typeof global.showCancellationChecklist === "function") global.showCancellationChecklist(d); }; })(dest);
    pcBanner.appendChild(pcTxt);
    pcBanner.appendChild(pcBtn);
    container.appendChild(pcBanner);
  }

  // ── TM.7.4 (v332): destination logistics block ─────────────
  // Renders the arrival flight/train/etc. card on the FIRST destination
  // and the departure card on the LAST. Pulls from trip.brief.entryDetails
  // / exitDetails. Appends to the header element (hdr). The "Add them →"
  // links bounce back to trip view and open the logistics form.
  function _renderDestLogistics(trip, dest, hdr) {
    var dests = (trip && trip.destinations) || [];
    var firstId = dests.length ? dests[0].id : null;
    var lastId = dests.length ? dests[dests.length-1].id : null;
    var isFirst = (dest.id === firstId);
    var isLast = (dest.id === lastId);
    if (!isFirst && !isLast) return;
    var _tb = global._tb || {};
    var fmtDFn = global.fmtD || function(d){ return d || ""; };
    var fmt12 = global._fmtTime12h || function(t){ return t || ""; };
    var modeLabelsFn = global._modeLabels || function(){ return { icon: "✈", arrivalVerb: "Arrives", departureVerb: "Departs" }; };

    function _lblHtml(side) {
      var details = side === "entry"
        ? (trip.brief && trip.brief.entryDetails) || null
        : (trip.brief && trip.brief.exitDetails) || null;
      if (!details) return "";
      var mode = side === "entry"
        ? ((trip.brief && trip.brief.entryMode) || (_tb && _tb.entryMode) || "fly")
        : ((trip.brief && trip.brief.exitMode) || (_tb && _tb.exitMode) || "fly");
      var ml = modeLabelsFn(mode, side === "entry" ? "arrival" : "departure");
      var verb = side === "entry" ? ml.arrivalVerb : ml.departureVerb;
      var roleLabel = (side === "entry" ? ml.icon + " Arrival" : ml.icon + " Departure");
      var color = side === "entry" ? "#1a5fa8" : "#b05820";
      var bg = side === "entry" ? "#eef5ff" : "#fff5ed";
      var border = side === "entry" ? "#cfe1f7" : "#f3dcc4";
      var carrierNum = [details.carrier, details.number].filter(function(x){return !!x;}).join(" ");
      var hasAny = !!(carrierNum || details.time || details.confirmation || details.notes);
      if (!hasAny) {
        return '<div style="background:#fafafa;border:1px dashed #d8d4c8;border-radius:7px;padding:9px 12px;margin-bottom:8px;">'
          + '<div style="font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:'+color+';margin-bottom:3px;">' + roleLabel + '</div>'
          + '<div style="font-size:11px;color:#888;">No arrival/departure details added yet. <a href="#" id="dm-edit-logistics-'+side+'" style="color:#1a5fa8;">Add them →</a></div>'
          + '</div>';
      }
      var bits = [];
      if (carrierNum) bits.push('<strong style="color:#222;">'+carrierNum+'</strong>');
      var dateBit = details.date ? fmtDFn(details.date) : "";
      if (details.time && dateBit) bits.push(verb + " " + fmt12(details.time) + " on " + dateBit);
      else if (details.time) bits.push(verb + " " + fmt12(details.time));
      else if (dateBit) bits.push(verb + " on " + dateBit);
      var sub = bits.join(' · ');
      var confChip = details.confirmation ? '<span style="font-size:10.5px;color:'+color+';background:'+bg+';border:1px solid '+border+';padding:2px 7px;border-radius:10px;margin-left:8px;">conf. ' + details.confirmation + '</span>' : '';
      var notesLine = details.notes ? '<div style="font-size:10.5px;color:#777;margin-top:3px;">' + details.notes + '</div>' : '';
      return '<div style="background:'+bg+';border:1px solid '+border+';border-radius:7px;padding:9px 12px;margin-bottom:8px;">'
        + '<div style="font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:'+color+';margin-bottom:3px;">' + roleLabel + '</div>'
        + '<div style="font-size:12px;color:#333;line-height:1.45;">' + sub + confChip + '</div>'
        + notesLine
        + '</div>';
    }
    var box = document.createElement("div");
    var html = "";
    if (isFirst) html += _lblHtml("entry");
    if (isLast) html += _lblHtml("exit");
    box.innerHTML = html;
    hdr.appendChild(box);
    box.querySelectorAll("a[id^='dm-edit-logistics-']").forEach(function(a){
      a.addEventListener("click", function(e){
        e.preventDefault();
        if (typeof global.setLeftMode === "function") global.setLeftMode("trip");
        setTimeout(function(){
          var toggle = document.getElementById("tm-logistics-toggle");
          var form = document.getElementById("tm-logistics-form");
          if (toggle && form && form.style.display === "none") toggle.click();
          var firstInp = form && form.querySelector("input[data-side]");
          if (firstInp) firstInp.focus();
        }, 100);
      });
    });
  }

  // ── TM.7.5 (v332): unplaced day-trip chips ─────────────────
  // Round CO.3 chip menu lives in `global.openDayTripMenu`. Round
  // FN.7.3 filter: only chips for day-trips not yet placed on a day.
  function _renderDayTripChips(dest, hdr) {
    function _isPlaced(d){
      return (dest.days || []).some(function(day){
        return (day.items || []).some(function(it){
          return it && it.type === "daytrip" && it.dayTripPlace === d.place;
        });
      });
    }
    var unplacedDayTrips = (dest.dayTrips || []).filter(function(d){ return !_isPlaced(d); });
    if (!unplacedDayTrips.length) return;
    var dtBox = document.createElement("div");
    dtBox.style.cssText = "margin:0 0 10px;padding:9px 12px;background:#f4eef9;border:1px solid #d8c4e8;border-radius:7px;";
    var dtHdr = document.createElement("div");
    dtHdr.style.cssText = "font-size:12px;font-weight:700;color:#5b3f8f;margin-bottom:5px;";
    dtHdr.textContent = "Day trips from " + dest.place + " · not yet scheduled";
    dtBox.appendChild(dtHdr);
    var dtList = document.createElement("div");
    dtList.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
    unplacedDayTrips.forEach(function(dt){
      var dtIdx = dest.dayTrips.indexOf(dt);
      var chip = document.createElement("button");
      chip.type = "button";
      var placedOnDay = -1;
      (dest.days || []).forEach(function(day, dayIdx){
        (day.items || []).forEach(function(it){
          if (it && it.type === "daytrip" && it.dayTripPlace === dt.place) placedOnDay = dayIdx;
        });
      });
      chip.style.cssText = "font-size:11px;font-weight:600;color:#5b3f8f;background:#fff;border:1px solid #d8c4e8;padding:4px 10px;border-radius:11px;cursor:pointer;font-family:inherit;";
      var placedLbl = "";
      if (placedOnDay >= 0) {
        var pDay = (dest.days || [])[placedOnDay];
        var pLbl = pDay && pDay.lbl;
        placedLbl = " · on " + (pLbl || ("Day " + (placedOnDay+1)));
      }
      chip.textContent = dt.place + " · " + (typeof global._fmtDistance === "function" ? global._fmtDistance(dt.distKm) : dt.distKm + "km") + placedLbl;
      chip.title = "Click for options";
      chip.onmouseover = function(){ chip.style.background = "#ede0f4"; };
      chip.onmouseout = function(){ chip.style.background = "#fff"; };
      (function(hubDest, dayTripIdx, dayTripData, alreadyOnDay){
        chip.onclick = function(){
          if (typeof global.openDayTripMenu === "function") global.openDayTripMenu(chip, hubDest, dayTripIdx, dayTripData, alreadyOnDay);
        };
      })(dest, dtIdx, dt, placedOnDay);
      dtList.appendChild(chip);
    });
    dtBox.appendChild(dtList);
    hdr.appendChild(dtBox);
  }

  // ── TM.7.6 (v332): destination tab bar ──────────────────────
  // The 6-tab switcher (Itinerary / Explore / Stay / Routing / On the
  // ground / Tracking…) above the dest detail panes. Reads/writes
  // `global._activeDmSection` for active-tab tracking; pendingCount()
  // drives the tracker badge. On-click toggles tab classes + pane
  // visibility, lazy-renders execution-mode info, refreshes the map
  // when switching to map-relevant tabs.
  function _renderDestTabBar(dest, container) {
    var tabs = document.createElement("div");
    tabs.className = "dm-tabs";
    var sections = [
      {id:"sights", lbl:"Itinerary"},
      {id:"explore",lbl:"Explore"},
      {id:"stay",   lbl:"Stay"},
      {id:"routing",lbl:"Routing"},
      {id:"info",   lbl:"On the ground"},
      {id:"tracker",lbl:"Tracking…"},
    ];
    var g = global.g || function(id){ return document.getElementById(id); };
    sections.forEach(function(s){
      var btn = document.createElement("button");
      btn.className = "dm-tab" + (s.id === global._activeDmSection ? " on" : "");
      btn.id = "dm-tab-" + s.id;
      btn.textContent = s.lbl;
      if (s.id === "tracker") {
        var n = (typeof global.pendingCount === "function") ? global.pendingCount() : 0;
        if (n > 0) {
          var badge = document.createElement("span");
          badge.className = "dm-tab-badge";
          badge.textContent = n;
          btn.appendChild(badge);
          btn.classList.add("has-attention");
        }
      }
      (function(sid){
        btn.onclick = function(){
          global._activeDmSection = sid;
          var _pw = g("dm-pane-wrap"); if (_pw) _pw.scrollTop = 0;
          var _lpc2 = document.querySelector(".lp-content"); if (_lpc2) _lpc2.scrollTop = 0;
          sections.forEach(function(x){
            var b = g("dm-tab-" + x.id);
            if (b) {
              var wasAttn = b.classList.contains("has-attention");
              b.className = "dm-tab" + (x.id === sid ? " on" : "") + (wasAttn ? " has-attention" : "");
            }
            var p = g("dm-pane-" + x.id); if (p) p.style.display = (x.id === sid ? "block" : "none");
          });
          if (sid === "stay") {
            setTimeout(function(){
              var _sp = document.querySelector("#dm-pane-stay .bk-log-btn");
              if (_sp) _sp.scrollIntoView({block:"nearest", behavior:"instant"});
            }, 50);
          }
          if (sid === "info") {
            var _execHost = g("dm-exec-groups-" + dest.id);
            if (_execHost && !_execHost._cyRendered && typeof global._renderExecutionGroups === "function") {
              global._renderExecutionGroups(dest, _execHost);
            }
          }
          if (sid === "sights" || sid === "tracker" || sid === "stay" || sid === "explore") {
            if (typeof global.updateMainMap === "function") global.updateMainMap();
          }
        };
      })(s.id);
      tabs.appendChild(btn);
    });
    container.appendChild(tabs);
  }

  // ── TM.7.7 (v333): itinerary pane ───────────────────────────
  // Day-by-day cards: arrival chip on day 1, day items via mkItinItem,
  // restaurant suggest button, departure transport chip, then
  // Later/Maybe buckets and a delayed checkTimeConflicts pass.
  // Closure deps shadowed as locals so the lifted body stays
  // verbatim against the original.
  function _renderDestItineraryPane(trip, dest, paneWrap) {
    // Locals shadow globals so the migrated body matches the original.
    var _activeDmSection = global._activeDmSection;
    var getLeg = global.getLeg;
    var getRouting = global.getRouting;
    var buildTransportChip = global.buildTransportChip;
    var buildExplorePane = global.buildExplorePane;
    var mkItinItem = global.mkItinItem;
    var mkDay = global.mkDay;
    var checkTimeConflicts = global.checkTimeConflicts;
    var _modeLabels = global._modeLabels;
    var fmtD = global.fmtD;
    var _fmtTime12h = global._fmtTime12h;
    var buildBucketSection = global.buildBucketSection;
    var openDayTripMenu = global.openDayTripMenu;
    var suggestRestaurants = global.suggestRestaurants;
    var addRestaurantToDay = global.addRestaurantToDay;
  var sightsPane=document.createElement("div"); sightsPane.id="dm-pane-sights";
  sightsPane.style.display=_activeDmSection==="sights"?"block":"none";

  dest.days.forEach(function(day,dayIdx){
    var items=day.items||[];
    // Round FN.7.6: tag each day block with id "dy-{day.id}" so
    // addDayTripToDay's scrollIntoView can find it. Without this id
    // the scroll silently no-op'd — the only other day blocks with
    // ids live in the trip-view destination card render path.
    var blk=document.createElement("div"); blk.className="dm-day-block"; blk.id="dy-"+day.id;

    // Day header
    var dHdr=document.createElement("div"); dHdr.className="dm-day-hdr";
    var dLbl=document.createElement("span"); dLbl.textContent=day.lbl; dHdr.appendChild(dLbl);
    if(day.note){var dn=document.createElement("span");dn.style.cssText="font-size:10px;font-weight:400;color:#ccc;";dn.textContent=" \u00b7 "+day.note;dHdr.appendChild(dn);}
    // v353.6: per-day weather chip on the destination-view day header.
    // Same renderer + cache as the trip-view day cards and the Today
    // banner \u2014 silently bails if no coords / no day.date / beyond the
    // 16-day forecast horizon.
    if (day && day.date && typeof global.renderDayWeatherChip === 'function') {
      try { global.renderDayWeatherChip(dest, day, dHdr); } catch (_) {}
    }
    blk.appendChild(dHdr);

    // Auto-inject arrival transport on first day
    if(dayIdx===0){
      var destIdx=trip.destinations.indexOf(dest);
      if(destIdx>0){
        var fromDest=trip.destinations[destIdx-1];
        var leg=getLeg(fromDest.id,dest.id);
        var bookedBk=leg&&leg.bookings.find(function(b){return b.status==="booked";});
        var routing=getRouting(fromDest.place,dest.place);
        var chip=buildTransportChip(bookedBk,routing,"Arrive from "+fromDest.place,dest.id,"routing");
        if(chip)blk.appendChild(chip);
      } else {
        // Round CK.3: FIRST destination of the trip — render an arrival
        // chip from trip.brief.entryDetails so the day where the user lands
        // shows the actual transport info, just like an "arriving from X"
        // chip on every other destination.
        // Round CK.4: mode-aware ("Lands" only for flights; "Arrives" for
        // trains, drives, buses, boats; icon swaps accordingly).
        var ad = (trip.brief && trip.brief.entryDetails) || {};
        var hasArrInfo = !!(ad.carrier || ad.number || ad.time);
        if (hasArrInfo) {
          var arrMode = (trip.brief && trip.brief.entryMode) || (_tb && _tb.entryMode) || "fly";
          var arrML = _modeLabels(arrMode, "arrival");
          var arrivalWrap=document.createElement("div");
          arrivalWrap.className="itin-transport";
          arrivalWrap.style.cssText="background:#eef5ff;border:1px solid #cfe1f7;";
          var arrDir=document.createElement("span");
          arrDir.style.cssText="font-size:10px;font-weight:700;color:#1a5fa8;margin-right:8px;text-transform:uppercase;letter-spacing:0.04em;";
          arrDir.textContent="Arrival";
          var arrIcon=document.createElement("span"); arrIcon.className="itin-transport-icon";
          arrIcon.textContent=arrML.icon;
          var arrName=document.createElement("span"); arrName.className="itin-transport-name";
          var arrCN = [ad.carrier, ad.number].filter(function(x){return !!x;}).join(" ");
          arrName.textContent = arrCN
            ? arrCN + (ad.time ? " · " + arrML.arrivalVerb + " " + (typeof _fmtTime12h === "function" ? _fmtTime12h(ad.time) : ad.time) : "")
            : arrML.arrivalTitle;
          var arrMeta=document.createElement("span"); arrMeta.className="itin-transport-meta";
          arrMeta.style.cssText="color:#888;";
          arrMeta.textContent="into "+dest.place;
          arrivalWrap.appendChild(arrDir);
          arrivalWrap.appendChild(arrIcon);
          arrivalWrap.appendChild(arrName);
          arrivalWrap.appendChild(arrMeta);
          // Round DE: clickable booking URL when set
          if (ad.url) {
            var arrUrl = document.createElement("a");
            arrUrl.href = ad.url; arrUrl.target = "_blank"; arrUrl.rel = "noopener noreferrer";
            arrUrl.style.cssText = "margin-left:8px;font-size:10px;color:#1a5fa8;text-decoration:none;font-weight:600;";
            arrUrl.textContent = "↗ booking";
            arrUrl.onclick = function(e){ e.stopPropagation(); };
            arrivalWrap.appendChild(arrUrl);
          }
          blk.appendChild(arrivalWrap);
        }
      }
      // Hotel check-in on first day
      var bookedHotel=dest.hotelBookings&&dest.hotelBookings.find(function(b){return b.status==="booked";});
      if(bookedHotel&&bookedHotel.checkIn){
        blk.appendChild(buildHotelChip(bookedHotel,'checkin'));
      }
    }
    // Auto-inject departure transport on last day.
    // For 1-night INTERMEDIATE stops, skip — the departure chip would
    // duplicate the arrival chip already on this same card, and the
    // departure morning effectively lives on the NEXT destination's
    // arrival chip.
    // Round CK.2: but for the LAST destination of the trip, render the
    // chip even on a 1-night stay — there's no next destination's arrival
    // chip to inherit it from, so skipping leaves the departure date with
    // nowhere to live.
    var isLastDay=(dayIdx===dest.days.length-1);
    var isAlsoFirstDay=(dayIdx===0);
    var _isLastDest=(trip.destinations.indexOf(dest) === trip.destinations.length - 1);
    var _isOneNightStop=(dest.days.length === 1);
    var _shouldSkipDeparture = _isOneNightStop && isAlsoFirstDay && !_isLastDest;
    if(isLastDay && !_shouldSkipDeparture){
      // Hotel checkout on last day
      var bookedHotel2=dest.hotelBookings&&dest.hotelBookings.find(function(b){return b.status==="booked";});
      if(bookedHotel2&&bookedHotel2.checkOut){
        blk.appendChild(buildHotelChip(bookedHotel2,'checkout'));
      }
      var destIdx2=trip.destinations.indexOf(dest);
      if(destIdx2<trip.destinations.length-1){
        var toDestX=trip.destinations[destIdx2+1];
        var leg2=getLeg(dest.id,toDestX.id);
        var bookedBk2=leg2&&leg2.bookings.find(function(b){return b.status==="booked";});
        var routing2=getRouting(dest.place,toDestX.place);
        var chip2=buildTransportChip(bookedBk2,routing2,"Depart to "+toDestX.place,dest.id,"routing");
        if(chip2)blk.appendChild(chip2);
      }
      // Round CK.3: the flight-home marker for the trip's last destination
      // used to render here. Now it's its own day card appended AFTER the
      // day loop — Jul 22 (the flight day) is conceptually a separate day,
      // not a chip stacked on top of the Jul 21 buffer-night card.
    }

    // Day section
    var daySlot=document.createElement("div"); daySlot.className="itin-slot";
    var dayHdr=document.createElement("div"); dayHdr.className="itin-slot-hdr"; dayHdr.textContent="Day";
    daySlot.appendChild(dayHdr);

    // General bookings for this day
    var dayDate=new Date(dest.dateFrom+'T12:00:00'); dayDate.setDate(dayDate.getDate()+dayIdx);
    var dayStr=dayDate.toISOString().slice(0,10);
    (dest.generalBookings||[]).filter(function(b){return b.status==='booked'&&b.date===dayStr;}).forEach(function(b){
      var chip=document.createElement('div'); chip.className='itin-hotel-item';
      chip.style.cssText='background:#f0f4ff;border-color:#c0ccf0;cursor:pointer;';
      var icon=document.createElement('span'); icon.className='itin-hotel-icon';
      var iconMap={tour:'🎟',ticket:'🎟',restaurant:'🍽',other:'📌'};
      icon.textContent=iconMap[b.type]||'📌';
      var body=document.createElement('div'); body.style.flex='1';
      var nm=document.createElement('div'); nm.className='itin-hotel-name'; nm.textContent=b.label||b.type;
      var meta=document.createElement('div'); meta.className='itin-hotel-meta';
      var pts=[]; if(b.time)pts.push(b.time+(b.timeEnd?'–'+b.timeEnd:'')); if(b.confirmationNumber)pts.push('Conf: '+b.confirmationNumber);
      meta.textContent=pts.join(' · ');
      body.appendChild(nm); if(pts.length)body.appendChild(meta);
      chip.appendChild(icon); chip.appendChild(body);
      (function(bk,did){chip.onclick=function(){_activeDmSection='tracker';drawDestMode(did);};})(b,dest.id);
      daySlot.appendChild(chip);
    });

    var dayList=document.createElement("div"); dayList.className="slist"; dayList.id="sl-day-"+day.id;
    // Round FN.10: drop target wiring on the day slot list. dragover
    // must preventDefault to allow the drop; we set effectAllowed
    // and add a hover class for visual feedback.
    _wireItinDropTarget(dayList, day.id, "day", dest.id);
    items.filter(function(s){return s.slot==="day"||!s.slot;}).forEach(function(s){
      dayList.appendChild(mkItinItem(s,day.id,dest.id));
      if(_sightStories[s.id]) dayList.appendChild(mkCachedStoryBox(s.id));
    });
    daySlot.appendChild(dayList);
    // Add row for day slot
    daySlot.appendChild(mkItinAddRow(day.id,dest.id,"day"));
    blk.appendChild(daySlot);

    // Evening section
    var eveSlot=document.createElement("div"); eveSlot.className="itin-slot eve";
    var eveHdr=document.createElement("div"); eveHdr.className="itin-slot-hdr evening"; eveHdr.textContent="Evening";
    eveSlot.appendChild(eveHdr);
    var eveList=document.createElement("div"); eveList.className="slist"; eveList.id="sl-eve-"+day.id;
    _wireItinDropTarget(eveList, day.id, "evening", dest.id);
    items.filter(function(s){return s.slot==="evening";}).forEach(function(s){
      eveList.appendChild(mkItinItem(s,day.id,dest.id));
      if(_sightStories[s.id]) eveList.appendChild(mkCachedStoryBox(s.id));
    });
    eveSlot.appendChild(eveList);
    // Add row for evening slot
    eveSlot.appendChild(mkItinAddRow(day.id,dest.id,"evening"));
    // Suggest restaurants button for evening
    var suggestBtn=document.createElement("button"); suggestBtn.className="itin-suggest-btn";
    suggestBtn.textContent="\uD83C\uDF7D Suggest restaurants";
    (function(did,dayId,slot,btn){suggestBtn.onclick=function(){suggestRestaurants(did,dayId,slot,btn);};})(dest.id,day.id,"evening",suggestBtn);
    eveSlot.appendChild(suggestBtn);
    blk.appendChild(eveSlot);
    sightsPane.appendChild(blk);
  });

  // Round CK.3: synthetic departure-day card on the LAST destination. The
  // flight-home day (dest.dateTo) used to live as a chip stacked onto the
  // last regular day card, which read as "you arrive and leave the same
  // day" for 1-night buffer stops. Now it's a real day card with its own
  // header, so the user sees Jul 21 (arrival at airport city) and Jul 22
  // (flight home) as separate days, like every other day in the trip.
  (function appendDepartureDayCard(){
    var isLastDest = (trip.destinations.indexOf(dest) === trip.destinations.length - 1);
    if (!isLastDest) return;
    if (!dest.dateTo) return;
    var depDate = new Date(dest.dateTo + "T12:00:00");
    var depLbl = depDate.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    var ed = (trip.brief && trip.brief.exitDetails) || {};
    var depBlk = document.createElement("div");
    depBlk.className = "dm-day-block";

    // Day header — same shape as a regular day card, with " · departure" note.
    var dHdr = document.createElement("div"); dHdr.className = "dm-day-hdr";
    var dLbl = document.createElement("span"); dLbl.textContent = depLbl;
    dHdr.appendChild(dLbl);
    var dn = document.createElement("span");
    dn.style.cssText = "font-size:10px;font-weight:400;color:#ccc;";
    dn.textContent = " · departure";
    dHdr.appendChild(dn);
    depBlk.appendChild(dHdr);

    // Round CK.4: mode-aware. "Flight home" for flights, "Train home" for
    // trains, "Drive home" for cars, "Bus home" for buses, "Boat home" for
    // boat/ferry. Uses exitDetails for carrier/number/time, falling back to
    // legacy _tb.gettingOut, then a placeholder.
    var depMode = (trip.brief && trip.brief.exitMode) || (_tb && _tb.exitMode) || "fly";
    var depML = _modeLabels(depMode, "departure");
    var flightWrap = document.createElement("div");
    flightWrap.className = "itin-transport";
    flightWrap.style.cssText = "background:#fff5ed;border:1px solid #f3dcc4;";
    var flightDir = document.createElement("span");
    flightDir.style.cssText = "font-size:10px;font-weight:700;color:#b05820;margin-right:8px;text-transform:uppercase;letter-spacing:0.04em;";
    flightDir.textContent = depML.departureTitle;
    var flightIcon = document.createElement("span"); flightIcon.className = "itin-transport-icon";
    flightIcon.textContent = depML.icon;
    var flightName = document.createElement("span"); flightName.className = "itin-transport-name";
    var carrierNum = [ed.carrier, ed.number].filter(function(x){return !!x;}).join(" ");
    if (carrierNum) {
      flightName.textContent = carrierNum + (ed.time ? " · " + depML.departureVerb + " " + (typeof _fmtTime12h === "function" ? _fmtTime12h(ed.time) : ed.time) : "");
    } else if (_tb && _tb.gettingOut) {
      flightName.textContent = _tb.gettingOut;
    } else {
      flightName.textContent = "Add details on the trip page";
    }
    var flightMeta = document.createElement("span"); flightMeta.className = "itin-transport-meta";
    flightMeta.style.cssText = "color:#999;";
    flightMeta.textContent = "from " + dest.place;
    flightWrap.appendChild(flightDir);
    flightWrap.appendChild(flightIcon);
    flightWrap.appendChild(flightName);
    flightWrap.appendChild(flightMeta);
    // Round DE: clickable booking URL when set
    if (ed.url) {
      var depUrl = document.createElement("a");
      depUrl.href = ed.url; depUrl.target = "_blank"; depUrl.rel = "noopener noreferrer";
      depUrl.style.cssText = "margin-left:8px;font-size:10px;color:#1a5fa8;text-decoration:none;font-weight:600;";
      depUrl.textContent = "↗ booking";
      depUrl.onclick = function(e){ e.stopPropagation(); };
      flightWrap.appendChild(depUrl);
    }
    depBlk.appendChild(flightWrap);

    // Optional confirmation # / notes on a second line, smaller.
    if (ed.confirmation || ed.notes) {
      var ext = document.createElement("div");
      ext.style.cssText = "font-size:10.5px;color:#777;padding:2px 12px 4px;";
      var bits = [];
      if (ed.confirmation) bits.push("Conf: " + ed.confirmation);
      if (ed.notes) bits.push(ed.notes);
      ext.textContent = bits.join(" · ");
      depBlk.appendChild(ext);
    }

    sightsPane.appendChild(depBlk);
  })();

  // If no items scheduled yet, show hint to use Explore tab
  var totalItems=dest.days.reduce(function(acc,d){return acc+(d.items?d.items.length:0);},0);
  if(totalItems===0){
    var hint=document.createElement("div");
    hint.style.cssText="margin:12px 14px 4px;padding:10px 12px;background:#f0f5ff;border:1px solid #c8d8f8;border-radius:7px;font-size:11px;color:#2056b0;line-height:1.5;";
    var isGenerating=_generatedCityData[dest.place.toLowerCase()]&&_generatedCityData[dest.place.toLowerCase()].loading;
    hint.textContent=isGenerating
      ?"⌛ Max is generating suggestions for "+dest.place+" — see the Explore tab once ready."
      :"→ Go to the Explore tab to browse sights and restaurants, then add them to your days.";
    sightsPane.insertBefore(hint,sightsPane.firstChild);
  }

  // Later and Maybe buckets
  sightsPane.appendChild(buildBucketSection(dest,"later","Later","Sights and restaurants to get to if there\u2019s time"));
  sightsPane.appendChild(buildBucketSection(dest,"maybe","Maybe","Considering \u2014 not committed"));
  paneWrap.appendChild(sightsPane);
  // Check for time conflicts after render
  setTimeout(function(){checkTimeConflicts(dest,null);},0);
  }

  // ── TM.7.8 (v333): stay (hotel) pane ────────────────────────
  // Hotel district list + booked summary + manual-book button.
  // mkHotelRecord, toggleHotelForm, getDistricts are top-level.
  function _renderDestStayPane(dest, paneWrap) {
    var _activeDmSection = global._activeDmSection;
    var getDistricts = global.getDistricts;
    var mkHotelRecord = global.mkHotelRecord;
    var toggleHotelForm = global.toggleHotelForm;
    var _emitTripMutation = global._emitTripMutation;
  var stayPane2=document.createElement("div"); stayPane2.id="dm-pane-stay";
  stayPane2.style.cssText="padding:0 14px 12px;display:"+(_activeDmSection==="stay"?"block":"none")+";";

  // Round FD: Stay/Eat sub-tabs gone. Restaurants moved to the Explore
  // tab (where they belong as discovery content), so this pane now
  // holds hotels only. seStayPane → stayPane2 directly; the seEatPane
  // and seTabs scaffold is dropped.
  var seStayPane = stayPane2;

  // v359.19: per-Stay-tab pref reminder box removed. The same info now
  // renders ONCE as a banner at the top of the destinations list on
  // the trip view (see _renderTripDestinationsListBanner). Per-stay
  // was redundant — the filter applies trip-wide, so one mention is
  // enough.

  // ── hotels ──────────────────────────────────────────────
  var districts=getDistricts(dest.place,dest.intent,dest);
  var btier=4; // show all hotel tiers
  var bookedHotel=dest.hotelBookings.find(function(b){return b.status==="booked";});
  var bookedHotelNames=dest.hotelBookings.filter(function(b){return b.status==="booked";}).map(function(b){return b.name;});
  var hotelCtr=0;

  // Booked hotel summary at top
  if(bookedHotel){
    var curBanner=document.createElement("div"); curBanner.style.cssText="background:#f0f8f4;border:1px solid #b8dfc9;border-radius:6px;padding:8px 10px;margin-bottom:12px;";
    var curLbl=document.createElement("div"); curLbl.style.cssText="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#2a7a4e;margin-bottom:4px;"; curLbl.textContent="Booked";
    curBanner.appendChild(curLbl);
    dest.hotelBookings.filter(function(b){return b.status==="booked";}).forEach(function(b){
      var nameEl=document.createElement("div"); nameEl.style.cssText="font-size:13px;font-weight:600;color:#111;margin-bottom:2px;"; nameEl.textContent=b.name||"Hotel";
      curBanner.appendChild(nameEl);
      curBanner.appendChild(mkHotelRecord(b,dest.id));
    });
    seStayPane.appendChild(curBanner);
  }

  // Always show full district hotel list
  var anyD=false;
  districts.forEach(function(dist,distIdx){
    var matching=dist.hotels.filter(function(h){return h.tier<=btier;});
    if(!matching.length)return; anyD=true;
    var db2=document.createElement("div"); db2.className="db";
    var dn2=document.createElement("div"); dn2.className="dn"; dn2.textContent=dist.name;
    // v301: district "?" rationale removed. The popover repeated the
    // exact "+ Good / \u2212 Tradeoff" lines that already render visibly
    // below the district name \u2014 pure redundancy.
    db2.appendChild(dn2);
    var dg2=document.createElement("div"); dg2.className="dg"; dg2.textContent="+ "+dist.good; db2.appendChild(dg2);
    var dbad2=document.createElement("div"); dbad2.className="dbad"; dbad2.textContent="\u2212 "+dist.bad; db2.appendChild(dbad2);
    matching.forEach(function(h){
      hotelCtr++;
      var isBooked=bookedHotelNames.indexOf(h.name)>-1;
      var cancelledBookings=dest.hotelBookings.filter(function(b){return b.name===h.name&&b.status==='cancelled';});
      var hasCancelled=cancelledBookings.length>0;
      var hbWrap=document.createElement("div");
      if(isBooked) hbWrap.style.cssText="opacity:0.45;";
      var hiEl=document.createElement("div"); hiEl.className="hi";
      var hl=document.createElement("div"); hl.style.cssText="min-width:0;flex:1;overflow:hidden;";
      var hn=document.createElement("div"); hn.className="hn"; hn.textContent=h.name;
      var hd=document.createElement("div"); hd.className="hd"; hd.textContent=h.desc||"";
      hl.appendChild(hn); hl.appendChild(hd);
      var hp=document.createElement("div"); hp.className="hp"; hp.textContent=h.price||"";
      hiEl.appendChild(hl); hiEl.appendChild(hp);
      hbWrap.appendChild(hiEl);
      // Round FN: Book button used to be hidden whenever any cancelled
      // record existed for this hotel — making it impossible to rebook
      // a property you'd cancelled and changed your mind on. Now we
      // suppress the button only while a *currently booked* record
      // exists; cancelled history sits below and rebooking is allowed.
      if(!isBooked){
        var formId="hbf-"+dest.id+"-"+hotelCtr+"-"+Date.now();
        var logBtn=document.createElement("button"); logBtn.className="bk-log-btn"; logBtn.textContent="Book";
        logBtn.style.cssText="display:block;margin-top:4px;";
        (function(btn,wrap,hname,did,fid){btn.onclick=function(){toggleHotelForm(btn,wrap,fid,{
          hotelName:hname,area:dist.name,destId:did,checkIn:dest.dateFrom,checkOut:dest.dateTo,currency:"EUR"
        },function(){_emitTripMutation();});};})(logBtn,hbWrap,h.name,dest.id,formId);
        hbWrap.appendChild(logBtn);
      }
      // Round FN.8.20: cancelled records under a collapsible toggle
      // so they don't visually compete with the active hotel options.
      // Single cancelled record renders inline (low cost); 2+ get a
      // "▾ Show N cancelled" disclosure.
      if (cancelledBookings.length === 1) {
        hbWrap.appendChild(mkHotelRecord(cancelledBookings[0], dest.id));
      } else if (cancelledBookings.length > 1) {
        var cancelledWrap = document.createElement("div");
        cancelledWrap.style.cssText = "margin-top:4px;";
        var cancelledList = document.createElement("div");
        cancelledList.style.display = "none";
        cancelledBookings.forEach(function(b){ cancelledList.appendChild(mkHotelRecord(b, dest.id)); });
        var toggle = document.createElement("button");
        toggle.type = "button";
        toggle.textContent = "▾ Show " + cancelledBookings.length + " cancelled";
        toggle.style.cssText = "font-size:10px;color:#888;background:none;border:none;padding:2px 0;cursor:pointer;font-family:inherit;";
        (function(list, btn, n){
          btn.onclick = function(){
            var hidden = list.style.display === "none";
            list.style.display = hidden ? "" : "none";
            btn.textContent = (hidden ? "▴ Hide " : "▾ Show ") + n + " cancelled";
          };
        })(cancelledList, toggle, cancelledBookings.length);
        cancelledWrap.appendChild(toggle);
        cancelledWrap.appendChild(cancelledList);
        hbWrap.appendChild(cancelledWrap);
      }
      db2.appendChild(hbWrap);
    });
    seStayPane.appendChild(db2);
  });
  // Manual booking option
  var manualWrap=document.createElement("div"); manualWrap.style.cssText="margin-top:8px;";
  if(!anyD){
    var noneD=document.createElement("div");noneD.style.cssText="font-size:11px;color:#bbb;font-style:italic;margin-bottom:8px;";
    noneD.textContent="Hotel suggestions loading\u2026 You can log a booking manually.";
    seStayPane.appendChild(noneD);
  }
  var manualBtn=document.createElement("button"); manualBtn.className="bk-log-btn"; manualBtn.textContent="Book any hotel";
  var manualFormId="hbf-"+dest.id+"-manual-"+Date.now();
  (function(btn,wrap,did){btn.onclick=function(){toggleHotelForm(btn,wrap,manualFormId,{
    hotelName:"",area:"",destId:did,checkIn:dest.dateFrom,checkOut:dest.dateTo,currency:"EUR"
  },function(){_emitTripMutation();});};})(manualBtn,manualWrap,dest.id);
  manualWrap.appendChild(manualBtn);
  dest.hotelBookings.filter(function(b){return b.name&&!districts.some(function(d){return d.hotels.some(function(h){return h.name===b.name;});});}).forEach(function(b){manualWrap.appendChild(mkHotelRecord(b,dest.id));});
  seStayPane.appendChild(manualWrap);
  // Round FD: stayPane2 already IS seStayPane (alias above), so no
  // appendChild-self call. Restaurants used to be appended here as
  // a second sub-pane (seEatPane); they now live in the Explore tab.

  paneWrap.appendChild(stayPane2);
  }

  // ── TM.7.9 (v333): destination info pane ────────────────────
  // Quick reference (currency/tipping/emergency), Getting around
  // (execution-mode rideshare/transit), and Local services (ATMs,
  // banks, groceries, tourist info, pharmacies). Pulls from
  // getPracticalInfo + dest.suggestions.
  function _renderDestInfoPane(dest, paneWrap) {
    var _activeDmSection = global._activeDmSection;
    var getPracticalInfo = global.getPracticalInfo;
    var _renderExecutionGroups = global._renderExecutionGroups;
    var _generatedCityData = global._generatedCityData || {};
    var _mainMap = global._mainMap;
    var showMapPinPanel = global.showMapPinPanel;
    // INFO pane
    // Round FK: section headers added so the three coherent groups
    // — quick reference / getting around / local services — are
    // labeled rather than separated only by gray rules. Idle
    // placeholder text inside the execution-mode container removed:
    // the click handler triggers _renderExecutionGroups
    // synchronously, so the placeholder flashed for ~1 frame in
    // practice; an empty container is fine before activation.
    var infoPane2=document.createElement("div"); infoPane2.id="dm-pane-info";
    infoPane2.style.display=_activeDmSection==="info"?"block":"none";
    infoPane2.style.padding="12px 14px";

    // ── Quick reference: currency / tipping / emergency ──────
    var quickHdr=document.createElement("div");
    quickHdr.style.cssText="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:10px;";
    quickHdr.textContent="Quick reference";
    infoPane2.appendChild(quickHdr);
    var pi2=getPracticalInfo(dest.place,dest.intent,dest);
    var pigrid2=document.createElement("div"); pigrid2.className="pi-grid";
    [{lbl:"Currency",val:pi2.currency},{lbl:"Tipping",val:pi2.tipping},{lbl:"Emergency",val:pi2.emergency}].forEach(function(item){
      var el=document.createElement("div"); el.className="pi-item";
      var lb=document.createElement("div"); lb.className="pi-lbl"; lb.textContent=item.lbl;
      var vl=document.createElement("div"); vl.className="pi-val"; vl.textContent=item.val;
      el.appendChild(lb); el.appendChild(vl); pigrid2.appendChild(el);
    });
    infoPane2.appendChild(pigrid2);
    if(pi2.note){var pinote2=document.createElement("div");pinote2.className="pi-note";pinote2.textContent=pi2.note;infoPane2.appendChild(pinote2);}

    // ── Getting around: execution-mode rideshare/transit panel ──
    // Round CY rendered this content into execHost. Now wrapped in a
    // labeled section so the user knows what's about to load.
    var gettingHdr=document.createElement("div");
    gettingHdr.style.cssText="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin:18px 0 10px;padding-top:14px;border-top:1px solid #eee;";
    gettingHdr.textContent="Getting around";
    infoPane2.appendChild(gettingHdr);
    var execHost=document.createElement("div");
    execHost.id="dm-exec-groups-"+dest.id;
    infoPane2.appendChild(execHost);
    if (_activeDmSection==="info") {
      setTimeout(function(){ _renderExecutionGroups(dest, execHost); }, 0);
    }
    // Round FK: dropped the idle placeholder. Empty container is fine.

    // PRACTICAL — on-the-ground essentials from dest.suggestions
    var practicalGroups=[
      {type:"atm",lbl:"ATMs"},
      {type:"bank",lbl:"Banks"},
      {type:"grocery",lbl:"Groceries"},
      {type:"tourist-info",lbl:"Tourist info"},
      {type:"pharmacy",lbl:"Pharmacies"}
    ];
    var hasAnyEssential=practicalGroups.some(function(g){
      return (dest.suggestions||[]).some(function(s){return s.type===g.type;});
    });
    if(hasAnyEssential){
      var pracWrap=document.createElement("div");
      pracWrap.style.cssText="margin-top:18px;padding-top:14px;border-top:1px solid #eee;";
      var pracHdr=document.createElement("div");
      pracHdr.style.cssText="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#666;margin-bottom:10px;";
      // Round FK: "Practical" → "Local services" — distinguishes from
      // the "Quick reference" grid above (currency/tipping/emergency,
      // also "practical" data) and frames the list as places to find
      // on the ground.
      pracHdr.textContent="Local services";
      pracWrap.appendChild(pracHdr);
      practicalGroups.forEach(function(grp){
        var items=(dest.suggestions||[]).filter(function(s){return s.type===grp.type;});
        if(!items.length) return;
        var sec=document.createElement("div");
        sec.style.cssText="margin-bottom:12px;";
        var sLbl=document.createElement("div");
        sLbl.style.cssText="font-size:11px;font-weight:600;color:#444;margin-bottom:4px;";
        sLbl.textContent=grp.lbl;
        sec.appendChild(sLbl);
        items.forEach(function(it){
          var row=document.createElement("div");
          var hasCoords=it.lat&&it.lng;
          row.style.cssText="font-size:12px;color:#222;margin:3px 0 3px 4px;line-height:1.4;padding:3px 5px;border-radius:4px;"+(hasCoords?"cursor:pointer;":"");
          var nm=document.createElement("span");
          nm.style.cssText="font-weight:500;";
          nm.textContent=it.n;
          row.appendChild(nm);
          if(it.note){
            var nt=document.createElement("span");
            nt.style.cssText="color:#666;";
            nt.textContent=" \u2014 "+it.note;
            row.appendChild(nt);
          }
          if(hasCoords){
            row.onmouseover=function(){row.style.background="#f5f5f5";};
            row.onmouseout=function(){row.style.background="";};
            (function(item,d){row.onclick=function(){
              if(_mainMap){_mainMap.setView([item.lat,item.lng],16,{animate:true});}
              setTimeout(function(){
                if(!_mainMap) return;
                var pt=_mainMap.latLngToContainerPoint([item.lat,item.lng]);
                showMapPinPanel(
                  {id:item.id,n:item.n,note:item.note||'',done:false,slot:'day'},
                  d,
                  'info',
                  {containerPoint:pt}
                );
              },300);
            };})(it,dest);
          }
          sec.appendChild(row);
        });
        pracWrap.appendChild(sec);
      });
      infoPane2.appendChild(pracWrap);
    } else if(_generatedCityData[dest.place.toLowerCase()]&&_generatedCityData[dest.place.toLowerCase()].loading){
      var pracLoad=document.createElement("div");
      pracLoad.style.cssText="margin-top:18px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#999;font-style:italic;";
      pracLoad.textContent="Loading practical essentials\u2026";
      infoPane2.appendChild(pracLoad);
    }

    paneWrap.appendChild(infoPane2);
  }

  // ── TM.7.10 (v333): routing + tracker panes ────────────────
  // Routing pane: arrive-from / depart-to / day-trip round-trip
  // sections via buildRoutingSection. Tracker pane: pending-action
  // checklist via mkTrackerInner. Both small enough to keep together.
  function _renderDestRoutingAndTrackerPanes(trip, dest, paneWrap) {
    var _activeDmSection = global._activeDmSection;
    var buildRoutingSection = global.buildRoutingSection;
    var mkTrackerInner = global.mkTrackerInner;
    // ROUTING pane
    var routePane2=document.createElement("div"); routePane2.id="dm-pane-routing";
    routePane2.style.display=_activeDmSection==="routing"?"block":"none";
    routePane2.style.padding="12px 14px";
    var destIdx2=trip.destinations.indexOf(dest);
    var prevDest2=destIdx2>0?trip.destinations[destIdx2-1]:null;
    var nextDest2=destIdx2<trip.destinations.length-1?trip.destinations[destIdx2+1]:null;
    if(!prevDest2&&!nextDest2){
      var rEmp=document.createElement("div"); rEmp.style.cssText="font-size:12px;color:#bbb;font-style:italic;"; rEmp.textContent="Add more destinations to see routing."; routePane2.appendChild(rEmp);
    } else {
      if(prevDest2){var arrSec=buildRoutingSection(prevDest2,dest,"Arrive from "+prevDest2.place);routePane2.appendChild(arrSec);}
      if(nextDest2){var depSec=buildRoutingSection(dest,nextDest2,"Depart to "+nextDest2.place);routePane2.appendChild(depSec);}
    }
    // Round FN.7.6: day-trip transport sections. Each day-trip chip on
    // this hub gets its own routing section so the user can book the
    // round-trip in/out leg. Uses synthetic leg ids "dt-{slug}" since
    // day-trip places aren't in trip.destinations and have no real id.
    if (Array.isArray(dest.dayTrips) && dest.dayTrips.length) {
      dest.dayTrips.forEach(function(dt){
        if (!dt || !dt.place) return;
        var slug = dt.place.toLowerCase().replace(/\s+/g, '-');
        var fakeDest = {
          id: "dt-" + slug,
          place: dt.place,
          dateTo: dest.dateFrom, // booking form default — picks any date in the hub stay
          lat: dt.lat || null,
          lng: dt.lng || null
        };
        var dtSec = buildRoutingSection(dest, fakeDest, "Day trip · " + dest.place + " ↔ " + dt.place + " (round trip)");
        // Tinted border so it visually groups with other day-trip surfaces.
        dtSec.style.borderLeft = "3px solid #5b3f8f";
        dtSec.style.paddingLeft = "10px";
        dtSec.style.background = "#faf6ff";
        routePane2.appendChild(dtSec);
      });
    }
    // Last section gets no bottom border for visual cleanliness.
    var lastChild = routePane2.lastElementChild;
    if (lastChild && lastChild.style) lastChild.style.borderBottom = "none";
    paneWrap.appendChild(routePane2);

    // TRACKER pane
    var trackPane2=document.createElement("div"); trackPane2.id="dm-pane-tracker";
    trackPane2.style.display=_activeDmSection==="tracker"?"block":"none";
    trackPane2.style.padding="12px 14px";
    trackPane2.appendChild(mkTrackerInner(dest));
    paneWrap.appendChild(trackPane2);
  }

  // ── TM.5 final (v333): renderTripPage dispatcher ────────────
  // Single entry point for "render this trip view" — callers don't
  // need to know about the trip-vs-dest mode switch. opts.expandedDestId
  // selects the dest detail view; null/undefined renders the trip
  // overview. Mobile and tests use this; desktop's bus listener still
  // dispatches to drawTripMode/drawDestMode directly to preserve the
  // mode-switch side effects (_leftMode, activeDest, scroll handling)
  // those functions own — but renderTripPage routes through them too,
  // so any caller is consistent.
  //
  // Why not move drawTripMode/drawDestMode bodies into MaxTripUI? Each
  // owns mode-specific GLOBAL state mutations (_leftMode, activeDest,
  // _mapExecMode, scroll preservation across re-renders) that don't
  // factor cleanly through a function call boundary. The dispatcher
  // is the architectural contract; the implementations stay where
  // they have the closest access to that state.
  function _renderTripPage(trip, opts) {
    opts = opts || {};
    if (opts.expandedDestId != null) {
      if (typeof global.drawDestMode === "function") global.drawDestMode(opts.expandedDestId);
    } else {
      if (typeof global.drawTripMode === "function") global.drawTripMode();
    }
  }

  // ── Public surface ─────────────────────────────────────────
  global.MaxTripUI = {
    renderItinItem:         renderItinItem,         // MA.3 — unified entry
    renderItinItemCompact:  renderItinItemCompact,  // MA.2 — direct compact
    renderDay:              renderDay,              // MA.2/MA.3
    // TM.2 (v316) — trip-overview strips:
    renderTripDatesStrip:        _renderTripDatesStrip,
    renderTodayBanner:           _renderTodayBanner,
    renderPreArrivalBanner:      _renderPreArrivalBanner,
    renderDecisionsDeferredPanel:_renderDecisionsDeferredPanel,
    renderGeoAffordanceBanner:   _renderGeoAffordanceBanner,
    renderTripOverviewStrips:    _renderTripOverviewStrips,
    renderDestinationsListHeader:_renderDestinationsListHeader,
    renderArrivalDeparturePanel: _renderArrivalDeparturePanel,
    // TM.3f (v323) — per-destination card render:
    renderTripDestinationCard:   _renderTripDestinationCard,
    // TM.7.2 (v331) — dest-mode pieces lifted from drawDestMode:
    renderTravelerNotes:         _renderTravelerNotes,
    // v353.2 — research surface (per-destination homework + links).
    renderResearch:              _renderResearch,
    // TM.7.3 (v332):
    renderPendingCancellationsBanner: _renderPendingCancellationsBanner,
    // TM.7.4 (v332):
    renderDestLogistics:              _renderDestLogistics,
    // TM.7.5 (v332):
    renderDayTripChips:               _renderDayTripChips,
    // TM.7.6 (v332):
    renderDestTabBar:                 _renderDestTabBar,
    // TM.7.7 (v333):
    renderDestItineraryPane:          _renderDestItineraryPane,
    // TM.7.8 (v333):
    renderDestStayPane:               _renderDestStayPane,
    // TM.7.9 (v333):
    renderDestInfoPane:               _renderDestInfoPane,
    // TM.7.10 (v333):
    renderDestRoutingAndTrackerPanes: _renderDestRoutingAndTrackerPanes,
    // TM.5 final (v333): single dispatcher entry point.
    renderTripPage:                   _renderTripPage,
  };

  // No back-compat aliases yet — desktop still uses its inline
  // mkItinItem / mkDay. MA.4 introduces aliases when those move.

})(typeof window !== 'undefined' ? window : this);
