// features-conversation.js — Story narration, Ask-Max chat, and the
// booking-confirmation parser. Extracted verbatim from index.html
// (PD.450, bloat reduction). Pure global function collection (45 fns,
// no boot-time statements), all invoked at runtime by user actions, so
// load order is unconstrained beyond 'before first use'. Loaded after
// apikey.js.

// ── Story functions (real API) ─────────────────────────────
async function sStory(sid, destId) {
  var s = fS(sid, destId); if (!s) return;
  var topic = s.st || s.n; if (!topic) return;
  var btn = g("ssa-" + sid); if (!btn) return;
  if (btn.getAttribute("data-state") !== "idle") return;

  // If story exists but was hidden, just re-show it
  if(_sightStories[sid] && _hiddenStories.has(sid)){
    _hiddenStories.delete(sid);
    var day=fDayOf(sid,destId);
    if(day) drawDestMode(destId); // re-render to show story
    return;
  }

  btn.setAttribute("data-state", "asking"); btn.textContent = "Discovering\u2026";

  var dest = getDest(destId);
  var prompt = "Tell me the story of " + topic + (dest ? " in " + dest.place : "") + ".";

  try {
    var text = await callMax([{role: "user", content: prompt}]);
    _sightStories[sid] = {prompt: prompt, text: text};
    btn.setAttribute("data-state", "done"); btn.textContent = "story \u2713";

    var existing = g("stb-" + sid); if (existing) existing.parentNode.removeChild(existing);
    var box = document.createElement("div"); box.className = "story-box"; box.id = "stb-" + sid;

    var p = document.createElement("div");
    p.style.marginBottom = "8px"; p.style.lineHeight = "1.75";
    p.textContent = text;

    var acts = document.createElement("div"); acts.className = "story-actions";
    var dig = document.createElement("button"); dig.className = "story-btn"; dig.textContent = "Dig deeper \u2197";
    var deepContId = "stb-" + sid + "-deep";
    (function(n, did, storyText, dcid) {
      dig.onclick = function() {
        dig.disabled = true; dig.textContent = "thinking\u2026";
        digDeeper(n, did, prompt, storyText, dcid).then(function(){
          dig.disabled = false; dig.textContent = "Dig deeper \u2197";
        });
      };
    })(s.n, destId, text, deepContId);

    var cls = document.createElement("button"); cls.className = "story-btn cb"; cls.textContent = "Close";
    (function(id, b) {
      cls.onclick = function() {
        var bx = g("stb-" + id); if (bx) bx.parentNode.removeChild(bx);
        b.setAttribute("data-state", "idle"); b.textContent = "story \u2197";
        delete _sightStories[id];
      };
    })(sid, btn);

    acts.appendChild(dig); acts.appendChild(cls);
    box.appendChild(p); box.appendChild(acts);

    var deepDiv = document.createElement("div"); deepDiv.id = deepContId;
    box.appendChild(deepDiv);

    // v353.2: when sStory is called from the map-pin popup, there's
    // no sr-<sid> in the DOM (the suggestion isn't placed on a day),
    // and the button isn't inside .ex-sight/.srow/.exp-item either \u2014
    // it's inside #map-pin-popup. Fall back to inserting the story
    // box inside the popup itself so the user sees it.
    var sr = g("sr-" + sid) || btn.closest(".ex-sight") || btn.closest(".srow") || btn.closest(".exp-item");
    var inPopup = btn.closest("#map-pin-popup");
    if (sr) {
      sr.parentNode.insertBefore(box, sr.nextSibling);
    } else if (inPopup) {
      // Append at the bottom of the popup so the action buttons
      // stay above the story text. Style the box to fit popup width
      // and constrain its height so the story scrolls if long.
      box.style.cssText = (box.style.cssText || "") +
        ";margin-top:10px;max-height:240px;overflow-y:auto;font-size:12px;";
      inPopup.appendChild(box);
    }
  } catch(e) {
    btn.setAttribute("data-state", "idle"); btn.textContent = "story \u2197";
    var errBox=document.createElement("div");
    errBox.style.cssText="font-size:11px;color:#b04020;padding:3px 6px;";
    errBox.textContent="Couldn't reach Max \u2014 try again.";
    var sr2=g("sr-"+sid)||btn.closest(".ex-sight")||btn.closest(".srow")||btn.closest(".exp-item");
    var inPopup2 = btn.closest("#map-pin-popup");
    if (sr2) sr2.parentNode.insertBefore(errBox, sr2.nextSibling);
    else if (inPopup2) inPopup2.appendChild(errBox);
    setTimeout(function(){if(errBox.parentNode)errBox.parentNode.removeChild(errBox);},4000);
    console.error("sStory error:", e);
  }
}

// ─── MAX SAYS — unsolicited observations from a well-traveled friend ───────
// One note per destination per session. Generated on first render, cached.
// Cards should feel like a volunteered observation, not a feature.
function renderMaxNoteCard(dest, container){
  if(!container || !dest) return;
  // Remove any prior card for this dest
  var prior = document.getElementById("max-note-"+dest.id);
  if(prior && prior.parentNode) prior.parentNode.removeChild(prior);

  var card = document.createElement("div");
  card.id = "max-note-"+dest.id;
  card.className = "max-note-card";
  card.style.cssText = "background:#fbfaf6;border:1px solid #e8e4d8;border-radius:8px;padding:11px 13px;margin:10px 0 4px;font-family:Georgia,serif;font-size:12.5px;line-height:1.6;color:#333;position:relative;";

  var header = document.createElement("div");
  header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";
  var label = document.createElement("div");
  label.style.cssText = "font-size:10px;font-weight:700;color:#888;letter-spacing:0.05em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  label.textContent = "Max says\u2026";
  var close = document.createElement("span");
  close.style.cssText = "font-size:14px;color:#bbb;cursor:pointer;line-height:1;padding:2px 4px;font-family:-apple-system,sans-serif;";
  close.innerHTML = "\u00d7";
  close.title = "Hide";
  close.onclick = function(){ card.style.display = "none"; if(_destNotes[dest.id]) _destNotes[dest.id].hidden = true; };
  header.appendChild(label); header.appendChild(close);
  card.appendChild(header);

  var body = document.createElement("div");
  body.id = "max-note-body-"+dest.id;

  var refreshBtn = document.createElement("button");
  refreshBtn.style.cssText = "margin-top:8px;font-size:10px;color:var(--c-ink-3);background:none;border:none;cursor:pointer;padding:2px 0;font-family:inherit;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;";
  refreshBtn.textContent = "another thought \u2197";
  refreshBtn.onclick = function(){ generateMaxNote(dest, true); };

  if(_destNotes[dest.id] && _destNotes[dest.id].text && !_destNotes[dest.id].hidden){
    body.textContent = _destNotes[dest.id].text;
    card.appendChild(body);
    card.appendChild(refreshBtn);
  } else if(_destNotes[dest.id] && _destNotes[dest.id].hidden){
    // User hid it — don't re-render
    return;
  } else {
    body.innerHTML = '<span class="max-thinking">Max is thinking\u2026</span>';
    card.appendChild(body);
    container.appendChild(card);
    generateMaxNote(dest, false);
    return;
  }
  container.appendChild(card);
}

async function generateMaxNote(dest, replace){
  if(!dest) return;
  var bodyEl = document.getElementById("max-note-body-"+dest.id);
  if(replace && bodyEl){
    bodyEl.innerHTML = '<span class="max-thinking">Max is thinking\u2026</span>';
  }

  // Gather context: what stops nearby, itinerary shape, user's sentence, familiarity
  var intent = (trip && trip.brief && trip.brief.intent) ? trip.brief.intent : (_tb.intent||_tb.tripSentence||"");
  var familiarity = (trip && trip.brief && trip.brief.familiarity) || _tb.familiarity || "";
  var nights = dest.nights || "?";
  var sightsNames = (dest.suggestions||[]).slice(0,8).map(function(s){return s.n;}).join(", ");
  var pickedIdx = (trip && trip.destinations) ? trip.destinations.findIndex(function(d){return d.id===dest.id;}) : -1;
  var prev = (pickedIdx>0) ? trip.destinations[pickedIdx-1] : null;
  var next = (pickedIdx>=0 && trip.destinations && pickedIdx<trip.destinations.length-1) ? trip.destinations[pickedIdx+1] : null;

  var prompt = "You are Max, speaking as a well-traveled friend. The traveler is looking at the destination view for " + dest.place + ". Offer ONE short, specific, volunteered observation \u2014 something a well-traveled friend would mention unprompted. Not a recommendation. Not a list. One observation, 1\u20133 sentences, maximum 60 words.\n\n"
    + "Good examples of what to write (style, not content):\n"
    + "\u2022 \"If you're walking from the Altstadt to the station, the route past the Hofkirche is worth the extra five minutes.\"\n"
    + "\u2022 \"The old town closes early on Sundays \u2014 worth saving errands for Monday morning.\"\n"
    + "\u2022 \"The light on the lake is best an hour before sunset, from the east shore.\"\n"
    + "\u2022 \"The short train from here to Bergen is one of the most scenic in the country \u2014 sit on the left heading north.\"\n\n"
    + "Avoid: \"Don't miss X.\" \"Be sure to Y.\" Generic \"foodie heaven\" / \"cultural gem\" language. Explicit recommendations. Lists. Headlines. Temporal words like \"tomorrow\", \"today\", \"this morning\", \"next week\" \u2014 you don't know the schedule, so do not invent one.\n\n"
    + "Context:\n"
    + "\u2022 Destination: " + dest.place + "\n"
    + "\u2022 Staying: " + nights + " nights\n"
    + (intent ? "\u2022 Trip intent: " + intent + "\n" : "")
    + (familiarity === "know" ? "\u2022 Familiarity: traveler knows this region well \u2014 surface what regulars miss\n"
        : familiarity === "before" ? "\u2022 Familiarity: traveler has a passing understanding \u2014 add texture, not basics\n"
        : familiarity === "first" ? "\u2022 Familiarity: first visit \u2014 orient, but with the small useful thing a friend would say\n"
        : "")
    + (sightsNames ? "\u2022 Planned stops include: " + sightsNames + "\n" : "")
    + (prev ? "\u2022 Coming from: " + prev.place + "\n" : "")
    + (next ? "\u2022 Heading to: " + next.place + "\n" : "")
    + (replace ? "\n(The traveler asked for another thought \u2014 give a different observation from your last one.)" : "");

  try {
    var text = await callMax([{role:"user", content: prompt}], 250, 20000);
    text = (text || "").trim();
    // Strip any leading/trailing quotes the model sometimes adds
    text = text.replace(/^["\u201c]+|["\u201d]+$/g, "");
    _destNotes[dest.id] = { text: text, seen: false, createdAt: Date.now() };
    var bodyEl2 = document.getElementById("max-note-body-"+dest.id);
    if(bodyEl2) bodyEl2.textContent = text;
  } catch(e){
    var bodyEl3 = document.getElementById("max-note-body-"+dest.id);
    if(bodyEl3){
      bodyEl3.style.color = "#aaa";
      bodyEl3.textContent = "(Max couldn\u2019t find a note right now.)";
    }
  }
}

async function destStory(dest) {
  if (dest.storyState !== "idle") return;
  // Clear any stale error from a previous failed attempt
  var prevWrap=g("dsw-"+dest.id);
  if(prevWrap){var prevErr=prevWrap.querySelector("div[style*='color:#b04020']");if(prevErr)prevErr.parentNode.removeChild(prevErr);}
  dest.storyState = "asking";
  var btn = g("dsb-" + dest.id); if (!btn) return;
  btn.textContent = "Discovering\u2026"; btn.className = "tlink story-tl asking";

  var prompt = "Tell me the story of " + dest.place + " \u2014 what shaped it into what it is today.";

  try {
    var text = await callMax([{role: "user", content: prompt}]);
    _destStories[dest.id] = {prompt: prompt, text: text};
    dest.storyState = "done";
    btn.textContent = "About " + dest.place + " \u2713"; btn.className = "dm-act-btn tlink story-tl asked";

    var wrap = g("dsw-" + dest.id); if (!wrap) return;
    var box = document.createElement("div"); box.className = "dest-story-box";

    var p = document.createElement("div");
    p.style.marginBottom = "8px"; p.style.lineHeight = "1.8";
    p.textContent = text;

    var acts = document.createElement("div"); acts.className = "story-actions";
    var deepContId = "dsw-" + dest.id + "-deep";
    var dig = document.createElement("button"); dig.className = "story-btn"; dig.textContent = "Dig deeper \u2197";
    (function(pl, did, storyText, dcid) {
      dig.onclick = function() {
        dig.disabled = true; dig.textContent = "thinking\u2026";
        digDeeper(pl, did, prompt, storyText, dcid).then(function(){
          dig.disabled = false; dig.textContent = "Dig deeper \u2197";
        });
      };
    })(dest.place, dest.id, text, deepContId);

    var cls = document.createElement("button"); cls.className = "story-btn cb"; cls.textContent = "Hide";
    (function(d, b, bx) {
      cls.onclick = function() {
        bx.style.display = "none";
        b.textContent = "About " + d.place + " \u2713";
        b.className = "dm-act-btn tlink story-tl asked";
      };
    })(dest, btn, box);

    acts.appendChild(dig); acts.appendChild(cls);
    box.appendChild(p); box.appendChild(acts);

    var deepDiv = document.createElement("div"); deepDiv.id = deepContId;
    box.appendChild(deepDiv);
    wrap.appendChild(box);
  } catch(e) {
    dest.storyState = "idle";
    btn.textContent = "About " + dest.place + " \u2192"; btn.className = "dm-act-btn tlink story-tl";
    var wrap2=g("dsw-"+dest.id);
    if(wrap2){
      var errDiv=document.createElement("div");errDiv.style.cssText="font-size:11px;color:#b04020;padding:4px 0;";
      errDiv.textContent="Couldn't reach Max \u2014 try again.";
      wrap2.appendChild(errDiv);
      setTimeout(function(){if(errDiv.parentNode)errDiv.parentNode.removeChild(errDiv);},5000);
    }
    console.error("destStory error:", e);
  }
}

async function digDeeper(name, destId, originalPrompt, storyText, containerId) {
  var container = g(containerId); if (!container) return;
  container.innerHTML = "<div class='ff-thinking'>Max is thinking\u2026</div>";

  var messages = [
    {role: "user", content: originalPrompt},
    {role: "assistant", content: storyText},
    {role: "user", content: "Tell me more \u2014 go further into the history or cultural significance."}
  ];

  try {
    var text = await callMax(messages);
    container.innerHTML = "";
    var deeper = document.createElement("div");
    deeper.className = "story-box"; deeper.style.marginTop = "8px";
    deeper.textContent = text;
    container.appendChild(deeper);
  } catch(e) {
    container.innerHTML = "<div class='ff-err'>Couldn't reach Max. Try again.</div>";
    console.error("digDeeper error:", e);
  }
}

// ── Ask Max (conversational, with context) ─────────────────
async function doFF(destId) {
  var inp = g("ff-" + destId);
  var v = inp.value.trim(); if (v.length < 2) return;
  var dest = getDest(destId); if (!dest) return;

  var ffb = g("ffb-" + destId);
  if (ffb) { ffb.disabled = true; ffb.textContent = "thinking\u2026"; ffb.className = "taddBtn"; }
  inp.value = "";

  if (!_ffHistories[destId]) _ffHistories[destId] = [];
  var history = _ffHistories[destId];

  // Build user message — prefix context on first message
  var userMsg = v;
  if (history.length === 0) {
    var ctx = "Context for this conversation: trip to " + dest.place
      + ", " + fmtD(dest.dateFrom) + "\u2013" + fmtD(dest.dateTo);
    var sightNames = [];
    dest.days.forEach(function(d) { (d.items||d.sights||[]).filter(function(s){return s.type==="sight";}).forEach(function(s) { sightNames.push(s.n); }); });
    if (sightNames.length) ctx += ". Current itinerary: " + sightNames.join(", ") + ".";
    userMsg = ctx + "\n\nQuestion: " + v;
  }
  history.push({role: "user", content: userMsg});

  var wrap = g("ff-wrap-" + destId);

  // Show question
  var qDiv = document.createElement("div"); qDiv.className = "ff-q";
  qDiv.textContent = v;
  wrap.appendChild(qDiv);

  // Show thinking
  var aDiv = document.createElement("div"); aDiv.className = "ff-a";
  aDiv.style.color = "#aaa"; aDiv.textContent = "thinking\u2026";
  wrap.appendChild(aDiv);
  aDiv.scrollIntoView({behavior: "smooth", block: "nearest"});

  try {
    var text = await callMax(history);
    history.push({role: "assistant", content: text});
    aDiv.style.color = "";
    aDiv.textContent = text;
  } catch(e) {
    history.pop();
    aDiv.className = "ff-err";
    aDiv.textContent = "Couldn't reach Max. Try again.";
    console.error("doFF error:", e);
  }

  if (ffb) { ffb.disabled = false; ffb.textContent = "Ask \u2197"; }
}

function closeMovPanel(){
  if(movingId){var p=g("mp-"+movingId);if(p&&p.parentNode)p.parentNode.removeChild(p);movingId=null;}
}

function togMov(sid,dayId,destId,event,isEvening){
  var existing=document.getElementById("mp-"+sid);
  if(existing){existing.parentNode.removeChild(existing);movingId=null;return;}
  closeMovPanel(); movingId=sid;
  var dest=getDest(destId);if(!dest)return;

  var popup=document.createElement("div"); popup.id="mp-"+sid;
  popup.style.cssText="position:fixed;z-index:9999;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.18);padding:6px 0;min-width:160px;";

  var phdr=document.createElement("div"); phdr.style.cssText="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#bbb;padding:4px 14px 5px;border-bottom:1px solid var(--c-border-4);margin-bottom:3px;";
  phdr.textContent="Move"; popup.appendChild(phdr);

  // Slot toggle
  [{slot:"day",lbl:"Day"},{slot:"evening",lbl:"Evening"}].forEach(function(sl){
    var opt=document.createElement("div");
    var cur=(sl.slot==="evening")===!!isEvening;
    opt.style.cssText="padding:5px 14px 5px 20px;font-size:11px;color:"+(cur?"#bbb":"#555")+";cursor:"+(cur?"default":"pointer")+";";
    opt.textContent=(cur?"• ":"")+sl.lbl+(cur?" (current)":"");
    if(!cur){opt.onmouseover=function(){opt.style.background="#f5f5f5";};opt.onmouseout=function(){opt.style.background="";};
      (function(ns){opt.onclick=function(e){e.stopPropagation();var item=fS(sid,destId);if(item)item.slot=ns;popup.parentNode&&popup.parentNode.removeChild(popup);movingId=null;_emitTripMutation();};})(sl.slot);}
    popup.appendChild(opt);
  });

  // Day separator
  var s1=document.createElement("div");s1.style.cssText="height:1px;background:var(--c-panel-3);margin:3px 0 2px;";popup.appendChild(s1);
  var ds=document.createElement("div");ds.style.cssText="font-size:9px;color:#bbb;padding:2px 14px 3px;letter-spacing:.05em;text-transform:uppercase;";ds.textContent="Day";popup.appendChild(ds);

  dest.days.forEach(function(day){
    var opt=document.createElement("div");
    var isCur=day.id===dayId;
    opt.style.cssText="padding:5px 14px 5px 20px;font-size:11px;color:"+(isCur?"#bbb":"#333")+";cursor:"+(isCur?"default":"pointer")+";display:flex;align-items:center;justify-content:space-between;";
    var lbl=document.createElement("span");lbl.textContent=day.lbl;opt.appendChild(lbl);
    if(isCur){var cc=document.createElement("span");cc.style.cssText="font-size:9px;color:#ccc;";cc.textContent="current";opt.appendChild(cc);}
    else{opt.onmouseover=function(){opt.style.background="#f5f5f5";};opt.onmouseout=function(){opt.style.background="";};
      (function(tid){opt.onclick=function(e){e.stopPropagation();moveSight(sid,dayId,tid,destId);popup.parentNode&&popup.parentNode.removeChild(popup);movingId=null;};})(day.id);}
    popup.appendChild(opt);
  });

  var s2=document.createElement("div");s2.style.cssText="height:1px;background:var(--c-panel-3);margin:3px 0;";popup.appendChild(s2);
  [{key:"later",lbl:"\u2192 Later"},{key:"maybe",lbl:"\u2192 Maybe"}].forEach(function(bucket){
    var opt=document.createElement("div");
    opt.style.cssText="padding:6px 14px;font-size:11px;color:var(--c-ink-3);cursor:pointer;";
    opt.textContent=bucket.lbl;
    opt.onmouseover=function(){opt.style.background="#f5f5f5";};opt.onmouseout=function(){opt.style.background="";};
    (function(bk){opt.onclick=function(e){
      e.stopPropagation();var sight=null;
      dest.days.forEach(function(d){var _im=d.items||d.sights||[];for(var i=_im.length-1;i>=0;i--){if(_im[i].id===sid){sight=_im.splice(i,1)[0];}}});
      if(sight){if(!dest[bk+"Items"])dest[bk+"Items"]=[];dest[bk+"Items"].push({id:sight.id,type:sight.type||"sight",n:sight.n,p:sight.p,done:sight.done,st:sight.st,note:null});}
      popup.parentNode&&popup.parentNode.removeChild(popup);movingId=null;_emitTripMutation();
    };})(bucket.key);
    popup.appendChild(opt);
  });

  // Position at click
  var cx=event.clientX, cy=event.clientY;
  document.body.appendChild(popup);
  var pw=popup.offsetWidth||140, ph=popup.offsetHeight||160;
  popup.style.left=Math.min(cx,window.innerWidth-pw-8)+"px";
  popup.style.top=Math.min(cy+6,window.innerHeight-ph-8)+"px";

  // Dismiss on outside click — next event cycle
  setTimeout(function(){
    function dismiss(e){
      if(!popup.contains(e.target)){popup.parentNode&&popup.parentNode.removeChild(popup);movingId=null;document.removeEventListener("click",dismiss,true);}
    }
    document.addEventListener("click",dismiss,true);
  },0);
}

function moveSight(sid,fromId,toId,destId){
  closeMovPanel();
  var dest=getDest(destId);if(!dest)return;
  var sight=null;
  for(var i=0;i<dest.days.length;i++) if(dest.days[i].id===fromId){var _ms=dest.days[i].items||dest.days[i].sights||[];for(var j=0;j<_ms.length;j++) if(_ms[j].id===sid){sight=_ms.splice(j,1)[0];break;}break;}
  if(!sight)return;
  for(var k=0;k<dest.days.length;k++) if(dest.days[k].id===toId){if(!dest.days[k].items)dest.days[k].items=[];dest.days[k].items.push(sight);break;}
  _emitTripMutation();
}

function migrateDest(dest){
  if(!dest.suggestions)dest.suggestions=[];
  if(!dest.restaurantSuggestions)dest.restaurantSuggestions=[];
  if(!dest.laterItems){dest.laterItems=dest.discoveredItems||[];}
  if(!dest.maybeItems){dest.maybeItems=[];}
  // Clean up orphaned dest.locations entries — essentials now live on dest.suggestions.
  // Retain arrival/departure/sight-must/sight-nice/stay as other code paths may still use them.
  if(dest.locations&&dest.locations.length){
    var stale=["atm","grocery","tourist-info","transit","pharmacy"];
    dest.locations=dest.locations.filter(function(l){return stale.indexOf(l.type)===-1;});
  }
  // Wipe stale pendingCancellations saved before wording was standardised
  if(dest.pendingCancellations&&dest.pendingCancellations.items){
    var hasOldWording=dest.pendingCancellations.items.some(function(it){
      return it.detail&&(it.detail.indexOf('Contact hotel')>-1||it.detail.indexOf('Contact provider to adjust dates')>-1||it.keepInApp===true);
    });
    if(hasOldWording) dest.pendingCancellations=null;
  }
  if(!dest.discoveredItems)dest.discoveredItems=[];
  // Migrate day.sights[] → day.items[] for existing trips
  if(dest.days){
    dest.days.forEach(function(day){
      if(day.sights&&!day.items){
        // Move pre-existing sights into suggestions pool instead of deleting
        day.sights.forEach(function(s){
          var alreadyIn=dest.suggestions.some(function(sg){return sg.n===s.n;});
          if(!alreadyIn){
            sidCtr++;
            var mc=getCityCenter(dest.place);
            dest.suggestions.push({id:"s"+sidCtr,type:"sight",n:s.n,st:s.st||s.n,note:null,
              // v355.10: tightened scatter — see generateCityData for the why.
              lat:mc?mc[0]+(Math.random()-.5)*.003:null,
              lng:mc?mc[1]+(Math.random()-.5)*.004:null,approx:true});
          }
        });
        day.items=[];
        delete day.sights;
      }
      if(!day.items)day.items=[];
    });
  }
  // Populate suggestions if empty or all null-coord
  var allNullCoords=dest.suggestions.length>0&&dest.suggestions.every(function(s){return !s.lat;});
  if(dest.suggestions.length===0||allNullCoords){
    var genKey=dest.place.toLowerCase();
    if(!_generatedCityData[genKey]){
      generateCityData(dest.place,dest.id);
    }
  }
}

function showUndoToast(label,onUndo,customMsg){
  var existing=document.getElementById("undo-toast-el");
  if(existing)existing.parentNode.removeChild(existing);
  if(_undoTimer)clearTimeout(_undoTimer);
  var toast=document.createElement("div"); toast.className="undo-toast"; toast.id="undo-toast-el";
  var msg=document.createElement("span");
  // v353: customMsg lets callers say e.g. "Sent X to Later" instead of
  // the default "Deleted X". The label is interpolated in either case.
  msg.textContent = customMsg
    ? customMsg.replace(/\{label\}/g, "\u201c"+label+"\u201d")
    : ("Deleted \u201c"+label+"\u201d");
  var btn=document.createElement("button"); btn.className="undo-btn"; btn.textContent="Undo";
  btn.onclick=function(){
    clearTimeout(_undoTimer);
    toast.parentNode&&toast.parentNode.removeChild(toast);
    onUndo();
  };
  toast.appendChild(msg); toast.appendChild(btn); document.body.appendChild(toast);
  _undoTimer=setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},5000);
}

