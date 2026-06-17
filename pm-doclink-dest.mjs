// @ts-check
import TripStore from "./tripstore.mjs";
import PlaceKey from "./place-key.mjs";
// pm-doclink-dest.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Place-meta doc-link picker + destination keep/nights toggles.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────
function _pmDocLinkPickerClose(){
  var pop = document.getElementById("pm-doclink-picker");
  if (!pop) return;
  if (pop._pmKeyHandler) document.removeEventListener("keydown", pop._pmKeyHandler, true);
  if (pop._pmOutsideHandler) document.removeEventListener("mousedown", pop._pmOutsideHandler, true);
  pop.remove();
}
function _pmDocLinkPickerShow(ed){
  _pmDocLinkPickerClose();
  var m = window._pmActiveResearchMeta;
  if (!m || !Array.isArray(m.docs) || !m.docs.length) return;
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var rect = range.getBoundingClientRect();
  var edRect = ed.getBoundingClientRect();
  var x = (rect.left || edRect.left + 20);
  var y = (rect.bottom || edRect.top + 30);

  var pop = document.createElement("div");
  pop.id = "pm-doclink-picker";
  pop.style.cssText = "position:fixed;z-index:13500;background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.2);min-width:240px;max-width:340px;max-height:280px;overflow-y:auto;font-family:inherit;font-size:13px;";
  pop.style.left = Math.max(8, Math.min(x, window.innerWidth - 360)) + "px";
  pop.style.top  = Math.max(8, Math.min(y + 4, window.innerHeight - 290)) + "px";
  pop._pmEditor = ed;
  pop._pmQuery = "";
  // PD.51: snapshot the doc id we're CURRENTLY editing, if any —
  // surface it as a self-reference exclusion to avoid recursive opens.
  pop._pmCurrentDocId = null;
  var editorOv = document.getElementById("pm-doc-editor");
  if (editorOv && editorOv._pmEditingDocId) pop._pmCurrentDocId = editorOv._pmEditingDocId;

  function render(){
    var q = (pop._pmQuery || "").toLowerCase();
    var matches = m.docs.filter(function(d){
      if (d.id === pop._pmCurrentDocId) return false;
      if (!q) return true;
      return (d.title || "").toLowerCase().indexOf(q) !== -1;
    }).slice(0, 8);
    if (!matches.length) {
      pop.innerHTML = '<div style="padding:10px 14px;color:#999;font-style:italic;">No matching documents</div>';
      return;
    }
    pop.innerHTML = matches.map(function(d){
      var title = (d.title || "Untitled").replace(/</g, "&lt;");
      return '<div class="pm-doclink-row" data-id="' + d.id + '" data-title="' + title.replace(/"/g, "&quot;") + '" style="padding:8px 14px;cursor:pointer;border-bottom:1px solid var(--c-border-4);">[doc] ' + title + '</div>';
    }).join('');
    pop.querySelectorAll(".pm-doclink-row").forEach(function(row){
      row.onmouseenter = function(){ this.style.background = "#f5f5f5"; };
      row.onmouseleave = function(){ this.style.background = "transparent"; };
      row.onmousedown  = function(ev){ ev.preventDefault(); };  // keep editor selection
      row.onclick = function(){
        var id = this.getAttribute("data-id");
        var title = this.getAttribute("data-title");
        _pmDocLinkInsert(ed, id, title);
        _pmDocLinkPickerClose();
      };
    });
  }
  render();
  pop._pmRender = render;
  document.body.appendChild(pop);

  function onKey(e){
    if (e.key === "Escape") {
      e.stopPropagation();
      _pmDocLinkPickerClose();
    }
  }
  document.addEventListener("keydown", onKey, true);
  pop._pmKeyHandler = onKey;
  function onOutside(e){
    if (!pop.contains(e.target) && e.target !== ed && !ed.contains(e.target)) {
      _pmDocLinkPickerClose();
    }
  }
  setTimeout(function(){ document.addEventListener("mousedown", onOutside, true); }, 0);
  pop._pmOutsideHandler = onOutside;
}
function _pmDocLinkInsert(ed, docId, docTitle){
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) { ed.focus(); }
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var anchor = range.endContainer;
  var offset = range.endOffset;
  // Delete the trailing [[query if present in this text node
  if (anchor.nodeType === 3) {
    var text = anchor.textContent;
    var idx = text.lastIndexOf("[[", offset);
    if (idx !== -1) {
      range.setStart(anchor, idx);
      range.setEnd(anchor, offset);
      range.deleteContents();
    }
  }
  var span = document.createElement("span");
  span.className = "pm-doclink";
  span.setAttribute("data-doc-id", docId);
  span.setAttribute("contenteditable", "false");
  span.textContent = docTitle;
  var r = sel.getRangeAt(0);
  r.insertNode(span);
  // trailing nbsp so the caret has somewhere to land
  var sp = document.createTextNode("\u00a0");
  r.setStartAfter(span);
  r.insertNode(sp);
  r.setStartAfter(sp);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
function _pmDocLinkNavigate(docId){
  var m = window._pmActiveResearchMeta;
  if (!m || !Array.isArray(m.docs)) return;
  var targetIdx = -1;
  for (var i = 0; i < m.docs.length; i++) {
    if (m.docs[i].id === docId) { targetIdx = i; break; }
  }
  if (targetIdx === -1) {
    if (typeof _pmShowUndo === "function") {
      _pmShowUndo("Linked document not found (may have been deleted)", function(){});
    }
    return;
  }
  // Save & close the currently-open doc editor by clicking Done.
  var editor = document.getElementById("pm-doc-editor");
  if (editor) {
    var done = editor.querySelector("#pm-doc-edit-done");
    if (done) done.click();
  }
  setTimeout(function(){
    if (typeof _pmDocOpen === "function") _pmDocOpen(targetIdx);
  }, 60);
}
if (typeof globalThis !== "undefined") {
  globalThis._pmDocLinkPickerShow = _pmDocLinkPickerShow;
  globalThis._pmDocLinkPickerClose = _pmDocLinkPickerClose;
  globalThis._pmDocLinkInsert = _pmDocLinkInsert;
  globalThis._pmDocLinkNavigate = _pmDocLinkNavigate;
}


if (typeof globalThis !== "undefined") {
  if (typeof _pmSearchNotes !== "undefined") globalThis._pmSearchNotes = _pmSearchNotes;
  if (typeof _pmRenderNotesSearchResults !== "undefined") globalThis._pmRenderNotesSearchResults = _pmRenderNotesSearchResults;
  if (typeof _pmOpenSearchedDoc !== "undefined") globalThis._pmOpenSearchedDoc = _pmOpenSearchedDoc;
}
if (typeof globalThis !== "undefined") {
  if (typeof _pmDocsEnsure !== "undefined") globalThis._pmDocsEnsure = _pmDocsEnsure;
  if (typeof _pmDocsRender !== "undefined") globalThis._pmDocsRender = _pmDocsRender;
  if (typeof _pmDocsReadFromDom !== "undefined") globalThis._pmDocsReadFromDom = _pmDocsReadFromDom;
  if (typeof _pmDocsSyncToNotes !== "undefined") globalThis._pmDocsSyncToNotes = _pmDocsSyncToNotes;
  if (typeof _pmDocsSetActive !== "undefined") globalThis._pmDocsSetActive = _pmDocsSetActive;
  if (typeof _pmDocsClearActive !== "undefined") globalThis._pmDocsClearActive = _pmDocsClearActive;
  if (typeof _pmDocAdd !== "undefined") globalThis._pmDocAdd = _pmDocAdd;
  if (typeof _pmDocRemove !== "undefined") globalThis._pmDocRemove = _pmDocRemove;
}

// Round PD.16: toggle the place's presence on the trip. Routes
// through MaxRoleWriter so the c.role/c.status/placeMeta/_keep
// surfaces stay in sync — the legitimate-exception #2 from PD.15
// was a rationalization; this is the real fix. Uncheck → "maybe"
// (clears _keep without touching c.role); check → restore prior role
// or derive from LLM hint via _pmRoleForCheck.
function toggleDestKeep(placeName){
  if (!placeName) return;
  if (typeof _pmEnsureCandidate === "function") _pmEnsureCandidate(placeName);
  if (typeof MaxRoleWriter === "undefined" || !MaxRoleWriter || typeof MaxRoleWriter.set !== "function") return;
  // H1: key via the canonical normalizer so this anyKept scan agrees with the
  // surgical DOM update (_pmSurgicalKeepUpdate, which uses _normPlaceName) and
  // with MaxRoleWriter. A raw toLowerCase mismatched on alias/diacritic places,
  // so the role write and the checkbox could disagree and flip a kept place off
  // — the disappearing-place class the PlaceKey layer exists to prevent.
  var nf = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var key = nf(placeName);
  var anyKept = false;
  (_tb.placeActivities || []).forEach(function(item){
    (item.requiredPlaces || []).forEach(function(p){
      if (p && p.place && nf(p.place) === key && p._keep) anyKept = true;
    });
  });
  var nextRole = anyKept ? "maybe" : _pmRoleForCheck(placeName);
  // PD.450 (#5: render reads, never writes). A keep-toggle never moves a row —
  // it only flips ONE place's checked state — so re-rendering all ~400 rows
  // (the "it rewrites the entire screen" flash) is pure waste. We flip just this
  // place's checkbox in the DOM. But MaxRoleWriter.set persists, which emits a
  // tripChange whose listener would re-render the WHOLE list and undo the win —
  // so announce a surgical toggle is in flight; the listener reflects THIS place
  // surgically and skips the full redraw.
  // R5: scope the hint to EXACTLY the MaxRoleWriter.set() call. set() persists
  // and emits tripChange synchronously (TripStore.batch → emit, all sync), so
  // the picker listener has already consumed the hint by the time set() returns
  // — clearing it right after is safe and means any LATER tripChange in this
  // same tick correctly gets a full render. The old setTimeout(0) left the hint
  // set through the rest of the tick + all microtasks, so any unrelated same-
  // tick tripChange was mis-handled as surgical and skipped its needed redraw.
  try { if (typeof window !== "undefined") window._pmSurgicalToggleInFlight = placeName; } catch (_) {}
  var _setOk = MaxRoleWriter.set(placeName, nextRole);
  try { if (typeof window !== "undefined") window._pmSurgicalToggleInFlight = null; } catch (_) {}
  if (!_setOk) return;
  _pmSurgicalKeepUpdate(placeName);
  _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
}

// PD.450: flip the checkbox + row state for EVERY row showing this place,
// in place, without touching the rest of the list. Reads current keep-state
// from the records (the single source of truth) — never writes.
function _pmSurgicalKeepUpdate(placeName){
  try {
    if (!placeName) return;
    var nf = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
    var pk = nf(placeName);
    var kept = false;
    (_tb && _tb.placeActivities || []).forEach(function(it){
      (it && it.requiredPlaces || []).forEach(function(p){ if (p && p.place && nf(p.place) === pk && p._keep) kept = true; });
    });
    var listEl = (typeof document !== "undefined") && document.getElementById("tb-place-act-list");
    if (!listEl) return;
    var rows = listEl.querySelectorAll(".tb-act-table-row[data-place]");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (nf(row.getAttribute("data-place")) !== pk) continue;
      row.classList.toggle("on", kept);
      row.classList.toggle("off", !kept);
      var chk = row.querySelector(".tb-act-check");
      if (chk) chk.classList.toggle("on", kept);
    }
  } catch (_) {}
}
if (typeof globalThis !== "undefined") globalThis._pmSurgicalKeepUpdate = _pmSurgicalKeepUpdate;

