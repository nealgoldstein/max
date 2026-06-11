// paste-browse-modal.js — extracted verbatim from index.html (PD.483 bloat reduction).
// Paste-list brief modal + browse-chat + home selection.
// Pure function-cluster: declarations + globalThis-guarded exposures, no
// top-level boot code. Loaded as a classic script BEFORE the main inline
// block, so every function remains a global exactly as before.

// ──────────────────────────────────────────────────────────────────────
function _openPasteListBriefModal(opts){
  opts = opts || {};
  var existing = document.getElementById("paste-list-overlay");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "paste-list-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10800;display:flex;align-items:center;justify-content:center;padding:24px;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:580px;max-width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 36px rgba(0,0,0,0.22);";
  var subtitle = opts.subtitle || "One place per line. Max will fetch details and add suggestions around what you list.";
  box.innerHTML = ''
    + '<div style="padding:16px 20px 10px;border-bottom:1px solid var(--c-border-3);">'
    +   '<div style="font-size:15px;font-weight:700;color:var(--c-ink);">What\'s on your list?</div>'
    +   '<div style="font-size:11.5px;color:#777;margin-top:5px;line-height:1.5;">' + subtitle + '</div>'
    + '</div>'
    + '<div style="flex:1;overflow-y:auto;padding:14px 20px;display:flex;flex-direction:column;gap:14px;">'
    +   '<div>'
    +     '<label style="display:block;font-size:11.5px;font-weight:600;color:#444;margin-bottom:5px;">'
    +       '<span style="margin-right:5px;">🛏</span>Places I want to stay'
    +     '</label>'
    +     '<textarea id="paste-stays" placeholder="Reykjavík&#10;Vík&#10;Akureyri" style="width:100%;min-height:120px;font:inherit;font-size:12.5px;line-height:1.5;padding:8px 10px;border:1px solid var(--c-border-strong);border-radius:6px;background:var(--c-bg);color:var(--c-ink);resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>'
    +   '</div>'
    +   '<div>'
    +     '<label style="display:block;font-size:11.5px;font-weight:600;color:#444;margin-bottom:5px;">'
    +       '<span style="margin-right:5px;">📍</span>Things I want to see and do'
    +     '</label>'
    +     '<textarea id="paste-sees" placeholder="Seljalandsfoss&#10;Skógafoss&#10;Reynisfjara&#10;Jökulsárlón" style="width:100%;min-height:140px;font:inherit;font-size:12.5px;line-height:1.5;padding:8px 10px;border:1px solid var(--c-border-strong);border-radius:6px;background:var(--c-bg);color:var(--c-ink);resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>'
    +   '</div>'
    +   '<div id="paste-brief-preview" style="font-size:11.5px;color:var(--c-ink-2);line-height:1.55;min-height:18px;"></div>'
    + '</div>'
    + '<div style="padding:12px 20px;border-top:1px solid var(--c-border-3);display:flex;justify-content:flex-end;gap:8px;">'
    +   '<button id="paste-brief-cancel" type="button" style="font-size:13px;font-weight:500;color:var(--c-ink-2);background:var(--c-bg);border:1px solid var(--c-border-strong);border-radius:6px;padding:8px 14px;cursor:pointer;font-family:inherit;">Cancel</button>'
    +   '<button id="paste-brief-build" type="button" style="font-size:13px;font-weight:700;color:var(--c-on-dark);background:var(--c-primary);border:1px solid var(--c-primary);border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;" disabled>Open in discovery →</button>'
    + '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  function close(){ if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  // PD.166: backdrop click does NOT close. Same reason as in
  // _openPasteListModal — protect against accidental loss of pasted text.
  document.getElementById("paste-brief-cancel").onclick = close;

  var staysEl = document.getElementById("paste-stays");
  var seesEl = document.getElementById("paste-sees");
  var buildBtn = document.getElementById("paste-brief-build");
  var prev = document.getElementById("paste-brief-preview");

  function parseSection(text, isStay){
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function(line){
      var p = line.trim().replace(/^[*\-•+]\s*/, "").trim();
      if (!p) return;
      // PD.219: tag with _userIntent so the PD.215/PD.216 classifier
      // guards fire. Without this, the two-textarea modal's custom
      // parser was producing entries with no _userIntent — the
      // classifier would then fall back to LLM judgment alone, and
      // sights with no LLM-suggested parent would get Step-3-promoted
      // to standalone destinations (re-introducing the Skaftafell /
      // Þingvellir / etc. bug PD.216 was supposed to kill).
      out.push({
        place: p,
        nights: 0,
        isStay: isStay,
        intent: "",
        _userIntent: isStay ? "stay" : "see"
      });
    });
    return out;
  }
  function synthesize(){
    var stays = parseSection(staysEl.value, true);
    var sees  = parseSection(seesEl.value, false);
    // PD.220: stays subsume sights. If a place appears in both fields,
    // the stay wins — the destination card's See-and-Do tab already
    // represents "things to do here," so listing the same name as a
    // separate sight is redundant. Without this dedup, the sees concat
    // overrode the stays entry in _pastedRoles (last write wins) and
    // Stykkishólmur-in-both ended up as a sight rather than a stay.
    var _nrm220 = (typeof _normPlaceName === "function")
      ? _normPlaceName
      : function(s){ return String(s || "").toLowerCase().trim(); };
    var stayKeys = {};
    stays.forEach(function(p){
      if (p && p.place) stayKeys[_nrm220(p.place)] = true;
    });
    var dedupedSees = sees.filter(function(p){
      return !(p && p.place && stayKeys[_nrm220(p.place)]);
    });
    var all = stays.concat(dedupedSees);
    return {
      destinations: all,
      tripName: (_tb && _tb.name) || (_tb && _tb.region) || "",
      region:   (_tb && _tb.region) || (_tb && _tb.placeName) || "",
      when:     (_tb && _tb.when) || "",
      duration: (_tb && _tb.duration) || "",
      startDate:(_tb && _tb.startDate) || "",
      entry:    (_tb && _tb.entry) || null,
      exit:     (_tb && _tb.tbExit) || null,
      warnings: []
    };
  }
  function refresh(){
    var r = synthesize();
    var nStay = r.destinations.filter(function(d){ return d.isStay; }).length;
    var nSee  = r.destinations.filter(function(d){ return !d.isStay; }).length;
    var bits = [];
    if (r.tripName) bits.push('trip: <strong>' + r.tripName + '</strong>');
    if (r.region && r.region !== r.tripName) bits.push('region: <strong>' + r.region + '</strong>');
    if (r.destinations.length) bits.push('<strong>' + r.destinations.length + '</strong> place' + (r.destinations.length === 1 ? '' : 's') + ' (' + nStay + ' stay, ' + nSee + ' see)');
    if (r.when) bits.push('when: <strong>' + r.when + '</strong>');
    if (r.duration) bits.push('duration: <strong>' + r.duration + '</strong>');
    prev.innerHTML = bits.length
      ? ('Will create: ' + bits.join(' · '))
      : '<span style="color:var(--c-ink-4);">Add places above to see a preview.</span>';
    buildBtn.disabled = !r.destinations.length;
  }
  staysEl.addEventListener("input", refresh);
  seesEl.addEventListener("input", refresh);
  refresh();
  buildBtn.onclick = function(){
    var r = synthesize();
    if (!r.destinations.length) return;
    var raw = "stays:\n" + staysEl.value + "\n\nsees:\n" + seesEl.value;
    close();
    if (typeof opts.onBuild === "function") opts.onBuild(r, raw);
  };
  setTimeout(function(){ try { staysEl.focus(); } catch(_){} }, 30);
}
if (typeof globalThis !== "undefined") globalThis._openPasteListBriefModal = _openPasteListBriefModal;