// v353: \u2715 on a sight no longer hard-deletes \u2014 it sends the sight to
// dest.laterItems (the unscheduled-but-still-on-the-list pool) so the
// data isn't lost. The undo toast splices it back into its original
// day at the same index. The full sight object is preserved (booking,
// times, notes, priority) so a later move-back-to-day or a click on
// the Later list restores everything. delS (true hard delete) stays
// available for any caller that wants it; nothing else calls it on
// the live render path right now.
function removeSightToLater(sid,dayId,destId){
  closeMovPanel();
  var dest=getDest(destId); if(!dest) return;
  var sight=null, idx=-1, srcDayItems=null;
  for(var i=0;i<dest.days.length;i++){
    if(dest.days[i].id!==dayId) continue;
    var _di=dest.days[i].items||dest.days[i].sights||[];
    for(var j=0;j<_di.length;j++){
      if(_di[j].id===sid){ sight=_di[j]; idx=j; srcDayItems=_di; break; }
    }
    if(sight){ srcDayItems.splice(idx,1); break; }
  }
  if(!sight) return;
  if(!dest.laterItems) dest.laterItems=[];
  dest.laterItems.push(sight);
  var label=sight.n;
  var el=g("sr-"+sid); if(el) el.parentNode.removeChild(el);
  var stb=g("stb-"+sid); if(stb) stb.parentNode.removeChild(stb);
  autoSave();
  showUndoToast(label,function(){
    // Restore: pop from laterItems, splice back into the day at the
    // original index. If the user has done other edits in between
    // (e.g., shuffled items on the same day), the index is still our
    // best guess \u2014 clamped to a valid position.
    var d=getDest(destId); if(!d) return;
    if(d.laterItems){
      for(var k=d.laterItems.length-1;k>=0;k--){
        if(d.laterItems[k]===sight){ d.laterItems.splice(k,1); break; }
      }
    }
    for(var m=0;m<d.days.length;m++){
      if(d.days[m].id===dayId){
        if(!d.days[m].items) d.days[m].items=[];
        var insertAt=Math.min(idx, d.days[m].items.length);
        d.days[m].items.splice(insertAt,0,sight);
        break;
      }
    }
    _emitTripMutation();
  },"Sent {label} to Later");
}

function delS(sid,dayId,destId){
  closeMovPanel();
  var dest=getDest(destId);if(!dest)return;
  var sight=null, idx=-1;
  for(var i=0;i<dest.days.length;i++) if(dest.days[i].id===dayId){
    var _di=dest.days[i].items||dest.days[i].sights||[];
    for(var j=0;j<_di.length;j++) if(_di[j].id===sid){sight=_di[j];idx=j;break;}
    if(sight){_di.splice(idx,1);break;}
  }
  if(!sight)return;
  var label=sight.n;
  var el=g("sr-"+sid);if(el)el.parentNode.removeChild(el);
  var stb=g("stb-"+sid);if(stb)stb.parentNode.removeChild(stb);
  delete _sightStories[sid];
  autoSave();
  showUndoToast(label,function(){
    var d=getDest(destId);if(!d)return;
    for(var k=0;k<d.days.length;k++) if(d.days[k].id===dayId){
      (d.days[k].items||d.days[k].sights||[]).splice(idx,0,sight);break;
    }
    _emitTripMutation();
  });
}
function onAI(dayId){
  var inp=g("ai-"+dayId); if(!inp)return;
  g("ab-"+dayId).className=inp.value.trim().length>=2?"addsb on":"addsb";
}
function doAI(dayId,destId,type,slot){
  var slotKey=slot||"day";
  var typeKey=type||"sight";
  var inpId=slot?"ai-"+slotKey+"-"+dayId:"ai-"+dayId;
  var inp=g(inpId); if(!inp)return;
  var v=inp.value.trim(); if(v.length<2)return;
  // Round HJ.B: title-case the typed name so user-typed lowercase
  // reads consistently with LLM-supplied sight names.
  if (typeof _titleCaseCity === "function") v = _titleCaseCity(v);
  sidCtr++;
  var ns={id:"s"+sidCtr,type:typeKey,slot:slotKey,n:v,p:"nice",done:false,st:v,note:null,time:""};
  var dest=getDest(destId);if(!dest)return;
  for(var i=0;i<dest.days.length;i++) if(dest.days[i].id===dayId){if(!dest.days[i].items)dest.days[i].items=[];dest.days[i].items.push(ns);break;}
  inp.value="";
  // Round HJ.B: emit through the bus instead of direct drawXxx +
  // autoSave. Then fire async geocode + smart-detect: if the place
  // ends up >15km from the destination, surface a toast asking
  // whether it should be a day-trip instead. The user's report:
  // "I added Blue Lagoon as a sight and Max put it someplace in the
  // city" — without coords, _mainMap pins fell back to the city
  // center. With async geocode + the day-trip prompt, the user gets
  // told the truth (50km away) and offered the right placement.
  _emitTripMutation();
  if (typeKey === "sight" && typeof ensureCoarseGeocode === "function") {
    ensureCoarseGeocode(v, function(coords){
      if (!coords || !Array.isArray(coords) || coords.length !== 2) return;
      // Defensive: confirm the sight is still on the day (user may
      // have removed it before geocode came back).
      var stillThere = false;
      var freshDest = getDest(destId);
      if (freshDest && Array.isArray(freshDest.days)) {
        for (var di = 0; di < freshDest.days.length; di++) {
          if (freshDest.days[di].id !== dayId) continue;
          var items = freshDest.days[di].items || [];
          for (var ii = 0; ii < items.length; ii++) {
            if (items[ii] === ns) { stillThere = true; break; }
          }
          break;
        }
      }
      if (!stillThere) return;
      // Fill the sight's coords so _mainMap pins land in the right
      // place even if the user keeps it as a sight.
      ns.lat = coords[0];
      ns.lng = coords[1];
      // Compute distance from the destination.
      var distKm = null;
      if (typeof freshDest.lat === "number" && typeof freshDest.lng === "number"
          && typeof _fqHaversineKm === "function") {
        distKm = Math.round(_fqHaversineKm(freshDest.lat, freshDest.lng, coords[0], coords[1]));
      }
      // Always update the sight's note with the distance so the user
      // sees how far it is, regardless of whether they convert.
      if (distKm !== null) {
        ns.note = _fmtDistance(distKm) + " from " + freshDest.place;
      }
      autoSave();
      if (typeof MaxEngineTrip !== "undefined" && typeof MaxEngineTrip.emit === "function") {
        MaxEngineTrip.emit("mapDataChange");
      }
      // 15 km threshold: anything beyond is day-trip territory, not a
      // city-internal sight. Surface a non-blocking toast asking the
      // user whether this should be a day-trip. The "Convert" path
      // removes the sight + creates a chip on dest.dayTrips +
      // immediately places it on the same day (so the user's
      // intent — "put this on day N" — is preserved).
      if (distKm !== null && distKm > 15) {
        _showDayTripConversionToast(freshDest, ns, dayId, distKm);
      }
    });
  }
}

// Round HJ.B: toast prompt offering to convert a sight to a day-trip
// when the geocode reveals it's too far for a city-internal sight.
// Buttons: "Make it a day trip" (calls addDayTripPlace + addDayTripToDay)
// or "Keep as sight" (dismisses; the distance note already updated
// the sight's metadata).
function _showDayTripConversionToast(dest, sightItem, dayId, distKm){
  // Reuse the existing day-trip toast styling pattern.
  var existing = document.getElementById("dt-convert-toast");
  if (existing) existing.remove();
  var toast = document.createElement("div");
  toast.id = "dt-convert-toast";
  toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--c-bg);border:1px solid #d8c4e8;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:14px 16px;font-size:12px;line-height:1.5;color:#333;max-width:420px;z-index:9999;font-family:inherit;";
  toast.innerHTML = '<div style="margin-bottom:10px;"><strong>' + sightItem.n + '</strong> is ' + _fmtDistance(distKm) + ' from ' + dest.place + ' — that\'s usually day-trip distance.</div>';
  var btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
  var convertBtn = document.createElement("button");
  convertBtn.textContent = "Make it a day trip";
  convertBtn.style.cssText = "background:var(--c-accent);color:var(--c-on-dark);border:none;padding:6px 12px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;";
  var keepBtn = document.createElement("button");
  keepBtn.textContent = "Keep as sight";
  keepBtn.style.cssText = "background:var(--c-bg);color:#666;border:1px solid var(--c-border-strong);padding:6px 12px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;";
  convertBtn.onclick = function(){
    // Remove the sight from its day.
    var freshDest = getDest(dest.id);
    if (freshDest && Array.isArray(freshDest.days)) {
      for (var di = 0; di < freshDest.days.length; di++) {
        var day = freshDest.days[di];
        if (day.id !== dayId) continue;
        day.items = (day.items || []).filter(function(it){ return it !== sightItem; });
        break;
      }
    }
    // Create a day-trip chip with the same name. addDayTripPlace
    // handles dedupe + geocode + emit. Coords are already in
    // _coarseGeocode now, so the chip lands with distKm set.
    if (typeof addDayTripPlace === "function") {
      addDayTripPlace(freshDest, sightItem.n);
    }
    // Place it on the same day the user originally chose.
    if (typeof addDayTripToDay === "function") {
      var dtIdx = -1;
      var chips = (freshDest && freshDest.dayTrips) || [];
      for (var ci = 0; ci < chips.length; ci++) {
        if (chips[ci] && chips[ci].place && chips[ci].place.toLowerCase() === sightItem.n.toLowerCase()) {
          dtIdx = ci; break;
        }
      }
      var dayIdx = -1;
      for (var dii = 0; dii < (freshDest.days || []).length; dii++) {
        if (freshDest.days[dii].id === dayId) { dayIdx = dii; break; }
      }
      if (dtIdx >= 0 && dayIdx >= 0) addDayTripToDay(freshDest, dtIdx, dayIdx);
    }
    toast.remove();
  };
  keepBtn.onclick = function(){ toast.remove(); };
  btnRow.appendChild(keepBtn);
  btnRow.appendChild(convertBtn);
  toast.appendChild(btnRow);
  document.body.appendChild(toast);
  // Auto-dismiss after 20s if the user ignores it.
  setTimeout(function(){ if (toast.parentNode) toast.remove(); }, 20000);
}

function collectDeadlines(dest){
  // Gather all bookings with cancelType='deadline' from this destination
  var list=[];
  var dName=dest.label||dest.place;
  // Hotel bookings
  (dest.hotelBookings||[]).forEach(function(b){
    if(b.cancelDeadline&&b.status==='booked')
      list.push({deadline:b.cancelDeadline,deadlineTime:b.cancelDeadlineTime||null,name:b.name,type:'Hotel',destName:dName,destId:dest.id,id:b.id});
  });
  // General bookings
  (dest.generalBookings||[]).forEach(function(b){
    if(b.cancelDeadline&&b.status==='booked')
      list.push({deadline:b.cancelDeadline,deadlineTime:b.cancelDeadlineTime||null,name:b.label||b.type,type:'Activity',destName:dName,destId:dest.id,id:b.id});
  });
  // Transport legs involving this destination
  Object.keys(trip.legs||{}).forEach(function(k){
    var parts=k.split('-');
    if(parts.length===2&&(parts[0]===dest.id||parts[1]===dest.id)){
      (trip.legs[k].bookings||[]).forEach(function(b){
        if(b.cancelDeadline&&b.status==='booked'){
          var label=b.operator||'Transport';
          list.push({deadline:b.cancelDeadline,deadlineTime:b.cancelDeadlineTime||null,name:label,type:'Transport',destName:dName,destId:dest.id,fromId:parts[0],toId:parts[1],id:b.id});
        }
      });
    }
  });
  // Sort by deadline date
  list.sort(function(a,b){return a.deadline<b.deadline?-1:a.deadline>b.deadline?1:0;});
  return list;
}

function collectAllDeadlines(){
  var all=[];
  (trip.destinations||[]).forEach(function(d){all=all.concat(collectDeadlines(d));});
  all.sort(function(a,b){return a.deadline<b.deadline?-1:a.deadline>b.deadline?1:0;});
  return all;
}

function checkDeadlineAlert(){
  var all=collectAllDeadlines();
  var today=new Date(); today.setHours(0,0,0,0);
  var tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1);
  var tomorrowStr=tomorrow.toISOString().slice(0,10);
  var urgent=all.filter(function(d){return d.deadline===tomorrowStr;});
  var alert=document.getElementById('deadline-alert');
  if(!alert) return;
  if(urgent.length>0){
    alert.innerHTML='\u26a0\ufe0f <strong>Cancellation deadline tomorrow:</strong> '+
      urgent.map(function(d){return d.name+' ('+d.destName+')';}).join(', ')+
      ' \u2014 <span style="text-decoration:underline;cursor:pointer;" onclick="setLeftMode(\'dest\');_activeDmSection=\'tracker\';">view in Tracker</span>';
    alert.style.display='flex';
  } else {
    alert.style.display='none';
  }
}

// ── Booking confirmation parser (v353.6, task #118) ───────
//
// Two-step flow:
//   1. User pastes raw confirmation text (email body, web confirmation
//      page, etc.) into a textarea.
//   2. Max calls the LLM with a strict JSON-extraction prompt, returns
//      a structured booking object.
//   3. Preview modal shows the extracted fields in editable inputs
//      (varies by detected type) so the user can correct anything the
//      LLM got wrong before saving.
//   4. Save routes the result to the right per-dest collection:
//        hotel                    → dest.hotelBookings
//        restaurant/tour/ticket   → dest.generalBookings
//        flight/train/bus/ferry   → leg.bookings, choosing arrival
//                                   leg (prevDest→thisDest) or
//                                   departure leg (thisDest→nextDest)
//                                   based on user's radio selection
//                                   (defaulted via date proximity)
//
// Confidence handling: if the LLM returns type:"unknown" or no fields
// at all, we surface "couldn't extract anything — try a clearer paste"
// and keep the textarea visible so the user can edit and retry.

// Trip-level entry point. The user clicks 📋 Paste from the trip
// header — they don't need to be in any particular destination's
// tracker tab. We pass the first destination as a placeholder; the
// preview modal's destination dropdown + verification logic then
// auto-routes to whichever destination actually matches the booking
// (by address + dates).
// ─── In-app AI chat (v353.7, task #151) ───────────────────────
//
// "💬 Ask" button in the trip-view header opens this modal. Anyone
// signed in with a trip loaded can have a conversation with an AI
// about the trip. Phase 1 ships with Claude wired (via the existing
// callMax proxy); GPT and Gemini are placeholders until their API
// keys are added as Cloudflare Worker secrets in phases 2 and 3.
//
// Conversation persists per-trip on the server (via MaxSync
// pull/push), so the chat follows the user across devices.
//
// Context model: the system prompt auto-includes whatever
// destination the user is currently viewing (current dest + dates
// when in dest mode; trip overview otherwise) so the AI can answer
// "where's a good breakfast spot?" without the user having to
// re-explain where they are.

var _askModalState = {
  messages: [],         // [{role, content, model, ts}]
  loading: false,       // request in flight?
  model: "claude",      // "claude" | "openai" | "gemini" — only claude is wired in Phase 1
  tripId: null,
};

// v353.7: chat-key onboarding modal. Shown when the user clicks
// 💬 Ask without an API key on file, or when they explicitly choose
// to swap their key. Walks them through getting an Anthropic key
// from console.anthropic.com (which is a separate signup from the
// claude.ai consumer chat product) and gives them a paste field to
// stash the result locally.
//
// opts.mode: "intro" (first time, with rationale) | "edit" (already
//   have one, just want to swap)
// opts.onSaved: callback fired after the user pastes a valid key
//   and clicks Save — used by showAskMaxModal to proceed straight
//   into the chat after onboarding.
function showAskMaxKeyModal(opts) {
  opts = opts || {};
  var mode = opts.mode || (_apiKey ? "edit" : "intro");
  var existing = document.getElementById("askmax-key-overlay");
  if (existing) existing.remove();

  var ov = document.createElement("div");
  ov.id = "askmax-key-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11950;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:560px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:24px 26px;box-shadow:0 12px 40px rgba(0,0,0,.25);";

  var introBlock = mode === "intro"
    ? '<div style="font-size:13px;color:#444;line-height:1.6;margin-bottom:16px;">' +
        '<p style="margin:0 0 10px;"><strong>Max\'s chat needs your own Anthropic API key.</strong></p>' +
        '<p style="margin:0 0 10px;">Everything else in Max — picker suggestions, candidate cities, calendar export — runs on a shared budget. Chat is open-ended, so we ask you to bring your own key for that one feature. Your key stays in your browser only and is never sent to Max\'s servers.</p>' +
        '<div style="background:#eef5fb;border:1px solid var(--c-border-blue);border-radius:6px;padding:12px 14px;margin:12px 0;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Why use Claude inside Max instead of in a separate tab?</div>' +
          '<div style="font-size:12.5px;color:#333;line-height:1.6;">' +
            'You can absolutely keep using <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);">claude.ai</a> (or ChatGPT, or any other AI) on its own. Using it <em>inside Max</em> just adds three things:' +
            '<ol style="margin:6px 0 0;padding-left:20px;">' +
              '<li><b>It already knows your trip.</b> Your destinations, dates, lodging, what\'s planned per day, the weather forecast — all auto-loaded into the conversation. No re-explaining "I\'m going to Iceland May 10–13, three nights in Reykjavik then…" every single time.</li>' +
              '<li><b>The conversation stays with the trip.</b> Open it tomorrow, next week, on your phone — the same thread is right where you left it. Generic chat windows lose this.</li>' +
              '<li><b>It\'s right next to the plan.</b> Ask "what\'s typical service charge in Iceland?" or "anything good for breakfast near where I\'m staying in Reykjavik?", get an answer, edit your day — no tab-switching or copy-pasting context back and forth.</li>' +
            '</ol>' +
          '</div>' +
        '</div>' +
        '<p style="margin:0;"><b>Important:</b> claude.ai (the consumer chat) is a separate product from the Anthropic API. Your claude.ai login does NOT give you API access. You need to create a key from the API console (free signup, pay-as-you-go for actual usage — typical chat costs cents per session).</p>' +
      '</div>'
    : '<div style="font-size:13px;color:#444;line-height:1.55;margin-bottom:16px;">' +
        'Replace your current Anthropic API key. The new key is stored locally in this browser only.' +
      '</div>';

  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#1a5fa8,#2a7a4e);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">🔑</div>' +
      '<div style="font-size:15px;font-weight:700;">' + (mode === "edit" ? "Update your chat API key" : "Set up Max chat") + '</div>' +
    '</div>' +
    introBlock +
    (mode === "intro"
      ? '<div style="background:#f7f9fc;border:1px solid #e2e7ee;border-radius:7px;padding:14px 16px;margin-bottom:16px;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">How to get a key (2 minutes)</div>' +
          '<ol style="margin:0;padding-left:20px;font-size:12.5px;color:#333;line-height:1.7;">' +
            '<li>Open <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);font-weight:600;">console.anthropic.com</a> and sign up (or sign in if you already have a developer account — different from claude.ai).</li>' +
            '<li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);font-weight:600;">Settings → API Keys</a>.</li>' +
            '<li>Click <b>Create Key</b>. Name it something like "Max chat". Copy the long <code style="background:var(--c-bg);padding:1px 5px;border-radius:3px;border:1px solid var(--c-border);font-size:11px;">sk-ant-…</code> string immediately — you can\'t view it again.</li>' +
            '<li>You may need to add a payment method on the <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" style="color:var(--c-primary);font-weight:600;">Billing tab</a> for the key to work. Anthropic gives you free credits to start.</li>' +
            '<li>Paste the key below.</li>' +
          '</ol>' +
        '</div>'
      : '') +
    '<label style="display:block;font-size:11px;font-weight:700;color:#444;margin-bottom:6px;">Anthropic API key</label>' +
    '<input id="askmax-key-input" type="password" placeholder="sk-ant-…" value="' + (_apiKey || "").replace(/"/g, "&quot;") + '" style="width:100%;font-size:12px;padding:9px 11px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:monospace;box-sizing:border-box;margin-bottom:10px;" />' +
    '<div id="askmax-key-msg" style="font-size:11px;color:var(--c-ink-3);min-height:14px;margin-bottom:12px;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button id="askmax-key-cancel" style="padding:9px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '<button id="askmax-key-save" style="padding:9px 18px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Save & continue →</button>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  var keyInput = document.getElementById("askmax-key-input");
  var msg = document.getElementById("askmax-key-msg");
  var saveBtn = document.getElementById("askmax-key-save");
  var cancelBtn = document.getElementById("askmax-key-cancel");

  cancelBtn.onclick = function(){ ov.remove(); };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  saveBtn.onclick = function(){
    var v = (keyInput.value || "").trim();
    if (!v) { msg.textContent = "Paste your key first."; msg.style.color = "#c44"; return; }
    // F1 (parallel-state dedup): validate via the SINGLE PD.445 gate
    // (_isWellFormedApiKey) and persist through the SINGLE write door
    // (saveApiKey, which sets the shared global _apiKey). This modal used to be
    // a THIRD api-key writer with only a loose ^sk-ant- prefix check — the exact
    // weaker-invariant bypass PD.445 closed (a malformed-but-prefixed key, e.g.
    // one with a trailing token, would get stored here, then fail on read).
    var ok = (typeof _isWellFormedApiKey === "function") ? _isWellFormedApiKey(v) : /^sk-ant-/.test(v);
    if (!ok) {
      msg.textContent = "That doesn't look like a valid key — it should be a single sk-ant-… token with no spaces or extra text.";
      msg.style.color = "#c44";
      return;
    }
    if (typeof saveApiKey === "function") { saveApiKey(v); }
    else { try { localStorage.setItem("max-api-key", v); } catch (_) {} _apiKey = v; }
    ov.remove();
    if (typeof opts.onSaved === "function") opts.onSaved();
  };

  // Make sure the modal opens scrolled to the top. Reset all
  // possible scroll containers (overlay, box, document) and re-reset
  // in the next frame in case layout reflow shifts something.
  function _scrollAllToTop() {
    ov.scrollTop = 0;
    box.scrollTop = 0;
    if (document && document.documentElement) document.documentElement.scrollTop = 0;
  }
  _scrollAllToTop();
  requestAnimationFrame(_scrollAllToTop);
  setTimeout(_scrollAllToTop, 100);

  // Auto-focus is intentionally skipped in intro mode. The modal
  // has reading material at the top (rationale + value-prop) that
  // must be visible on open; auto-focusing the input would scroll-
  // into-view past the explanation. In edit mode the modal is short
  // and the input IS the main UI, so we focus there.
  if (mode === "edit") {
    setTimeout(function(){
      try { keyInput.focus({ preventScroll: true }); }
      catch (_) { keyInput.focus(); }
      if (keyInput.value) {
        try { keyInput.select(); } catch (_) {}
      }
    }, 50);
  }
}
// Expose so the sync-modal "change" link can call it.
window.showAskMaxKeyModal = showAskMaxKeyModal;

function showAskMaxModal() {
  // v359.4: Ask works in the picker too. Was gated on a published
  // trip; now falls back to _tb (trip-being-built) — region, brief,
  // picks. Neal's call: "When you select ask in the picker view, it
  // tells you to open a trip first." The picker IS planning; Ask
  // should be useful for "what else should I consider", "how should
  // I order these", "how many days in each place" before publishing.
  var _hasTrip = !!(_currentTripId && trip);
  var _hasPicker = (typeof _tb !== "undefined" && _tb && (_tb.region || _tb.placeName || _tb.brief
                    || (Array.isArray(_tb.placeActivities) && _tb.placeActivities.length)));
  if (!_hasTrip && !_hasPicker) {
    maxAlert("Open a trip or start research first.");
    return;
  }
  if (typeof MaxSync === "undefined" || !MaxSync.isSignedIn || !MaxSync.isSignedIn()) {
    maxAlert("Sign in first — chat history syncs across devices via the server.");
    return;
  }
  // v353.7: chat-only BYOK gate. Without an API key on file we
  // can't run the chat, so route the user through the onboarding
  // modal first, then proceed once they've pasted a key.
  if (!_apiKey) {
    showAskMaxKeyModal({
      mode: "intro",
      onSaved: function(){ showAskMaxModal(); },
    });
    return;
  }
  var existing = document.getElementById("ask-max-overlay");
  if (existing) existing.remove();

  // v359.4: in picker mode we don't have a trip id, so the server
  // conversation pull/push is skipped — chat is in-memory only for
  // the planning session. Once the trip is published, future chats
  // get a real per-trip conversation.
  _askModalState.tripId = _currentTripId || null;
  _askModalState.pickerMode = !_hasTrip && _hasPicker;

  var ov = document.createElement("div");
  ov.id = "ask-max-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:680px;max-width:100%;height:calc(100vh - 48px);max-height:760px;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25);";
  box.innerHTML =
    // Header — title + model picker + close.
    '<div style="padding:14px 18px;border-bottom:1px solid var(--c-border-3);display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#1a5fa8,#2a7a4e);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">💬</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:14px;font-weight:700;color:#222;">Ask about this trip</div>' +
        '<div id="askmax-context-line" style="font-size:11px;color:var(--c-ink-3);line-height:1.3;"></div>' +
      '</div>' +
      '<select id="askmax-model" style="font-size:11.5px;font-weight:600;padding:5px 8px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;background:var(--c-bg);cursor:pointer;">' +
        '<option value="claude" selected>Claude (Anthropic)</option>' +
        '<option value="openai" disabled>GPT-4 (set OPENAI_API_KEY) — coming soon</option>' +
        '<option value="gemini" disabled>Gemini (set GEMINI_API_KEY) — coming soon</option>' +
      '</select>' +
      '<button id="askmax-close" style="margin-left:6px;padding:6px 10px;font-size:11.5px;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Close</button>' +
    '</div>' +
    // Conversation pane.
    '<div id="askmax-pane" style="flex:1;overflow-y:auto;padding:16px 18px;background:var(--c-panel);display:flex;flex-direction:column;gap:10px;"></div>' +
    // Input row.
    '<div style="padding:12px 18px;border-top:1px solid var(--c-border-3);flex-shrink:0;background:var(--c-bg);">' +
      '<div style="display:flex;gap:8px;align-items:flex-end;">' +
        '<textarea id="askmax-input" placeholder="Ask anything about this trip — weather, places to eat, logistics, what to pack…" style="flex:1;font-size:13px;padding:9px 11px;border:1px solid var(--c-border-strong);border-radius:6px;font-family:-apple-system,sans-serif;resize:none;min-height:40px;max-height:140px;line-height:1.4;box-sizing:border-box;"></textarea>' +
        '<button id="askmax-send" style="padding:9px 16px;font-size:12.5px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:6px;cursor:pointer;font-family:inherit;flex-shrink:0;height:40px;">Send</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:10px;flex-wrap:wrap;">' +
        '<div style="font-size:10px;color:#999;">Cmd/Ctrl+Enter to send · Shift+Enter for newline · <span id="askmax-keystate"></span></div>' +
        '<button id="askmax-clear" style="font-size:10.5px;background:none;color:var(--c-ink-3);border:none;cursor:pointer;font-family:inherit;text-decoration:underline;">Clear conversation</button>' +
      '</div>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  // Wire close + clear.
  document.getElementById("askmax-close").onclick = function(){ ov.remove(); };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  // Compute the context line shown under the title — what the AI
  // is "looking at" when the user asks a question.
  var ctxLine = document.getElementById("askmax-context-line");
  var ctxDest = (typeof activeDest !== "undefined" && activeDest && _leftMode === "dest") ? getDest(activeDest) : null;
  if (ctxDest) {
    ctxLine.textContent = "Context: " + (ctxDest.place || ctxDest.label || "current destination")
      + (ctxDest.dateFrom ? " (" + ctxDest.dateFrom + " → " + (ctxDest.dateTo || ctxDest.dateFrom) + ")" : "");
  } else if (_hasTrip) {
    ctxLine.textContent = "Context: " + (trip.name || "this trip")
      + (trip.destinations ? " — " + trip.destinations.length + " destinations" : "");
  } else {
    // v359.4: picker-mode context.
    var _region = (_tb && _tb.region) || (_tb && _tb.placeName) || "your trip";
    var _picksCount = 0;
    (_tb && _tb.placeActivities || []).forEach(function(it){
      (it.requiredPlaces || []).forEach(function(p){ if (p && p._keep) _picksCount++; });
    });
    ctxLine.textContent = "Context: Planning " + _region + (_picksCount ? " — " + _picksCount + " picks so far" : " — picking places");
  }

  // Pull existing conversation from server. While loading, show a
  // ghost placeholder; on success render the messages.
  var pane = document.getElementById("askmax-pane");
  // v359.4: in picker mode there's no trip id to pull from. Start
  // with an empty in-memory conversation; once the trip is published
  // a per-trip conversation will exist on the server.
  if (_askModalState.pickerMode || !_currentTripId) {
    _askModalState.messages = [];
    _renderAskMaxPane();
  } else {
    pane.innerHTML = '<div style="font-size:11px;color:#999;text-align:center;padding:20px;">Loading conversation…</div>';
    MaxSync.pullConversation(_currentTripId).then(function(resp){
      _askModalState.messages = (resp && resp.messages) || [];
      _renderAskMaxPane();
    }).catch(function(e){
      console.warn("[askmax] pull failed:", e);
      _askModalState.messages = [];
      _renderAskMaxPane();
    });
  }

  var input = document.getElementById("askmax-input");
  var sendBtn = document.getElementById("askmax-send");
  var clearBtn = document.getElementById("askmax-clear");

  sendBtn.onclick = function(){ _askMaxSend(); };
  input.onkeydown = function(e){
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      _askMaxSend();
    }
  };
  clearBtn.onclick = function(){
    if (!confirm("Clear this conversation? You'll start fresh next time.")) return;
    MaxSync.clearConversation(_currentTripId).then(function(){
      _askModalState.messages = [];
      _renderAskMaxPane();
    }).catch(function(e){
      maxAlert("Couldn't clear: " + (e && e.message || "unknown"));
    });
  };

  // Footer: chat is always running on the user's own Anthropic key
  // (chat-only BYOK model, v353.7). Surface a small link to swap
  // the key in case the user wants to rotate or replace.
  var keystateEl = document.getElementById("askmax-keystate");
  if (keystateEl) {
    keystateEl.innerHTML = 'Powered by <a href="#" id="askmax-keystate-link" style="color:var(--c-primary);text-decoration:none;font-weight:600;">your Anthropic key ↗</a>';
    var link = document.getElementById("askmax-keystate-link");
    if (link) {
      link.onclick = function(e){
        e.preventDefault();
        showAskMaxKeyModal({ mode: "edit" });
      };
    }
  }

  setTimeout(function(){ input.focus(); }, 100);
}

