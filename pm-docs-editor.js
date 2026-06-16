// @ts-check
// pm-docs-editor.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Place-meta docs editor: tag filter, drag-drop, doc editor.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────

// PD.57: tag-filter handler. Pass null or omit to clear.
function _pmDocTagFilter(arg){
  var m = window._pmActiveResearchMeta;
  if (!m) return;
  var tag = (arg && arg.getAttribute) ? arg.getAttribute("data-tag") : arg;
  if (m._docTagFilter === tag) m._docTagFilter = null;  // toggle off
  else m._docTagFilter = tag;
  if (typeof _pmDocsRefreshActive === "function") _pmDocsRefreshActive();
}
if (typeof globalThis !== "undefined") globalThis._pmDocTagFilter = _pmDocTagFilter;

function _pmDocsBindDnd(scope){
  var root = scope || document;
  var list = root.querySelector(".pm-doc-list");
  if (!list || list._pmDndBound) return;
  list._pmDndBound = true;
  var srcIdx = null;
  function clearDropIndicators(){
    list.querySelectorAll(".pm-doc-list-row").forEach(function(r){
      r.style.borderTopColor = "transparent";
    });
  }
  list.addEventListener("dragstart", function(e){
    var row = e.target && e.target.closest ? e.target.closest(".pm-doc-list-row") : null;
    if (!row) return;
    srcIdx = parseInt(row.getAttribute("data-idx"), 10);
    if (!isFinite(srcIdx)) { srcIdx = null; return; }
    row.style.opacity = "0.4";
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(srcIdx)); } catch(_){}
  });
  list.addEventListener("dragend", function(e){
    var row = e.target && e.target.closest ? e.target.closest(".pm-doc-list-row") : null;
    if (row) row.style.opacity = "1";
    clearDropIndicators();
    srcIdx = null;
  });
  list.addEventListener("dragover", function(e){
    if (srcIdx === null) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch(_){}
    var row = e.target && e.target.closest ? e.target.closest(".pm-doc-list-row") : null;
    clearDropIndicators();
    if (row) row.style.borderTopColor = "#1a5fa8";
  });
  list.addEventListener("drop", function(e){
    if (srcIdx === null) return;
    e.preventDefault();
    var row = e.target && e.target.closest ? e.target.closest(".pm-doc-list-row") : null;
    if (!row) { clearDropIndicators(); return; }
    var dstIdx = parseInt(row.getAttribute("data-idx"), 10);
    clearDropIndicators();
    if (!isFinite(dstIdx) || dstIdx === srcIdx) { srcIdx = null; return; }
    var m = window._pmActiveResearchMeta;
    if (!m || !Array.isArray(m.docs)) { srcIdx = null; return; }
    var moved = m.docs.splice(srcIdx, 1)[0];
    // After removing srcIdx, the target index shifts down by 1 if src < dst
    var insertAt = (srcIdx < dstIdx) ? dstIdx - 1 : dstIdx;
    m.docs.splice(insertAt, 0, moved);
    srcIdx = null;
    if (typeof _pmDocsRefreshActive === "function") _pmDocsRefreshActive();
  });
}
if (typeof globalThis !== "undefined") globalThis._pmDocsBindDnd = _pmDocsBindDnd;

function _pmDocsRefreshActive(){
  var ov = window._pmActiveResearchOv;
  var m  = window._pmActiveResearchMeta;
  var rb = window._pmActiveResearchRender;
  if (!ov || !m || typeof rb !== "function") return;
  _pmDocsSyncToNotes(m);
  ov.innerHTML = rb();
  if (typeof _pmRtSetup === "function") _pmRtSetup(ov);
  if (typeof _pmDocsBindDnd === "function") _pmDocsBindDnd(ov);
  // PD.59b: trigger orphan-attachment GC once per session, deferred.
  if (!_pmAttGcRan && typeof _pmAttGc === "function") {
    _pmAttGcRan = true;
    setTimeout(_pmAttGc, 5000);
  }
}