function _pasteListFromBrief(){
  // Carry current brief inputs into _tb so the paste-list build has
  // them available (region, dates, pace, etc.). If the pasted list
  // includes its own region on the first line, that wins downstream —
  // the parser overrides region anyway.
  try {
    if (typeof _tb === "undefined" || !_tb) window._tb = _tb = _tbInstall({});
    var fields = [
      ["tb-region","region"], ["tb-when","when"], ["tb-duration","duration"],
      ["tb-place-name","placeName"], ["tb-intent","intent"], ["tb-anchors","anchors"],
      ["tb-entry","entry"], ["tb-exit","tbExit"]
    ];
    fields.forEach(function(pair){
      var el = document.getElementById(pair[0]);
      if (el && typeof el.value === "string") {
        var v = el.value.trim();
        if (v) _tb[pair[1]] = v;
      }
    });
  } catch(_){}
  if (typeof _openPasteListBriefModal !== "function") return;
  _openPasteListBriefModal({
    onBuild: function(parsed, rawText){
      if (typeof _buildPickerFromPastedList === "function") {
        _buildPickerFromPastedList(parsed, rawText);
      }
    }
  });
}
if (typeof globalThis !== "undefined") globalThis._pasteListFromBrief = _pasteListFromBrief;

function selectHomeOption(id){
  // Round DI: the trip list is always visible now; only the modal-style
  // surfaces (new-trip-form, browse-chat) toggle in response to action
  // buttons. Legacy hs-options card highlighting is a no-op since the
  // welcome card was removed; left here defensively in case other
  // entry points still call selectHomeOption.
  var opts = g("hs-options");
  if(opts){
    var cards = opts.querySelectorAll(".hs-option");
    cards.forEach(function(c){
      if(c.dataset.id === id){ c.style.borderColor = "#111"; c.style.background = "#f5f5f5"; }
      else { c.style.borderColor = "#e0e0e0"; c.style.background = "#fff"; }
    });
  }

  // Reset modal-style surfaces
  g("new-trip-form").style.display = "none";
  var bc = g("browse-chat"); if(bc){ bc.style.display = "none"; bc.innerHTML = ""; }

  if(id === "new"){
    // Round DJ: skip the naming step. Auto-generate "Untitled — <date>"
    // so the user goes straight into the Brief; they can rename on the
    // trip view via click-to-edit on the trip-name header.
    var now = new Date();
    var dateStr = now.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"});
    var autoName = "Untitled — " + dateStr;
    var inp = g("ntp-name"); if (inp) inp.value = autoName;
    // v353.2: show the AI-disclaimer modal before opening the brief.
    // Every new-trip start gets it. Continue → opens the brief form.
    if (typeof showAIDisclaimer === "function") {
      showAIDisclaimer(showTripBrief);
    } else {
      showTripBrief();
    }
  } else if(id === "resume"){
    // Trip list is already visible — just scroll to it.
    setTimeout(function(){ g("hs-trips-section").scrollIntoView({behavior:"smooth",block:"nearest"}); }, 80);
  } else if(id === "import"){
    openTripFile();
  } else if(id === "paste"){
    // v359.60.26: paste-a-list flow mints a stub trip and routes
    // straight through the picker — each pasted place is enriched by
    // the LLM (country / coords / whyItFits / role / tags / stayRange)
    // and shown as candidates in the candidate-explorer. The user
    // reviews / keeps / rejects / reorders, then commits via "Create
    // a plan →". Research-notes auto-open is gone — the picker IS the
    // review surface. Same AI-disclaimer gate as "+ Start a new trip."
    var _runPaste = function () {
      _openPasteListModal({
        title: "Paste a list of places",
        buildLabel: "Open in picker →",
        onBuild: function(parsed, rawText) {
          _buildPickerFromPastedList(parsed, rawText);
        }
      });
    };
    if (typeof showAIDisclaimer === "function") {
      showAIDisclaimer(_runPaste);
    } else {
      _runPaste();
    }
  } else if(id === "browse"){
    // v353.2: same AI-disclaimer modal that fires on "+ Start a new
    // trip." Browse is the chat-with-Max surface where the user is
    // actively asking the LLM for information about places — exactly
    // the moment when "Max can be flat-out wrong / incomplete / out
    // of date" matters most.
    var _runBrowse = function () {
      renderBrowseChat();
      setTimeout(function(){ var bc2 = g("browse-chat"); if(bc2) bc2.scrollIntoView({behavior:"smooth",block:"nearest"}); }, 80);
    };
    if (typeof showAIDisclaimer === "function") {
      showAIDisclaimer(_runBrowse);
    } else {
      _runBrowse();
    }
  }
}