// v360.2: section-scoped toggle. When a destination appears in
// multiple picker sections ("Cities", "Hot springs", etc.) and some
// rows show it checked while others don't, the global toggleDestKeep
// flips all of them at once based on "anyKept" logic — which means
// clicking to CHECK it in a section where it was unchecked actually
// unchecks it everywhere (because "anyKept = true" triggers drop-all).
//
// This variant scopes the toggle to items in the named section only,
// matching the user's mental model: this checkbox belongs to this row,
// it should affect this row's place references, not every other row.
// Round PD.16: section-scoping retired. A place is on the trip or
// it isn't; whether it shows in section A or B is organization, not
// state. Delegate to toggleDestKeep so the cross-surface write
// goes through MaxRoleWriter. The section parameter is preserved
// for caller back-compat but ignored.
function toggleDestKeepInSection(placeName, sectionName){
  return toggleDestKeep(placeName);
}
if (typeof globalThis !== "undefined") globalThis.toggleDestKeepInSection = toggleDestKeepInSection;

// Stepper applied to a destination — bumps nights on every requiredPlaces
// entry matching this place (across all activities). Routes are skipped
// because routes are transit (nights stay 0).
function _adjustDestNights(placeName, delta){
  var items = _tb.placeActivities || [];
  // L1: same canonical keying as toggleDestKeep/_pmSurgicalKeepUpdate so the
  // nights stepper hits alias/diacritic places too (raw toLowerCase missed them).
  var nf = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var key = nf(placeName);
  // Find current max
  var current = 0;
  items.forEach(function(item){
    if (item.type === "route") return;
    (item.requiredPlaces||[]).forEach(function(p){
      if (p && p.place && nf(p.place) === key) {
        var n = parseInt(p.nights, 10);
        if (isFinite(n) && n > current) current = n;
      }
    });
  });
  if (!current) current = 2;
  var next = current + delta;
  if (next < 1) next = 1;
  if (next > 14) next = 14;
  items.forEach(function(item){
    if (item.type === "route") return;
    (item.requiredPlaces||[]).forEach(function(p){
      if (p && p.place && nf(p.place) === key) p.nights = next;
    });
  });
  _renderPlaceActivityItems();
  _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
}

