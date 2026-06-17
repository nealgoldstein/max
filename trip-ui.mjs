// @ts-check
import { _escHtml } from "./util-esc.mjs";
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
    lbl.textContent = "Notes · " + (s.n || "this sight");
    var status = document.createElement("span");
    status.style.cssText = "font-size:8px;font-weight:500;color:var(--c-ink-4);text-transform:none;letter-spacing:0;";
    hdr.appendChild(lbl);
    hdr.appendChild(status);
    wrap.appendChild(hdr);

    // PD.485 (T2.7): per-sight notes share the ONE place-notes store — the
    // same unification dest.research got in PD.416. s.research was a THIRD
    // store that could silently diverge from the place's notes elsewhere.
    // Seed the legacy field into the unified store once, then read/write
    // through it (s.research kept as a lossless legacy fallback).
    var _sNotesKey = s.n || s.st || "";
    try {
      if (_sNotesKey && typeof global._pmGetPlaceNotes === "function" && typeof global._pmSetPlaceNotes === "function") {
        var _sSeed = global._pmGetPlaceNotes(_sNotesKey);
        if (!_sSeed && typeof s.research === "string" && s.research) {
          global._pmSetPlaceNotes(_sNotesKey, s.research);
        }
      }
    } catch (_) {}
    var saved = (_sNotesKey && typeof global._pmGetPlaceNotes === "function")
      ? global._pmGetPlaceNotes(_sNotesKey)
      : ((typeof s.research === "string") ? s.research : "");
    var view = document.createElement("div");
    view.style.cssText = "font-size:12px;line-height:1.55;color:#333;min-height:30px;padding:5px 7px;background:var(--c-bg);border:1px solid #e8e1c8;border-radius:4px;cursor:text;white-space:pre-wrap;word-wrap:break-word;";
    view.title = "Tap to edit";

    function _esc(x){ return _escHtml(x); }
    function renderViewMode() {
      if (!saved) {
        view.innerHTML = '<span style="color:#bbb;">Tap to add notes, links, hours, reservation details…</span>';
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
        html += '<a href="' + safe + '" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);text-decoration:underline;word-break:break-all;">' + safe + '</a>' + _esc(trail);
        lastIdx = m.index + m[1].length;
      }
      html += _esc(saved.substring(lastIdx));
      view.innerHTML = html;
    }
    renderViewMode();

    var ta = document.createElement("textarea");
    ta.placeholder = "Hours, reservation URL, friend's tip, the side entrance…";
    ta.style.cssText = "width:100%;min-height:60px;max-height:200px;font:inherit;font-size:12px;line-height:1.5;padding:5px 7px;border:1px solid var(--c-primary);border-radius:4px;background:var(--c-bg);color:var(--c-ink);resize:vertical;box-sizing:border-box;font-family:inherit;display:none;outline:none;box-shadow:0 0 0 3px rgba(26,95,168,.12);";

    function enterEdit() {
      ta.value = saved;
      view.style.display = "none";
      ta.style.display = "block";
      setTimeout(function(){ ta.focus(); }, 30);
    }
    function exitEdit() {
      var nextVal = ta.value;
      if (nextVal !== saved) {
        if (_sNotesKey && typeof global._pmSetPlaceNotes === "function") global._pmSetPlaceNotes(_sNotesKey, nextVal);
        else s.research = nextVal;
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
        var btn = document.querySelector('#sr-' + s.id + ' .sa[title="Notes for this sight"]');
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
      done.style.cssText = 'font-size:10px;color:var(--c-see);margin-left:18px;margin-top:1px;';
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
      dot.style.cssText="color:var(--c-accent);font-size:13px;flex-shrink:0;width:14px;text-align:center;";
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
      extEdit.style.cssText = "margin-left:3px;font-size:10px;color:var(--c-ink-4);background:none;border:none;cursor:pointer;padding:0 2px;font-family:inherit;line-height:1;";
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
    // PD.485 (T2.7): button dot reflects the unified place-notes store (the
    // sight-notes panel now reads/writes there), with s.research as fallback.
    var _sBtnNotes = ((s.n || s.st) && typeof global._pmGetPlaceNotes === "function")
      ? global._pmGetPlaceNotes(s.n || s.st) : (s.research || "");
    resBtn.textContent = (_sBtnNotes && _sBtnNotes.length) ? "📚•" : "📚";
    resBtn.title = "Notes for this sight";
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
    if(s.booking) bkb.style.cssText="color:var(--c-see);font-weight:600;";
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
      var sep=document.createElement("span"); sep.style.cssText="font-size:10px;color:var(--c-ink-4);"; sep.textContent="\u2013";
      var endInp=document.createElement("input"); endInp.type="time"; endInp.className="stime-inp"; endInp.value=item.timeEnd||"";
      // v360.0.6: Save button bumped from 9px/1×5 to 12px/6×11 for
      // mobile tap target (was ~14×14 → now ~44×30 with min-height).
      var saveBtn=document.createElement("button"); saveBtn.className="sa"; saveBtn.style.cssText="font-size:12px;padding:6px 11px;min-height:32px;min-width:44px;"; saveBtn.textContent="Save";
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
      transportLine.style.cssText = "font-size:10.5px;color:var(--c-accent);margin:2px 0 0 22px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
      var hubName = s.dayTripFrom || "the hub";
      var noteMatch = (s.note || "").match(/(\d+)\s*km/);
      var distNote = noteMatch ? " · ~" + (parseInt(noteMatch[1], 10) * 2) + "km round trip" : "";
      var transportTxt = document.createElement("span");
      transportTxt.style.cssText = "font-style:italic;";
      transportTxt.textContent = "↔ Round trip from " + hubName + distNote;
      var transportBtn = document.createElement("button");
      transportBtn.type = "button";
      transportBtn.textContent = "→ Plan transport";
      transportBtn.style.cssText = "font-size:10px;font-weight:600;color:var(--c-accent);background:var(--c-bg);border:1px solid #d8c4e8;border-radius:9px;padding:2px 7px;cursor:pointer;font-family:inherit;";
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
      cancelBtn.style.cssText = "font-size:11px;font-weight:600;color:var(--c-primary);background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:11px;padding:3px 10px;cursor:pointer;font-family:inherit;";
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
          sightLbl.style.cssText = "font-size:10px;color:var(--c-ink-3);font-weight:500;margin-right:4px;";
          sightLbl.textContent = "Add sights at " + dtPlaceForSuggest + ":";
          sightAddRow.appendChild(sightLbl);
          availableSights.forEach(function(sg){
            var chip = document.createElement("button");
            chip.type = "button";
            chip.textContent = "+ " + (sg.name || sg.n || "");
            chip.title = sg.desc || sg.note || "";
            chip.style.cssText = "font-size:10px;font-weight:500;color:var(--c-accent);background:var(--c-bg);border:1px solid #d8c4e8;border-radius:9px;padding:2px 7px;cursor:pointer;font-family:inherit;";
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
        qPop.style.cssText = 'display:none;position:fixed;width:280px;max-width:calc(100vw - 24px);font-size:11px;line-height:1.55;color:#5a4520;background:var(--c-bg);border:1px solid #e6d5a0;border-radius:6px;padding:9px 11px;box-shadow:0 4px 14px rgba(0,0,0,.18);z-index:8500;font-weight:500;text-align:left;white-space:normal;';
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
    // v359.60.30: route formatting through global.fmtD so the strip
    // honors the user's Settings → Date format pref. fmtD already
    // includes weekday + year in the long formats; drop the manual
    // year suffix we used to append. Fallback for the headless test
    // environment keeps the previous toLocaleDateString.
    var fmt = (typeof global.fmtD === "function")
      ? global.fmtD
      : function (iso) {
          try {
            var d = new Date(iso + "T12:00:00");
            return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
          } catch (_) { return iso; }
        };
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
    // v359.60.30: clickable — opens _openTripDatesEditor so the user
    // can change start/end without hunting through menus.
    datesBar.style.cssText = "margin:0 2px 12px;padding:14px 16px;background:var(--c-bg);border:1px solid #e6e2d8;border-radius:8px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;cursor:pointer;transition:background 120ms ease;";
    datesBar.title = "Click to change trip dates";
    datesBar.onmouseover = function(){ datesBar.style.background = "#fafaf6"; };
    datesBar.onmouseout  = function(){ datesBar.style.background = "#fff"; };
    datesBar.onclick = function(){
      if (typeof global._openTripDatesEditor === "function") global._openTripDatesEditor();
    };
    datesBar.innerHTML = ''
      + '<div style="font-size:18px;font-weight:700;color:#1a1a1a;">'
      +   fmt(first.dateFrom) + ' – ' + fmt(last.dateTo)
      +   ' <span style="font-size:11px;color:var(--c-ink-4);font-weight:500;margin-left:4px;">&#9998;</span>'
      + '</div>'
      + '<div style="font-size:12px;color:#666;">'
      +   '<strong>' + totalDays + ' days</strong> · ' + totalNights + ' nights · '
      +   (function () {
            var _s = (trip.destinations || []).filter(function (d) { return (d.nights || 0) > 0; }).length;
            var _g = (trip.destinations || []).length - _s;
            return _s + ' stay' + (_s !== 1 ? 's' : '') + (_g ? ' · ' + _g + ' sight' + (_g !== 1 ? 's' : '') : '');
          })()
      +   underHtml
      + '</div>';
    container.appendChild(datesBar);

    // v360.1: peek chip ("N things need your attention →") renders
    // here, between the dates bar and the phase-chips row below.
    // Ordering principle: the chip carries urgent operational
    // pressure; phase chips are quieter cross-phase context
    // ("🧭 4 set aside in Discovery"). Urgent first.
    _renderTripPeekChip(trip, container);

    // v359.60.47: cross-phase chip row under the dates strip on the
    // Structure view. Surfaces the count of places in Discovery that
    // haven't been added to the trip (a real ongoing thing — you do
    // bounce back between Structure and Discovery as you refine).
    if (typeof global._phaseChipsHtml === "function") {
      var html = global._phaseChipsHtml("structure");
      if (html) {
        var chipsWrap = document.createElement("div");
        chipsWrap.style.cssText = "margin:0 2px 12px;";
        chipsWrap.innerHTML = html;
        // Stop chip clicks from bubbling to the dates bar.
        try {
          chipsWrap.querySelectorAll(".phase-chips button").forEach(function(b){
            b.addEventListener("click", function(e){ e.stopPropagation(); });
          });
        } catch(_){}
        container.appendChild(chipsWrap);
      }
    }
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
    wrap.style.cssText = "margin:0 2px 12px;padding:11px 14px;border:1px solid var(--c-border-blue);background:linear-gradient(135deg,#eaf3fb 0%,#dcecf8 100%);border-radius:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;";
    var leftCol = document.createElement("div");
    leftCol.style.cssText = "flex:1;min-width:0;line-height:1.4;";
    var topLine = document.createElement("div");
    topLine.style.cssText = "font-size:11px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;";
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
      jumpBtn.style.cssText = "font-size:11px;font-weight:600;padding:6px 12px;border:1px solid var(--c-primary);border-radius:5px;background:var(--c-primary);color:var(--c-on-dark);cursor:pointer;font-family:inherit;flex-shrink:0;";
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
    // v360.1: caret removed. The "Show"/"Hide" hint on the right
    // already conveys expansion state; the rotating caret was
    // duplicate signal. Removing it also lets 📅 sit at the same
    // horizontal offset as the icons on the sibling panels
    // (🔧 Itinerary, 🧭 Discovery).
    var iconSpan = document.createElement("span");
    iconSpan.style.cssText = "font-size:14px;flex-shrink:0;line-height:1;";
    iconSpan.textContent = "📅";
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
    labelSpan.innerHTML = when + " — Bookings: " + preTail;
    var hintSpan = document.createElement("span");
    hintSpan.style.cssText = "font-size:10px;font-weight:500;color:#a89055;font-style:italic;";
    hintSpan.textContent = expanded ? "Hide" : "Show";
    chip.appendChild(iconSpan);
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
      line.style.cssText = "display:block;width:100%;text-align:left;padding:7px 10px;margin-bottom:4px;font-family:inherit;font-size:11.5px;color:#5a4520;background:var(--c-bg);border:1px solid #ead7a3;border-radius:5px;cursor:pointer;line-height:1.45;";
      line.onmouseover = function () { line.style.background = "#fdf3cf"; };
      line.onmouseout  = function () { line.style.background = "#fff"; };
      var text = "";
      var _esc = function(s){ return _escHtml(s); };
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
    // v360.1: honest counting of destinations that genuinely have a
    // load in flight vs. ones that just haven't been opened yet.
    // Suggestions fetch lazily — only when the user opens that
    // destination's detail view. So "(still gathering…)" was
    // misleading: it implied Max was busy when really it was
    // describing destinations the user simply hadn't visited. Per
    // late-binding, unopened destinations are FINE and shouldn't be
    // framed as incomplete. We now distinguish:
    //   nLoading    — fetches actively in flight RIGHT NOW (rare)
    //   nUnexplored — destinations without any suggestions yet
    //                 (the common case, no fetch queued)
    var nLoading = 0, nUnexplored = 0;
    if (typeof global._generatedCityData !== "undefined" && trip && trip.destinations) {
      for (var i = 0; i < trip.destinations.length; i++) {
        var d = trip.destinations[i];
        if (!d || !d.place) continue;
        var k = d.place.toLowerCase();
        var s = global._generatedCityData[k];
        if (s && s.loading) nLoading++;
        else if (!s && (!Array.isArray(d.suggestions) || d.suggestions.length === 0)) {
          nUnexplored++;
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
    // v360.1: 🔧 wrench lifted into its own icon span (matching the
    // 🧭 compass on the Discovery panel below) so the two icons sit
    // at the same horizontal offset across both sibling panels. The
    // expand/collapse caret was removed entirely — the "Show"/"Hide"
    // hint on the right already conveys state; the rotating caret
    // was duplicate signal and pushed the icon out of alignment with
    // sibling panels.
    var iconSpan = document.createElement("span");
    iconSpan.style.cssText = "font-size:14px;flex-shrink:0;line-height:1;";
    iconSpan.textContent = "🔧";
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
    // v360.1: honest indicator. If we have a real in-flight load,
    // say "fetching…". If destinations exist without suggestions
    // (just unopened — no work happening), say "N not yet explored"
    // so the user knows it's about their action, not Max's.
    var generatingTail = '';
    if (nLoading > 0) {
      generatingTail = ' <span style="font-weight:500;color:#a89055;font-style:italic;font-size:11px;">(fetching ' +
        nLoading + ' destination' + (nLoading === 1 ? '' : 's') + '…)</span>';
    } else if (nUnexplored > 0) {
      generatingTail = ' <span style="font-weight:500;color:#a89055;font-size:11px;">· ' +
        nUnexplored + ' not yet explored</span>';
    }
    labelSpan.innerHTML = 'Itinerary: ' + bits.join(' · ') + generatingTail;
    var hintSpan = document.createElement("span");
    hintSpan.style.cssText = "font-size:10px;font-weight:500;color:#a89055;font-style:italic;";
    hintSpan.textContent = expanded ? "Hide" : "Show";
    // Layout: [🔧 icon] [Itinerary: ...] [Show / Hide]
    chip.appendChild(iconSpan);
    chip.appendChild(labelSpan);
    chip.appendChild(hintSpan);
    wrap.appendChild(chip);

    var list = document.createElement("div");
    list.style.cssText = "padding:0 14px 12px;display:" + (expanded ? "block" : "none") + ";";
    list.style.borderTop = "1px solid #e6d5a0";
    list.style.paddingTop = "10px";

    // v360.1 (slice 2c-ish): pop-out affordance. Opens the same list
    // in a new browser window so the user can keep it visible
    // alongside the main app while working through items — and
    // print from that window via Cmd/Ctrl+P. The new window has a
    // Print button of its own for clarity.
    var actionBar = document.createElement("div");
    actionBar.style.cssText =
      'display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px;';
    var popoutBtn = document.createElement("button");
    popoutBtn.type = "button";
    popoutBtn.style.cssText =
      'background:var(--c-bg);border:1px solid #d8c4a4;color:#5c4520;font-family:inherit;' +
      'font-size:11px;font-weight:600;padding:4px 10px;border-radius:5px;cursor:pointer;';
    popoutBtn.textContent = '📋 Pop out';
    popoutBtn.title = 'Open this list in a separate window you can keep visible while you work through it';
    popoutBtn.onclick = function (e) {
      e.stopPropagation();
      _popoutDecisionsDeferred(trip, summary);
    };
    actionBar.appendChild(popoutBtn);
    list.appendChild(actionBar);

    summary.items.forEach(function (item) {
      var line = document.createElement("button");
      line.type = "button";
      line.style.cssText = "display:block;width:100%;text-align:left;padding:7px 10px;margin-bottom:4px;font-family:inherit;font-size:11.5px;color:#5a4520;background:var(--c-bg);border:1px solid #ead7a3;border-radius:5px;cursor:pointer;line-height:1.45;";
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
      var _esc = function(s){ return _escHtml(s); };
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
      hintSpan.textContent = nowExpanded ? "Hide" : "Show";
      try { localStorage.setItem("max-decisions-expanded", nowExpanded ? "1" : "0"); } catch (e) {}
    };
    container.appendChild(wrap);
  }

  // v360.1: "Find more in Discovery" panel — styled to match the
  // Itinerary (decisions-deferred) panel above it. Both panels are
  // invitations to a sub-surface: the Itinerary panel opens the
  // keep/skip flow for placeholder sights; this one opens Discovery
  // so the user can ask Max for more places to consider.
  //
  // The matching style (cream background, warm tan border, same font
  // weight + colour) makes the parallel role visually obvious — they
  // read as siblings, two doors into the work that's still open.
  //
  // Earlier this affordance lived as a single line in the phase-chips
  // row, where it duplicated the count already shown by the PLACES
  // YOU SET ASIDE section. The chip is gone from that row; the count
  // lives in the section header; this panel is the call-to-action.
  //
  // Conditional: only renders when Discovery has produced any places
  // (s.discoveredCount > 0). When the trip has nothing in Discovery,
  // there's nothing to go back to — the panel stays hidden.
  function _renderDiscoveryPromptPanel(trip, container) {
    if (!container) return;
    if (typeof global._phaseStatus !== 'function') return;
    var s = global._phaseStatus();
    if (!s || !s.discoveredCount) return;

    // v360.2: surface unprocessed wisps. If the user has captured one or
    // more ✨ ideas via the Spark intake that Max hasn't evaluated yet,
    // the panel label changes from a generic "find more places" to a
    // specific "N new ideas to evaluate" — and tapping it runs the
    // wisps through Max's must-do extractor before opening the picker,
    // so the new ideas show up as candidate places. Closes the
    // Structure↔Spark recursive loop (audit fix #1).
    // v360.2: three-state panel — but cream (default) state exposes
    // TWO distinct actions side-by-side because "browse what's there"
    // and "ask Max for more" are not the same intent. Conflating them
    // hides the generative action behind a navigational verb.
    //
    //   1. UNPROCESSED WISPS (amber): single action — Evaluate
    //   2. RESULTS READY (green): single action — Review
    //   3. CALM (cream): TWO actions — Browse / Ask for more
    //
    // Late-binding throughout: capture deferred, evaluation deferred,
    // review deferred. The user opts in at every step.
    var unprocessed = (typeof global._wispUnprocessed === 'function')
      ? global._wispUnprocessed(trip)
      : [];
    var n = unprocessed.length;
    var hasWisps = n > 0;
    var lastResult = (typeof globalThis !== 'undefined' && globalThis._lastWispEvalResult) ||
                     (typeof window !== 'undefined' && window._lastWispEvalResult) ||
                     null;
    var resultsReady = !hasWisps && !!(lastResult && lastResult.addedCount &&
      (Date.now() - (lastResult.evaluatedAt || 0) < 5 * 60 * 1000));
    // Evaluating-in-progress: the LLM call is in flight. Show a visible
    // "Evaluating…" state instead of leaving the amber panel unchanged
    // while the user waits 5-15 seconds wondering if their click worked.
    var evalInProgress = !!(typeof window !== 'undefined' && window._wispEvalInProgress);
    console.log('[discovery-panel] render state', {
      unprocessedCount: n,
      hasWisps: hasWisps,
      hasLastResult: !!lastResult,
      addedCount: lastResult && lastResult.addedCount,
      evaluatedAt: lastResult && lastResult.evaluatedAt,
      ageMs: lastResult ? Date.now() - (lastResult.evaluatedAt || 0) : null,
      resultsReady: resultsReady,
      evalInProgress: evalInProgress,
    });

    // Palette by state. Green is now more visibly green (less pale).
    var palette;
    if (evalInProgress) {
      palette = { bg:'#fef0d8', bgHover:'#fef0d8', border:'#d8a060',
                  fg:'#7a3e10', hint:'#a86838', icon:'✨' };
    } else if (hasWisps) {
      palette = { bg:'#fff5ec', bgHover:'#ffeacc', border:'#d8a060',
                  fg:'#7a3e10', hint:'#a86838', icon:'✨' };
    } else if (resultsReady) {
      // More saturated green so the celebratory state is impossible to
      // miss. Was #ecf6ec (very pale) — read closer to cream than green.
      palette = { bg:'#d4ecd4', bgHover:'#bfe1bf', border:'#4f9d3e',
                  fg:'#1e4a22', hint:'#2a7a2a', icon:'✓' };
    } else {
      palette = { bg:'#fbf6e8', bgHover:'#f7eed3', border:'#e6d5a0',
                  fg:'#7d5e00', hint:'#a89055', icon:'🧭' };
    }

    var wrap = document.createElement('div');
    wrap.style.cssText =
      'margin:0 2px 12px;padding:10px 14px;border:1px solid ' + palette.border + ';border-radius:8px;' +
      'background:' + palette.bg + ';display:flex;align-items:center;gap:10px;' +
      'font-family:inherit;font-size:12px;font-weight:600;color:' + palette.fg + ';';
    // v360.3 (#104): apply the discovery-panel pulse if a wisp was
    // just captured. _wispJustCaptured is a timestamp set by the
    // Spark intake; we pulse for ~3 seconds after capture, then let
    // the flag age out. Without this, a user captures a wisp and
    // sees only a toast — the amber panel below silently increments
    // its count with nothing pulling the eye to it.
    var _captureTs = (typeof window !== 'undefined' && window._wispJustCaptured) || 0;
    if (_captureTs && (Date.now() - _captureTs) < 3000 && hasWisps) {
      wrap.className = 'tm-discovery-pulse';
      // Clear the flag after starting the animation so subsequent
      // renders (e.g. from autoSave) don't restart the pulse.
      setTimeout(function () {
        try { window._wispJustCaptured = 0; } catch (_) {}
      }, 100);
    }

    var icon = document.createElement('span');
    icon.style.cssText = 'font-size:14px;flex-shrink:0;line-height:1;';
    icon.textContent = palette.icon;
    wrap.appendChild(icon);

    var label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0;';
    if (evalInProgress) {
      label.innerHTML = 'Evaluating with Max <span class="max-thinking" style="font-style:italic;color:#a86838;">…</span>';
    } else if (hasWisps) {
      label.innerHTML = 'Discovery: <strong>' + n + '</strong> new idea' +
        (n === 1 ? '' : 's') + ' to evaluate';
    } else if (resultsReady) {
      var rc = lastResult.addedCount;
      var rWispBit = (lastResult.wispCount === 1 && lastResult.wispTexts && lastResult.wispTexts[0])
        ? ' from "' + lastResult.wispTexts[0] + '"'
        : '';
      // "Must-dos" implies commitment (must); these are possibilities,
      // not commitments. Language mirrors the Spark intake ("What else
      // might matter on this trip?") — recipients of that prompt are
      // things to consider, not obligations.
      label.innerHTML = 'Max added <strong>' + rc + '</strong> new thing' +
        (rc === 1 ? '' : 's') + ' to consider' + rWispBit;
    } else {
      label.innerHTML = 'Discovery';
    }
    wrap.appendChild(label);

    // Action button factory — keeps single + dual button states uniform.
    function _mkBtn(text, onclick, kind) {
      var b = document.createElement('button');
      b.type = 'button';
      // primary kind = filled; secondary kind = outlined.
      var primary = (kind === 'primary');
      b.style.cssText =
        'flex-shrink:0;font-family:inherit;font-size:11px;font-weight:600;' +
        'padding:6px 12px;border-radius:5px;cursor:pointer;white-space:nowrap;' +
        (primary
          ? 'background:' + palette.fg + ';color:#fff;border:1px solid ' + palette.fg + ';'
          : 'background:#fff;color:' + palette.fg + ';border:1px solid ' + palette.border + ';');
      b.innerHTML = text;
      b.onmouseover = function () {
        if (primary) b.style.opacity = '0.88';
        else b.style.background = palette.bgHover;
      };
      b.onmouseout = function () {
        if (primary) b.style.opacity = '1';
        else b.style.background = '#fff';
      };
      b.onclick = function (e) {
        e.stopPropagation();
        if (typeof onclick === 'function') onclick();
      };
      return b;
    }

    if (evalInProgress) {
      // Disabled spinner-like button while LLM is running. No click.
      var spinBtn = document.createElement('span');
      spinBtn.style.cssText =
        'flex-shrink:0;font-size:11px;font-weight:600;padding:6px 12px;' +
        'border-radius:5px;background:#fff;color:#a86838;border:1px solid #d8a060;' +
        'font-style:italic;cursor:wait;';
      spinBtn.textContent = 'Thinking…';
      wrap.appendChild(spinBtn);
    } else if (hasWisps) {
      wrap.appendChild(_mkBtn('Evaluate →', function () {
        if (typeof window.evaluateWispsForDiscovery === 'function') {
          window.evaluateWispsForDiscovery();
        }
      }, 'primary'));
    } else if (resultsReady) {
      wrap.appendChild(_mkBtn('Review →', function () {
        if (typeof window._reopenPickerAny === 'function') {
          window._reopenPickerAny();
        }
      }, 'primary'));
    } else {
      // Cream state — single action: open Discovery. The picker has its
      // own "Discover more places" affordance and per-section "more
      // like these" buttons, so duplicating "Ask for more" here just
      // adds noise. The panel's job is to get you back to Discovery;
      // the picker's job is to offer the in-context generative paths.
      wrap.appendChild(_mkBtn('Open Discovery →', function () {
        if (typeof window._reopenPickerAny === 'function') {
          window._reopenPickerAny();
        }
      }, 'primary'));
    }

    container.appendChild(wrap);
  }

  // v360.1: shared pop-out builder. Opens a new browser window with
  // a sectioned list the user can resize, reposition next to the main
  // app, and print from. Each row is clickable; clicks navigate the
  // main window via window.opener (selectDest + optional activeSection
  // override + optional day-card scroll) without closing the popout.
  //
  // Replaces ~150 lines of near-identical implementation across the
  // decisions-deferred and operational popouts. Wrappers below
  // prepare the sections and call this.
  //
  // opts = {
  //   title:    "What needs you — <Trip>",
  //   subtitle: "8 items · opened 2026-05-22",
  //   tipHtml:  "Print single-sided..."  // optional, suppressed in print
  //   width:    560,  // optional initial window width
  //   height:   720,
  //   sections: [
  //     {
  //       heading: "Cancellation deadlines",  // optional
  //       rows: [
  //         {
  //           line1: "Fri, 18 Sept · Reykjavík",  // already-escaped HTML
  //           line2: "Cancel by 2026-09-17",
  //           destId: "trip-1234",
  //           dayId: "d-abc",          // optional, scroll target
  //           urgent: true,            // optional, red border + glyph
  //           activeSection: "tracker", // optional, opener._activeDmSection
  //         },
  //         …
  //       ]
  //     }
  //   ]
  // }
  function _popoutListWindow(opts) {
    opts = opts || {};
    var sections = Array.isArray(opts.sections) ? opts.sections : [];
    var totalRows = sections.reduce(function (n, s) {
      return n + ((s && Array.isArray(s.rows)) ? s.rows.length : 0);
    }, 0);
    if (!totalRows) {
      if (typeof global.maxAlert === 'function') {
        global.maxAlert('Nothing to pop out — the list is empty.');
      }
      return;
    }
    var w = window.open(
      '',
      '_blank',
      'width=' + (opts.width || 560) + ',height=' + (opts.height || 720),
    );
    if (!w) {
      console.warn('[popout] popup blocked');
      if (typeof global.maxAlert === 'function') {
        global.maxAlert('Browser blocked the pop-out window. Allow popups from this site and try again.');
      }
      return;
    }

    var sectionsHtml = sections.map(function (sec) {
      if (!sec || !Array.isArray(sec.rows) || !sec.rows.length) return '';
      var head = sec.heading ? '<h2>' + sec.heading + '</h2>' : '';
      var rows = sec.rows.map(function (r) {
        var cls = r.urgent ? 'urgent' : '';
        var attrs = [
          'data-dest-id="' + (r.destId || '') + '"',
        ];
        if (r.dayId) attrs.push('data-day-id="' + r.dayId + '"');
        if (r.activeSection) attrs.push('data-active-section="' + r.activeSection + '"');
        return '<li class="' + cls + '" ' + attrs.join(' ') + '>' +
          '<div class="text">' +
            '<div class="line1">' + (r.line1 || '') + '</div>' +
            (r.line2 ? '<div class="line2">' + r.line2 + '</div>' : '') +
          '</div>' +
          '<div class="checkbox">☐</div>' +
        '</li>';
      }).join('');
      return head + '<ul>' + rows + '</ul>';
    }).join('');

    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>' + (opts.title || 'List') + '</title>' +
      '<style>' +
        'body{font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#222;max-width:680px;margin:24px auto;padding:0 24px;}' +
        '.toolbar{display:flex;justify-content:flex-end;margin-bottom:12px;}' +
        '.toolbar button{font:600 12px inherit;background:#fff;border:1px solid #d8c4a4;color:#5c4520;border-radius:5px;padding:5px 12px;cursor:pointer;}' +
        '@media print{.toolbar{display:none;}}' +
        'h1{font-size:20px;margin:0 0 4px;}' +
        '.meta{font-size:11px;color:#888;margin:0 0 8px;}' +
        '.tip{font-size:11px;color:#888;font-style:italic;margin:0 0 18px;}' +
        '@media print{.tip{display:none;}}' +
        'h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#5c4520;margin:18px 0 6px;border-bottom:1px solid #e8d8c4;padding-bottom:4px;}' +
        'ul{list-style:none;padding:0;margin:0 0 12px;}' +
        'li{display:flex;align-items:center;gap:12px;padding:9px 6px;border-bottom:1px dashed #ddd;cursor:pointer;border-radius:4px;transition:background .12s ease;break-inside:avoid;}' +
        'li:hover{background:#fff8e6;}' +
        'li.urgent{border-left:3px solid #c0392b;padding-left:8px;}' +
        'li.urgent .line1{color:#c0392b;}' +
        '@media print{li{cursor:auto;padding:9px 0;}li:hover{background:transparent;}}' +
        'li .text{flex:1;min-width:0;}' +
        '.line1{font-weight:600;color:#111;}' +
        '.line2{font-size:11.5px;color:#666;margin-top:2px;}' +
        '.checkbox{font-size:20px;color:#aaa;line-height:1;flex-shrink:0;}' +
        '@media print{body{margin:0;padding:0 12mm;}.checkbox{color:#000;}}' +
      '</style></head><body>' +
      '<div class="toolbar"><button onclick="window.print()">🖨 Print</button></div>' +
      '<h1>' + (opts.title || '') + '</h1>' +
      '<div class="meta">' + (opts.subtitle || '') + '</div>' +
      (opts.tipHtml ? '<div class="tip">' + opts.tipHtml + '</div>' : '') +
      sectionsHtml +
      '<script>' +
        '(function(){' +
          'document.querySelectorAll("li[data-dest-id]").forEach(function(li){' +
            'var destId = li.getAttribute("data-dest-id");' +
            'var dayId = li.getAttribute("data-day-id");' +
            'var sect = li.getAttribute("data-active-section");' +
            'if (!destId) return;' +
            'li.title = "Click to jump to this destination in the main window";' +
            'li.addEventListener("click", function(){' +
              'if (!window.opener || window.opener.closed) {' +
                'alert("The main Max window is closed — reopen it and try again.");' +
                'return;' +
              '}' +
              'try {' +
                'window.opener.focus();' +
                'if (sect) { try { window.opener._activeDmSection = sect; } catch(e) {} }' +
                'if (typeof window.opener.selectDest === "function") {' +
                  'window.opener.selectDest(destId);' +
                '}' +
                'if (dayId) {' +
                  'setTimeout(function(){' +
                    'try {' +
                      'var el = window.opener.document.getElementById("dy-" + dayId);' +
                      'if (el && el.scrollIntoView) {' +
                        'el.scrollIntoView({ behavior: "smooth", block: "center" });' +
                      '}' +
                    '} catch(e) {}' +
                  '}, 280);' +
                '}' +
              '} catch (e) { alert("Couldn\'t navigate the main window: " + (e && e.message ? e.message : e)); }' +
            '});' +
          '});' +
        '})();' +
      '<\/script>' +
      '</body></html>';

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // v360.1 (slice 2c-ish): pop-out window for the decisions-deferred
  // panel. Opens the same item list in a new browser window the user
  // can resize, reposition next to the main app, and print from. The
  // popup includes its own Print button. Doesn't auto-print and
  // doesn't auto-close — the user keeps it open as long as useful.
  function _popoutDecisionsDeferred(trip, summary) {
    function esc(s){ return _escHtml(s); }
    var fmtD = global.fmtD;
    function destObj(id) {
      if (!trip || !Array.isArray(trip.destinations)) return null;
      for (var i = 0; i < trip.destinations.length; i++) {
        if (trip.destinations[i] && trip.destinations[i].id === id) return trip.destinations[i];
      }
      return null;
    }
    function destRange(d) {
      if (!d || !fmtD) return '';
      if (d.dateFrom && d.dateTo && d.dateFrom !== d.dateTo) {
        return fmtD(d.dateFrom) + ' – ' + fmtD(d.dateTo);
      }
      if (d.dateFrom) return fmtD(d.dateFrom);
      return '';
    }

    // v360.1: single-line format mirrors the inline panel so popout
    // and inline read identically — date as the bold-led head, then
    // destination, then the action description after an em-dash.
    // (Previous two-line stacking split the date away from the
    // action; the user pointed out the inline format reads better.)
    var items = (summary && Array.isArray(summary.items)) ? summary.items : [];
    var rows = items.map(function (item) {
      if (item.kind === 'tentative') {
        var d = destObj(item.destId);
        var range = destRange(d);
        return {
          line1:
            (range ? '<strong>' + esc(range) + '</strong> · ' : '') +
            esc(item.destPlace || 'this destination') + ' — ' +
            '<strong>' + esc(item.count) + '</strong> placeholder' +
            (item.count !== 1 ? 's' : '') + ' to keep or skip',
          destId: item.destId || '',
        };
      }
      return {
        line1:
          '<strong>' + esc(item.dayLbl || 'A day') + '</strong> · ' +
          esc(item.destPlace || 'this destination') + ' — empty',
        destId: item.destId || '',
        dayId: item.dayId || null,
      };
    });

    var tripName = (trip && trip.name) || (trip && trip.brief && trip.brief.name) || 'Trip';
    var today = new Date();
    var genStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var total = (summary && summary.totalCount) || items.length;

    _popoutListWindow({
      title: 'Itinerary decisions — ' + esc(tripName),
      subtitle: total + ' open item' + (total === 1 ? '' : 's') + ' · opened ' + genStr,
      tipHtml: 'Click a row to jump to that destination in the main window (this window stays open). Print: set single-sided in the dialog so you can mark items off as you go.',
      width: 520,
      height: 720,
      sections: [{ rows: rows }],
    });
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
    nb.style.cssText = "margin:6px 2px 10px;padding:10px 12px;background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:7px;font-size:11px;line-height:1.55;color:#1a3f6f;";
    nb.innerHTML = (typeof global._fqBannerInnerHtml === "function") ? global._fqBannerInnerHtml() : "";
    var dismissRow = document.createElement("div");
    dismissRow.style.cssText = "margin-top:8px;display:flex;justify-content:flex-end;";
    var dismissBtn = document.createElement("button");
    dismissBtn.style.cssText = "font-size:10px;font-weight:500;padding:4px 10px;border:1px solid #cfd8e2;border-radius:5px;background:var(--c-bg);color:#666;cursor:pointer;font-family:inherit;";
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
    // v360.1: _renderTripDatesStrip now also fires the peek chip
    // *inside* itself, between the dates bar and the phase-chips row.
    // The chip ("N things need your attention →") must sit ABOVE the
    // phase chips ("🧭 4 set aside in Discovery") — urgent over
    // contextual — and the cleanest way to guarantee that ordering
    // is to inline the peek-chip render inside the dates strip.
    _renderTripDatesStrip(trip, container);
    // v360.3: overview strips now hold ONLY the dates card and the
    // conditional state banners (today's day, pre-arrival countdown).
    // The other panels have moved to explicit positions in
    // drawTripMode to match the user's desired reading order:
    //   • Day-trips / On-the-way tips text (_renderGeoAffordanceBanner)
    //     → renders AFTER arrival/departure + trip bookings, so it
    //       reads as guidance before the user starts shaping
    //   • Itinerary empty-days panel (_renderDecisionsDeferredPanel)
    //     → renders AFTER spark intake, just before the destinations
    //       list, so it reads as the bridge from "what could go here"
    //       into "what's actually scheduled"
    //   • Considered + Discovery panels render at the very bottom
    //     (already moved in v360.3 earlier).
    _renderTodayBanner(trip, container);
    _renderPreArrivalBanner(trip, container);
    // v360.1 (slice 1.1): the trip-wide Action needed banner used to
    // render here. It's been replaced by the quieter peek chip
    // (renderTripPeekChip) that links to the operational surface
    // stub. Both surfaces showed the same data; the louder banner
    // was the redundancy. The chip uses _collectOperationalItems
    // which is shaped from the same actions + deadlines logic.
    // _renderTripActionNeededPanel kept defined in this file for now
    // as a deprecation cushion — nothing calls it. Safe to delete in
    // a later slice once we're sure nothing else references it.
  }

  // ── v359.60.61: trip-wide Action needed panel ──────────────
  // Aggregates open pendingActions + cancellation deadlines across
  // every destination. Renders nothing when the trip is clean.
  // Click an item to jump to the source destination's Action needed
  // tab; the panel itself is collapsible, defaulting to collapsed
  // so it doesn't dominate the trip view when the list is long.
  function _renderTripActionNeededPanel(trip, container) {
    if (!trip || !Array.isArray(trip.destinations)) return;
    var actions = Array.isArray(trip.pendingActions)
      ? trip.pendingActions.filter(function(a){ return a && !a.cleared && a.requiresProviderAction; })
      : [];
    var collectDeadlinesFn = global.collectDeadlines;
    var deadlines = [];
    if (typeof collectDeadlinesFn === "function") {
      trip.destinations.forEach(function(d){
        try { deadlines = deadlines.concat(collectDeadlinesFn(d) || []); } catch(_) {}
      });
    }
    if (actions.length === 0 && deadlines.length === 0) return;

    // Resolve each action to the destination it belongs to (by
    // destName) so the click handler can jump to that card's Action
    // needed tab. Falls back to the first destination if name doesn't
    // resolve — better than leaving the click dead.
    var destByName = {};
    trip.destinations.forEach(function(d){
      if (d && d.id) {
        if (d.label) destByName[String(d.label).toLowerCase()] = d.id;
        if (d.place) destByName[String(d.place).toLowerCase()] = d.id;
      }
    });
    function _destIdFor(actDest){
      return destByName[String(actDest||'').toLowerCase()] || (trip.destinations[0] && trip.destinations[0].id) || null;
    }

    var panel = document.createElement("div");
    panel.style.cssText = "margin:8px 0;background:#fff5ec;border:1px solid #f0c8a0;border-radius:7px;overflow:hidden;";

    var hdr = document.createElement("button");
    hdr.type = "button";
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:9px 12px;background:transparent;border:none;cursor:pointer;font-family:inherit;text-align:left;";
    var hdrL = document.createElement("div");
    hdrL.style.cssText = "font-size:12px;color:var(--c-warn);line-height:1.4;";
    var bits = [];
    if (actions.length) bits.push("<strong>" + actions.length + "</strong> provider action" + (actions.length !== 1 ? "s" : ""));
    if (deadlines.length) bits.push("<strong>" + deadlines.length + "</strong> cancellation deadline" + (deadlines.length !== 1 ? "s" : ""));
    hdrL.innerHTML = "⚠ <strong>What you need to take care of</strong> — " + bits.join(" · ");
    var hdrR = document.createElement("div");
    hdrR.style.cssText = "font-size:11px;font-weight:600;color:var(--c-warn);flex-shrink:0;";
    hdrR.textContent = "▾ Show all";
    hdr.appendChild(hdrL); hdr.appendChild(hdrR);
    panel.appendChild(hdr);

    var body = document.createElement("div");
    body.style.cssText = "display:none;border-top:1px solid #f0c8a0;background:var(--c-bg);padding:6px 0;";
    hdr.onclick = function(){
      var open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      hdrR.textContent = open ? "▾ Show all" : "▴ Hide";
    };

    function _row(opts) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-bottom:1px solid #f4f0eb;cursor:pointer;transition:background .12s ease;";
      row.onmouseover = function(){ row.style.background = "#fafaf7"; };
      row.onmouseout  = function(){ row.style.background = "transparent"; };
      var datePill = document.createElement("div");
      datePill.style.cssText = "min-width:62px;font-size:10.5px;font-weight:700;color:" + (opts.urgent ? "#c0392b" : "#b05820") + ";text-transform:uppercase;letter-spacing:0.04em;padding-top:1px;";
      datePill.textContent = opts.dateLabel;
      var col = document.createElement("div");
      col.style.cssText = "flex:1;min-width:0;";
      var name = document.createElement("div");
      name.style.cssText = "font-size:12.5px;font-weight:600;color:#222;line-height:1.35;";
      name.textContent = opts.eventName;
      var sub = document.createElement("div");
      sub.style.cssText = "font-size:10.5px;color:#666;margin-top:2px;line-height:1.45;";
      sub.textContent = opts.destName + " · " + opts.kind + (opts.detail ? " — " + opts.detail : "");
      col.appendChild(name); col.appendChild(sub);
      row.appendChild(datePill); row.appendChild(col);
      if (opts.destId) {
        row.onclick = function(e){
          e.stopPropagation();
          global._activeDmSection = "tracker";
          if (typeof global.drawDestMode === "function") global.drawDestMode(opts.destId);
        };
      }
      return row;
    }

    var today = new Date(); today.setHours(0,0,0,0);
    // Deadlines first, in date order — they're the time-pressured ones.
    deadlines.sort(function(a,b){ return (a.deadline||'').localeCompare(b.deadline||''); });
    deadlines.forEach(function(d){
      var dd = new Date((d.deadline||'') + "T12:00:00");
      var urgent = dd <= today;
      var label = urgent ? "PAST" : (global.fmtD ? global.fmtD(d.deadline) : d.deadline);
      body.appendChild(_row({
        dateLabel: label,
        urgent: urgent,
        eventName: d.name || "Booking",
        destName: d.destName || "",
        kind: d.type + " cancel deadline",
        detail: "",
        destId: d.destId
      }));
    });
    // Then provider actions — no calendar date, so labeled "NOW".
    actions.forEach(function(a){
      body.appendChild(_row({
        dateLabel: "NOW",
        urgent: false,
        eventName: a.eventName || "Action",
        destName: a.destName || "",
        kind: a.actionType || "",
        detail: a.detail || "",
        destId: _destIdFor(a.destName)
      }));
    });
    // Drop the trailing bottom-border on the last child for a clean edge.
    if (body.lastChild && body.lastChild.style) body.lastChild.style.borderBottom = "none";

    panel.appendChild(body);
    container.appendChild(panel);
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
  // v359.60.16: reorder trip.destinations so the entry city is at
  // index 0 and (for round trips) at the end too. Returns the number
  // of destinations that moved (0 if everything was already in the
  // right place). Called from the arrival/departure Apply handler so
  // the user can re-assert the gateway city without rebuilding the
  // whole trip.
  //
  // Cascades dates: the moved trip starts at the same dateFrom as
  // whoever WAS at index 0, and each subsequent destination's dates
  // are recomputed based on its nights count. Trip total length
  // doesn't change.
  function _reorderTripByEntryExit(entryCity, exitCity) {
    if (!trip || !Array.isArray(trip.destinations) || trip.destinations.length < 2) return 0;
    var normFn = (typeof global._normPlaceName === "function") ? global._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
    var entryKey = entryCity ? normFn(entryCity) : "";
    var exitKey  = exitCity  ? normFn(exitCity)  : "";
    if (!entryKey && !exitKey) return 0;
    var before = trip.destinations.map(function(d){ return d && d.id; });
    var newOrder = trip.destinations.slice();
    var moved = 0;
    // Step 1: move entry city to index 0 (first match wins).
    if (entryKey) {
      var entryIdx = newOrder.findIndex(function(d){ return d && d.place && normFn(d.place) === entryKey; });
      if (entryIdx > 0) {
        var entryDest = newOrder.splice(entryIdx, 1)[0];
        newOrder.unshift(entryDest);
      }
    }
    // Step 2: move exit city to the END (last match wins). Skip if
    // exit === entry AND there's only one occurrence — the round-trip
    // shape lives in trip.brief, not as a duplicate destination.
    if (exitKey && exitKey !== entryKey) {
      var exitIdx = -1;
      for (var i = newOrder.length - 1; i >= 0; i--) {
        if (newOrder[i] && newOrder[i].place && normFn(newOrder[i].place) === exitKey) { exitIdx = i; break; }
      }
      if (exitIdx >= 0 && exitIdx < newOrder.length - 1) {
        var exitDest = newOrder.splice(exitIdx, 1)[0];
        newOrder.push(exitDest);
      }
    }
    // Count moves.
    for (var j = 0; j < newOrder.length; j++) {
      if (newOrder[j].id !== before[j]) moved++;
    }
    if (!moved) return 0;
    trip.destinations = newOrder;
    // Cascade dates from the new index 0. Use the original trip start
    // (whichever destination was first before the reorder).
    var startDate = null;
    for (var k = 0; k < trip.destinations.length; k++) {
      var d = trip.destinations[k];
      if (d && d.dateFrom) { startDate = d.dateFrom; break; }
    }
    if (!startDate && before.length) {
      // Fallback: find earliest dateFrom across destinations.
      trip.destinations.forEach(function(d){
        if (d && d.dateFrom && (!startDate || d.dateFrom < startDate)) startDate = d.dateFrom;
      });
    }
    if (startDate) {
      var cur = new Date(startDate + "T12:00:00");
      trip.destinations.forEach(function(d){
        if (!d) return;
        d.dateFrom = cur.toISOString().slice(0, 10);
        var nx = new Date(cur);
        nx.setDate(nx.getDate() + (d.nights || 0));
        d.dateTo = nx.toISOString().slice(0, 10);
        cur = nx;
        // Rebuild days[] if a generator is available.
        if (typeof global.makeDays === "function" && d.id && d.place) {
          d.days = global.makeDays(d.id, d.place, d.intent || d.place, d.dateFrom, d.nights || 0);
        }
      });
    }
    console.log("[Max reorder] moved " + moved + " destination(s); new order:", trip.destinations.map(function(d){return d.place;}).join(" → "));
    return moved;
  }

  // v359.60.19: self-heal duplicate destinations. trip.destinations
  // can land with the same place twice — e.g. Iceland trip where
  // Blue Lagoon appeared at both position 2 (placeId: pl-blue-lagoon)
  // and position 9 (no placeId). Same name + identical coords,
  // different objects. We don't know what specifically introduced the
  // dupe (possibly a wayside promote-back path, possibly a stale
  // candidate that got synthesized twice), so this is a backstop:
  // catch it at render time, merge the entries, log loudly.
  //
  // Merge rules:
  //   • Key by normalized place name. Coord proximity (<0.01° ≈ 1km)
  //     also counts as a match for places with name variants.
  //   • Keeper = the entry with a placeId if exactly one has one;
  //     otherwise the FIRST occurrence in trip.destinations order
  //     (preserves user-visible numbering for the canonical stop).
  //   • Nights = sum across all duplicates. Avoids silent loss of
  //     overnight count if the user explicitly extended one of them.
  //   • bookings / locations / suggestions / trackerItems / etc.
  //     concat from removed entries into the keeper.
  //
  // Returns number of duplicates removed (0 = no duplicates).
  function _dedupeTripDestinations(trip) {
    if (!trip || !Array.isArray(trip.destinations)) return 0;
    var dests = trip.destinations;
    if (dests.length < 2) return 0;
    var normFn = (typeof global._normPlaceName === "function")
      ? global._normPlaceName
      : function(s){ return String(s||"").toLowerCase().trim(); };

    // First pass: group by normalized name. Track first index seen.
    var groups = {};
    var order = [];
    dests.forEach(function(d, i){
      if (!d || !d.place) return;
      var k = normFn(d.place);
      if (!k) return;
      if (!groups[k]) {
        groups[k] = [];
        order.push(k);
      }
      groups[k].push({ idx: i, dest: d });
    });

    // Identify groups with > 1 entry.
    var hasDupes = false;
    order.forEach(function(k){
      if (groups[k].length > 1) hasDupes = true;
    });
    if (!hasDupes) return 0;

    // Merge each group with > 1 entry. Build a new destinations array.
    var toRemoveIds = {};
    var mergeLog = [];
    order.forEach(function(k){
      var grp = groups[k];
      if (grp.length < 2) return;
      // Pick keeper: prefer one with placeId; else first by idx.
      var keeperEntry = null;
      grp.forEach(function(e){
        if (e.dest.placeId && !keeperEntry) keeperEntry = e;
      });
      if (!keeperEntry) {
        keeperEntry = grp.slice().sort(function(a,b){ return a.idx - b.idx; })[0];
      }
      var keeper = keeperEntry.dest;
      grp.forEach(function(e){
        if (e === keeperEntry) return;
        // Sum nights into the keeper.
        keeper.nights = (keeper.nights || 0) + (e.dest.nights || 0);
        // Concat list-type fields.
        ["hotelBookings","generalBookings","locations","attachedEvents","suggestions","todayItems","discoveredItems"].forEach(function(field){
          if (Array.isArray(e.dest[field]) && e.dest[field].length) {
            if (!Array.isArray(keeper[field])) keeper[field] = [];
            keeper[field] = keeper[field].concat(e.dest[field]);
          }
        });
        // Merge trackerItems by category.
        if (e.dest.trackerItems && typeof e.dest.trackerItems === "object") {
          if (!keeper.trackerItems || typeof keeper.trackerItems !== "object") {
            keeper.trackerItems = { booked: [], see: [], visited: [] };
          }
          Object.keys(e.dest.trackerItems).forEach(function(cat){
            var src = e.dest.trackerItems[cat];
            if (Array.isArray(src) && src.length) {
              if (!Array.isArray(keeper.trackerItems[cat])) keeper.trackerItems[cat] = [];
              keeper.trackerItems[cat] = keeper.trackerItems[cat].concat(src);
            }
          });
        }
        if (e.dest.id) toRemoveIds[e.dest.id] = true;
        mergeLog.push(e.dest.place + " (idx " + e.idx + " merged into idx " + keeperEntry.idx + ")");
      });
    });

    if (!mergeLog.length) return 0;

    // Rebuild destinations array, dropping the merged-away entries.
    var removed = 0;
    trip.destinations = dests.filter(function(d){
      if (!d || !d.id) return true;
      if (toRemoveIds[d.id]) { removed++; return false; }
      return true;
    });

    // Cascade dates from the (preserved) start date.
    var startDate = trip.destinations[0] && trip.destinations[0].dateFrom;
    if (!startDate) {
      for (var n = 0; n < trip.destinations.length; n++) {
        if (trip.destinations[n] && trip.destinations[n].dateFrom) {
          startDate = trip.destinations[n].dateFrom;
          break;
        }
      }
    }
    if (startDate) {
      var cur = new Date(startDate + "T12:00:00");
      trip.destinations.forEach(function(d){
        if (!d) return;
        d.dateFrom = cur.toISOString().slice(0, 10);
        var nx = new Date(cur); nx.setDate(nx.getDate() + (d.nights || 0));
        d.dateTo = nx.toISOString().slice(0, 10);
        if (typeof global.makeDays === "function" && d.id && d.place) {
          d.days = global.makeDays(d.id, d.place, d.intent || d.place, d.dateFrom, d.nights || 0);
        }
        cur = nx;
      });
    }
    console.log("[Max dedupe] merged " + removed + " duplicate destination(s):", mergeLog.join("; "));
    return removed;
  }

  // v359.60.18: self-heal "criss-cross" trip-destination order.
  // The geo-reorder pass in orderKeptCandidates is supposed to produce
  // a sane geographic walk through the trip, but it depends on every
  // candidate having a real lat/lng. Trips built before the (0,0)
  // filter (v359.60.18) often shipped with garbage coords on
  // synthesized completeness-pass places, which poisoned the centroid
  // / nearest-neighbor walk and produced trips that bounce all over
  // the country.
  //
  // This helper runs at drawTripMode time. Two phases:
  //
  //   1. Sanitize: any dest with lat===0 && lng===0 gets coords
  //      nulled out — these are sentinel "no coord" values, not the
  //      Atlantic. Then try to backfill from global.getCityCenter.
  //
  //   2. Reorder: compute the current trip total path length using
  //      what coords are available. Then compute a nearest-neighbor
  //      walk through the MIDDLE destinations (keeping entry at 0
  //      and exit at last). If the NN path is meaningfully shorter
  //      (< 60% of current), swap in the new order and cascade dates.
  //
  // The 60% threshold is deliberately conservative: a small zigzag
  // shouldn't override the user's manual reordering. Only true
  // criss-cross trips clear that bar.
  //
  // Returns the number of destinations whose position changed.
  function _geoHealTripOrder(trip) {
    if (!trip || !Array.isArray(trip.destinations)) return 0;
    var dests = trip.destinations;
    if (dests.length < 4) return 0; // 1-3 dests: nothing to optimize

    // Phase 1: sanitize + backfill.
    dests.forEach(function(d){
      if (!d) return;
      if (d.lat === 0 && d.lng === 0) { d.lat = null; d.lng = null; }
      var hasReal = typeof d.lat === "number" && typeof d.lng === "number"
        && isFinite(d.lat) && isFinite(d.lng)
        && !(d.lat === 0 && d.lng === 0);
      if (hasReal) return;
      if (typeof global.getCityCenter === "function" && d.place) {
        var ctr = null;
        try { ctr = global.getCityCenter(d.place); } catch(_){}
        if (ctr && isFinite(ctr[0]) && isFinite(ctr[1]) && !(ctr[0] === 0 && ctr[1] === 0)) {
          d.lat = ctr[0];
          d.lng = ctr[1];
        }
      }
    });

    // Phase 2: NN reorder, anchored.
    function getCoord(d){
      if (!d) return null;
      if (typeof d.lat === "number" && typeof d.lng === "number"
          && isFinite(d.lat) && isFinite(d.lng)
          && !(d.lat === 0 && d.lng === 0)) {
        return [d.lat, d.lng];
      }
      return null;
    }
    function distSq(a, b){
      if (!a || !b) return Infinity;
      var dLat = a[0] - b[0], dLng = a[1] - b[1];
      return dLat*dLat + dLng*dLng;
    }
    function pathLen(arr){
      var total = 0;
      for (var i = 1; i < arr.length; i++) {
        var a = getCoord(arr[i-1]);
        var b = getCoord(arr[i]);
        if (a && b) total += Math.sqrt(distSq(a, b));
      }
      return total;
    }

    var entry = dests[0];
    var exit  = dests[dests.length - 1];
    var middle = dests.slice(1, -1);
    // Need at least 2 middle dests with coords for the reorder to mean anything.
    var middleWithCoords = middle.filter(function(d){ return getCoord(d) != null; });
    if (middleWithCoords.length < 2) return 0;

    var entryCoord = getCoord(entry);
    var exitCoord  = getCoord(exit);
    if (!entryCoord) return 0; // can't sort without an anchor

    var current = entryCoord;
    var pool = middle.slice();
    var nnMiddle = [];
    while (pool.length) {
      var bestIdx = -1;
      var bestDist = Infinity;
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        var pc = getCoord(p);
        if (!pc) continue;
        var d = distSq(current, pc);
        // For the last placement, factor distance-to-exit so we don't
        // strand a far destination right before the exit.
        if (pool.length === 1 && exitCoord) {
          d = d * 0.6 + distSq(pc, exitCoord) * 0.4;
        }
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx < 0) {
        // No coord-bearing remainder — append the rest in original order.
        nnMiddle = nnMiddle.concat(pool);
        break;
      }
      var picked = pool.splice(bestIdx, 1)[0];
      nnMiddle.push(picked);
      var pickedCoord = getCoord(picked);
      if (pickedCoord) current = pickedCoord;
    }

    // v359.60.20: 2-opt cleanup. NN gets stuck in local minima where
    // one long backtrack creates an "X" — e.g. Reykjavik → south → SW →
    // NW (long jump across country) → ... → back to W. 2-opt walks
    // pairs of indices (i, j) and reverses the slice between them if
    // the result is shorter. Repeat until stable. O(n²) per iteration,
    // n ≤ ~30 — negligible cost.
    function pathLenWithAnchors(middleArr){
      var total = 0;
      var prev = entryCoord;
      for (var k = 0; k < middleArr.length; k++) {
        var pc = getCoord(middleArr[k]);
        if (prev && pc) total += Math.sqrt(distSq(prev, pc));
        if (pc) prev = pc;
      }
      if (prev && exitCoord) total += Math.sqrt(distSq(prev, exitCoord));
      return total;
    }
    var bestMiddle = nnMiddle.slice();
    var bestLen = pathLenWithAnchors(bestMiddle);
    var improved = true;
    var iters = 0;
    while (improved && iters < 50) {
      improved = false;
      iters++;
      for (var ai = 0; ai < bestMiddle.length - 1; ai++) {
        for (var aj = ai + 1; aj < bestMiddle.length; aj++) {
          var trial = bestMiddle.slice(0, ai)
            .concat(bestMiddle.slice(ai, aj+1).reverse())
            .concat(bestMiddle.slice(aj+1));
          var trialLen = pathLenWithAnchors(trial);
          if (trialLen < bestLen - 1e-9) {
            bestMiddle = trial;
            bestLen = trialLen;
            improved = true;
          }
        }
      }
    }
    nnMiddle = bestMiddle;

    var newOrder = [entry].concat(nnMiddle).concat([exit]);
    // Did the order actually change?
    var changed = false;
    for (var k = 0; k < newOrder.length; k++) {
      if (newOrder[k] !== dests[k]) { changed = true; break; }
    }
    if (!changed) return 0;

    var curLen = pathLen(dests);
    var newLen = pathLen(newOrder);
    // Only swap if the new path is meaningfully shorter. 60% threshold
    // avoids overruling user manual reordering on small zigzags.
    if (curLen <= 0 || newLen >= curLen * 0.60) {
      return 0;
    }

    var beforeOrder = dests.map(function(d){ return d && d.place; }).join(" → ");
    trip.destinations = newOrder;
    // Count moves.
    var moved = 0;
    for (var m = 0; m < newOrder.length; m++) {
      if (dests[m] && newOrder[m] && dests[m].id !== newOrder[m].id) moved++;
    }
    // Cascade dates from the new index 0.
    var startDate = trip.destinations[0] && trip.destinations[0].dateFrom;
    if (!startDate) {
      // Find any dateFrom in the array.
      for (var n = 0; n < trip.destinations.length; n++) {
        if (trip.destinations[n] && trip.destinations[n].dateFrom) {
          startDate = trip.destinations[n].dateFrom;
          break;
        }
      }
    }
    if (startDate) {
      var cur = new Date(startDate + "T12:00:00");
      trip.destinations.forEach(function(d){
        if (!d) return;
        d.dateFrom = cur.toISOString().slice(0, 10);
        var nx = new Date(cur); nx.setDate(nx.getDate() + (d.nights || 0));
        d.dateTo = nx.toISOString().slice(0, 10);
        if (typeof global.makeDays === "function" && d.id && d.place) {
          d.days = global.makeDays(d.id, d.place, d.intent || d.place, d.dateFrom, d.nights || 0);
        }
        cur = nx;
      });
    }
    console.log("[Max geo-heal] re-sorted middle (" + Math.round(curLen*111) + "km → " + Math.round(newLen*111) + "km). Was: " + beforeOrder);
    console.log("[Max geo-heal] new order: " + trip.destinations.map(function(d){return d.place;}).join(" → "));
    return moved;
  }

  function _renderArrivalDeparturePanel(trip, container) {
    console.log('[arrival-panel] called', {
      hasContainer: !!container,
      hasTrip: !!trip,
      destCount: (trip && Array.isArray(trip.destinations)) ? trip.destinations.length : -1,
      entry: trip && trip.brief && trip.brief.entry,
      tbExit: trip && trip.brief && trip.brief.tbExit,
      uiState: trip && trip._ui && trip._ui.arrivalExpanded,
    });
    if (!container) { console.log('[arrival-panel] bail: no container'); return; }
    if (!trip || !Array.isArray(trip.destinations) || !trip.destinations.length) {
      console.log('[arrival-panel] bail: no destinations');
      return;
    }

    // v360.1 (slice 2a): collapse to a one-line summary by default.
    // The full form is a lot of vertical real estate to show on
    // every render when the user has already set their arrival /
    // departure. Default state is collapsed; expand on click. The
    // expanded flag lives in trip._ui.arrivalExpanded so it sticks
    // within a session but doesn't pollute the trip body. When the
    // user hasn't set entry / exit yet, we expand by default so the
    // first-time-through form is still surfaced.
    if (!trip._ui) trip._ui = {};
    var _aeTb = global._tb || {};
    var _aeCurEntry = (trip.brief && trip.brief.entry)  || _aeTb.entry  || "";
    var _aeCurExit  = (trip.brief && trip.brief.tbExit) || _aeTb.tbExit || "";
    // FN.A.2: read mode for each side so the collapsed summary glyph
    // reflects how the user is actually traveling, not a hardcoded ✈.
    // Defaults to "fly" — same default the mode-pill render assumes
    // (index.html ~39370). When entry and exit modes differ (open-jaw
    // with mode mix, e.g. fly in + ferry out), show both glyphs.
    var _aeCurEntryMode = (trip.brief && trip.brief.entryMode) || _aeTb.entryMode || "";
    var _aeCurExitMode  = (trip.brief && trip.brief.exitMode)  || _aeTb.exitMode  || "";
    var _aeNeverSet = !_aeCurEntry || !_aeCurExit;
    var _aeExpanded = trip._ui.arrivalExpanded === true ||
                      (trip._ui.arrivalExpanded === undefined && _aeNeverSet);
    if (!_aeExpanded) {
      var sumRow = document.createElement('div');
      sumRow.style.cssText = 'margin:0 2px 12px;padding:9px 14px;background:var(--c-panel);border:1px solid #e6e2d8;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:12px;color:#444;';
      var sumIcon = document.createElement('span');
      sumIcon.style.cssText = 'flex-shrink:0;color:var(--c-ink-3);font-size:14px;';
      // FN.A.2: mode-aware glyph for the collapsed line. _modeGlyph
      // lives in index.html and returns ✈ as a safe fallback when the
      // helper isn't loaded yet (early init paths).
      var _aeMG = (typeof global._modeGlyph === 'function') ? global._modeGlyph : function(){ return '✈'; };
      var _aeEntryGlyph = _aeMG(_aeCurEntryMode);
      var _aeExitGlyph  = _aeMG(_aeCurExitMode);
      var _aeShowBoth = _aeCurEntryMode && _aeCurExitMode && _aeCurEntryMode !== _aeCurExitMode;
      sumIcon.textContent = _aeShowBoth ? (_aeEntryGlyph + ' ' + _aeExitGlyph) : _aeEntryGlyph;
      if (_aeShowBoth) sumIcon.title = 'Arriving by ' + _aeCurEntryMode + ', departing by ' + _aeCurExitMode;
      var sumText = document.createElement('div');
      sumText.style.cssText = 'flex:1;min-width:0;';
      var aeED = (trip.brief && trip.brief.entryDetails) || {};
      var aeXD = (trip.brief && trip.brief.exitDetails)  || {};
      function _flightFrag(d) {
        var bits = [];
        if (d.carrier) bits.push(d.carrier);
        if (d.number)  bits.push(d.number);
        if (d.time && typeof global._fmtTime12h === 'function') bits.push(global._fmtTime12h(d.time));
        else if (d.time) bits.push(d.time);
        return bits.length ? ' (' + bits.join(' · ') + ')' : '';
      }
      sumText.innerHTML =
        '<strong style="color:#222;">Arriving</strong> ' + (_aeCurEntry || '?').replace(/</g,'&lt;') + _flightFrag(aeED) +
        ' · <strong style="color:#222;">Departing</strong> ' + (_aeCurExit || '?').replace(/</g,'&lt;') + _flightFrag(aeXD);
      var sumChev = document.createElement('span');
      sumChev.style.cssText = 'flex-shrink:0;color:var(--c-ink-3);font-size:12px;';
      sumChev.textContent = '⌄';
      sumRow.appendChild(sumIcon);
      sumRow.appendChild(sumText);
      sumRow.appendChild(sumChev);
      sumRow.title = 'Click to edit arrival / departure';
      sumRow.onclick = function () {
        trip._ui.arrivalExpanded = true;
        if (typeof global.drawTripMode === 'function') global.drawTripMode();
      };
      container.appendChild(sumRow);
      return;
    }

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
    var esc = function(s){ return _escHtml(s); };
    function summaryLine(label, d) {
      var bits = [];
      if (d.carrier) bits.push(d.carrier);
      if (d.number)  bits.push(d.number);
      if (d.time && typeof global._fmtTime12h === "function") bits.push(global._fmtTime12h(d.time));
      else if (d.time) bits.push(d.time);
      if (!bits.length) return "";
      return '<span style="margin-right:8px;"><strong style="color:var(--c-ink-2);">' + label + ':</strong> ' + bits.join(" · ") + '</span>';
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

    // ───── Round FN.B.2: "Max suggests" propose-and-explain card ─────
    // Rank gateways by mode + distance to anchor destination (first
    // destination for arrival, last for departure). Top result is
    // Max's lead suggestion with a one-line reasoning; the rest become
    // collapsible alternatives. Click "Use ___" fills the input and
    // triggers Apply through the existing button (no duplicated
    // rebuild logic). Card hides when there are no ranked gateways —
    // happens on first render before the region fetch completes, on
    // drive mode (no gateway concept), or in regions the LLM returned
    // no entry points for.
    var _gwRankFn = (typeof global._rankGatewaysForTrip === "function") ? global._rankGatewaysForTrip : null;
    var _gwWhyFn  = (typeof global._gatewayWhy === "function") ? global._gatewayWhy : function(){ return ""; };
    var _gwGlyphFn = (typeof global._modeGlyph === "function") ? global._modeGlyph : function(){ return "✈"; };
    var _gwEntryModeForCard = (trip.brief && trip.brief.entryMode) || "fly";
    var _gwExitModeForCard  = (trip.brief && trip.brief.exitMode)  || "fly";
    var _gwAnchorEntry = (trip.destinations || [])[0] || null;
    var _gwAnchorExit  = (trip.destinations || [])[(trip.destinations || []).length - 1] || null;
    var _gwEntryRanked = _gwRankFn ? _gwRankFn(_epPts, _gwEntryModeForCard, _gwAnchorEntry) : [];
    var _gwExitRanked  = _gwRankFn ? _gwRankFn(_epPts, _gwExitModeForCard,  _gwAnchorExit)  : [];

    function _gwSideHtml(side, ranked, anchor, curValue, mode){
      if (!ranked.length) return "";
      var top = ranked[0];
      var rest = ranked.slice(1, 4); // up to 3 alternatives
      var curNorm = String(curValue || "").toLowerCase().trim();
      var isAccepted = curNorm === String(top.name || "").toLowerCase().trim();
      var glyph = _gwGlyphFn(mode);
      var anchorName = anchor ? (anchor.place || "your trip") : "your trip";
      var sideLabel = side === "entry" ? "For your arrival" : "For your departure";
      var topWhy = _gwWhyFn(top, anchorName);
      var html = ''
        + '<div data-gw-section="' + side + '" style="margin-bottom:' + (rest.length ? '10px' : '4px') + ';">'
        +   '<div style="font-size:10.5px;color:#777;margin-bottom:4px;">' + sideLabel + '</div>'
        +   '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:#222;">'
        +     '<strong style="font-size:13px;">' + glyph + ' ' + esc(top.name) + '</strong>'
        +     '<span style="color:#777;font-size:11px;">' + esc(topWhy) + '</span>';
      if (isAccepted) {
        html += '<span style="color:#3a7a4a;font-size:11px;font-weight:600;">✓ accepted</span>';
      } else {
        html += '<button type="button" data-gw-action="use" data-gw-side="' + side
             +  '" data-gw-name="' + esc(top.name)
             +  '" style="font-size:10.5px;font-weight:600;color:var(--c-on-dark);background:var(--c-primary);border:none;border-radius:4px;padding:3px 9px;cursor:pointer;font-family:inherit;">'
             +  'Use ' + esc(top.name)
             +  '</button>';
      }
      html += '</div>';
      if (rest.length) {
        html += '<div style="margin-top:5px;">'
             +  '<a href="#" data-gw-action="show-alts" data-gw-side="' + side
             +  '" style="font-size:10.5px;color:var(--c-primary);text-decoration:none;font-weight:600;">'
             +  '▾ ' + rest.length + ' other ' + (rest.length === 1 ? 'option' : 'options')
             +  '</a>'
             +  '<div data-gw-alts="' + side + '" style="display:none;margin-top:6px;padding-left:8px;border-left:2px solid #d8e2f0;">';
        for (var i = 0; i < rest.length; i++) {
          var alt = rest[i];
          var altWhy = _gwWhyFn(alt, anchorName);
          var altAccepted = curNorm === String(alt.name || "").toLowerCase().trim();
          html += '<div style="font-size:11.5px;color:#333;margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
               +    '<strong>' + esc(alt.name) + '</strong>'
               +    '<span style="color:var(--c-ink-3);font-size:10.5px;">' + esc(altWhy) + '</span>';
          if (altAccepted) {
            html += '<span style="color:#3a7a4a;font-size:10.5px;font-weight:600;">✓ accepted</span>';
          } else {
            html += '<button type="button" data-gw-action="use" data-gw-side="' + side
                 +  '" data-gw-name="' + esc(alt.name)
                 +  '" style="font-size:10px;font-weight:600;color:var(--c-primary);background:var(--c-bg);border:1px solid var(--c-primary);border-radius:3px;padding:2px 7px;cursor:pointer;font-family:inherit;">Use</button>';
          }
          html += '</div>';
        }
        html += '</div></div>';
      }
      html += '</div>';
      return html;
    }

    var _gwEntryCardHtml = _gwSideHtml("entry", _gwEntryRanked, _gwAnchorEntry, curEntry, _gwEntryModeForCard);
    var _gwExitCardHtml  = _gwSideHtml("exit",  _gwExitRanked,  _gwAnchorExit,  curExit,  _gwExitModeForCard);
    var _gwCardHtml = "";
    if (_gwEntryCardHtml || _gwExitCardHtml) {
      _gwCardHtml = ''
        + '<div id="tm-max-suggests" style="margin-top:12px;padding:12px 14px;background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:7px;">'
        +   '<div style="font-size:11px;font-weight:700;color:var(--c-primary);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px;">✦ Max suggests</div>'
        +   _gwEntryCardHtml
        +   _gwExitCardHtml
        + '</div>';
    }
    // ───────────────────────────────────────────────────────────────

    aeRow.innerHTML = ''
      + (missing
          ? '<div style="font-size:11px;font-weight:700;color:#a06010;margin-bottom:8px;">⚠ Set arrival and departure to lock in the calendar</div>'
          : '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#777;margin-bottom:8px;">Arrival / Departure</div>'
        )
      + _datalistHtml
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      +   '<label style="font-size:11px;color:var(--c-ink-2);display:flex;align-items:center;gap:5px;">Arriving at'
      +     '<input id="tm-entry-inp" placeholder="e.g. Zurich" list="tm-arrdep-suggestions" autocomplete="off" value="' + esc(curEntry) + '" style="font-size:14px;padding:8px 10px;border:1px solid var(--c-border-strong);border-radius:4px;width:160px;max-width:100%;font-family:inherit;flex:1;min-width:140px;" />'
      +   '</label>'
      +   '<label style="font-size:11px;color:var(--c-ink-2);display:flex;align-items:center;gap:5px;">Departing from'
      +     '<input id="tm-exit-inp" placeholder="e.g. Zurich" list="tm-arrdep-suggestions" autocomplete="off" value="' + esc(curExit) + '" style="font-size:14px;padding:8px 10px;border:1px solid var(--c-border-strong);border-radius:4px;width:160px;max-width:100%;font-family:inherit;flex:1;min-width:140px;" />'
      +   '</label>'
      +   '<button id="tm-arrdep-apply" class="btn btn-primary btn-sm">Apply</button>'
      +   '<span id="tm-arrdep-status" style="font-size:10px;color:var(--c-ink-3);"></span>'
      + '</div>'
      + _gwCardHtml
      + '<div style="margin-top:10px;border-top:1px dashed #d8d4c8;padding-top:8px;">'
      +   '<button id="tm-logistics-toggle" type="button" onclick="_toggleLogistics(&#39;trip&#39;)" style="font-size:11px;color:var(--c-primary);background:none;border:none;padding:2px 0;cursor:pointer;font-family:inherit;font-weight:600;">'
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
    // v360.1 (slice 2a): collapse affordance — small "▴ Hide" pill
    // pinned to the top-right of the expanded panel so the user can
    // close it back to the summary line once the fields are set.
    // Only shown when entry+exit are both filled, otherwise the form
    // is the primary task and collapsing would hide work-in-progress.
    if (_aeCurEntry && _aeCurExit) {
      var hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.textContent = '▴ Hide';
      hideBtn.title = 'Collapse arrival/departure to the summary line';
      hideBtn.style.cssText =
        'position:absolute;top:8px;right:10px;' +
        'background:transparent;border:none;color:#888;font:600 10.5px inherit;' +
        'cursor:pointer;padding:2px 6px;';
      hideBtn.onclick = function () {
        trip._ui.arrivalExpanded = false;
        if (typeof global.drawTripMode === 'function') global.drawTripMode();
      };
      aeRow.style.position = 'relative';
      aeRow.appendChild(hideBtn);
    }
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
          // v359.60.15: clicking Apply with the same values used to
          // print a near-invisible "No change." in gray under the
          // button — easy to miss, reads as broken. Now show a
          // friendly green confirmation so the user knows the action
          // was registered AND that the current value is correct.
          // v359.60.16: Apply with unchanged values ALSO ensures the
          // arrival city is destination #1 and the departure city is
          // last (or first AND last for a round trip). Previously the
          // ordering was set once at Choreograph time and could drift
          // (e.g., user added destinations afterward, or the LLM put
          // a south-coast town at #1 instead of the gateway city).
          // Apply re-asserts the order without needing a full rebuild.
          var reorderedCount = 0;
          if (typeof _reorderTripByEntryExit === "function") {
            reorderedCount = _reorderTripByEntryExit(newEntry, newExit);
          }
          if (reorderedCount > 0) {
            if (typeof global.autoSave === "function") global.autoSave();
            if (typeof global.drawTripMode === "function") global.drawTripMode();
          }
          if (statusEl) {
            statusEl.style.color = "#1a8a3a";
            statusEl.style.fontWeight = "600";
            var parts = [];
            if (newEntry) parts.push("arrival " + newEntry);
            if (newExit && newExit !== newEntry) parts.push("departure " + newExit);
            var baseMsg = "✓ Confirmed — " + (parts.length ? parts.join(" + ") : "(no city set)");
            statusEl.textContent = reorderedCount > 0
              ? baseMsg + " (reordered " + reorderedCount + " stop" + (reorderedCount === 1 ? "" : "s") + ")"
              : baseMsg;
            // Fade after 4s so subsequent edits don't compete with a
            // stale confirmation message.
            setTimeout(function(){
              if (statusEl && statusEl.textContent.indexOf("Confirmed") === 0) {
                statusEl.style.color = "";
                statusEl.style.fontWeight = "";
                statusEl.textContent = "";
              }
            }, 4000);
          }
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
          // v359.60.16: enforce entry/exit ordering after rebuild. The
          // rebuild path through orderKeptCandidates is SUPPOSED to put
          // the entry city first, but in practice it sometimes drifts
          // (date-sorted output beats the entry hint). Explicit reorder
          // as a safety net.
          if (typeof _reorderTripByEntryExit === "function") {
            _reorderTripByEntryExit(newEntry, newExit);
          }
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
      // FN.B.2 / FN.B.3: wire "Use ___" buttons and "▾ alternatives"
      // toggles on the Max-suggests card. The Use-click does NOT go
      // through Apply — Apply calls buildFromCandidates which inserts
      // the entry/exit as a destination in the spine. That's the
      // right behavior when the user types a destination name, but
      // wrong for gateway acceptance: KEF is a transit point, not a
      // place you sleep. So we write trip.brief.entry / tbExit
      // directly and re-render. The existing destinations array stays
      // intact; updateMainMap's gateway-resolution layer detects that
      // brief.entry doesn't name-match any destination and renders a
      // separate gateway pin with a connector.
      var _gwUseBtns = aeRow.querySelectorAll('[data-gw-action="use"]');
      _gwUseBtns.forEach(function(btn){
        btn.addEventListener('click', function(){
          var side = btn.getAttribute('data-gw-side');
          var name = btn.getAttribute('data-gw-name') || "";
          var inp = (side === "entry") ? entryInp : exitInp;
          if (inp) { inp.value = name; }
          if (!trip.brief) trip.brief = {};
          if (side === "entry") trip.brief.entry = name;
          else                  trip.brief.tbExit = name;
          // Mirror to _tb so subsequent operations that read from it
          // (logistics form, Apply if the user clicks it next) see the
          // same value.
          var tbMirror = global._tb || (global._tb = {});
          if (side === "entry") tbMirror.entry = name;
          else                  tbMirror.tbExit = name;
          if (statusEl) {
            statusEl.style.color = "#3a7a4a";
            statusEl.style.fontWeight = "600";
            statusEl.textContent = "✓ " + (side === "entry" ? "Arrival" : "Departure") + " set to " + name;
            setTimeout(function(){
              if (statusEl && /^✓ /.test(statusEl.textContent || "")) {
                statusEl.style.color = ""; statusEl.style.fontWeight = "";
                statusEl.textContent = "";
              }
            }, 4000);
          }
          if (typeof global.autoSave === "function") { try { global.autoSave(); } catch (_) {} }
          // Keep the panel expanded after a Use click so the user can
          // see the suggestion morph into "✓ accepted" + adjust the
          // other side without re-clicking the summary row.
          if (!trip._ui) trip._ui = {};
          trip._ui.arrivalExpanded = true;
          if (typeof global.drawTripMode === "function") global.drawTripMode();
          // drawTripMode redraws the left-panel content; updateMainMap
          // redraws the right-panel Leaflet map. Both have to fire so
          // the new gateway pin appears alongside the morph of the
          // suggests card. (Apply's rebuild path indirectly triggers
          // updateMainMap via publishTrip; the no-rebuild Use-click
          // path doesn't, so we call it explicitly.)
          if (typeof global.updateMainMap === "function") global.updateMainMap();
        });
      });
      var _gwAltLinks = aeRow.querySelectorAll('[data-gw-action="show-alts"]');
      _gwAltLinks.forEach(function(link){
        link.addEventListener('click', function(e){
          e.preventDefault();
          var side = link.getAttribute('data-gw-side');
          var altsBox = aeRow.querySelector('[data-gw-alts="' + side + '"]');
          if (!altsBox) return;
          var shown = altsBox.style.display !== "none";
          altsBox.style.display = shown ? "none" : "block";
          // Swap caret only; preserve the rest of the label text.
          var txt = link.textContent || "";
          link.textContent = (shown ? "▾" : "▴") + txt.substring(1);
        });
      });
    }, 0);
  }

  // ── v360.4 (#124 follow-up): Traveler Profile panel ───────
  // Surfaces the user's ambient Traveler Profile on the trip page
  // — the "how you generally travel" context that Max applies to
  // every trip. Reads from MaxDB.prefs for global defaults and
  // from trip.brief.profileOverrides for per-trip tweaks. Each
  // edit defaults to per-trip; the "Save to my profile too" link
  // lets the user push the change up to the global profile.
  //
  // First-time vs returning copy switches based on whether ANY
  // traveler-profile field has been set globally yet:
  //   first time:  "Before we get into [destination], how do you
  //                generally travel? Max will remember these
  //                across all your trips. Fill them out once,
  //                update them anytime."
  //   returning:   "Max understands this is how you usually travel.
  //                Tune them for this trip only, or update your
  //                profile to change them from now on."
  //
  // Renders right under the Arrival/Departure panel. Collapsed by
  // default once the profile has been set; expanded by default
  // for first-time users so they see the form on first encounter
  // inside a trip (per Neal's decision: profile is NOT the first
  // thing on a brand-new app session, but the first trip should
  // surface it prominently).
  function _renderTravelerProfilePanel(trip, container) {
    if (!container || !trip) return;
    if (!Array.isArray(trip.destinations) || !trip.destinations.length) return;

    var prefs = (global.MaxDB && global.MaxDB.prefs) ? global.MaxDB.prefs : null;
    function pget(k){ try { return prefs ? prefs.get(k) : null; } catch(_) { return null; } }
    function pset(k, v){ try { if (prefs) prefs.set(k, v); } catch(_) {} }

    // Detect first-time: ONLY cross-trip Traveler Profile fields the
    // user has deliberately shaped. paceHours + sightsPerDay are
    // seeded by the welcome onboarding on first sign-in, and
    // transport is a per-trip field (not Traveler Profile), so
    // none of those count toward "have they shaped a profile."
    // See matching detection in renderTripStep1Place (index.html).
    var hasAnyProfileData = !!(
      pget("mobility") || (pget("accommodation") && String(pget("accommodation")).trim()) ||
      pget("paceMode") ||
      (pget("avoidOtherDefaults") && String(pget("avoidOtherDefaults")).trim())
    );
    var firstTime = !hasAnyProfileData;

    if (!trip.brief) trip.brief = {};
    if (!trip.brief.profileOverrides) trip.brief.profileOverrides = {};
    var po = trip.brief.profileOverrides;
    if (!trip._ui) trip._ui = {};

    function effective(key, fallback){
      var v = po[key];
      if (v !== undefined && v !== null && v !== "") return v;
      // v360.4: fall through to trip.brief.<key> for fields the
      // editors write directly (hardlimits, avoidOther, etc.) before
      // landing on the global default. Without this the panel can
      // show "Not set" for a field the user already set in the
      // editor.
      if (trip.brief && trip.brief[key] != null && trip.brief[key] !== "") {
        return trip.brief[key];
      }
      return fallback;
    }
    function isOverride(key){
      var v = po[key];
      if (v !== undefined && v !== null && v !== "") return true;
      // Also treat a trip.brief.<key> value as an override if the
      // global default differs.
      if (trip.brief && trip.brief[key] != null && trip.brief[key] !== "") {
        return true;
      }
      return false;
    }

    var mobLabels = {fit:"Fit and active", moderate:"Moderate", limited:"Limited walking", elderly:"Elderly", mobility:"Mobility aid", other:"Other"};
    var paceLabels = {loose:"Relaxed", enough:"Balanced", notmuch:"Intense"};
    var mobOptions = [["fit","Fit and active"],["moderate","Moderate"],["limited","Limited walking"],["elderly","Elderly"],["mobility","Mobility aid"],["other","Other"]];
    var paceOptions = [["loose","Relaxed"],["enough","Balanced"],["notmuch","Intense"]];

    // Field defs: each declares how to read effective value, display it,
    // and edit it. `prefKey` is the MaxDB.prefs key (often the same as
    // the override key; differs for `avoidOther` which writes to
    // `avoidOtherDefaults` globally).
    // v360.4: ambient panel field set expanded to match the full
    // Traveler Profile captured in welcome + editors + Settings.
    // Fields with custom controls in the editors (soft-avoidance
    // chips, pace radios) fall through to simpler inline editors
    // here — the panel is a summary, the editors are where the
    // rich controls live.
    var fields = [
      { key:"mobility", prefKey:"mobility", label:"Mobility of the slowest member", type:"select", options:mobOptions,
        display:function(v){ return v ? (mobLabels[v] || v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultMobility === "function") ? global._defaultMobility() : ""; } },
      // v360.4: usual party. Number-editable inline. The kids checkbox
      // appends to display ("2 travelers, with kids") but isn't editable
      // here — toggle that from Settings or the trip editor. Display
      // matches what welcome captures.
      { key:"travelersCount", prefKey:"travelersCount", label:"How many travelers?", type:"number", min:1, max:40, step:1,
        display:function(v){
          var n = (v != null && v !== "") ? v : "?";
          var kidsRaw = pget("withKids");
          var kids = (kidsRaw === true || kidsRaw === "true" || kidsRaw === 1 || kidsRaw === "1");
          return n + " traveler" + (n === 1 ? "" : "s") + (kids ? ", with kids" : "");
        },
        defaultGetter:function(){
          var v = pget("travelersCount");
          var n = parseInt(v, 10);
          return (isFinite(n) && n >= 1 && n <= 40) ? n : 2;
        } },
      { key:"accommodation", prefKey:"accommodation", label:"Where you'd like to stay", type:"text", placeholder:"e.g. Small family hotels, en suite required",
        display:function(v){ return v && String(v).trim() ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultAccommodation === "function") ? global._defaultAccommodation() : ""; } },
      { key:"paceHours", prefKey:"paceHours", label:"Hours of sightseeing per day", type:"number", min:2, max:10, step:1,
        display:function(v){ return v != null && v !== "" ? (v + (v === 1 ? " hour" : " hours")) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultHoursPerDay === "function") ? global._defaultHoursPerDay() : 6; } },
      { key:"sightsPerDay", prefKey:"sightsPerDay", label:"Max big sights per day", type:"number", min:1, max:6, step:1,
        display:function(v){ return v != null && v !== "" ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultMaxBigSightsPerDay === "function") ? global._defaultMaxBigSightsPerDay() : 2; } },
      { key:"paceMode", prefKey:"paceMode", label:"Default pace", type:"select", options:paceOptions,
        display:function(v){ return v ? (paceLabels[v] || v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultPaceMode === "function") ? global._defaultPaceMode() : "enough"; } },
      { key:"dayTripHours", prefKey:"dayTripHours", label:"Max drive time for a day trip", type:"number", min:1, max:6, step:0.5,
        display:function(v){ return v != null && v !== "" ? (v + (v === 1 ? " hour" : " hours")) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultDayTripHours === "function") ? global._defaultDayTripHours() : 3; } },
      { key:"hardlimits", prefKey:"hardLimits", label:"Hard limits", type:"text", placeholder:"e.g. No car rentals. Vegetarian.",
        display:function(v){ return v && String(v).trim() ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultHardLimits === "function") ? global._defaultHardLimits() : ""; } },
      { key:"avoidOther", prefKey:"avoidOtherDefaults", label:"Anything you'd like to avoid?", type:"text", placeholder:"e.g. Crowds, group tours, very early starts",
        display:function(v){
          // Combine soft-avoidance chips + free-form into one summary
          // line. Both come from MaxDB.prefs; chips from avoidDefaults,
          // free-form from avoidOtherDefaults. Display read-only here;
          // editing chips happens in the full editor.
          var chipLabels = {altitude:"high altitude", crowds:"crowds", heat:"extreme heat", cold:"extreme cold", longDrives:"long drives"};
          var chips = pget("avoidDefaults") || {};
          var picks = Object.keys(chips).filter(function(k){ return chips[k]; }).map(function(k){ return chipLabels[k] || k; });
          var other = v && String(v).trim() ? String(v).trim() : "";
          if (other) picks.push(other);
          return picks.length ? picks.join(", ") : "Not set";
        },
        defaultGetter:function(){ return pget("avoidOtherDefaults") || ""; } },
      // v360.4: Personal & medical — same five fields the editors
      // capture under their "Personal & medical" sub-section.
      { key:"dietary", prefKey:"dietary", label:"Dietary restrictions", type:"text", placeholder:"e.g. vegetarian; tree-nut allergy",
        display:function(v){ return v && String(v).trim() ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultDietary === "function") ? global._defaultDietary() : ""; } },
      { key:"languages", prefKey:"languages", label:"Languages you speak", type:"text", placeholder:"e.g. English, conversational French",
        display:function(v){ return v && String(v).trim() ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultLanguages === "function") ? global._defaultLanguages() : ""; } },
      { key:"allergies", prefKey:"allergies", label:"Allergies / medical", type:"text", placeholder:"e.g. peanut, shellfish, penicillin",
        display:function(v){ return v && String(v).trim() ? String(v) : "Not set"; },
        defaultGetter:function(){ return (typeof global._defaultAllergies === "function") ? global._defaultAllergies() : ""; } },
      // v360.4: combined emergency contact row — displays both name
      // and phone together. Inline editor edits the name; full
      // editing of both is in Settings / trip editor's Personal &
      // medical sub-section.
      { key:"emergencyContactName", prefKey:"emergencyContactName", label:"Emergency contact", type:"text", placeholder:"Name",
        display:function(v){
          var name = (v && String(v).trim()) ? String(v).trim() : "";
          var phoneRaw = pget("emergencyContactPhone");
          var phone = (phoneRaw && String(phoneRaw).trim()) ? String(phoneRaw).trim() : "";
          if (!name && !phone) return "Not set";
          if (name && phone) return name + " · " + phone;
          return name || phone;
        },
        defaultGetter:function(){ return (typeof global._defaultEmergencyName === "function") ? global._defaultEmergencyName() : ""; } },
      { key:"loyaltyPrograms", prefKey:"loyaltyPrograms", label:"Loyalty programs", type:"text", placeholder:"e.g. United MileagePlus 12345678",
        display:function(v){
          if (!v || !String(v).trim()) return "Not set";
          // Multiple lines — show first line + count of others as summary.
          var lines = String(v).split(/\n+/).filter(function(l){ return l.trim(); });
          if (lines.length === 1) return lines[0];
          return lines[0] + " · +" + (lines.length - 1) + " more";
        },
        defaultGetter:function(){ return (typeof global._defaultLoyaltyPrograms === "function") ? global._defaultLoyaltyPrograms() : ""; } }
    ];

    // Default expanded state: expanded if first-time; otherwise
    // honor the user's last toggle, defaulting to collapsed.
    var expanded;
    if (trip._ui.travelerProfileExpanded === true) expanded = true;
    else if (trip._ui.travelerProfileExpanded === false) expanded = false;
    else expanded = firstTime;

    var panel = document.createElement("div");
    panel.style.cssText = "margin:0 2px 12px;background:#fbf8f1;border:1px solid #e6dec8;border-radius:8px;font-size:12px;color:#3a3528;";

    // Header (always visible)
    var hdr = document.createElement("div");
    hdr.style.cssText = "padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;";
    var hdrIcon = document.createElement("span");
    hdrIcon.style.cssText = "flex-shrink:0;color:#7a5b3a;font-size:14px;";
    hdrIcon.textContent = "🧭";
    var hdrText = document.createElement("div");
    hdrText.style.cssText = "flex:1;min-width:0;";
    var titleStr = firstTime ? "Tell Max how you generally travel" : "Your traveler profile";
    hdrText.innerHTML = '<strong style="color:#3a2e1a;">' + titleStr + '</strong>';
    var hdrChev = document.createElement("span");
    hdrChev.style.cssText = "flex-shrink:0;color:#7a5b3a;font-size:12px;";
    hdrChev.textContent = expanded ? "⌃" : "⌄";
    hdr.appendChild(hdrIcon);
    hdr.appendChild(hdrText);
    hdr.appendChild(hdrChev);
    hdr.onclick = function(){
      trip._ui.travelerProfileExpanded = !expanded;
      if (typeof global.drawTripMode === "function") global.drawTripMode();
    };

    // When collapsed, render a one-line summary of the most salient
    // fields next to the chevron so the user can see what's set
    // without expanding.
    if (!expanded) {
      var sumBits = [];
      var mobV = effective("mobility", fields[0].defaultGetter());
      if (mobV) sumBits.push(mobLabels[mobV] || mobV);
      var paceV = effective("paceMode", fields[1].defaultGetter());
      if (paceV) sumBits.push(paceLabels[paceV] || paceV);
      var hpdV = effective("paceHours", fields[2].defaultGetter());
      if (hpdV != null) sumBits.push(hpdV + " hrs/day");
      var spdV = effective("sightsPerDay", fields[3].defaultGetter());
      if (spdV != null) sumBits.push(spdV + " big sights/day");
      if (sumBits.length) {
        hdrText.innerHTML += ' <span style="color:#7a5b3a;font-weight:400;"> · ' + sumBits.join(" · ").replace(/</g, "&lt;") + '</span>';
      }
    }
    panel.appendChild(hdr);

    if (!expanded) {
      container.appendChild(panel);
      return;
    }

    // Body — visible when expanded.
    var body = document.createElement("div");
    body.style.cssText = "padding:0 14px 12px;";

    // Hint copy — first-time or returning. v360.4: context-agnostic
    // first-time copy works for new-trip and edit-existing-trip flows.
    var hint = document.createElement("div");
    hint.style.cssText = "margin:0 0 12px;padding:10px 12px;background:var(--c-bg);border:1px dashed #d6c8a8;border-radius:6px;font-size:11.5px;line-height:1.55;color:#5a4a2a;";
    if (firstTime) {
      hint.innerHTML = "How do you generally travel? Max will remember these across all your trips. " +
        "Fill them out once, update them anytime.";
    } else {
      hint.innerHTML = "Max understands this is how you usually travel. " +
        "Tune them for this trip only, or update your profile to change them from now on.";
    }
    body.appendChild(hint);

    // Field list.
    var list = document.createElement("div");
    list.style.cssText = "display:grid;grid-template-columns:1fr;gap:0;";

    fields.forEach(function(f, fi){
      var row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center;padding:7px 6px;border-bottom:1px " + (fi === fields.length - 1 ? "solid transparent" : "dashed #e6dec8") + ";";

      var labelEl = document.createElement("div");
      labelEl.style.cssText = "font-size:11.5px;font-weight:600;color:#3a2e1a;";
      labelEl.textContent = f.label;
      row.appendChild(labelEl);

      var valWrap = document.createElement("div");
      valWrap.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0;";

      var curVal = effective(f.key, f.defaultGetter());
      var overridden = isOverride(f.key);

      var valBtn = document.createElement("button");
      valBtn.type = "button";
      valBtn.style.cssText = "background:transparent;border:none;padding:3px 0;text-align:left;font-family:inherit;font-size:12px;color:" +
        (overridden ? "#6a4f1a" : "#222") + ";" +
        "cursor:pointer;font-weight:" + (overridden ? "600" : "500") + ";font-style:" + (overridden ? "italic" : "normal") + ";" +
        "text-decoration:underline dotted;text-underline-offset:3px;";
      valBtn.textContent = f.display(curVal);
      valBtn.title = "Click to edit";
      valWrap.appendChild(valBtn);

      if (overridden) {
        var ovBadge = document.createElement("span");
        ovBadge.style.cssText = "font-size:10px;color:#7a5b3a;background:#f1e6cf;padding:1px 6px;border-radius:9px;";
        ovBadge.textContent = "this trip only";
        valWrap.appendChild(ovBadge);
        var resetLink = document.createElement("a");
        resetLink.href = "#";
        resetLink.style.cssText = "font-size:10.5px;color:#7a5b3a;text-decoration:none;";
        resetLink.textContent = "↺ use profile default";
        resetLink.onclick = function(e){
          e.preventDefault();
          delete po[f.key];
          if (typeof global.autoSave === "function") global.autoSave({ reason: "profileOverrideReset" });
          if (typeof global.drawTripMode === "function") global.drawTripMode();
        };
        valWrap.appendChild(resetLink);
      }

      row.appendChild(valWrap);

      // Inline editor (hidden until valBtn clicked).
      var editorWrap = document.createElement("div");
      editorWrap.style.cssText = "grid-column:1 / -1;display:none;margin-top:8px;padding:10px 12px;background:var(--c-bg);border:1px solid #d6c8a8;border-radius:6px;";

      valBtn.onclick = function(){
        if (editorWrap.style.display === "block") {
          editorWrap.style.display = "none";
          return;
        }
        editorWrap.innerHTML = "";
        editorWrap.style.display = "block";

        var inputEl;
        var initVal = effective(f.key, f.defaultGetter());
        if (f.type === "select") {
          inputEl = document.createElement("select");
          inputEl.style.cssText = "font-size:12px;padding:6px 8px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;width:100%;box-sizing:border-box;";
          var blank = document.createElement("option");
          blank.value = ""; blank.textContent = "— select —";
          inputEl.appendChild(blank);
          f.options.forEach(function(opt){
            var o = document.createElement("option");
            o.value = opt[0]; o.textContent = opt[1];
            if (opt[0] === initVal) o.selected = true;
            inputEl.appendChild(o);
          });
        } else if (f.type === "number") {
          inputEl = document.createElement("input");
          inputEl.type = "number";
          if (f.min != null) inputEl.min = String(f.min);
          if (f.max != null) inputEl.max = String(f.max);
          if (f.step != null) inputEl.step = String(f.step);
          inputEl.value = (initVal != null && initVal !== "") ? String(initVal) : "";
          inputEl.style.cssText = "font-size:12px;padding:6px 8px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;width:120px;box-sizing:border-box;";
        } else {
          inputEl = document.createElement("input");
          inputEl.type = "text";
          inputEl.value = (initVal != null) ? String(initVal) : "";
          if (f.placeholder) inputEl.placeholder = f.placeholder;
          inputEl.style.cssText = "font-size:12px;padding:6px 8px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;width:100%;box-sizing:border-box;";
        }
        editorWrap.appendChild(inputEl);

        function _commit(saveToProfile){
          var raw = inputEl.value;
          var v;
          if (f.type === "number") {
            v = parseFloat(raw);
            if (!isFinite(v)) v = null;
            if (v != null && f.min != null && v < f.min) v = f.min;
            if (v != null && f.max != null && v > f.max) v = f.max;
          } else if (f.type === "select") {
            v = raw || null;
          } else {
            v = (raw == null ? "" : String(raw).trim()) || null;
          }
          // Decide: per-trip override (always), and optionally global.
          if (saveToProfile) {
            // Push to global profile AND clear the per-trip override
            // (since global is now what the user wants everywhere).
            if (v == null || v === "") {
              pset(f.prefKey, "");
            } else {
              pset(f.prefKey, v);
            }
            delete po[f.key];
          } else {
            // Per-trip only.
            if (v == null || v === "") {
              delete po[f.key];
            } else {
              po[f.key] = v;
            }
          }
          if (typeof global.autoSave === "function") global.autoSave({ reason: "profileEdit" });
          if (typeof global.drawTripMode === "function") global.drawTripMode();
        }

        var btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;";

        var saveTripBtn = document.createElement("button");
        saveTripBtn.type = "button";
        saveTripBtn.style.cssText = "font-size:11.5px;font-weight:600;padding:6px 12px;border:1px solid var(--c-primary);background:var(--c-primary);color:var(--c-on-dark);border-radius:5px;cursor:pointer;font-family:inherit;";
        saveTripBtn.textContent = "Save for this trip";
        saveTripBtn.onclick = function(){ _commit(false); };
        btnRow.appendChild(saveTripBtn);

        var saveProfileBtn = document.createElement("button");
        saveProfileBtn.type = "button";
        saveProfileBtn.style.cssText = "font-size:11.5px;font-weight:500;padding:6px 12px;border:1px solid #d6c8a8;background:var(--c-bg);color:#5a4a2a;border-radius:5px;cursor:pointer;font-family:inherit;";
        saveProfileBtn.textContent = "Save to my profile too";
        saveProfileBtn.title = "Update your profile so this becomes the new default for future trips too.";
        saveProfileBtn.onclick = function(){ _commit(true); };
        btnRow.appendChild(saveProfileBtn);

        var cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.style.cssText = "font-size:11.5px;font-weight:500;padding:6px 10px;background:transparent;border:none;color:var(--c-ink-3);cursor:pointer;font-family:inherit;margin-left:auto;";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = function(){
          editorWrap.style.display = "none";
          editorWrap.innerHTML = "";
        };
        btnRow.appendChild(cancelBtn);

        editorWrap.appendChild(btnRow);

        // Focus the input.
        setTimeout(function(){ try { inputEl.focus(); if (typeof inputEl.select === "function") inputEl.select(); } catch(_) {} }, 0);
      };

      row.appendChild(editorWrap);
      list.appendChild(row);
    });

    body.appendChild(list);

    // Footer link: open the full Profile panel for everything not on
    // this short list (dietary, languages, emergency contact, units, etc.).
    var footer = document.createElement("div");
    footer.style.cssText = "margin-top:10px;padding-top:10px;border-top:1px dashed #e6dec8;display:flex;justify-content:flex-end;";
    var openFull = document.createElement("a");
    openFull.href = "#";
    openFull.style.cssText = "font-size:11px;color:var(--c-primary);text-decoration:none;font-weight:600;";
    openFull.textContent = "Open full profile →";
    openFull.title = "Edit all profile fields including dietary, languages, units, emergency contact, etc.";
    openFull.onclick = function(e){
      e.preventDefault();
      if (typeof global.showSettingsPanel === "function") global.showSettingsPanel();
    };
    footer.appendChild(openFull);
    body.appendChild(footer);

    panel.appendChild(body);
    container.appendChild(panel);
  }

  // Round NC.X: ⋯ overflow popover for trip-level secondary actions.
  // Anchors to the ⋯ button in the Destinations header. Holds the
  // items that used to be split between the inline "↺ Reverse" button
  // and the "More" disclosure: Tidy trip, Keep in mind, How Max
  // thinks, Reverse trip order. Built fresh on each open so item
  // availability (canTidy, canReverse) is always current. Clicks
  // outside the popover (or on the trigger again) close it.
  var _tmDestMorePopoverEl = null;
  var _tmDestMoreOutsideHandler = null;
  function _tmCloseTripDestMoreMenu() {
    if (_tmDestMorePopoverEl && _tmDestMorePopoverEl.parentNode) {
      _tmDestMorePopoverEl.parentNode.removeChild(_tmDestMorePopoverEl);
    }
    _tmDestMorePopoverEl = null;
    if (_tmDestMoreOutsideHandler) {
      document.removeEventListener("click", _tmDestMoreOutsideHandler, true);
      _tmDestMoreOutsideHandler = null;
    }
  }
  function _tmShowTripDestMoreMenu(trip, anchorBtn) {
    // Toggle: a second click on the trigger closes it.
    if (_tmDestMorePopoverEl) { _tmCloseTripDestMoreMenu(); return; }
    if (!trip || !anchorBtn) return;
    var dests = (trip && trip.destinations) || [];
    var _hubCount = 0, _sightCount = 0;
    dests.forEach(function (d) {
      if (!d) return;
      if ((d.nights || 0) >= 2) _hubCount++; else _sightCount++;
    });
    var canTidy    = _hubCount >= 1 && _sightCount >= 1;
    var canReverse = dests.length >= 3;

    var pop = document.createElement("div");
    pop.style.cssText =
      "position:absolute;z-index:11000;min-width:240px;max-width:320px;" +
      "background:#fff;border:1px solid #d8d4c8;border-radius:8px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,0.14);padding:4px 0;font-family:inherit;";
    // Anchor below + right-aligned with the ⋯ button. Use page-
    // relative coords so scroll containers don't clip the popover.
    var r = anchorBtn.getBoundingClientRect();
    pop.style.top  = (window.scrollY + r.bottom + 6) + "px";
    pop.style.left = (window.scrollX + r.right - 260) + "px";

    function _addItem(label, sub, onClick) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText =
        "display:flex;flex-direction:column;align-items:flex-start;gap:2px;" +
        "width:100%;text-align:left;padding:9px 14px;border:none;background:#fff;" +
        "cursor:pointer;font-family:inherit;color:#222;";
      var top = document.createElement("div");
      top.style.cssText = "font-size:12.5px;font-weight:600;";
      top.textContent = label;
      btn.appendChild(top);
      if (sub) {
        var s = document.createElement("div");
        s.style.cssText = "font-size:10.5px;color:var(--c-ink-3);line-height:1.4;";
        s.textContent = sub;
        btn.appendChild(s);
      }
      btn.onmouseover = function () { btn.style.background = "#faf8f1"; };
      btn.onmouseout  = function () { btn.style.background = "#fff"; };
      btn.onclick = function (e) {
        e.stopPropagation();
        _tmCloseTripDestMoreMenu();
        try { onClick(); } catch(_){}
      };
      pop.appendChild(btn);
    }

    if (canTidy) {
      _addItem(
        "🪄 Tidy trip",
        "Reshape " + _sightCount + " sight stop" + (_sightCount === 1 ? "" : "s") +
          " into day trips and waysides attached to your " + _hubCount +
          " overnight hub" + (_hubCount === 1 ? "" : "s") + ".",
        function () {
          if (typeof global._openTidyTripPreview === "function") global._openTidyTripPreview();
        }
      );
    }
    _addItem(
      "🔬 Keep in mind for your trip",
      "Links, reservations, reminders to look up.",
      function () {
        if (typeof global._pmEnsureResearchMeta === "function") global._pmEnsureResearchMeta();
        if (typeof global._pmOpenTripResearchCard === "function") global._pmOpenTripResearchCard();
      }
    );
    _addItem(
      "🌊 How Max thinks",
      "The wisp arc and the case for late binding.",
      function () {
        if (typeof global.showAboutMax === "function") global.showAboutMax();
      }
    );
    if (canReverse) {
      _addItem(
        "↺ Reverse trip order",
        "Flip the order of destinations.",
        function () {
          if (typeof global.reverseTripOrder === "function") global.reverseTripOrder();
        }
      );
    }

    document.body.appendChild(pop);
    _tmDestMorePopoverEl = pop;

    // Outside-click closes. Use capture so we beat any inner handlers
    // that stop propagation. Skip the anchor itself so its toggle
    // logic handles the close on a re-tap.
    _tmDestMoreOutsideHandler = function (e) {
      if (!_tmDestMorePopoverEl) return;
      if (_tmDestMorePopoverEl.contains(e.target)) return;
      if (anchorBtn && anchorBtn.contains(e.target)) return;
      _tmCloseTripDestMoreMenu();
    };
    // Defer one tick so the click that opened the menu doesn't
    // immediately close it.
    setTimeout(function(){
      if (_tmDestMoreOutsideHandler) {
        document.addEventListener("click", _tmDestMoreOutsideHandler, true);
      }
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
    // v360.1 (slice 1): slimmed to just title + totals. The six
    // controls that used to live here — + Destination, Tidy trip,
    // Keep in mind, Reverse order, Considered, Open Discovery — have
    // moved:
    //   - "+ Destination" stays accessible via the existing inline
    //     form at the bottom of the destination list (#tm-add-btn).
    //     That's where you'd naturally add the next destination —
    //     the redesign principle is "primary action at the end of
    //     the list."
    //   - Tidy / Keep in mind / Reverse / Considered / Open Discovery
    //     all moved into MaxTripUI.renderTripMore — a collapsed
    //     disclosure below the destinations. Tertiary controls
    //     shouldn't compete with the destination cards themselves.
    // The preferences panel below this section is kept as-is for now;
    // slice 2 will inline it into trip identity.
    var listSec = document.createElement("div");
    listSec.className = "tm-section";

    var dests = (trip && trip.destinations) || [];
    var totalNights = dests.reduce(function (s, d) { return s + (d.nights || 0); }, 0);
    var totalDays = totalNights + (dests.length ? 1 : 0);

    var listHdr = document.createElement("div");
    listHdr.style.cssText = "display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap;";

    var lbl = document.createElement("div");
    lbl.className = "tm-sec-title";
    lbl.style.cssText = "margin:0;font-size:18px;font-weight:700;color:var(--c-ink);letter-spacing:-.01em;";
    lbl.textContent = "Destinations";
    listHdr.appendChild(lbl);

    var totalLine = document.createElement("div");
    totalLine.style.cssText = "font-size:11px;color:#666;";
    // Honest split: overnight bases ("stays") vs zero-night visit-stops
    // ("sights"). "44 destinations" conflated 12 real stays with 32 sights.
    var _staysN = dests.filter(function (d) { return (d.nights || 0) > 0; }).length;
    var _sightsN = dests.length - _staysN;
    totalLine.innerHTML = dests.length
      ? '<strong style="color:var(--c-ink);">' + totalDays + ' days</strong> · ' + totalNights + ' nights · '
        + _staysN + ' stay' + (_staysN !== 1 ? 's' : '')
        + (_sightsN ? ' · ' + _sightsN + ' sight' + (_sightsN !== 1 ? 's' : '') : '')
      : '<span style="color:var(--c-ink-4);font-style:italic;">No destinations yet.</span>';
    listHdr.appendChild(totalLine);

    // Round NC.X: replaced the standalone "↺ Reverse trip order" button
    // (and the parallel "More" disclosure below the destinations list)
    // with a single ⋯ overflow button anchored to the destinations
    // header. The popover it opens carries every secondary action that
    // used to be split between the inline button and the disclosure:
    // Tidy trip, Keep in mind, How Max thinks, Reverse trip order.
    // One discoverable affordance instead of two parallel ones.
    var moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.setAttribute("aria-label", "Trip actions");
    moreBtn.title = "Trip actions — tidy, reverse, notes, more";
    moreBtn.style.cssText =
      "background:var(--c-bg);border:1px solid #d8d4c8;color:var(--c-ink-2);font-family:inherit;" +
      "font-size:16px;font-weight:600;line-height:1;padding:3px 11px;border-radius:5px;cursor:pointer;" +
      "margin-left:auto;flex-shrink:0;position:relative;";
    moreBtn.textContent = "⋯";
    moreBtn.onmouseover = function () { moreBtn.style.background = "#faf8f1"; };
    moreBtn.onmouseout  = function () { moreBtn.style.background = "#fff"; };
    moreBtn.onclick = function (e) {
      e.stopPropagation();
      _tmShowTripDestMoreMenu(trip, moreBtn);
    };
    listHdr.appendChild(moreBtn);

    listSec.appendChild(listHdr);

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
        banner.style.cssText = "margin:0 0 12px;padding:9px 12px;background:var(--c-panel);border:1px solid #ececec;border-radius:6px;font-size:11.5px;color:var(--c-ink-2);line-height:1.6;";
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
    // v359.60.52: destination number badge at the start of the card,
    // matching the numbered pin on the trip-overview map. Same color
    // logic as updateMainMap's pin: grey for 0-night ("see")
    // destinations, blue otherwise. Makes the card↔pin correspondence
    // immediate — the user can scan the list and find that pin without
    // hunting.
    // PD.342b: color system — BLUE = overnight stay, GREEN =
    // committed 0-night stop/visit. GRAY is reserved for undecided/
    // considered (unchecked) only, and never appears on committed
    // destinations. Matches MaxMapPin: stay pins blue, see pins green.
    var _isSee = (dest.nights || 0) === 0;
    var _badgeColor = _isSee ? "#2a7a4e" : "#1a5fa8";
    var numBadge = document.createElement("span");
    numBadge.className = "tm-dest-num";
    numBadge.textContent = String(idx + 1);
    numBadge.style.cssText = "flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:" + _badgeColor + ";color:#fff;font-size:11px;font-weight:700;letter-spacing:-0.02em;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,0.15);";
    // PD.342b: the color carries meaning — say so. Blue = overnight
    // stay, green = day stop. Gray is reserved for considered/unchecked.
    numBadge.title = "Destination " + (idx + 1) + " of " + (trip.destinations||[]).length
      + (_isSee ? " — day stop, no overnight (green, same as its map pin)"
                : " — overnight stay, " + dest.nights + " night" + (dest.nights === 1 ? "" : "s") + " (blue, same as its map pin)");
    nameRow.appendChild(numBadge);
    var nameEl=document.createElement("div"); nameEl.className="tm-dest-name";
    nameEl.style.cssText = "flex:1;min-width:0;font-size:17px;font-weight:700;color:var(--c-ink);line-height:1.25;letter-spacing:-0.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
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
      tag.style.cssText = "font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--c-ink-3);margin-bottom:3px;display:flex;align-items:center;gap:5px;";
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
        line.style.cssText = "font-size:11px;color:var(--c-ink-2);margin:1px 0 4px;line-height:1.45;";
        var html = bits.join(' · ');
        if (details.confirmation) {
          html += ' <span style="color:var(--c-ink-3);">conf. ' + details.confirmation + '</span>';
        }
        if (details.url) {
          var safeUrl = String(details.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          html += ' <a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" style="margin-left:6px;font-size:10px;color:var(--c-primary);text-decoration:none;font-weight:600;">↗ booking</a>';
        }
        if (details.notes) {
          html += '<div style="font-size:10.5px;color:var(--c-ink-3);margin-top:1px;">' + details.notes + '</div>';
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
      plLbl.style.cssText = "font-size:11px;color:var(--c-ink-3);margin-top:-2px;margin-bottom:4px;";
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
    datePencil.style.cssText = "font-size:11px;color:var(--c-ink-3);font-weight:400;margin-left:6px;";
    dates.appendChild(datePencil);
    dateLineWrap.appendChild(dates);
    dateLineWrap.appendChild(upBtn);
    dateLineWrap.appendChild(downBtn);
    bodyDiv.appendChild(dateLineWrap);

    // v360.3: per-card empty-day indicator. A "day" inside a
    // destination is empty when it has no scheduled items (neither
    // legacy day.items[] nor modern day.planItems[]). The aggregate
    // trip-wide panel above the destinations list rolls these up;
    // showing the count on each card tells the user WHICH stops
    // still need shaping. Only renders when count > 0 and the dest
    // has at least one night (a 0-night "see" stop has no day
    // structure to fill).
    if ((dest.nights || 0) > 0 && Array.isArray(dest.days) && dest.days.length) {
      var _emptyDays = 0;
      dest.days.forEach(function (day) {
        if (!day) return;
        var hasLegacy = Array.isArray(day.items) && day.items.length > 0;
        var hasPlan   = Array.isArray(day.planItems) && day.planItems.some(function (pi) {
          // Route refs alone don't count as "scheduled content" — the
          // route is auto-derived from adjacency. Stops, sights,
          // restaurants, etc. do count.
          return pi && pi.type !== "route";
        });
        if (!hasLegacy && !hasPlan) _emptyDays++;
      });
      if (_emptyDays > 0) {
        var emptyChip = document.createElement("div");
        emptyChip.style.cssText =
          "margin:4px 0 2px;font-size:10.5px;color:#8a7220;background:#fbf4dd;" +
          "border:1px solid #ead9a8;border-radius:10px;padding:2px 8px;" +
          "display:inline-block;letter-spacing:.01em;cursor:pointer;";
        emptyChip.textContent = "🔧 " + _emptyDays + " empty day" + (_emptyDays === 1 ? "" : "s");
        emptyChip.title = "Tap to open this destination and start filling these days.";
        (function (did) {
          emptyChip.onclick = function (e) {
            e.stopPropagation();
            if (typeof global.selectDest === "function") global.selectDest(did);
          };
        })(dest.id);
        bodyDiv.appendChild(emptyChip);
      }
    }

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

    // v359.52.2: day-trip chips on the dest card now sourced from v2
    // routes (kind:"dayTrip" with fromDestId === dest.id). Each
    // route's planItems[] is a list of type:"stop" entries — one per
    // day-trip target. Walk trip.routes[] for the relevant routes
    // and render a chip per stop. Click → ungroupDayTripByRouteStop
    // (v2 writer; see index.html). Legacy distance bookkeeping rides
    // on stop.legacy or route.distKm.
    // v3 Phase 2: use MaxMigration.isDayTripRoute (handles both v2's
    // route.kind === "dayTrip" and v3's route.subKind === "dayTrip").
    (function _renderDayTripChips(){
      var routes = (trip && Array.isArray(trip.routes)) ? trip.routes : [];
      if (!routes.length) return;
      var places = (trip && trip.places) || {};
      var _isDT = (typeof MaxMigration !== "undefined" && MaxMigration.isDayTripRoute)
        ? MaxMigration.isDayTripRoute
        : function(r){ return r && (r.subKind === "dayTrip" || r.kind === "dayTrip"); };
      var hubRoutes = routes.filter(function(r){
        return _isDT(r) && r.fromDestId === dest.id;
      });
      if (!hubRoutes.length) return;

      var dtRow = document.createElement("div");
      dtRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;align-items:center;";
      var dtLabel = document.createElement("span");
      dtLabel.style.cssText = "font-size:9px;font-weight:700;color:var(--c-ink-3);text-transform:uppercase;letter-spacing:0.05em;margin-right:2px;";
      dtLabel.textContent = "Day trips:";
      dtRow.appendChild(dtLabel);

      hubRoutes.forEach(function(route){
        (route.planItems || []).forEach(function(stop){
          if (!stop || stop.type !== "stop") return;
          var place = places[stop.placeId];
          var placeName = (place && place.name) || stop.placeId || "(unknown)";
          var distKm = (stop.legacy && stop.legacy.distKm)
            || (typeof route.distKm === "number" ? route.distKm : 0);
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
          (function(hubDest, routeRef, stopRef){
            chip.onclick = function(e){
              e.stopPropagation();
              if (typeof global.ungroupDayTripByRouteStop === "function") {
                global.ungroupDayTripByRouteStop(hubDest, routeRef, stopRef);
              } else {
                // v360.3 (#104): make this visible. The chip looks
                // tappable, the user taps it, nothing happens, no
                // signal anything went wrong. At minimum tell them.
                console.warn("[Max] ungroupDayTripByRouteStop not defined; chip click is a no-op");
                if (typeof global.showSaveStatus === "function") {
                  global.showSaveStatus("⚠ Day-trip action unavailable in this build — please reload.", 5000);
                }
              }
            };
          })(dest, route, stop);
          dtRow.appendChild(chip);
        });
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
        arrBtn.style.cssText = "font-size:10.5px;font-weight:500;color:var(--c-primary);background:var(--c-bg);border:1px solid var(--c-border-blue);border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;";
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
        depBtn.style.cssText = "font-size:10.5px;font-weight:500;color:var(--c-warn);background:var(--c-bg);border:1px solid #e8c8b0;border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;";
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

    // v359.51: "Change role" link now opens the in-place trip-view
    // role popover (same surface as the map-pin tap) instead of
    // re-routing through the picker. The conversion mutates trip
    // state directly via convertDestToDayTrip — the picker is no
    // longer required for overnight ↔ day-trip swaps once a trip
    // exists.
    (function(){
      var roleRow = document.createElement("div");
      roleRow.style.cssText = "display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:6px;";
      // v359.55.17: per-destination research card affordance on the
      // trip-view card. Opens the same popover the picker uses, but
      // makes sure _tb.placeMeta is populated from trip.brief first
      // (the user may not have entered the picker this session).
      // PD.411: notes affordance is now the shared bare 📓 icon (identical
      // to the Discovery row and the trip detail view) instead of the old
      // wide "📓 {place} notes" text button. One helper, one look,
      // everywhere. Falls back to a minimal inline button only if the
      // shared helper isn't present (older index.html).
      var researchBtn;
      if (typeof global._notesIconBtn === "function") {
        researchBtn = global._notesIconBtn(dest.place);
      } else {
        researchBtn = document.createElement("button");
        researchBtn.type = "button";
        researchBtn.textContent = "📓";
        researchBtn.title = "Notes for " + dest.place;
        researchBtn.style.cssText = "font-size:11px;color:var(--c-ink-3);background:var(--c-bg);border:1px solid var(--c-border);border-radius:9px;padding:1px 7px;cursor:pointer;font-family:inherit;line-height:1.3;";
        (function(placeName){
          researchBtn.onclick = function(e){
            e.preventDefault();
            e.stopPropagation();
            if (typeof global._pmEnsureResearchMeta === "function") global._pmEnsureResearchMeta();
            if (typeof global._pmOpenResearchCard === "function") global._pmOpenResearchCard(placeName);
          };
        })(dest.place);
      }
      roleRow.appendChild(researchBtn);
      var link = document.createElement("a");
      link.href = "#";
      link.textContent = "↺ Change role";
      link.title = "Switch overnight ↔ day trip without leaving the trip view";
      link.style.cssText = "font-size:10.5px;font-weight:500;color:var(--c-primary);text-decoration:none;cursor:pointer;";
      (function(destId, destPlace){
        link.onclick = function(e){
          e.preventDefault();
          e.stopPropagation();
          // v359.60.23: route through the unified _openTripStopPopover.
          // Same dialog for every stop type (destination / day-trip /
          // wayside); current role is marked and you can transition to
          // any of the others in one click.
          if (typeof global._openTripStopPopover === "function") {
            global._openTripStopPopover({ kind: "destination", destId: destId });
          } else if (typeof global._openTripDestRolePopover === "function") {
            global._openTripDestRolePopover(destId);
          } else {
            if (global._tb) global._tb._focusCandidateName = destPlace;
            if (typeof global.reopenPickerForEdit === "function" && trip && Array.isArray(trip.placeActivities) && trip.placeActivities.length) {
              global.reopenPickerForEdit();
            } else if (typeof global.reopenCandidateExplorer === "function") {
              global.reopenCandidateExplorer();
            }
          }
        };
      })(dest.id, dest.place);
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
    var arrow=document.createElement("span"); arrow.style.cssText="font-size:10px;color:var(--c-ink-4);margin:0 4px;"; arrow.textContent="→";
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
    if(dest.id===activeDest) openBtn.style.cssText="font-weight:600;border-color:#aac4e8;color:var(--c-primary);";
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
      // v360.3 (#104): data-attrs so _flashJustMovedTarget can address
      // a specific leg's chip after an overnight↔wayside conversion.
      chip2.setAttribute("data-from-dest", dest.id);
      chip2.setAttribute("data-to-dest",   next.id);
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
        var bkBadge=document.createElement("span"); bkBadge.style.cssText="font-size:9px;color:var(--c-see);font-weight:600;";
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
          unk.style.cssText="font-size:10px;color:var(--c-ink-3);";
          unk.textContent="⇄ finding options…";
        } else if(_cachedFail){
          unk.style.cssText="font-size:10px;color:var(--c-ink-4);";
          unk.textContent="↔ route unknown";
        } else {
          unk.style.cssText="font-size:10px;color:var(--c-ink-4);";
          unk.textContent="↔ route unknown";
        }
        row.appendChild(unk);
      }

      // Routing → button. v360.0.6: bumped from 10px/1×5 to 12px/7×11
      // for mobile tap target.
      var rtBtn=document.createElement("span");
      rtBtn.style.cssText="font-size:12px;color:var(--c-primary);font-weight:600;margin-left:auto;white-space:nowrap;cursor:pointer;padding:7px 11px;border:1px solid #cce;border-radius:4px;background:var(--c-tint-blue);flex-shrink:0;min-height:32px;display:inline-flex;align-items:center;";
      rtBtn.textContent="Routing →";
      row.appendChild(rtBtn);

      inner.appendChild(row);

      // v360.3 (#119): per-leg honesty surface. Sits as a second line
      // inside the route chip — drive-time estimate + stop count.
      // Info-only by design (the "Max suggests, user decides" principle):
      // no warning, no nudge, no "doesn't fit" framing. The user reads
      // the number and decides whether 8h plus 6 stops is a real day
      // for their trip.
      //
      // Drive time = haversine(from, to) ÷ 60 km/h. Crude but honest;
      // pinned with "~" so users don't read it as turn-by-turn precision.
      // Stops = waysides currently on the route between these two dests.
      var _hav = (global.MaxEngineTrip && typeof global.MaxEngineTrip.haversineKm === "function")
        ? global.MaxEngineTrip.haversineKm : null;
      var _fromLL = (typeof dest.lat === "number" && typeof dest.lng === "number") ? [dest.lat, dest.lng] : null;
      var _toLL   = (typeof next.lat === "number" && typeof next.lng === "number") ? [next.lat, next.lng] : null;
      var _legKm  = (_hav && _fromLL && _toLL) ? _hav(_fromLL[0], _fromLL[1], _toLL[0], _toLL[1]) : null;
      var _legHrs = (typeof _legKm === "number" && isFinite(_legKm)) ? (_legKm / 60) : null;
      function _fmtHrs(h) {
        if (typeof h !== "number" || !isFinite(h)) return null;
        var totalMin = Math.round(h * 60);
        var hh = Math.floor(totalMin / 60);
        var mm = totalMin % 60;
        // Round mm to nearest 5 to read as "ballpark" not "to the minute".
        mm = Math.round(mm / 5) * 5;
        if (mm === 60) { hh += 1; mm = 0; }
        if (hh === 0) return mm + "m";
        if (mm === 0) return hh + "h";
        return hh + "h" + (mm < 10 ? "0" + mm : mm);
      }
      function _countLegWaysides() {
        var routes = trip && Array.isArray(trip.routes) ? trip.routes : [];
        for (var i = 0; i < routes.length; i++) {
          var r = routes[i];
          if (!r) continue;
          var sub = (global.MaxMigration && global.MaxMigration.routeSubKind)
            ? global.MaxMigration.routeSubKind(r)
            : (r.subKind || (r.kind && r.kind !== "route" ? r.kind : null));
          if (sub !== "transit") continue;
          if (r.fromDestId === dest.id && r.toDestId === next.id) {
            return (r.planItems || []).filter(function(pi){ return pi && pi.type === "stop"; }).length;
          }
        }
        return 0;
      }
      var honestyRow = document.createElement("div");
      honestyRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:4px;font-size:10.5px;color:var(--c-ink-3);";
      var parts = [];
      var _hrsLbl = _fmtHrs(_legHrs);
      if (_hrsLbl) parts.push("~" + _hrsLbl + " drive");
      var _waysideCount = _countLegWaysides();
      if (_waysideCount > 0) {
        parts.push(_waysideCount + " stop" + (_waysideCount === 1 ? "" : "s") + " along the way");
      }
      if (parts.length) {
        honestyRow.textContent = parts.join(" · ");
        inner.appendChild(honestyRow);
      }

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
    notesWrap.style.cssText = "margin:8px 0 10px;padding:10px 12px;background:var(--c-panel);border:1px solid #ececec;border-radius:8px;";
    var notesHdr = document.createElement("div");
    notesHdr.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-ink-3);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;";
    var notesLabel = document.createElement("span");
    notesLabel.textContent = "Notes from the road";
    var notesStatus = document.createElement("span");
    // v351: was id="dm-notes-status" — singular ID broke when mobile
    // renders one note block per destination on the same page. Status
    // node is now closure-captured, so each call to renderTravelerNotes
    // owns its own status element. Desktop's single-card rendering is
    // unaffected; mobile can now render the full destination list with
    // working per-card status.
    notesStatus.style.cssText = "font-size:9px;font-weight:500;color:var(--c-ink-4);text-transform:none;letter-spacing:0;";
    notesHdr.appendChild(notesLabel);
    notesHdr.appendChild(notesStatus);
    notesWrap.appendChild(notesHdr);
    var notesTa = document.createElement("textarea");
    // v351: dropped the singular id="dm-notes-textarea" for the same
    // reason as the status node above. Nothing else in the codebase
    // looked up the textarea by ID.
    notesTa.placeholder = "Things to remember from this stop…";
    notesTa.value = (typeof dest.travelerNotes === "string") ? dest.travelerNotes : "";
    notesTa.style.cssText = "width:100%;min-height:48px;max-height:240px;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 8px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);color:var(--c-ink);resize:vertical;box-sizing:border-box;font-family:inherit;";
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
      micBtn.style.cssText = 'font-size:14px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:5px;padding:4px 10px;cursor:pointer;font-family:inherit;line-height:1;min-height:28px;';
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
    saveBtn.style.cssText = "font-size:11px;font-weight:600;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:5px;padding:5px 12px;cursor:pointer;font-family:inherit;transition:opacity 0.18s ease, background 0.12s ease;";
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
    // PD.416: the inline "Keep in mind" editor now reads/writes the ONE
    // per-place notes store (placeMeta.notes) — the SAME text the 📓
    // research card edits — instead of the separate dest.research field.
    // Legacy dest.research is seeded into the unified store once.
    var _notesPlace = dest.place || dest.label || "";
    function _curNotes() {
      if (typeof global._pmGetPlaceNotes === "function") return global._pmGetPlaceNotes(_notesPlace);
      return (typeof dest.research === "string") ? dest.research : "";
    }
    try {
      if (typeof global._pmGetPlaceNotes === "function" && typeof global._pmSetPlaceNotes === "function") {
        var _seed = global._pmGetPlaceNotes(_notesPlace);
        if (!_seed && typeof dest.research === "string" && dest.research) {
          global._pmSetPlaceNotes(_notesPlace, dest.research);
        }
      }
    } catch (_) {}
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
        var _cn0 = _curNotes();
        collapsed = !(_cn0 && _cn0.length > 0);
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
    // v359.60.65: rename per-destination "Research" surface to
    // "Keep in mind for {place}" so the language matches the intent
    // (stuff to remember before/during the trip for this place).
    lbl.textContent = "Keep in mind for " + (dest.label || dest.place || "this destination");
    var meta = document.createElement("span");
    meta.style.cssText = "font-size:9px;font-weight:500;color:#bbb;text-transform:none;letter-spacing:0;margin-left:4px;";
    hdrLeft.appendChild(caret);
    hdrLeft.appendChild(lbl);
    hdrLeft.appendChild(meta);
    var status = document.createElement("span");
    status.style.cssText = "font-size:9px;font-weight:500;color:var(--c-ink-4);text-transform:none;letter-spacing:0;";
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
      var s = _curNotes();
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

    var saved = _curNotes();
    var view = document.createElement("div"); // Read-only view: text + clickable URLs.
    view.style.cssText = "font-size:12.5px;line-height:1.55;color:#333;min-height:36px;padding:6px 8px;background:var(--c-bg);border:1px solid #e8e1c8;border-radius:5px;cursor:text;white-space:pre-wrap;word-wrap:break-word;";
    view.title = "Tap to edit";

    function renderViewMode() {
      if (!saved) {
        view.innerHTML = '<span style="color:#bbb;">Tap to add anything you want to remember — links, opening hours, reservations, things to do, contacts…</span>';
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
        html += '<a href="' + safe + '" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);text-decoration:underline;word-break:break-all;">' + safe + '</a>' + _esc(trail);
        lastIdx = m.index + m[1].length;
      }
      html += _esc(saved.substring(lastIdx));
      view.innerHTML = html;
    }
    function _esc(s){ return _escHtml(s); }
    renderViewMode();

    var ta = document.createElement("textarea");
    ta.placeholder = "What you've read, links, opening hours, reservation deadlines…";
    ta.style.cssText = "width:100%;min-height:80px;max-height:320px;font:inherit;font-size:12.5px;line-height:1.5;padding:6px 8px;border:1px solid var(--c-primary);border-radius:5px;background:var(--c-bg);color:var(--c-ink);resize:vertical;box-sizing:border-box;font-family:inherit;display:none;outline:none;box-shadow:0 0 0 3px rgba(26,95,168,.12);";

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
        // PD.416: write to the unified per-place notes store (same text
        // the 📓 card edits) instead of the legacy dest.research field.
        if (typeof global._pmSetPlaceNotes === "function") global._pmSetPlaceNotes(_notesPlace, nextVal);
        else dest.research = nextVal;
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
      var s = _curNotes();
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
      micBtn.textContent = "🎤 Dictate";
      micBtn.title = "Dictate (Web Speech API)";
      micBtn.style.cssText = "font-size:11px;background:var(--c-bg);border:1px solid #e6e0cc;border-radius:5px;padding:5px 10px;cursor:pointer;font-family:inherit;color:#8a7440;";
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
            micBtn.textContent = "🎤 Dictate";
            micBtn.style.background = "#fff";
            ta.value = ta.value.substring(0, startLen) + (finalText ? leadingSpace + finalText : "");
            // Stay in edit mode after dictation ends — user may
            // want to clean up. They commit by tapping outside.
          };
          rec.start();
        } catch (e) {
          listening = false;
          micBtn.textContent = "🎤 Dictate";
          status.textContent = "mic unavailable";
          status.style.color = "#c05020";
        }
      };
      micRow.appendChild(micBtn);
      body.appendChild(micRow);
    }

    container.appendChild(wrap);
  }

  // ── v359.60.60: "Action needed" alert banner ───────────────
  // Counts THIS destination's open pending actions + upcoming
  // cancellation deadlines (within 7 days or past-due) and renders
  // a compact orange banner near the top of the destination card.
  // Click jumps to the Action needed tab. Renders nothing when the
  // destination is clean.
  function _renderActionNeededAlert(dest, container) {
    if (!dest) return;
    var actions = [];
    try {
      var trip = global.trip;
      if (trip && Array.isArray(trip.pendingActions)) {
        var dName = (dest.label || dest.place || "").toLowerCase();
        actions = trip.pendingActions.filter(function(a){
          if (a.cleared || !a.requiresProviderAction) return false;
          return (a.destName || "").toLowerCase() === dName;
        });
      }
    } catch(_) {}
    var deadlines = [];
    try {
      if (typeof global.collectDeadlines === "function") {
        var today = new Date(); today.setHours(0,0,0,0);
        var in7 = new Date(today); in7.setDate(today.getDate()+7);
        var all = global.collectDeadlines(dest) || [];
        // Only count deadlines that are urgent or coming up soon —
        // far-future ones don't need the alert. They still show in the
        // tab content.
        deadlines = all.filter(function(d){
          if (!d.deadline) return false;
          var dd = new Date(d.deadline+"T12:00:00");
          return dd <= in7;
        });
      }
    } catch(_) {}
    var nA = actions.length, nD = deadlines.length, n = nA + nD;
    if (n === 0) return;
    // v359.60.63: banner is now a click-to-expand surface. The action
    // list opens directly under the banner (using mkTrackerInner with
    // skipTitle so we don't double-render the heading). No longer
    // navigates to a separate tab.
    var wrapEl = document.createElement("div");
    wrapEl.style.cssText = "margin:8px 0 4px;background:#fff5ec;border:1px solid #f0c8a0;border-radius:6px;overflow:hidden;";
    var banner = document.createElement("button");
    banner.type = "button";
    banner.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:9px 11px;background:transparent;border:none;cursor:pointer;font-family:inherit;text-align:left;transition:background .12s ease;";
    banner.onmouseover = function(){ banner.style.background = "#fdebd8"; };
    banner.onmouseout  = function(){ banner.style.background = "transparent"; };
    var txt = document.createElement("div");
    txt.style.cssText = "font-size:12px;color:var(--c-warn);line-height:1.45;";
    var placeName = dest.label || dest.place || "this destination";
    var bits = [];
    if (nA) bits.push("<strong>" + nA + "</strong> provider action" + (nA !== 1 ? "s" : ""));
    if (nD) bits.push("<strong>" + nD + "</strong> cancellation deadline" + (nD !== 1 ? "s" : ""));
    txt.innerHTML = "⚠ <strong>What you need to take care of for " + placeName + "</strong> — " + bits.join(" · ");
    var arrow = document.createElement("div");
    arrow.style.cssText = "font-size:11px;font-weight:600;color:var(--c-warn);flex-shrink:0;";
    arrow.textContent = "▾ Show";
    banner.appendChild(txt); banner.appendChild(arrow);

    var listHost = document.createElement("div");
    listHost.style.cssText = "display:none;border-top:1px solid #f0c8a0;background:var(--c-bg);padding:8px 12px 4px;";

    (function(did){
      banner.onclick = function(){
        var open = listHost.style.display !== "none";
        if (open) {
          listHost.style.display = "none";
          arrow.textContent = "▾ Show";
          listHost.innerHTML = "";
          return;
        }
        listHost.style.display = "block";
        arrow.textContent = "▴ Hide";
        // Lazy-render the list on first open so big trips don't pay
        // the DOM cost up-front.
        if (!listHost.firstChild && typeof global.mkTrackerInner === "function") {
          listHost.appendChild(global.mkTrackerInner(dest, {skipTitle: true}));
        }
      };
    })(dest.id);

    wrapEl.appendChild(banner);
    wrapEl.appendChild(listHost);
    container.appendChild(wrapEl);
  }

  // ── TM.7.3 (v332): pending-cancellations banner ────────────
  // Renders only if dest.pendingCancellations.items has entries.
  // Click of "View checklist" calls global.showCancellationChecklist.
  function _renderPendingCancellationsBanner(dest, container) {
    if (!(dest.pendingCancellations && dest.pendingCancellations.items && dest.pendingCancellations.items.length)) return;
    var pcBanner = document.createElement('div');
    pcBanner.style.cssText = 'background:var(--c-tint-amber);border:1px solid #f0dcc0;border-radius:6px;padding:8px 10px;margin:8px 0 4px;display:flex;align-items:center;justify-content:space-between;gap:8px;';
    var pcTxt = document.createElement('div');
    pcTxt.style.cssText = 'font-size:11px;color:var(--c-warn);';
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
        return '<div style="background:var(--c-panel);border:1px dashed #d8d4c8;border-radius:7px;padding:9px 12px;margin-bottom:8px;">'
          + '<div style="font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:'+color+';margin-bottom:3px;">' + roleLabel + '</div>'
          + '<div style="font-size:11px;color:var(--c-ink-3);">No arrival/departure details added yet. <a href="#" id="dm-edit-logistics-'+side+'" style="color:var(--c-primary);">Add them →</a></div>'
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
    // v359.52.6: drill-in view day-trip chips rebuilt to read v2 routes.
    // Was reading dest.dayTrips[] (legacy v0 shape, empty post-migration).
    // Walks trip.routes[] for kind:"dayTrip" routes whose fromDestId
    // matches this dest; each route's planItems[] holds the target
    // stop(s). Render one chip per stop with "Make this an overnight"
    // wired to the v2 writer (ungroupDayTripByRouteStop).
    // v3 Phase 2: use MaxMigration.isDayTripRoute (handles both v2 and v3 shapes).
    var trip = global.trip;
    if (!trip || !Array.isArray(trip.routes) || !trip.routes.length) return;
    var places = (trip && trip.places) || {};
    var _isDT = (typeof MaxMigration !== "undefined" && MaxMigration.isDayTripRoute)
      ? MaxMigration.isDayTripRoute
      : function(r){ return r && (r.subKind === "dayTrip" || r.kind === "dayTrip"); };
    var hubRoutes = trip.routes.filter(function(r){
      return _isDT(r) && r.fromDestId === dest.id;
    });
    if (!hubRoutes.length) return;

    var dtBox = document.createElement("div");
    dtBox.style.cssText = "margin:0 0 10px;padding:9px 12px;background:var(--c-tint-purple);border:1px solid #d8c4e8;border-radius:7px;";
    var dtHdr = document.createElement("div");
    dtHdr.style.cssText = "font-size:12px;font-weight:700;color:var(--c-accent);margin-bottom:5px;";
    dtHdr.textContent = "Day trips from " + dest.place;
    dtBox.appendChild(dtHdr);
    var dtList = document.createElement("div");
    dtList.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";

    hubRoutes.forEach(function(route){
      (route.planItems || []).forEach(function(stop){
        if (!stop || stop.type !== "stop") return;
        var place = places[stop.placeId];
        var placeName = (place && place.name) || stop.placeId || "(unknown)";
        var distKm = (stop.legacy && stop.legacy.distKm)
          || (typeof route.distKm === "number" ? route.distKm : 0);
        var chip = document.createElement("button");
        chip.type = "button";
        chip.style.cssText = "font-size:11px;font-weight:600;color:var(--c-accent);background:var(--c-bg);border:1px solid #d8c4e8;padding:4px 10px;border-radius:11px;cursor:pointer;font-family:inherit;";
        // v359.52.7: chip click opens the scheduling menu (pick a day
        // or convert to overnight). Was: chip click directly ungrouped,
        // with no way to pick which day of the hub stay the day trip
        // happens on.
        var dayOf = "";
        if (route.transitDays && route.transitDays[0]) {
          (dest.days || []).forEach(function(d, idx){
            if (d && d.id === route.transitDays[0]) {
              dayOf = " · on Day " + (idx + 1);
            }
          });
        }
        chip.textContent = "📍 " + placeName
          + (distKm ? " · " + (typeof global._fmtDistance === "function" ? global._fmtDistance(distKm) : distKm + "km") : "")
          + dayOf;
        // v360.3 (#125): expanded tooltip. The "convert to overnight"
        // path was already here; spelling it out signals to the user
        // that they can swap which city they're based in. "Stay
        // outside a big city" hint pulls the trade-off forward.
        chip.title = "Click to schedule on a specific day, or convert " + placeName + " into a hub of its own — useful if you'd rather stay outside a big city.";
        chip.onmouseover = function(){ chip.style.background = "#ede0f4"; };
        chip.onmouseout = function(){ chip.style.background = "#fff"; };
        (function(hubDest, routeRef, stopRef, chipEl){
          chip.onclick = function(e){
            e.stopPropagation();
            if (typeof global.openDayTripMenuV2 === "function") {
              global.openDayTripMenuV2(chipEl, hubDest, routeRef, stopRef);
            } else if (typeof global.ungroupDayTripByRouteStop === "function") {
              // Fallback if menu helper isn't loaded yet.
              global.ungroupDayTripByRouteStop(hubDest, routeRef, stopRef);
            } else {
              // v360.3 (#104): make the no-op visible.
              console.warn("[Max] no day-trip menu/ungroup helper defined");
              if (typeof global.showSaveStatus === "function") {
                global.showSaveStatus("⚠ Day-trip action unavailable in this build — please reload.", 5000);
              }
            }
          };
        })(dest, route, stop, chip);
        dtList.appendChild(chip);
      });
    });

    if (!dtList.children.length) return; // every route had zero usable stops
    dtBox.appendChild(dtList);
    hdr.appendChild(dtBox);
  }

  // ── v359.50: destination tab bar — 3 architecture-aligned tabs ──
  // Refactor of the prior 6-tab strip (Itinerary / Explore / Stay /
  // Routing / On the ground / Tracking…) into three groups that mirror
  // the data model (see data-model.md):
  //
  //   • Plan        → days[].planItems[] + routes[] segments
  //                   (panes: sights, explore, routing)
  //   • Stay & Eat  → hotels (future: dedicated restaurants surface)
  //                   (panes: stay)
  //   • On the ground → practical context + pendingActions[]
  //                   (panes: info, tracker)
  //
  // `global._activeDmSection` retains its legacy values (sights/explore/
  // stay/routing/info/tracker) so existing deep-link assignments
  // ("set section to 'routing' and re-render") still work; the active
  // tab group is derived from the section via TAB_OF_PANE. Pane DOM
  // ids are unchanged — visibility now flips on group membership
  // (multiple panes can be visible at once within the active tab).
  //
  // Tracker badge moves from its own tab to the On-the-ground tab.
  // v359.60.60: four tabs that map to the four cognitive modes a
  // traveler uses on a destination:
  //
  //   • See and do     — schedule + sights to consider (keep/reject)
  //                      + optional sights + day-trip ideas
  //                      (panes: sights, explore)
  //   • Stay and Eat   — hotels AND restaurants together where the
  //                      tab name promises them
  //                      (pane: stay; restaurants merged in here)
  //   • On the ground  — how to navigate THIS place: quick reference,
  //                      local-knowledge LLM panel, transit booking
  //                      (panes: info, routing)
  //   • Action needed  — per-destination obligations sorted by date:
  //                      pending provider actions + cancellation
  //                      deadlines merged into one chronological list
  //                      (pane: tracker)
  //
  // Pane ids unchanged so legacy deep-link assignments still work;
  // only the tab GROUPING changed. The badge follows Action needed.
  // v359.60.69: Bookings tab added — central list of every booking
  // for this destination (hotels, transport, activities & other).
  // Stay and Eat's hotel forms and On the ground's routing forms
  // continue to work for adding bookings in context; Bookings is
  // the roll-up view.
  var TAB_GROUPS = [
    {id:"seeAndDo",     lbl:"See and Do",    panes:["sights","explore"]},
    {id:"stayAndEat",   lbl:"Stay and Eat",  panes:["stay"]},
    {id:"onTheGround",  lbl:"On the ground", panes:["info","routing"]},
    {id:"bookings",     lbl:"Bookings",      panes:["bookings"]}
  ];
  var TAB_OF_PANE = {};
  TAB_GROUPS.forEach(function(grp){ grp.panes.forEach(function(p){ TAB_OF_PANE[p] = grp.id; }); });

  function _activeDmTab(){
    return TAB_OF_PANE[global._activeDmSection] || "seeAndDo";
  }
  function _isPaneInActiveGroup(paneId){
    return TAB_OF_PANE[paneId] === _activeDmTab();
  }
  // Expose helpers so the pane render functions (in this file + the
  // explore-pane append in index.html) can call them.
  global._activeDmTab = _activeDmTab;
  global._isPaneInActiveGroup = _isPaneInActiveGroup;

  function _renderDestTabBar(dest, container) {
    var tabs = document.createElement("div");
    tabs.className = "dm-tabs";
    var g = global.g || function(id){ return document.getElementById(id); };
    var activeTab = _activeDmTab();
    // v359.60.64: per-destination count for the badge, not trip-wide.
    // Matches what the Action needed surface actually shows for this
    // destination (provider actions + cancellation deadlines).
    var pendingN = (typeof global.destPendingCount === "function")
      ? global.destPendingCount(dest)
      : ((typeof global.pendingCount === "function") ? global.pendingCount() : 0);

    TAB_GROUPS.forEach(function(grp){
      var btn = document.createElement("button");
      btn.className = "dm-tab" + (grp.id === activeTab ? " on" : "");
      btn.id = "dm-tab-" + grp.id;
      btn.textContent = grp.lbl;
      // Badge follows the Action needed tab — pendingCount covers
      // booking-confirmation and other action items.
      if (grp.id === "actionNeeded" && pendingN > 0) {
        var badge = document.createElement("span");
        badge.className = "dm-tab-badge";
        badge.textContent = pendingN;
        btn.appendChild(badge);
        btn.classList.add("has-attention");
      }
      (function(gid, firstPane){
        btn.onclick = function(){
          // Default to the first pane in the clicked group. If the
          // user was previously in this group, prefer their last pane
          // — but we don't track that yet, so first-pane is fine.
          global._activeDmSection = firstPane;
          var _pw = g("dm-pane-wrap"); if (_pw) _pw.scrollTop = 0;
          var _lpc2 = document.querySelector(".lp-content"); if (_lpc2) _lpc2.scrollTop = 0;
          // Update tab .on classes
          TAB_GROUPS.forEach(function(x){
            var b = g("dm-tab-" + x.id);
            if (b) {
              var wasAttn = b.classList.contains("has-attention");
              b.className = "dm-tab" + (x.id === gid ? " on" : "") + (wasAttn ? " has-attention" : "");
            }
          });
          // Show every pane in the active group; hide every other pane.
          Object.keys(TAB_OF_PANE).forEach(function(paneId){
            var p = g("dm-pane-" + paneId);
            if (p) p.style.display = (TAB_OF_PANE[paneId] === gid ? "block" : "none");
          });
          // Lazy-render the on-the-ground execution groups when the
          // On the ground tab is activated (info pane lives inside it).
          if (gid === "onTheGround") {
            var _execHost = g("dm-exec-groups-" + dest.id);
            if (_execHost && !_execHost._cyRendered && typeof global._renderExecutionGroups === "function") {
              global._renderExecutionGroups(dest, _execHost);
            }
          }
          // Most tabs touch map-relevant panes — refresh the main map.
          if (typeof global.updateMainMap === "function") global.updateMainMap();
        };
      })(grp.id, grp.panes[0]);
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
  // v359.50: visibility now flows from tab GROUP membership, not exact
  // section match — multiple panes (sights/explore/routing) live under
  // the same "Plan" tab and show together.
  sightsPane.style.display=global._isPaneInActiveGroup("sights")?"block":"none";

  // v359.60.94: cross-reference any waysides on the drives INTO and
  // OUT OF this destination into the See and Do tab. The waysides
  // themselves remain owned by the transit routes (so the data
  // model stays intact and the trip view's purple "stops on the way"
  // section keeps working) — these are read-only mirrors that
  // surface them where users instinctively look:
  //   • On Reykjavík's tab: "On the way to Vík" so you see them
  //     while planning Reykjavík.
  //   • On Vík's tab: "On the way from Reykjavík" so you see them
  //     while planning Vík.
  // Each section explicitly says these are en-route stops, not
  // sights at the destination proper. Manage them from the trip
  // view between cards (single source of truth for curate/remove).
  _renderInboundWaysidesSection(trip, dest, sightsPane);
  _renderOutboundWaysidesSection(trip, dest, sightsPane);

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
          arrivalWrap.style.cssText="background:var(--c-tint-blue);border:1px solid var(--c-border-blue);";
          var arrDir=document.createElement("span");
          arrDir.style.cssText="font-size:10px;font-weight:700;color:var(--c-primary);margin-right:8px;text-transform:uppercase;letter-spacing:0.04em;";
          arrDir.textContent="Arrival";
          var arrIcon=document.createElement("span"); arrIcon.className="itin-transport-icon";
          arrIcon.textContent=arrML.icon;
          var arrName=document.createElement("span"); arrName.className="itin-transport-name";
          var arrCN = [ad.carrier, ad.number].filter(function(x){return !!x;}).join(" ");
          arrName.textContent = arrCN
            ? arrCN + (ad.time ? " · " + arrML.arrivalVerb + " " + (typeof _fmtTime12h === "function" ? _fmtTime12h(ad.time) : ad.time) : "")
            : arrML.arrivalTitle;
          var arrMeta=document.createElement("span"); arrMeta.className="itin-transport-meta";
          arrMeta.style.cssText="color:var(--c-ink-3);";
          arrMeta.textContent="into "+dest.place;
          arrivalWrap.appendChild(arrDir);
          arrivalWrap.appendChild(arrIcon);
          arrivalWrap.appendChild(arrName);
          arrivalWrap.appendChild(arrMeta);
          // Round DE: clickable booking URL when set
          if (ad.url) {
            var arrUrl = document.createElement("a");
            arrUrl.href = ad.url; arrUrl.target = "_blank"; arrUrl.rel = "noopener noreferrer";
            arrUrl.style.cssText = "margin-left:8px;font-size:10px;color:var(--c-primary);text-decoration:none;font-weight:600;";
            arrUrl.textContent = "↗ booking";
            arrUrl.onclick = function(e){ e.stopPropagation(); };
            arrivalWrap.appendChild(arrUrl);
          }
          blk.appendChild(arrivalWrap);
        }
      }
      // v359.60.41: hotel chips moved OUT of the dayIdx===0 / isLastDay
      // gates and into per-day date matching below. Allows multiple
      // bookings (mid-stay switch — leave Hotel A, arrive at Hotel B
      // same day) to each render their own chip on the correct day.
    }

    // v359.60.41: per-day hotel chips. For every booked hotel on this
    // destination, emit a check-out chip if checkOut === day.date and
    // a check-in chip if checkIn === day.date. Check-out comes first
    // so a mid-stay switch reads naturally (leave Hotel A in the
    // morning, arrive at Hotel B in the afternoon). Previously each
    // chip used .find() to grab the single first booked hotel and was
    // hardcoded to render on the dest's first or last day only.
    var _bookedHotels = (dest.hotelBookings || []).filter(function(b){ return b.status === "booked"; });
    _bookedHotels.forEach(function(bh){
      if (bh.checkOut && bh.checkOut === day.date) {
        blk.appendChild(buildHotelChip(bh, 'checkout', dest.id));
      }
    });
    _bookedHotels.forEach(function(bh){
      if (bh.checkIn && bh.checkIn === day.date) {
        blk.appendChild(buildHotelChip(bh, 'checkin', dest.id));
      }
    });
    // v359.60.41: safety fallback for the dest's FIRST/LAST day. If
    // a hotel has dates set but they fall outside the dest's day
    // range entirely (data drift, e.g. the booking's check-in is the
    // day BEFORE the dest's first day because of an early arrival),
    // surface it on the first/last day so the chip doesn't silently
    // disappear from the itinerary. Skipped when a per-day chip
    // already rendered for that hotel above.
    if (dayIdx === 0) {
      _bookedHotels.forEach(function(bh){
        if (!bh.checkIn) return;
        // Did we already render a chip for this hotel on its checkIn day?
        var inRange = dest.days.some(function(d){ return d.date === bh.checkIn; });
        if (!inRange) blk.appendChild(buildHotelChip(bh, 'checkin', dest.id));
      });
    }
    if (dayIdx === dest.days.length - 1) {
      _bookedHotels.forEach(function(bh){
        if (!bh.checkOut) return;
        var inRange = dest.days.some(function(d){ return d.date === bh.checkOut; });
        if (!inRange) blk.appendChild(buildHotelChip(bh, 'checkout', dest.id));
      });
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
      // v359.60.41: hotel check-out chip now rendered in the per-day
      // block above (matches by bk.checkOut === day.date). This
      // section only handles departure transport now.
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
      chip.style.cssText='background:var(--c-tint-blue);border-color:#c0ccf0;cursor:pointer;';
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
    flightDir.style.cssText = "font-size:10px;font-weight:700;color:var(--c-warn);margin-right:8px;text-transform:uppercase;letter-spacing:0.04em;";
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
      depUrl.style.cssText = "margin-left:8px;font-size:10px;color:var(--c-primary);text-decoration:none;font-weight:600;";
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
    hint.style.cssText="margin:12px 14px 4px;padding:10px 12px;background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:7px;font-size:11px;color:#2056b0;line-height:1.5;";
    var isGenerating=_generatedCityData[dest.place.toLowerCase()]&&_generatedCityData[dest.place.toLowerCase()].loading;
    hint.innerHTML=isGenerating
      ?"⌛ Max is generating suggestions for "+String(dest.place||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")+" — sights show up under See and Do, places to stay and restaurants under Stay and Eat once ready."
      :"→ Stay in the <b>See and Do</b> tab to browse sights, switch to <b>Stay and Eat</b> for places to stay and restaurants — then add them to your days.";
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
  stayPane2.style.cssText="padding:0 14px 12px;display:"+(global._isPaneInActiveGroup("stay")?"block":"none")+";";

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
    var curBanner=document.createElement("div"); curBanner.style.cssText="background:var(--c-tint-green);border:1px solid #b8dfc9;border-radius:6px;padding:8px 10px;margin-bottom:12px;";
    var curLbl=document.createElement("div"); curLbl.style.cssText="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--c-see);margin-bottom:4px;"; curLbl.textContent="Booked";
    curBanner.appendChild(curLbl);
    dest.hotelBookings.filter(function(b){return b.status==="booked";}).forEach(function(b){
      var nameEl=document.createElement("div"); nameEl.style.cssText="font-size:13px;font-weight:600;color:var(--c-ink);margin-bottom:2px;"; nameEl.textContent=b.name||"Hotel";
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
        toggle.style.cssText = "font-size:10px;color:var(--c-ink-3);background:none;border:none;padding:2px 0;cursor:pointer;font-family:inherit;";
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
  var manualBtn=document.createElement("button"); manualBtn.className="bk-log-btn"; manualBtn.textContent="Add and book a hotel";
  var manualFormId="hbf-"+dest.id+"-manual-"+Date.now();
  (function(btn,wrap,did){btn.onclick=function(){toggleHotelForm(btn,wrap,manualFormId,{
    hotelName:"",area:"",destId:did,checkIn:dest.dateFrom,checkOut:dest.dateTo,currency:"EUR"
  },function(){_emitTripMutation();});};})(manualBtn,manualWrap,dest.id);
  manualWrap.appendChild(manualBtn);
  dest.hotelBookings.filter(function(b){return b.name&&!districts.some(function(d){return d.hotels.some(function(h){return h.name===b.name;});});}).forEach(function(b){manualWrap.appendChild(mkHotelRecord(b,dest.id));});
  seStayPane.appendChild(manualWrap);

  // v359.60.60: restaurants render here under the same Stay & Eat
  // tab, below the hotel list. _renderRestaurantsSection is defined
  // globally in index.html — same DOM as the legacy Explore-pane
  // section, now in the surface the tab name has always promised.
  if (typeof global._renderRestaurantsSection === "function") {
    global._renderRestaurantsSection(dest, seStayPane);
  }

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
    infoPane2.style.display=global._isPaneInActiveGroup("info")?"block":"none";
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

    // ── On the ground: 6-group LLM panel ──────────────────────
    // v359.60.59: dropped the parent "Getting around" header — it
    // was too narrow (the LLM returns six topics, not just transit)
    // and duplicated the "On the ground" title that the execHost
    // itself adds. A thin separator is all the visual hand-off
    // needed before the dynamic content.
    var execSep=document.createElement("div");
    execSep.style.cssText="margin:18px 0 10px;padding-top:14px;border-top:1px solid var(--c-border-3);";
    infoPane2.appendChild(execSep);
    var execHost=document.createElement("div");
    execHost.id="dm-exec-groups-"+dest.id;
    infoPane2.appendChild(execHost);
    if (global._isPaneInActiveGroup("info")) {
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
      pracWrap.style.cssText="margin-top:18px;padding-top:14px;border-top:1px solid var(--c-border-3);";
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
      pracLoad.style.cssText="margin-top:18px;padding-top:14px;border-top:1px solid var(--c-border-3);font-size:11px;color:#999;font-style:italic;";
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
    routePane2.style.display=global._isPaneInActiveGroup("routing")?"block":"none";
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
    trackPane2.style.display=global._isPaneInActiveGroup("tracker")?"block":"none";
    trackPane2.style.padding="12px 14px";
    trackPane2.appendChild(mkTrackerInner(dest));
    paneWrap.appendChild(trackPane2);
  }

  // ── v359.60.69: Bookings pane ──────────────────────────────
  // Roll-up of every booking for this destination (Hotels, Transport
  // legs touching this destination, Activities & other). Edits and
  // adds work through the same record renderers used elsewhere; this
  // pane is read+manage in one view.
  function _renderDestBookingsPane(trip, dest, paneWrap) {
    var mkHotelRecord = global.mkHotelRecord;
    var mkTransportRecord = global.mkTransportRecord;
    var mkGeneralRecord = global.mkGeneralRecord;
    var toggleGeneralForm = global.toggleGeneralForm;

    var pane = document.createElement("div");
    pane.id = "dm-pane-bookings";
    pane.style.padding = "12px 14px";
    pane.style.display = global._isPaneInActiveGroup("bookings") ? "block" : "none";

    // ── Trip-level bookings touching this destination ────────
    // v359.60.91 (c): cross-reference trip-level bookings (cars,
    // multi-leg flights) onto each destination's Bookings tab when
    // their pickup/dropoff/from/to location matches the destination's
    // place name. Rendered as a compact badge with click-through to
    // the same show/edit modal the trip view uses. Read-only here —
    // editing centralized at the trip level avoids two ways to mutate
    // the same record.
    (function(){
      var bookings = (trip && trip.tripBookings) || [];
      if (!bookings.length) return;
      var destName = String(dest.place || dest.label || "").toLowerCase();
      var destFrom = dest.dateFrom || null;
      var destTo = dest.dateTo || null;
      // Range-overlap helper: do two date ranges [a1..a2] and
      // [b1..b2] share any day? All strings are YYYY-MM-DD so
      // lexicographic comparison works.
      function _rangesOverlap(a1, a2, b1, b2) {
        if (!a1 || !a2 || !b1 || !b2) return false;
        return a1 <= b2 && a2 >= b1;
      }
      function _touches(bk) {
        if (bk.kind === "car") {
          // Primary signal: rental window overlaps with stay window.
          // A rental picked up Sep 20 and dropped off Oct 8 is "active"
          // at every destination whose stay falls between those dates,
          // even if the pickup airport string doesn't mention the
          // destination's name.
          var pu = bk.pickup || {};
          var dpo = bk.dropoff || {};
          if (_rangesOverlap(pu.date, dpo.date, destFrom, destTo)) return true;
          // Fallback: substring match on the location strings, in
          // case dates are missing.
          if (destName) {
            var hay = ((pu.location || "") + " " + (dpo.location || "")).toLowerCase();
            if (hay.indexOf(destName) >= 0) return true;
          }
          return false;
        }
        if (bk.kind === "flight" && Array.isArray(bk.legs)) {
          for (var i = 0; i < bk.legs.length; i++) {
            var lg = bk.legs[i];
            // Date overlap on any leg's departure/arrival day.
            if (lg.depDate && destFrom && destTo && lg.depDate >= destFrom && lg.depDate <= destTo) return true;
            if (lg.arrDate && destFrom && destTo && lg.arrDate >= destFrom && lg.arrDate <= destTo) return true;
            // Fallback: location string match.
            if (destName) {
              var hf = String(lg.from || "").toLowerCase();
              var ht = String(lg.to || "").toLowerCase();
              if (hf.indexOf(destName) >= 0 || ht.indexOf(destName) >= 0) return true;
            }
          }
        }
        return false;
      }
      var matches = bookings.filter(_touches);
      if (!matches.length) return;

      var xSec = document.createElement("div");
      xSec.className = "tk-section";
      xSec.style.cssText = "margin-bottom:16px;padding:10px 12px;background:#fdfcf8;border:1px solid #e8e2d2;border-radius:7px;";
      var xLbl = document.createElement("div");
      xLbl.style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--c-accent);margin-bottom:6px;";
      xLbl.textContent = "Trip booking active here";
      xSec.appendChild(xLbl);
      var hint = document.createElement("div");
      hint.style.cssText = "font-size:10.5px;color:var(--c-ink-3);font-style:italic;margin-bottom:8px;";
      hint.textContent = "Manage these in the trip view's Trip bookings section.";
      xSec.appendChild(hint);

      matches.forEach(function(bk){
        var row = document.createElement("div");
        row.style.cssText = "padding:6px 8px;margin:4px 0;background:var(--c-bg);border:1px solid #e0d8c8;border-radius:5px;font-size:11.5px;line-height:1.45;cursor:pointer;";
        row.title = "Click to view full booking details";
        var icon = (bk.kind === "car") ? "🚗" : (bk.kind === "flight") ? "✈" : "📋";
        var summary = "";
        if (bk.kind === "car") {
          var pu = bk.pickup || {};
          var dpo = bk.dropoff || {};
          var puLine = (pu.location || "—") + (pu.date ? " · " + pu.date + (pu.time ? " " + pu.time : "") : "");
          var doLine = (dpo.location || pu.location || "—") + (dpo.date ? " · " + dpo.date + (dpo.time ? " " + dpo.time : "") : "");
          summary = icon + " " + (bk.vendor || "Car rental") + " · pickup " + puLine + " → dropoff " + doLine;
        } else if (bk.kind === "flight" && Array.isArray(bk.legs) && bk.legs.length) {
          var lg0 = bk.legs[0];
          summary = icon + " " + (lg0.carrier || "Flight") + " " + (lg0.from || "—") + " → " + (lg0.to || "—");
        } else {
          summary = icon + " Booking";
        }
        row.textContent = summary;
        (function(id){
          row.onclick = function(){
            if (typeof global._editTripBooking === "function") global._editTripBooking(id);
          };
        })(bk.id);
        xSec.appendChild(row);
      });

      pane.appendChild(xSec);
    })();

    // ── Hotels ───────────────────────────────────────────────
    var hSec = document.createElement("div");
    hSec.className = "tk-section";
    hSec.style.cssText = "margin-bottom:16px;";
    var hLbl = document.createElement("div");
    hLbl.className = "tk-subsection-lbl";
    hLbl.style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:8px;";
    hLbl.textContent = "Hotels";
    hSec.appendChild(hLbl);
    if (!dest.hotelBookings || !dest.hotelBookings.length) {
      var he = document.createElement("div");
      he.className = "tk-empty";
      he.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:4px 0;";
      he.textContent = "No hotel bookings yet — add one from the Stay and Eat tab.";
      hSec.appendChild(he);
    } else {
      dest.hotelBookings.forEach(function(b){
        if (typeof mkHotelRecord === "function") hSec.appendChild(mkHotelRecord(b, dest.id));
      });
    }
    pane.appendChild(hSec);

    // ── Transport ────────────────────────────────────────────
    var tSec = document.createElement("div");
    tSec.className = "tk-section";
    tSec.style.cssText = "margin-bottom:16px;";
    var tLbl = document.createElement("div");
    tLbl.className = "tk-subsection-lbl";
    tLbl.style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:8px;";
    tLbl.textContent = "Transport";
    tSec.appendChild(tLbl);
    var hasTransport = false;
    if (trip.legs) {
      Object.keys(trip.legs).forEach(function(k){
        var leg = trip.legs[k];
        if (!leg || !leg.bookings || !leg.bookings.length) return;
        if (leg.fromId !== dest.id && leg.toId !== dest.id) return;
        hasTransport = true;
        leg.bookings.forEach(function(b){
          if (typeof mkTransportRecord === "function") tSec.appendChild(mkTransportRecord(b, leg.fromId, leg.toId));
        });
      });
    }
    if (!hasTransport) {
      var te = document.createElement("div");
      te.className = "tk-empty";
      te.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:4px 0;";
      te.textContent = "No transport bookings yet — add one from the On the ground tab.";
      tSec.appendChild(te);
    }
    pane.appendChild(tSec);

    // ── Per-sight bookings (v359.60.70) ──────────────────────
    // Aggregate booking records that live on individual sights —
    // both scheduled (day.items[i].booking) and unscheduled
    // (dest.suggestions[i].booking). Each row shows the sight name,
    // schedule context, time, confirmation, and an inline Edit
    // affordance that opens the same toggleSightBookForm used to
    // create them.
    // v359.60.72: filter on "has a booking" alone. The earlier
    // type==="sight" guard hid bookings on items with missing/legacy
    // type fields (older auto-seeded items, items added before the
    // type field existed). The display below tolerates any item that
    // has a name (.n / .name) and a booking object.
    var sightBookings = [];
    (dest.days || []).forEach(function(day, dayIdx){
      (day.items || []).forEach(function(it){
        if (!it || !it.booking) return;
        // Exclude restaurants and day-trip placeholders — those are
        // their own categories elsewhere. Anything else (sights,
        // typed or untyped) counts.
        if (it.type === "restaurant" || it.type === "daytrip" || it.type === "route") return;
        sightBookings.push({
          sight: it,
          bk: it.booking,
          dayIdx: dayIdx,
          dayLbl: day.lbl || ("Day " + (dayIdx + 1)),
          location: "scheduled"
        });
      });
    });
    (dest.suggestions || []).forEach(function(sg){
      if (!sg || !sg.booking) return;
      if (sg.type === "restaurant") return;
      sightBookings.push({
        sight: sg,
        bk: sg.booking,
        dayIdx: -1,
        dayLbl: null,
        location: "unscheduled"
      });
    });
    var sSec = document.createElement("div");
    sSec.className = "tk-section";
    sSec.style.cssText = "margin-bottom:16px;";
    var sLbl = document.createElement("div");
    sLbl.className = "tk-subsection-lbl";
    sLbl.style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:8px;";
    sLbl.textContent = "Sights with bookings";
    sSec.appendChild(sLbl);
    if (!sightBookings.length) {
      var sEmp = document.createElement("div");
      sEmp.className = "tk-empty";
      sEmp.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:4px 0;";
      sEmp.textContent = "No bookings on individual sights yet — tap 'book' on any sight in See and do to log one.";
      sSec.appendChild(sEmp);
    } else {
      // v359.60.71: sort by booking.date so the roll-up reads
      // chronologically (matches how the user thinks about an
      // itinerary — what's next on the calendar).
      sightBookings.sort(function(a, b){
        var ad = (a.bk && a.bk.date) || "";
        var bd = (b.bk && b.bk.date) || "";
        if (ad && bd) return ad.localeCompare(bd);
        if (ad) return -1;
        if (bd) return 1;
        return 0;
      });
      sightBookings.forEach(function(sb){
        var row = document.createElement("div");
        row.style.cssText = "padding:8px 10px;margin-bottom:6px;background:var(--c-panel);border:1px solid var(--c-border-2);border-radius:6px;";
        var line1 = document.createElement("div");
        line1.style.cssText = "font-size:12.5px;font-weight:600;color:#222;line-height:1.4;";
        line1.textContent = sb.sight.n || sb.sight.name || "Sight";
        row.appendChild(line1);
        var line2 = document.createElement("div");
        line2.style.cssText = "font-size:10.5px;color:#666;margin-top:3px;line-height:1.45;";
        var fmtDFn = global.fmtD || function(d){ return d; };
        var bits = [];
        // v359.60.71: date is the most important field for a booking
        // — surface it first. Falls back to "on {dayLbl}" when no
        // explicit date is stored (older booking records).
        if (sb.bk.date) bits.push(fmtDFn(sb.bk.date));
        else if (sb.location === "scheduled") bits.push("on " + sb.dayLbl);
        else bits.push("no date set");
        if (sb.bk.time) bits.push(sb.bk.time + (sb.bk.timeEnd ? "–" + sb.bk.timeEnd : ""));
        if (sb.bk.confirmationNumber) bits.push("Conf " + sb.bk.confirmationNumber);
        if (sb.bk.pricePaid != null) bits.push(sb.bk.pricePaid + " " + (sb.bk.currency || ""));
        line2.textContent = bits.join(" · ");
        row.appendChild(line2);
        // Flag when booking.date and the scheduled day's date disagree
        // — easy to miss otherwise; common after rescheduling a sight.
        if (sb.location === "scheduled" && sb.bk.date && sb.dayLbl) {
          var dayDateMatch = false;
          // Compare booking date to the day's date if available.
          var trip = global.trip;
          if (trip && trip.destinations) {
            trip.destinations.some(function(d){
              if (!d || !d.days) return false;
              return d.days.some(function(day){
                if (day && day.lbl === sb.dayLbl && day.date) {
                  dayDateMatch = (day.date === sb.bk.date);
                  return true;
                }
                return false;
              });
            });
          }
          if (!dayDateMatch) {
            var mismatch = document.createElement("div");
            mismatch.style.cssText = "font-size:10px;color:var(--c-warn);margin-top:2px;";
            mismatch.textContent = "⚠ Booked for " + fmtDFn(sb.bk.date) + " but scheduled on " + sb.dayLbl;
            row.appendChild(mismatch);
          }
        }
        if (sb.bk.cancelDeadline) {
          var line3 = document.createElement("div");
          line3.style.cssText = "font-size:10px;color:var(--c-warn);margin-top:2px;";
          line3.textContent = "Cancel by " + fmtDFn(sb.bk.cancelDeadline) + (sb.bk.cancelDeadlineTime ? " " + sb.bk.cancelDeadlineTime : "");
          row.appendChild(line3);
        }
        sSec.appendChild(row);
      });
    }
    pane.appendChild(sSec);

    // ── Activities & other ───────────────────────────────────
    var gSec = document.createElement("div");
    gSec.className = "tk-section";
    var gLbl = document.createElement("div");
    gLbl.className = "tk-subsection-lbl";
    gLbl.style.cssText = "font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#666;margin-bottom:8px;";
    gLbl.textContent = "Activities & other";
    gSec.appendChild(gLbl);
    var gFormId = "gbf-" + dest.id;
    (dest.generalBookings || []).forEach(function(b){
      if (typeof mkGeneralRecord === "function") gSec.appendChild(mkGeneralRecord(b, dest.id));
    });
    var gAddBtn = document.createElement("button");
    gAddBtn.className = "bk-log-btn";
    gAddBtn.textContent = "+ Add booking";
    gAddBtn.style.cssText = "margin-top:6px;";
    (function(btn, sec, did){
      btn.onclick = function(){
        if (typeof toggleGeneralForm === "function") toggleGeneralForm(btn, sec, gFormId, did);
      };
    })(gAddBtn, gSec, dest.id);
    gSec.appendChild(gAddBtn);
    pane.appendChild(gSec);

    paneWrap.appendChild(pane);
  }

  // v359.60.95: persistent post-generation result banner.
  // Survives drawTripMode redraws because it's keyed on a module-
  // level state object set by the prompt-banner click handler.
  // Stays until the user clicks ✕. Green for "added N waysides",
  // amber for "0 added, here's why" — the latter is the case that
  // most needs explaining (otherwise a no-op click looks like the
  // app just ignored you).
  function _renderWaysideResultBanner(trip, container, last) {
    if (!container || !last) return;
    var success = (last.addedItems || 0) > 0;
    var bg     = success ? "#eef8f0" : "#fff5ed";
    var border = success ? "#b9dec8" : "#f3dcc4";
    var color  = success ? "#2a7a4e" : "#b05820";
    var head, detail;
    if (success) {
      head = "✓ Added " + last.addedItems + " wayside" + (last.addedItems === 1 ? "" : "s") +
             " across " + last.addedRoutes + " route" + (last.addedRoutes === 1 ? "" : "s");
      detail = "Look between destination cards below for the purple ✨ sections — each new stop has a ✕ to remove if it doesn't fit.";
    } else {
      head = "No waysides were added";
      if (last.skipped > 0 && last.addedRoutes === 0) {
        detail = "All routes already had waysides — nothing to do this round.";
      } else {
        detail = "The model didn't surface anything for the routes we tried. Try regenerating, or check that your destinations form a continuous drive — orphan transit routes don't render.";
      }
    }

    var b = document.createElement("div");
    b.style.cssText = "margin:14px 2px 10px;padding:11px 14px;background:" + bg + ";border:1px solid " + border + ";border-radius:8px;display:flex;gap:12px;align-items:flex-start;";
    var bodyEl = document.createElement("div");
    bodyEl.style.cssText = "flex:1;font-size:12px;color:#444;line-height:1.5;";
    bodyEl.innerHTML =
      '<div style="font-weight:700;color:' + color + ';margin-bottom:2px;">' + head + '</div>' +
      '<div style="font-size:11.5px;color:#666;">' + detail + '</div>';
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "Dismiss";
    x.style.cssText = "background:transparent;border:none;color:var(--c-ink-3);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;line-height:1;";
    x.onclick = function () {
      global._maxLastWaysideResult = null;
      if (b.parentNode) b.parentNode.removeChild(b);
    };
    b.appendChild(bodyEl);
    b.appendChild(x);
    container.appendChild(b);
  }

  // ── v360.0.8: Wayside generation banner + per-route waysides ─
  //
  // Show a "✨ Generate waysides" button when the trip has transit
  // routes that don't yet have waysides. After generation completes
  // (call to engine-trip.js's generateWaysidesForTrip), re-renders
  // the trip view and the waysides appear between destination cards.
  // Hidden once every transit route has waysides (or the user
  // dismisses).
  function _renderWaysidePromptBanner(trip, container) {
    if (!trip || !container) return;

    // v359.60.95: when a generation just finished, show a result
    // banner first instead of the prompt banner. drawTripMode tears
    // down the prompt's DOM on every re-render, so a result message
    // baked into the prompt banner would be wiped immediately.
    // Storing the result in module state and having this renderer
    // pick it up lets the success/failure surface survive whatever
    // redraw drawTripMode triggers next.
    var lastResult = global._maxLastWaysideResult;
    if (lastResult && lastResult.tripId === (global._currentTripId || '')) {
      _renderWaysideResultBanner(trip, container, lastResult);
      // We DON'T return here — if there are still routes pending
      // waysides (e.g. user only generated one and there are more),
      // we want the prompt banner to also show below the result so
      // they can click again. The two coexist visually.
    }

    // v359.60.95: tighten the banner to only count routes that
    // ACTUALLY bridge a currently-adjacent pair of destinations.
    // Without this, an orphan transit route (left behind from a
    // reorder/delete) bumps the "needs waysides" count, then
    // Generate runs, fills the orphan's planItems[], the banner
    // hides — and nothing visible changes because
    // _renderRouteWaysides only shows routes between actual
    // adjacent destinations. Symptom seen: banner shows "0/1",
    // user clicks Generate, banner disappears, no waysides
    // appear anywhere. Now the count matches what's renderable.
    var adjPairs = {};
    if (Array.isArray(trip.destinations)) {
      for (var i = 0; i < trip.destinations.length - 1; i++) {
        var a = trip.destinations[i], b = trip.destinations[i + 1];
        if (a && b && a.id && b.id) adjPairs[a.id + '→' + b.id] = true;
      }
    }
    var transits = (trip.routes || []).filter(function (r) {
      var sub = MaxMigration.routeSubKind(r);
      if (sub !== 'transit') return false;
      // Only count routes that map onto a current adjacent pair.
      return !!adjPairs[(r.fromDestId || '') + '→' + (r.toDestId || '')];
    });
    if (!transits.length) return;
    // Round FN.E.2: also exclude routes the picker already tried.
    // The banner is for "you have routes that haven't been
    // discovered yet, want to fill them in?" — if the picker phase
    // covered every transit route, there's nothing left for Generate
    // to do, so the banner shouldn't appear. Routes added after
    // Choreograph (no flag) still surface here.
    var withoutWaysides = transits.filter(function (r) {
      if (Array.isArray(r.planItems) && r.planItems.length) return false;
      if (r && r._waysidesPickerTried) return false;
      return true;
    });
    if (!withoutWaysides.length) return;
    var dismissed = false;
    try { dismissed = localStorage.getItem('max-waysides-banner-dismissed-' + (global._currentTripId || '')) === '1'; } catch (_) {}
    if (dismissed) return;

    // v360.1: banner palette aligned with the Geo affordance banner
    // (same blue tint, same border colour) since both are sibling
    // coaching surfaces — explain a concept, allow dismissal, sit at
    // the same depth in the layout. Earlier they were arbitrarily
    // different colours (purple here, blue there), which made them
    // read as unrelated when they're really the same role.
    //
    // The "✨ Generate" button stays purple — that's Max's brand
    // signal for AI/generative actions, and it's where the meaning
    // belongs. A standalone ✨ icon used to sit at the left of the
    // banner alongside the button; it duplicated the button's
    // signal and didn't carry information, so it's gone.
    var banner = document.createElement("div");
    banner.style.cssText = "margin:14px 2px 10px;padding:12px 14px;background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:8px;display:flex;gap:12px;align-items:center;";
    var body = document.createElement("div");
    body.style.cssText = "flex:1;font-size:12px;color:#1a3f6f;line-height:1.5;";
    body.innerHTML =
      '<div style="font-weight:700;color:var(--c-primary);margin-bottom:2px;">Find waysides — stops along the way</div>' +
      '<div style="font-size:11.5px;color:#3a5572;">Max will suggest 3–6 worthwhile stops on each drive between hubs — waterfalls, viewpoints, lunch towns. <strong>Cuts a night · breaks up the drive.</strong></div>';
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "✨ Generate";
    btn.style.cssText = "padding:7px 14px;font-size:12px;font-weight:700;background:var(--c-accent);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;flex-shrink:0;";
    var dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "✕";
    dismissBtn.title = "Hide this banner";
    dismissBtn.style.cssText = "background:transparent;border:none;color:var(--c-ink-3);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;line-height:1;";

    btn.onclick = async function () {
      if (typeof global.generateWaysidesForTrip !== "function") {
        if (typeof global.maxAlert === "function") global.maxAlert("Wayside generator isn't loaded.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Generating…";
      // v359.60.95: progress-driven UX. The generator fires a
      // callback after each route — we update the button text so
      // the user sees "3 / 12…" tick up. We deliberately DO NOT
      // redraw the trip view mid-loop: drawTripMode tears down
      // this very banner (including the btn we're updating), so
      // calling it would erase the counter. End-of-loop redraw
      // handles both the new wayside rendering between cards and
      // the result banner.
      try {
        var result = await global.generateWaysidesForTrip(trip, {
          onProgress: function (info) {
            if (!info) return;
            if (info.phase === 'start') {
              if (info.total) {
                btn.textContent = "Generating 0 / " + info.total + "…";
              }
              return;
            }
            if (info.phase === 'route') {
              btn.textContent = "Generating " + info.done + " / " + info.total + "…";
              return;
            }
            // info.phase === 'done' — final cleanup happens below.
          },
        });
        if (typeof global.autoSave === "function") global.autoSave();
        // v359.60.95: stash the result so the next drawTripMode
        // re-renders it as a persistent banner (see
        // _renderWaysideResultBanner). The save-status toast alone
        // was too easy to miss — vanishes after 4s and lives in the
        // header. Storing the result in module state lets the
        // banner survive the redraw drawTripMode triggers below.
        global._maxLastWaysideResult = {
          tripId: global._currentTripId || '',
          addedItems: result.addedItems || 0,
          addedRoutes: result.addedRoutes || 0,
          skipped: result.skipped || 0,
          at: Date.now(),
        };
        if (typeof global.drawTripMode === "function") global.drawTripMode();
      } catch (e) {
        console.warn('[waysides] generate failed:', e);
        btn.disabled = false;
        btn.textContent = "✨ Generate";
        if (typeof global.maxAlert === "function") global.maxAlert("Wayside generation failed. " + ((e && e.message) || ""));
      }
    };
    dismissBtn.onclick = function () {
      try { localStorage.setItem('max-waysides-banner-dismissed-' + (global._currentTripId || ''), '1'); } catch (_) {}
      banner.parentNode.removeChild(banner);
    };

    banner.appendChild(body);
    banner.appendChild(btn);
    banner.appendChild(dismissBtn);
    container.appendChild(banner);
  }

  // v360.3 (#122): symmetric counterpart to _renderWaysidePromptBanner —
  // the "Find day trips" action panel. Same visual shape, same
  // generate→commit→re-render flow, but operates on hubs (overnight
  // destinations) rather than transit legs. Renders only when there's
  // at least one hub without a day-trip route yet.
  //
  // Both panels carry a brief one-line hint about why the user might
  // want this:
  //   • Day trips: "Less moving · maybe cheaper hotels."
  //   • Waysides:  "Cuts a night · breaks up the drive."
  // The long educational prose (formerly the geo-affordance banner)
  // moves to the over-budget context where it's actionable.
  function _renderDayTripPromptBanner(trip, container) {
    if (!trip || !container) return;
    var lastResult = global._maxLastDayTripResult;
    if (lastResult && lastResult.tripId === (global._currentTripId || '')) {
      _renderDayTripResultBanner(trip, container, lastResult);
    }

    // Hubs = destinations with ≥1 night. A hub already has day-trips
    // if it has a dayTrip route with at least one stop.
    var hubs = (trip.destinations || []).filter(function (d) {
      return d && (d.nights || 0) >= 1;
    });
    if (!hubs.length) return;
    var hubsWithoutDayTrips = hubs.filter(function (hub) {
      var route = (trip.routes || []).find(function (r) {
        if (!r) return false;
        var sub = (typeof global.MaxMigration !== 'undefined' && global.MaxMigration.routeSubKind)
          ? global.MaxMigration.routeSubKind(r)
          : (r.subKind || (r.kind && r.kind !== 'route' ? r.kind : null));
        return sub === 'dayTrip' && r.fromDestId === hub.id;
      });
      if (!route) return true;
      return !(Array.isArray(route.planItems) && route.planItems.some(function (pi) {
        return pi && pi.type === 'stop';
      }));
    });
    if (!hubsWithoutDayTrips.length) return;
    var dismissed = false;
    try { dismissed = localStorage.getItem('max-daytrips-banner-dismissed-' + (global._currentTripId || '')) === '1'; } catch (_) {}
    if (dismissed) return;

    var banner = document.createElement("div");
    banner.style.cssText = "margin:14px 2px 10px;padding:12px 14px;background:var(--c-tint-blue);border:1px solid var(--c-border-blue);border-radius:8px;display:flex;gap:12px;align-items:center;";
    var body = document.createElement("div");
    body.style.cssText = "flex:1;font-size:12px;color:#1a3f6f;line-height:1.5;";
    body.innerHTML =
      '<div style="font-weight:700;color:var(--c-primary);margin-bottom:2px;">Find day trips — visit while based at a hub</div>' +
      '<div style="font-size:11.5px;color:#3a5572;">Max will suggest 3–6 day-trip candidates near each overnight hub — places worth a half- or full-day from your base. <strong>Less moving · maybe cheaper hotels and a slower pace staying outside a big city.</strong></div>';
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "✨ Generate";
    btn.style.cssText = "padding:7px 14px;font-size:12px;font-weight:700;background:var(--c-accent);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;flex-shrink:0;";
    var dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "✕";
    dismissBtn.title = "Hide this banner";
    dismissBtn.style.cssText = "background:transparent;border:none;color:var(--c-ink-3);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0;line-height:1;";

    btn.onclick = async function () {
      if (typeof global.generateDayTripsForTrip !== "function") {
        if (typeof global.maxAlert === "function") global.maxAlert("Day-trip generator isn't loaded.");
        return;
      }
      btn.disabled = true;
      btn.textContent = "Generating…";
      try {
        var result = await global.generateDayTripsForTrip(trip, {
          onProgress: function (info) {
            if (!info) return;
            if (info.phase === 'start') {
              if (info.total) btn.textContent = "Generating 0 / " + info.total + "…";
              return;
            }
            if (info.phase === 'hub') {
              btn.textContent = "Generating " + info.done + " / " + info.total + "…";
            }
          },
        });
        if (typeof global.autoSave === "function") global.autoSave();
        global._maxLastDayTripResult = {
          tripId: global._currentTripId || '',
          addedItems:  result.addedItems  || 0,
          addedHubs:   result.addedHubs   || 0,
          conversions: result.conversions || 0,
          skipped:     result.skipped     || 0,
          at: Date.now(),
        };
        if (typeof global.drawTripMode === "function") global.drawTripMode();
      } catch (e) {
        console.warn('[daytrips] generate failed:', e);
        btn.disabled = false;
        btn.textContent = "✨ Generate";
        if (typeof global.maxAlert === "function") global.maxAlert("Day-trip generation failed. " + ((e && e.message) || ""));
      }
    };
    dismissBtn.onclick = function () {
      try { localStorage.setItem('max-daytrips-banner-dismissed-' + (global._currentTripId || ''), '1'); } catch (_) {}
      banner.parentNode.removeChild(banner);
    };

    banner.appendChild(body);
    banner.appendChild(btn);
    banner.appendChild(dismissBtn);
    container.appendChild(banner);
  }

  // Result banner. Two parts:
  //   1. Summary row (green pill) — N new candidates + X conversion
  //      offers surfaced.
  //   2. "Could become day trips" subsection — lists each conversion
  //      offer with [Convert to day trip] / [Keep as overnight]
  //      buttons. The convert path dispatches through the existing
  //      _applyStopRoleChange("overnight"→"dayTrip") which already
  //      handles the trip-data side of the conversion.
  function _renderDayTripResultBanner(trip, container, result) {
    if (!result) return;
    var n = result.addedItems  || 0;
    var h = result.addedHubs   || 0;
    var c = result.conversions || 0;
    if (!n && !c) return;

    var banner = document.createElement("div");
    banner.style.cssText = "margin:14px 2px 8px;padding:10px 14px;background:#ecf6ec;border:1px solid #b8dfc9;border-radius:8px;font-size:12px;color:#1e4a22;display:flex;flex-direction:column;gap:8px;";

    // Summary row.
    var summaryRow = document.createElement("div");
    summaryRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";
    var summaryBits = [];
    if (n > 0) {
      summaryBits.push('<strong>Added ' + n + ' day-trip candidate' + (n === 1 ? '' : 's') + '</strong> across ' + h + ' hub' + (h === 1 ? '' : 's'));
    }
    if (c > 0) {
      summaryBits.push('<strong>' + c + ' existing overnight' + (c === 1 ? '' : 's') + '</strong> could become day-trip' + (c === 1 ? '' : 's') + ' — see below');
    }
    summaryRow.innerHTML = '<div>✓ ' + summaryBits.join(' · ') + '.</div>';
    var clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "✕";
    clear.style.cssText = "background:transparent;border:none;color:#3a7a4e;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;";
    clear.onclick = function () {
      global._maxLastDayTripResult = null;
      if (Array.isArray(trip._daytripConversions)) trip._daytripConversions = [];
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    };
    summaryRow.appendChild(clear);
    banner.appendChild(summaryRow);

    // Conversion subsection — only when conversion offers exist on
    // this trip. We re-read trip._daytripConversions (rather than
    // relying on result.conversions count) because the trip object
    // is the source of truth and might have older offers too.
    var offers = Array.isArray(trip._daytripConversions) ? trip._daytripConversions : [];
    if (offers.length) {
      var section = document.createElement("div");
      section.style.cssText = "border-top:1px solid #c8e4ce;padding-top:8px;display:flex;flex-direction:column;gap:6px;";
      var hdr = document.createElement("div");
      hdr.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--c-see);";
      hdr.textContent = "Could become day trips";
      section.appendChild(hdr);
      offers.forEach(function (offer) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 0;font-size:11.5px;color:#1e4a22;";
        var label = document.createElement("div");
        label.style.cssText = "flex:1;min-width:0;";
        label.innerHTML =
          '<strong>' + (offer.destName || '?') + '</strong> ' +
          '<span style="color:#3a7a4e;">could be a day-trip from <strong>' + (offer.hubName || '?') + '</strong></span>' +
          '<span style="color:#5a8a6e;"> · ~' + offer.distKm + ' km' +
          (offer.why ? ' · ' + String(offer.why).slice(0, 90) + (offer.why.length > 90 ? '…' : '') : '') + '</span>';
        var convertBtn = document.createElement("button");
        convertBtn.type = "button";
        convertBtn.textContent = "Convert";
        convertBtn.style.cssText = "padding:5px 10px;font-size:11px;font-weight:600;background:var(--c-see);color:var(--c-on-dark);border:none;border-radius:4px;cursor:pointer;font-family:inherit;";
        convertBtn.title = "Convert this overnight to a day-trip from " + (offer.hubName || 'the hub');
        var keepBtn = document.createElement("button");
        keepBtn.type = "button";
        keepBtn.textContent = "Keep";
        keepBtn.style.cssText = "padding:5px 10px;font-size:11px;font-weight:500;background:var(--c-bg);color:#3a7a4e;border:1px solid #b8dfc9;border-radius:4px;cursor:pointer;font-family:inherit;";
        keepBtn.title = "Keep as overnight";
        (function (offerRef) {
          convertBtn.onclick = function () {
            // Dispatch through the existing role-popover dispatcher.
            // overnight → dayTrip with the chosen hub as the target.
            if (typeof global._applyStopRoleChange !== "function") {
              if (typeof global.maxAlert === "function") global.maxAlert("Conversion isn't available.");
              return;
            }
            global._applyStopRoleChange(
              { kind: "destination", destId: offerRef.destId },
              "overnight",
              "dayTrip",
              { hubId: offerRef.hubId }
            );
            // Remove this offer from the list so it doesn't re-show.
            if (Array.isArray(trip._daytripConversions)) {
              trip._daytripConversions = trip._daytripConversions.filter(function (x) {
                return !(x && x.destId === offerRef.destId && x.hubId === offerRef.hubId);
              });
            }
            if (typeof global.autoSave === "function") global.autoSave();
            // Re-render — drawTripMode rebuilds the banner with the
            // updated offer list, the conversion's flash highlight
            // lands on the hub card via the dispatcher's flash hook.
            if (typeof global.drawTripMode === "function") global.drawTripMode();
          };
          keepBtn.onclick = function () {
            if (Array.isArray(trip._daytripConversions)) {
              trip._daytripConversions = trip._daytripConversions.filter(function (x) {
                return !(x && x.destId === offerRef.destId && x.hubId === offerRef.hubId);
              });
            }
            if (typeof global.autoSave === "function") global.autoSave();
            if (typeof global.drawTripMode === "function") global.drawTripMode();
          };
        })(offer);
        row.appendChild(label);
        row.appendChild(convertBtn);
        row.appendChild(keepBtn);
        section.appendChild(row);
      });
      banner.appendChild(section);
    }
    container.appendChild(banner);
  }

  // v359.60.94: shared renderer for the inbound/outbound wayside
  // sections on a destination's See and Do tab. `direction` controls
  // the header copy and the route lookup direction. `dest` is the
  // current destination; the other side of the drive is derived
  // from the trip's destination order.
  //
  // Read-only mirror of the route's planItems[] — manage actions
  // (remove, edit) live on the trip view's purple between-cards
  // section so we don't end up with two places writing the same
  // data and racing each other.
  function _renderWaysideMirrorSection(trip, dest, container, direction) {
    if (!trip || !dest || !container) return;
    if (!Array.isArray(trip.destinations) || !Array.isArray(trip.routes)) return;
    var idx = trip.destinations.indexOf(dest);
    if (idx < 0) return;

    var otherDest, route, hdrLabel, subCopy;
    if (direction === 'inbound') {
      if (idx === 0) return; // first destination has no drive in
      otherDest = trip.destinations[idx - 1];
      if (!otherDest) return;
      route = trip.routes.find(function (r) {
        var sub = MaxMigration.routeSubKind(r);
        return sub === 'transit' && r.fromDestId === otherDest.id && r.toDestId === dest.id;
      });
      hdrLabel = "✨ On the way from " + (otherDest.place || otherDest.label || "the previous stop");
      subCopy  = "Suggested stops to fit into your drive in — manage from the trip view between the destination cards.";
    } else {
      // outbound
      if (idx >= trip.destinations.length - 1) return; // last destination has no drive out
      otherDest = trip.destinations[idx + 1];
      if (!otherDest) return;
      route = trip.routes.find(function (r) {
        var sub = MaxMigration.routeSubKind(r);
        return sub === 'transit' && r.fromDestId === dest.id && r.toDestId === otherDest.id;
      });
      hdrLabel = "✨ On the way to " + (otherDest.place || otherDest.label || "the next stop");
      subCopy  = "Suggested stops to fit into your drive out — manage from the trip view between the destination cards.";
    }
    if (!route || !Array.isArray(route.planItems) || !route.planItems.length) return;
    // Only mirror PlanItems of type 'stop' — those are waysides.
    var stops = route.planItems.filter(function (pi) { return pi && pi.type === 'stop'; });
    if (!stops.length) return;

    var sec = document.createElement("div");
    sec.style.cssText = "margin:10px 14px 4px;padding:10px 12px;background:#fbfaf6;border:1px solid #e7dcf2;border-left:3px solid #c8a8e0;border-radius:0 8px 8px 0;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "font-size:10px;font-weight:700;color:var(--c-accent);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;";
    hdr.textContent = hdrLabel;
    sec.appendChild(hdr);
    var sub = document.createElement("div");
    sub.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-bottom:8px;line-height:1.4;";
    sub.textContent = subCopy;
    sec.appendChild(sub);

    stops.forEach(function (pi) {
      var place = (trip.places || {})[pi.placeId] || {};
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0;";
      var left = document.createElement("div");
      left.style.cssText = "flex:1;";
      var name = place.name || "Stop";
      var why = pi.notes || "";
      var dur = (typeof pi.duration === "number" && pi.duration > 0)
        ? (pi.duration < 1 ? Math.round(pi.duration * 60) + "m" : pi.duration + "h")
        : "";
      // Small "on the way" badge per item, so even if the user
      // scans the list of sights and forgets about the section
      // header, each en-route stop self-identifies as one.
      var badge = '<span style="display:inline-block;font-size:9px;font-weight:700;color:var(--c-accent);background:#ece4f5;border:1px solid #d3c1e8;border-radius:8px;padding:1px 6px;margin-left:6px;vertical-align:middle;letter-spacing:.03em;text-transform:uppercase;">on the way</span>';
      left.innerHTML =
        '<span style="font-weight:600;color:#222;font-size:12px;">' + (pi.priority === 'iconic' ? '⭐ ' : '') + String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>' +
        badge +
        (dur ? ' <span style="color:var(--c-ink-3);font-size:10.5px;">· ' + dur + '</span>' : '') +
        (why ? '<div style="color:#666;font-size:11px;margin-top:1px;">' + String(why).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>' : '');
      row.appendChild(left);
      sec.appendChild(row);
    });

    container.appendChild(sec);
  }

  // Convenience wrappers so the renderDestItineraryPane call site
  // reads naturally: "render inbound, then outbound."
  function _renderInboundWaysidesSection(trip, dest, container) {
    _renderWaysideMirrorSection(trip, dest, container, 'inbound');
  }
  function _renderOutboundWaysidesSection(trip, dest, container) {
    _renderWaysideMirrorSection(trip, dest, container, 'outbound');
  }

  // Render the waysides on the route OUT of `dest` (i.e., from dest
  // to next dest). Appended to listSec right after the destination
  // card so the user sees waysides in the natural order:
  //   [Reykjavík card] → [✨ Stops on the way to Vík] → [Vík card]
  // Each wayside has a tiny ✕ remove so the user can curate.
  function _renderRouteWaysides(trip, dest, idx, listSec) {
    if (!trip || !dest || !listSec) return;
    if (!Array.isArray(trip.destinations) || idx >= trip.destinations.length - 1) return;
    var nextDest = trip.destinations[idx + 1];
    if (!nextDest) return;
    var route = (trip.routes || []).find(function (r) {
      var sub = MaxMigration.routeSubKind(r);
      return sub === 'transit' && r.fromDestId === dest.id && r.toDestId === nextDest.id;
    });
    if (!route || !Array.isArray(route.planItems) || !route.planItems.length) return;

    var sec = document.createElement("div");
    sec.style.cssText = "margin:0 8px;padding:9px 12px;background:#fbfaf6;border-left:3px solid #c8a8e0;border-radius:0 6px 6px 0;font-size:11.5px;color:#444;line-height:1.55;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "font-size:10px;font-weight:700;color:var(--c-accent);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;";
    hdr.textContent = "✨ Stops on the way to " + (nextDest.place || nextDest.label || "the next stop");
    sec.appendChild(hdr);

    route.planItems.forEach(function (pi) {
      var place = (trip.places || {})[pi.placeId] || {};
      var row = document.createElement("div");
      row.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:3px 0;";
      var left = document.createElement("div");
      left.style.cssText = "flex:1;";
      var name = place.name || "Stop";
      var why = pi.notes || "";
      var dur = (typeof pi.duration === "number" && pi.duration > 0)
        ? (pi.duration < 1 ? Math.round(pi.duration * 60) + "m" : pi.duration + "h")
        : "";
      left.innerHTML =
        '<span style="font-weight:600;color:#222;">' + (pi.priority === 'iconic' ? '⭐ ' : '') + String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>' +
        (dur ? ' <span style="color:var(--c-ink-3);font-size:10.5px;">· ' + dur + '</span>' : '') +
        (why ? '<div style="color:#666;font-size:11px;margin-top:1px;">' + String(why).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>' : '');
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "✕";
      rm.title = "Remove this wayside";
      rm.style.cssText = "background:transparent;border:none;color:#c44;font-size:11px;cursor:pointer;padding:0 4px;flex-shrink:0;";
      (function (piId) {
        rm.onclick = function () {
          route.planItems = route.planItems.filter(function (x) { return x.id !== piId; });
          if (typeof global.autoSave === "function") global.autoSave();
          if (typeof global.drawTripMode === "function") global.drawTripMode();
        };
      })(pi.id);
      row.appendChild(left);
      row.appendChild(rm);
      sec.appendChild(row);
    });

    listSec.appendChild(sec);
  }

  // ── v359.60.91: trip-level Bookings section ─────────────────
  // Renders trip.tripBookings[] — flights and car rentals that
  // don't anchor to a single destination. Goes between the
  // Arrival/Departure panel and the per-destination card list on
  // the trip view. Hidden entirely when there are no trip-level
  // bookings AND the trip has no obvious need for one yet (early
  // planning phase) — but we always render the section header
  // + Add button so the user knows the surface exists.
  function _renderTripLevelBookings(trip, container) {
    if (!trip || !container) return;
    var bookings = (trip.tripBookings || []);

    // v360.1 (slice 2b): collapse to a section header by default.
    // The full booking rows take a lot of vertical space and the
    // user usually just wants to confirm they exist, not read them.
    // Header shows the count; tap to expand. Expanded state lives
    // in trip._ui.bookingsExpanded so it survives re-renders within
    // a session. When there are no bookings, we still render an
    // empty-state header so the user can see the section exists
    // (and learn what it's for) — collapsed empty header isn't
    // useful, so we expand empty automatically.
    if (!trip._ui) trip._ui = {};
    var _bkExpanded = trip._ui.bookingsExpanded === true ||
                      (trip._ui.bookingsExpanded === undefined && bookings.length === 0);

    var sec = document.createElement("div");
    sec.className = "tm-section tm-trip-bookings";
    sec.style.cssText = "margin:14px 2px 10px;padding:12px 14px;background:#fdfcf8;border:1px solid #e8e2d2;border-radius:8px;";

    var hdr = document.createElement("div");
    hdr.style.cssText =
      "display:flex;align-items:baseline;gap:8px;margin-bottom:" +
      (_bkExpanded ? "8px" : "0") + ";cursor:pointer;";
    var ttl = document.createElement("div");
    ttl.style.cssText = "font-size:12px;font-weight:700;color:var(--c-accent);text-transform:uppercase;letter-spacing:0.05em;";
    ttl.textContent = "Trip bookings" + (bookings.length ? " (" + bookings.length + ")" : "");
    var sub = document.createElement("div");
    sub.style.cssText = "font-size:10.5px;color:var(--c-ink-3);font-style:italic;flex:1;";
    sub.textContent = "Flights, car rentals, and other things that span the whole trip.";
    var chev = document.createElement("div");
    chev.style.cssText = "font-size:11px;color:var(--c-ink-3);flex-shrink:0;";
    chev.textContent = _bkExpanded ? "⌃" : "⌄";
    hdr.appendChild(ttl);
    hdr.appendChild(sub);
    hdr.appendChild(chev);
    hdr.onclick = function () {
      trip._ui.bookingsExpanded = !_bkExpanded;
      if (typeof global.drawTripMode === 'function') global.drawTripMode();
    };
    sec.appendChild(hdr);

    if (!_bkExpanded) {
      container.appendChild(sec);
      return;
    }

    if (bookings.length === 0) {
      var empty = document.createElement("div");
      empty.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:4px 0 8px;";
      empty.textContent = "Nothing here yet. Use 📋 Paste at the top of the trip view to add a flight or car-rental confirmation.";
      sec.appendChild(empty);
    } else {
      bookings.forEach(function(bk){
        var row = document.createElement("div");
        row.style.cssText = "padding:8px 10px;margin:5px 0;background:var(--c-bg);border:1px solid #e0d8c8;border-radius:6px;font-size:12px;line-height:1.5;";

        var iconLabel = (bk.kind === "car") ? "🚗 Car rental" :
                        (bk.kind === "flight") ? "✈ Flight" :
                        "📋 Booking";

        var head = document.createElement("div");
        head.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px;";
        var headL = document.createElement("div");
        headL.style.cssText = "font-weight:600;color:#444;";
        headL.textContent = iconLabel + (bk.vendor ? " · " + bk.vendor : "");
        var headRGroup = document.createElement("div");
        headRGroup.style.cssText = "display:flex;gap:10px;align-items:baseline;";
        // v359.60.91 (b): show/open affordance. Opens a modal
        // displaying the booking's current values; user can also
        // edit fields and save back. Labeled "show" rather than
        // "edit" because the primary use is reviewing details
        // (price, confirmation, full pickup/dropoff times) — editing
        // is secondary, available when needed.
        var editBtn = document.createElement("button");
        editBtn.style.cssText = "background:none;border:none;color:var(--c-primary);font-size:11px;cursor:pointer;padding:0;font-family:inherit;";
        editBtn.title = "Show full details (you can also edit any field)";
        editBtn.textContent = "▸ show";
        var removeBtn = document.createElement("button");
        removeBtn.style.cssText = "background:none;border:none;color:#c44;font-size:11px;cursor:pointer;padding:0;font-family:inherit;";
        removeBtn.title = "Delete this booking";
        removeBtn.textContent = "✕ remove";
        (function(id){
          editBtn.onclick = function(){
            if (typeof global._editTripBooking === "function") {
              global._editTripBooking(id);
            }
          };
          removeBtn.onclick = function(){
            if (!global.confirm || global.confirm("Remove this booking?")) {
              trip.tripBookings = (trip.tripBookings || []).filter(function(x){ return x.id !== id; });
              if (typeof global.autoSave === "function") try { global.autoSave(); } catch(_){}
              if (typeof global.drawTripMode === "function") global.drawTripMode();
            }
          };
        })(bk.id);
        headRGroup.appendChild(editBtn);
        headRGroup.appendChild(removeBtn);
        head.appendChild(headL);
        head.appendChild(headRGroup);
        row.appendChild(head);

        var body = document.createElement("div");
        body.style.cssText = "color:var(--c-ink-2);font-size:11.5px;";
        if (bk.kind === "car") {
          var pu = bk.pickup || {};
          var dpo = bk.dropoff || {};
          var puLine = "Pickup: " + (pu.location || "—") +
            (pu.date ? " · " + pu.date + (pu.time ? " " + pu.time : "") : "");
          var doLine = "Dropoff: " + (dpo.location || pu.location || "—") +
            (dpo.date ? " · " + dpo.date + (dpo.time ? " " + dpo.time : "") : "");
          body.innerHTML =
            '<div>' + puLine.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>' +
            '<div>' + doLine.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>';
        } else if (bk.kind === "flight" && Array.isArray(bk.legs) && bk.legs.length) {
          var legsHtml = bk.legs.map(function(lg, i){
            var line = (lg.carrier || "Flight") + (lg.flightNumber ? " " + lg.flightNumber : "") +
              ": " + (lg.from || "—") + " → " + (lg.to || "—") +
              (lg.depDate ? " · " + lg.depDate + (lg.depTime ? " " + lg.depTime : "") : "");
            return '<div>' + (bk.legs.length > 1 ? ("Leg " + (i + 1) + " — ") : "") +
              line.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>';
          }).join("");
          body.innerHTML = legsHtml;
        } else {
          body.textContent = "(no details)";
        }
        row.appendChild(body);

        // Confirmation # + price + URL on a single muted line.
        var meta = [];
        if (bk.confirmationNumber) meta.push("Conf #" + bk.confirmationNumber);
        if (bk.pricePaid != null) {
          // Format as currency (2 decimals) so 612.5 displays as "USD 612.50".
          var priceStr = (typeof bk.pricePaid === "number") ? bk.pricePaid.toFixed(2) : String(bk.pricePaid);
          meta.push((bk.currency || "") + " " + priceStr);
        }
        if (bk.cancelType === "deadline" && bk.cancelDeadline) {
          meta.push("Cancel by " + bk.cancelDeadline);
        } else if (bk.cancelType === "non-cancellable") {
          meta.push("Non-refundable");
        }
        if (meta.length) {
          var metaRow = document.createElement("div");
          metaRow.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-top:3px;";
          metaRow.textContent = meta.join(" · ");
          row.appendChild(metaRow);
        }
        if (bk.url) {
          var urlRow = document.createElement("div");
          urlRow.style.cssText = "font-size:10.5px;margin-top:3px;";
          var a = document.createElement("a");
          a.href = bk.url; a.target = "_blank"; a.rel = "noopener noreferrer";
          a.style.cssText = "color:var(--c-primary);text-decoration:none;";
          a.textContent = "↗ Open booking";
          urlRow.appendChild(a);
          row.appendChild(urlRow);
        }
        sec.appendChild(row);
      });
    }

    // v360.0.0: Unassigned-bookings sub-section. Bookings that came
    // in via email forwarding but couldn't be auto-attached (dates
    // didn't match this trip, etc.) land here so the user spots them
    // where they actually look — on the trip view, not in Profile.
    // Async — async fetch + render so the rest of the Trip-bookings
    // section paints immediately.
    var unassignedHost = document.createElement("div");
    unassignedHost.id = "tm-unassigned-host";
    sec.appendChild(unassignedHost);

    container.appendChild(sec);

    _renderUnassignedOnTripView(trip, unassignedHost);
  }

  // Fetches and renders parsed-but-unattached emails on the trip view.
  // Called from _renderTripLevelBookings above.
  function _renderUnassignedOnTripView(trip, host) {
    if (!host) return;
    var MaxSync = global.MaxSync;
    if (!MaxSync || !MaxSync._request) return;
    MaxSync._request('/user/unassigned-bookings')
      .then(function(data){
        var items = (data && data.unassigned) || [];
        if (!items.length) return;

        var hdr = document.createElement("div");
        hdr.style.cssText = "margin-top:14px;padding-top:10px;border-top:1px dashed #d8d4c8;font-size:10.5px;font-weight:700;color:#a06d00;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;";
        hdr.textContent = "Bookings to assign (" + items.length + ")";
        host.appendChild(hdr);

        var sub = document.createElement("div");
        sub.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-bottom:8px;font-style:italic;";
        sub.textContent = "Forwarded by email but Max couldn't auto-place. Pick where each one goes, then Attach.";
        host.appendChild(sub);

        items.forEach(function(it){
          var p = it.parsed || {};
          var row = document.createElement("div");
          row.style.cssText = "padding:8px 10px;margin:5px 0;background:#fff8ed;border:1px solid #f0dcc0;border-radius:5px;font-size:11.5px;line-height:1.5;";

          var icon = (p.type === "car") ? "🚗" : (p.type === "flight") ? "✈" : (p.type === "hotel") ? "🏨" : "📋";
          var headLine = document.createElement("div");
          headLine.style.cssText = "font-weight:600;color:#444;margin-bottom:3px;";
          var summary = icon + " " + (p.type || "booking");
          if (p.carrier || p.name) summary += " · " + (p.carrier || p.name);
          headLine.textContent = summary;
          row.appendChild(headLine);

          if (p.depDate || p.confirmationNumber) {
            var meta = document.createElement("div");
            meta.style.cssText = "font-size:10.5px;color:#666;margin-bottom:6px;";
            var bits = [];
            if (p.depDate) bits.push(p.depDate + (p.arrDate ? " → " + p.arrDate : ""));
            if (p.confirmationNumber) bits.push("Conf " + p.confirmationNumber);
            if (p.price != null) bits.push((p.currency || "") + " " + p.price);
            meta.textContent = bits.join(" · ");
            row.appendChild(meta);
          }

          // Destination picker only for hotel + general types.
          var needsDest = (p.type !== "car" && p.type !== "flight");
          var destSel = null;
          if (needsDest && Array.isArray(trip.destinations)) {
            destSel = document.createElement("select");
            destSel.style.cssText = "width:100%;padding:5px 8px;font-size:11.5px;border:1px solid var(--c-border-strong);border-radius:4px;background:var(--c-bg);margin-bottom:6px;";
            var opt0 = document.createElement("option");
            opt0.value = "";
            opt0.textContent = "Pick a destination…";
            destSel.appendChild(opt0);
            trip.destinations.forEach(function(d){
              var o = document.createElement("option");
              o.value = d.id;
              var dateStr = d.dateFrom ? " (" + d.dateFrom + (d.dateTo && d.dateTo !== d.dateFrom ? " → " + d.dateTo : "") + ")" : "";
              o.textContent = (d.place || d.label || "Untitled") + dateStr;
              destSel.appendChild(o);
            });
            row.appendChild(destSel);
          }

          var btnRow = document.createElement("div");
          btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
          var attachBtn = document.createElement("button");
          attachBtn.type = "button";
          attachBtn.textContent = "✓ Attach to this trip";
          attachBtn.style.cssText = "padding:5px 12px;font-size:11.5px;font-weight:600;background:var(--c-see);color:var(--c-on-dark);border:none;border-radius:4px;cursor:pointer;";
          // v360.0.2: edit-before-attach. Users can fix LLM mistakes
          // (wrong date, wrong vendor) before committing the booking
          // to their trip. PATCH /user/unassigned-bookings/:id
          // updates parsed_json server-side; we re-render the row
          // with the new values when the modal saves.
          var editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.textContent = "✎ Edit";
          editBtn.style.cssText = "padding:5px 12px;font-size:11.5px;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:4px;cursor:pointer;";
          var dismissBtn = document.createElement("button");
          dismissBtn.type = "button";
          dismissBtn.textContent = "✕ Dismiss";
          dismissBtn.style.cssText = "padding:5px 12px;font-size:11.5px;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:4px;cursor:pointer;";

          (function(id){
            editBtn.onclick = function(){
              _editUnassignedBooking(id, p, function(updatedParsed){
                // Refresh the row's display with new values. Easiest:
                // re-render the whole unassigned section so all data
                // (especially destination-dropdown date strings if the
                // user changed dates) stays consistent.
                if (typeof global.drawTripMode === "function") global.drawTripMode();
              });
            };
            attachBtn.onclick = function(){
              var destId = destSel ? destSel.value : "";
              if (needsDest && !destId) {
                if (typeof global.maxAlert === "function") global.maxAlert("Pick a destination first.");
                return;
              }
              // Trip ID lives on the global _currentTripId (the trip
              // object itself doesn't carry an id field — Max's data
              // model keeps the id at the storage layer, not in the
              // trip blob).
              var tid = global._currentTripId || (trip && trip.id);
              if (!tid) {
                if (typeof global.maxAlert === "function") global.maxAlert("Couldn't find the trip ID. Try reloading.");
                return;
              }
              attachBtn.disabled = true;
              attachBtn.textContent = "Attaching…";
              var payload = { tripId: tid };
              if (destId) payload.destinationId = destId;
              MaxSync._request('/user/unassigned-bookings/' + encodeURIComponent(id) + '/attach', {
                method: 'POST',
                body: payload,
              })
                .then(function(){
                  row.style.opacity = "0.4";
                  row.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--c-see);">✓ Attached. Refreshing your trip…</div>';
                  // Auto-refresh: pull the latest trip body from the
                  // server (the booking attacher modified it server-
                  // side) then re-render the trip view so the booking
                  // shows up in the Trip-bookings list immediately —
                  // no manual page reload needed.
                  if (MaxSync.pullAll) {
                    return MaxSync.pullAll().then(function(){
                      if (typeof global.drawTripMode === "function") global.drawTripMode();
                    }).catch(function(){
                      // Sync hiccup — leave the "Attached" message; user
                      // can reload manually if the booking doesn't appear.
                    });
                  }
                })
                .catch(function(e){
                  console.warn('[unassigned] attach failed:', e);
                  attachBtn.disabled = false;
                  attachBtn.textContent = "✓ Attach to this trip";
                  if (typeof global.maxAlert === "function") global.maxAlert("Attach failed. " + ((e && e.message) || ""));
                });
            };
            dismissBtn.onclick = function(){
              if (!global.confirm || global.confirm("Dismiss this booking?")) {
                MaxSync._request('/user/unassigned-bookings/' + encodeURIComponent(id) + '/dismiss', {
                  method: 'POST',
                }).then(function(){
                  row.parentNode.removeChild(row);
                }).catch(function(e){ console.warn('[unassigned] dismiss failed:', e); });
              }
            };
          })(it.id);

          btnRow.appendChild(dismissBtn);
          btnRow.appendChild(editBtn);
          btnRow.appendChild(attachBtn);
          row.appendChild(btnRow);
          host.appendChild(row);
        });
      })
      .catch(function(e){
        // Silent — if the user isn't signed in or the endpoint
        // isn't reachable, just skip rendering. No need to nag.
        console.warn('[unassigned] fetch failed:', e);
      });
  }

  // v360.0.2: edit modal for unassigned bookings (pre-attach edit).
  // Opens with the parsed_json prefilled; user can fix any field;
  // Save PATCHes server-side and invokes onSaved(updatedParsed) so
  // the caller can re-render. Type-aware: car shows pickup/dropoff,
  // flight shows legs[] or single-leg, hotel shows name/address +
  // checkin/out, others show name + date/time + location.
  function _editUnassignedBooking(emailId, parsed, onSaved) {
    var MaxSync = global.MaxSync;
    if (!MaxSync || !MaxSync._request) return;
    var p = Object.assign({}, parsed || {});

    var ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
    var box = document.createElement("div");
    box.style.cssText = "background:var(--c-bg);border-radius:12px;width:560px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);";

    function inp(id, label, value, placeholder, type) {
      return '<label style="display:block;margin-bottom:8px;">' +
        '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">' + label + '</span>' +
        '<input id="' + id + '" type="' + (type || "text") + '" value="' + (value == null ? "" : String(value).replace(/"/g, "&quot;")) + '" placeholder="' + (placeholder || "") + '" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
        '</label>';
    }

    var typeIcon = (p.type === "car") ? "🚗" : (p.type === "flight") ? "✈" : (p.type === "hotel") ? "🏨" : "📋";
    var typeLbl = (p.type || "booking").charAt(0).toUpperCase() + (p.type || "booking").slice(1);

    var fieldsHtml = "";
    if (p.type === "car") {
      fieldsHtml +=
        inp("ueb-vendor", "Rental company", p.carrier || p.name || "", "e.g. Hertz") +
        '<div style="margin:6px 0 4px;padding:8px 10px;background:#f4f8f4;border:1px solid #d4e3d4;border-radius:5px;">' +
          '<div style="font-size:10px;font-weight:700;color:#2a6a3e;text-transform:uppercase;margin-bottom:6px;">Pickup</div>' +
          inp("ueb-from", "Location", p.from || "", "e.g. Keflavík Airport") +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            inp("ueb-depDate", "Date", p.depDate || "", "", "date") +
            inp("ueb-depTime", "Time", p.depTime || "", "", "time") +
          '</div>' +
        '</div>' +
        '<div style="margin:0 0 8px;padding:8px 10px;background:#f8f4f4;border:1px solid #e3d4d4;border-radius:5px;">' +
          '<div style="font-size:10px;font-weight:700;color:#7a4040;text-transform:uppercase;margin-bottom:6px;">Dropoff</div>' +
          inp("ueb-to", "Location", p.to || p.from || "", "Same as pickup, or different") +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            inp("ueb-arrDate", "Date", p.arrDate || "", "", "date") +
            inp("ueb-arrTime", "Time", p.arrTime || "", "", "time") +
          '</div>' +
        '</div>';
    } else if (p.type === "flight") {
      // v360.0.3: full multi-leg editor in the unassigned-tray modal.
      // The LLM often misses legs (e.g., a 3-leg Chase Travel
      // itinerary parsed as just leg 1). Letting the user see + add
      // missing legs BEFORE attach prevents wrong data from polluting
      // the trip. Same "+ Add a missing or new leg" pattern as the paste flow.
      fieldsHtml += '<div id="ueb-legs-host"></div>';
      fieldsHtml += '<div style="margin:4px 0 8px;">' +
        '<button type="button" id="ueb-add-leg" style="padding:5px 11px;font-size:11.5px;font-weight:600;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:4px;cursor:pointer;font-family:inherit;">+ Add a missing or new leg</button>' +
      '</div>';
    } else if (p.type === "hotel") {
      fieldsHtml +=
        inp("ueb-name", "Hotel name", p.name || p.carrier || "", "") +
        inp("ueb-address", "Address", p.address || "", "Optional") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-depDate", "Check-in", p.depDate || "", "", "date") +
          inp("ueb-depTime", "Check-in time", p.depTime || "", "", "time") +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-arrDate", "Check-out", p.arrDate || "", "", "date") +
          inp("ueb-arrTime", "Check-out time", p.arrTime || "", "", "time") +
        '</div>';
    } else {
      fieldsHtml +=
        inp("ueb-name", "Name", p.name || "", "") +
        inp("ueb-address", "Location", p.address || "", "Optional") +
        // v360.0.6: auto-fit so columns wrap on narrow viewports
        // instead of squishing to 100px each.
        '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px;">' +
          inp("ueb-depDate", "Date", p.depDate || "", "", "date") +
          inp("ueb-depTime", "Start time", p.depTime || "", "", "time") +
          inp("ueb-arrTime", "End time", p.arrTime || "", "", "time") +
        '</div>';
    }

    fieldsHtml +=
      '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;">' +
        inp("ueb-conf", "Confirmation #", p.confirmationNumber || "", "") +
        inp("ueb-price", "Price", p.price != null ? p.price : "", "") +
        inp("ueb-currency", "Currency", p.currency || "USD", "USD") +
      '</div>' +
      inp("ueb-url", "Booking URL", p.url || "", "https://…", "url") +
      inp("ueb-notes", "Notes", p.notes || "", "Optional");

    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:#a06d00;color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-size:14px;">✎</div>' +
        '<div style="font-size:14px;font-weight:700;">Fix ' + typeIcon + ' ' + typeLbl + ' before attaching</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:14px;">Change anything Max got wrong, then Save. You can attach the booking to your trip after.</div>' +
      fieldsHtml +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
        '<button id="ueb-cancel" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;">Cancel</button>' +
        '<button id="ueb-save" style="padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;">Save</button>' +
      '</div>';

    ov.appendChild(box);
    document.body.appendChild(ov);

    function _v(id){ var el = document.getElementById(id); return el ? el.value.trim() : ""; }
    function _num(s){ var n = parseFloat(s); return isFinite(n) ? n : null; }

    // v360.0.3: leg-block builder for the unassigned-tray flight
    // editor. Same shape as the paste-confirmation flow's legs UI
    // but with a `ueb-leg-N-*` prefix so it doesn't clash with
    // either of the other two modals' inputs.
    var _uebLegCounter = 0;
    function _uebAddLegBlock(pre) {
      var host = document.getElementById("ueb-legs-host");
      if (!host) return;
      _uebLegCounter += 1;
      var idx = _uebLegCounter;
      var sfx = "leg-" + idx + "-";
      var legDiv = document.createElement("div");
      legDiv.className = "ueb-leg";
      legDiv.setAttribute("data-leg-idx", String(idx));
      legDiv.style.cssText = "margin:6px 0;padding:8px 10px;background:#f5f8fc;border:1px solid #d4e0f0;border-radius:5px;";
      legDiv.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
          '<div style="font-size:10px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;">Leg ' + idx + '</div>' +
          '<button type="button" class="ueb-leg-remove" style="background:none;border:none;color:#c44;font-size:10.5px;cursor:pointer;padding:0;font-family:inherit;">✕ remove</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-" + sfx + "carrier", "Airline", (pre && pre.carrier) || "", "") +
          inp("ueb-" + sfx + "number",  "Flight #", (pre && (pre.flightNumber || pre.number)) || "", "") +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-" + sfx + "from", "From", (pre && pre.from) || "", "City or code") +
          inp("ueb-" + sfx + "to",   "To",   (pre && pre.to)   || "", "City or code") +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-" + sfx + "depDate", "Departure date", (pre && pre.depDate) || "", "", "date") +
          inp("ueb-" + sfx + "depTime", "Departure time", (pre && pre.depTime) || "", "", "time") +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("ueb-" + sfx + "arrDate", "Arrival date", (pre && pre.arrDate) || "", "", "date") +
          inp("ueb-" + sfx + "arrTime", "Arrival time", (pre && pre.arrTime) || "", "", "time") +
        '</div>';
      host.appendChild(legDiv);
      legDiv.querySelector(".ueb-leg-remove").onclick = function(){
        legDiv.parentNode.removeChild(legDiv);
        document.querySelectorAll(".ueb-leg").forEach(function(b, i){
          var lbl = b.querySelector("div > div");
          if (lbl) lbl.textContent = "Leg " + (i + 1);
        });
      };
    }
    if (p.type === "flight") {
      // Populate from p.legs[] if the LLM extracted multiple; else
      // build a single leg from the flat fields.
      var initLegs = Array.isArray(p.legs) && p.legs.length ? p.legs : [{
        carrier:      p.carrier || "",
        flightNumber: p.number  || "",
        from:         p.from    || "",
        to:           p.to      || "",
        depDate:      p.depDate || "",
        depTime:      p.depTime || "",
        arrDate:      p.arrDate || "",
        arrTime:      p.arrTime || "",
      }];
      initLegs.forEach(function(lg){ _uebAddLegBlock(lg); });
      var addLegBtn = document.getElementById("ueb-add-leg");
      if (addLegBtn) addLegBtn.onclick = function(){ _uebAddLegBlock({}); };
    }

    document.getElementById("ueb-cancel").onclick = function(){ ov.remove(); };
    ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

    document.getElementById("ueb-save").onclick = function(){
      var update = {};
      if (p.type === "car") {
        update.carrier = _v("ueb-vendor");
        update.from = _v("ueb-from");
        update.to = _v("ueb-to") || _v("ueb-from");
      } else if (p.type === "flight") {
        // Collect legs from DOM. Persist BOTH the legs[] array (the
        // authoritative shape) AND the flat fields populated from
        // leg 1 (for backward-compat with the single-leg attach
        // path on the server).
        var collected = [];
        document.querySelectorAll(".ueb-leg").forEach(function(b){
          var lidx = b.getAttribute("data-leg-idx");
          var sfx = "leg-" + lidx + "-";
          collected.push({
            carrier:      _v("ueb-" + sfx + "carrier"),
            flightNumber: _v("ueb-" + sfx + "number"),
            from:         _v("ueb-" + sfx + "from"),
            to:           _v("ueb-" + sfx + "to"),
            depDate:      _v("ueb-" + sfx + "depDate") || null,
            depTime:      _v("ueb-" + sfx + "depTime") || null,
            arrDate:      _v("ueb-" + sfx + "arrDate") || null,
            arrTime:      _v("ueb-" + sfx + "arrTime") || null,
          });
        });
        update.legs = collected;
        if (collected.length) {
          var first = collected[0];
          update.carrier = first.carrier;
          update.number = first.flightNumber;
          update.from = first.from;
          update.to = first.to;
        }
      } else if (p.type === "hotel") {
        update.name = _v("ueb-name");
        update.address = _v("ueb-address");
      } else {
        update.name = _v("ueb-name");
        update.address = _v("ueb-address");
      }
      // For flight, depDate/depTime/arrDate/arrTime are per-leg
      // already; skip overwriting from non-existent top-level inputs.
      if (p.type !== "flight") {
        update.depDate = _v("ueb-depDate") || null;
        update.depTime = _v("ueb-depTime") || null;
        update.arrDate = _v("ueb-arrDate") || null;
        update.arrTime = _v("ueb-arrTime") || null;
      } else if (Array.isArray(update.legs) && update.legs.length) {
        // Top-level dates/times from leg 1 for backward compat.
        var f0 = update.legs[0];
        update.depDate = f0.depDate;
        update.depTime = f0.depTime;
        var fLast = update.legs[update.legs.length - 1];
        update.arrDate = fLast.arrDate;
        update.arrTime = fLast.arrTime;
      }
      update.confirmationNumber = _v("ueb-conf");
      var pn = _num(_v("ueb-price"));
      update.price = pn;
      update.currency = _v("ueb-currency") || "USD";
      update.url = _v("ueb-url") || null;
      update.notes = _v("ueb-notes");

      MaxSync._request('/user/unassigned-bookings/' + encodeURIComponent(emailId), {
        method: 'PATCH',
        body: update,
      })
        .then(function(resp){
          ov.remove();
          if (typeof onSaved === "function") onSaved(resp && resp.parsed);
        })
        .catch(function(e){
          console.warn('[unassigned] PATCH failed:', e);
          if (typeof global.maxAlert === "function") global.maxAlert("Save failed. " + ((e && e.message) || ""));
        });
    };
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
  // PD.331: opts.noUrlStamp forwards to the renderers. Background
  // repaints (the tripChange subscriber) MUST pass it — a repaint is
  // not a navigation, and an unflagged drawTripMode during boot was
  // pushing #/trip/<id> over a #/trip/<id>/discovery deep link
  // before the route dispatcher could honor it (hard refresh in
  // Discovery on a new trip opened an empty trip view).
  function _renderTripPage(trip, opts) {
    opts = opts || {};
    var fwd = opts.noUrlStamp ? { noUrlStamp: true } : undefined;
    if (opts.expandedDestId != null) {
      if (typeof global.drawDestMode === "function") global.drawDestMode(opts.expandedDestId, fwd);
    } else {
      if (typeof global.drawTripMode === "function") global.drawTripMode(fwd);
    }
  }

  // v360.1: shared "set aside" data source so the chip and the
  // Considered section agree on the count. Prefers mdcItems (newer
  // Discovery picker) and falls back to candidates (legacy
  // explorer) — same priority _phaseStatus uses for the chip.
  //
  // Returns an array of normalized place objects:
  //   { place, country, why, status, _src }
  //
  // Filtering rule for "set aside":
  //   - place is not currently in destinations
  //   - place isn't explicitly rejected (candidates with status === 'reject')
  //   - places already "kept" (added to trip) are filtered by the
  //     not-in-destinations check
  //
  // De-dupes by case-folded place name so a place appearing in both
  // mdcItems and candidates surfaces once.
  function _collectSetAsidePlaces(trip) {
    if (!trip) return [];
    // v360.1: "set aside" must exclude every place already adopted onto
    // the trip in any form — overnight destination, wayside on a route,
    // day-trip target, or a sight at a destination. Earlier we only
    // checked trip.destinations[].place, which missed everything in
    // routes/planItems/days. Result: classic Golden Circle stops
    // (Þingvellir, Geysir, Gullfoss) showed as "set aside" even after
    // the user had already accepted them as day-trip stops from
    // Reykjavík.
    //
    // The taken set is built from:
    //   1. trip.places{} — modern central dict; populated by the wayside
    //      generator, destination resolver, picker, and day-trip flows.
    //      Names found here are unambiguously "on the trip."
    //   2. trip.destinations[].place — legacy + still-canonical name on
    //      each destination card.
    //   3. dest.days[].items[] — legacy day-content path that pre-dates
    //      the places dict; some older trips still carry data here.
    //
    // Same shape the wayside generator uses (engine-trip.js ~1354) for
    // its dedup, so behavior is consistent across surfaces.
    var seenDest = Object.create(null);
    function _mark(name) {
      if (!name) return;
      seenDest[String(name).toLowerCase().trim()] = true;
    }
    (trip.destinations || []).forEach(function (d) {
      if (!d) return;
      _mark(d.place);
      // legacy day-items live under d.days[].items[]
      (d.days || []).forEach(function (day) {
        (day.items || []).forEach(function (it) {
          _mark(it && (it.label || it.name || it.place));
        });
      });
    });
    if (trip.places && typeof trip.places === 'object') {
      Object.keys(trip.places).forEach(function (pid) {
        var p = trip.places[pid];
        if (p) _mark(p.name);
      });
    }
    var out = [];
    var seenName = Object.create(null);
    function _push(p, src) {
      if (!p || !p.place) return;
      var k = String(p.place).toLowerCase().trim();
      if (seenDest[k]) return;       // already on the trip (any surface)
      if (seenName[k]) return;       // dedupe across sources
      if (src === 'candidate' && p.status === 'reject') return; // explicit reject
      seenName[k] = true;
      out.push({
        place: p.place,
        country: p.country || '',
        why: p.whyItFits || p.why || '',
        status: p.status || null,
        _src: src,
      });
    }
    if (Array.isArray(trip.placeActivities) && trip.placeActivities.length) {
      trip.placeActivities.forEach(function (it) {
        (it && it.requiredPlaces || []).forEach(function (p) { _push(p, 'mdc'); });
      });
    }
    // Always also walk candidates so legacy data isn't ignored when
    // mdcItems exists. De-dupe by name covers overlaps.
    if (Array.isArray(trip.candidates) && trip.candidates.length) {
      trip.candidates.forEach(function (c) { _push(c, 'candidate'); });
    }
    return out;
  }

  // v360.1 (slice 2c): Considered as a first-class collapsible section
  // between Bookings and Destinations on the shaping surface. The
  // design doc's principle: possibilities deserve real estate, not a
  // footer — so this section is expanded by default. Header carries
  // the count; tap to collapse to just the header. Lists each
  // candidate with name + region + a one-line "why it fits"; the
  // existing showConsideredCandidatesModal is still available behind
  // a "see all" link for the full add-to-trip flow.
  //
  // Hidden when the trip has zero set-aside places so we don't
  // surface an empty section. Expanded state lives in
  // trip._ui.consideredExpanded (default expanded).
  function _renderConsideredSection(trip, container) {
    if (!trip || !container) return;
    // v360.1: pull "set aside" places from the same source the chip
    // does (_phaseStatus) — mdcItems first (newer Discovery picker),
    // candidates as fallback (legacy explorer). The previous filter
    // only looked at candidates, which under-counted whenever
    // mdcItems was the active data source — the chip and the section
    // contradicted each other (chip "14 set aside" vs. section "(5)").
    // Both surfaces now agree.
    var considered = _collectSetAsidePlaces(trip);
    if (!considered.length) return;

    // PD.193 (architectural): hide the set-aside section when the
    // trip has no destinations. With "No destinations yet" + an empty
    // map, a list of 86 candidates below reads as the old Candidate
    // Explorer — exactly the surface PD.183 deprecated. The set-aside
    // section is a reference for users browsing committed destinations;
    // when there are none, the user should land in Discovery to commit,
    // not see candidates redisplayed as if this were the explorer.
    var _hasDests = Array.isArray(trip.destinations) && trip.destinations.length > 0;
    if (!_hasDests) return;

    if (!trip._ui) trip._ui = {};
    var expanded = trip._ui.consideredExpanded !== false; // default true

    var sec = document.createElement('div');
    sec.className = 'tm-section tm-considered';
    sec.style.cssText =
      'margin:10px 2px 14px;padding:12px 14px;background:#fafaf6;' +
      'border:1px dashed #d8d0c4;border-radius:8px;';

    var hdr = document.createElement('div');
    hdr.style.cssText =
      'display:flex;align-items:baseline;gap:8px;cursor:pointer;' +
      'margin-bottom:' + (expanded ? '8px' : '0') + ';';
    var ttl = document.createElement('div');
    ttl.style.cssText =
      'font-size:12px;font-weight:700;color:var(--c-accent);' +
      'text-transform:uppercase;letter-spacing:0.05em;';
    // v360.1: "Considered" implied an active mental decision the
    // user may not have made — they might have just scrolled past
    // these without considering them. "Places you set aside" is
    // honest about the actual state: they're parked, not picked
    // and not rejected. Sub copy slimmed to a one-liner action
    // hint without re-stating the heading.
    ttl.textContent = 'Places you set aside (' + considered.length + ')';
    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:10.5px;color:var(--c-ink-3);font-style:italic;flex:1;';
    sub.textContent = 'Keep these in mind or add to the trip when ready.';
    var chev = document.createElement('div');
    chev.style.cssText = 'font-size:11px;color:var(--c-ink-3);flex-shrink:0;';
    chev.textContent = expanded ? '⌃' : '⌄';
    hdr.appendChild(ttl);
    hdr.appendChild(sub);
    hdr.appendChild(chev);
    sec.appendChild(hdr);

    // List body — show up to 8 candidates inline; if there are more,
    // a "see all N" link opens the full modal where the add-to-trip
    // flow lives.
    // PD.332: ALWAYS built; expanded state only toggles display. The
    // previous toggle flipped trip._ui.consideredExpanded and called
    // drawTripMode() for a full re-render — which can bail (stale
    // picker-active class, picker overlay edge cases), leaving the
    // click apparently dead ("Considered has 129, clicking doesn't
    // show"). A self-contained display toggle can't bail.
    var body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
    body.style.display = expanded ? 'flex' : 'none';
    hdr.onclick = function () {
      var nowExpanded = body.style.display === 'none';
      trip._ui.consideredExpanded = nowExpanded;
      body.style.display = nowExpanded ? 'flex' : 'none';
      chev.textContent = nowExpanded ? '⌃' : '⌄';
      hdr.style.marginBottom = nowExpanded ? '8px' : '0';
    };
    var shown = considered.slice(0, 8);
    shown.forEach(function (c) {
      var row = document.createElement('div');
      row.style.cssText =
        'padding:8px 10px;background:var(--c-bg);border:1px dashed #d8d0c4;' +
        'border-radius:6px;display:flex;align-items:flex-start;gap:10px;';
      var left = document.createElement('div');
      left.style.cssText = 'flex:1;min-width:0;';
      var name = document.createElement('div');
      name.style.cssText = 'font-weight:600;font-size:12.5px;color:#222;';
      var nameTxt = c.place || c.name || c.label || 'Unnamed';
      if (c.country && c.country !== nameTxt) nameTxt += ' · ' + c.country;
      name.textContent = nameTxt;
      left.appendChild(name);
      if (c.whyItFits || c.why) {
        var why = document.createElement('div');
        why.style.cssText = 'font-size:11px;color:#666;margin-top:2px;line-height:1.4;';
        var whyText = String(c.whyItFits || c.why);
        if (whyText.length > 160) whyText = whyText.substring(0, 157) + '…';
        why.textContent = whyText;
        left.appendChild(why);
      }
      row.appendChild(left);
      // Small "open in modal" link per row. Could be wired to a
      // direct add-to-trip in a later slice; for now we route
      // through the existing modal which has the geography-aware
      // add path.
      var act = document.createElement('button');
      act.type = 'button';
      act.style.cssText =
        'background:transparent;border:none;color:var(--c-accent);font-family:inherit;' +
        'font-size:11px;font-weight:600;cursor:pointer;padding:2px 6px;flex-shrink:0;';
      act.textContent = '+ add →';
      act.title = 'Open the Considered list with this place highlighted';
      act.onclick = function (e) {
        e.stopPropagation();
        if (typeof global.showConsideredCandidatesModal === 'function') {
          global.showConsideredCandidatesModal();
        }
      };
      row.appendChild(act);
      body.appendChild(row);
    });

    if (considered.length > shown.length) {
      var seeAll = document.createElement('button');
      seeAll.type = 'button';
      seeAll.style.cssText =
        'background:transparent;border:none;color:var(--c-accent);font-family:inherit;' +
        'font-size:11.5px;font-weight:600;cursor:pointer;padding:6px 0 0;text-align:left;';
      seeAll.textContent = 'See all ' + considered.length + ' →';
      seeAll.onclick = function () {
        if (typeof global.showConsideredCandidatesModal === 'function') {
          global.showConsideredCandidatesModal();
        }
      };
      body.appendChild(seeAll);
    }

    sec.appendChild(body);
    container.appendChild(sec);
  }

  // v360.1 (slice 2d-i): Trip identity block — the trip's name as a
  // first-class element at the top of the body, click to rename
  // inline. Lives in the trip body (not the header) so it doesn't
  // collide with the File/Edit/Settings menu chrome. The existing
  // header's trip-name-block is hidden via CSS once this is wired
  // up (see index.html). Pairs with slice 2d-ii (⋯ menu) but ships
  // independently — body change has no menubar dependencies.
  function _renderTripIdentityBlock(trip, container) {
    if (!trip || !container) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:8px 2px 4px;padding:0;';
    var nameRow = document.createElement('div');
    // v360.1: name + pencil left-aligned, "Trip profile" chip
    // right-aligned. The chip used to live in the phase-chips strip
    // below the name; that put it visually disconnected from the
    // trip identity it's about. Trip profile = intent/preferences/
    // who's going — same conceptual cluster as the name. Adjacency
    // makes the relationship visible.
    nameRow.style.cssText =
      'display:flex;align-items:baseline;gap:8px;' +
      'padding:4px 4px;border-radius:6px;';

    // Name + pencil is a single click target for rename.
    var nameClicker = document.createElement('div');
    nameClicker.style.cssText =
      'display:flex;align-items:baseline;gap:8px;cursor:pointer;flex:1;min-width:0;' +
      'transition:background .12s ease;border-radius:6px;padding:2px 4px;margin:-2px -4px;';
    nameClicker.title = 'Click to rename';
    nameClicker.onmouseover = function () { nameClicker.style.background = '#fafafa'; };
    nameClicker.onmouseout  = function () { nameClicker.style.background = 'transparent'; };

    var nameSpan = document.createElement('span');
    nameSpan.style.cssText =
      'font-size:20px;font-weight:700;color:var(--c-ink);letter-spacing:-.01em;line-height:1.2;';
    nameSpan.textContent = trip.name || 'Untitled trip';

    var pencil = document.createElement('span');
    pencil.style.cssText = 'font-size:12px;color:#bbb;flex-shrink:0;';
    pencil.textContent = '✎';
    pencil.title = 'Click the name to rename';

    nameClicker.appendChild(nameSpan);
    nameClicker.appendChild(pencil);
    nameRow.appendChild(nameClicker);

    // v362 (HEADER-SPEC): "Trip profile" chip removed — Profile now lives in
    // ONE place, the top chrome bar (✎ Profile). The name below keeps rename.

    nameClicker.onclick = function () {
      // Swap the span for an input matching the same font/weight so
      // the row doesn't reflow when entering edit mode. Save on blur
      // or Enter; cancel on Escape.
      if (wrap.querySelector('input.identity-name-inp')) return;
      var inp = document.createElement('input');
      inp.className = 'identity-name-inp';
      inp.value = trip.name || '';
      inp.placeholder = 'Trip name';
      inp.style.cssText =
        'font-size:20px;font-weight:700;color:var(--c-ink);letter-spacing:-.01em;' +
        'background:transparent;border:none;border-bottom:1px solid #999;outline:none;' +
        'font-family:inherit;flex:1;min-width:0;padding:0;';
      var savedDisp = nameSpan.style.display;
      var savedPencilDisp = pencil.style.display;
      nameSpan.style.display = 'none';
      pencil.style.display = 'none';
      nameClicker.insertBefore(inp, nameSpan);
      inp.focus(); inp.select();
      var saved = false;
      function save() {
        if (saved) return; saved = true;
        var val = inp.value.trim() || trip.name || 'Untitled trip';
        trip.name = val;
        nameSpan.textContent = val;
        nameSpan.style.display = savedDisp;
        pencil.style.display = savedPencilDisp;
        if (inp.parentNode) inp.parentNode.removeChild(inp);
        if (typeof global.updateIndexEntry === 'function') {
          try { global.updateIndexEntry(); } catch (_) {}
        }
        if (typeof global.autoSave === 'function') {
          try { global.autoSave(); } catch (_) {}
        }
        // Also update the header's trip-name-display span so the two
        // surfaces stay in sync until 2d-ii hides the header chrome.
        var headSpan = document.getElementById('trip-name-display');
        if (headSpan) headSpan.textContent = val;
      }
      inp.onblur = save;
      inp.onkeydown = function (e) {
        if (e.key === 'Enter') inp.blur();
        if (e.key === 'Escape') { inp.value = trip.name || ''; inp.blur(); }
      };
    };

    wrap.appendChild(nameRow);
    container.appendChild(wrap);
  }

  // ─────────────────────────────────────────────────────────────
  // v360.1: Trip-view redesign slice 1 — top of the shaping surface
  //
  // Three new helpers that introduce the patterns the redesign
  // depends on:
  //   _renderTripPeekChip    — quiet "N things need you →" link to
  //                            an operational surface stub.
  //   _renderSparkIntake     — persistent "what else might matter"
  //                            input for introducing new wisps mid-
  //                            shaping (the Spark side of the
  //                            Spark↔Shape loop).
  //   _renderTripMore        — collapsed disclosure that holds the
  //                            tertiary controls displaced from the
  //                            destinations header (Tidy, Keep in
  //                            mind, Reverse, Considered, Open
  //                            Discovery).
  //
  // The destinations-list header itself is slimmed in a paired edit
  // below (_renderDestinationsListHeader) — the six buttons it
  // currently carries move into the surfaces above.
  // ─────────────────────────────────────────────────────────────

  // Collect operational items on a trip — things the world is
  // pressing on right now. Per the redesign philosophy: operational
  // ≠ "things you haven't decided yet" (that's shaping, and shaping
  // can stay loose indefinitely). Operational = "reality is forcing
  // a decision":
  //   - Open provider actions (booking confirmations the user owes
  //     someone, requiresProviderAction === true on a pendingAction).
  //   - Cancellation deadlines (calendar-driven, the universe will
  //     auto-decide if the user doesn't).
  //
  // Earlier slice 1 used computePendingActions() which also counted
  // hotel gaps, transport gaps, etc. — those are SHAPING (the user
  // might be intentionally leaving them open), not operational. The
  // chip was overcounting (48 vs the 18 the banner showed) because
  // of that. Now both surfaces share one source of truth.
  // v360.1: canonical "things you need to take care of" collector.
  // Single source of truth used by:
  //   * the trip-view peek chip (count + drilldown)
  //   * the home-dashboard panel (via _buildDashboardItems delegation)
  //   * the print + pop-out renderers
  //
  // Returns four arrays; every consumer can choose which sections to
  // show but they all agree on what counts as "needing the user."
  //
  //   actions    — open pendingActions w/ requiresProviderAction. Decisions the
  //                world is asking you to make (rebookings, refunds, replans).
  //   deadlines  — every booked item with a cancelDeadline that hasn't passed,
  //                sorted ascending by days-left. No 7-day cutoff: a far-out
  //                deadline is still real, just not urgent. UI conveys urgency
  //                with date-pill prominence + glyph (⚠ if today/past).
  //   today      — flights / hotel check-ins / hotel check-outs / booked sights
  //                whose calendar date IS today. Time-pressed by definition.
  //   tomorrow   — flights tomorrow. The home dashboard also gives this slot
  //                to flights only; broader tomorrow events stay in their own
  //                surfaces (you'll see them at the destination when you get
  //                there).
  //
  // Earlier two implementations drifted: the trip view counted all
  // deadlines without filter; the home dashboard counted only deadlines
  // within 7 days that also had cancelType === "deadline", plus today/
  // tomorrow events. A user saw 18 here and 17 on the dashboard. This
  // helper fixes both surfaces to the same arithmetic.
  function _collectOperationalItems(trip) {
    var out = { actions: [], deadlines: [], today: [], tomorrow: [] };
    if (!trip) return out;

    // ── actions ──────────────────────────────────────────
    if (Array.isArray(trip.pendingActions)) {
      out.actions = trip.pendingActions.filter(function (a) {
        return a && !a.cleared && a.requiresProviderAction;
      });
    }

    // ── deadlines ─ all open, sorted soonest-first ──────
    if (typeof global.collectDeadlines === 'function' && Array.isArray(trip.destinations)) {
      trip.destinations.forEach(function (d) {
        try {
          var ds = global.collectDeadlines(d) || [];
          if (ds.length) out.deadlines = out.deadlines.concat(ds);
        } catch (_) {}
      });
    }
    out.deadlines.sort(function (a, b) {
      return (a.deadline || '').localeCompare(b.deadline || '');
    });

    // ── today / tomorrow travel events ──────────────────
    // Mirrors the home dashboard's logic so both surfaces agree.
    // YYYY-MM-DD string comparison; tz-safe because we work in
    // local-date components throughout.
    var todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    var tomorrowD = new Date(todayD.getTime() + 86400000);
    function ymd(d) {
      // Avoid toISOString() — it shifts to UTC and can move the
      // boundary by a day. Build YYYY-MM-DD from local components.
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }
    var Tstr = ymd(todayD), Tmrstr = ymd(tomorrowD);

    // Flights at trip endpoints — first dest dateFrom = entry,
    // last dest dateTo = exit.
    if (trip.brief) {
      var b = trip.brief;
      var firstDest = (trip.destinations || [])[0];
      var lastDest = (trip.destinations || [])[(trip.destinations || []).length - 1];
      if (b.entryDetails && firstDest && firstDest.dateFrom) {
        var arriveRec = {
          kind: 'flight-arrive',
          time: b.entryDetails.time || '',
          carrier: b.entryDetails.carrier || '',
          number: b.entryDetails.number || '',
          into: firstDest.place || '',
          destId: firstDest.id || null,
          destName: firstDest.place || '',
          url: b.entryDetails.url || null,
          mode: b.entryMode || 'fly',
          date: firstDest.dateFrom,
        };
        if (firstDest.dateFrom === Tstr) out.today.push(arriveRec);
        else if (firstDest.dateFrom === Tmrstr) out.tomorrow.push(arriveRec);
      }
      if (b.exitDetails && lastDest && lastDest.dateTo) {
        var departRec = {
          kind: 'flight-depart',
          time: b.exitDetails.time || '',
          carrier: b.exitDetails.carrier || '',
          number: b.exitDetails.number || '',
          from: lastDest.place || '',
          destId: lastDest.id || null,
          destName: lastDest.place || '',
          url: b.exitDetails.url || null,
          mode: b.exitMode || 'fly',
          date: lastDest.dateTo,
        };
        if (lastDest.dateTo === Tstr) out.today.push(departRec);
        else if (lastDest.dateTo === Tmrstr) out.tomorrow.push(departRec);
      }
    }

    // Hotel check-ins/check-outs + booked sights today.
    (trip.destinations || []).forEach(function (d) {
      (d.hotelBookings || []).forEach(function (bk) {
        if (bk.status !== 'booked') return;
        if (bk.checkIn === Tstr) {
          out.today.push({
            kind: 'hotel-checkin', destId: d.id, destName: d.place || '',
            name: bk.name || 'Hotel', area: bk.area || '',
            time: bk.checkInTime || '', url: bk.url || null, date: bk.checkIn,
          });
        }
        if (bk.checkOut === Tstr) {
          out.today.push({
            kind: 'hotel-checkout', destId: d.id, destName: d.place || '',
            name: bk.name || 'Hotel', area: bk.area || '',
            time: bk.checkOutTime || '', url: bk.url || null, date: bk.checkOut,
          });
        }
      });
      (d.days || []).forEach(function (day, dayIdx) {
        (day.items || []).forEach(function (it) {
          if (!it || !it.booking || it.booking.status === 'cancelled') return;
          if (!d.dateFrom || dayIdx < 0) return;
          var dayDate = new Date(d.dateFrom + 'T12:00:00');
          dayDate.setDate(dayDate.getDate() + dayIdx);
          var dayYmd = ymd(dayDate);
          if (dayYmd === Tstr) {
            out.today.push({
              kind: 'sight-booked', destId: d.id, destName: d.place || '',
              name: it.n || it.name || 'Sight', time: it.booking.time || '',
              confirmation: it.booking.confirmationNumber || null,
              url: it.url || null, date: dayYmd,
            });
          }
        });
      });
    });

    // Sort today/tomorrow by time-of-day so the morning items lead.
    function timeKey(it) { return it.time || '99:99'; }
    out.today.sort(function (a, b) { return timeKey(a).localeCompare(timeKey(b)); });
    out.tomorrow.sort(function (a, b) { return timeKey(a).localeCompare(timeKey(b)); });

    return out;
  }
  function _countOperationalItems(trip) {
    var c = _collectOperationalItems(trip);
    return c.actions.length + c.deadlines.length + c.today.length + c.tomorrow.length;
  }

  // Render the trip-level peek chip. Sits near the top of the
  // shaping surface; only appears when there's something for the
  // operational surface to display.
  //
  // For slice 1, tapping opens a stub modal that lists the items.
  // A proper operational surface is a later slice.
  function _renderTripPeekChip(trip, container) {
    if (!trip || !container) return;
    var n = _countOperationalItems(trip);
    if (n <= 0) return; // no chip when nothing is pressing

    // v360.1: chip styled prominently — this is the trip view's
    // primary call-to-action when the world is pressing on the user.
    // Larger font, amber-tinted background, stronger border, and a
    // wider footprint than the previous quiet pill. It sits directly
    // under the dates strip; that adjacency + this weight makes it
    // unmissable on first scroll. Other phase chips remain understated
    // — only this one carries urgency, so only this one shouts.
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:0 2px 14px;';
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.style.cssText =
      'background:#fff5ec;border:1.5px solid #d8a060;color:#7a3e10;font-family:inherit;' +
      'font-size:14px;font-weight:700;padding:10px 16px;border-radius:8px;' +
      'cursor:pointer;display:inline-flex;align-items:center;gap:8px;' +
      'box-shadow:0 1px 3px rgba(0,0,0,.06);';
    // Diamond glyph carries the meaning non-color-only ("◇" = "needs you")
    chip.innerHTML = '◇ <span style="font-weight:800;">' + n + '</span> thing' +
      (n === 1 ? '' : 's') + ' need your attention <span aria-hidden="true" style="margin-left:2px;">→</span>';
    chip.title = 'See what the world is pressing on right now';
    chip.onmouseover = function () { chip.style.background = '#ffeacc'; };
    chip.onmouseout  = function () { chip.style.background = '#fff5ec'; };
    chip.onclick = function () {
      _openOperationalSurfaceStub(trip);
    };
    wrap.appendChild(chip);
    container.appendChild(wrap);
  }

  // Temporary stub for the operational surface. Renders a modal
  // showing pendingActions as a flat list. Slice 4 will replace this
  // with a proper standalone surface.
  function _openOperationalSurfaceStub(trip) {
    var existing = document.getElementById('max-op-stub');
    if (existing) { existing.remove(); }
    var ov = document.createElement('div');
    ov.id = 'max-op-stub';
    // v360.1 (slice 1.1): smaller backdrop padding so the dialog can
    // grow to use most of a laptop screen when there are many rows.
    // Mobile gets the same generous space minus the safer 4vh top
    // margin so the close button stays reachable.
    ov.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:11900;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;' +
      'font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;';
    var box = document.createElement('div');
    box.id = 'max-op-stub-box';
    // User-resizable. Initial size is the original 560×70vh, but the
    // user can drag the bottom-right corner to grow either dimension
    // up to the viewport caps. Browsers show a small triangle in the
    // corner as the affordance — native, no custom code needed.
    // `overflow:hidden` on the box itself is required for resize:both
    // to take effect; the inner body wrap is what scrolls.
    box.style.cssText =
      'background:var(--c-bg);border-radius:10px;' +
      'width:560px;height:70vh;' +
      'min-width:320px;min-height:240px;max-width:96vw;max-height:96vh;' +
      'resize:both;overflow:hidden;' +
      'display:flex;flex-direction:column;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.25);';
    // Header is sticky so the title + Print + Close stay visible while
    // scrolling a long list.
    var head = document.createElement('div');
    head.style.cssText =
      'display:flex;align-items:baseline;justify-content:space-between;gap:12px;' +
      'padding:20px 24px 12px;border-bottom:1px solid #eee;background:#fff;border-radius:10px 10px 0 0;flex-shrink:0;';
    var h = document.createElement('div');
    h.style.cssText = 'font-size:16px;font-weight:700;color:var(--c-ink);';
    h.textContent = 'What needs you';

    var actions = /** @type {any} */ (document.createElement('div'));
    actions.style.cssText = 'display:flex;align-items:center;gap:8px;';

    // Pop out → opens the same list in a separate browser window
    // the user can keep visible while working. Clicking a row in
    // that window navigates the MAIN window's destination view
    // (via window.opener) without closing the pop-out, so the user
    // can knock items down one at a time without losing their
    // place. Print is available inside the pop-out window too.
    var popoutBtn = document.createElement('button');
    popoutBtn.type = 'button';
    popoutBtn.style.cssText =
      'background:var(--c-bg);border:1px solid #d8c4a4;color:#5c4520;font-family:inherit;' +
      'font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer;';
    popoutBtn.textContent = '📋 Pop out';
    popoutBtn.title = 'Open this list in a separate window you can keep visible while you work through it';
    popoutBtn.onclick = function () { _popoutOperationalSurface(trip); };
    actions.appendChild(popoutBtn);

    // Print button — opens a printer-friendly version of the items in
    // a new window, then triggers window.print(). The popup window is
    // closed after the print dialog dismisses (browsers fire afterprint).
    var printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.style.cssText =
      'background:var(--c-bg);border:1px solid #d8c4a4;color:#5c4520;font-family:inherit;' +
      'font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:5px;cursor:pointer;';
    printBtn.textContent = '🖨 Print';
    printBtn.title = 'Open a printer-friendly version of this list';
    printBtn.onclick = function () { _printOperationalSurface(trip); };
    actions.appendChild(printBtn);

    var x = document.createElement('button');
    x.type = 'button';
    x.style.cssText = 'background:none;border:none;color:var(--c-ink-3);font-size:18px;cursor:pointer;padding:0 4px;';
    x.textContent = '✕';
    x.title = 'Close';
    x.onclick = function () { ov.remove(); };
    actions.appendChild(x);

    head.appendChild(h);
    head.appendChild(actions);
    box.appendChild(head);

    // Body wrapper that scrolls — separate from the box so the sticky
    // header stays put. Save the outer box reference so the two
    // `ov.appendChild(box)` calls below still attach the WHOLE
    // dialog (header + body) to the overlay, and re-target subsequent
    // `box.appendChild(...)` to land inside the scrollable body.
    var bodyWrap = document.createElement('div');
    bodyWrap.style.cssText = 'overflow-y:auto;padding:14px 24px 22px;flex:1;';
    box.appendChild(bodyWrap);
    var outerBox = box;
    box = bodyWrap; // SHIM: subsequent box.appendChild lands inside bodyWrap

    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:11.5px;color:var(--c-ink-3);margin-bottom:14px;line-height:1.5;';
    sub.textContent =
      'Travel events, cancellation deadlines, and open provider actions — sorted by date. ' +
      'Click any row to jump to the destination that owns it.';
    box.appendChild(sub);

    var data = _collectOperationalItems(trip);
    var actions = /** @type {any} */ (data.actions);
    var deadlines = data.deadlines;
    var todayEvents = data.today;
    var tomorrowEvents = data.tomorrow;
    var total = actions.length + deadlines.length + todayEvents.length + tomorrowEvents.length;

    if (total === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'font-size:12px;color:var(--c-ink-3);font-style:italic;padding:8px 0;';
      empty.textContent = 'Nothing the world is requiring right now — return to shaping.';
      box.appendChild(empty);
      ov.appendChild(outerBox);
      _wireBackdropClose(ov);
      document.body.appendChild(ov);
      return;
    }

    // Resolve destinations by lowercased name so we can wire click-to-jump.
    var destByName = {};
    (trip.destinations || []).forEach(function (d) {
      if (d && d.id) {
        if (d.label) destByName[String(d.label).toLowerCase()] = d.id;
        if (d.place) destByName[String(d.place).toLowerCase()] = d.id;
      }
    });
    function _destIdFor(name) {
      return destByName[String(name || '').toLowerCase()]
        || (trip.destinations[0] && trip.destinations[0].id)
        || null;
    }

    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    var fmtDateFn = (typeof global.fmtD === 'function')
      ? global.fmtD
      : function (iso) { return iso || ''; };

    // ── Unified row builder ────────────────────────────────
    // datePill is the lead element: the user reads "WHEN" first,
    // then "WHAT", then "WHERE". Urgency colour goes on the date
    // pill + border accent — never colour-only (urgent rows also
    // carry the ⚠ glyph in the pill).
    function _buildRow(opts) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText =
        'display:flex;align-items:flex-start;gap:10px;padding:9px 10px;' +
        'background:#fff;border:1px solid ' + (opts.urgent ? '#c0392b' : '#e8d8c4') + ';' +
        'border-left-width:3px;border-radius:5px;cursor:pointer;font-family:inherit;text-align:left;';
      // Date pill — fixed width so the names line up cleanly.
      var pill = document.createElement('div');
      pill.style.cssText =
        'min-width:78px;flex-shrink:0;font-size:10.5px;font-weight:700;letter-spacing:0.04em;' +
        'text-transform:uppercase;padding-top:2px;line-height:1.25;' +
        'color:' + (opts.urgent ? '#c0392b' : '#5c4520') + ';';
      pill.textContent = (opts.urgent ? '⚠ ' : '') + (opts.dateLabel || '—');
      btn.appendChild(pill);
      var col = document.createElement('div');
      col.style.cssText = 'flex:1;min-width:0;';
      var nm = document.createElement('div');
      nm.style.cssText = 'font-size:12.5px;font-weight:600;color:#222;line-height:1.4;';
      nm.textContent = opts.name || '';
      col.appendChild(nm);
      if (opts.sub) {
        var meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px;color:#666;margin-top:2px;';
        meta.textContent = opts.sub;
        col.appendChild(meta);
      }
      if (opts.detail) {
        var det = document.createElement('div');
        det.style.cssText = 'font-size:10.5px;color:var(--c-ink-3);margin-top:2px;';
        det.textContent = opts.detail;
        col.appendChild(det);
      }
      btn.appendChild(col);
      if (opts.onclick) btn.onclick = opts.onclick;
      return btn;
    }
    function _navTo(destId) {
      return function () {
        ov.remove();
        global._activeDmSection = 'tracker';
        if (typeof global.drawDestMode === 'function') global.drawDestMode(destId);
      };
    }

    // Renders a per-section header inside the same list — keeps the
    // grouping visible without visual clutter.
    function _sectionLabel(text) {
      var lbl = document.createElement('div');
      lbl.style.cssText =
        'font-size:10.5px;font-weight:700;color:var(--c-ink-3);letter-spacing:0.05em;' +
        'text-transform:uppercase;margin:10px 2px 2px;';
      lbl.textContent = text;
      return lbl;
    }

    function _eventName(it) {
      var modeIcon = { fly:'✈',train:'🚂',drive:'🚗',bus:'🚌',boat:'⛴',ferry:'⛴' }[it.mode] || '✈';
      if (it.kind === 'flight-arrive') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' → ' + (it.into || '');
      }
      if (it.kind === 'flight-depart') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' ← ' + (it.from || '');
      }
      if (it.kind === 'hotel-checkin')  return '🏨 Check-in: ' + (it.name || 'Hotel');
      if (it.kind === 'hotel-checkout') return '🏨 Check-out: ' + (it.name || 'Hotel');
      if (it.kind === 'sight-booked')   return '🎟 ' + (it.name || 'Sight');
      return it.name || 'Event';
    }
    function _eventSub(it) {
      var bits = [];
      if (it.time) bits.push(it.time);
      if (it.destName) bits.push(it.destName);
      return bits.join(' · ');
    }

    // ── TODAY ───────────────────────────────────────────
    if (todayEvents.length) {
      list.appendChild(_sectionLabel('Today'));
      todayEvents.forEach(function (it) {
        list.appendChild(_buildRow({
          dateLabel: 'TODAY',
          urgent: true,
          name: _eventName(it),
          sub: _eventSub(it),
          onclick: it.destId ? _navTo(it.destId) : null,
        }));
      });
    }

    // ── TOMORROW ────────────────────────────────────────
    if (tomorrowEvents.length) {
      list.appendChild(_sectionLabel('Tomorrow'));
      tomorrowEvents.forEach(function (it) {
        list.appendChild(_buildRow({
          dateLabel: 'TOMORROW',
          name: _eventName(it),
          sub: _eventSub(it),
          onclick: it.destId ? _navTo(it.destId) : null,
        }));
      });
    }

    // ── DEADLINES (all open, soonest-first) ─────────────
    if (deadlines.length) {
      list.appendChild(_sectionLabel('Cancellation deadlines'));
      deadlines.forEach(function (d) {
        var dd = d.deadline ? new Date(d.deadline + 'T12:00:00') : null;
        var urgent = !!dd && dd <= todayMid;
        var daysLeft = dd ? Math.round((+dd - +todayMid) / 86400000) : null;
        var label;
        if (urgent && daysLeft === 0)        label = 'TODAY';
        else if (urgent)                     label = 'PAST';
        else if (daysLeft === 1)             label = 'TOMORROW';
        else if (daysLeft != null && daysLeft <= 14) label = daysLeft + ' DAYS';
        else                                 label = fmtDateFn(d.deadline || '');
        list.appendChild(_buildRow({
          dateLabel: label,
          urgent: urgent,
          name: d.eventName || d.name || 'Cancellation deadline',
          sub: 'Cancel by ' + fmtDateFn(d.deadline || '') + ' · ' + (d.destName || d.dest || ''),
          onclick: (function (destId) { return destId ? _navTo(destId) : null; })(_destIdFor(d.destName || d.dest)),
        }));
      });
    }

    // ── PROVIDER ACTIONS ───────────────────────────────
    if (actions.length) {
      list.appendChild(_sectionLabel('Provider actions'));
      actions.forEach(function (a) {
        var detailBits = [];
        if (a.confirmationNumber) detailBits.push('Conf #' + a.confirmationNumber);
        if (a.detail) detailBits.push(a.detail);
        list.appendChild(_buildRow({
          dateLabel: 'TODO',
          name: a.eventName || a.name || 'Booking needs review',
          sub: ['Contact provider'].concat(a.destName ? [a.destName] : []).join(' · '),
          detail: detailBits.length ? detailBits.join(' · ') : '',
          onclick: (function (destId) { return destId ? _navTo(destId) : null; })(_destIdFor(a.destName)),
        }));
      });
    }

    box.appendChild(list);

    ov.appendChild(outerBox);
    _wireBackdropClose(ov);
    document.body.appendChild(ov);
  }

  // v360.1: "click outside to close" handler that doesn't fire when
  // the user was actually drag-resizing the dialog. When you drag
  // the resize handle (bottom-right corner of the box), the mouseup
  // can land outside the box on the backdrop — the resulting click
  // event has target === ov, and a naive close handler treats it as
  // an intentional close. Fix: only close if the mousedown ALSO
  // happened on the backdrop. That distinguishes a real outside-
  // click from a resize-drag that ended on the backdrop.
  function _wireBackdropClose(ov) {
    var downOnOv = false;
    ov.addEventListener('mousedown', function (e) {
      downOnOv = (e.target === ov);
    });
    ov.addEventListener('click', function (e) {
      if (e.target === ov && downOnOv) ov.remove();
      downOnOv = false;
    });
  }

  // v360.1 (slice 1.1): printer-friendly version of the operational
  // surface. Opens a new window with a clean HTML document listing
  // the deadlines + provider actions, then triggers the browser's
  // native print dialog. The popup closes itself after the user
  // either prints or cancels. Falls back to console warning if the
  // browser blocks the popup.
  function _printOperationalSurface(trip) {
    // v360.1: print mirror of the inline modal. Four sections in the
    // same order — Today → Tomorrow → Deadlines → Provider actions —
    // each row leading with a date pill so the printed list reads
    // "when, then what" instead of "what, then a date buried in the
    // sub-line." Same `_collectOperationalItems` source as every
    // other operational surface; counts always agree.
    var data = _collectOperationalItems(trip);
    var actions = /** @type {any} */ (data.actions);
    var deadlines = data.deadlines;
    var todayEvents = data.today;
    var tomorrowEvents = data.tomorrow;
    var total = actions.length + deadlines.length + todayEvents.length + tomorrowEvents.length;
    if (total === 0) {
      if (typeof global.maxAlert === 'function') {
        global.maxAlert('Nothing to print — your operational list is empty.');
      }
      return;
    }

    var w = window.open('', '_blank', 'width=800,height=900');
    if (!w) {
      console.warn('[op-print] popup blocked');
      if (typeof global.maxAlert === 'function') {
        global.maxAlert('Browser blocked the print window. Allow popups from this site and try again.');
      }
      return;
    }

    function esc(s){ return _escHtml(s); }
    var fmtDateFn = (typeof global.fmtD === 'function')
      ? global.fmtD
      : function (iso) { return iso || ''; };

    function _eventName(it) {
      var modeIcon = { fly:'✈',train:'🚂',drive:'🚗',bus:'🚌',boat:'⛴',ferry:'⛴' }[it.mode] || '✈';
      if (it.kind === 'flight-arrive') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' → ' + (it.into || '');
      }
      if (it.kind === 'flight-depart') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' ← ' + (it.from || '');
      }
      if (it.kind === 'hotel-checkin')  return '🏨 Check-in: ' + (it.name || 'Hotel');
      if (it.kind === 'hotel-checkout') return '🏨 Check-out: ' + (it.name || 'Hotel');
      if (it.kind === 'sight-booked')   return '🎟 ' + (it.name || 'Sight');
      return it.name || 'Event';
    }
    function _eventSub(it) {
      var bits = [];
      if (it.time) bits.push(it.time);
      if (it.destName) bits.push(it.destName);
      return bits.join(' · ');
    }
    // Build one printable row. urgent → red text on the pill + line.
    function _row(opts) {
      return '<li class="' + (opts.urgent ? 'urgent' : '') + '">' +
        '<div class="datepill">' + esc(opts.dateLabel || '') + '</div>' +
        '<div class="text">' +
          '<div class="line1">' + esc(opts.name || '') + '</div>' +
          (opts.sub ? '<div class="line2">' + esc(opts.sub) + '</div>' : '') +
          (opts.detail ? '<div class="line3">' + esc(opts.detail) + '</div>' : '') +
        '</div>' +
        '<div class="checkbox">☐</div>' +
      '</li>';
    }

    var tripName = (trip && trip.name) || (trip && trip.brief && trip.brief.name) || 'Trip';
    var today = new Date();
    var genStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);

    // ── TODAY ─────────────────────────────────────────────
    var todayHtml = '';
    if (todayEvents.length) {
      todayHtml = '<h2>Today</h2><ul>' +
        todayEvents.map(function (it) {
          return _row({
            dateLabel: 'TODAY',
            urgent: true,
            name: _eventName(it),
            sub: _eventSub(it),
          });
        }).join('') +
        '</ul>';
    }

    // ── TOMORROW ──────────────────────────────────────────
    var tomorrowHtml = '';
    if (tomorrowEvents.length) {
      tomorrowHtml = '<h2>Tomorrow</h2><ul>' +
        tomorrowEvents.map(function (it) {
          return _row({
            dateLabel: 'TOMORROW',
            name: _eventName(it),
            sub: _eventSub(it),
          });
        }).join('') +
        '</ul>';
    }

    // ── DEADLINES (already sorted by helper) ──────────────
    var deadlinesHtml = '';
    if (deadlines.length) {
      deadlinesHtml = '<h2>Cancellation deadlines</h2><ul>' +
        deadlines.map(function (d) {
          var dd = d.deadline ? new Date(d.deadline + 'T12:00:00') : null;
          var urgent = !!dd && dd <= todayMid;
          var daysLeft = dd ? Math.round((+dd - +todayMid) / 86400000) : null;
          var label;
          if (urgent && daysLeft === 0)        label = 'TODAY';
          else if (urgent)                     label = 'PAST';
          else if (daysLeft === 1)             label = 'TOMORROW';
          else if (daysLeft != null && daysLeft <= 14) label = daysLeft + ' DAYS';
          else                                 label = fmtDateFn(d.deadline || '');
          return _row({
            dateLabel: label,
            urgent: urgent,
            name: d.eventName || d.name || 'Cancellation deadline',
            sub: 'Cancel by ' + fmtDateFn(d.deadline || '—') +
                 (d.destName || d.dest ? ' · ' + (d.destName || d.dest) : ''),
          });
        }).join('') +
        '</ul>';
    }

    // ── PROVIDER ACTIONS ──────────────────────────────────
    var actionsHtml = '';
    if (actions.length) {
      actionsHtml = '<h2>Contact provider</h2><ul>' +
        actions.map(function (a) {
          var meta = [];
          if (a.destName) meta.push(a.destName);
          var detailBits = [];
          if (a.confirmationNumber) detailBits.push('Conf #' + a.confirmationNumber);
          if (a.detail) detailBits.push(a.detail);
          return _row({
            dateLabel: 'TODO',
            name: a.eventName || a.name || 'Booking needs review',
            sub: ['Contact provider'].concat(meta).join(' · '),
            detail: detailBits.length ? detailBits.join(' · ') : '',
          });
        }).join('') +
        '</ul>';
    }

    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>What needs you — ' + esc(tripName) + '</title>' +
      '<style>' +
        'body{font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#222;max-width:680px;margin:32px auto;padding:0 24px;}' +
        'h1{font-size:20px;margin:0 0 4px;}' +
        '.meta{font-size:11px;color:#888;margin:0 0 8px;}' +
        '.tip{font-size:11px;color:#888;font-style:italic;margin:0 0 24px;}' +
        '@media print{.tip{display:none;}}' +
        'h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#5c4520;margin:24px 0 8px;border-bottom:1px solid #e8d8c4;padding-bottom:4px;}' +
        'ul{list-style:none;padding:0;margin:0;}' +
        'li{display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:1px dashed #ddd;break-inside:avoid;}' +
        'li .datepill{flex-shrink:0;min-width:78px;font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#5c4520;padding-top:2px;}' +
        'li .text{flex:1;min-width:0;}' +
        '.line1{font-weight:600;color:#111;}' +
        '.line2{font-size:11.5px;color:#666;margin-top:2px;}' +
        '.line3{font-size:10.5px;color:#888;margin-top:2px;}' +
        '.checkbox{font-size:20px;color:#aaa;line-height:1;flex-shrink:0;}' +
        '.urgent .datepill{color:#c0392b;}' +
        '.urgent .line1{color:#c0392b;}' +
        '@media print{body{margin:0;padding:0 12mm;}.checkbox{color:#000;}}' +
      '</style></head><body>' +
      '<h1>What needs you — ' + esc(tripName) + '</h1>' +
      '<div class="meta">' +
        total + ' item' + (total === 1 ? '' : 's') +
        ' · printed ' + genStr +
      '</div>' +
      '<div class="tip">Tip: print single-sided so you have room to mark items off as you handle them. (Web pages can\'t force this — set it in the print dialog.)</div>' +
      todayHtml +
      tomorrowHtml +
      deadlinesHtml +
      actionsHtml +
      '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},120);});' +
      'window.addEventListener("afterprint",function(){window.close();});<\/script>' +
      '</body></html>';

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // v360.1 (slice 2c-ish): pop-out window for the operational surface.
  // Same pattern as _popoutDecisionsDeferred — opens a separate
  // browser window the user can resize, reposition next to the main
  // app, and work through. Each row is clickable; clicks navigate
  // the main window via window.opener without closing the pop-out.
  // Print is available via a button inside the pop-out window.
  function _popoutOperationalSurface(trip) {
    // v360.1: pop-out mirror of the inline modal. Four sections —
    // Today / Tomorrow / Cancellation deadlines / Provider actions
    // — each row leads with a date label so the user reads
    // "when, then what." Same data source as the inline modal +
    // print + home dashboard (_collectOperationalItems); counts
    // always match across surfaces.
    //
    // _popoutListWindow's row shape only has line1 + line2 (no
    // dedicated date-pill slot), so the date label is prepended to
    // line1 in uppercase. Visual hierarchy still reads "WHEN ·
    // what" — date first, then the event name.
    var data = _collectOperationalItems(trip);
    var actions = /** @type {any} */ (data.actions);
    var deadlines = data.deadlines;
    var todayEvents = data.today;
    var tomorrowEvents = data.tomorrow;
    function esc(s){ return _escHtml(s); }
    var fmtDateFn = (typeof global.fmtD === 'function')
      ? global.fmtD
      : function (iso) { return iso || ''; };
    var destByName = {};
    (trip && trip.destinations || []).forEach(function (d) {
      if (d && d.id) {
        if (d.label) destByName[String(d.label).toLowerCase()] = d.id;
        if (d.place) destByName[String(d.place).toLowerCase()] = d.id;
      }
    });
    function destIdFor(name) {
      return destByName[String(name || '').toLowerCase()] ||
        (trip && trip.destinations && trip.destinations[0] && trip.destinations[0].id) ||
        '';
    }
    function _eventName(it) {
      var modeIcon = { fly:'✈',train:'🚂',drive:'🚗',bus:'🚌',boat:'⛴',ferry:'⛴' }[it.mode] || '✈';
      if (it.kind === 'flight-arrive') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' → ' + (it.into || '');
      }
      if (it.kind === 'flight-depart') {
        return modeIcon + ' ' + (it.carrier || it.mode || 'Travel') +
          (it.number ? ' ' + it.number : '') + ' ← ' + (it.from || '');
      }
      if (it.kind === 'hotel-checkin')  return '🏨 Check-in: ' + (it.name || 'Hotel');
      if (it.kind === 'hotel-checkout') return '🏨 Check-out: ' + (it.name || 'Hotel');
      if (it.kind === 'sight-booked')   return '🎟 ' + (it.name || 'Sight');
      return it.name || 'Event';
    }
    function _eventSub(it) {
      var bits = [];
      if (it.time) bits.push(it.time);
      if (it.destName) bits.push(it.destName);
      return bits.join(' · ');
    }

    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    var sections = [];

    if (todayEvents.length) {
      sections.push({
        heading: 'Today',
        rows: todayEvents.map(function (it) {
          return {
            line1: 'TODAY · ' + esc(_eventName(it)),
            line2: esc(_eventSub(it)),
            destId: it.destId || destIdFor(it.destName),
            urgent: true,
            activeSection: 'tracker',
          };
        }),
      });
    }
    if (tomorrowEvents.length) {
      sections.push({
        heading: 'Tomorrow',
        rows: tomorrowEvents.map(function (it) {
          return {
            line1: 'TOMORROW · ' + esc(_eventName(it)),
            line2: esc(_eventSub(it)),
            destId: it.destId || destIdFor(it.destName),
            activeSection: 'tracker',
          };
        }),
      });
    }
    if (deadlines.length) {
      sections.push({
        heading: 'Cancellation deadlines',
        rows: deadlines.map(function (d) {
          var dd = d.deadline ? new Date(d.deadline + 'T12:00:00') : null;
          var urgent = !!dd && dd <= todayMid;
          var daysLeft = dd ? Math.round((+dd - +todayMid) / 86400000) : null;
          var label;
          if (urgent && daysLeft === 0)        label = 'TODAY';
          else if (urgent)                     label = 'PAST';
          else if (daysLeft === 1)             label = 'TOMORROW';
          else if (daysLeft != null && daysLeft <= 14) label = daysLeft + ' DAYS';
          else                                 label = fmtDateFn(d.deadline || '').toUpperCase();
          return {
            line1: label + ' · ' + esc(d.eventName || d.name || 'Cancellation deadline'),
            line2: 'Cancel by ' + esc(fmtDateFn(d.deadline || '—')) +
                   (d.destName || d.dest ? ' · ' + esc(d.destName || d.dest) : ''),
            destId: destIdFor(d.destName || d.dest),
            urgent: urgent,
            activeSection: 'tracker',
          };
        }),
      });
    }
    if (actions.length) {
      sections.push({
        heading: 'Contact provider',
        rows: actions.map(function (a) {
          var detailBits = [];
          if (a.confirmationNumber) detailBits.push('Conf #' + esc(a.confirmationNumber));
          if (a.detail) detailBits.push(esc(a.detail));
          return {
            line1: 'TODO · ' + esc(a.eventName || a.name || 'Booking needs review'),
            line2: ['Contact provider']
              .concat(a.destName ? [esc(a.destName)] : [])
              .concat(detailBits)
              .join(' · '),
            destId: destIdFor(a.destName),
            activeSection: 'tracker',
          };
        }),
      });
    }

    var tripName = (trip && trip.name) || (trip && trip.brief && trip.brief.name) || 'Trip';
    var today = new Date();
    var genStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    var total = todayEvents.length + tomorrowEvents.length + deadlines.length + actions.length;

    _popoutListWindow({
      title: 'What needs you — ' + esc(tripName),
      subtitle: total + ' item' + (total === 1 ? '' : 's') + ' · opened ' + genStr,
      tipHtml: 'Click a row to jump to that destination in the main window (this window stays open). Print: set single-sided in the dialog so you can mark items off as you go.',
      width: 560,
      height: 720,
      sections: sections,
    });
  }

  // Render the persistent Spark intake — an always-available
  // affordance for introducing a new wisp into the trip's
  // Spark↔Shape loop. For slice 1 the wisp lands in
  // trip.brief.tripMeta.notes (the existing "Keep in mind"
  // surface), with a confirmation toast. A later slice will route
  // it through the discovery LLM so the wisp becomes a candidate
  // place immediately.
  function _renderSparkIntake(trip, container) {
    if (!trip || !container) return;

    var wrap = document.createElement('div');
    wrap.style.cssText =
      'margin:8px 2px 14px;padding:10px 12px;background:#fbfaf6;' +
      'border:1px solid #ece2d2;border-radius:8px;display:flex;gap:8px;align-items:center;';

    var icon = document.createElement('div');
    icon.style.cssText = 'font-size:16px;flex-shrink:0;';
    icon.textContent = '✨';

    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'What else might matter on this trip?';
    inp.style.cssText =
      'flex:1;min-width:0;border:none;background:transparent;font-family:inherit;' +
      'font-size:13px;color:#333;outline:none;padding:4px 0;';
    inp.setAttribute('aria-label', 'Capture a new idea, place, or thought');

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.style.cssText =
      'background:var(--c-bg);border:1px solid #d8c4a4;color:#5c4520;font-family:inherit;' +
      'font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:5px;' +
      'cursor:pointer;flex-shrink:0;';
    addBtn.textContent = 'Capture';
    addBtn.disabled = true;

    function _updateBtnState() {
      var has = inp.value.trim().length > 0;
      addBtn.disabled = !has;
      addBtn.style.opacity = has ? '1' : '0.5';
      addBtn.style.cursor = has ? 'pointer' : 'default';
    }
    _updateBtnState();
    inp.addEventListener('input', _updateBtnState);

    function _capture() {
      var text = inp.value.trim();
      if (!text) return;
      // v360.2: wisps now live in trip.brief.tripMeta.wisps[] as
      // structured records. The Discovery LLM picks them up on the
      // next run; the Discovery panel surfaces "N new ideas to
      // evaluate" so the user knows the wisp will actually be
      // considered. Previously the wisp went to tripMeta.notes as a
      // ✨-prefixed string that Max never read — a write-only journal.
      var added = (typeof global._wispAdd === 'function')
        ? global._wispAdd(trip, text)
        : null;
      if (!added) {
        // Defensive fallback: helper missing, write to notes the old way.
        if (!trip.brief) trip.brief = {};
        if (!trip.brief.tripMeta) trip.brief.tripMeta = {};
        var existing = (trip.brief.tripMeta.notes || '').trim();
        var stamped = '✨ ' + text;
        trip.brief.tripMeta.notes = existing
          ? (existing + '\n' + stamped)
          : stamped;
      }
      inp.value = '';
      _updateBtnState();
      if (typeof global.autoSave === 'function') {
        try { global.autoSave(); } catch (_) {}
      }
      if (typeof global.showSaveStatus === 'function') {
        global.showSaveStatus('✨ Captured — Max will consider this next time Discovery runs', 3000);
      }
      // v360.3 (#104): flag the Discovery panel to pulse on next
      // render. The panel re-paints below; its renderer checks
      // window._wispJustCaptured and adds the .tm-discovery-pulse
      // class if the flag is recent. Pulls the user's eye to the
      // amber "N new ideas to evaluate" panel that just incremented.
      try { window._wispJustCaptured = Date.now(); } catch (_) {}
      // Re-render the trip view so the Discovery panel updates its
      // "N new ideas to evaluate" badge. Defer one tick so the toast
      // gets a paint frame before the (heavier) trip-view rebuild —
      // otherwise the toast can flash on and off in the same tick.
      setTimeout(function () {
        if (typeof global.drawTripMode === 'function') {
          try { global.drawTripMode(); } catch (_) {}
        }
      }, 50);
    }

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        _capture();
      }
    });
    addBtn.onclick = _capture;

    wrap.appendChild(icon);
    wrap.appendChild(inp);
    wrap.appendChild(addBtn);
    container.appendChild(wrap);

    // v360.2: "view history" link below the intake. Tapping opens the
    // captured-ideas modal where the user can see each wisp, what Max
    // produced from it, and delete either the wisp or any of its
    // produced items. Read the wisps array via window.* first (same
    // scoping quirk that made global.evaluateWispsForDiscovery fail to
    // resolve inside this IIFE).
    // Use the migration-aware helper so initial-intent wisps (from the
    // trip's original brief.intent + brief.mustDo) are counted alongside
    // any captured later via the Spark intake.
    var wispsFn = (typeof window !== 'undefined' && window._wispsArrayMigrated) ||
                  (typeof globalThis !== 'undefined' && globalThis._wispsArrayMigrated) ||
                  (typeof window !== 'undefined' && window._wispsArray) ||
                  (typeof global !== 'undefined' && global._wispsArray) || null;
    var allWisps = (typeof wispsFn === 'function') ? wispsFn(trip) : [];
    console.log('[spark-intake] wisp count check', {
      hasWispsFn: typeof wispsFn === 'function',
      onWindow: typeof window !== 'undefined' && !!window._wispsArray,
      onGlobal: typeof global !== 'undefined' && !!global._wispsArray,
      count: allWisps.length,
      sample: allWisps.slice(0, 3).map(function (w) {
        return { id: w && w.id, text: w && w.text, processedAt: w && w.processedAt };
      }),
    });
    if (allWisps.length > 0) {
      var historyRow = document.createElement('div');
      historyRow.style.cssText =
        'margin:-6px 2px 14px;padding:0 12px;text-align:right;';
      var historyLink = document.createElement('button');
      historyLink.type = 'button';
      historyLink.style.cssText =
        'background:transparent;border:none;color:var(--c-ink-3);font-family:inherit;' +
        'font-size:11px;cursor:pointer;padding:2px 4px;font-style:italic;';
      historyLink.textContent = allWisps.length + ' captured · view history →';
      historyLink.onmouseover = function () { historyLink.style.color = '#1a5fa8'; };
      historyLink.onmouseout  = function () { historyLink.style.color = '#888'; };
      historyLink.onclick = function () {
        var openFn = (typeof window !== 'undefined' && window.showWispHistoryModal) ||
                     (typeof global !== 'undefined' && global.showWispHistoryModal);
        if (typeof openFn === 'function') openFn();
      };
      historyRow.appendChild(historyLink);
      container.appendChild(historyRow);
    }
  }

  // Render the "More" disclosure — a collapsed section that holds
  // tertiary controls displaced from the destinations header. Today
  // these are always-visible buttons competing with the primary
  // destination affordances; they belong somewhere discoverable but
  // not in the user's face on every render.
  //
  // Contents:
  //   - Tidy trip      (when the trip has tidy-able structure)
  //   - Keep in mind   (notes editor)
  //   - Reverse order  (3+ destinations only)
  //   - Considered (N) (only when N > 0)
  //   - Open Discovery (only when a discovery snapshot exists)
  //
  // Collapsed by default. Expanded state is per-trip in
  // trip._ui.moreOpen so it survives re-renders within a session
  // (and survives a save, harmless if it lingers).
  function _renderTripMore(trip, container) {
    // Round NC.X: the collapsed "More" disclosure has been retired.
    // Every action it carried (Tidy trip / Keep in mind / How Max
    // thinks / Reverse trip order) now lives in the ⋯ overflow
    // popover anchored to the Destinations header. One discoverable
    // affordance instead of two parallel ones (the disclosure here
    // PLUS the standalone "↺ Reverse" inline button). The function
    // body is kept as a no-op so the call site in index.html and any
    // other consumers don't error; remove the call once the dust has
    // settled on the new ⋯ pattern.
    return;
    // eslint-disable-next-line no-unreachable
    if (!trip || !container) return;
    if (!trip._ui) trip._ui = {};
    var open = !!trip._ui.moreOpen;

    var dests = (trip && trip.destinations) || [];
    var _hubCount = 0, _sightCount = 0;
    dests.forEach(function (d) {
      if (!d) return;
      if ((d.nights || 0) >= 2) _hubCount++; else _sightCount++;
    });
    var canTidy = _hubCount >= 1 && _sightCount >= 1;
    var canReverse = dests.length >= 3;
    var consideredCount = 0;
    if (Array.isArray(trip.candidates)) {
      consideredCount = trip.candidates.filter(function (c) {
        return c && c.status !== 'keep' && c.status !== 'reject';
      }).length;
    }
    var canOpenDiscovery = !!(trip.candidates && trip.candidates.length);

    // If literally nothing would show up inside, skip the section
    // entirely — no point in a "More" button that opens to "Keep in
    // mind" alone (that one's always available).
    var anyExtras = canTidy || canReverse || consideredCount > 0 || canOpenDiscovery;

    var sec = document.createElement('div');
    sec.className = 'tm-section tm-more';
    sec.style.cssText = 'margin:14px 2px 6px;';

    var hdr = document.createElement('button');
    hdr.type = 'button';
    hdr.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;width:100%;' +
      'background:transparent;border:none;color:#666;font-family:inherit;' +
      'font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;' +
      'padding:6px 0;cursor:pointer;';
    hdr.innerHTML = 'More <span aria-hidden="true">' + (open ? '⌃' : '⌄') + '</span>';
    hdr.onclick = function () {
      trip._ui.moreOpen = !trip._ui.moreOpen;
      if (typeof global.drawTripMode === 'function') global.drawTripMode();
    };
    sec.appendChild(hdr);

    if (!open) {
      container.appendChild(sec);
      return;
    }

    var body = document.createElement('div');
    body.style.cssText =
      'padding:8px 4px 4px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--c-border-3);';

    function _addRow(label, sub, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText =
        'text-align:left;padding:8px 10px;border:1px solid #e8e2d2;background:var(--c-bg);' +
        'border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;' +
        'color:#444;display:flex;flex-direction:column;gap:2px;';
      var top = document.createElement('div');
      top.style.cssText = 'font-weight:600;';
      top.textContent = label;
      btn.appendChild(top);
      if (sub) {
        var s = document.createElement('div');
        s.style.cssText = 'font-size:10.5px;color:var(--c-ink-3);';
        s.textContent = sub;
        btn.appendChild(s);
      }
      btn.onmouseover = function () { btn.style.background = '#faf7f1'; };
      btn.onmouseout  = function () { btn.style.background = '#fff'; };
      btn.onclick = onClick;
      body.appendChild(btn);
    }

    if (canTidy) {
      _addRow(
        '🪄 Tidy trip',
        'Reshape ' + _sightCount + ' sight stop' + (_sightCount === 1 ? '' : 's') +
          ' into day trips and waysides attached to your ' + _hubCount +
          ' overnight hub' + (_hubCount === 1 ? '' : 's') + '.',
        function () {
          if (typeof global._openTidyTripPreview === 'function') global._openTidyTripPreview();
        }
      );
    }

    _addRow(
      '🔬 Keep in mind for your trip',
      'Links, reservations, reminders to look up — and captured ideas from the ✨ intake above.',
      function () {
        if (typeof global._pmEnsureResearchMeta === 'function') global._pmEnsureResearchMeta();
        if (typeof global._pmOpenTripResearchCard === 'function') global._pmOpenTripResearchCard();
      }
    );

    // v360.3 (#110): demoted entry point to the late-binding philosophy
    // overview. Lives in More so it's discoverable without competing
    // with primary actions. Same modal the home-screen footer link
    // opens — single source of truth for the philosophy content.
    _addRow(
      '🌊 How Max thinks',
      'A river is a chaotic system; you prepare, not predict. The wisp arc and the case for late binding.',
      function () {
        if (typeof global.showAboutMax === 'function') global.showAboutMax();
      }
    );

    if (canReverse) {
      _addRow(
        '↺ Reverse trip order',
        'Flip the order of destinations on this trip.',
        function () {
          if (typeof global.reverseTripOrder === 'function') global.reverseTripOrder();
        }
      );
    }

    // v360.1 (slice 2c): Considered row removed from More — it's
    // now a first-class section between Bookings and Destinations
    // (see MaxTripUI.renderConsideredSection). Leaving it here would
    // duplicate the affordance.

    // v360.2: Open Discovery row removed from More — the Discovery
    // panel above the destinations list now carries that affordance as
    // a first-class button. Leaving it here would duplicate.
    if (false /* canOpenDiscovery */) {
      _addRow(
        '✎ Open Discovery',
        'Re-open Discovery with your current keep/reject decisions and notes.',
        function () {
          if (typeof global.reopenPickerForEdit === 'function' &&
              trip && Array.isArray(trip.placeActivities) && trip.placeActivities.length) {
            global.reopenPickerForEdit();
          } else if (typeof global.reopenCandidateExplorer === 'function') {
            global.reopenCandidateExplorer();
          }
        }
      );
    }

    if (!anyExtras) {
      var note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:#999;font-style:italic;padding:4px 0;';
      note.textContent = 'Nothing else right now.';
      body.appendChild(note);
    }

    sec.appendChild(body);
    container.appendChild(sec);
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
    // v360.1 — trip-view redesign slice 1: top of the shaping surface:
    renderTripPeekChip:          _renderTripPeekChip,
    renderSparkIntake:           _renderSparkIntake,
    renderTripMore:              _renderTripMore,
    // v360.1 — slice 2d-i: trip identity block (name in body).
    renderTripIdentityBlock:     _renderTripIdentityBlock,
    // v360.1 — slice 2c: Considered as a standalone section.
    renderConsideredSection:     _renderConsideredSection,
    // PD.332: exposed so showConsideredCandidatesModal (index.html)
    // lists the SAME union set (mdcItems ∪ candidates) the section
    // header counts. The modal previously read only trip.candidates,
    // so a Discovery-driven trip showed "(129)" on the section but
    // the modal found nothing to display.
    collectSetAsidePlaces:       _collectSetAsidePlaces,
    // v360.3: exposed so drawTripMode can call it at the bottom of the
    // trip view (moved out of renderTripOverviewStrips).
    renderDiscoveryPromptPanel:  _renderDiscoveryPromptPanel,
    // v360.3: exposed so drawTripMode can place these at user-requested
    // positions (geo-affordance / "Day trips" tips between Trip
    // Bookings and Add Waysides; decisions-deferred / "Itinerary empty
    // days" between Spark intake and Destinations).
    // v360.1: canonical operational-items collector. Exposed so the
    // home dashboard (index.html _buildDashboardItems) can delegate
    // instead of maintaining a second implementation.
    collectOperationalItems:     _collectOperationalItems,
    countOperationalItems:       _countOperationalItems,
    renderArrivalDeparturePanel: _renderArrivalDeparturePanel,
    // v360.4 (#124 follow-up) — ambient Traveler Profile panel on
    // the trip page, surfaced right under Arrival/Departure.
    renderTravelerProfilePanel:  _renderTravelerProfilePanel,
    // v359.60.91 — trip-level Bookings (flights + car rentals
    // that don't anchor to a single destination):
    renderTripLevelBookings:     _renderTripLevelBookings,
    // v360.0.8 — wayside generation banner + per-route rendering:
    renderWaysidePromptBanner:   _renderWaysidePromptBanner,
    // v360.3 (#122): parallel day-trip action panel.
    renderDayTripPromptBanner:   _renderDayTripPromptBanner,
    renderRouteWaysides:         _renderRouteWaysides,
    // TM.3f (v323) — per-destination card render:
    renderTripDestinationCard:   _renderTripDestinationCard,
    // TM.7.2 (v331) — dest-mode pieces lifted from drawDestMode:
    renderTravelerNotes:         _renderTravelerNotes,
    // v353.2 — research surface (per-destination homework + links).
    renderResearch:              _renderResearch,
    // TM.7.3 (v332):
    renderPendingCancellationsBanner: _renderPendingCancellationsBanner,
    // v359.60.60:
    renderActionNeededAlert:          _renderActionNeededAlert,
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
    // v359.60.69:
    renderDestBookingsPane:           _renderDestBookingsPane,
    // v359.50: 3-tab grouping helpers — used by the explore pane in
    // index.html and any future call sites that need to know which
    // tab group a pane belongs to.
    _activeDmTab:                     _activeDmTab,
    _isPaneInActiveGroup:             _isPaneInActiveGroup,
    // TM.5 final (v333): single dispatcher entry point.
    renderTripPage:                   _renderTripPage,
    // v359.60.16: self-heal helper — exposed so drawTripMode (in
    // index.html) can call it at render time to silently fix trip
    // destination order whenever entry/exit cities are out of place.
    // Returns # of moves; 0 means order was already correct.
    reorderTripByEntryExit:           _reorderTripByEntryExit,
    // v359.60.18: coord-aware middle re-sort. Catches trips built
    // before the (0,0)-coord filter where criss-cross orderings
    // shipped from buildFromCandidates. Only fires when the new
    // path is meaningfully shorter (< 60% of current), so user
    // manual reorderings on saner trips aren't disturbed.
    geoHealTripOrder:                 _geoHealTripOrder,
    // v359.60.19: merge duplicate destinations (same place name)
    // into a single keeper, summing nights and concatenating
    // bookings/locations/etc. Runs before geo-heal so the NN sort
    // doesn't waste effort on dupes.
    dedupeTripDestinations:           _dedupeTripDestinations,
  };

  // No back-compat aliases yet — desktop still uses its inline
  // mkItinItem / mkDay. MA.4 introduces aliases when those move.

})(typeof window !== 'undefined' ? window : this);


export {};