async function renderBrowseChat(){
  var bc = g("browse-chat");
  if(!bc) return;
  bc.style.display = "block";
  bc.innerHTML = '<div style="background:#fbfaf6;border:1px solid #e8e4d8;border-radius:8px;padding:14px 16px;font-family:Georgia,serif;font-size:13px;line-height:1.7;color:#333;">'
    + '<div style="font-size:10px;font-weight:700;color:#888;letter-spacing:0.05em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;margin-bottom:6px;">Max says\u2026</div>'
    + '<div id="browse-chat-body"><span class="max-thinking">Let me think\u2026</span></div>'
    + '<textarea id="browse-input" rows="2" placeholder="e.g. somewhere warm, slow, not too crowded\u2026" style="width:100%;margin-top:12px;font-size:12px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;resize:vertical;box-sizing:border-box;"></textarea>'
    + '<div style="margin-top:8px;display:flex;gap:6px;">'
    + '<button id="browse-send" style="font-size:11px;padding:6px 14px;background:var(--c-primary-top);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Ask Max</button>'
    + '<button onclick="document.getElementById(\'browse-chat\').style.display=\'none\';renderHomeOptions();" style="font-size:11px;padding:6px 10px;background:var(--c-bg);color:var(--c-ink-3);border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Never mind</button>'
    + '</div>'
    + '</div>';

  // Initial warm opener from Max
  var openerPrompt = "You are Max, a well-traveled friend. The user is on the home screen and has tapped \"Or just browse \u2014 I\'m not planning yet.\" They don\'t have a destination in mind. Greet them warmly in 2-3 sentences (Georgia-serif tone, no bullet points, no lists). Invite them to say what they\'re in the mood for \u2014 a feeling, a climate, a kind of place, even something vague like \"somewhere I can read outdoors.\" Make it easy to say anything. Don\'t sell travel; just be present.";
  try {
    var text = await callMax([{role:"user", content: openerPrompt}], 300, 20000);
    var body = g("browse-chat-body");
    if(body) body.textContent = (text||"").trim();
  } catch(e){
    var body2 = g("browse-chat-body");
    if(body2) body2.textContent = "Not planning yet? That\u2019s fine. Tell me what you\u2019re in the mood for \u2014 a feeling, a climate, a kind of place. Even something vague. I\u2019ll take it from there.";
  }

  // Wire send
  var sendBtn = g("browse-send");
  if(sendBtn){
    sendBtn.onclick = function(){ browseChatSend(); };
  }
  var inp = g("browse-input");
  if(inp){
    inp.onkeydown = function(e){
      if(e.key === "Enter" && (e.metaKey || e.ctrlKey)){
        e.preventDefault();
        browseChatSend();
      }
    };
  }
}