// Toggle all places under an activity. If any place was kept, drops them all;
// if none were kept, keeps them all. Drives the activity's "checked" derived
// state, which the renderer reads on the next pass.
function togglePlaceActivity(id){
  var items = _tb.placeActivities || [];
  var item = null;
  for(var i=0;i<items.length;i++){ if(items[i].id === id){ item = items[i]; break; } }
  if (!item) return;
  // #Place D 2.5: route through MaxRoleWriter.set (the canonical writer) instead
  // of writing p._keep directly. A direct write is reverted by the re-render's
  // reconcile (which re-derives _keep from the decision); set() stamps the
  // decision so the toggle STICKS and _keepOf stays authoritative. Mirrors the
  // single-place path (_pmRemoveFromList / toggleDestKeep).
  var _keepFn = (typeof _keepOf === "function") ? _keepOf : function(p){ return !!(p && p._keep); };
  var anyKept = (item.requiredPlaces||[]).some(function(p){ return p && _keepFn(p); });
  var newKeep = !anyKept; // if anything was kept, turn all off; else turn all on
  if (typeof MaxRoleWriter !== "undefined" && MaxRoleWriter && typeof MaxRoleWriter.set === "function") {
    // collect names first — set() works by name on _tb.candidates, so it is
    // robust to any placeActivities rebuild a per-set emit might trigger.
    var _names = (item.requiredPlaces||[]).map(function(p){ return p && p.place; }).filter(Boolean);
    _names.forEach(function(nm){
      if (typeof _pmEnsureCandidate === "function") _pmEnsureCandidate(nm);
      var role = newKeep ? ((typeof _pmRoleForCheck === "function") ? _pmRoleForCheck(nm) : "see") : "maybe";
      MaxRoleWriter.set(nm, role, { persist: false });   // batch: persist once below
    });
    if (typeof autoSave === "function") { try { autoSave(); } catch(_){} }
  } else {
    (item.requiredPlaces||[]).forEach(function(p){ if (p) p._keep = newKeep; }); // fallback
  }
  item.checked = newKeep;
  _renderPlaceActivityItems();
  _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
  // Round NC.X: focus the picker map on the first required-place of
  // the toggled activity. When the user just CHECKED a multi-place
  // activity, the first place is the most useful anchor (the others
  // get a size bump on next render via _pmFocusKey persistence). When
  // unchecking, the focus still pans/pulses so the user sees what
  // they just deselected.
  if (typeof _pmFocusPlace === "function") {
    var firstP = (item.requiredPlaces || []).find(function(p){ return p && p.place; });
    if (firstP) _pmFocusPlace(firstP.place);
  }
}

