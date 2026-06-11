// pm-richtext.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Place-meta rich-text research panel (init, setup, checkbox rows).
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────
function _pmRtInitContent(raw){
  raw = String(raw == null ? "" : raw);
  if (/<[a-z][^>]*>/i.test(raw)) return raw;  // already HTML
  var esc = _escHtml(raw);
  return esc.replace(/\n/g, "<br>");
}
function _pmRtFieldHtml(id, initialContent, opts){
  opts = opts || {};
  var minH = opts.minHeight || "80px";
  var placeholder = (opts.placeholder || "").replace(/"/g, "&quot;");
  var content = _pmRtInitContent(initialContent);
  return ''
    + '<div class="pm-rt-wrap" style="border:1px solid #ccc;border-radius:5px;background:#fff;font-family:inherit;">'
    +   '<div class="pm-rt-toolbar" style="display:flex;gap:1px;padding:3px 4px;border-bottom:1px solid #eee;background:#fafafa;">'
    +     '<button type="button" data-pmrt="bold" title="Bold" style="font-size:13px;font-weight:700;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:serif;">B</button>'
    +     '<button type="button" data-pmrt="italic" title="Italic" style="font-size:13px;font-style:italic;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:serif;">I</button>'
    +     '<span style="width:1px;background:#ddd;margin:3px 4px;"></span>'
    +     '<button type="button" data-pmrt="insertUnorderedList" title="Bullet list" style="font-size:13px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">•</button>'
    +     '<button type="button" data-pmrt="insertOrderedList" title="Numbered list" style="font-size:11.5px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">1.</button>'
    +     '<button type="button" data-pmrt="checklist" title="Checklist" style="font-size:13px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">☑</button>'
    +     '<button type="button" data-pmrt="attach" title="Attach file or image" style="font-size:13px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">📎</button>'
    +     '<button type="button" data-pmrt="doclink" title="Link to another document (or type [[)" style="font-size:13px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">📄</button>'
    +     '<button type="button" data-pmrt="askmax" title="Ask Max (AI assistant)" style="font-size:13px;color:#5b3f8f;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">✨</button>'
    +     '<span style="width:1px;background:#ddd;margin:3px 4px;"></span>'
    +     '<button type="button" data-pmrt="createLink" title="Add link" style="font-size:11.5px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">🔗</button>'
    +     '<button type="button" data-pmrt="unlink" title="Remove link" style="font-size:11.5px;color:#444;background:transparent;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-family:inherit;">⌧</button>'
    +   '</div>'
    +   '<div id="' + id + '" class="pm-rt-editor" contenteditable="true" data-placeholder="' + placeholder + '" '
    +        'style="min-height:' + minH + ';padding:6px 8px;font:inherit;font-size:12.5px;line-height:1.5;color:#111;outline:none;overflow-y:auto;max-height:380px;">'
    +     content
    +   '</div>'
    + '</div>';
}
function _pmRtCmd(btn, cmd){
  var wrap = btn.closest ? btn.closest(".pm-rt-wrap") : null;
  if (!wrap) return;
  var ed = wrap.querySelector(".pm-rt-editor");
  if (!ed) return;
  ed.focus();
  if (cmd === "createLink") {
    var url = prompt("Paste link URL:", "https://");
    if (!url || !url.trim() || url.trim() === "https://") return;
    var clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) clean = "https://" + clean;
    document.execCommand(cmd, false, clean);
  } else {
    document.execCommand(cmd, false, null);
  }
}
function _pmRtSetup(root){
  if (!root || !root.querySelectorAll) return;
  // PD.52: also bind doc-list drag-and-drop on any popup that has a doc list.
  if (typeof _pmDocsBindDnd === "function") _pmDocsBindDnd(root);
  root.querySelectorAll(".pm-rt-editor").forEach(function(ed){
    if (ed._pmRtSetup) return;
    ed._pmRtSetup = true;
    Object.defineProperty(ed, 'value', {
      get: function(){ return ed.innerHTML; },
      set: function(v){ ed.innerHTML = _pmRtInitContent(v); },
      configurable: true
    });
    // Open links in new tab when reading the notes (Cmd-click in
    // contentEditable opens by default; this catches plain clicks
    // when the editor is rendered in a read-mostly context).
    ed.addEventListener("click", function(e){
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (a && a.href && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        window.open(a.href, "_blank", "noopener");
      }
    });
    // Round PD.41: Enter inside a checkbox row creates another row.
    // Backspace at the start of an empty checkbox row removes it
    // (escape hatch back to plain paragraph).
    // Round PD.44: bind toolbar buttons via addEventListener at setup
    // time. Inline onmousedown/onclick attributes were intermittently
    // failing to fire real mouse events (worked for dispatched events
    // only). Runtime binding via addEventListener is the reliable
    // path.
    var wrap = ed.closest ? ed.closest(".pm-rt-wrap") : null;
    if (wrap) {
      wrap.querySelectorAll(".pm-rt-toolbar button[data-pmrt]").forEach(function(b){
        if (b._pmRtBound) return;
        b._pmRtBound = true;
        b.addEventListener("mousedown", function(ev){
          ev.preventDefault();  // keep editor selection alive
          var cmd = b.getAttribute("data-pmrt");
          if (cmd === "checklist") {
            _pmRtInsertCheckbox(b);
          } else if (cmd === "attach") {
            _pmRtAttachFile(b);
          } else if (cmd === "doclink") {
            // PD.51b: open the doc-link picker directly (no [[ needed).
            ed.focus();
            if (typeof _pmDocLinkPickerShow === "function") _pmDocLinkPickerShow(ed);
          } else if (cmd === "askmax") {
            // PD.62: open the Ask Max modal.
            if (typeof _pmAskMaxOpen === "function") _pmAskMaxOpen(ed);
          } else {
            _pmRtCmd(b, cmd);
          }
        });
      });
    }
    // PD.51: cross-doc linking — listen for [[ in editor, show picker.
    ed.addEventListener("input", function(){
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      var node = range.endContainer;
      if (!node || node.nodeType !== 3) {
        if (document.getElementById("pm-doclink-picker")) _pmDocLinkPickerClose();
        return;
      }
      var text = node.textContent || "";
      var off  = range.endOffset;
      var open = text.lastIndexOf("[[", off);
      // Close picker if no open bracket pair before caret, or if a `]]` intervenes
      if (open === -1 || text.indexOf("]]", open) !== -1 && text.indexOf("]]", open) < off) {
        if (document.getElementById("pm-doclink-picker")) _pmDocLinkPickerClose();
        return;
      }
      var existing = document.getElementById("pm-doclink-picker");
      if (!existing) {
        _pmDocLinkPickerShow(ed);
        existing = document.getElementById("pm-doclink-picker");
      }
      if (existing) {
        existing._pmQuery = text.substring(open + 2, off);
        if (typeof existing._pmRender === "function") existing._pmRender();
      }
    });
    // PD.51: click a doc-link chip → save current edits, open target doc.
    ed.addEventListener("click", function(e){
      var link = e.target && e.target.closest ? e.target.closest(".pm-doclink") : null;
      if (!link) return;
      e.preventDefault();
      e.stopPropagation();
      var id = link.getAttribute("data-doc-id");
      if (id && typeof _pmDocLinkNavigate === "function") _pmDocLinkNavigate(id);
    });
    if (typeof _pmRtBindAttachmentHandlers === "function") _pmRtBindAttachmentHandlers(ed);
    // PD.59: hydrate IDB-stored attachments now that the editor DOM exists.
    if (typeof _pmAttHydrate === "function") _pmAttHydrate(ed);
    ed.addEventListener("keydown", function(e){
      if (e.key !== "Enter" && e.key !== "Backspace") return;
      var sel = window.getSelection && window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var node = sel.anchorNode;
      var row = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
      while (row && row !== ed && !(row.classList && row.classList.contains("pm-rt-cb-item"))) {
        row = row.parentElement;
      }
      if (!row || row === ed) return;
      if (e.key === "Enter") {
        e.preventDefault();
        var newRow = _pmRtBuildCheckboxRow("");
        row.parentNode.insertBefore(newRow, row.nextSibling);
        var lblNew = newRow.querySelector(".pm-rt-cb-text");
        if (lblNew) {
          var range = document.createRange();
          range.setStart(lblNew, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } else if (e.key === "Backspace") {
        var lblBs = row.querySelector(".pm-rt-cb-text");
        var txt = lblBs ? (lblBs.textContent || "").replace(/[\s ]+/g, "") : "";
        if (!txt) {
          e.preventDefault();
          var parent = row.parentNode;
          var next = row.nextSibling;
          parent.removeChild(row);
          // Place cursor where the row was.
          var range2 = document.createRange();
          if (next) range2.setStart(next, 0);
          else range2.setStart(parent, parent.childNodes.length);
          range2.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range2);
        }
      }
    });
  });
}
// Round PD.41: styled-span checkbox row. Native input rendered as
// chevron by Safari in contentEditable. Styled mark toggles via inline
// onclick -> classList; class persists in innerHTML for free.
function _pmRtBuildCheckboxRow(labelText){
  var row = document.createElement("div");
  row.className = "pm-rt-cb-item";
  var mark = document.createElement("span");
  mark.className = "pm-rt-cb-mark";
  mark.setAttribute("contenteditable", "false");
  mark.setAttribute("onclick", "event.stopPropagation();this.parentElement.classList.toggle('checked');");
  var text = document.createElement("span");
  text.className = "pm-rt-cb-text";
  text.textContent = labelText || "";
  row.appendChild(mark);
  row.appendChild(text);
  return row;
}
function _pmRtInsertCheckbox(btn){
  var wrap = btn.closest ? btn.closest(".pm-rt-wrap") : null;
  if (!wrap) return;
  var ed = wrap.querySelector(".pm-rt-editor");
  if (!ed) return;
  ed.focus();
  var sel = window.getSelection && window.getSelection();
  var hasSelInside = false;
  var selectedText = "";
  var insertRange = null;
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0);
    if (ed.contains(r.commonAncestorContainer) || r.commonAncestorContainer === ed) {
      hasSelInside = true;
      selectedText = r.toString();
      insertRange = r;
    }
  }
  var row = _pmRtBuildCheckboxRow(selectedText);
  if (hasSelInside && insertRange) {
    try {
      insertRange.deleteContents();
      insertRange.insertNode(row);
    } catch(_) { ed.appendChild(row); }
  } else {
    ed.appendChild(row);
  }
  try {
    var label = row.querySelector(".pm-rt-cb-text");
    if (label) {
      var after = document.createRange();
      after.selectNodeContents(label);
      after.collapse(false);
      if (sel) { sel.removeAllRanges(); sel.addRange(after); }
    }
  } catch(_){}
}
if (typeof globalThis !== "undefined") {
  globalThis._pmRtInsertCheckbox = _pmRtInsertCheckbox;
  globalThis._pmRtBuildCheckboxRow = _pmRtBuildCheckboxRow;
}