var _browseHistory = [];
async function browseChatSend(){
  var inp = g("browse-input");
  if(!inp) return;
  var userMsg = inp.value.trim();
  if(!userMsg) return;
  inp.value = "";
  // Clear the example placeholder — once the conversation has started, it just adds noise
  inp.placeholder = "";
  var body = g("browse-chat-body");
  if(!body) return;

  // Append user message to history + UI
  _browseHistory.push({role:"user", content:userMsg});
  var userEl = document.createElement("div");
  userEl.style.cssText = "margin-top:10px;padding:6px 10px;background:#f0ede3;border-radius:6px;font-size:12px;color:#333;";
  userEl.textContent = userMsg;
  body.appendChild(userEl);

  var thinkingEl = document.createElement("div");
  thinkingEl.style.cssText = "margin-top:10px;";
  thinkingEl.className = "max-thinking";
  thinkingEl.textContent = "Max is thinking\u2026";
  body.appendChild(thinkingEl);

  var systemPreamble = "You are Max, a well-traveled friend talking with someone who said they\'re not planning a trip yet \u2014 they just want to browse, dream, get ideas. Be warm, specific, curious. Ask clarifying questions when helpful. Offer 1\u20133 specific places as suggestions when the user gives you enough to work with (not a numbered list \u2014 weave them into prose). Keep responses 2\u20135 sentences. Georgia-serif tone, no bullet points, no headers. If they seem ready to actually plan, you can say so gently \u2014 but don\'t push.";
  var messages = [{role:"user", content: systemPreamble + "\n\nStart the conversation."}];
  // Reconstruct the dialogue turns
  _browseHistory.forEach(function(m){ messages.push(m); });

  try {
    var text = await callMax(messages, 500, 30000);
    body.removeChild(thinkingEl);
    var maxEl = document.createElement("div");
    maxEl.style.cssText = "margin-top:10px;line-height:1.7;";
    maxEl.textContent = (text||"").trim();
    body.appendChild(maxEl);
    _browseHistory.push({role:"assistant", content: text});
    body.scrollTop = body.scrollHeight;
  } catch(e){
    thinkingEl.textContent = "(Max couldn\u2019t respond just now. Try again in a moment.)";
  }
}

function selectTrip(id){
  if(localLoad(id)){
    _currentTripId=id;
    // PD.330: explicit user action ⇒ trip overview, UNLESS the URL
    // already targets this same trip on a deeper screen (boot path:
    // someone hard-refreshed at /trip/<id>/discovery — we don't want
    // to overwrite that with /trip/<id>).
    //
    // PD.338: a DISCOVERY-STAGE trip opens in Discovery. A trip with
    // zero destinations but candidates/placeActivities hasn't been
    // built yet — its trip overview is an empty shell ("opens in the
    // trip view" with nothing in it). Opening such a trip resumes
    // Discovery, where the user's actual work-in-progress lives. The
    // dispatcher picks the right Discovery surface (activity picker
    // vs candidate explorer) from the data shape.
    if (typeof MaxRoute !== "undefined") {
      var current = MaxRoute.parse();
      if (!current || current.tripId !== id) {
        var _isDiscoveryStage = trip
          && !(Array.isArray(trip.destinations) && trip.destinations.length)
          && ((Array.isArray(trip.candidates) && trip.candidates.length)
              || (Array.isArray(trip.placeActivities) && trip.placeActivities.length));
        // PD.338a: otherwise, reopen where the user LEFT OFF on this
        // device — a built trip whose user went back to Discovery
        // reopens into Discovery; one left on a destination view
        // reopens there (if the destination still exists).
        var _target = { screen: MaxRoute.SCREENS.TRIP, tripId: id };
        if (_isDiscoveryStage) {
          _target.screen = MaxRoute.SCREENS.DISCOVERY;
        } else {
          var _last = (typeof _recallLastScreen === "function") ? _recallLastScreen(id) : null;
          if (_last && _last.screen && _last.screen !== MaxRoute.SCREENS.HOME) {
            if (_last.screen === MaxRoute.SCREENS.DEST) {
              var _destOk = _last.destId && Array.isArray(trip.destinations)
                && trip.destinations.some(function(d){ return d && d.id === _last.destId; });
              if (_destOk) { _target.screen = MaxRoute.SCREENS.DEST; _target.destId = _last.destId; }
            } else {
              _target.screen = _last.screen;
            }
          }
        }
        MaxRoute.navigate(_target, { replace: true });
      }
    }
    enterApp();
    return;
  }
  // v359.60.92: silent local-load failure was the worst kind of bug —
  // user taps a trip card on the home screen and nothing happens, no
  // error, no spinner, no hint that the trip body just isn't in
  // localStorage on this device. Most common cause: the user was
  // signed out (10-year session somehow lost, or _wipeLocalTripCache
  // ran on a forced sign-out), signed back in, and the trips index
  // has been restored but the bodies are still being fetched — or
  // pullAll already finished but a specific body fetch failed mid-way
  // and the index entry stuck around without its body.
  //
  // Fallback: if we're signed in, fetch this trip from the server
  // directly, write the body, then retry the load. Surface failures
  // explicitly so the user knows whether to retry or report.
  if (typeof MaxSync === "undefined" ||
      typeof MaxSync.isSignedIn !== "function" ||
      !MaxSync.isSignedIn() ||
      typeof MaxSync.getTrip !== "function") {
    if (typeof maxAlert === "function") {
      maxAlert("Couldn't open that trip — its data isn't on this device. Sign in to sync it from the server.");
    }
    return;
  }
  // Show a brief loading state so the click feels acknowledged.
  if (typeof showSaveStatus === "function") {
    try { showSaveStatus("Loading trip…", 6000); } catch (_) {}
  }
  MaxSync.getTrip(id).then(function (full) {
    if (!full || !full.trip || !full.trip.body) {
      throw new Error("Server returned no trip body");
    }
    var serverTs = full.trip.updatedAt ? new Date(full.trip.updatedAt).getTime() : Date.now();
    var envelope = Object.assign({}, full.trip.body, { __saved__: serverTs });
    var serialized = JSON.stringify(envelope);
    // Route through MaxDB.trip.writeRaw when available so engine-trip's
    // tripWritten subscriber picks up the new body — matches the
    // pullAll path. Plain setItem is the defense-in-depth fallback.
    try {
      if (typeof MaxDB !== "undefined" && MaxDB.trip &&
          typeof MaxDB.trip.writeRaw === "function") {
        MaxDB.trip.writeRaw(id, serialized);
      } else {
        _persistTripRaw(id, serialized);
      }
    } catch (e) {
      console.warn("[Max] selectTrip server-fallback save failed:", e);
      _persistTripRaw(id, serialized);
    }
    if (localLoad(id)) {
      _currentTripId = id;
      enterApp();
    } else {
      throw new Error("localLoad still failed after server fetch");
    }
  }).catch(function (err) {
    console.warn("[Max] selectTrip server-fallback failed:", err);
    var msg = "Couldn't open that trip. ";
    if (err && err.code === "AUTH") {
      msg += "Your sign-in expired — sign in again and try once more.";
    } else if (err && err.code === "NETWORK") {
      msg += "You appear to be offline. Reconnect and try again.";
    } else {
      msg += "Try again, or refresh the page.";
    }
    if (typeof maxAlert === "function") maxAlert(msg);
  });
}