// Toggle a single place within an activity row. Doesn't affect other places
// in the row. The activity's master checkbox derives from "any place kept."
function togglePlaceInActivity(itemId, placeIdx){
  var items = _tb.placeActivities || [];
  var item = null;
  for(var i=0;i<items.length;i++){ if(items[i].id === itemId){ item = items[i]; break; } }
  if (!item || !Array.isArray(item.requiredPlaces) || !item.requiredPlaces[placeIdx]) return;
  var p = item.requiredPlaces[placeIdx];
  p._keep = !p._keep;
  // Recompute activity-level derived state
  item.checked = item.requiredPlaces.some(function(pp){ return pp && pp._keep; });
  _renderPlaceActivityItems();
  _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
  // Round NC.X: pan + pulse the toggled place on the picker map.
  if (typeof _pmFocusPlace === "function" && p && p.place) _pmFocusPlace(p.place);
}

// Round NC.X: by-Place mode checkbox writer — flips _keep on EVERY
// requiredPlace ref for this place across every activity. The by-Place
// view shows a single row per place; the checkbox should affect every
// ref consistently. New _keep state = !any currently kept.
// Round PD.16: by-Place mode toggle now delegates to the same
// place-level writer toggleDestKeep uses. The old direct-write
// version was the same parallel path as toggleDestKeep — a place
// is one thing whether you got to it via Activity or Place mode.
function togglePlaceByPlaceMode(placeName){
  toggleDestKeep(placeName);
  if (typeof _pmFocusPlace === "function" && placeName) _pmFocusPlace(placeName);
}
if (typeof globalThis !== "undefined") globalThis.togglePlaceByPlaceMode = togglePlaceByPlaceMode;