// PD.57: tag chip field for the doc editor header. Tags stored as
// doc.tags (string[]). Type → add (Enter or comma). Click × on chip → remove.
function _pmDocTagFieldHtml(doc){
  var tags = Array.isArray(doc.tags) ? doc.tags : [];
  var chipsHtml = tags.map(function(t, i){
    var safe = String(t).replace(/</g, "&lt;").replace(/"/g, "&quot;");
    return '<span class="pm-doc-tag-chip" data-idx="' + i + '" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--c-accent);background:#f1edf8;border:1px solid #ddd5ec;border-radius:10px;padding:2px 4px 2px 9px;">#' + safe
      + '<button type="button" data-tag-rm="' + i + '" style="background:transparent;border:none;color:var(--c-accent);cursor:pointer;font-size:13px;line-height:1;padding:0 4px;font-family:inherit;">×</button></span>';
  }).join('');
  return '<div id="pm-doc-edit-tags" style="padding:4px 18px 8px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">'
    + '<span style="font-size:10px;color:var(--c-ink-3);font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-right:4px;">Tags:</span>'
    + chipsHtml
    + '<input id="pm-doc-edit-tag-input" type="text" placeholder="add tag…" style="font:inherit;font-size:11px;border:1px dashed var(--c-border-strong);border-radius:10px;padding:2px 9px;outline:none;background:transparent;min-width:70px;" />'
    + '</div>';
}
function _pmDocTagBind(ov, doc){
  // PD.57b: direct-DOM rewrite. Each tag is its own <span> chip
  // inserted before the input. No outerHTML rebuild — that approach
  // was racy and dropped state.
  if (!Array.isArray(doc.tags)) doc.tags = [];
  var wrap = ov.querySelector("#pm-doc-edit-tags");
  var inp  = ov.querySelector("#pm-doc-edit-tag-input");
  if (!wrap || !inp) return;
  if (wrap._pmTagBound) return;
  wrap._pmTagBound = true;

  function makeChip(tag, idx){
    var safe = String(tag).replace(/</g, "&lt;").replace(/"/g, "&quot;");
    var span = document.createElement("span");
    span.className = "pm-doc-tag-chip";
    span.setAttribute("data-tag", tag);
    span.style.cssText = "display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--c-accent);background:#f1edf8;border:1px solid #ddd5ec;border-radius:10px;padding:2px 4px 2px 9px;";
    span.innerHTML = "#" + safe
      + '<button type="button" style="background:transparent;border:none;color:var(--c-accent);cursor:pointer;font-size:13px;line-height:1;padding:0 4px;font-family:inherit;">×</button>';
    var btn = span.querySelector("button");
    btn.onclick = function(e){
      e.preventDefault(); e.stopPropagation();
      var i = doc.tags.indexOf(tag);
      if (i !== -1) doc.tags.splice(i, 1);
      if (span.parentNode) span.parentNode.removeChild(span);
    };
    return span;
  }

  function commitInput(){
    var v = inp.value.trim().replace(/^#/, "");
    if (!v) return false;
    if (doc.tags.indexOf(v) === -1) {
      doc.tags.push(v);
      wrap.insertBefore(makeChip(v, doc.tags.length - 1), inp);
    }
    inp.value = "";
    return true;
  }

  inp.addEventListener("keydown", function(e){
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      e.stopPropagation();
      commitInput();
    } else if (e.key === "Backspace" && !inp.value && doc.tags.length) {
      e.preventDefault();
      var last = doc.tags.pop();
      var chips = wrap.querySelectorAll(".pm-doc-tag-chip");
      var lastChip = chips[chips.length - 1];
      if (lastChip && lastChip.parentNode) lastChip.parentNode.removeChild(lastChip);
    }
  });
  // Commit pending text on blur so a user who types a tag and clicks
  // Done (instead of pressing Enter) still gets the tag saved.
  inp.addEventListener("blur", function(){ commitInput(); });

  // Wire up handlers for any chips already present in the initial HTML.
  wrap.querySelectorAll(".pm-doc-tag-chip").forEach(function(chip, i){
    var tag = doc.tags[i];
    if (tag == null) return;
    chip.setAttribute("data-tag", tag);
    var btn = chip.querySelector("button[data-tag-rm], button");
    if (btn) {
      btn.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        var idx = doc.tags.indexOf(tag);
        if (idx !== -1) doc.tags.splice(idx, 1);
        if (chip.parentNode) chip.parentNode.removeChild(chip);
      };
    }
  });
}
if (typeof globalThis !== "undefined") {
  globalThis._pmDocTagFieldHtml = _pmDocTagFieldHtml;
  globalThis._pmDocTagBind = _pmDocTagBind;
}

// PD.35: per-doc editor dialog. Title input + rich-text body + dictate
// + Done. Save on Done / × / outside-click. Calls back onSave(doc).
function _pmOpenDocEditor(doc, onSave){
  var existing = document.getElementById("pm-doc-editor");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "pm-doc-editor";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:11700;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;";

  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;max-width:680px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 12px 36px rgba(0,0,0,0.28);overflow:hidden;";

  var titleSafe = String(doc.title || "").replace(/"/g, "&quot;");
  box.innerHTML = ''
    + '<div style="padding:12px 18px;border-bottom:1px solid var(--c-border-3);display:flex;align-items:center;gap:10px;">'
    +   '<input id="pm-doc-edit-title" type="text" value="' + titleSafe + '" placeholder="Document title" '
    +     'style="flex:1;font:inherit;font-size:16px;font-weight:700;border:1px solid transparent;border-radius:5px;padding:6px 8px;background:transparent;outline:none;" '
    +     'onfocus="this.style.borderColor=&quot;#ccc&quot;" onblur="this.style.borderColor=&quot;transparent&quot;" />'
    +   '<button type="button" id="pm-doc-edit-dictate" style="font-size:11px;font-weight:600;color:var(--c-primary);background:var(--c-bg);border:1px solid var(--c-border-blue);border-radius:5px;padding:5px 10px;cursor:pointer;font-family:inherit;flex-shrink:0;">🎤 Dictate</button>'
    +   '<button type="button" id="pm-doc-edit-close-x" style="font-size:22px;color:#999;background:none;border:none;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;">×</button>'
    + '</div>'
    + _pmDocTagFieldHtml(doc)
    + (doc.createdAt
        ? '<div style="padding:4px 18px 8px;font-size:11px;color:#999;font-family:inherit;">'
            + 'Created ' + _pmFmtAbsolute(doc.createdAt) + (doc.updatedAt && doc.updatedAt !== doc.createdAt ? ' &middot; edited ' + _pmFmtRelative(doc.updatedAt) : '')
            + '</div>'
        : '')
    + '<div style="flex:1;overflow-y:auto;padding:14px 18px;background:var(--c-panel);">'
    +   _pmRtFieldHtml("pm-doc-edit-body", doc.body || "", { placeholder: "Write here…", minHeight: "320px" })
    + '</div>'
    + '<div style="padding:12px 18px;border-top:1px solid var(--c-border-3);display:flex;justify-content:flex-end;gap:8px;">'
    +   '<button type="button" id="pm-doc-edit-done" style="font-size:13px;font-weight:600;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;">Done</button>'
    + '</div>';

  // PD.51: remember which doc we're editing so the doc-link picker
  // can suppress it from its own dropdown.
  ov._pmEditingDocId = doc.id || null;
  ov.appendChild(box);
  document.body.appendChild(ov);
  _pmRtSetup(ov);
  if (typeof _pmDocTagBind === "function") _pmDocTagBind(ov, doc);

  function save(){
    var titleInp = ov.querySelector("#pm-doc-edit-title");
    var bodyEd   = ov.querySelector(".pm-rt-editor");
    var newTitle = titleInp ? titleInp.value : (doc.title || "");
    var newBody  = bodyEd   ? bodyEd.innerHTML : (doc.body || "");
    // PD.59: strip live blob: URLs from attachment placeholders so the
    // saved HTML is portable across sessions.
    if (typeof _pmAttSerializeBody === "function") newBody = _pmAttSerializeBody(newBody);
    // PD.53: bump updatedAt only when content actually changed; preserve createdAt.
    var changed = (newTitle !== (doc.title || "")) || (newBody !== (doc.body || ""));
    var createdAt = doc.createdAt || new Date().toISOString();
    var updatedAt = changed ? new Date().toISOString() : (doc.updatedAt || createdAt);
    var updated = {
      id: doc.id || ("d-" + Date.now().toString(36)),
      title: newTitle,
      body:  newBody,
      createdAt: createdAt,
      updatedAt: updatedAt,
      tags: Array.isArray(doc.tags) ? doc.tags.slice() : []
    };
    if (typeof onSave === "function") onSave(updated);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }
  ov.querySelector("#pm-doc-edit-done").onclick = save;
  ov.querySelector("#pm-doc-edit-close-x").onclick = save;
  box.onclick = function(e){ e.stopPropagation(); };
  ov.onclick = save;

  // Dictate into the body editor.
  var dictateBtn = ov.querySelector("#pm-doc-edit-dictate");
  var bodyEd2 = ov.querySelector(".pm-rt-editor");
  if (dictateBtn && bodyEd2 && typeof _pmAttachDictation === "function") {
    _pmAttachDictation(dictateBtn, bodyEd2);
  }
  // Focus: title if new, body if existing.
  setTimeout(function(){
    if (!doc.title) {
      var t = ov.querySelector("#pm-doc-edit-title");
      if (t) t.focus();
    } else {
      var b = ov.querySelector(".pm-rt-editor");
      if (b) b.focus();
    }
  }, 50);
}
if (typeof globalThis !== "undefined") {
  if (typeof _pmDocOpen !== "undefined") globalThis._pmDocOpen = _pmDocOpen;
  globalThis._pmDocsRefreshActive = _pmDocsRefreshActive;
  globalThis._pmOpenDocEditor = _pmOpenDocEditor;
}