// v353.5: duplicate a trip locally + push to server. Clones the entire
// trip envelope (trip body, counters, dest IDs all unchanged — IDs are
// trip-scoped so reusing them in a new trip is fine) under a fresh
// trip ID and " (copy)" name. The original is untouched. Sync layer
// POSTs the clone to the server so it shows up on other devices.
function duplicateTrip(srcId, openAfter){
  if (!srcId) return null;
  // v359.60.93: route the source read through MaxDB.trip.readRaw so
  // IDB-only source trips can still be duplicated. Same fix as
  // localLoad / _readTripById — the localStorage-only read was
  // silently failing for trips that overflowed to IndexedDB.
  var srcRaw = null;
  try {
    if (typeof MaxDB !== "undefined" && MaxDB.trip && typeof MaxDB.trip.readRaw === "function") {
      srcRaw = MaxDB.trip.readRaw(srcId);
    }
    if (!srcRaw) srcRaw = localStorage.getItem("max-trip-" + srcId);
  } catch (_) {}
  if (!srcRaw) { maxAlert("Couldn't read source trip."); return null; }
  var env;
  try { env = JSON.parse(srcRaw); } catch (_) { return null; }
  if (!env || !env.trip) return null;

  var newId = "trip-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
  var srcName = (env.trip.name || "Untitled trip");
  var newName = /\(copy\)$/i.test(srcName) ? srcName + " 2" : srcName + " (copy)";

  // Deep clone + patch identity fields. _dupedFrom kept for debugging /
  // future "open original" affordances; not used by render code today.
  var clone;
  try { clone = JSON.parse(JSON.stringify(env)); }
  catch (_) { maxAlert("Couldn't clone the trip body."); return null; }
  clone.trip.id = newId;
  clone.trip.name = newName;
  clone.trip._dupedFrom = srcId;
  clone.__saved__ = Date.now();
  // Per-trip UI state (banners expanded etc.) is intentionally cloned
  // so the new trip lands looking the same as the original. If we
  // ever want a fresh-look duplicate, delete clone._uiState here.

  try { _persistTripRaw(newId, JSON.stringify(clone)); }
  catch (e) {
    console.warn("[Max] duplicate save failed:", e);
    maxAlert("Out of storage. Delete some old trips and try again.");
    return null;
  }

  // Index entry — clone the source's metadata so dates / destCount /
  // flight info are preserved on the new card without re-derivation.
  var srcIdx = (_tripsIndex || []).find(function(t){ return t && t.id === srcId; });
  if (srcIdx) {
    var newIdx;
    try { newIdx = JSON.parse(JSON.stringify(srcIdx)); }
    catch (_) { newIdx = { id: newId, name: newName }; }
    newIdx.id = newId;
    newIdx.name = newName;
    newIdx.savedAt = new Date().toISOString();
    // v353.5: append rather than unshift so the duplicate appears
    // below the original. The home-screen list sorts chronologically
    // by start date in renderHomeDashboard, so this just affects the
    // initial unsorted order; if dates are identical the original
    // shows above the copy, which is the right mental model.
    // PD.327: single mutator. Copy uses a fresh newId so upsert appends.
    _upsertTripIndexEntry(newIdx);
  }

  // Push to server. Fire-and-forget — local copy already persisted, so
  // worst case the trip is local-only until next sync.
  if (typeof MaxSync !== "undefined" &&
      typeof MaxSync.isSignedIn === "function" && MaxSync.isSignedIn() &&
      typeof MaxSync._request === "function") {
    MaxSync._request("/trips", {
      method: "POST",
      body: { id: newId, name: newName, body: clone, updatedAt: Date.now() },
    }).catch(function (err) {
      console.warn("[Max] server duplicate failed:", err);
    });
  }

  if (openAfter) {
    selectTrip(newId);
  } else {
    // Re-render the home-screen trip list so the new card appears.
    if (typeof renderHomeDashboard === "function") renderHomeDashboard();
  }
  return newId;
}