// Round PD.15: _pmRemoveFromList + _pmUnRejectFromList route
// through MaxRoleWriter.set (the canonical writer per the contract
// at MaxRoleWriter's definition). Earlier PD.10 versions wrote
// _rejected and p._keep directly — a parallel path that bypassed
// the writer, exactly the architectural drift the writer was
// supposed to prevent. The "reject" role sets c.status="reject",
// _keep=false, _rejected=true, m.stayOverride=null in one atomic
// pass; "maybe" undoes it (status=null, _keep=true, _rejected=false).
function _pmRemoveFromList(placeName){
  if (!placeName) return;
  if (typeof _pmEnsureCandidate === "function") _pmEnsureCandidate(placeName);
  if (typeof MaxRoleWriter === "undefined" || !MaxRoleWriter || typeof MaxRoleWriter.set !== "function") return;
  // PD.50: capture prior role for undo before we reject.
  var priorRole = "maybe";
  try {
    if (typeof _pmIsStayCandidate === "function") {
      priorRole = _pmIsStayCandidate(placeName) ? "stay" : "see";
    }
  } catch(_){}
  if (!MaxRoleWriter.set(placeName, "reject")) return;
  if (typeof _renderPlaceActivityItems === "function") _renderPlaceActivityItems();
  if (typeof _updatePlaceActivitySummary === "function") _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
  if (typeof _pmShowUndo === "function") {
    _pmShowUndo("Removed " + placeName + " from list", function(){
      MaxRoleWriter.set(placeName, priorRole);
      if (typeof _renderPlaceActivityItems === "function") _renderPlaceActivityItems();
      if (typeof _updatePlaceActivitySummary === "function") _updatePlaceActivitySummary();
      if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
    });
  }
}
if (typeof globalThis !== "undefined") globalThis._pmRemoveFromList = _pmRemoveFromList;

