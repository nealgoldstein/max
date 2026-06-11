// pm-clip-share.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Place-meta web-clip capture + Discovery share flow.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────

// Detect ?clip=… and stash for after-init handling.
function _pmMaybeStartClipFlow(){
  try {
    var qs = new URLSearchParams(location.search);
    var enc = qs.get("clip");
    if (!enc) return false;
    var json;
    try { json = decodeURIComponent(escape(atob(decodeURIComponent(enc)))); }
    catch(e){ alert("Clip data malformed."); return false; }
    var payload;
    try { payload = JSON.parse(json); }
    catch(e){ alert("Couldn\'t parse clip data."); return false; }
    window._pmPendingClip = payload;
    // Strip ?clip= from the URL so a reload doesn\'t re-trigger.
    try {
      var clean = location.pathname + (qs.toString().replace(/(^|&)clip=[^&]*/, "").replace(/^&/, "") ? "?" + qs.toString().replace(/(^|&)clip=[^&]*/, "").replace(/^&/, "") : "");
      history.replaceState({}, "", clean);
    } catch(_){}
    // Once trips index loads, show the picker. Defer to give MaxSync time.
    setTimeout(_pmShowClipPicker, 800);
    return true;
  } catch(_){ return false; }
}

function _pmShowClipPicker(){
  var payload = window._pmPendingClip;
  if (!payload) return;
  if (typeof MaxSync === "undefined" || !MaxSync.isSignedIn || !MaxSync.isSignedIn()) {
    alert("Please sign in to save clips, then click the bookmarklet again.");
    return;
  }
  var existing = document.getElementById("pm-clip-picker");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "pm-clip-picker";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:15000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;";
  var box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:12px;max-width:480px;width:100%;box-shadow:0 12px 36px rgba(0,0,0,0.32);font-size:13px;color:#222;padding:18px 22px;";
  ov.onclick = function(){ ov.remove(); };
  box.onclick = function(e){ e.stopPropagation(); };

  var titleSafe = (payload.title || payload.url || "Clip").replace(/</g, "&lt;");
  var urlSafe   = (payload.url || "").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  var selPreview = "";
  if (payload.selection) {
    var sel = payload.selection.length > 240 ? payload.selection.slice(0, 240) + "…" : payload.selection;
    selPreview = '<div style="margin-top:8px;padding:8px 10px;background:#f5f5f5;border-left:3px solid #1a5fa8;border-radius:3px;font-size:12px;color:#555;max-height:90px;overflow:auto;">' + sel.replace(/</g, "&lt;") + '</div>';
  }
  box.innerHTML = '<div style="font-size:15px;font-weight:700;margin-bottom:8px;">📎 Save to Max</div>'
    + '<div style="font-size:11.5px;color:#999;margin-bottom:10px;">From the webpage you were viewing.</div>'
    + '<div style="padding:8px 10px;background:#fafbfd;border:1px solid #e0e6ee;border-radius:6px;margin-bottom:14px;">'
    +   '<div style="font-weight:600;font-size:13px;color:#111;margin-bottom:3px;">' + titleSafe + '</div>'
    +   '<div style="font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + urlSafe + '</div>'
    +   selPreview
    + '</div>'
    + '<div style="font-size:11px;color:#888;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;">Save to which trip?</div>'
    + '<div id="pm-clip-trips" style="margin-bottom:16px;font-size:11px;color:#999;">Loading trips…</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;">'
    +   '<button type="button" id="pm-clip-cancel" style="font-size:12px;font-weight:600;color:#666;background:#fff;border:1px solid #ccc;border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '</div>';

  ov.appendChild(box);
  document.body.appendChild(ov);
  box.querySelector("#pm-clip-cancel").onclick = function(){ ov.remove(); window._pmPendingClip = null; };

  // Populate trip list.
  MaxSync.listTrips().then(function(resp){
    var trips = (resp && resp.trips) || resp || [];
    var listEl = box.querySelector("#pm-clip-trips");
    if (!trips.length) {
      listEl.innerHTML = '<div style="font-style:italic;color:#999;">No trips yet — create one first, then clip.</div>';
      return;
    }
    listEl.innerHTML = '';
    trips.forEach(function(t){
      var row = document.createElement("button");
      row.type = "button";
      row.style.cssText = "display:block;width:100%;text-align:left;font:inherit;font-size:13px;font-weight:600;padding:10px 12px;margin-bottom:4px;background:#fff;border:1px solid #ddd;border-radius:6px;cursor:pointer;color:#1a5fa8;";
      row.textContent = "→ " + (t.name || "Untitled trip");
      row.onmouseenter = function(){ this.style.background = "#f5f5f5"; };
      row.onmouseleave = function(){ this.style.background = "#fff"; };
      row.onclick = function(){ _pmExecuteClipSave(t.id, payload, ov); };
      listEl.appendChild(row);
    });
  }).catch(function(e){
    box.querySelector("#pm-clip-trips").innerHTML = '<div style="color:#a93826;">Couldn\'t load trips: ' + (e && e.message || e) + '</div>';
  });
}