// One-time migration: pull car rentals out of the legacy trip.logistics.carRentals
// array and turn each one into Tracker items on the destination where pickup happens.
// Runs on every trip load but only migrates if _rentalsMigrated flag is unset.
function migrateCarRentalsIntoTracker(){
  if(!trip || !trip.logistics || !trip.logistics.carRentals) return;
  if(trip._rentalsMigrated) return;
  var rentals = trip.logistics.carRentals;
  if(!rentals.length) { trip._rentalsMigrated = true; return; }

  var migrated = 0;
  rentals.forEach(function(r){
    if(!r || (!r.pickupLocation && !r.company)) return; // skip empty rows
    // Try to match pickup location to a destination by place name (case-insensitive substring)
    var pickupLC = (r.pickupLocation||"").toLowerCase().trim();
    var returnLC = (r.returnLocation||"").toLowerCase().trim();
    function findDestByPlace(nameLC){
      if(!nameLC) return null;
      return (trip.destinations||[]).find(function(d){
        var dp = (d.place||"").toLowerCase();
        return dp && (dp.indexOf(nameLC) >= 0 || nameLC.indexOf(dp) >= 0);
      });
    }
    var pickupDest = findDestByPlace(pickupLC);
    var returnDest = findDestByPlace(returnLC);

    // Build a pickup tracker item string
    if(pickupDest){
      if(!pickupDest.trackerItems) pickupDest.trackerItems = {booked:[],see:[],visited:[]};
      var parts = ["\uD83D\uDE97 Car rental pickup"];
      if(r.company) parts.push(r.company);
      if(r.carType) parts.push("(" + r.carType + ")");
      if(r.pickupDate) parts.push("\u2014 " + r.pickupDate);
      var pickupStr = parts.join(" ");
      // Avoid duplicate on repeated loads
      if(pickupDest.trackerItems.booked.indexOf(pickupStr) === -1){
        pickupDest.trackerItems.booked.push(pickupStr);
        migrated++;
      }
    }

    // Build a return tracker item on the return destination (if different from pickup)
    if(returnDest && returnDest !== pickupDest){
      if(!returnDest.trackerItems) returnDest.trackerItems = {booked:[],see:[],visited:[]};
      var retParts = ["\uD83D\uDE97 Car rental return"];
      if(r.company) retParts.push(r.company);
      if(r.returnDate) retParts.push("\u2014 " + r.returnDate);
      var returnStr = retParts.join(" ");
      if(returnDest.trackerItems.booked.indexOf(returnStr) === -1){
        returnDest.trackerItems.booked.push(returnStr);
        migrated++;
      }
    }

    // If neither matched, fall back to adding to the first destination with a note about the pickup location
    if(!pickupDest && !returnDest && trip.destinations && trip.destinations.length){
      var first = trip.destinations[0];
      if(!first.trackerItems) first.trackerItems = {booked:[],see:[],visited:[]};
      var orphanParts = ["\uD83D\uDE97 Car rental"];
      if(r.company) orphanParts.push(r.company);
      if(r.pickupLocation) orphanParts.push("pickup " + r.pickupLocation);
      if(r.pickupDate) orphanParts.push(r.pickupDate);
      if(r.returnLocation && r.returnLocation !== r.pickupLocation) orphanParts.push("\u2192 return " + r.returnLocation);
      if(r.returnDate) orphanParts.push(r.returnDate);
      var orphanStr = orphanParts.join(" ");
      if(first.trackerItems.booked.indexOf(orphanStr) === -1){
        first.trackerItems.booked.push(orphanStr);
        migrated++;
      }
    }
  });

  trip._rentalsMigrated = true;
  if(migrated > 0){
    console.log("Migrated " + migrated + " car rental item(s) into Tracker");
    if(typeof autoSave === "function") autoSave();
  }
}

