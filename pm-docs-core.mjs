// @ts-check
// pm-docs-core.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Place-meta docs core: format/strip, ensure/render/sync notes.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────

// PD.56: strip HTML for body snippet preview (no entity decoding needed
// beyond &nbsp; — these notes are user prose, not adversarial).
function _pmStripHtml(html){
  if (!html) return "";
  var tmp = document.createElement("div");
  tmp.innerHTML = html;
  var t = tmp.textContent || tmp.innerText || "";
  return t.replace(/\s+/g, " ").trim();
}
if (typeof globalThis !== "undefined") globalThis._pmStripHtml = _pmStripHtml;

function _pmFmtRelative(iso){
  if (!iso) return "";
  var t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  var diff = Date.now() - t;
  if (diff < 0) diff = 0;
  var sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  var min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  var day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return day + "d ago";
  var d = new Date(iso);
  var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  var y = d.getFullYear();
  var nowY = new Date().getFullYear();
  return mo + " " + d.getDate() + (y !== nowY ? ", " + y : "");
}
function _pmFmtAbsolute(iso){
  if (!iso) return "";
  var d = new Date(iso);
  if (!isFinite(d.getTime())) return "";
  var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return mo + " " + d.getDate() + ", " + d.getFullYear();
}
if (typeof globalThis !== "undefined") {
  globalThis._pmFmtRelative = _pmFmtRelative;
  globalThis._pmFmtAbsolute = _pmFmtAbsolute;
}