function _renderAskMaxPane() {
  var pane = document.getElementById("askmax-pane");
  if (!pane) return;
  var msgs = _askModalState.messages || [];
  if (!msgs.length && !_askModalState.loading) {
    pane.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--c-ink-3);">' +
      '<div style="font-size:30px;margin-bottom:10px;">💬</div>' +
      '<div style="font-size:13px;font-weight:600;color:#444;margin-bottom:6px;">Ask anything about this trip</div>' +
      '<div style="font-size:11.5px;line-height:1.5;max-width:380px;margin:0 auto;">Try: "What\'s a good breakfast spot near my Reykjavik hotel?" · "Will I be cold in May?" · "Translate \'where\'s the bathroom\' to Icelandic" · "What should I pack for the trip?"</div>' +
    '</div>';
    return;
  }
  pane.innerHTML = "";
  msgs.forEach(function(m){
    var row = document.createElement("div");
    var isUser = m.role === "user";
    row.style.cssText = "max-width:84%;align-self:" + (isUser ? "flex-end" : "flex-start") + ";";
    var bubble = document.createElement("div");
    bubble.style.cssText = "padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;" +
      (isUser
        ? "background:#1a5fa8;color:#fff;border-bottom-right-radius:4px;"
        : "background:#fff;color:#222;border:1px solid #e2e6ea;border-bottom-left-radius:4px;");
    bubble.textContent = m.content || "";
    row.appendChild(bubble);
    var meta = document.createElement("div");
    meta.style.cssText = "font-size:9.5px;color:var(--c-ink-4);margin-top:3px;text-align:" + (isUser ? "right" : "left") + ";";
    var when = m.ts ? new Date(m.ts).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}) : "";
    meta.textContent = (isUser ? "you" : (m.model || "assistant")) + (when ? " · " + when : "");
    row.appendChild(meta);
    pane.appendChild(row);
  });
  if (_askModalState.loading) {
    var thinking = document.createElement("div");
    thinking.style.cssText = "max-width:84%;align-self:flex-start;";
    thinking.innerHTML = '<div style="padding:9px 13px;border-radius:14px;font-size:13px;background:var(--c-bg);border:1px solid #e2e6ea;color:var(--c-ink-3);border-bottom-left-radius:4px;">Thinking…</div>';
    pane.appendChild(thinking);
  }
  pane.scrollTop = pane.scrollHeight;
}

async function _askMaxSend() {
  var input = document.getElementById("askmax-input");
  var sendBtn = document.getElementById("askmax-send");
  if (!input || _askModalState.loading) return;
  var text = (input.value || "").trim();
  if (!text) return;

  // Append user message + render immediately.
  var now = Date.now();
  _askModalState.messages.push({ role: "user", content: text, ts: now });
  input.value = "";
  _askModalState.loading = true;
  sendBtn.disabled = true; sendBtn.textContent = "…";
  _renderAskMaxPane();

  try {
    var system = _buildAskMaxSystemPrompt();
    // Build the messages array for the LLM. Drop the leading
    // "ts/model" metadata fields — the API only cares about role +
    // content. Trim to the last 30 messages to keep token counts
    // bounded; older context is implicit in the trip JSON.
    var apiMessages = _askModalState.messages
      .slice(-30)
      .map(function(m){ return { role: m.role, content: m.content }; });
    var resp = await callMax(apiMessages, 1500, 30000, { system: system, noCache: true, useOwnKey: true });
    var reply = String(resp || "").trim();
    if (!reply) reply = "(no response)";
    _askModalState.messages.push({ role: "assistant", content: reply, model: "claude-sonnet-4", ts: Date.now() });
  } catch (e) {
    console.warn("[askmax] send failed:", e);
    _askModalState.messages.push({
      role: "assistant",
      content: "Sorry — that didn't go through. " + (e && e.message ? "(" + e.message + ")" : "") + " Try again, or check your connection.",
      model: "error",
      ts: Date.now(),
    });
  } finally {
    _askModalState.loading = false;
    sendBtn.disabled = false; sendBtn.textContent = "Send";
    _renderAskMaxPane();
  }

  // Persist after every send. Fire-and-forget; if it fails the
  // local state still has the messages (next pull will reconcile).
  // v359.4: skip persistence in picker mode (no trip id yet — the
  // session is in-memory until the trip is published).
  if (_askModalState.tripId) {
    try {
      await MaxSync.pushConversation(_askModalState.tripId, _askModalState.messages);
    } catch (e) {
      console.warn("[askmax] push failed:", e);
    }
  }
}

function _buildAskMaxSystemPrompt() {
  // The system prompt establishes the AI's role + auto-prepends
  // current trip context. Per the user's pref (#151 scoping), we
  // include the CURRENT DESTINATION + dates if the user is viewing
  // a destination, otherwise the trip overview.
  var ctxBlock = "";
  var ctxDest = (typeof activeDest !== "undefined" && activeDest && _leftMode === "dest") ? getDest(activeDest) : null;
  if (ctxDest) {
    var dest = ctxDest;
    var bits = [];
    bits.push("CURRENT DESTINATION: " + (dest.place || dest.label || "Untitled"));
    if (dest.dateFrom && dest.dateTo) bits.push("Dates: " + dest.dateFrom + " to " + dest.dateTo + " (" + (dest.nights || "") + " nights)");
    if (dest.lodging || dest.lodgingNotes) bits.push("Lodging: " + (dest.lodging || dest.lodgingNotes));
    if (dest.label && dest.label !== dest.place) bits.push("Label: " + dest.label);
    var planned = [];
    (dest.days || []).forEach(function(d){
      (d.items || []).forEach(function(it){ if (it && it.n) planned.push(it.n); });
    });
    if (planned.length) bits.push("Planned: " + planned.slice(0, 20).join(", ") + (planned.length > 20 ? "…" : ""));
    if (trip && trip.name) bits.push("Part of trip: " + trip.name);
    ctxBlock = bits.join("\n");
  } else if (trip) {
    var tBits = [];
    tBits.push("TRIP: " + (trip.name || "Untitled"));
    if (trip.destinations && trip.destinations.length) {
      var d0 = trip.destinations[0], dN = trip.destinations[trip.destinations.length - 1];
      if (d0.dateFrom && dN.dateTo) tBits.push("Overall dates: " + d0.dateFrom + " to " + dN.dateTo);
      // Per-destination breakdown — place, dates, lodging if any. This
      // is what enables questions like "what's a good breakfast near
      // my hotel?" at the trip level: Claude can see lodging exists
      // for each leg and either pick the right one by today's date
      // (mid-trip) or ask which leg.
      tBits.push("Destinations (in order):");
      trip.destinations.forEach(function(d, i){
        var line = "  " + (i + 1) + ". " + (d.place || d.label || "?");
        if (d.dateFrom && d.dateTo) line += " · " + d.dateFrom + "–" + d.dateTo;
        if (d.lodging || d.lodgingNotes) line += " · stay: " + (d.lodging || d.lodgingNotes);
        tBits.push(line);
      });
    }
    if (trip.brief && trip.brief.brief) tBits.push("Brief: " + String(trip.brief.brief).slice(0, 400));
    ctxBlock = tBits.join("\n");
  } else if (typeof _tb !== "undefined" && _tb && (_tb.region || _tb.placeName || _tb.brief)) {
    // v359.4: picker-mode context. No published trip exists yet; the
    // user is in the activity-picker shaping what the trip will be.
    // Hand the model the brief + region + kept-picks so it can answer
    // "what should I add?", "how should I order these?", etc.
    var pBits = [];
    pBits.push("PLANNING (no trip published yet — user is in the picker)");
    if (_tb.region) pBits.push("Region: " + _tb.region);
    if (_tb.placeName && _tb.placeName !== _tb.region) pBits.push("Focus: " + _tb.placeName);
    if (_tb.startDate || _tb.endDate) pBits.push("Dates: " + (_tb.startDate || "?") + " → " + (_tb.endDate || "?"));
    if (_tb.entry) pBits.push("Entry (arrival): " + _tb.entry);
    if (_tb.tbExit) pBits.push("Exit (departure): " + _tb.tbExit);
    if (_tb.brief) pBits.push("Brief: " + String(_tb.brief).slice(0, 600));
    var _keptPlaces = [];
    (_tb.placeActivities || []).forEach(function(it){
      (it.requiredPlaces || []).forEach(function(p){
        if (p && p._keep && p.place && _keptPlaces.indexOf(p.place) < 0) _keptPlaces.push(p.place);
      });
    });
    if (_keptPlaces.length) pBits.push("Kept picks (" + _keptPlaces.length + "): " + _keptPlaces.join(", "));
    ctxBlock = pBits.join("\n");
  }
  return "You are a knowledgeable, friendly travel assistant embedded inside the user's trip-planning app (Max). " +
    "The user is planning or actively on a trip. Help them with anything trip-related: places to eat, things to see, " +
    "logistics, packing, weather, language tips, cultural context, opening hours, transit options. Be specific and " +
    "concrete — name actual places, give real walking distances, mention real opening hours when you know them. " +
    "When you don't know something specific (current opening hours, pricing, availability), say so and suggest where to verify. " +
    "Keep responses focused and skim-able — short paragraphs, lists when relevant. Don't invent facts.\n\n" +
    "Here is what the user is currently looking at:\n\n" + ctxBlock;
}

function showGlobalPasteConfirmationModal() {
  if (!trip || !trip.destinations || !trip.destinations.length) {
    maxAlert("Add a destination to this trip first.");
    return;
  }
  showPasteConfirmationModal(trip.destinations[0].id);
}

// v359.60.35: batch booking import. Paste multiple booking
// confirmations + cancellations (one big text dump from booking.com
// emails OR a CSV/structured export); Max splits, parses, routes
// each one to the right destination, and applies cancellations by
// removing matching existing bookings. Single LLM call returns a
// JSON array; CSV is parsed deterministically (no LLM).
function showBatchImportBookingsModal() {
  if (!trip || !trip.destinations || !trip.destinations.length) {
    maxAlert("Add a destination to this trip first.");
    return;
  }
  var existing = document.getElementById("batch-import-overlay");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "batch-import-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:720px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);";
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--c-primary);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">📥</div>' +
      '<div style="font-size:14px;font-weight:700;">Import bookings (batch)</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:10px;">' +
      'Paste multiple booking confirmations and cancellations in one go. Email dumps, CSV exports, anything booking-shaped works. ' +
      'Max splits them, routes each to the right destination, and (for cancellations) removes any existing booking on the trip that matches.' +
    '</div>' +
    '<textarea id="bim-input" placeholder="Paste your bookings here…" style="width:100%;min-height:220px;padding:10px 12px;border:1px solid var(--c-border-strong);border-radius:6px;font-family:-apple-system,sans-serif;font-size:12px;line-height:1.5;box-sizing:border-box;resize:vertical;"></textarea>' +
    '<div id="bim-status" style="font-size:11px;color:var(--c-ink-3);min-height:14px;margin:6px 0 10px;"></div>' +
    '<div id="bim-preview" style="display:none;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
      '<button id="bim-cancel" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '<button id="bim-parse" style="padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Parse →</button>' +
      '<button id="bim-save" style="display:none;padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Save all</button>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  var inputEl    = document.getElementById("bim-input");
  var statusEl   = document.getElementById("bim-status");
  var previewEl  = document.getElementById("bim-preview");
  var parseBtn   = document.getElementById("bim-parse");
  var saveBtn    = document.getElementById("bim-save");
  var cancelBtn  = document.getElementById("bim-cancel");
  inputEl.focus();

  // v353.7: stash text/html alongside text/plain on paste so the URL
  // extractor (which runs per-booking after the LLM extract) can see
  // hrefs that don't survive plain-text copy.
  var _pastedHtml = null;
  inputEl.addEventListener("paste", function(e){
    if (e.clipboardData) {
      try {
        var h = e.clipboardData.getData("text/html");
        if (h && h.trim()) _pastedHtml = h;
      } catch(_){}
    }
  });

  cancelBtn.onclick = function(){ ov.remove(); };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  // Parsed bookings live here between Parse → and Save all. The
  // preview UI mutates this array (user edits, destination overrides,
  // skip toggles); Save iterates it and commits.
  var _bookings = [];

  parseBtn.onclick = async function(){
    var text = (inputEl.value || "").trim();
    if (!text) { statusEl.textContent = "Paste something first."; statusEl.style.color = "#c44"; return; }
    parseBtn.disabled = true; cancelBtn.disabled = true;
    parseBtn.textContent = "Parsing…";
    statusEl.textContent = "Splitting and extracting…";
    statusEl.style.color = "#888";
    try {
      _bookings = await _parseBookingBatch(text, _pastedHtml);
      if (!_bookings.length) {
        statusEl.textContent = "No bookings found in that paste.";
        statusEl.style.color = "#c44";
        parseBtn.disabled = false; cancelBtn.disabled = false;
        parseBtn.textContent = "Parse →";
        return;
      }
      statusEl.textContent = "Parsed " + _bookings.length + " booking" + (_bookings.length !== 1 ? "s" : "") + ". Review and Save all.";
      statusEl.style.color = "#2a7a4e";
      inputEl.style.display = "none";
      parseBtn.style.display = "none";
      saveBtn.style.display = "inline-block";
      cancelBtn.disabled = false;
      _renderBatchPreview(previewEl, _bookings);
    } catch (err) {
      console.error("[bim] parse failed:", err);
      statusEl.textContent = "Couldn't parse: " + (err && err.message ? err.message : "unknown error");
      statusEl.style.color = "#c44";
      parseBtn.disabled = false; cancelBtn.disabled = false;
      parseBtn.textContent = "Parse →";
    }
  };

  saveBtn.onclick = function(){
    var result = _commitBatchBookings(_bookings);
    ov.remove();
    if (typeof showSaveStatus === "function") {
      var bits = [];
      if (result.added)     bits.push("✓ Added " + result.added + " booking" + (result.added !== 1 ? "s" : ""));
      if (result.updated)   bits.push(result.updated + " filled in"); // v359.60.37: merged into existing bookings
      if (result.cancelled) bits.push(result.cancelled + " cancellation" + (result.cancelled !== 1 ? "s" : "") + " applied");
      if (result.skipped)   bits.push(result.skipped + " skipped");
      showSaveStatus(bits.join(" · "), 4200);
    }
    if (typeof autoSave === "function") try { autoSave(); } catch(_){}
    if (typeof drawTripMode === "function") drawTripMode();
  };
}
if (typeof globalThis !== "undefined") globalThis.showBatchImportBookingsModal = showBatchImportBookingsModal;

// v359.60.35: heuristic + LLM-driven splitter for a batch of bookings.
// Detects CSV/TSV by header (first non-blank line with ≥3 comma- or
// tab-separated fields including a recognizable header token like
// "booking", "confirmation", "check-in", "type", "date"); if it looks
// CSV-like, parse deterministically. Otherwise hand the whole blob to
// one LLM call asking for an array of bookings with an isCancellation
// flag. Returns array of normalized bookings ready for commit.
async function _parseBookingBatch(text, html) {
  // CSV detection.
  var lines = text.split(/\r?\n/);
  var firstNonBlank = "";
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { firstNonBlank = lines[i].trim(); break; }
  }
  var commaCount = (firstNonBlank.match(/,/g) || []).length;
  var tabCount = (firstNonBlank.match(/\t/g) || []).length;
  var looksHeader = /\b(booking|confirmation|check.?in|check.?out|hotel|status|cancelled|reservation|type|currency|price|amount|nights|guest)\b/i.test(firstNonBlank);
  if ((commaCount >= 3 || tabCount >= 3) && looksHeader) {
    return _parseBookingCsv(text);
  }
  // Free-text path → one LLM call.
  return await _parseBookingBatchLlm(text, html);
}
if (typeof globalThis !== "undefined") globalThis._parseBookingBatch = _parseBookingBatch;

// v359.60.35: LLM batch extract. Same schema as the single-booking
// parser (_parseBookingConfirmation), wrapped in an array, plus an
// isCancellation boolean per item. Single call covers the whole
// paste — booking.com's typical batch is small enough that this
// fits well within the 8k token budget below.
async function _parseBookingBatchLlm(text, html) {
  var system =
    "You extract MULTIPLE booking details from a raw text dump (concatenated booking confirmation emails, " +
    "a copy/paste from an inbox, or a structured account summary). Return ONLY a JSON ARRAY — no prose, no markdown.\n\n" +
    "Each array element has the SAME schema as a single confirmation, plus an isCancellation flag:\n" +
    "{\n" +
    '  "isCancellation": boolean,        // true if this entry is a CANCELLATION notice for an existing booking, false for a new booking\n' +
    '  "type": "flight"|"hotel"|"car"|"train"|"bus"|"ferry"|"restaurant"|"tour"|"ticket"|"unknown",\n' +
    '  "carrier": string|null,           // airline / train operator / rental company (Hertz, Sixt, Avis, …)\n' +
    '  "number": string|null,\n' +
    '  "name": string|null,              // hotel/restaurant/tour name (or carrier name for transport)\n' +
    '  "address": string|null,\n' +
    '  "from": string|null,              // transport: departure city/code · car rental: pickup location\n' +
    '  "to": string|null,                // transport: arrival city/code · car rental: dropoff location (omit/repeat from if same)\n' +
    '  "depDate": "YYYY-MM-DD"|null,     // hotel check-in / transport departure / car pickup / restaurant event date\n' +
    '  "depTime": "HH:MM"|null,          // 24h\n' +
    '  "arrDate": "YYYY-MM-DD"|null,     // hotel check-out / transport arrival / car dropoff\n' +
    '  "arrTime": "HH:MM"|null,\n' +
    '  "confirmationNumber": string|null,\n' +
    '  "price": number|null,\n' +
    '  "currency": string|null,\n' +
    '  "url": string|null,\n' +
    '  "cancelType": "deadline"|"non-cancellable"|null,\n' +
    '  "cancelDeadline": "YYYY-MM-DD"|null,\n' +
    '  "notes": string|null\n' +
    "}\n\n" +
    "Splitting:\n" +
    "- The paste may contain SEVERAL distinct confirmations / cancellations concatenated. Treat each one as a separate array element.\n" +
    "- Look for boundaries like 'Booking confirmation', 'Reservation details', 'Cancellation confirmation', 'Your booking at X has been cancelled', a new email's From/Subject line, repeated company logos, or large blocks of whitespace between sections.\n" +
    "- A cancellation usually echoes the original booking (hotel name, dates, confirmation number) — capture those fields so we can match it against an existing booking on the trip. Set isCancellation: true.\n" +
    "- If the entire paste turns out to be a single booking, return an array with one element. Never return prose explaining that.\n\n" +
    "ALSO HANDLE: 'subject line dumps' — when the user has copied a list of email subject lines from an inbox view (no email bodies, just titles glued together). Each subject is a separate booking. Recognize these patterns:\n" +
    "  • 'Thanks! Your booking is confirmed at HOTEL' → hotel confirmation, name=HOTEL, isCancellation=false\n" +
    "  • 'Your booking is confirmed at HOTEL' → same\n" +
    "  • 'Your updated booking at HOTEL' → hotel confirmation (an update), name=HOTEL, isCancellation=false\n" +
    "  • 'Booking canceled for HOTEL' / 'Booking cancelled for HOTEL' → hotel cancellation, name=HOTEL, isCancellation=true\n" +
    "  • 'Reservation Confirmation #NUMBER for HOTEL' → hotel confirmation with confirmationNumber=NUMBER\n" +
    "  • 'RE: Reservation for HOTEL, MONTH DAY-DAY' → hotel confirmation with depDate / arrDate inferred from the date range\n" +
    "  • 'Confirmed: Your MONTH DAY-DAY trip, here's your Airbnb receipt' → Airbnb hotel confirmation, name='Airbnb', dates inferred (use the SAME dates to dedupe against a sibling 'RE: Reservation for...' subject if present — they're the same booking)\n" +
    "  • 'Airbnb Reservation Canceled' → Airbnb cancellation, name='Airbnb', isCancellation=true; if you can't tell which property it cancels, leave name as 'Airbnb' and the user will match it manually\n" +
    "  • 'Booking.com: Confirmation' as a standalone phrase → it's the sender label; not a booking by itself. Skip it. The next subject usually carries the actual booking info.\n" +
    "When the subjects are run together with no whitespace separator (icons / boilerplate glued them inline), SPLIT on each of those patterns. Even a 50-word concatenated blob can become 5–10 distinct bookings.\n" +
    "From subjects you'll usually only have: name, isCancellation, sometimes dates, sometimes a confirmation #. Leave all other fields null — don't guess prices or URLs from a subject line.\n" +
    "Dedupe within a subject dump: if two subjects clearly point to the same booking (e.g. an Airbnb 'RE: Reservation for X, Sep 17-19' AND a 'Confirmed: Your September 17-19 trip' that share the same dates), return ONE entry, preferring the one with the property name.\n\n" +
    "Car rental recognition: 'Your reservation with HERTZ', 'Sixt rental confirmation', 'Enterprise booking #', 'Blue Car Rental — your car is ready' → type='car', carrier=rental company. depDate/depTime = pickup; arrDate/arrTime = return. from = pickup location (often an airport code like KEF or 'Keflavík Airport'); to = return location (set equal to 'from' if same — most rentals are round-trip). One-way rentals (pickup KEF, return AKU) keep from/to distinct. Vehicle class (compact, SUV, 4×4) goes in notes, not as a separate field.\n\n" +
    "Same field rules as single-booking extraction: 24-hour time; time-ranges for check-in collapse to the earliest, check-out to the latest; price is what was paid (not the cancellation cost / no-show fee); URL: extract the actual https:// link, not the visible label; cancellation deadline is the LAST date the user can cancel for free (date only, no time).\n\n" +
    "Return [] only if there's truly no booking-shaped content. A subject-line dump with even one recognizable hotel/confirmation/cancellation pattern is NOT empty — return the array.";
  var user = "BATCH TEXT:\n\n" + text + "\n\nReturn the JSON array.";
  var resp = await callMax([{role:"user", content: user}], 8000, 90000);
  var clean = String(resp || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  // Find the first [ ... last ] in case there's preamble.
  var firstBracket = clean.indexOf("[");
  var lastBracket  = clean.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    clean = clean.slice(firstBracket, lastBracket + 1);
  }
  var raw;
  try {
    raw = JSON.parse(clean);
  } catch(e) {
    console.warn("[bim] JSON parse failed:", clean.slice(0, 400));
    throw new Error("LLM returned malformed JSON — try a smaller batch or use the single-booking Paste instead.");
  }
  if (!Array.isArray(raw)) raw = [raw];
  // Normalize each entry through the existing single-booking
  // normalizer so downstream commit code sees the same shape. Then
  // run the URL fallback regex per item against the same combined
  // text+html (this is best-effort — we don't know which substring
  // belongs to which booking, but the regex scores by relevance so
  // the right URL usually wins for at least the most prominent item).
  var combined = (text || "") + (html ? "\n\n" + html : "");
  return raw.map(function(item, idx){
    var n = (typeof _normalizeBookingExtraction === "function") ? _normalizeBookingExtraction(item) : item;
    if (!n.url && typeof _extractBookingUrl === "function") {
      try { var u = _extractBookingUrl(combined); if (u) n.url = u; } catch(_){}
    }
    n.isCancellation = !!item.isCancellation;
    n._batchIdx = idx;
    return n;
  });
}
if (typeof globalThis !== "undefined") globalThis._parseBookingBatchLlm = _parseBookingBatchLlm;