// v359.60.10: expose entry functions on globalThis so Playwright
// tests can invoke them via page.evaluate(window.X). Without this,
// the picker-flow / trip-mutators specs hit "X is not on window"
// and fail before exercising the actual logic. These are function
// declarations so they're hoisted; assigning to globalThis here
// just makes them addressable as window.X. No runtime cost.
if (typeof globalThis !== "undefined") {
  if (typeof localLoad === "function") globalThis.localLoad = localLoad;
  if (typeof enterApp === "function") globalThis.enterApp = enterApp;
}

function enterApp(){
  // PD.330: URL hash is the source of truth for the current screen.
  // enterApp runs the full app-shell + trip-view setup unconditionally
  // (init map, draw trip view, etc.) — that's the "you're in the app
  // with a trip" baseline. AFTER the baseline is in place, dispatch
  // against the URL: lay a picker / brief overlay on top, or drop
  // into a destination view. Direct URL access (deep links, refresh
  // on Discovery) works because the URL is read after baseline.
  //
  // The legacy trip._lastScreen + _restoreLastScreen machinery is
  // gone. Renderers don't stamp; the dispatcher reads the URL.
  var hs = g("home-screen"); if (hs) hs.style.display = "none";
  var app = g("app"); if (app) app.style.display = "flex";
  // Normalize: if a trip is loaded but the URL doesn't reference it
  // (test seeding, file load, direct enterApp call), point the URL
  // at the trip overview so renderers + listeners agree on the trip.
  if (typeof MaxRoute !== "undefined" && trip && trip.id) {
    var _r = MaxRoute.parse();
    if (!_r || !_r.tripId || _r.tripId !== trip.id) {
      MaxRoute.navigate({ screen: MaxRoute.SCREENS.TRIP, tripId: trip.id }, { replace: true });
    }
  }
  // Restore _mdcItems from saved trip for route sequencing
  if(trip && trip.placeActivities) _mdcItems = trip.placeActivities;
  // PD.196 (architectural reset): all one-shot trip-load migrations
  // deleted. Going forward, trips are minted clean by Discovery →
  // Choreograph (PD.181 ensures the publish path produces consistent
  // data) and stay clean. Legacy data shapes are no longer supported;
  // users delete and rebuild trips affected by pre-PD.181 bugs.
  // Removed migrations: carRentals → Tracker, waysides geometry
  // reassign, destination coord refresh, notes-surface merge,
  // travelerNotes → research, Want-to-see → sights, pendingActions
  // dedup. Each was layered defense against specific historical
  // shapes; in the clean architecture, no such shapes exist to repair.

  // v359.60.79: per-destination snap-to-settlement pass. For each
  // destination not already refined (no dest._coordsRefined flag),
  // reverse-geocode at its current coords; if Nominatim says we're
  // at a natural feature centroid (lake, peak, park, etc.), snap to
  // the nearest village/town/city found in the address. Runs in the
  // background; updates dest.lat/lng + autoSaves as refinements come
  // (settlement-snap, notes-merge, want-to-see-migrate, pendingActions
  //  dedup all removed in PD.196. New trips have these surfaces minted
  //  in the canonical shape from the start; no fixup needed.)
  g("home-screen").style.display="none";
  g("app").style.display="flex";
  // PD.204 (architectural): no-dest-overlay state is a pure function
  // of trip.destinations.length. HTML defaults the overlay to
  // display:flex (visible) so a fresh trip with no destinations
  // shows the empty-state immediately. Once a trip is loaded with
  // destinations, hide the overlay HERE — before view-specific
  // rendering (drawTripMode, drawDestMode, _restoreLastScreen) so
  // even paths that don't touch the overlay (e.g. picker restore)
  // don't leave the empty-state stranded over a map that has data.
  var _ndOv = document.getElementById("no-dest-overlay");
  if (_ndOv) {
    var _hasDests = Array.isArray(trip.destinations) && trip.destinations.length > 0;
    _ndOv.style.display = _hasDests ? "none" : "flex";
  }
  var tn=g("trip-name-display"); if(tn){
    tn.textContent=trip.name||"Untitled trip";
    tn.title="Click to rename";
    // Rename is already wired via inline onclick="editTripName(this)" on
    // the span itself (HTML line ~1824). The previous ondblclick
    // handler here built a fresh span with much smaller, lighter
    // inline styles (font-size:11px;color:#999) that made the trip
    // name visually disappear after every rename. Removed in favor
    // of the single canonical rename path in editTripName().
  }
  // Wire up map controls
  var closeBtn=document.getElementById('mpp-close-btn');
  if(closeBtn) closeBtn.onclick=closeMapPinPanel;
  var dayBtn=document.getElementById('map-day-btn');
  if(dayBtn) dayBtn.onclick=function(e){e.stopPropagation();toggleDayDropdown();};
  setTimeout(function(){
    // v360.3: isolate initMainMap from drawTripMode. If Leaflet (L)
    // hasn't loaded — CDN blocked, offline, test environment — the
    // map init throws and the rest of the sequence (drawTripMode,
    // updateMainMap, checkDeadlineAlert) doesn't run, leaving the
    // user with chrome but an empty trip body. The trip view is
    // useful without a map; the map can recover later if Leaflet
    // eventually loads.
    try { initMainMap(); }
    catch (e) { console.warn("[Max] initMainMap failed (will retry later):", e && e.message); }
    // Always open in trip list — activeDest is remembered so user can resume
    _leftMode="trip";
    // PD.331: baseline render — noUrlStamp. The URL (read by the
    // _dispatchRoute below) decides the screen; this draw is just
    // the app-shell default underneath. Without the flag, booting
    // at #/trip/<id>/discovery had this call push #/trip/<id> over
    // the deep link before dispatch could honor it.
    try { drawTripMode({noUrlStamp:true}); } catch (e) { console.error("[Max] drawTripMode failed:", e); }
    try { updateMainMap(); } catch (e) { console.warn("[Max] updateMainMap failed:", e && e.message); }
    // PD.330: trip view + map are now in place (the baseline). If the
    // URL points to a deeper screen (Discovery, Brief, Dest), dispatch
    // here to lay the right overlay on top or replace the view. For
    // the trip route, _dispatchRoute's idempotency guards mean this
    // is a no-op (it would redraw drawTripMode, but the URL already
    // matches so it's harmless). For HOME the dispatcher bounces
    // back to the home screen — won't happen here because the URL
    // was normalized at the top of enterApp.
    try {
      if (typeof _dispatchRoute === "function") _dispatchRoute();
    } catch (e) {
      console.warn("[Max] route dispatch failed:", e && e.message);
    }
    // PD.243: deferred apply of the picker's Roads-on checkbox. The
    // checkbox writes _tb._pendingRoadsOn (and a localStorage fallback)
    // instead of mutating _useRoadRouting directly, because the first
    // updateMainMap with _useRoadRouting=true + empty OSRM cache hits a
    // blank-map bug. Apply here AFTER the first clean render by
    // mimicking the trip-view Roads button (set global, persist, call
    // updateMainMap). Cleared once consumed.
    try {
      var _pending = null;
      if (typeof _tb !== "undefined" && _tb && typeof _tb._pendingRoadsOn === "boolean") {
        _pending = _tb._pendingRoadsOn;
      } else {
        try {
          var _lp = localStorage.getItem('max-road-routing-pending');
          if (_lp === '1' || _lp === '0') _pending = (_lp === '1');
        } catch(_){}
      }
      if (_pending !== null && _pending !== _useRoadRouting) {
        _useRoadRouting = _pending;
        try { localStorage.setItem('max-road-routing', _useRoadRouting ? '1' : '0'); } catch(_){}
        // Repaint the trip-view's own Roads button to match.
        var _rb = document.getElementById('map-roads-btn');
        if (_rb) {
          _rb.textContent = _useRoadRouting ? '🛤 Roads on' : '🛤 Roads off';
          _rb.style.background = _useRoadRouting ? '#1a5fa8' : 'rgba(255,255,255,.95)';
          _rb.style.color = _useRoadRouting ? '#fff' : '#1a5fa8';
        }
        if (typeof updateMainMap === "function") updateMainMap();
      }
      if (_tb) delete _tb._pendingRoadsOn;
      try { localStorage.removeItem('max-road-routing-pending'); } catch(_){}
    } catch (e) { console.warn("[Max PD.243] deferred roads-on apply failed:", e && e.message); }
    try { checkDeadlineAlert(); } catch (e) { console.warn("[Max] checkDeadlineAlert failed:", e && e.message); }
    // (PD.196: migration toast removed along with the migrations.)
  },50);
}