function _pmExecuteClipSave(tripId, payload, ov){
  // Save the clip into the chosen trip's tripMeta.docs as a new doc.
  // We need to load the trip body, mutate, and save back.
  if (!MaxSync.getTrip) {
    alert("Sync API unavailable.");
    return;
  }
  var statusEl = ov.querySelector("#pm-clip-trips");
  if (statusEl) statusEl.innerHTML = '<div style="font-style:italic;color:#666;">Saving clip…</div>';

  MaxSync.getTrip(tripId).then(function(tripRow){
    if (!tripRow || !tripRow.body) throw new Error("Trip body missing");
    var body = tripRow.body;
    // The body might be wrapped { trip: {...} } or flat. Handle both.
    var tripObj = (body.trip && typeof body.trip === "object") ? body.trip : body;
    // Ensure brief.tripMeta exists.
    if (!tripObj.brief) tripObj.brief = {};
    if (!tripObj.brief.tripMeta) tripObj.brief.tripMeta = {};
    var meta = tripObj.brief.tripMeta;
    if (!Array.isArray(meta.docs)) meta.docs = [];

    var nowIso = new Date().toISOString();
    var domain = "";
    try { domain = new URL(payload.url).hostname; } catch(_){ domain = ""; }
    var titleText = payload.title || domain || "Clipped";
    // Build doc body: link card at top + selected text (if any).
    var bodyHtml = '<a href="' + (payload.url||"").replace(/"/g,"&quot;") + '" target="_blank" rel="noopener" class="pm-rt-linkcard" contenteditable="false" style="display:flex;align-items:center;gap:10px;margin:8px 0;padding:8px 12px;border:1px solid #e0e6ee;border-radius:8px;background:#fafbfd;text-decoration:none;color:#222;">'
      + '<div style="flex:1;min-width:0;">'
      +   '<div style="font-weight:600;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (titleText.replace(/</g,"&lt;")) + '</div>'
      +   '<div style="font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (payload.url || "").replace(/</g,"&lt;") + '</div>'
      + '</div>'
      + '</a>';
    if (payload.selection) {
      bodyHtml += '<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #ccc;color:#444;font-style:italic;">'
        + payload.selection.replace(/</g, "&lt;").replace(/\n/g, "<br>")
        + '</blockquote>';
    }
    var newDoc = {
      id: "d-" + Date.now().toString(36),
      title: titleText.slice(0, 80),
      body: bodyHtml,
      createdAt: nowIso,
      updatedAt: nowIso,
      tags: ["clipped"]
    };
    meta.docs.push(newDoc);

    // Bump trip\'s updatedAt so sync sees the change.
    tripObj.updatedAt = Date.now();
    if (body.trip) body.trip = tripObj;
    else body = tripObj;

    // PUT back via the trips API. MaxSync.scheduleSave debounces but
    // requires the trip to be currently loaded; use the raw _request
    // helper instead.
    return MaxSync._request("/trips/" + encodeURIComponent(tripId), {
      method: "PUT",
      body: { name: tripRow.name, body: body, updatedAt: tripObj.updatedAt }
    });
  }).then(function(){
    ov.querySelector("div[style*=\"background:#fff\"]").innerHTML =
      '<div style="text-align:center;padding:24px 12px;">'
      + '<div style="font-size:32px;margin-bottom:8px;">✓</div>'
      + '<div style="font-weight:700;margin-bottom:6px;">Saved to Max</div>'
      + '<div style="font-size:11.5px;color:#888;">You can close this window.</div>'
      + '<div style="margin-top:14px;"><button type="button" onclick="window.close();" style="font-size:12px;font-weight:600;color:#fff;background:#1a5fa8;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;">Close</button></div>'
      + '</div>';
    window._pmPendingClip = null;
  }).catch(function(e){
    alert("Couldn\'t save: " + (e && e.message || e));
    if (statusEl) statusEl.innerHTML = '<div style="color:#a93826;">Error: ' + (e && e.message || e) + '</div>';
  });
}

// Generate the bookmarklet code as a string. The user drags this onto
// their bookmarks bar.
function _pmGetClipperBookmarklet(){
  var maxUrl = location.origin + location.pathname;
  var code = "(function(){"
    + "var d={"
    +   "url:location.href,"
    +   "title:document.title,"
    +   "selection:(window.getSelection()+\"\").trim()"
    + "};"
    + "var enc=encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(d)))));"
    + "window.open(" + JSON.stringify(maxUrl) + "+'?clip='+enc,'maxclipper','width=520,height=720');"
    + "})()";
  return "javascript:" + code;
}

function _pmShowClipperSetup(){
  var existing = document.getElementById("pm-clipper-setup");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "pm-clipper-setup";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:14000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;";
  ov.onclick = function(){ ov.remove(); };
  var box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:12px;max-width:520px;width:100%;padding:22px 26px;box-shadow:0 12px 36px rgba(0,0,0,0.28);font-size:13px;color:#222;line-height:1.55;";
  box.onclick = function(e){ e.stopPropagation(); };
  var href = _pmGetClipperBookmarklet().replace(/"/g, "&quot;");
  box.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:12px;">🔖 Web clipper</div>'
    + '<div style="margin-bottom:14px;color:#444;">Drag this button onto your bookmarks bar. On any webpage, click it to save the page into a Max trip.</div>'
    + '<div style="text-align:center;padding:20px;background:#f5f1e8;border:1px dashed #d8c8a8;border-radius:8px;margin-bottom:14px;">'
    +   '<a href="' + href + '" style="display:inline-block;font-size:14px;font-weight:700;color:#fff;background:#5b3f8f;padding:10px 22px;border-radius:6px;text-decoration:none;cursor:grab;font-family:inherit;" onclick="event.preventDefault();return false;">📎 Save to Max</a>'
    +   '<div style="font-size:11px;color:#888;margin-top:8px;">↑ drag this onto your bookmarks bar</div>'
    + '</div>'
    + '<div style="font-size:12px;color:#666;line-height:1.6;">'
    +   '<strong>How it works:</strong><br>'
    +   '1. On a webpage you want to save, click the bookmarklet.<br>'
    +   '2. A small Max popup opens.<br>'
    +   '3. Pick which trip — the page lands as a new doc in that trip\'s research notes, tagged <code style="background:#f1edf8;padding:1px 5px;border-radius:3px;color:#5b3f8f;">#clipped</code>.<br>'
    +   '4. Triage and organize later inside Max.'
    + '</div>'
    + '<div style="margin-top:18px;text-align:right;">'
    +   '<button type="button" id="pm-clipper-close" style="font-size:12px;font-weight:600;color:#666;background:#fff;border:1px solid #ccc;border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;">Close</button>'
    + '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  box.querySelector("#pm-clipper-close").onclick = function(){ ov.remove(); };
}
if (typeof globalThis !== "undefined") {
  globalThis._pmMaybeStartClipFlow = _pmMaybeStartClipFlow;
  globalThis._pmShowClipperSetup = _pmShowClipperSetup;
}





function _pmCollectDiscoveryShare(){
  var payload = {
    v: 1,                                  // schema version
    sharedAt: new Date().toISOString(),
    sentence: (_tb && _tb.sentence) || "",
    region:   (_tb && _tb.region) || "",
    places:   [],
    placeMeta: {},
    tripMeta:  null
  };
  // Collect unique place names from placeActivities → requiredPlaces.
  var seen = {};
  (_tb.placeActivities || []).forEach(function(item){
    (item.requiredPlaces || []).forEach(function(p){
      if (!p || !p.place) return;
      var k = p.place.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      // Only share kept (or non-rejected) places.
      if (p._rejected === true) return;
      payload.places.push({
        name: p.place,
        country: p.country || "",
        kept: !!p._keep
      });
    });
  });
  // Per-place meta (docs, links). Strip attachments from doc bodies.
  if (_tb && _tb.placeMeta) {
    Object.keys(_tb.placeMeta).forEach(function(k){
      var m = _tb.placeMeta[k];
      if (!m) return;
      var slim = _pmSlimMetaForShare(m);
      if (slim) payload.placeMeta[k] = slim;
    });
  }
  // Trip-level meta.
  if (_tb && _tb.tripMeta) {
    payload.tripMeta = _pmSlimMetaForShare(_tb.tripMeta);
  }
  return payload;
}
function _pmSlimMetaForShare(m){
  if (!m) return null;
  var docs = Array.isArray(m.docs) ? m.docs.map(function(d){
    var body = (d.body || "").replace(/<img[^>]*>/gi, "<em>[image removed in share]</em>")
                              .replace(/<a[^>]*class="pm-rt-attach[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "<em>[file removed in share]</em>");
    return {
      id: d.id, title: d.title || "", body: body,
      createdAt: d.createdAt || null, updatedAt: d.updatedAt || null,
      tags: Array.isArray(d.tags) ? d.tags.slice() : []
    };
  }) : [];
  var links = Array.isArray(m.links) ? m.links.slice() : [];
  if (!docs.length && !links.length && !(m.notes || "").trim()) return null;
  return { docs: docs, links: links };
}
function _pmShareDiscovery(){
  var payload = _pmCollectDiscoveryShare();
  var json = JSON.stringify(payload);
  var encoded;
  try { encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(json)))); }
  catch(e){
    alert("Couldn't encode the share payload: " + (e && e.message || e));
    return;
  }
  var url = location.origin + location.pathname + "?disc=" + encoded;
  _pmShareModalShow(url, json.length);
}
function _pmShareModalShow(url, byteSize){
  var existing = document.getElementById("pm-share-modal");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "pm-share-modal";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:14000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;";
  ov.onclick = function(){ ov.remove(); };
  var box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:12px;max-width:560px;width:100%;padding:22px 26px;box-shadow:0 12px 36px rgba(0,0,0,0.28);font-size:13px;color:#222;";
  box.onclick = function(e){ e.stopPropagation(); };

  var sizeKb = (byteSize / 1024).toFixed(1);
  var urlLen = url.length;
  var sizeWarn = "";
  if (urlLen > 30000) {
    sizeWarn = '<div style="margin-top:10px;padding:8px 12px;background:#fdf6f4;border:1px solid #f0d8d2;border-radius:6px;font-size:11.5px;color:#a93826;">⚠ This URL is ' + urlLen.toLocaleString() + ' characters. Email and messaging apps may truncate it. Consider sharing fewer docs.</div>';
  } else if (urlLen > 8000) {
    sizeWarn = '<div style="margin-top:10px;padding:8px 12px;background:#fffaf0;border:1px solid #f0e0c0;border-radius:6px;font-size:11.5px;color:#8a6020;">URL is ' + urlLen.toLocaleString() + ' characters — fine for most apps but may be truncated by SMS or some chat tools.</div>';
  }

  box.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:6px;">Share this Discovery</div>'
    + '<div style="font-size:11.5px;color:#666;margin-bottom:14px;line-height:1.5;">'
    +   'Anyone with this link can view your places, notes, links, and tags — read-only. '
    +   'Attachments are stripped to keep the URL small. The URL is the only access control; treat it like a password.'
    + '</div>'
    + '<div style="display:flex;gap:6px;align-items:stretch;">'
    +   '<input id="pm-share-url" type="text" readonly value="' + url.replace(/"/g, "&quot;") + '" '
    +     'style="flex:1;font:inherit;font-size:11.5px;padding:8px 10px;border:1px solid #ccc;border-radius:6px;background:#fafafa;color:#333;overflow:hidden;text-overflow:ellipsis;" />'
    +   '<button type="button" id="pm-share-copy" '
    +     'style="font-size:12px;font-weight:600;color:#fff;background:#1a5fa8;border:1px solid #1a5fa8;border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Copy</button>'
    + '</div>'
    + sizeWarn
    + '<div style="margin-top:6px;font-size:10.5px;color:#999;">Payload: ' + sizeKb + ' KB · URL: ' + urlLen.toLocaleString() + ' chars</div>'
    + '<div style="margin-top:18px;text-align:right;">'
    +   '<button type="button" id="pm-share-close" style="font-size:12px;font-weight:600;color:#666;background:#fff;border:1px solid #ccc;border-radius:6px;padding:7px 14px;cursor:pointer;font-family:inherit;">Done</button>'
    + '</div>';

  ov.appendChild(box);
  document.body.appendChild(ov);
  var inp = box.querySelector("#pm-share-url");
  if (inp) { try { inp.focus(); inp.select(); } catch(_){} }
  box.querySelector("#pm-share-copy").onclick = function(){
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url);
      } else {
        inp.focus(); inp.select(); document.execCommand("copy");
      }
      var btn = box.querySelector("#pm-share-copy");
      btn.textContent = "Copied ✓";
      setTimeout(function(){ btn.textContent = "Copy"; }, 1800);
    } catch(e){
      alert("Couldn't copy — select the text and copy manually.");
    }
  };
  box.querySelector("#pm-share-close").onclick = function(){ ov.remove(); };
}