// v359.60.35: deterministic CSV parser for booking.com / other
// structured exports. First non-blank line = header; we map common
// column names (case-insensitive, fuzzy) to our internal schema.
// No LLM call. Cancellations are detected via a "status" / "state"
// column containing "cancel" (case-insensitive).
function _parseBookingCsv(text) {
  var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
  if (!lines.length) return [];
  var sep = (lines[0].indexOf("\t") >= 0) ? "\t" : ",";
  // Naive CSV split — handles unquoted commas; quoted fields with
  // embedded commas need a real parser. Booking.com's export is
  // unquoted for the common columns, so this is good enough as a
  // first cut. Quote-aware parsing is a follow-up if needed.
  function _splitLine(line) {
    return line.split(sep).map(function(s){ return s.replace(/^"|"$/g, "").trim(); });
  }
  var header = _splitLine(lines[0]).map(function(h){ return h.toLowerCase(); });
  function _col(row, names) {
    for (var i = 0; i < names.length; i++) {
      var idx = header.findIndex(function(h){ return h.indexOf(names[i]) >= 0; });
      if (idx >= 0 && row[idx] != null && row[idx] !== "") return row[idx];
    }
    return null;
  }
  function _parseDate(s) {
    if (!s) return null;
    var iso = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  var out = [];
  for (var li = 1; li < lines.length; li++) {
    var row = _splitLine(lines[li]);
    if (!row.length || row.every(function(c){ return !c; })) continue;
    var status = (_col(row, ["status", "state"]) || "").toLowerCase();
    var isCancel = /cancel/.test(status);
    var typeRaw = (_col(row, ["type", "category"]) || "").toLowerCase();
    var type = typeRaw && /flight|hotel|train|bus|ferry|restaurant|tour|ticket/.test(typeRaw)
      ? typeRaw.match(/flight|hotel|train|bus|ferry|restaurant|tour|ticket/)[0]
      : "hotel"; // booking.com exports are typically hotels
    var priceStr = _col(row, ["total", "price", "amount", "cost"]);
    var price = null;
    if (priceStr) {
      var n = parseFloat(String(priceStr).replace(/[^0-9.]/g, ""));
      if (isFinite(n)) price = n;
    }
    out.push({
      isCancellation: isCancel,
      type: type,
      carrier: null,
      number: null,
      name: _col(row, ["hotel", "property", "name", "carrier"]),
      address: _col(row, ["address", "location", "city"]),
      from: _col(row, ["from", "departure", "origin"]),
      to: _col(row, ["to", "arrival", "destination"]),
      depDate: _parseDate(_col(row, ["check-in", "checkin", "from date", "depart", "start date", "date"])),
      depTime: null,
      arrDate: _parseDate(_col(row, ["check-out", "checkout", "to date", "arriv", "end date"])),
      arrTime: null,
      confirmationNumber: _col(row, ["confirmation", "booking number", "reservation"]),
      price: price,
      currency: _col(row, ["currency"]),
      url: _col(row, ["url", "link", "manage"]),
      cancelType: null,
      cancelDeadline: _parseDate(_col(row, ["cancel by", "cancellation deadline", "free cancel"])),
      notes: _col(row, ["notes", "room", "guests"]),
      _batchIdx: out.length
    });
  }
  return out;
}
if (typeof globalThis !== "undefined") globalThis._parseBookingCsv = _parseBookingCsv;

// v359.60.35: preview row builder. One row per parsed booking with:
// - Type icon + name + dates
// - Destination dropdown (pre-routed via _scoreDestMatch — same logic
//   the single-booking parser uses)
// - For cancellations: an indicator showing what existing booking
//   will be removed (or "no match found — will be logged but no-op")
// - Skip toggle (set _skip=true to exclude from commit)
function _renderBatchPreview(container, bookings) {
  if (!container) return;
  container.style.display = "block";
  container.innerHTML = "";

  var allDests = trip.destinations.slice();
  bookings.forEach(function(b, i) {
    var row = document.createElement("div");
    row.style.cssText = "border:1px solid #e0e0e0;border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px;line-height:1.5;background:" + (b.isCancellation ? "#fff7e6" : "#fff") + ";";

    var icon = ({
      flight: "✈", hotel: "🏨", train: "🚆", bus: "🚌", ferry: "⛴",
      restaurant: "🍽", tour: "🎟", ticket: "🎫", unknown: "📌"
    })[b.type] || "📌";
    var titleBits = [];
    titleBits.push(icon);
    titleBits.push("<strong>" + _bimEsc(b.name || b.carrier || "(unnamed)") + "</strong>");
    if (b.depDate) {
      titleBits.push('<span style="color:var(--c-ink-3);">' + _bimEsc(b.depDate) + (b.arrDate && b.arrDate !== b.depDate ? " → " + _bimEsc(b.arrDate) : "") + '</span>');
    }
    if (b.isCancellation) {
      titleBits.push('<span style="background:#f0c060;color:#5a3a0a;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase;">cancel</span>');
    }

    // v359.60.39: score destinations + auto-route. If the standard
    // scorer (token match + date overlap) returns 0 for every
    // destination, fall through to date-proximity — the destination
    // whose stay window is closest in time to the booking's check-in.
    // Previously the no-match fallback was dest[0], which dumped
    // every unmatched booking on the first destination of the trip
    // (Reykjavík for Iceland trips). Now Middalskot Cottages at
    // Sep 20-22 lands at the destination whose dates are closest
    // to Sep 20, not necessarily dest[0].
    var bestDestId = null;
    if (!b.isCancellation && typeof _scoreDestMatch === "function") {
      var scores = allDests.map(function(d){ return { id: d.id, score: _scoreDestMatch(b, d) }; });
      scores.sort(function(a, c){ return c.score - a.score; });
      if (scores.length && scores[0].score > 0) {
        bestDestId = scores[0].id;
      } else if (scores.length && typeof _proximityDestScore === "function") {
        // All zero — pick by date proximity instead.
        var withProx = allDests.map(function(d){ return { id: d.id, prox: _proximityDestScore(b, d) }; });
        withProx.sort(function(a, c){ return a.prox - c.prox; });
        bestDestId = withProx[0] && withProx[0].id;
      } else if (scores.length) {
        bestDestId = scores[0].id;
      }
    }
    b._destId = bestDestId || (allDests[0] && allDests[0].id);

    // For cancellations, find a matching existing booking on the trip.
    var matchInfo = null;
    if (b.isCancellation) {
      var m = _findExistingBookingForCancellation(b);
      b._cancelMatch = m;
      if (m) {
        matchInfo = 'Will remove: <strong>' + _bimEsc(m.label) + '</strong> on <em>' + _bimEsc(m.destName) + '</em>';
      } else {
        matchInfo = '<span style="color:#a06030;">No matching booking on this trip — will be logged but no-op.</span>';
      }
    }

    var destDdlHtml = "";
    if (!b.isCancellation) {
      destDdlHtml = '<select data-bim-dest="' + i + '" style="font-size:11px;padding:3px 6px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;">' +
        allDests.map(function(d){
          var sel = (d.id === b._destId) ? " selected" : "";
          return '<option value="' + d.id + '"' + sel + '>' + _bimEsc(d.place || "?") + '</option>';
        }).join("") +
      '</select>';
    }

    row.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
        '<label style="display:flex;align-items:center;gap:5px;margin-top:1px;cursor:pointer;font-size:11px;color:#666;">' +
          '<input type="checkbox" data-bim-skip="' + i + '" ' + (b._skip ? "" : "checked") + ' style="margin:0;" />' +
          'Include' +
        '</label>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">' + titleBits.join(" ") + '</div>' +
          (b.address ? '<div style="font-size:11px;color:#666;margin-top:2px;">' + _bimEsc(b.address) + '</div>' : "") +
          (b.confirmationNumber ? '<div style="font-size:11px;color:var(--c-ink-3);margin-top:2px;">Confirmation: ' + _bimEsc(b.confirmationNumber) + '</div>' : "") +
          (matchInfo ? '<div style="font-size:11px;margin-top:4px;color:#5a3a0a;">' + matchInfo + '</div>' : "") +
        '</div>' +
        (destDdlHtml ? '<div style="flex-shrink:0;">' + destDdlHtml + '</div>' : '') +
      '</div>';

    container.appendChild(row);
  });

  // Wire up the per-row controls.
  container.querySelectorAll('[data-bim-dest]').forEach(function(sel){
    sel.onchange = function(){
      var idx = parseInt(sel.getAttribute("data-bim-dest"), 10);
      if (bookings[idx]) bookings[idx]._destId = sel.value;
    };
  });
  container.querySelectorAll('[data-bim-skip]').forEach(function(cb){
    cb.onchange = function(){
      var idx = parseInt(cb.getAttribute("data-bim-skip"), 10);
      if (bookings[idx]) bookings[idx]._skip = !cb.checked;
    };
  });
}

function _bimEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// v359.60.35: find an existing booking on the trip that matches a
// cancellation. Matching priority:
//   1. confirmation number exact match (strongest signal)
//   2. type + name normalized + overlapping dates
//   3. type + name normalized (no dates) — last resort
// Returns { label, destName, remove: function() } or null. The
// remove() closure does the actual splice when the commit pass runs.
function _findExistingBookingForCancellation(cancellation) {
  if (!trip || !Array.isArray(trip.destinations)) return null;
  var conf = cancellation.confirmationNumber || null;
  var nameKey = (cancellation.name || cancellation.carrier || "").toLowerCase().replace(/\s+/g, " ").trim();
  var type = cancellation.type;
  function _nameMatch(a) {
    var b = (a || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!b || !nameKey) return false;
    return b === nameKey || b.indexOf(nameKey) >= 0 || nameKey.indexOf(b) >= 0;
  }
  function _dateOverlap(checkIn, checkOut) {
    if (!cancellation.depDate || !checkIn) return false;
    return cancellation.depDate === checkIn || cancellation.arrDate === checkOut;
  }
  for (var di = 0; di < trip.destinations.length; di++) {
    var d = trip.destinations[di];
    // Hotels
    var hotels = d.hotelBookings || [];
    for (var hi = 0; hi < hotels.length; hi++) {
      var h = hotels[hi];
      if (type !== "hotel" && type !== "unknown") continue;
      var matched =
        (conf && h.confirmationNumber && h.confirmationNumber === conf) ||
        (_nameMatch(h.name) && (_dateOverlap(h.checkIn, h.checkOut) || !cancellation.depDate));
      if (matched) {
        var idx = hi;
        return {
          label: (h.name || "hotel") + (h.checkIn ? " (" + h.checkIn + ")" : ""),
          destName: d.place,
          remove: function(){ hotels.splice(idx, 1); }
        };
      }
    }
    // General bookings (restaurant/tour/ticket)
    var gen = d.generalBookings || [];
    for (var gi = 0; gi < gen.length; gi++) {
      var g = gen[gi];
      if (type === "hotel" || type === "flight" || type === "train" || type === "bus" || type === "ferry") continue;
      var matchedG =
        (conf && g.confirmationNumber && g.confirmationNumber === conf) ||
        (_nameMatch(g.label));
      if (matchedG) {
        var gIdx = gi;
        return {
          label: (g.label || "booking"),
          destName: d.place,
          remove: function(){ gen.splice(gIdx, 1); }
        };
      }
    }
  }
  // Transport legs
  if (type === "flight" || type === "train" || type === "bus" || type === "ferry") {
    if (trip.legs) {
      var legKeys = Object.keys(trip.legs);
      for (var lki = 0; lki < legKeys.length; lki++) {
        var leg = trip.legs[legKeys[lki]];
        var bks = leg && leg.bookings;
        if (!Array.isArray(bks)) continue;
        for (var bi = 0; bi < bks.length; bi++) {
          var bk = bks[bi];
          var matchedB =
            (conf && bk.confirmationNumber && bk.confirmationNumber === conf) ||
            (_nameMatch(bk.operator) && bk.departure === cancellation.depDate);
          if (matchedB) {
            var bIdx = bi;
            return {
              label: (bk.operator || type) + (bk.departure ? " " + bk.departure : ""),
              destName: (legKeys[lki] || "leg"),
              remove: function(){ bks.splice(bIdx, 1); }
            };
          }
        }
      }
    }
  }
  return null;
}
if (typeof globalThis !== "undefined") globalThis._findExistingBookingForCancellation = _findExistingBookingForCancellation;

// v359.60.37: normalize a name for fuzzy matching. Lowercases,
// collapses whitespace, strips punctuation. Used by both the dedupe
// finder and the cancellation matcher so they see the same keys.
function _bimNameKey(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _bimNameMatch(a, b) {
  var ka = _bimNameKey(a), kb = _bimNameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Substring match in either direction — handles "Bella Hotel" vs
  // "Bella Hotel - Superior Two Bedroom Apartment Sóley".
  return (ka.length >= 6 && kb.indexOf(ka) >= 0)
      || (kb.length >= 6 && ka.indexOf(kb) >= 0);
}

function _bimDateDiff(a, b) {
  if (!a || !b) return Infinity;
  var da = new Date(a + "T12:00:00").getTime();
  var db = new Date(b + "T12:00:00").getTime();
  if (isNaN(da) || isNaN(db)) return Infinity;
  return Math.round(Math.abs(da - db) / 86400000);
}

// v359.60.37: search the whole trip for an existing booking that
// matches an incoming batch entry. Returns { booking, kind } where
// kind is "hotel" / "leg" / "general", or null when nothing matches.
// Match priority: confirmation# exact > name + date within 2 days >
// name alone (last resort, only for the same conf-less type).
function _findExistingForMerge(b) {
  if (!trip || !Array.isArray(trip.destinations)) return null;
  var conf = b.confirmationNumber || null;

  if (b.type === "hotel") {
    var hotelCandidates = [];
    trip.destinations.forEach(function(d){
      (d.hotelBookings || []).forEach(function(h){
        hotelCandidates.push({ booking: h, kind: "hotel", dest: d });
      });
    });
    // Conf# match wins.
    if (conf) {
      var byConf = hotelCandidates.find(function(c){ return c.booking.confirmationNumber === conf; });
      if (byConf) return byConf;
    }
    // Name + close date.
    var byName = hotelCandidates.find(function(c){
      if (!_bimNameMatch(c.booking.name, b.name)) return false;
      if (b.depDate && c.booking.checkIn) {
        return _bimDateDiff(b.depDate, c.booking.checkIn) <= 2;
      }
      return true; // name match alone is enough if neither side has a checkIn
    });
    return byName || null;
  }

  if (b.type === "flight" || b.type === "train" || b.type === "bus" || b.type === "ferry") {
    var legCandidates = [];
    Object.keys(trip.legs || {}).forEach(function(k){
      var leg = trip.legs[k];
      (leg && leg.bookings || []).forEach(function(bk){
        if (bk.mode === b.type) legCandidates.push({ booking: bk, kind: "leg", leg: leg });
      });
    });
    if (conf) {
      var byConfL = legCandidates.find(function(c){ return c.booking.confirmationNumber === conf; });
      if (byConfL) return byConfL;
    }
    var byOp = legCandidates.find(function(c){
      if (!_bimNameMatch(c.booking.operator, b.carrier)) return false;
      if (b.depDate && c.booking.departure) {
        return _bimDateDiff(b.depDate, c.booking.departure) <= 1;
      }
      return false;
    });
    return byOp || null;
  }

  // restaurant / tour / ticket / unknown → generalBookings
  var genCandidates = [];
  trip.destinations.forEach(function(d){
    (d.generalBookings || []).forEach(function(g){
      genCandidates.push({ booking: g, kind: "general", dest: d });
    });
  });
  if (conf) {
    var byConfG = genCandidates.find(function(c){ return c.booking.confirmationNumber === conf; });
    if (byConfG) return byConfG;
  }
  var byLabel = genCandidates.find(function(c){
    if (!_bimNameMatch(c.booking.label, b.name)) return false;
    if (b.depDate && c.booking.date) {
      return _bimDateDiff(b.depDate, c.booking.date) <= 1;
    }
    return true;
  });
  return byLabel || null;
}
if (typeof globalThis !== "undefined") globalThis._findExistingForMerge = _findExistingForMerge;

// v359.60.37: per-type merge helpers. Fill in EMPTY fields on the
// existing booking from the incoming batch entry — never overwrite
// existing non-empty values (the user may have edited them). Notes
// get appended rather than skipped so additional info accumulates.
function _bimIsEmpty(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
}
function _bimSetIfEmpty(obj, field, value) {
  if (_bimIsEmpty(value)) return false;
  if (_bimIsEmpty(obj[field])) { obj[field] = value; return true; }
  return false;
}
function _bimAppendNotes(obj, addition) {
  if (!addition) return;
  if (!obj.notes) { obj.notes = addition; return; }
  if (obj.notes.indexOf(addition) >= 0) return; // already there
  obj.notes = (obj.notes + "\n" + addition).trim();
}

function _mergeIncomingIntoHotel(existing, b) {
  _bimSetIfEmpty(existing, "name", b.name);
  _bimSetIfEmpty(existing, "checkIn", b.depDate);
  _bimSetIfEmpty(existing, "checkInTime", b.depTime);
  _bimSetIfEmpty(existing, "checkOut", b.arrDate);
  _bimSetIfEmpty(existing, "checkOutTime", b.arrTime);
  _bimSetIfEmpty(existing, "confirmationNumber", b.confirmationNumber);
  if (_bimIsEmpty(existing.pricePaid) && typeof b.price === "number") existing.pricePaid = b.price;
  _bimSetIfEmpty(existing, "currency", b.currency);
  _bimSetIfEmpty(existing, "url", b.url);
  if (_bimIsEmpty(existing.cancelType) || existing.cancelType === "unknown") {
    if (!_bimIsEmpty(b.cancelType)) existing.cancelType = b.cancelType;
  }
  _bimSetIfEmpty(existing, "cancelDeadline", b.cancelDeadline);
  if (b.notes) _bimAppendNotes(existing, b.notes);
  if (b.address) _bimAppendNotes(existing, "Address: " + b.address);
}

function _mergeIncomingIntoLeg(existing, b) {
  _bimSetIfEmpty(existing, "operator", b.carrier);
  _bimSetIfEmpty(existing, "from", b.from);
  _bimSetIfEmpty(existing, "to", b.to);
  _bimSetIfEmpty(existing, "departure", b.depDate);
  _bimSetIfEmpty(existing, "departureTime", b.depTime);
  _bimSetIfEmpty(existing, "arrival", b.arrDate);
  _bimSetIfEmpty(existing, "arrivalTime", b.arrTime);
  _bimSetIfEmpty(existing, "confirmationNumber", b.confirmationNumber);
  if (_bimIsEmpty(existing.pricePaid) && typeof b.price === "number") existing.pricePaid = b.price;
  _bimSetIfEmpty(existing, "currency", b.currency);
  _bimSetIfEmpty(existing, "url", b.url);
  if (_bimIsEmpty(existing.cancelType) || existing.cancelType === "unknown") {
    if (!_bimIsEmpty(b.cancelType)) existing.cancelType = b.cancelType;
  }
  _bimSetIfEmpty(existing, "cancelDeadline", b.cancelDeadline);
  if (b.notes) _bimAppendNotes(existing, b.notes);
  if (b.number) _bimAppendNotes(existing, (b.type === "flight" ? "Flight " : "") + b.number);
}

function _mergeIncomingIntoGeneral(existing, b) {
  _bimSetIfEmpty(existing, "label", b.name);
  _bimSetIfEmpty(existing, "date", b.depDate);
  _bimSetIfEmpty(existing, "time", b.depTime);
  _bimSetIfEmpty(existing, "timeEnd", b.arrTime);
  _bimSetIfEmpty(existing, "confirmationNumber", b.confirmationNumber);
  if (_bimIsEmpty(existing.pricePaid) && typeof b.price === "number") existing.pricePaid = b.price;
  _bimSetIfEmpty(existing, "currency", b.currency);
  _bimSetIfEmpty(existing, "url", b.url);
  if (_bimIsEmpty(existing.cancelType) || existing.cancelType === "unknown") {
    if (!_bimIsEmpty(b.cancelType)) existing.cancelType = b.cancelType;
  }
  _bimSetIfEmpty(existing, "cancelDeadline", b.cancelDeadline);
  if (b.notes) _bimAppendNotes(existing, b.notes);
  if (b.address) _bimAppendNotes(existing, "Location: " + b.address);
}

// v359.60.35: commit the parsed/reviewed batch. v359.60.37: now
// dedupes by searching the whole trip first — when a new entry
// matches an existing booking (by conf# or by name+date), the
// incoming non-empty fields fill in any empty slots on the existing
// record instead of adding a duplicate. The user can re-paste the
// same source (or a richer one) and get FILLED-IN bookings instead
// of duplicates. Returns { added, updated, cancelled, skipped }.
function _commitBatchBookings(bookings) {
  var added = 0, updated = 0, cancelled = 0, skipped = 0;
  var newBkIdFn = (typeof newBkId === "function") ? newBkId : function(){ return "bk-" + Date.now() + "-" + Math.random().toString(36).slice(2,6); };
  bookings.forEach(function(b){
    if (b._skip) { skipped++; return; }
    if (b.isCancellation) {
      if (b._cancelMatch && typeof b._cancelMatch.remove === "function") {
        try { b._cancelMatch.remove(); cancelled++; }
        catch(e){ console.warn("[bim] cancellation remove failed:", e); }
      } else {
        // No match — log but don't error. Cancellation without a
        // matching booking is benign (maybe the user never added it
        // to this trip in the first place).
        console.log("[bim] cancellation had no match:", b.name || b.confirmationNumber);
      }
      return;
    }

    // v359.60.37: dedupe pass — does the trip already contain this booking?
    var existingMatch = _findExistingForMerge(b);
    if (existingMatch) {
      try {
        if (existingMatch.kind === "hotel")   _mergeIncomingIntoHotel(existingMatch.booking, b);
        if (existingMatch.kind === "leg")     _mergeIncomingIntoLeg(existingMatch.booking, b);
        if (existingMatch.kind === "general") _mergeIncomingIntoGeneral(existingMatch.booking, b);
        updated++;
      } catch(e) {
        console.warn("[bim] merge failed, adding as new:", e);
        // Fall through to add path below by clearing the match marker.
        existingMatch = null;
      }
      if (existingMatch) return; // merged — don't also add
    }

    var dest = (typeof getDest === "function") ? getDest(b._destId) : null;
    if (!dest && trip.destinations.length) dest = trip.destinations[0];
    if (!dest) { skipped++; return; }
    var commonCancel = {
      cancelType:         b.cancelType || "unknown",
      cancelDeadline:     b.cancelDeadline || null,
      cancelDeadlineTime: null
    };
    if (b.type === "hotel") {
      if (!dest.hotelBookings) dest.hotelBookings = [];
      dest.hotelBookings.push(Object.assign({
        id: newBkIdFn(),
        name: b.name || "Untitled hotel",
        area: "",
        checkIn: b.depDate || null,
        checkInTime: b.depTime || null,
        checkOut: b.arrDate || null,
        checkOutTime: b.arrTime || null,
        confirmationNumber: b.confirmationNumber || "",
        pricePaid: (typeof b.price === "number") ? b.price : null,
        currency: b.currency || "USD",
        notes: (b.notes || "") + (b.address ? "\nAddress: " + b.address : ""),
        url: b.url || null,
        status: "booked",
        source: "paste-batch",
        lat: null, lng: null
      }, commonCancel));
      added++;
    } else if (b.type === "flight" || b.type === "train" || b.type === "bus" || b.type === "ferry") {
      // v359.60.42: arrival at the FIRST destination has no previous
      // leg — save to trip.brief.entryDetails (same fix the single-
      // booking preview got). The previous fallback shoved arrivals
      // at dest[0] into the OUTBOUND leg, which is wrong.
      var destIdx = trip.destinations.indexOf(dest);
      var hasMatchingDepDate = b.depDate && dest.dateFrom && dest.dateTo
        && b.depDate <= dest.dateTo && b.depDate >= dest.dateFrom;
      var isFirstDest = (destIdx === 0);
      var isLastDest  = (destIdx === trip.destinations.length - 1);
      // Heuristic: flight that arrives within the first destination's
      // stay window → entryDetails. Flight that departs within the
      // last destination's stay window → exitDetails.
      if (isFirstDest && b.arrDate && dest.dateFrom && b.arrDate <= dest.dateFrom) {
        if (!trip.brief) trip.brief = {};
        trip.brief.entryDetails = {
          carrier: b.carrier || "",
          number:  b.number  || "",
          time:    b.arrTime || b.depTime || "",
          url:     b.url     || null,
          confirmationNumber: b.confirmationNumber || ""
        };
        if (!trip.brief.entryMode) trip.brief.entryMode = (b.type === "flight") ? "fly" : b.type;
        if (!trip.brief.entry) trip.brief.entry = dest.place || "";
        added++;
        return;
      }
      if (isLastDest && b.depDate && dest.dateTo && b.depDate >= dest.dateTo) {
        if (!trip.brief) trip.brief = {};
        trip.brief.exitDetails = {
          carrier: b.carrier || "",
          number:  b.number  || "",
          time:    b.depTime || "",
          url:     b.url     || null,
          confirmationNumber: b.confirmationNumber || ""
        };
        if (!trip.brief.exitMode) trip.brief.exitMode = (b.type === "flight") ? "fly" : b.type;
        if (!trip.brief.tbExit) trip.brief.tbExit = dest.place || "";
        added++;
        return;
      }
      var fromId, toId;
      if (destIdx > 0) {
        fromId = trip.destinations[destIdx - 1].id;
        toId = dest.id;
      } else if (destIdx === 0 && trip.destinations.length > 1) {
        fromId = dest.id;
        toId = trip.destinations[1].id;
      } else {
        skipped++; return;
      }
      var leg = (typeof getLeg === "function") ? getLeg(fromId, toId) : null;
      if (!leg) { skipped++; return; }
      if (!leg.bookings) leg.bookings = [];
      leg.bookings.push(Object.assign({
        id: newBkIdFn(),
        mode: b.type,
        operator: b.carrier || "",
        from: b.from || "",
        to: b.to || "",
        departure: b.depDate || null,
        departureTime: b.depTime || null,
        arrival: b.arrDate || null,
        arrivalTime: b.arrTime || null,
        confirmationNumber: b.confirmationNumber || "",
        pricePaid: (typeof b.price === "number") ? b.price : null,
        currency: b.currency || "USD",
        notes: (b.notes || "") + (b.number ? "\n" + (b.type === "flight" ? "Flight " : "") + b.number : ""),
        url: b.url || null,
        status: "booked",
        source: "paste-batch"
      }, commonCancel));
      added++;
    } else if (b.type === "car") {
      // v359.60.91: car-rental commit. Goes to trip.tripBookings[]
      // (top-level). Pickup/dropoff use the same depDate/arrDate
      // fields the LLM prompt uses for everything else; we map them
      // through here so the storage shape stays distinct.
      if (!trip.tripBookings) trip.tripBookings = [];
      trip.tripBookings.push(Object.assign({
        id: newBkIdFn(),
        kind: "car",
        vendor: b.carrier || b.name || "",
        pickup: {
          location: b.from || "",
          date: b.depDate || null,
          time: b.depTime || null
        },
        dropoff: {
          location: b.to || b.from || "",
          date: b.arrDate || null,
          time: b.arrTime || null
        },
        confirmationNumber: b.confirmationNumber || "",
        pricePaid: (typeof b.price === "number") ? b.price : null,
        currency: b.currency || "USD",
        notes: b.notes || "",
        url: b.url || null,
        status: "booked",
        source: "paste-batch"
      }, commonCancel));
      added++;
    } else {
      // restaurant / tour / ticket / unknown → generalBookings
      if (!dest.generalBookings) dest.generalBookings = [];
      dest.generalBookings.push(Object.assign({
        id: newBkIdFn(),
        type: b.type || "ticket",
        label: b.name || "Untitled booking",
        date: b.depDate || null,
        time: b.depTime || null,
        timeEnd: b.arrTime || null,
        confirmationNumber: b.confirmationNumber || "",
        pricePaid: (typeof b.price === "number") ? b.price : null,
        currency: b.currency || "USD",
        notes: (b.notes || "") + (b.address ? "\nLocation: " + b.address : ""),
        url: b.url || null,
        status: "booked",
        source: "paste-batch"
      }, commonCancel));
      added++;
    }
  });
  return { added: added, updated: updated, cancelled: cancelled, skipped: skipped };
}
if (typeof globalThis !== "undefined") globalThis._commitBatchBookings = _commitBatchBookings;

function showPasteConfirmationModal(destId) {
  var dest = (typeof getDest === "function") ? getDest(destId) : null;
  if (!dest) { maxAlert("Open a destination first."); return; }

  var existing = document.getElementById("paste-confirm-overlay");
  if (existing) existing.remove();
  var ov = document.createElement("div");
  ov.id = "paste-confirm-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:560px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);";
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--c-primary);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">📋</div>' +
      '<div style="font-size:14px;font-weight:700;">Paste a booking confirmation</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:10px;">Paste the email or confirmation page below. Max will pull out the carrier, dates, times, location, confirmation # — whatever it can find. You\'ll get a chance to review before saving.</div>' +
    '<textarea id="pcf-input" placeholder="Paste your confirmation here…" style="width:100%;min-height:200px;padding:10px 12px;border:1px solid var(--c-border-strong);border-radius:6px;font-family:-apple-system,sans-serif;font-size:12px;line-height:1.5;box-sizing:border-box;resize:vertical;"></textarea>' +
    '<div id="pcf-status" style="font-size:11px;color:var(--c-ink-3);min-height:14px;margin:6px 0 10px;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button id="pcf-cancel" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '<button id="pcf-parse" style="padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Parse →</button>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  var inputEl = document.getElementById("pcf-input");
  var statusEl = document.getElementById("pcf-status");
  var parseBtn = document.getElementById("pcf-parse");
  var cancelBtn = document.getElementById("pcf-cancel");
  inputEl.focus();

  // v353.7: stash the HTML version of the clipboard alongside the
  // plain text. When a user copies a selection from a rendered email
  // (Apple Mail, Gmail web), the textarea only gets text/plain — the
  // URLs behind hyperlinks get stripped because hrefs only live in
  // text/html. We grab both channels on paste so the URL extractor
  // can see what the user couldn't see in the textarea.
  var _pastedHtml = null;
  inputEl.addEventListener("paste", function(e){
    if (e.clipboardData) {
      try {
        var h = e.clipboardData.getData("text/html");
        if (h && h.trim()) _pastedHtml = h;
      } catch(_) {}
    }
  });

  cancelBtn.onclick = function(){ ov.remove(); };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  parseBtn.onclick = async function(){
    var text = (inputEl.value || "").trim();
    if (!text) { statusEl.textContent = "Paste something first."; statusEl.style.color = "#c44"; return; }
    if (text.length < 30) { statusEl.textContent = "That looks too short to be a confirmation."; statusEl.style.color = "#c44"; return; }
    parseBtn.disabled = true; cancelBtn.disabled = true;
    parseBtn.textContent = "Parsing…";
    statusEl.textContent = "Extracting fields…";
    statusEl.style.color = "#888";
    try {
      var parsed = await _parseBookingConfirmation(text, _pastedHtml);
      // Log the raw extraction so debugging is one console line away —
      // the LLM occasionally returns partial fields and the failure
      // mode used to be a silent generic message that gave the user
      // nothing to act on.
      console.log("[paste-confirm] LLM extracted:", parsed);
      // v359.60.91 (b): also dump as a flat JSON string so the
      // console doesn't truncate nested objects with "…" — easier
      // to copy/paste the whole shape when debugging.
      try { console.log("[paste-confirm] LLM extracted (JSON):", JSON.stringify(parsed)); } catch(_){}
      // Lenient pass: as long as the LLM gave us SOMETHING actionable,
      // hand off to the preview. The user can fix anything wrong; an
      // empty preview is better than a hard failure when the LLM
      // returned, say, only an address + dates without a hotel name.
      var anyField = parsed && (
        parsed.name || parsed.carrier || parsed.address ||
        parsed.depDate || parsed.arrDate ||
        parsed.depTime || parsed.arrTime ||
        parsed.confirmationNumber ||
        parsed.from || parsed.to || parsed.price
      );
      if (!parsed || !anyField) {
        statusEl.textContent = "Couldn't pull useful fields out of that. Try pasting more of the email — the part with the hotel/airline/restaurant name and the dates usually works best.";
        statusEl.style.color = "#c44";
        parseBtn.disabled = false; cancelBtn.disabled = false;
        parseBtn.textContent = "Parse →";
        return;
      }
      // If type came back "unknown" but we have fields, default to
      // hotel (most common booking shape) so the preview has SOME
      // structure. The user can change it via the Type dropdown.
      if (!parsed.type || parsed.type === "unknown") {
        // Heuristic: from/to → transport; checkOut-style fields → hotel; else best guess.
        if (parsed.from || parsed.to || parsed.number) parsed.type = "flight";
        else if (parsed.address || parsed.arrDate) parsed.type = "hotel";
        else parsed.type = "hotel"; // safe fallback
      }
      ov.remove();
      _showBookingPreviewModal(destId, parsed, text);
    } catch (e) {
      console.warn("[paste-confirm] parse failed:", e);
      statusEl.textContent = "Parse failed: " + (e && e.message || "unknown error");
      statusEl.style.color = "#c44";
      parseBtn.disabled = false; cancelBtn.disabled = false;
      parseBtn.textContent = "Parse →";
    }
  };
}

// LLM call. Strict JSON-only extraction prompt. Country-agnostic;
// no examples that bias toward a specific carrier or hotel chain.
//
// IMPORTANT: the LLM has a strong tendency to invent its own JSON
// shape (destination, accommodation, dates, etc.) instead of
// following an unfamiliar schema. Two countermeasures:
//   1. The system prompt below shows a complete worked example so
//      the model has a concrete pattern to copy from, not just a
//      type definition to interpret.
//   2. _normalizeBookingExtraction (below) maps common alternative
//      keys (accommodation→name, checkIn→depDate, total→price, etc.)
//      to our canonical schema as a belt-and-braces second line of
//      defense. Even if the LLM ignores the prompt, the normalizer
//      catches the most common drift patterns.
async function _parseBookingConfirmation(text, html) {
  var system =
    "You extract booking details from raw confirmation text (emails, web pages, screenshots transcribed). " +
    "Return ONLY a single JSON object — no prose, no markdown fences, no explanation. " +
    "Use EXACTLY the field names below. Do NOT invent your own field names. Common wrong names to AVOID: " +
    "'destination', 'accommodation', 'dates', 'travelers', 'trip_type', 'trip_kind', 'duration_days', " +
    "'travel_dates', 'pickup_location', 'pickup_date', 'pickup_time', 'dropoff_location', 'dropoff_date', " +
    "'dropoff_time', 'return_location', 'return_date', 'return_time', 'rental_company', 'rental_agency', " +
    "'vehicle_class', 'vehicle_type', 'total_cost', 'total_amount', 'amount_paid', 'booking_reference', " +
    "'confirmation_code', 'reservation_code'. " +
    "ALL of these should be re-mapped to the canonical names below — e.g. trip_type → type, pickup_location → from, " +
    "dropoff_location → to, pickup_date → depDate, dropoff_date → arrDate, rental_company → carrier, " +
    "total_cost → price, booking_reference → confirmationNumber. " +
    "Never return a nested object like { 'travel_dates': { 'start': '...', 'end': '...' } } — flatten to depDate / arrDate at the top level.\n\n" +
    "Schema:\n" +
    "{\n" +
    '  "type": "flight" | "hotel" | "car" | "train" | "bus" | "ferry" | "restaurant" | "tour" | "ticket" | "unknown",\n' +
    '  "carrier": string | null,        // airline / rail operator / bus company / hotel brand / restaurant name / car-rental company (Hertz, Sixt, Avis, Enterprise, Blue Car Rental, …)\n' +
    '  "number": string | null,         // flight number, train number — null for hotels and car rentals\n' +
    '  "name": string | null,           // hotel/restaurant/tour/ticket name (use carrier for transport AND car rentals)\n' +
    '  "address": string | null,        // hotel/restaurant address — null for transport / car rentals\n' +
    '  "from": string | null,           // transport: departure city or airport code · car rental: pickup location (often an airport name/code like "Keflavík Airport" or "KEF")\n' +
    '  "to": string | null,             // transport: arrival city or airport code · car rental: dropoff/return location (set equal to "from" for round-trip rentals — most common)\n' +
    '  "depDate": "YYYY-MM-DD" | null,  // transport: departure date; hotel: check-in; car: pickup date; restaurant/tour: event date\n' +
    '  "depTime": "HH:MM" | null,       // 24h. transport: departure; hotel: check-in time; car: pickup time; restaurant/tour: start time\n' +
    '  "arrDate": "YYYY-MM-DD" | null,  // transport: arrival date; hotel: check-out; car: dropoff/return date\n' +
    '  "arrTime": "HH:MM" | null,       // 24h. transport: arrival; hotel: check-out time; car: dropoff/return time; restaurant/tour: end time\n' +
    '  "confirmationNumber": string | null,\n' +
    '  "price": number | null,          // total paid, decimal\n' +
    '  "currency": string | null,       // ISO code: USD, EUR, GBP, ISK, etc\n' +
    '  "url": string | null,            // booking management URL if present (often labeled "Manage booking", "View reservation", or a domain like booking.com/account)\n' +
    '  "cancelType": "deadline" | "non-cancellable" | null,  // "deadline" if the policy gives a date you can cancel by; "non-cancellable" if explicitly non-refundable; null if no policy is stated\n' +
    '  "cancelDeadline": "YYYY-MM-DD" | null, // the LAST date the user can cancel for free. Date only — we deliberately do NOT capture the time. For "free until 7 days before arrival, arrival Oct 2" → 2026-09-24 (the day before the penalty starts).\n' +
    '  "notes": string | null           // anything notable that doesn\'t fit a field (gate, terminal, room type, party size, etc.)\n' +
    "}\n\n" +
    "Rules:\n" +
    "- Use 24-hour time. Convert AM/PM if needed (3:00 PM → 15:00, 11:00 AM → 11:00).\n" +
    "- TIME RANGES: hotels often state check-in/out as a window ('Check-in: 3:00 PM - 10:00 PM', 'Check-out: 7:00 AM - 11:00 AM'). Collapse to a single time: for check-in, use the EARLIEST time in the range (when the room becomes available — depTime=15:00 for '3 PM - 10 PM'). For check-out, use the LATEST time (the deadline by which to leave — arrTime=11:00 for '7 AM - 11 AM'). For transport time ranges (rare), use the scheduled time, not the boarding window.\n" +
    "- Dates: if year is missing, infer from context (recent emails are usually for upcoming travel). If truly unknowable, leave null.\n" +
    "- Type detection: be decisive. Words like 'Check-in / Check-out', 'X nights', 'Standard Room' → hotel. 'Flight #', airport codes, gate, terminal → flight. 'Train', PNR, station-to-station → train. Only return 'unknown' if there's truly no booking-shaped content at all.\n" +
    "- Missing fields are normal — set them to null. Don't refuse the whole extraction just because one or two fields aren't present. A hotel booking without a visible hotel name (sometimes the name lives at the top of the email and got cut off) should still be type='hotel' with name=null and the dates filled in.\n" +
    "- Don't invent values for fields that aren't in the source.\n" +
    "- If price is shown with a symbol ($, €, £, ¥), populate currency accordingly (USD, EUR, GBP, JPY). The cancellation cost / 'no-show fee' shown for hotel bookings is NOT the price paid — only use 'price' for what the user actually paid (often labeled 'Total' or 'Amount paid').\n" +
    "- 'address' is the physical location (hotel street address, restaurant address). Don't put airport codes or city names there — those go in 'from' / 'to' for transport.\n" +
    "- For 'notes', keep it short — one phrase only (e.g. 'Standard Double Room, 2 adults' or 'Gate B12, Terminal 2'). Long descriptions don't belong in any field.\n" +
    "- Cancellation: emails often state policy in prose ('Free cancellation until 7 days before arrival', 'until September 24, 2026 11:59 PM: € 0', 'Non-refundable'). Resolve to a concrete cancelDeadline date. If two dates are shown ('until X: € 0' and 'from Y: € N'), the deadline is X.\n" +
    "- URL: look for 'Manage booking', 'View reservation', 'Modify reservation', 'Modify or cancel', any clickable link, or domains like booking.com, hotels.com, airbnb.com, marriott.com, hilton.com, etc. URLs are often wrapped in MARKDOWN syntax like '[modify or cancel](https://secure.booking.com/...)' — extract the URL inside the parens, not the visible label. Same for HTML <a href=\"...\"> tags. Even very long URLs with tracking parameters are fine — copy them verbatim.\n\n" +
    "EXAMPLE INPUT (hotel, with time ranges):\n" +
    "Reservation details\nCheck-in: Friday, October 2, 2026 (3:00 PM - 10:00 PM)\nCheck-out: Monday, October 5, 2026 (7:00 AM - 11:00 AM)\n3 nights, Standard Double Room, 2 adults\nLocation: Adalgata 2, 340 Stykkishólmur, Iceland\nTotal: € 586.50\nCancellation policy: You can cancel for free until 7 days before arrival. Cancellation cost until September 24, 2026 11:59 PM: € 0; from September 25, 2026 12:00 AM: € 586.50.\nManage your booking: https://www.booking.com/mybooking?token=abc123\n\n" +
    "EXAMPLE OUTPUT for that input:\n" +
    '{"type":"hotel","carrier":null,"number":null,"name":null,"address":"Adalgata 2, 340 Stykkishólmur, Iceland","from":null,"to":null,"depDate":"2026-10-02","depTime":"15:00","arrDate":"2026-10-05","arrTime":"11:00","confirmationNumber":null,"price":586.50,"currency":"EUR","url":"https://www.booking.com/mybooking?token=abc123","cancelType":"deadline","cancelDeadline":"2026-09-24","notes":"Standard Double Room, 2 adults"}\n\n' +
    "EXAMPLE INPUT (flight):\n" +
    "Lufthansa LH 414\nDeparture: JFK 9:25 PM Wed Oct 1, 2026\nArrival: FRA 11:00 AM Thu Oct 2, 2026\nConfirmation: ABC123\nTotal $842.00\nNon-refundable\nManage booking: https://lufthansa.com/booking/ABC123\n\n" +
    "EXAMPLE OUTPUT for that input:\n" +
    '{"type":"flight","carrier":"Lufthansa","number":"LH 414","name":null,"address":null,"from":"JFK","to":"FRA","depDate":"2026-10-01","depTime":"21:25","arrDate":"2026-10-02","arrTime":"11:00","confirmationNumber":"ABC123","price":842.00,"currency":"USD","url":"https://lufthansa.com/booking/ABC123","cancelType":"non-cancellable","cancelDeadline":null,"notes":null}\n\n' +
    "EXAMPLE INPUT (car rental):\n" +
    "Hertz Reservation Confirmation\nPickup: Keflavík Airport, June 2, 2026, 7:30 AM\nReturn: Keflavík Airport, June 14, 2026, 6:00 PM\nConfirmation: H89401234\nTotal: USD 612.50\n\n" +
    "EXAMPLE OUTPUT for that input:\n" +
    '{"type":"car","carrier":"Hertz","number":null,"name":null,"address":null,"from":"Keflavík Airport","to":"Keflavík Airport","depDate":"2026-06-02","depTime":"07:30","arrDate":"2026-06-14","arrTime":"18:00","confirmationNumber":"H89401234","price":612.50,"currency":"USD","url":null,"cancelType":null,"cancelDeadline":null,"notes":null}\n\n' +
    "MULTI-LEG FLIGHTS: when a flight confirmation has more than one physical segment under a single PNR (e.g., JFK→LHR→KEF with a layover, or a round-trip with outbound and return legs), return an additional `legs` array with one entry per segment. Each leg has: {from, to, depDate, depTime, arrDate, arrTime, carrier, flightNumber}. Keep the top-level type='flight'; the flat carrier/from/to/depDate/etc. fields can still hold the FIRST leg for backward compatibility, but `legs` is the authoritative shape when present.\n\n" +
    "EXAMPLE INPUT (multi-leg flight):\n" +
    "Lufthansa Confirmation: ABC123\nOutbound: LH 400 JFK→FRA, Oct 1 9:25 PM → Oct 2 11:00 AM\nConnecting: LH 1158 FRA→ZRH, Oct 2 1:00 PM → Oct 2 2:15 PM\nTotal $842\n\n" +
    "EXAMPLE OUTPUT for that input:\n" +
    '{"type":"flight","carrier":"Lufthansa","number":"LH 400","legs":[{"carrier":"Lufthansa","flightNumber":"LH 400","from":"JFK","to":"FRA","depDate":"2026-10-01","depTime":"21:25","arrDate":"2026-10-02","arrTime":"11:00"},{"carrier":"Lufthansa","flightNumber":"LH 1158","from":"FRA","to":"ZRH","depDate":"2026-10-02","depTime":"13:00","arrDate":"2026-10-02","arrTime":"14:15"}],"from":"JFK","to":"ZRH","depDate":"2026-10-01","depTime":"21:25","arrDate":"2026-10-02","arrTime":"14:15","confirmationNumber":"ABC123","price":842.00,"currency":"USD","url":null,"cancelType":null,"cancelDeadline":null,"notes":null}\n\n' +
    "CRITICAL for car rentals: when the input contains a rental-company name (Hertz, Sixt, Avis, Enterprise, Budget, Alamo, National, Thrifty, Dollar, Europcar, Blue Car Rental, Lava Car Rental, Lava, etc.), ALWAYS populate carrier with that name. When pickup or return text contains a time like '7:30 AM' or '18:00' or '14:30', ALWAYS populate depTime (pickup) and arrTime (return) in 24-hour HH:MM format. When the total is shown with a currency code or symbol ('USD 612.50', '$612.50', '384.934 ISK'), populate price with JUST the number (612.50, 384934) and currency with the ISO code ('USD', 'ISK'). Never put 'USD 612.50' as the price value — split them apart. Note: in European-style numbers '384.934 ISK' the dot is a thousands separator, so the value is 384934, not 384.934.\n\n" +
    "LOCATION SPECIFICITY: when the source contains BOTH a country/region (e.g. 'Iceland') AND a specific airport, city, or station name (e.g. 'Keflavik International Airport'), populate from / to with the SPECIFIC location, never the country. The country is too vague to be useful for a pickup point.\n\n" +
    "CONFIRMATION NUMBER aliases: 'Booking Number', 'Booking ID', 'Booking Reference', 'Reservation Number', 'Reservation Code', 'PNR', 'Reference', 'Record Locator' — ALL of these go into confirmationNumber. Always extract this value if any of those labels appear in the source.\n\n" +
    "PRICE PREFERENCE: when a confirmation shows multiple money figures ('Amount Paid: 0', 'Outstanding Balance: 384.934 ISK', 'Total Price: 384.934 ISK'), use the TOTAL (or Total Price / Total Cost / Grand Total) — NOT the amount paid so far and NOT the outstanding balance. Customer cares about what the rental costs, not their payment progress.\n\n" +
    "Now extract the user's confirmation in the same shape.";
  var user = "CONFIRMATION TEXT:\n\n" + text + "\n\nReturn the JSON.";
  var resp = await callMax(
    [{ role: "user", content: user }],
    1500, 30000
  );
  // Strip code-fence wrappers if the model added them despite instructions.
  var clean = String(resp || "").trim();
  clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  // Find the first { ... } block in case there's any preamble.
  var firstBrace = clean.indexOf("{");
  var lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }
  var raw;
  try {
    raw = JSON.parse(clean);
  } catch (e) {
    console.warn("[paste-confirm] JSON parse failed:", clean.slice(0, 200));
    throw new Error("LLM returned malformed JSON");
  }
  var normalized = _normalizeBookingExtraction(raw);
  // v359.60.91 (b): time-regex fallback. LLM sometimes drops times
  // even when they're plainly present in the source text ("Pickup
  // ... 7:30 AM Return ... 6:00 PM"). When depTime / arrTime are
  // missing after normalization, scan the raw text directly and
  // use the first time → depTime, last time → arrTime. Works for
  // typical pickup-then-return ordering in rental confirmations.
  if ((!normalized.depTime || !normalized.arrTime) && text) {
    var timeRe = /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/gi;
    var found = [];
    var tm;
    while ((tm = timeRe.exec(text)) !== null) {
      var h = parseInt(tm[1], 10);
      var min = tm[2];
      var ampm = (tm[3] || "").toLowerCase().replace(/\./g, "");
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23) {
        found.push(String(h).padStart(2, "0") + ":" + min);
      }
    }
    if (found.length >= 1 && !normalized.depTime) normalized.depTime = found[0];
    if (found.length >= 2 && !normalized.arrTime) normalized.arrTime = found[found.length - 1];
    if (found.length >= 1) console.log("[paste-confirm] time-regex fallback found:", found);
  }
  // v359.60.91 (b): vendor-regex fallback. If the LLM forgot the
  // rental-company name but it's clearly present in the source text
  // ("Hertz Reservation Confirmation"), pluck it out. Longer/more
  // specific names first so "Lava Car Rental" wins over "Lava" alone.
  if (!normalized.carrier && !normalized.name && text) {
    var vendorRe = /\b(Lava Car Rental|Blue Car Rental|Sicily by Car|Fox Rent A Car|Auto Europe|Ace Rent A Car|Hertz|Sixt|Avis|Enterprise|Budget|Alamo|National|Thrifty|Dollar|Europcar|Payless|Kemwel|Rentalcars|Lava)\b/i;
    var vm = text.match(vendorRe);
    if (vm) {
      normalized.carrier = vm[1];
      console.log("[paste-confirm] vendor-regex fallback found:", vm[1]);
    }
  }
  // v359.60.91 (b): confirmation-number regex fallback. The LLM
  // surprisingly often misses an explicit "Confirmation #: XXX" or
  // "Booking Number: YYY" right at the top of the email. Regex
  // catches it deterministically.
  if (!normalized.confirmationNumber && text) {
    var confRe = /(?:Confirmation(?:\s*#|\s*Number|\s*Code)?|Booking(?:\s*#|\s*Number|\s*ID|\s*Reference|\s*Code)?|Reservation(?:\s*#|\s*Number|\s*Code)?|PNR|Record\s*Locator|Reference\s*Number)\s*[:\-#]?\s*([A-Z0-9]{4,20})\b/i;
    var cm = text.match(confRe);
    if (cm && cm[1]) {
      normalized.confirmationNumber = cm[1].toUpperCase();
      console.log("[paste-confirm] confirmation-regex fallback found:", cm[1]);
    }
  }
  // v359.60.91 (b): price + currency regex fallback. Real
  // confirmations show price in formats like "Total: ISK 372,696",
  // "Total Price: USD 612.50", "Grand Total: $1,234.56", "€586.50".
  // The LLM sometimes gets distracted by other money figures
  // ("Amount Paid: 0", "Outstanding Balance: ..."). Regex anchors on
  // the Total/Grand Total label to grab the right line.
  if ((normalized.price == null || normalized.price === "") && text) {
    var priceRe = /(?:Total\s*Price|Grand\s*Total|Total(?!\s*does\s*not))\s*[:\-]?\s*((?:[A-Z]{3}\s*)?(?:[\$€£¥]\s*)?[\d,. ]+(?:\s*[A-Z]{3})?)/i;
    var pmatch = text.match(priceRe);
    if (pmatch && pmatch[1]) {
      var rawAmt = pmatch[1].trim();
      var ccyAmt = rawAmt.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|ISK|CHF|CNY|INR|MXN|BRL|KRW|SEK|NOK|DKK|PLN|CZK|HUF|RUB|TRY|ZAR|SGD|HKD|NZD)\b/i);
      if (ccyAmt && !normalized.currency) normalized.currency = ccyAmt[1].toUpperCase();
      if (!normalized.currency) {
        if (/\$/.test(rawAmt)) normalized.currency = "USD";
        else if (/€/.test(rawAmt)) normalized.currency = "EUR";
        else if (/£/.test(rawAmt)) normalized.currency = "GBP";
        else if (/¥/.test(rawAmt)) normalized.currency = "JPY";
      }
      // Strip currency, then handle European thousands separator.
      // "ISK 372,696" → "372,696" → 372696 (comma is thousands sep)
      // "ISK 384.934" → "384.934" → 384934 (dot is thousands sep when
      //   there are exactly 3 digits after AND no other decimal point)
      var num = rawAmt.replace(/[A-Z]{3}/gi, "").replace(/[\$€£¥]/g, "").trim();
      // Heuristic: if there's a single dot followed by exactly 3
      // digits and no other dots/commas, treat as European thousands.
      if (/^\d+\.\d{3}$/.test(num)) {
        num = num.replace(/\./g, "");
      } else {
        // US-style: commas are thousands, dot is decimal.
        num = num.replace(/,/g, "");
      }
      var nVal = parseFloat(num);
      if (isFinite(nVal)) {
        normalized.price = nVal;
        console.log("[paste-confirm] price-regex fallback found:", nVal, normalized.currency);
      }
    }
  }
  console.log("[paste-confirm] LLM url field:", normalized.url);
  // Belt-and-braces: if no URL was extracted (or the LLM grabbed the
  // visible label "modify or cancel" instead of the actual https://
  // URL), fall back to a regex scan of the original text. This is
  // generic — works for any booking-confirmation email format that
  // has a URL somewhere in the body, regardless of how it's formatted.
  if (!normalized.url || !/^https?:\/\//i.test(normalized.url)) {
    // Scan both the plain-text paste AND the captured HTML clipboard
    // payload (when available). Most rendered emails put the visible
    // text in text/plain and the link hrefs in text/html; we want
    // both signals.
    var combined = (text || "") + (html ? "\n\n" + html : "");
    var fallback = _extractBookingUrl(combined);
    console.log("[paste-confirm] URL fallback ran. found:", fallback, "(html available:", !!html, ")");
    if (fallback) normalized.url = fallback;
  }

  // v359.60.91 (b): URL parameter rescue. Booking-management URLs
  // from many rental + airline systems carry the truth as query
  // parameters: ddate, pdate, confirmationNumber. When the LLM
  // hallucinates a date or misses a confirmation number, the URL is
  // more reliable. We OVERRIDE the LLM's value when the URL has one
  // — the LLM has been observed to invent dates (returning Sep 8
  // when the URL says Oct 8). Runs AFTER the URL fallback above so
  // normalized.url is fully populated.
  if (normalized.url && /[?&]/.test(normalized.url)) {
    try {
      // Decode HTML entities — the LLM sometimes returns &amp; instead
      // of & in the URL, which breaks naive new URL() param parsing
      // because the param name becomes "amp;X" instead of "X".
      var decodedUrl = normalized.url.replace(/&amp;/g, "&");
      var u = new URL(decodedUrl);
      var sp = u.searchParams;
      function _getParam(names) {
        for (var i = 0; i < names.length; i++) {
          var v = sp.get(names[i]);
          if (v != null && v !== "") return v;
        }
        return null;
      }
      var urlConf = _getParam(["confirmationNumber", "confirmation", "conf", "bookingNumber", "booking", "reservationNumber", "reservation", "pnr"]);
      if (urlConf) {
        normalized.confirmationNumber = urlConf;
        console.log("[paste-confirm] URL param confirmationNumber:", urlConf);
      }
      var urlPdate = _getParam(["pdate", "pickupDate", "pickup_date", "fromDate", "checkin", "depart", "departure"]);
      var urlDdate = _getParam(["ddate", "dropoffDate", "dropoff_date", "returnDate", "toDate", "checkout", "arrive", "arrival"]);
      function _splitDateTime(iso) {
        if (!iso) return [null, null];
        var s = decodeURIComponent(String(iso));
        var m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]?(\d{2}:\d{2})?/);
        if (!m) return [null, null];
        return [m[1], m[2] || null];
      }
      var pParts = _splitDateTime(urlPdate);
      var dParts = _splitDateTime(urlDdate);
      if (pParts[0]) { normalized.depDate = pParts[0]; console.log("[paste-confirm] URL param depDate:", pParts[0]); }
      if (pParts[1]) { normalized.depTime = pParts[1]; console.log("[paste-confirm] URL param depTime:", pParts[1]); }
      if (dParts[0]) { normalized.arrDate = dParts[0]; console.log("[paste-confirm] URL param arrDate:", dParts[0]); }
      if (dParts[1]) { normalized.arrTime = dParts[1]; console.log("[paste-confirm] URL param arrTime:", dParts[1]); }
    } catch (e) {
      console.warn("[paste-confirm] URL parameter parse failed:", e);
    }
  }

  return normalized;
}