// v359.48: trip-view "⋯ More" popover toggle. Lives next to goHome
// because it's a peer header-affordance helper. Click outside the
// menu closes it via a one-shot capture-phase listener attached
// after open (deferred a tick so the opening click doesn't fire it).
function _toggleTripMoreMenu(){
  var menu = document.getElementById('trip-more-menu');
  if (!menu) return;
  var isOpen = menu.style.display === 'block';
  if (isOpen) { _closeTripMoreMenu(); return; }
  menu.style.display = 'block';
  setTimeout(function(){
    document.addEventListener('click', _tripMoreOutsideClick, { once: true, capture: true });
  }, 0);
}
function _closeTripMoreMenu(){
  var menu = document.getElementById('trip-more-menu');
  if (menu) menu.style.display = 'none';
}
function _tripMoreOutsideClick(e){
  var menu = document.getElementById('trip-more-menu');
  var btn = document.getElementById('trip-more-btn');
  if (!menu) return;
  // Clicks INSIDE the menu let the item's own handler run (which
  // closes the menu itself). Clicks on the toggle button are also
  // ignored — the button has its own onclick that toggles. Anything
  // else closes.
  if (menu.contains(e.target) || (btn && btn.contains(e.target))) {
    // Re-arm the outside-click listener for the next outside click.
    document.addEventListener('click', _tripMoreOutsideClick, { once: true, capture: true });
    return;
  }
  _closeTripMoreMenu();
}