// Boot detection: if ?disc=… in URL, render the read-only viewer.
function _pmMaybeRenderSharedDiscovery(){
  try {
    var qs = new URLSearchParams(location.search);
    var enc = qs.get("disc");
    if (!enc) return false;
    var json;
    try {
      json = decodeURIComponent(escape(atob(decodeURIComponent(enc))));
    } catch(e){
      alert("This share link is malformed or truncated.");
      return false;
    }
    var payload;
    try { payload = JSON.parse(json); }
    catch(e){ alert("Couldn't parse share data."); return false; }
    _pmRenderSharedDiscoveryViewer(payload);
    return true;
  } catch(_){ return false; }
}
function _pmRenderSharedDiscoveryViewer(p){
  document.body.innerHTML = '';
  var wrap = document.createElement("div");
  wrap.style.cssText = "max-width:760px;margin:0 auto;padding:28px 22px 60px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#222;line-height:1.5;";
  function esc(s){ return _escHtml(s); }
  var html = '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:18px;border-bottom:1px solid #eee;padding-bottom:14px;">'
    + '<div>'
    +   '<div style="font-size:11px;color:#888;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">SHARED DISCOVERY</div>'
    +   '<div style="font-size:22px;font-weight:700;margin-top:4px;">' + (esc(p.region) || "Trip planning") + '</div>'
    +   (p.sentence ? '<div style="font-size:13px;color:#555;margin-top:6px;font-style:italic;">' + esc(p.sentence) + '</div>' : '')
    + '</div>'
    + '<a href="' + location.origin + location.pathname + '" style="font-size:11.5px;color:#1a5fa8;text-decoration:none;font-weight:600;flex-shrink:0;">Open Max →</a>'
    + '</div>';

  function renderMeta(label, meta){
    if (!meta) return '';
    var out = '<div style="margin-top:6px;">';
    if (Array.isArray(meta.docs) && meta.docs.length) {
      meta.docs.forEach(function(d){
        out += '<div style="margin:10px 0 16px;padding:12px 14px;background:#fafafa;border:1px solid #eee;border-radius:6px;">'
          + '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">' + esc(d.title || "Untitled") + '</div>'
          + (Array.isArray(d.tags) && d.tags.length
              ? '<div style="margin-bottom:6px;">' + d.tags.map(function(t){
                  return '<span style="display:inline-block;font-size:10px;font-weight:600;color:#5b3f8f;background:#f1edf8;border:1px solid #ddd5ec;border-radius:8px;padding:1px 7px;margin-right:4px;">#' + esc(t) + '</span>';
                }).join('') + '</div>'
              : '')
          + '<div style="font-size:13px;line-height:1.55;">' + (d.body || "") + '</div>'
          + '</div>';
      });
    }
    if (Array.isArray(meta.links) && meta.links.length) {
      out += '<div style="margin-top:8px;"><div style="font-size:10.5px;font-weight:700;color:#888;letter-spacing:.05em;text-transform:uppercase;margin-bottom:4px;">Links</div>';
      meta.links.forEach(function(l){
        var name = esc(l.name || l.domain || l.url || "link");
        var url  = esc(l.url || "#");
        out += '<div style="padding:5px 0;"><a href="' + url + '" target="_blank" rel="noopener" style="color:#1a5fa8;text-decoration:none;font-weight:600;font-size:12px;">↗ ' + name + '</a></div>';
      });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  if (p.tripMeta && (p.tripMeta.docs && p.tripMeta.docs.length || p.tripMeta.links && p.tripMeta.links.length)) {
    html += '<div style="margin:24px 0;"><div style="font-size:13px;font-weight:700;color:#5b3f8f;margin-bottom:8px;">🔬 Trip-level notes</div>' + renderMeta("trip", p.tripMeta) + '</div>';
  }
  if (Array.isArray(p.places) && p.places.length) {
    html += '<div style="margin-top:24px;"><div style="font-size:13px;font-weight:700;color:#444;margin-bottom:8px;">Places (' + p.places.length + ')</div>';
    p.places.forEach(function(pl){
      var k = pl.name.toLowerCase();
      var meta = p.placeMeta[k];
      html += '<div style="margin:14px 0;padding:14px 16px;border:1px solid #e6e1d5;border-radius:8px;">'
        + '<div style="font-size:15px;font-weight:700;display:flex;align-items:baseline;gap:8px;">'
        +   esc(pl.name)
        +   (pl.country ? '<span style="font-size:11px;color:#888;font-weight:400;">' + esc(pl.country) + '</span>' : '')
        + '</div>'
        + (meta ? renderMeta(pl.name, meta) : '<div style="font-size:11.5px;color:#999;margin-top:4px;font-style:italic;">No notes shared.</div>')
        + '</div>';
    });
    html += '</div>';
  }
  html += '<div style="margin-top:32px;padding-top:14px;border-top:1px solid #eee;font-size:10.5px;color:#aaa;text-align:center;">Shared ' + esc(p.sharedAt ? new Date(p.sharedAt).toLocaleString() : "") + ' via Max</div>';

  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  document.title = "Shared Discovery · " + (p.region || "Max");
}
if (typeof globalThis !== "undefined") {
  globalThis._pmShareDiscovery = _pmShareDiscovery;
  globalThis._pmMaybeRenderSharedDiscovery = _pmMaybeRenderSharedDiscovery;
}

function _pmShowUndo(message, undoFn){
  var prev = document.getElementById("pm-undo-toast");
  if (prev) {
    if (prev._pmUndoTimer) clearTimeout(prev._pmUndoTimer);
    prev.remove();
  }
  var toast = document.createElement("div");
  toast.id = "pm-undo-toast";
  toast.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:13000;display:flex;align-items:center;gap:12px;padding:10px 14px 10px 16px;background:#1f1f1f;color:#fff;font-family:inherit;font-size:13px;line-height:1.4;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.32);max-width:90vw;";
  var msg = document.createElement("span");
  msg.style.cssText = "flex:1;";
  msg.textContent = message;
  var undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.textContent = "Undo";
  undoBtn.style.cssText = "font:inherit;font-weight:600;color:#7ec8ff;background:transparent;border:none;cursor:pointer;padding:4px 8px;border-radius:4px;";
  undoBtn.onmouseenter = function(){ undoBtn.style.background = "rgba(255,255,255,0.08)"; };
  undoBtn.onmouseleave = function(){ undoBtn.style.background = "transparent"; };
  var closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "×";
  closeBtn.style.cssText = "font:inherit;font-size:18px;color:#aaa;background:transparent;border:none;cursor:pointer;padding:0 4px;line-height:1;";
  toast.appendChild(msg);
  toast.appendChild(undoBtn);
  toast.appendChild(closeBtn);
  function dismiss(){
    if (toast._pmUndoTimer) clearTimeout(toast._pmUndoTimer);
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }
  undoBtn.onclick = function(){
    try { if (typeof undoFn === "function") undoFn(); } catch(_){}
    dismiss();
  };
  closeBtn.onclick = dismiss;
  document.body.appendChild(toast);
  toast._pmUndoTimer = setTimeout(dismiss, 5000);
}
if (typeof globalThis !== "undefined") globalThis._pmShowUndo = _pmShowUndo;