// Extract the most plausible booking-management URL from raw email
// or web-confirmation text. Handles three common formats: markdown
// '[label](url)' (Booking.com style), HTML '<a href="url">label</a>',
// and bare URLs. Then scores each by booking-relevance keywords so
// we don't return a tracking pixel or an unsubscribe link when a
// real management URL is present.
function _extractBookingUrl(text) {
  if (!text) return null;
  var urls = [];
  var m;
  // Markdown links: [label](url) — Booking.com confirmation emails
  // routinely format CTAs this way when copied from rendered output.
  var mdRe = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  while ((m = mdRe.exec(text)) !== null) {
    urls.push({ url: m[2], label: (m[1] || "").toLowerCase() });
  }
  // HTML anchors: <a href="url">label</a>
  var htmlRe = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = htmlRe.exec(text)) !== null) {
    if (/^https?:\/\//i.test(m[1])) {
      urls.push({ url: m[1], label: m[2].replace(/<[^>]+>/g, "").toLowerCase().trim() });
    }
  }
  // Bare URLs — but only AFTER stripping the structured ones so we
  // don't double-count. We also strip query strings to a max length
  // when scoring (very long URLs are usually tracking).
  var stripped = text.replace(mdRe, " ").replace(htmlRe, " ");
  var bareRe = /https?:\/\/[^\s<>"')\]]+/g;
  while ((m = bareRe.exec(stripped)) !== null) {
    urls.push({ url: m[0], label: "" });
  }
  if (!urls.length) return null;

  // Score each candidate by how booking-relevant it looks.
  //
  // The scoring split between HOST and PATH/QUERY matters: a real
  // management URL like
  //   https://secure.booking.com/confirmation.en-us.html?…&from_conf_email_tracking=1
  // has the word "tracking" in a query param, but it's not a
  // tracking URL — it's a confirmation page that happens to carry
  // tracking analytics. We check tracking-y signals on HOST only.
  var positive = /booking\.com|hotels\.com|airbnb\.com|expedia\.com|marriott|hilton|hyatt|ihg|accor|trip\.com|agoda|priceline|kayak|skyscanner|opentable|resy|tock|viator|getyourguide|tickets|ticketmaster|amtrak|trainline|sncf|bahn|rail|airlines|airways|lufthansa|united|delta|aa\.com|jetblue|britishairways|southwest|ryanair|easyjet/i;
  var positiveLabels = /manage|modify|cancel|reservation|confirmation|booking|view|access|details|mybooking/i;
  // Host-level negatives: a URL served BY one of these subdomains is
  // probably tracking infra, not the actual management page.
  var negativeHost = /^(?:click|track|tracking|stat|stats|analytics?|pixel|email|emails|t|r|link|links)\./i;
  // Label-level negatives: the visible link text indicates the URL
  // is footer/legal/social, not a management CTA.
  var negativeLabel = /unsubscribe|preferences|privacy|terms|footer|optout|opt out|facebook|twitter|linkedin|instagram|youtube|tiktok/i;
  var imageExt = /\.(?:gif|png|jpg|jpeg|svg|webp|ico|css|js|woff|woff2|ttf)(\?|$)/i;
  // v359.60.91 (b): tech-spec URLs that creep in via the page's HTML
  // DOCTYPE / namespace declarations when the user copy-pastes from
  // a rendered page (browsers attach the source HTML to the clipboard
  // even for selected-text copy). These are never booking URLs.
  var technicalNonsense = /^https?:\/\/(?:www\.)?(?:w3\.org|schemas?\.[a-z]+\.[a-z]+|xmlns\.|ns\.adobe|purl\.org|tools\.ietf\.org\/rfc)/i;
  var techExt = /\.(?:dtd|xsd|xsl|xslt|rng|owl|rdf)(\?|$|#)/i;

  function score(u) {
    var s = 0;
    var url = u.url;
    var hostMatch = url.match(/^https?:\/\/([^\/]+)/i);
    var host = hostMatch ? hostMatch[1].toLowerCase() : "";
    var pathQuery = hostMatch ? url.slice(hostMatch[0].length).toLowerCase() : "";

    // Positive: known travel/booking domain anywhere in the URL.
    if (positive.test(host)) s += 3;
    // Positive: management-CTA keywords in the visible label OR
    // anywhere in the URL (host or path).
    if (positiveLabels.test(u.label)) s += 2;
    if (positiveLabels.test(host) || positiveLabels.test(pathQuery)) s += 1;
    // Tiebreaker: URLs with an actual path/query are real pages,
    // bare domain links are usually footer logos. Boost the former.
    if (pathQuery.length > 1) s += 1;

    // Negatives — host-only for tracking signals so we don't
    // mis-penalize legit URLs with analytics query params.
    if (negativeHost.test(host)) s -= 6;
    if (negativeLabel.test(u.label)) s -= 6;
    if (imageExt.test(host) || imageExt.test(pathQuery)) s -= 6;
    // v359.60.91 (b): aggressively zero-out tech-spec URLs (w3.org
    // DOCTYPE references, .dtd/.xsd files, etc.). A score of -10
    // guarantees they fall below the >= 0 cutoff at the bottom of
    // this function even if some weak positive signal hits.
    if (technicalNonsense.test(url)) s -= 10;
    if (techExt.test(url)) s -= 10;
    return s;
  }
  urls.forEach(function(u){ u.score = score(u); });
  urls.sort(function(a,b){ return b.score - a.score; });
  console.log("[paste-confirm] URL candidates (top 5):", urls.slice(0, 5).map(function(u){ return { score: u.score, url: u.url.slice(0, 80), label: u.label.slice(0, 30) }; }));
  // Return the top candidate as long as it's not actively bad.
  return urls[0].score >= 0 ? urls[0].url : null;
}

// Best-effort time-range parser. Hotels frequently state check-in /
// check-out as windows: "3:00 PM - 10:00 PM", "7:00 AM - 11:00 AM",
// "15:00-22:00", etc. Even when the LLM should be collapsing these
// per the prompt, sometimes it returns the raw range. Returns the
// chosen endpoint as "HH:MM" (start for check-in, end for check-out).
function _parseTimeRange(s, prefer) {
  if (!s || typeof s !== "string") return null;
  // Already a clean HH:MM? leave it.
  if (/^\d{2}:\d{2}$/.test(s.trim())) return s.trim();
  function to24(h, m, ampm) {
    h = parseInt(h, 10);
    if (ampm) {
      ampm = ampm.toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
    var hh = h < 10 ? "0" + h : String(h);
    var mm = m ? (m.length === 1 ? "0" + m : m) : "00";
    return hh + ":" + mm;
  }
  // Try to find two time tokens in the string. Pattern allows "3:00 PM",
  // "3 PM", "15:00", "15", separated by - or –.
  var re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/;
  var m = s.match(re);
  if (m) {
    var startH = m[1], startMin = m[2], startAp = m[3];
    var endH   = m[4], endMin   = m[5], endAp   = m[6];
    // If only one side has am/pm, infer the other (assume same period).
    if (!startAp && endAp) startAp = endAp;
    if (!endAp && startAp) endAp = startAp;
    var start = to24(startH, startMin, startAp);
    var end   = to24(endH, endMin, endAp);
    return prefer === "end" ? end : start;
  }
  // Single time fallback.
  var single = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?/);
  if (single) return to24(single[1], single[2], single[3]);
  return null;
}

// Best-effort date-range parser. Handles common formats the LLM
// might return when it inlines dates into a single string instead
// of using depDate/arrDate. Returns {start, end} as YYYY-MM-DD or
// null if it can't make sense of it.
// v359.60.40: year inference for booking date strings that omit it.
// Booking.com dashboard rows say "Sep 20 – Sep 22" — no year. Prefer
// the trip's start year (the booking is FOR this trip); fall back to
// the current year. Exposed so the backfill console snippet can use
// the same logic.
function _inferYearForBooking() {
  try {
    if (typeof trip !== "undefined" && trip && trip.destinations && trip.destinations.length) {
      var first = trip.destinations[0];
      if (first.dateFrom) {
        var m = String(first.dateFrom).match(/^(\d{4})/);
        if (m) return m[1];
      }
    }
  } catch(_){}
  return String(new Date().getFullYear());
}
if (typeof globalThis !== "undefined") globalThis._inferYearForBooking = _inferYearForBooking;

function _parseDateRangeString(s) {
  if (!s) return null;
  s = String(s).trim();
  var pad = function(n){ n = String(n); return n.length === 1 ? "0" + n : n; };
  var months = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
  // ISO range: "2026-10-02 to 2026-10-05" or "2026-10-02 - 2026-10-05"
  var iso = s.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–|—)\s*(\d{4}-\d{2}-\d{2})/);
  if (iso) return { start: iso[1], end: iso[2] };
  // Slash range: "10/2/2026 - 10/5/2026"
  var slash = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:to|-|–|—)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    return {
      start: slash[3] + "-" + pad(slash[1]) + "-" + pad(slash[2]),
      end: slash[6] + "-" + pad(slash[4]) + "-" + pad(slash[5]),
    };
  }
  // Try compact form: "October 2-5, 2026"
  var compact = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}),?\s+(\d{4})$/);
  if (compact) {
    var mc = months[compact[1].slice(0,3).toLowerCase()];
    if (mc) {
      var yc = compact[4];
      return { start: yc + "-" + mc + "-" + pad(compact[2]), end: yc + "-" + mc + "-" + pad(compact[3]) };
    }
  }
  // Try expanded form: "October 2 - October 5, 2026"
  var expanded = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (expanded) {
    var m1 = months[expanded[1].slice(0,3).toLowerCase()];
    var m2 = months[expanded[3].slice(0,3).toLowerCase()];
    var ye = expanded[5];
    if (m1 && m2) {
      return { start: ye + "-" + m1 + "-" + pad(expanded[2]), end: ye + "-" + m2 + "-" + pad(expanded[4]) };
    }
  }
  // v359.60.40: NO-YEAR forms — booking.com dashboard rows like
  // "Sep 20 – Sep 22" don't include a year. Infer from trip context.
  // Compact no-year: "Sep 20-22" / "Sep 20 - Sep 22" / "Sep 20 – 22"
  var compactNY = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(?:(?:[A-Za-z]+)\s+)?(\d{1,2})\s*$/);
  if (compactNY) {
    var mcny = months[compactNY[1].slice(0,3).toLowerCase()];
    if (mcny) {
      var ycny = _inferYearForBooking();
      return { start: ycny + "-" + mcny + "-" + pad(compactNY[2]), end: ycny + "-" + mcny + "-" + pad(compactNY[3]) };
    }
  }
  // Expanded no-year cross-month: "Dec 28 - Jan 3" → end is in year+1.
  var expandedNY = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]+)\s+(\d{1,2})\s*$/);
  if (expandedNY) {
    var m1ny = months[expandedNY[1].slice(0,3).toLowerCase()];
    var m2ny = months[expandedNY[3].slice(0,3).toLowerCase()];
    if (m1ny && m2ny) {
      var yny = _inferYearForBooking();
      var endYr = yny;
      if (parseInt(m2ny, 10) < parseInt(m1ny, 10)) {
        endYr = String(parseInt(yny, 10) + 1);
      }
      return {
        start: yny   + "-" + m1ny + "-" + pad(expandedNY[2]),
        end:   endYr + "-" + m2ny + "-" + pad(expandedNY[4])
      };
    }
  }
  return null;
}