function _pmUnRejectFromList(placeName){
  if (!placeName) return;
  if (typeof MaxRoleWriter === "undefined" || !MaxRoleWriter || typeof MaxRoleWriter.set !== "function") return;
  if (!MaxRoleWriter.set(placeName, "maybe")) return;
  if (typeof _renderPlaceActivityItems === "function") _renderPlaceActivityItems();
  if (typeof _updatePlaceActivitySummary === "function") _updatePlaceActivitySummary();
  if (typeof _refreshAllPlacePickerMaps === "function") _refreshAllPlacePickerMaps();
}
if (typeof globalThis !== "undefined") globalThis._pmUnRejectFromList = _pmUnRejectFromList;

// Round PD.14 (v360.5): stay/see toggle routed through MaxRoleWriter
// — the canonical atomic writer that updates c.role + c._roleTouched
// + c.status + placeMeta.stayOverride + requiredPlace flags (_keep,
// _isDayTrip, _waysideFromHub, _rejected) in one shot. PD.12's
// version wrote only placeMeta and let the rest of the surfaces
// silently disagree — exactly the architectural drift that earlier
// rounds were chasing.
//
// Includes a candidate-ensure step: many Discovery places come from
// placeActivities without ever being bridged to _tb.candidates, and
// MaxRoleWriter returns null when no candidate is found. We
// synthesize one if needed so the toggle always lands.
function _pmEnsureCandidate(placeName){
  if (!_tb || !placeName) return null;
  if (!Array.isArray(_tb.candidates)) _tb.candidates = [];
  // PD.84 (architectural): candidate identity is defined by normalized
  // name, not raw lowercase. Otherwise minor LLM variants ("Akureyri "
  // with trailing space, "Akureyri (Iceland)", a diacritic the user
  // didn't type) created a parallel stub candidate. The popup's
  // _pmMetaKey-based lookup later matched BOTH (same _normPlaceName)
  // and Array.find returned the FIRST — usually the LLM original
  // without _roleTouched — so user-listed stays still read as
  // "Max suggests". Using _normPlaceName here matches the rest of
  // the system (MaxRoleWriter, _pmMetaKey, picker lookups), so a
  // candidate is found whenever one exists for that normalized name.
  var nrm = (typeof _normPlaceName === "function")
    ? _normPlaceName
    : function(s){ return String(s||"").toLowerCase().trim(); };
  var key = nrm(placeName);
  var cand = _tb.candidates.find(function(c){
    return c && c.place && nrm(c.place) === key;
  });
  if (cand) return cand;
  // Minimal stub — MaxRoleWriter will populate role/_roleTouched/status.
  // Mirrors the synthesis shape publishTrip's reconciliation uses.
  var country = "";
  try {
    (_tb.placeActivities || []).some(function(a){
      return (a.requiredPlaces || []).some(function(p){
        if (p && p.place && nrm(p.place) === key && p.country) {
          country = p.country;
          return true;
        }
        return false;
      });
    });
  } catch(_){}
  cand = {
    id: "p-disc-" + Date.now().toString(36) + "-" + Math.floor(Math.random()*10000).toString(36),
    place: placeName,
    country: country,
    role: "see",
    status: "keep",
    _required: false,
    intent: ""
  };
  _tb.candidates.push(cand);
  return cand;
}
if (typeof globalThis !== "undefined") globalThis._pmEnsureCandidate = _pmEnsureCandidate;

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._adjustDestNights = _adjustDestNights;
  __expg._pmDocLinkInsert = _pmDocLinkInsert;
  __expg._pmDocLinkNavigate = _pmDocLinkNavigate;
  __expg._pmDocLinkPickerClose = _pmDocLinkPickerClose;
  __expg._pmDocLinkPickerShow = _pmDocLinkPickerShow;
  __expg._pmEnsureCandidate = _pmEnsureCandidate;
  __expg._pmRemoveFromList = _pmRemoveFromList;
  __expg._pmSurgicalKeepUpdate = _pmSurgicalKeepUpdate;
  __expg._pmUnRejectFromList = _pmUnRejectFromList;
  __expg.toggleDestKeep = toggleDestKeep;
  __expg.toggleDestKeepInSection = toggleDestKeepInSection;
  __expg.togglePlaceActivity = togglePlaceActivity;
  __expg.togglePlaceByPlaceMode = togglePlaceByPlaceMode;
  __expg.togglePlaceInActivity = togglePlaceInActivity;
}