function _pmDocsEnsure(m){
  if (!m) return;
  if (!Array.isArray(m.docs)) m.docs = [];
  if (m.docs.length) {
    // PD.53: lazy backfill missing timestamps on legacy docs.
    var nowIso = new Date().toISOString();
    for (var i = 0; i < m.docs.length; i++) {
      var d = m.docs[i];
      if (!d.createdAt) d.createdAt = nowIso;
      if (!d.updatedAt) d.updatedAt = d.createdAt;
    }
    return;
  }
  var initial = (typeof m.notes === "string" && m.notes.trim()) ? m.notes : "";
  var now = new Date().toISOString();
  m.docs.push({ id: "d-" + Date.now().toString(36), title: "Notes", body: initial, createdAt: now, updatedAt: now });
}
function _pmDocsSyncToNotes(m){
  if (!m || !Array.isArray(m.docs)) return;
  m.notes = m.docs.map(function(d){
    var t = String(d.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var hdr = t ? '<h3 style="margin:0 0 4px;font-size:13px;font-weight:700;">' + t + '</h3>' : '';
    return hdr + (d.body || "");
  }).join('<hr style="border:none;border-top:1px solid var(--c-border-3);margin:10px 0;" />');
}
// Round PD.35: docs render as a scrolling LIST of titles. Click a
// title → opens that doc in its own editor dialog (_pmOpenDocEditor).
// + Add document opens editor for a new doc. Body editors no longer
// live inline; m.docs is the source of truth, updated by editor saves.
function _pmDocsRender(m, idPrefix){
  _pmDocsEnsure(m);
  var canDelete = m.docs.length > 1;
  // PD.57: optional tag filter — if active, hide docs not matching.
  var tagFilter = m._docTagFilter || null;
  var canReorder = m.docs.length > 1;
  var rowsHtml = m.docs.map(function(doc, idx){
    if (tagFilter && (!Array.isArray(doc.tags) || doc.tags.indexOf(tagFilter) === -1)) return "";
    var titleSafe = String(doc.title || "Untitled").replace(/</g, "&lt;");
    // PD.56: 80-char snippet of the body
    var snippet = (typeof _pmStripHtml === "function") ? _pmStripHtml(doc.body || "") : "";
    if (snippet.length > 80) snippet = snippet.slice(0, 80) + "…";
    var snippetSafe = snippet.replace(/</g, "&lt;");
    // PD.57: tag chips on the row
    var tagsHtml = "";
    if (Array.isArray(doc.tags) && doc.tags.length) {
      tagsHtml = '<span style="display:inline-flex;gap:4px;margin-top:3px;flex-wrap:wrap;">'
        + doc.tags.map(function(tag){
            var safe = String(tag).replace(/</g, "&lt;");
            return '<span style="font-size:10px;font-weight:600;color:var(--c-accent);background:#f1edf8;border:1px solid #ddd5ec;border-radius:8px;padding:1px 7px;">#' + safe + '</span>';
          }).join('')
        + '</span>';
    }
    return '<div class="pm-doc-list-row" data-idx="' + idx + '" '
      +    (canReorder ? 'draggable="true" ' : '')
      +    'onclick="event.stopPropagation();_pmDocOpen(' + idx + ');" '
      +    'style="display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-bottom:1px solid var(--c-border-3);cursor:pointer;transition:background-color .12s;border-top:2px solid transparent;border-top-color:transparent;" '
      +    'onmouseenter="this.style.background=&quot;#f5f5f5&quot;" onmouseleave="this.style.background=&quot;transparent&quot;">'
      +   (canReorder
            ? '<span class="pm-doc-drag-handle" title="Drag to reorder" style="cursor:grab;color:#bbb;font-size:14px;user-select:none;-webkit-user-select:none;padding:2px 2px 0;">⋮⋮</span>'
            : '')
      +   '<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">'
      +     '<span style="font-size:13px;font-weight:600;color:var(--c-ink);display:flex;align-items:baseline;gap:8px;min-width:0;">'
      +       '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">📄 ' + titleSafe + '</span>'
      +       (doc.updatedAt ? '<span style="font-size:11px;font-weight:400;color:#999;white-space:nowrap;flex-shrink:0;">' + _pmFmtRelative(doc.updatedAt) + '</span>' : '')
      +     '</span>'
      +     (snippetSafe ? '<span style="font-size:11.5px;color:var(--c-ink-3);font-weight:400;line-height:1.4;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;">' + snippetSafe + '</span>' : '')
      +     tagsHtml
      +   '</span>'
      +   (canDelete
            ? '<button type="button" class="pm-doc-del" data-idx="' + idx + '" onclick="event.stopPropagation();_pmDocRemove(this);" title="Delete this document">×</button>'
            : '')
      + '</div>';
  }).filter(Boolean).join('');
  var emptyHtml = '<div style="padding:20px;text-align:center;color:#999;font-size:12px;font-style:italic;">No documents yet.</div>';
  // PD.57: tag filter strip — collect all tags used by docs, render
  // as clickable chips. Selected chip filters list above.
  var allTags = {};
  m.docs.forEach(function(d){ (d.tags || []).forEach(function(t){ allTags[t] = (allTags[t] || 0) + 1; }); });
  var tagKeys = Object.keys(allTags).sort();
  var filterHtml = "";
  if (tagKeys.length) {
    var activeFilter = m._docTagFilter || null;
    filterHtml = '<div class="pm-doc-tagstrip" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center;">'
      + '<span style="font-size:10px;color:var(--c-ink-3);font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-right:4px;">Tags:</span>'
      + tagKeys.map(function(t){
          var on = (t === activeFilter);
          var safe = String(t).replace(/</g, "&lt;").replace(/"/g, "&quot;");
          return '<button type="button" data-tag="' + safe + '" onclick="event.stopPropagation();_pmDocTagFilter(this);" '
            + 'style="font-size:11px;font-weight:600;color:' + (on ? '#fff' : '#5b3f8f') + ';background:' + (on ? '#5b3f8f' : '#f1edf8') + ';border:1px solid #ddd5ec;border-radius:10px;padding:2px 9px;cursor:pointer;font-family:inherit;">#' + safe + ' <span style="opacity:0.7;font-weight:400;">(' + allTags[t] + ')</span></button>';
        }).join('')
      + (activeFilter ? '<button type="button" onclick="event.stopPropagation();_pmDocTagFilter(null);" style="font-size:11px;color:#a93826;background:transparent;border:none;cursor:pointer;font-family:inherit;margin-left:6px;">clear filter ×</button>' : '')
      + '</div>';
  }
  return '<div class="pm-docs-wrap" data-id-prefix="' + idPrefix + '">'
    + filterHtml
    + '<div class="pm-doc-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);">'
    +   (rowsHtml || emptyHtml)
    + '</div>'
    + '<button type="button" class="pm-doc-add" onclick="event.stopPropagation();_pmDocAdd(this);">+ Add document</button>'
    + '</div>';
}
// PD.35: no-op in list mode — m.docs is the source of truth, set by
// editor dialog saves. Kept for back-compat with any legacy caller
// that expected DOM → m.docs sync. Always syncs the legacy m.notes
// concatenation so non-doc-aware readers see current content.
function _pmDocsReadFromDom(rootEl, m){
  if (!m) return;
  _pmDocsEnsure(m);
  _pmDocsSyncToNotes(m);
}
// Active-popup tracking so the add/delete buttons (which live in
// inline-string HTML, no closure access) can find the surface to
// mutate + re-render. Set/cleared by each popup's open/close.
//
// Round PD.39: also stores the close function so Done can dispatch
// via inline onclick (architectural fix — see _pmActiveResearchClose
// below for why).
function _pmDocsSetActive(ov, m, renderBody, closeFn){
  if (typeof ov !== "undefined") window._pmActiveResearchOv = ov;
  window._pmActiveResearchMeta = m;
  if (typeof renderBody !== "undefined") window._pmActiveResearchRender = renderBody;
  window.__pmActiveCloseFn = closeFn || null;
}
function _pmDocsClearActive(){
  window._pmActiveResearchOv = null;
  window._pmActiveResearchMeta = null;
  window._pmActiveResearchRender = null;
  window.__pmActiveCloseFn = null;
}
// Round PD.39: dispatcher for Done buttons. Inline onclick calls this.
// Stored function name uses double-underscore to avoid colliding with
// the dispatcher's own name on the window object.
function _pmActiveResearchClose(){
  var fn = window.__pmActiveCloseFn;
  if (typeof fn === "function") {
    try { fn(); } catch(_){}
  }
}
if (typeof globalThis !== "undefined") {
  globalThis._pmActiveResearchClose = _pmActiveResearchClose;
}
// PD.35: + Add document opens the editor dialog for a brand-new doc.
// Empty docs (no title, no body) are discarded on close.
function _pmDocAdd(){
  var m  = window._pmActiveResearchMeta;
  if (!m) return;
  _pmDocsEnsure(m);
  var nowIso = new Date().toISOString();
  var newDoc = { id: "d-" + Date.now().toString(36), title: "", body: "", createdAt: nowIso, updatedAt: nowIso };
  _pmOpenDocEditor(newDoc, function(saved){
    var hasContent = (saved.title && saved.title.trim()) || (saved.body && saved.body.trim() && saved.body !== "<br>");
    if (!hasContent) return;  // discard empty
    m.docs.push(saved);
    _pmDocsRefreshActive();
  });
}
function _pmDocRemove(btn){
  var m  = window._pmActiveResearchMeta;
  if (!m) return;
  var idx = parseInt(btn.getAttribute("data-idx"), 10);
  if (!isFinite(idx) || idx < 0) return;
  _pmDocsEnsure(m);
  // PD.50: snapshot for undo before splice.
  var deletedDoc = m.docs[idx];
  var deletedAt = idx;
  m.docs.splice(idx, 1);
  _pmDocsEnsure(m);  // ensure at least one doc exists
  _pmDocsRefreshActive();
  if (typeof _pmShowUndo === "function" && deletedDoc) {
    var title = (deletedDoc.title && deletedDoc.title.trim()) || "Untitled";
    _pmShowUndo("Deleted \"" + title + "\"", function(){
      m.docs.splice(deletedAt, 0, deletedDoc);
      _pmDocsRefreshActive();
    });
  }
}
// PD.35: click a doc title row → opens that doc in the editor dialog.
function _pmDocOpen(idx){
  var m  = window._pmActiveResearchMeta;
  if (!m || !Array.isArray(m.docs) || !m.docs[idx]) return;
  var orig = m.docs[idx];
  _pmOpenDocEditor(orig, function(saved){
    m.docs[idx] = saved;
    _pmDocsRefreshActive();
  });
}

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._pmActiveResearchClose = _pmActiveResearchClose;
  __expg._pmDocAdd = _pmDocAdd;
  __expg._pmDocOpen = _pmDocOpen;
  __expg._pmDocRemove = _pmDocRemove;
  __expg._pmDocsClearActive = _pmDocsClearActive;
  __expg._pmDocsEnsure = _pmDocsEnsure;
  __expg._pmDocsReadFromDom = _pmDocsReadFromDom;
  __expg._pmDocsRender = _pmDocsRender;
  __expg._pmDocsSetActive = _pmDocsSetActive;
  __expg._pmDocsSyncToNotes = _pmDocsSyncToNotes;
  __expg._pmFmtAbsolute = _pmFmtAbsolute;
  __expg._pmFmtRelative = _pmFmtRelative;
  __expg._pmStripHtml = _pmStripHtml;
}