// Belt-and-braces normalizer: even when the LLM ignores the prompt
// and returns its own shape (destination/accommodation/checkIn/total/
// etc.), map the common variant keys to our canonical schema so the
// preview modal gets useful data. Any truly canonical key already
// present takes precedence — this only fills gaps.
function _normalizeBookingExtraction(p) {
  if (!p || typeof p !== "object") return p;
  var out = Object.assign({}, p);
  function pick(canonical, aliases) {
    if (out[canonical] != null && out[canonical] !== "") return;
    for (var i = 0; i < aliases.length; i++) {
      var v = out[aliases[i]];
      if (v != null && v !== "") { out[canonical] = v; return; }
    }
  }
  // v359.60.91: date normalizer. LLMs frequently return "June 2,
  // 2026" or "06/02/2026" instead of the ISO YYYY-MM-DD the form's
  // <input type="date"> requires. Parse anything Date.parse() can
  // chew, then format to ISO. If parsing fails, leave the raw
  // value alone so it surfaces to the user instead of getting
  // silently zeroed out.
  function _isoDate(v) {
    if (v == null || v === "") return v;
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
    var t = Date.parse(s);
    if (isNaN(t)) return v; // unrecognized — leave raw
    var d = new Date(t);
    var yyyy = d.getUTCFullYear();
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(d.getUTCDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
  // v359.60.91: time normalizer. Convert "7:30 AM" / "7:30am" /
  // "6:00 PM" to 24-hour "HH:MM". Pass through anything already
  // in HH:MM. Leave un-parseable values alone.
  function _isoTime(v) {
    if (v == null || v === "") return v;
    var s = String(v).trim();
    if (/^\d{2}:\d{2}$/.test(s)) return s; // already 24h
    var m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/i);
    if (!m) return v;
    var h = parseInt(m[1], 10);
    var min = m[2];
    var ampm = (m[3] || "").toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return String(h).padStart(2, "0") + ":" + min;
  }
  // v359.60.91: car-rental aliases. LLM frequently invents its own
  // schema for rentals — trip_type: 'rental_car', pickup_location,
  // dropoff_location, travel_dates: {start, end}, rental_company,
  // etc. Catch the most common drift patterns here so the form
  // gets pre-filled even when the LLM ignores the canonical schema.
  // Flatten nested travel_dates first so the date picks below find them.
  if (p.travel_dates && typeof p.travel_dates === "object") {
    var td = p.travel_dates;
    if (!out.depDate) out.depDate = td.start || td.startDate || td.start_date || td.pickup || td.pickupDate || td.pickup_date || td.from;
    if (!out.arrDate) out.arrDate = td.end || td.endDate || td.end_date || td.dropoff || td.dropoffDate || td.dropoff_date || td.return || td.returnDate || td.return_date || td.to;
  }
  if (p.dates && typeof p.dates === "object") {
    if (!out.depDate) out.depDate = p.dates.start || p.dates.startDate || p.dates.start_date || p.dates.from;
    if (!out.arrDate) out.arrDate = p.dates.end || p.dates.endDate || p.dates.end_date || p.dates.to;
  }
  if (p.pickup && typeof p.pickup === "object") {
    if (!out.from)     out.from     = p.pickup.location || p.pickup.airport || p.pickup.city;
    if (!out.depDate)  out.depDate  = p.pickup.date;
    if (!out.depTime)  out.depTime  = p.pickup.time;
  }
  if ((p.dropoff || p.return || p.returnDetails) && typeof (p.dropoff || p.return || p.returnDetails) === "object") {
    var dpo = p.dropoff || p.return || p.returnDetails;
    if (!out.to)       out.to       = dpo.location || dpo.airport || dpo.city;
    if (!out.arrDate)  out.arrDate  = dpo.date;
    if (!out.arrTime)  out.arrTime  = dpo.time;
  }
  // Normalize trip_type → type, and map any rental-car-ish value to "car".
  if (!out.type && (p.trip_type || p.bookingType || p.booking_type)) {
    out.type = p.trip_type || p.bookingType || p.booking_type;
  }
  if (out.type) {
    var typeStr = String(out.type).toLowerCase().replace(/[_-]/g, "");
    // v359.60.91 (b): broaden the car-equivalent matcher. LLMs use
    // a zoo of names for rentals — self_drive, car_rental, rental,
    // carhire, vehicle_rental, drive_yourself, self-drive — all of
    // these mean "car rental" in our schema.
    if (/^(rentalcar|car|carrental|selfdrive|carhire|vehiclerental|drivecourself|driveyourself|rental|hire)$/.test(typeStr)) out.type = "car";
  }
  pick("name",       ["accommodation", "hotel", "hotelName", "property", "propertyName", "venue", "restaurantName", "tourName", "ticketName"]);
  pick("carrier",    ["airline", "operator", "company", "provider", "rentalCompany", "rental_company", "vendor", "rentalAgency", "rental_agency", "rentalProvider"]);
  pick("number",     ["flightNumber", "flight", "trainNumber", "train", "busNumber", "ferryNumber", "pnr", "reference"]);
  pick("address",    ["location", "destination", "venueAddress", "hotelAddress", "fullAddress"]);
  pick("from",       ["origin", "departureCity", "departureAirport", "fromCity", "fromAirport", "pickupLocation", "pickup_location", "pickup_airport", "pickupAirport", "pickup_address"]);
  pick("to",         ["destinationCity", "arrivalAirport", "toCity", "toAirport", "dropoffLocation", "dropoff_location", "returnLocation", "return_location", "dropoffAirport", "dropoff_airport"]);
  pick("depDate",    ["checkIn", "checkInDate", "checkin", "departureDate", "departure", "startDate", "date", "pickupDate", "pickup_date", "pickup_start"]);
  pick("depTime",    ["checkInTime", "departureTime", "startTime", "time", "pickupTime", "pickup_time"]);
  pick("arrDate",    ["checkOut", "checkOutDate", "checkout", "arrivalDate", "arrival", "endDate", "dropoffDate", "dropoff_date", "returnDate", "return_date"]);
  pick("arrTime",    ["checkOutTime", "arrivalTime", "endTime", "dropoffTime", "dropoff_time", "returnTime", "return_time"]);
  // v359.60.91: coerce non-ISO date / time values to the format
  // <input type="date">/<input type="time"> requires. Without this,
  // "June 2, 2026" silently gets rejected by the date picker and
  // the user sees an empty field even though the LLM extracted it.
  out.depDate = _isoDate(out.depDate);
  out.arrDate = _isoDate(out.arrDate);
  out.depTime = _isoTime(out.depTime);
  out.arrTime = _isoTime(out.arrTime);
  out.cancelDeadline = _isoDate(out.cancelDeadline);
  // (price normalizer moved to bottom of function — see below)
  // If depTime/arrTime came back as a range string ("3:00 PM - 10:00 PM"),
  // collapse to a single time. Check-in uses the START of the range
  // (when the room opens up); check-out uses the END (the deadline).
  if (out.depTime && /[-–—]/.test(String(out.depTime))) {
    var dt = _parseTimeRange(out.depTime, "start");
    if (dt) out.depTime = dt;
  }
  if (out.arrTime && /[-–—]/.test(String(out.arrTime))) {
    var at = _parseTimeRange(out.arrTime, "end");
    if (at) out.arrTime = at;
  }
  pick("confirmationNumber", ["confirmation", "confirmationCode", "confirmation_code", "confirmation_number", "bookingNumber", "booking_number", "bookingReference", "booking_reference", "reservationNumber", "reservation_number", "reservationCode", "reservation_code", "bookingId", "booking_id", "code"]);
  pick("price",      ["total", "total_cost", "total_amount", "totalPrice", "total_price", "totalCost", "amount", "amount_paid", "amountPaid", "pricePaid", "price_paid", "cost"]);
  pick("currency",   ["currencyCode", "currencySymbol"]);
  pick("url",        ["bookingUrl", "managementUrl", "link", "href", "manageBooking", "manageReservation", "viewReservation"]);
  pick("notes",      ["description", "details", "additionalInfo", "remarks"]);
  pick("cancelType", ["cancellationType", "cancellation", "cancelPolicy", "cancellationPolicy", "refundPolicy"]);
  pick("cancelDeadline",     ["cancelBy", "cancellationDeadline", "freeCancellationUntil", "refundDeadline"]);
  // cancelDeadlineTime intentionally not normalized — we don't
  // capture deadline times anymore (timezone confusion outweighs
  // the value). Field stays in the schema for legacy data only.
  // Normalize cancelType to one of the canonical values our save
  // path accepts: "deadline" or "non-cancellable" (or null).
  if (out.cancelType) {
    var ct = String(out.cancelType).toLowerCase();
    if (/non.?refund|non.?cancel|no.?cancel|no.?refund/.test(ct)) out.cancelType = "non-cancellable";
    else if (/free|deadline|until|by/.test(ct) || out.cancelDeadline) out.cancelType = "deadline";
    else out.cancelType = null;
  } else if (out.cancelDeadline) {
    out.cancelType = "deadline";
  }
  // If the LLM jammed multiple things into a 'dates' string like
  // "October 2-5, 2026", attempt to parse it into proper depDate /
  // arrDate. Common patterns we handle:
  //   "October 2-5, 2026"
  //   "October 2 - October 5, 2026"
  //   "Oct 2 - Oct 5, 2026"
  //   "10/2/2026 - 10/5/2026"
  //   "2026-10-02 to 2026-10-05"
  // Fallback if we can't parse: surface via notes so the info isn't lost.
  if (!out.depDate && typeof p.dates === "string") {
    var parsed = _parseDateRangeString(p.dates);
    if (parsed) {
      if (!out.depDate) out.depDate = parsed.start;
      if (!out.arrDate) out.arrDate = parsed.end;
    } else {
      out.notes = (out.notes ? out.notes + " · " : "") + "Dates: " + p.dates;
    }
  }
  if (typeof p.travelers === "string") {
    out.notes = (out.notes ? out.notes + " · " : "") + p.travelers;
  }
  if (typeof p.duration === "string" && !out.notes) {
    out.notes = p.duration;
  }
  // Type detection: many alt schemas don't include type at all.
  // v359.60.91: 'car' detection runs FIRST so a rental confirmation
  // ("Hertz pickup at Keflavík Airport") isn't auto-misclassified as
  // 'flight' just because it mentions an airport. Car-rental brand
  // names and rental-specific vocabulary are the strongest signal.
  if (!out.type || out.type === "unknown") {
    var _pJson = JSON.stringify(p);
    if (/\b(hertz|sixt|avis|enterprise|budget|alamo|national|thrifty|dollar|europcar|sicily by car|blue car rental|hertz rental|car rental|rental car|rent.{0,3}a.{0,3}car|pickup.*car|return.*car)\b/i.test(_pJson)) out.type = "car";
    else if (out.from || out.to || out.number || /flight|airline|airport/i.test(_pJson)) out.type = "flight";
    else if (out.address || out.arrDate || /hotel|check.?in|check.?out|nights|room/i.test(_pJson)) out.type = "hotel";
    else if (/restaurant|reservation.*table|dinner|lunch/i.test(_pJson)) out.type = "restaurant";
    else out.type = "hotel";
  }
  // Currency normalization: turn symbols into ISO codes.
  if (out.currency === "$") out.currency = "USD";
  else if (out.currency === "€") out.currency = "EUR";
  else if (out.currency === "£") out.currency = "GBP";
  else if (out.currency === "¥") out.currency = "JPY";

  // v359.60.91 (b): price normalizer. LLM frequently returns price
  // as a string with the currency embedded ("USD 612.50", "$612.50",
  // "€586.50"). HTML5 number input refuses to display these because
  // they aren't pure numbers. Split currency from value: populate
  // `currency` if missing, set `price` to the numeric part.
  // Lives at the END of the function so no later code can re-shadow
  // it back to a string.
  console.log("[normalizer] price before:", out.price, "type:", typeof out.price);
  if (out.price != null && typeof out.price !== "number") {
    var rawPriceStr = String(out.price).trim();
    var priceCcyMatch = rawPriceStr.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|ISK|CHF|CNY|INR|MXN|BRL|KRW|SEK|NOK|DKK|PLN|CZK|HUF|RUB|TRY|ZAR|SGD|HKD|NZD)\b/i);
    if (priceCcyMatch && !out.currency) {
      out.currency = priceCcyMatch[1].toUpperCase();
    }
    if (!out.currency) {
      if (/\$/.test(rawPriceStr)) out.currency = "USD";
      else if (/€/.test(rawPriceStr)) out.currency = "EUR";
      else if (/£/.test(rawPriceStr)) out.currency = "GBP";
      else if (/¥/.test(rawPriceStr)) out.currency = "JPY";
    }
    var priceNumMatch = rawPriceStr.match(/[\d,]+\.?\d*/);
    if (priceNumMatch) {
      var priceN = parseFloat(priceNumMatch[0].replace(/,/g, ""));
      out.price = isFinite(priceN) ? priceN : null;
    } else {
      out.price = null;
    }
    console.log("[normalizer] price after:", out.price, "currency:", out.currency);
  }

  return out;
}

// Score how well a parsed booking matches a destination. Returns
// 0..3: 1 point for place-name match (any 3+ char token from the
// booking's address/from/to substrings into dest.place or dest.label),
// 1 point for date overlap (booking date falls within dest.dateFrom
// .. dest.dateTo, inclusive), 1 point if BOTH match (a tiebreaker
// boost so a pure date-only match doesn't win over a place+date match).
function _scoreDestMatch(p, dest) {
  if (!dest) return 0;
  var score = 0;
  // v359.60.39: diacritic-aware normalization so "Myvatn" (booking
  // address) matches "Mývatn" (destination place). Previous version
  // lowercased but didn't strip diacritics, so any address that
  // dropped the accent didn't token-match.
  function _norm(s) {
    return String(s||"")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  // Place match — token-by-token substring. We tokenize the booking's
  // address (and from/to for transport) to catch "340 Stykkishólmur,
  // Iceland" matching dest.place "Stykkishólmur".
  var bookingPlaceText = _norm([p.address, p.from, p.to, p.name]
    .filter(function(s){ return s; })
    .join(" "));
  var destPlaceText = _norm((dest.place || "") + " " + (dest.label || ""));
  if (bookingPlaceText && destPlaceText) {
    // Tokenize on non-alphanumeric, keep tokens >= 3 chars (skip "in",
    // "at", country codes that'd give too many false positives).
    var tokens = bookingPlaceText.split(/[^a-z0-9]+/i).filter(function(t){ return t.length >= 3; });
    var matched = false;
    for (var i = 0; i < tokens.length; i++) {
      if (destPlaceText.indexOf(tokens[i]) >= 0) { matched = true; break; }
    }
    if (matched) score++;
  }
  // Date match — does any booking date fall within dest's range?
  var bookingDates = [p.depDate, p.arrDate].filter(function(d){ return d; });
  if (bookingDates.length && dest.dateFrom && dest.dateTo) {
    var df = dest.dateFrom; // "YYYY-MM-DD" string compares correctly lex.
    var dt = dest.dateTo;
    for (var j = 0; j < bookingDates.length; j++) {
      var bd = bookingDates[j];
      if (bd >= df && bd <= dt) { score++; break; }
    }
  }
  if (score === 2) score++; // place AND date match → tiebreaker boost
  return score;
}

// v359.60.39: date-proximity score for routing fallback. When
// _scoreDestMatch returns 0 for every destination (booking address
// isn't any dest's name, dates don't overlap any dest's range), we
// still want to pick the GEOGRAPHICALLY/TEMPORALLY closest destination
// rather than blindly defaulting to dest[0]. Returns a smaller value
// for "closer" destinations (minimum days between booking depDate
// and the dest's nearest stay date). Falls back to Infinity when
// the booking has no date.
function _proximityDestScore(p, dest) {
  if (!dest || !dest.dateFrom) return Infinity;
  var bd = p.depDate || p.arrDate || null;
  if (!bd) return Infinity;
  var bdMs = new Date(bd + "T12:00:00").getTime();
  var dfMs = new Date(dest.dateFrom + "T12:00:00").getTime();
  var dtMs = new Date((dest.dateTo || dest.dateFrom) + "T12:00:00").getTime();
  if (isNaN(bdMs) || isNaN(dfMs)) return Infinity;
  if (bdMs >= dfMs && bdMs <= dtMs) return 0; // inside the range
  return Math.min(Math.abs(bdMs - dfMs), Math.abs(bdMs - dtMs)) / 86400000;
}
if (typeof globalThis !== "undefined") globalThis._proximityDestScore = _proximityDestScore;

// Preview modal — editable form keyed by detected type. User can
// override the type via a dropdown if the LLM guessed wrong.
function _showBookingPreviewModal(destId, p, originalText) {
  var dest = (typeof getDest === "function") ? getDest(destId) : null;
  if (!dest) return;
  // v353.6: pick the best-matching destination based on the parsed
  // booking's address + dates. If a different destination matches
  // better than the current one, pre-select it (the user clicked
  // Paste from the wrong tab) — and show a warning. If no destination
  // matches at all, show a different warning.
  var allDests = (trip && trip.destinations) || [];
  var matchScores = allDests.map(function(d){ return { dest: d, score: _scoreDestMatch(p, d) }; });
  var bestMatch = matchScores.slice().sort(function(a,b){ return b.score - a.score; })[0];
  var initialDestId = (bestMatch && bestMatch.score > 0) ? bestMatch.dest.id : destId;
  var noMatchAtAll = !bestMatch || bestMatch.score === 0;
  var routedAway = !noMatchAtAll && initialDestId !== destId;
  var ov = document.createElement("div");
  ov.id = "paste-confirm-preview-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:600px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);";

  // Determine arrival vs departure for transport types based on date
  // proximity to the destination's stay window.
  var isTransport = (p.type === "flight" || p.type === "train" || p.type === "bus" || p.type === "ferry");
  var defaultDirection = "arrival";
  if (isTransport && p.depDate && dest.dateFrom && dest.dateTo) {
    var msFrom = Math.abs(new Date(p.depDate + "T12:00:00") - new Date(dest.dateFrom + "T12:00:00"));
    var msTo = Math.abs(new Date(p.depDate + "T12:00:00") - new Date(dest.dateTo + "T12:00:00"));
    if (msTo < msFrom) defaultDirection = "departure";
  }

  function inp(id, label, value, placeholder, type) {
    return '<label style="display:block;margin-bottom:8px;">' +
      '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || "text") + '" value="' + (value == null ? "" : String(value).replace(/"/g, "&quot;")) + '" placeholder="' + (placeholder || "") + '" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
      '</label>';
  }

  // v359.60.91: 'car' added for car-rental bookings. Cars don't fit
  // the destination-anchored or leg-anchored shapes the other types
  // use — pickup and dropoff are independent locations with their
  // own dates/times. Car rentals save to trip.tripBookings[] (a
  // top-level array introduced in v359.60.91) and surface in the
  // trip-level Bookings section, not under a single destination.
  var typeOptions = ["flight","hotel","car","train","bus","ferry","restaurant","tour","ticket"];
  // v359.60.43: type dropdown gets an explicit hint that changing
  // it swaps the field set. Previously the user had no signal that
  // an LLM mis-classification (Marriott confirmation # looks flight-
  // shaped → typed as Flight) could be fixed by flipping this one
  // dropdown, so they'd hit "no way to enter a hotel name."
  var typeSelHtml = '<label style="display:block;margin-bottom:8px;">' +
    '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Type</span>' +
    '<select id="pcfp-type" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;background:var(--c-bg);">' +
    typeOptions.map(function(t){ return '<option value="' + t + '"' + (t === p.type ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>'; }).join("") +
    '</select>' +
    '<span style="display:block;font-size:10.5px;color:var(--c-ink-3);margin-top:3px;line-height:1.4;">Change this if Max guessed wrong — the fields below swap to match the type.</span>' +
    '</label>';

  var directionHtml = '';
  if (isTransport) {
    directionHtml =
      '<div id="pcfp-direction-wrap" style="margin-bottom:8px;padding:8px 10px;background:#f7f9fc;border:1px solid #e2e7ee;border-radius:5px;">' +
        '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">This trip is</span>' +
        '<label style="font-size:12px;margin-right:14px;cursor:pointer;"><input type="radio" name="pcfp-dir" value="arrival"' + (defaultDirection === "arrival" ? " checked" : "") + ' style="margin-right:4px;"/>Arriving at ' + (dest.place || "this destination") + '</label>' +
        '<label style="font-size:12px;cursor:pointer;"><input type="radio" name="pcfp-dir" value="departure"' + (defaultDirection === "departure" ? " checked" : "") + ' style="margin-right:4px;"/>Departing from ' + (dest.place || "this destination") + '</label>' +
      '</div>';
  }

  // Destination dropdown — every dest on the trip, with the
  // best-matching one (by date+place score) pre-selected.
  var destSelHtml = '<label style="display:block;margin-bottom:8px;">' +
    '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Destination</span>' +
    '<select id="pcfp-dest" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;background:var(--c-bg);">' +
    allDests.map(function(d){
      var lbl = (d.place || d.label || "Untitled");
      if (d.dateFrom && d.dateTo) lbl += " (" + d.dateFrom + " → " + d.dateTo + ")";
      return '<option value="' + d.id + '"' + (d.id === initialDestId ? ' selected' : '') + '>' + lbl.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</option>';
    }).join("") +
    '</select></label>';

  // Warning banner — "this looks like it belongs somewhere else" or
  // "no match found at all". Both cases nudge the user without
  // blocking the save (they may have a legitimate reason).
  var warningHtml = '';
  if (noMatchAtAll) {
    warningHtml =
      '<div id="pcfp-warning" style="margin:0 0 10px;padding:9px 11px;background:#fff3cd;border:1px solid #f1d77a;border-radius:5px;font-size:11px;color:#7a5800;line-height:1.5;">' +
        '<b>Heads up:</b> the booking\'s dates and location don\'t match any destination on this trip. Double-check the destination dropdown above before saving.' +
      '</div>';
  } else if (routedAway) {
    var matchedDest = bestMatch.dest;
    warningHtml =
      '<div id="pcfp-warning" style="margin:0 0 10px;padding:9px 11px;background:#dcebf8;border:1px solid #a4c7ec;border-radius:5px;font-size:11px;color:#154774;line-height:1.5;">' +
        '<b>Routed to ' + (matchedDest.place || matchedDest.label || "another destination").replace(/&/g,"&amp;").replace(/</g,"&lt;") + '.</b> The booking\'s dates and location match it better than ' + (dest.place || "where you clicked").replace(/&/g,"&amp;").replace(/</g,"&lt;") + '. Change the destination dropdown above if Max guessed wrong.' +
      '</div>';
  }

  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--c-see);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">✓</div>' +
      '<div style="font-size:14px;font-weight:700;">Review extracted details</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:14px;">Edit anything Max got wrong, then save. Empty fields stay empty — you can fill them in later.</div>' +
    destSelHtml +
    warningHtml +
    typeSelHtml +
    directionHtml +
    '<div id="pcfp-fields"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">' +
      '<button id="pcfp-back" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">← Back</button>' +
      '<button id="pcfp-save" style="padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Save</button>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  var typeSel = document.getElementById("pcfp-type");
  var fieldsHost = document.getElementById("pcfp-fields");

  function renderFields(){
    var t = typeSel.value;
    var html = '';
    if (t === "hotel") {
      html += inp("pcfp-name", "Hotel name", p.name || p.carrier || "", "e.g. Reykjavik Konsulat");
      html += inp("pcfp-address", "Address", p.address || "", "Optional");
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-checkin", "Check-in date", p.depDate || "", "", "date") +
        inp("pcfp-checkin-time", "Check-in time", p.depTime || "", "", "time") +
        '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-checkout", "Check-out date", p.arrDate || "", "", "date") +
        inp("pcfp-checkout-time", "Check-out time", p.arrTime || "", "", "time") +
        '</div>';
    } else if (t === "flight") {
      // v360.0.1: multi-leg flight UI. The form starts with one leg
      // block; user can add more via "+ Add a missing or new leg." If the LLM
      // returned p.legs[], render those; otherwise render a single
      // leg from the flat p.carrier/from/to/depDate/etc. fields.
      // Save logic detects >1 leg → trip.tripBookings with kind:"flight"
      // + legs[]; single leg → existing leg.bookings path.
      html += '<div id="pcfp-legs-host"></div>';
      html += '<div style="margin:4px 0 8px;">' +
        '<button type="button" id="pcfp-add-leg" style="padding:5px 11px;font-size:11.5px;font-weight:600;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:4px;cursor:pointer;font-family:inherit;">+ Add a missing or new leg</button>' +
      '</div>';
    } else if (t === "train" || t === "bus" || t === "ferry") {
      // Trains, buses, ferries stay single-segment for v1. Multi-leg
      // trains exist (e.g., Eurail itineraries) but are rare enough
      // that the simpler shape pays for itself.
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-carrier", "Operator", p.carrier || "", "") +
        inp("pcfp-number", "Number", p.number || "", "") +
        '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-from", "From", p.from || "", "City or code") +
        inp("pcfp-to", "To", p.to || "", "City or code") +
        '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-dep-date", "Departure date", p.depDate || "", "", "date") +
        inp("pcfp-dep-time", "Departure time", p.depTime || "", "", "time") +
        '</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-arr-date", "Arrival date", p.arrDate || "", "", "date") +
        inp("pcfp-arr-time", "Arrival time", p.arrTime || "", "", "time") +
        '</div>';
    } else if (t === "car") {
      // v359.60.91: car-rental fields. Distinct shape from other
      // booking types — pickup and dropoff locations can differ
      // (one-way rentals), and the rental spans multiple days so
      // both endpoints carry their own date+time. Vendor (Hertz,
      // Avis, Sixt, Enterprise, …) is captured but optional;
      // vehicle (Compact SUV, 4×4 with snow tires, …) is captured
      // as a free-text Notes field within the form, so we don't
      // over-constrain.
      //
      // Field-reading is intentionally lenient: the LLM sometimes
      // routes vendor name to `name`, location to `address`, etc.
      // We pull from every reasonable source so an LLM mis-mapping
      // doesn't leave the user staring at an empty form.
      html += inp("pcfp-vendor", "Rental company", p.carrier || p.name || "", "e.g. Hertz, Sixt, Blue Car Rental");
      html += '<div style="margin:6px 0 4px;padding:8px 10px;background:#f4f8f4;border:1px solid #d4e3d4;border-radius:5px;">' +
        '<div style="font-size:10px;font-weight:700;color:#2a6a3e;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Pickup</div>' +
        inp("pcfp-pickup-loc", "Location", p.from || p.address || "", "e.g. Keflavík Airport") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("pcfp-pickup-date", "Date", p.depDate || "", "", "date") +
          inp("pcfp-pickup-time", "Time", p.depTime || "", "", "time") +
        '</div>' +
      '</div>';
      html += '<div style="margin:0 0 8px;padding:8px 10px;background:#f8f4f4;border:1px solid #e3d4d4;border-radius:5px;">' +
        '<div style="font-size:10px;font-weight:700;color:#7a4040;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Dropoff</div>' +
        inp("pcfp-dropoff-loc", "Location", p.to || p.from || p.address || "", "Same as pickup, or different airport / city") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("pcfp-dropoff-date", "Date", p.arrDate || "", "", "date") +
          inp("pcfp-dropoff-time", "Time", p.arrTime || "", "", "time") +
        '</div>' +
      '</div>';
    } else {
      // restaurant / tour / ticket / other
      html += inp("pcfp-name", "Name", p.name || p.carrier || "", "e.g. Dinner at Dill");
      html += inp("pcfp-address", "Location", p.address || "", "Optional");
      html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
        inp("pcfp-date", "Date", p.depDate || "", "", "date") +
        inp("pcfp-time", "Start time", p.depTime || "", "", "time") +
        inp("pcfp-time-end", "End time", p.arrTime || "", "", "time") +
        '</div>';
    }
    // Universal fields
    // v359.60.91 (b): price uses type="text" instead of "number" so
    // we can preserve trailing zeros (612.50 not 612.5). Pattern +
    // inputmode keep it numeric while letting us format as currency.
    var priceDisplay = (p.price != null && p.price !== "")
      ? (typeof p.price === "number" ? p.price.toFixed(2) : String(p.price))
      : "";
    html += '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;">' +
      inp("pcfp-conf", "Confirmation #", p.confirmationNumber || "", "") +
      '<label style="display:block;margin-bottom:8px;">' +
        '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Price paid</span>' +
        '<input id="pcfp-price" type="text" inputmode="decimal" pattern="[0-9]+(\\.[0-9]+)?" value="' + priceDisplay + '" placeholder="" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
      '</label>' +
      inp("pcfp-currency", "Currency", p.currency || "", "USD") +
      '</div>';
    // Booking URL with an inline "↗ Open" button — saves the user
    // from selecting and copying the long management URL just to
    // try the link. Disabled when the field is empty; re-enabled
    // live as the user types or pastes.
    html += '<label style="display:block;margin-bottom:8px;">' +
      '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Booking URL</span>' +
      '<div style="display:flex;gap:6px;align-items:stretch;">' +
        '<input id="pcfp-url" type="url" value="' + (p.url == null ? "" : String(p.url).replace(/"/g, "&quot;")) + '" placeholder="https://…" style="flex:1;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;min-width:0;" />' +
        '<button type="button" id="pcfp-url-open" title="Open this link in a new tab" style="padding:0 12px;font-size:11.5px;font-weight:600;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:4px;cursor:pointer;font-family:inherit;flex-shrink:0;white-space:nowrap;">↗ Open</button>' +
      '</div>' +
    '</label>';
    // Cancellation policy block — date-only.
    //
    // We deliberately don't capture deadline time. Property-local
    // vs user-local time zones, ambiguous AM/PM in raw confirmation
    // text, and the rarity of cases where minute-precision actually
    // matters made the time field more confusing than useful.
    // Already-saved bookings that have a cancelDeadlineTime keep it
    // for display elsewhere; we just stop asking for it on new entries.
    var ctVal = p.cancelType || "";
    html += '<div style="margin-top:6px;padding:8px 10px;background:#fff8e6;border:1px solid #f1d77a;border-radius:5px;">' +
      '<div style="font-size:10px;font-weight:700;color:#a06d00;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;">Cancellation policy</div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin-bottom:6px;">' +
        '<label style="cursor:pointer;"><input type="radio" name="pcfp-ctype" value="deadline"' + (ctVal === "deadline" ? " checked" : "") + ' style="margin-right:4px;"/>Cancel by date</label>' +
        '<label style="cursor:pointer;"><input type="radio" name="pcfp-ctype" value="non-cancellable"' + (ctVal === "non-cancellable" ? " checked" : "") + ' style="margin-right:4px;"/>Non-cancellable</label>' +
        '<label style="cursor:pointer;"><input type="radio" name="pcfp-ctype" value=""' + (!ctVal ? " checked" : "") + ' style="margin-right:4px;"/>Unknown</label>' +
      '</div>' +
      '<div id="pcfp-cdeadline-wrap" style="display:' + (ctVal === "deadline" ? "block" : "none") + ';">' +
        inp("pcfp-cancel-date", "Cancel by", p.cancelDeadline || "", "", "date") +
      '</div>' +
    '</div>';
    html += inp("pcfp-notes", "Notes", p.notes || "", "Optional");
    fieldsHost.innerHTML = html;
    // Toggle the deadline date visibility based on the radio.
    var ctRadios = document.querySelectorAll('input[name="pcfp-ctype"]');
    var cwrap = document.getElementById("pcfp-cdeadline-wrap");
    ctRadios.forEach(function(r){ r.onchange = function(){
      if (cwrap && r.checked) cwrap.style.display = r.value === "deadline" ? "block" : "none";
    };});

    // Booking URL: live-toggle the Open button's disabled state, and
    // wire its click to open the (current, possibly user-edited) URL
    // in a new tab. We re-bind every time renderFields runs because
    // the type-switch dropdown rebuilds the DOM.
    var urlInput = document.getElementById("pcfp-url");
    var urlBtn = document.getElementById("pcfp-url-open");
    function _refreshUrlBtn(){
      if (!urlInput || !urlBtn) return;
      var v = (urlInput.value || "").trim();
      var ok = /^https?:\/\//i.test(v);
      urlBtn.disabled = !ok;
      urlBtn.style.opacity = ok ? "1" : "0.4";
      urlBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }
    if (urlInput) urlInput.oninput = _refreshUrlBtn;
    if (urlBtn) {
      urlBtn.onclick = function(){
        if (!urlInput) return;
        var v = (urlInput.value || "").trim();
        if (/^https?:\/\//i.test(v)) {
          window.open(v, "_blank", "noopener,noreferrer");
        }
      };
    }
    _refreshUrlBtn();
  }
  // v360.0.1: multi-leg flight helpers. Each leg is rendered into
  // #pcfp-legs-host with its own ID-suffixed inputs (pcfp-leg-N-from,
  // etc.). Save reads them in DOM order. Add/Remove buttons mutate
  // the host live without re-rendering the whole form.
  var _legCounter = 0;
  function _addLegBlock(prefill) {
    var legsHost = document.getElementById("pcfp-legs-host");
    if (!legsHost) return;
    _legCounter += 1;
    var idx = _legCounter;
    var pre = prefill || {};
    var legDiv = document.createElement("div");
    legDiv.className = "pcfp-leg";
    legDiv.setAttribute("data-leg-idx", String(idx));
    legDiv.style.cssText = "margin:6px 0;padding:8px 10px;background:#f5f8fc;border:1px solid #d4e0f0;border-radius:5px;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;";
    var hdrL = document.createElement("div");
    hdrL.style.cssText = "font-size:10px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;";
    hdrL.textContent = "Leg " + idx;
    var hdrR = document.createElement("button");
    hdrR.type = "button";
    hdrR.textContent = "✕ remove";
    hdrR.style.cssText = "background:none;border:none;color:#c44;font-size:10.5px;cursor:pointer;padding:0;font-family:inherit;";
    hdrR.onclick = function(){ legDiv.parentNode.removeChild(legDiv); _renumberLegs(); };
    hdr.appendChild(hdrL);
    hdr.appendChild(hdrR);
    legDiv.appendChild(hdr);
    // Field rows: airline/number, from/to, dep date/time, arr date/time
    var inner = document.createElement("div");
    var sfx = "leg-" + idx + "-";
    inner.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-" + sfx + "carrier", "Airline", pre.carrier || "", "") +
        inp("pcfp-" + sfx + "number",  "Flight #", pre.flightNumber || pre.number || "", "") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-" + sfx + "from", "From", pre.from || "", "City or code") +
        inp("pcfp-" + sfx + "to",   "To",   pre.to   || "", "City or code") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-" + sfx + "dep-date", "Departure date", pre.depDate || "", "", "date") +
        inp("pcfp-" + sfx + "dep-time", "Departure time", pre.depTime || "", "", "time") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp("pcfp-" + sfx + "arr-date", "Arrival date", pre.arrDate || "", "", "date") +
        inp("pcfp-" + sfx + "arr-time", "Arrival time", pre.arrTime || "", "", "time") +
      '</div>';
    legDiv.appendChild(inner);
    legsHost.appendChild(legDiv);
  }
  // After a leg is removed, re-number remaining legs visually so
  // the user sees Leg 1, 2, 3 — not 1, 3 with a gap.
  function _renumberLegs() {
    var blocks = document.querySelectorAll(".pcfp-leg");
    blocks.forEach(function(b, i){
      var lbl = b.querySelector("div > div");
      if (lbl) lbl.textContent = "Leg " + (i + 1);
    });
  }
  // Initial population for the flight branch. Called from renderFields
  // by way of _ensureFlightLegs() right after innerHTML is set.
  function _ensureFlightLegs() {
    var legsHost = document.getElementById("pcfp-legs-host");
    if (!legsHost) return; // not a flight render
    legsHost.innerHTML = "";
    _legCounter = 0;
    if (Array.isArray(p.legs) && p.legs.length) {
      p.legs.forEach(function(lg){ _addLegBlock(lg); });
    } else {
      // Single-leg from flat fields.
      _addLegBlock({
        carrier:      p.carrier || "",
        flightNumber: p.number  || "",
        from:         p.from    || "",
        to:           p.to      || "",
        depDate:      p.depDate || "",
        depTime:      p.depTime || "",
        arrDate:      p.arrDate || "",
        arrTime:      p.arrTime || "",
      });
    }
    var addBtn = document.getElementById("pcfp-add-leg");
    if (addBtn) addBtn.onclick = function(){ _addLegBlock({}); };
  }

  renderFields();
  _ensureFlightLegs();
  // v359.60.91: when type switches to 'car', hide the
  // destination-mismatch warning + destination dropdown. Cars are
  // trip-level — they don't anchor to a single destination — so the
  // "doesn't match any destination" nudge is misleading. Same logic
  // will extend to multi-leg flights in Phase 1b.
  function _toggleTripLevelChrome() {
    var isTripLevel = (typeSel.value === "car");
    var warn = document.getElementById("pcfp-warning");
    if (warn) warn.style.display = isTripLevel ? "none" : "";
    // Look destSel up live — it's defined later in the parent
    // function, so on the very first call it isn't ready yet.
    var liveDestSel = document.getElementById("pcfp-dest");
    var destLabel = liveDestSel ? liveDestSel.closest("label") : null;
    if (destLabel) destLabel.style.display = isTripLevel ? "none" : "";
    var dirWrap = document.getElementById("pcfp-direction-wrap");
    if (dirWrap) dirWrap.style.display = isTripLevel ? "none" : "";
  }
  _toggleTripLevelChrome();
  typeSel.onchange = function(){ renderFields(); _ensureFlightLegs(); _toggleTripLevelChrome(); };

  document.getElementById("pcfp-back").onclick = function(){
    ov.remove();
    showPasteConfirmationModal(destId);
    // Restore the textarea content so the user can re-edit and re-parse.
    var ta = document.getElementById("pcf-input");
    if (ta) ta.value = originalText || "";
  };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  // Live-update the warning banner when the user changes the
  // destination dropdown. They might pick the right dest after Max
  // guessed wrong (warning should clear), or they might pick one
  // Max didn't suggest (warning should turn yellow).
  var destSel = document.getElementById("pcfp-dest");
  if (destSel) {
    destSel.onchange = function(){
      var chosen = getDest(destSel.value);
      var w = document.getElementById("pcfp-warning");
      if (!chosen) return;
      var s = _scoreDestMatch(p, chosen);
      if (s === 0) {
        if (!w) {
          var holder = destSel.closest("label").parentNode;
          w = document.createElement("div");
          w.id = "pcfp-warning";
          holder.insertBefore(w, destSel.closest("label").nextSibling);
        }
        w.style.cssText = "margin:0 0 10px;padding:9px 11px;background:#fff3cd;border:1px solid #f1d77a;border-radius:5px;font-size:11px;color:#7a5800;line-height:1.5;";
        w.innerHTML = "<b>Heads up:</b> the booking’s dates and location don’t match this destination. Save anyway only if you know it belongs here.";
      } else if (w) {
        w.parentNode.removeChild(w);
      }
    };
  }

  document.getElementById("pcfp-save").onclick = function(){
    var t = typeSel.value;
    var v = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    var num = function(s){ var n = parseFloat(s); return isFinite(n) ? n : null; };
    // Use whichever destination the user selected from the dropdown,
    // not the one they originally clicked Paste on. This is the whole
    // point of the verification — let the user route to the right place.
    var chosenDestId = destSel ? destSel.value : destId;
    var freshDest = getDest(chosenDestId);
    if (!freshDest) { maxAlert("Destination is gone — close this and reopen the booking dialog."); return; }
    // Read cancellation policy from the radio + date input.
    // cancelDeadlineTime is intentionally always null on new entries
    // — see preview-modal comment about timezone confusion.
    var ctEl = document.querySelector('input[name="pcfp-ctype"]:checked');
    var cancelType = ctEl ? ctEl.value : "";
    var cancelDeadline = cancelType === "deadline" ? (v("pcfp-cancel-date") || null) : null;
    var cancelDeadlineTime = null;
    if (!cancelType) cancelType = "unknown"; // keeps schema consistent with manual-entry path

    if (t === "hotel") {
      if (!freshDest.hotelBookings) freshDest.hotelBookings = [];
      freshDest.hotelBookings.push({
        id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
        name: v("pcfp-name") || "Untitled hotel",
        area: "",
        checkIn: v("pcfp-checkin") || null,
        checkInTime: v("pcfp-checkin-time") || null,
        checkOut: v("pcfp-checkout") || null,
        checkOutTime: v("pcfp-checkout-time") || null,
        confirmationNumber: v("pcfp-conf"),
        pricePaid: num(v("pcfp-price")),
        currency: v("pcfp-currency") || "USD",
        notes: v("pcfp-notes") + (v("pcfp-address") ? "\nAddress: " + v("pcfp-address") : ""),
        url: v("pcfp-url") || null,
        status: "booked",
        source: "paste",
        cancelType: cancelType,
        cancelDeadline: cancelDeadline,
        cancelDeadlineTime: cancelDeadlineTime,
        lat: null,
        lng: null,
      });
    } else if (t === "flight") {
      // v360.0.1: flight save with multi-leg support. Collect every
      // leg block in the form; route the result based on count:
      //   - 0 legs → bail (shouldn't happen, but defensive)
      //   - 1 leg → existing single-leg paths (entry/exit/legBookings)
      //   - 2+ legs → trip.tripBookings as kind:"flight" with legs[]
      var legs = [];
      document.querySelectorAll(".pcfp-leg").forEach(function(b){
        var idx = b.getAttribute("data-leg-idx");
        var sfx = "leg-" + idx + "-";
        legs.push({
          carrier:      v("pcfp-" + sfx + "carrier"),
          flightNumber: v("pcfp-" + sfx + "number"),
          from:         v("pcfp-" + sfx + "from"),
          to:           v("pcfp-" + sfx + "to"),
          depDate:      v("pcfp-" + sfx + "dep-date") || null,
          depTime:      v("pcfp-" + sfx + "dep-time") || null,
          arrDate:      v("pcfp-" + sfx + "arr-date") || null,
          arrTime:      v("pcfp-" + sfx + "arr-time") || null,
        });
      });
      if (!legs.length) {
        maxAlert("Add at least one leg before saving the flight.");
        return;
      }
      if (legs.length > 1) {
        // Multi-leg → trip.tripBookings.
        if (!trip.tripBookings) trip.tripBookings = [];
        trip.tripBookings.push({
          id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
          kind: "flight",
          legs: legs,
          confirmationNumber: v("pcfp-conf"),
          pricePaid: num(v("pcfp-price")),
          currency: v("pcfp-currency") || "USD",
          notes: v("pcfp-notes") || "",
          url: v("pcfp-url") || null,
          status: "booked",
          source: "paste",
          cancelType: cancelType,
          cancelDeadline: cancelDeadline,
          cancelDeadlineTime: cancelDeadlineTime,
        });
        if (typeof autoSave === "function") try { autoSave(); } catch(_){}
        if (typeof _emitTripMutation === "function") try { _emitTripMutation(); } catch(_){}
        if (typeof showSaveStatus === "function") showSaveStatus("✓ Multi-leg flight saved", 2800);
        if (typeof drawTripMode === "function") drawTripMode();
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        return;
      }
      // Single-leg flight → existing entryDetails/exitDetails/leg.bookings
      // paths. Read the values from the one leg we have.
      var L = legs[0];
      var dirEl = document.querySelector('input[name="pcfp-dir"]:checked');
      var direction = dirEl ? dirEl.value : "arrival";
      var destIdx = trip.destinations.indexOf(freshDest);
      if (direction === "arrival" && destIdx <= 0) {
        if (!trip.brief) trip.brief = {};
        trip.brief.entryDetails = {
          carrier: L.carrier || "",
          number:  L.flightNumber || "",
          time:    L.arrTime || L.depTime || "",
          url:     v("pcfp-url") || null,
          confirmationNumber: v("pcfp-conf") || ""
        };
        if (!trip.brief.entryMode) trip.brief.entryMode = "fly";
        if (!trip.brief.entry) trip.brief.entry = freshDest.place || "";
        if (typeof autoSave === "function") try { autoSave(); } catch(_){}
        if (typeof drawTripMode === "function") drawTripMode();
        if (typeof showSaveStatus === "function") showSaveStatus("✓ Arrival saved to trip entry", 2800);
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        return;
      }
      if (direction === "departure" && destIdx >= trip.destinations.length - 1) {
        if (!trip.brief) trip.brief = {};
        trip.brief.exitDetails = {
          carrier: L.carrier || "",
          number:  L.flightNumber || "",
          time:    L.depTime || "",
          url:     v("pcfp-url") || null,
          confirmationNumber: v("pcfp-conf") || ""
        };
        if (!trip.brief.exitMode) trip.brief.exitMode = "fly";
        if (!trip.brief.tbExit) trip.brief.tbExit = freshDest.place || "";
        if (typeof autoSave === "function") try { autoSave(); } catch(_){}
        if (typeof drawTripMode === "function") drawTripMode();
        if (typeof showSaveStatus === "function") showSaveStatus("✓ Departure saved to trip exit", 2800);
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        return;
      }
      var fromId, toId;
      if (direction === "arrival") {
        fromId = trip.destinations[destIdx - 1].id;
        toId = freshDest.id;
      } else {
        fromId = freshDest.id;
        toId = trip.destinations[destIdx + 1].id;
      }
      var leg = (typeof getLeg === "function") ? getLeg(fromId, toId) : null;
      if (!leg) { maxAlert("Couldn't find the transport leg. Try saving manually from the Routing tab."); return; }
      if (!leg.bookings) leg.bookings = [];
      leg.bookings.push({
        id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
        mode: "flight",
        operator: L.carrier || "",
        from: L.from || "",
        to: L.to || "",
        departure: L.depDate || null,
        departureTime: L.depTime || null,
        arrival: L.arrDate || null,
        arrivalTime: L.arrTime || null,
        confirmationNumber: v("pcfp-conf"),
        pricePaid: num(v("pcfp-price")),
        currency: v("pcfp-currency") || "USD",
        notes: v("pcfp-notes") + (L.flightNumber ? "\nFlight " + L.flightNumber : ""),
        url: v("pcfp-url") || null,
        status: "booked",
        source: "paste",
        cancelType: cancelType,
        cancelDeadline: cancelDeadline,
        cancelDeadlineTime: cancelDeadlineTime,
      });
    } else if (t === "train" || t === "bus" || t === "ferry") {
      // Trains, buses, ferries stay on the single-segment path —
      // multi-leg support not warranted for v1. But we DO still need
      // to handle the "arrival at first destination" / "departure
      // from last destination" cases by routing to entryDetails /
      // exitDetails (mirrors the flight single-leg behavior).
      var dirEl2 = document.querySelector('input[name="pcfp-dir"]:checked');
      var direction2 = dirEl2 ? dirEl2.value : "arrival";
      var destIdx2 = trip.destinations.indexOf(freshDest);
      if (direction2 === "arrival" && destIdx2 <= 0) {
        if (!trip.brief) trip.brief = {};
        trip.brief.entryDetails = {
          carrier: v("pcfp-carrier") || "",
          number:  v("pcfp-number")  || "",
          time:    v("pcfp-arr-time") || v("pcfp-dep-time") || "",
          url:     v("pcfp-url")     || null,
          confirmationNumber: v("pcfp-conf") || ""
        };
        if (!trip.brief.entryMode) trip.brief.entryMode = t;
        if (!trip.brief.entry) trip.brief.entry = freshDest.place || "";
        if (typeof autoSave === "function") try { autoSave(); } catch(_){}
        if (typeof drawTripMode === "function") drawTripMode();
        if (typeof showSaveStatus === "function") showSaveStatus("✓ Arrival saved to trip entry", 2800);
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        return;
      }
      if (direction2 === "departure" && destIdx2 >= trip.destinations.length - 1) {
        if (!trip.brief) trip.brief = {};
        trip.brief.exitDetails = {
          carrier: v("pcfp-carrier") || "",
          number:  v("pcfp-number")  || "",
          time:    v("pcfp-dep-time") || "",
          url:     v("pcfp-url")     || null,
          confirmationNumber: v("pcfp-conf") || ""
        };
        if (!trip.brief.exitMode) trip.brief.exitMode = t;
        if (!trip.brief.tbExit) trip.brief.tbExit = freshDest.place || "";
        if (typeof autoSave === "function") try { autoSave(); } catch(_){}
        if (typeof drawTripMode === "function") drawTripMode();
        if (typeof showSaveStatus === "function") showSaveStatus("✓ Departure saved to trip exit", 2800);
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        return;
      }
      var fromId2, toId2;
      if (direction2 === "arrival") {
        fromId2 = trip.destinations[destIdx2 - 1].id; toId2 = freshDest.id;
      } else {
        fromId2 = freshDest.id; toId2 = trip.destinations[destIdx2 + 1].id;
      }
      var leg2 = (typeof getLeg === "function") ? getLeg(fromId2, toId2) : null;
      if (!leg2) { maxAlert("Couldn't find the transport leg."); return; }
      if (!leg2.bookings) leg2.bookings = [];
      leg2.bookings.push({
        id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
        mode: t,
        operator: v("pcfp-carrier") || "",
        from: v("pcfp-from") || "",
        to: v("pcfp-to") || "",
        departure: v("pcfp-dep-date") || null,
        departureTime: v("pcfp-dep-time") || null,
        arrival: v("pcfp-arr-date") || null,
        arrivalTime: v("pcfp-arr-time") || null,
        confirmationNumber: v("pcfp-conf"),
        pricePaid: num(v("pcfp-price")),
        currency: v("pcfp-currency") || "USD",
        notes: v("pcfp-notes") + (v("pcfp-number") ? "\n" + v("pcfp-number") : ""),
        url: v("pcfp-url") || null,
        status: "booked",
        source: "paste",
        cancelType: cancelType,
        cancelDeadline: cancelDeadline,
        cancelDeadlineTime: cancelDeadlineTime,
      });
    } else if (t === "car") {
      // v359.60.91: car-rental save path. Goes to trip.tripBookings[]
      // (top-level, not destination-scoped) because pickup and dropoff
      // can be at different destinations and the rental spans the days
      // in between. Trip-level Bookings section is the surface; per-
      // destination Bookings tabs can cross-reference by location later.
      // Returns early after save so the post-block doesn't try to
      // re-draw a destination view (this booking has no anchor dest).
      if (!trip.tripBookings) trip.tripBookings = [];
      trip.tripBookings.push({
        id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
        kind: "car",
        vendor: v("pcfp-vendor") || "",
        pickup: {
          location: v("pcfp-pickup-loc") || "",
          date: v("pcfp-pickup-date") || null,
          time: v("pcfp-pickup-time") || null,
        },
        dropoff: {
          location: v("pcfp-dropoff-loc") || v("pcfp-pickup-loc") || "",
          date: v("pcfp-dropoff-date") || null,
          time: v("pcfp-dropoff-time") || null,
        },
        confirmationNumber: v("pcfp-conf"),
        pricePaid: num(v("pcfp-price")),
        currency: v("pcfp-currency") || "USD",
        notes: v("pcfp-notes") || "",
        url: v("pcfp-url") || null,
        status: "booked",
        source: "paste",
        cancelType: cancelType,
        cancelDeadline: cancelDeadline,
        cancelDeadlineTime: cancelDeadlineTime,
      });
      if (typeof autoSave === "function") try { autoSave(); } catch(_){}
      if (typeof _emitTripMutation === "function") try { _emitTripMutation(); } catch(_){}
      if (typeof showSaveStatus === "function") showSaveStatus("✓ Car rental saved", 2800);
      if (typeof drawTripMode === "function") drawTripMode();
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
      return;
    } else {
      // restaurant / tour / ticket / other → generalBookings
      if (!freshDest.generalBookings) freshDest.generalBookings = [];
      freshDest.generalBookings.push({
        id: (typeof newBkId === "function" ? newBkId() : "bk-" + Date.now()),
        type: t,
        label: v("pcfp-name") || "Untitled booking",
        date: v("pcfp-date") || null,
        time: v("pcfp-time") || null,
        timeEnd: v("pcfp-time-end") || null,
        confirmationNumber: v("pcfp-conf"),
        pricePaid: num(v("pcfp-price")),
        currency: v("pcfp-currency") || "USD",
        notes: v("pcfp-notes") + (v("pcfp-address") ? "\nLocation: " + v("pcfp-address") : ""),
        url: v("pcfp-url") || null,
        status: "booked",
        source: "paste",
        cancelType: cancelType,
        cancelDeadline: cancelDeadline,
        cancelDeadlineTime: cancelDeadlineTime,
      });
    }
    if (typeof autoSave === "function") autoSave();
    if (typeof _emitTripMutation === "function") _emitTripMutation();
    ov.remove();
    if (typeof drawDestMode === "function") drawDestMode(freshDest.id);
  };
}

// v359.60.91 (b): edit modal for trip-level bookings. Opens a small
// form populated with the booking's current values so the user can
// fix anything the LLM missed (or fill in fields manually). On save,
// updates the same record in trip.tripBookings — does NOT create a
// new one. Wired to the ✎ edit button rendered in trip-ui.js by
// MaxTripUI.renderTripLevelBookings.
function _editTripBooking(bookingId) {
  if (!trip || !Array.isArray(trip.tripBookings)) return;
  var idx = trip.tripBookings.findIndex(function(b){ return b.id === bookingId; });
  if (idx < 0) return;
  var bk = trip.tripBookings[idx];

  var ov = document.createElement("div");
  ov.id = "tripbk-edit-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:600px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.25);";

  function inp(id, label, value, placeholder, type) {
    return '<label style="display:block;margin-bottom:8px;">' +
      '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">' + label + '</span>' +
      '<input id="' + id + '" type="' + (type || "text") + '" value="' + (value == null ? "" : String(value).replace(/"/g, "&quot;")) + '" placeholder="' + (placeholder || "") + '" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
      '</label>';
  }

  var kindLabel = (bk.kind === "car") ? "Car rental" :
                  (bk.kind === "flight") ? "Flight" : "Booking";

  var fieldsHtml = '';
  if (bk.kind === "car") {
    var pu = bk.pickup || {};
    var dpo = bk.dropoff || {};
    fieldsHtml +=
      inp("tbe-vendor", "Rental company", bk.vendor || "", "e.g. Hertz, Sixt, Blue Car Rental") +
      '<div style="margin:6px 0 4px;padding:8px 10px;background:#f4f8f4;border:1px solid #d4e3d4;border-radius:5px;">' +
        '<div style="font-size:10px;font-weight:700;color:#2a6a3e;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Pickup</div>' +
        inp("tbe-pu-loc", "Location", pu.location, "e.g. Keflavík Airport") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("tbe-pu-date", "Date", pu.date, "", "date") +
          inp("tbe-pu-time", "Time", pu.time, "", "time") +
        '</div>' +
      '</div>' +
      '<div style="margin:0 0 8px;padding:8px 10px;background:#f8f4f4;border:1px solid #e3d4d4;border-radius:5px;">' +
        '<div style="font-size:10px;font-weight:700;color:#7a4040;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Dropoff</div>' +
        inp("tbe-do-loc", "Location", dpo.location || pu.location, "Same as pickup, or different airport / city") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
          inp("tbe-do-date", "Date", dpo.date, "", "date") +
          inp("tbe-do-time", "Time", dpo.time, "", "time") +
        '</div>' +
      '</div>';
  } else if (bk.kind === "flight") {
    // v360.0.1 (Phase 1b): flight legs editor. Each leg has its own
    // input block; the user can add/remove legs to fix what the LLM
    // missed. Saves back to bk.legs[] on Save (handler below).
    var legsArr = Array.isArray(bk.legs) ? bk.legs : [];
    if (!legsArr.length) {
      legsArr = [{}]; // empty starter row if no legs (shouldn't happen)
    }
    fieldsHtml += '<div id="tbe-legs-host"></div>';
    fieldsHtml += '<div style="margin:4px 0 8px;">' +
      '<button type="button" id="tbe-add-leg" style="padding:5px 11px;font-size:11.5px;font-weight:600;background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);border-radius:4px;cursor:pointer;font-family:inherit;">+ Add a missing or new leg</button>' +
    '</div>';
    // We'll populate the legs-host after innerHTML is set, below.
  } else {
    fieldsHtml += '<div style="padding:10px;background:#fff8ed;border:1px solid #f0dcc0;border-radius:6px;font-size:11.5px;color:#5c4520;">No edit UI for this booking type yet. ✕ Remove and re-paste if changes are needed.</div>';
  }

  // v359.60.91 (b): same text-input + .toFixed(2) treatment as the
  // paste-confirmation modal so trailing zeros survive (612.50 ≠ 612.5
  // visually for currency).
  var tbeBkPriceDisplay = (bk.pricePaid != null && bk.pricePaid !== "")
    ? (typeof bk.pricePaid === "number" ? bk.pricePaid.toFixed(2) : String(bk.pricePaid))
    : "";
  fieldsHtml +=
    '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;">' +
      inp("tbe-conf", "Confirmation #", bk.confirmationNumber, "") +
      '<label style="display:block;margin-bottom:8px;">' +
        '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Price paid</span>' +
        '<input id="tbe-price" type="text" inputmode="decimal" pattern="[0-9]+(\\.[0-9]+)?" value="' + tbeBkPriceDisplay + '" placeholder="" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
      '</label>' +
      inp("tbe-currency", "Currency", bk.currency || "USD", "USD") +
    '</div>' +
    '<label style="display:block;margin-bottom:8px;">' +
      '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">Booking URL</span>' +
      '<input id="tbe-url" type="url" value="' + (bk.url || "").replace(/"/g, "&quot;") + '" placeholder="https://…" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
    '</label>' +
    inp("tbe-notes", "Notes", bk.notes, "Optional — vehicle class, drop-off fee, etc.");

  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--c-primary);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;">▸</div>' +
      '<div style="font-size:14px;font-weight:700;">' + kindLabel + ' details</div>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--c-ink-2);line-height:1.55;margin-bottom:14px;">Everything Max has on this booking. Change anything that\'s wrong or missing, then save.</div>' +
    fieldsHtml +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">' +
      '<button id="tbe-cancel" style="padding:8px 14px;font-size:12px;font-weight:600;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:5px;cursor:pointer;font-family:inherit;">Cancel</button>' +
      '<button id="tbe-save" style="padding:8px 16px;font-size:12px;font-weight:700;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Save</button>' +
    '</div>';
  ov.appendChild(box);
  document.body.appendChild(ov);

  function _v(id){ var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function _num(s){ var n = parseFloat(s); return isFinite(n) ? n : null; }

  // v360.0.1: leg-block builders for the flight edit modal. Mirror
  // of the paste-confirmation flow's legs UI — same fields, different
  // ID prefix (tbe-* vs pcfp-*) so the two modals can coexist.
  var _tbeLegCounter = 0;
  function _tbeBuildLegInputHtml(idx, pre) {
    var sfx = "leg-" + idx + "-";
    function inp2(id, label, value, placeholder, type) {
      return '<label style="display:block;margin-bottom:8px;">' +
        '<span style="display:block;font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:2px;">' + label + '</span>' +
        '<input id="' + id + '" type="' + (type || "text") + '" value="' + (value == null ? "" : String(value).replace(/"/g, "&quot;")) + '" placeholder="' + (placeholder || "") + '" style="width:100%;padding:6px 9px;font-size:12px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;" />' +
        '</label>';
    }
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp2("tbe-" + sfx + "carrier", "Airline", pre.carrier || "", "") +
        inp2("tbe-" + sfx + "number",  "Flight #", pre.flightNumber || pre.number || "", "") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp2("tbe-" + sfx + "from", "From", pre.from || "", "City or code") +
        inp2("tbe-" + sfx + "to",   "To",   pre.to   || "", "City or code") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp2("tbe-" + sfx + "dep-date", "Departure date", pre.depDate || "", "", "date") +
        inp2("tbe-" + sfx + "dep-time", "Departure time", pre.depTime || "", "", "time") +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
        inp2("tbe-" + sfx + "arr-date", "Arrival date", pre.arrDate || "", "", "date") +
        inp2("tbe-" + sfx + "arr-time", "Arrival time", pre.arrTime || "", "", "time") +
      '</div>';
  }
  function _tbeAddLegBlock(pre) {
    var host = document.getElementById("tbe-legs-host");
    if (!host) return;
    _tbeLegCounter += 1;
    var idx = _tbeLegCounter;
    var div = document.createElement("div");
    div.className = "tbe-leg";
    div.setAttribute("data-leg-idx", String(idx));
    div.style.cssText = "margin:6px 0;padding:8px 10px;background:#f5f8fc;border:1px solid #d4e0f0;border-radius:5px;";
    div.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">' +
        '<div style="font-size:10px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.05em;">Leg ' + idx + '</div>' +
        '<button type="button" class="tbe-leg-remove" style="background:none;border:none;color:#c44;font-size:10.5px;cursor:pointer;padding:0;font-family:inherit;">✕ remove</button>' +
      '</div>' +
      _tbeBuildLegInputHtml(idx, pre || {});
    host.appendChild(div);
    div.querySelector(".tbe-leg-remove").onclick = function(){
      div.parentNode.removeChild(div);
      // Renumber visible labels.
      document.querySelectorAll(".tbe-leg").forEach(function(b, i){
        var lbl = b.querySelector("div > div");
        if (lbl) lbl.textContent = "Leg " + (i + 1);
      });
    };
  }
  if (bk.kind === "flight") {
    var initLegs = Array.isArray(bk.legs) && bk.legs.length ? bk.legs : [{}];
    initLegs.forEach(function(lg){ _tbeAddLegBlock(lg); });
    var addBtn = document.getElementById("tbe-add-leg");
    if (addBtn) addBtn.onclick = function(){ _tbeAddLegBlock({}); };
  }

  document.getElementById("tbe-cancel").onclick = function(){ ov.remove(); };
  ov.addEventListener("click", function(e){ if (e.target === ov) ov.remove(); });

  document.getElementById("tbe-save").onclick = function(){
    if (bk.kind === "car") {
      bk.vendor = _v("tbe-vendor");
      bk.pickup = {
        location: _v("tbe-pu-loc"),
        date: _v("tbe-pu-date") || null,
        time: _v("tbe-pu-time") || null,
      };
      bk.dropoff = {
        location: _v("tbe-do-loc") || _v("tbe-pu-loc"),
        date: _v("tbe-do-date") || null,
        time: _v("tbe-do-time") || null,
      };
    } else if (bk.kind === "flight") {
      // v360.0.1: collect leg blocks back into bk.legs[]. Reads
      // suffix-keyed inputs in DOM order so leg sequence matches
      // what the user arranged.
      var newLegs = [];
      document.querySelectorAll(".tbe-leg").forEach(function(b){
        var lidx = b.getAttribute("data-leg-idx");
        var sfx = "leg-" + lidx + "-";
        newLegs.push({
          carrier:      _v("tbe-" + sfx + "carrier"),
          flightNumber: _v("tbe-" + sfx + "number"),
          from:         _v("tbe-" + sfx + "from"),
          to:           _v("tbe-" + sfx + "to"),
          depDate:      _v("tbe-" + sfx + "dep-date") || null,
          depTime:      _v("tbe-" + sfx + "dep-time") || null,
          arrDate:      _v("tbe-" + sfx + "arr-date") || null,
          arrTime:      _v("tbe-" + sfx + "arr-time") || null,
        });
      });
      bk.legs = newLegs;
    }
    bk.confirmationNumber = _v("tbe-conf");
    bk.pricePaid = _num(_v("tbe-price"));
    bk.currency = _v("tbe-currency") || "USD";
    bk.url = _v("tbe-url") || null;
    bk.notes = _v("tbe-notes");
    trip.tripBookings[idx] = bk;
    if (typeof autoSave === "function") try { autoSave(); } catch(_){}
    if (typeof _emitTripMutation === "function") try { _emitTripMutation(); } catch(_){}
    if (typeof showSaveStatus === "function") showSaveStatus("✓ Booking updated", 2400);
    if (typeof drawTripMode === "function") drawTripMode();
    ov.remove();
  };
}
if (typeof globalThis !== "undefined") globalThis._editTripBooking = _editTripBooking;
