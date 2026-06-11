// features-trip.js — Tracker, trip-name editing, spend tracking,
// general bookings, misc data, and on-demand routing fetch. Extracted
// verbatim from index.html (PD.451, bloat reduction). Declaration-only
// global functions, invoked at runtime; loaded after
// features-conversation.js. The boot-time window-exposure block stays
// at the end of index.html's inline script (it must run AFTER all defs).

// ── Tracker ────────────────────────────────────────────────
// Round FJ: reorganized into two clearly-labeled temporal sections —
// "Coming up" (forward-facing: to-dos, bookings, want to see) and
// "Trip diary" (history: visited, spend total). The old Booked /
// Want to see / Visited sub-tab navigation is gone; everything is
// inline so the user can scan the whole tab without clicking
// through nav layers. The tab itself was renamed Tracker → Tracking
// (live, ongoing) to better fit the temporal split.
function mkTrackerInner(dest, opts){
  // v359.60.63: opts.skipTitle suppresses the "What you need to take
  // care of for {Place}" header so the same content can render inline
  // under the banner on the destination card (which already shows the
  // same title) without duplicating it.
  opts = opts || {};
  var wrap=document.createElement("div");

  // Paste-confirmation flow lives at the trip-view header now (📋
  // Paste). Per-destination paste was removed in v353.6 once the
  // preview modal's destination dropdown + verification could
  // auto-route bookings — the per-dest button was giving false
  // implication of routing-by-context that the parser doesn't
  // actually need.

  // ============================================================
  // ACTION NEEDED — provider actions + cancellation deadlines for
  // THIS destination, ordered chronologically. v359.60.62: title now
  // reads "What you need to take care of for {Place}" so the user
  // knows immediately what this surface is for.
  // ============================================================
  var futureSec=document.createElement("div"); futureSec.className="tk-major-section";
  if (!opts.skipTitle) {
    var futureHdr=document.createElement("div"); futureHdr.className="tk-major-hdr";
    futureHdr.textContent="What you need to take care of for " + (dest.label || dest.place);
    futureSec.appendChild(futureHdr);
  }

  // ── Pending Actions section ─────────────────────────────
  // v359.60.59: scope to THIS destination. Showing the trip-wide pending
  // list on every per-destination card was the heart of why the old
  // "On the ground" tab felt wrong — you'd see the Reykjavík card
  // listing actions tied to Vík. Now each destination shows only its
  // own actions. Trip-wide aggregate lives at the trip view.
  var _trkDestName = (dest.label || dest.place || "").toLowerCase();
  var openActions=(trip.pendingActions||[]).filter(function(a){
    if (a.cleared || !a.requiresProviderAction) return false;
    var actDest = (a.destName || "").toLowerCase();
    return actDest === _trkDestName;
  });
  if(openActions.length>0){
    var actSec=document.createElement("div"); actSec.className="tk-section";
    var actHdr=document.createElement("div"); actHdr.style.cssText="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";
    var actLbl=document.createElement("div"); actLbl.className="tk-section-lbl"; actLbl.style.color="#e05050"; actLbl.textContent="Provider action needed";
    var actEmail=document.createElement("button"); actEmail.className="bk-log-btn"; actEmail.textContent="\u2709 Email list";
    actEmail.onclick=function(){openMailtoActions();};
    actHdr.appendChild(actLbl); actHdr.appendChild(actEmail);
    actSec.appendChild(actHdr);
    openActions.forEach(function(a){
      var row=document.createElement("div"); row.className="tk-action-item";
      var check=document.createElement("div"); check.className="tk-action-check";
      check.title="Mark as done";
      (function(action){check.onclick=function(){
        clearPendingAction(action.id);
        row.classList.add("cleared");
        check.classList.add("done"); check.textContent="\u2713";
        var typEl=row.querySelector(".tk-action-type"); if(typEl)typEl.classList.add("cleared");
        // v359.60.60: badge lives on dm-tab-actionNeeded.
        var badge=g("dm-tab-actionNeeded")&&g("dm-tab-actionNeeded").querySelector(".dm-tab-badge");
        if(badge){var n=pendingCount();if(n>0)badge.textContent=n;else badge.parentNode&&badge.parentNode.removeChild(badge);}
      };})(a);
      var body=document.createElement("div"); body.className="tk-action-body";
      var typeEl=document.createElement("div"); typeEl.className="tk-action-type";
      var eventTypeLabel=({hotel:'Hotel',transport:'Transport',booking:'Booking',restaurant:'Restaurant'})[a.eventType]||a.eventType;
      typeEl.textContent=a.actionType+' — '+eventTypeLabel;
      var nameEl=document.createElement("div"); nameEl.className="tk-action-name"; nameEl.textContent=a.eventName;
      var destEl=document.createElement("div"); destEl.className="tk-action-detail"; destEl.textContent=a.destName;
      body.appendChild(typeEl); body.appendChild(nameEl);
      if(a.destName) body.appendChild(destEl);
      if(a.confirmationNumber){
        var confEl=document.createElement("div"); confEl.className="tk-action-conf"; confEl.textContent="Conf: "+a.confirmationNumber;
        body.appendChild(confEl);
      }
      if(a.detail){
        var detEl=document.createElement("div"); detEl.className="tk-action-detail"; detEl.textContent=a.detail;
        body.appendChild(detEl);
      }
      row.appendChild(check); row.appendChild(body);
      actSec.appendChild(row);
    });
    futureSec.appendChild(actSec);
  }

  // ── Cancellation Deadlines section ─────────────────────────
  var deadlines=collectDeadlines(dest);
  if(deadlines.length>0){
    var dlSec=document.createElement("div"); dlSec.className="tk-section tk-deadlines";
    var dlLbl=document.createElement("div"); dlLbl.className="tk-section-lbl"; dlLbl.textContent="Cancellation deadlines";
    dlSec.appendChild(dlLbl);
    var today=new Date(); today.setHours(0,0,0,0);
    var in7=new Date(today); in7.setDate(today.getDate()+7);
    deadlines.forEach(function(d){
      var row=document.createElement("div"); row.className="tk-deadline-item";
      var deadDate=new Date(d.deadline+'T12:00:00');
      var isUrgent=deadDate<=today;
      var isSoon=!isUrgent&&deadDate<=in7;
      var dateLbl=document.createElement("div"); dateLbl.className="tk-deadline-date"+(isUrgent?' urgent':isSoon?' soon':'');
      dateLbl.textContent=isUrgent?'PAST':(fmtD(d.deadline)+(d.deadlineTime?' '+d.deadlineTime:''));
      var body=document.createElement("div"); body.className="tk-deadline-body";
      var name=document.createElement("div"); name.className="tk-deadline-name"; name.textContent=d.name;
      var destLbl=document.createElement("div"); destLbl.className="tk-deadline-dest"; destLbl.textContent=d.destName+' \u00b7 '+d.type;
      body.appendChild(name); body.appendChild(destLbl);
      // Round FN.6: Cancel booking action directly from the deadline row.
      // Previously the user had to navigate to Tracker \u2192 Bookings \u2192 Hotels
      // (or Transport, or Activities) \u2192 find the matching record \u2192 click
      // Cancel booking. Now one-click from the deadline entry \u2014 same flow,
      // same provider-action cascade, just routed by booking id+type.
      var cancelBtn=document.createElement("button");
      cancelBtn.className="bk-rec-btn danger";
      cancelBtn.style.cssText="font-size:10px;padding:3px 8px;margin-left:auto;align-self:center;";
      cancelBtn.textContent="Cancel booking";
      (function(deadlineRow){cancelBtn.onclick=function(){
        var conf=confirm("Mark this "+deadlineRow.type.toLowerCase()+" booking as cancelled in Max?\n\nRemember: you must also contact the provider directly to cancel your reservation.");
        if(!conf)return;
        var targetDest=getDest(deadlineRow.destId);
        if(deadlineRow.type==='Hotel'){
          var hb=(targetDest&&targetDest.hotelBookings||[]).find(function(b){return b.id===deadlineRow.id;});
          if(hb){
            hb.status='cancelled';
            addPendingAction({eventType:'hotel',actionType:'Contact provider to adjust or cancel',
              eventName:hb.name,destName:targetDest.label||targetDest.place,
              confirmationNumber:hb.confirmationNumber||null,
              detail:'Contact hotel to cancel reservation'+(hb.cancelDeadline?' \u2014 cancel by '+fmtD(hb.cancelDeadline)+(hb.cancelDeadlineTime?' at '+hb.cancelDeadlineTime:''):''),
              requiresProviderAction:true});
          }
        } else if(deadlineRow.type==='Activity'){
          var gb=(targetDest&&targetDest.generalBookings||[]).find(function(b){return b.id===deadlineRow.id;});
          if(gb){
            gb.status='cancelled';
            addPendingAction({eventType:'booking',actionType:'Contact provider to adjust or cancel',
              eventName:gb.label||gb.type||'Booking',destName:targetDest.label||targetDest.place,
              confirmationNumber:gb.confirmationNumber||null,
              detail:'Contact provider to cancel'+(gb.date?' \u2014 booked for '+fmtD(gb.date):''),
              requiresProviderAction:true});
          }
        } else if(deadlineRow.type==='Transport'){
          var leg=trip.legs&&trip.legs[deadlineRow.fromId+'-'+deadlineRow.toId];
          var tb=leg&&(leg.bookings||[]).find(function(b){return b.id===deadlineRow.id;});
          if(tb){
            tb.status='cancelled';
            var fromDest=getDest(deadlineRow.fromId);
            var toDest=getDest(deadlineRow.toId);
            addPendingAction({eventType:'transport',actionType:'Contact provider to adjust or cancel',
              eventName:tb.operator||'Transport',
              destName:(fromDest?fromDest.label||fromDest.place:'')+(toDest?' \u2192 '+(toDest.label||toDest.place):''),
              confirmationNumber:tb.confirmationNumber||null,
              detail:'Contact provider to cancel'+(tb.departure?' \u2014 departs '+fmtD(tb.departure):''),
              requiresProviderAction:true});
          }
        }
        autoSave();
        if(activeDest&&typeof drawDestMode==='function') drawDestMode(activeDest);
      };})(d);
      row.appendChild(dateLbl); row.appendChild(body); row.appendChild(cancelBtn); dlSec.appendChild(row);
    });
    futureSec.appendChild(dlSec);
  }

  // v359.60.60: empty state when this destination has nothing
  // outstanding. Without this the section header sat above an
  // empty pane and read as broken; now it reassures the user.
  if (openActions.length === 0 && deadlines.length === 0) {
    var emptyAct = document.createElement("div");
    emptyAct.className = "tk-empty";
    emptyAct.style.cssText = "padding:10px 12px;background:#f7faf7;border:1px solid #d8e8d8;border-radius:6px;font-size:11.5px;color:#588a58;line-height:1.5;margin-bottom:14px;";
    emptyAct.textContent = "Nothing needs your attention here right now. Cancellation deadlines and provider actions for " + (dest.label || dest.place) + " will surface as they come up.";
    futureSec.appendChild(emptyAct);
  }

  // v359.60.62: Action needed tab is now only the two action sections
  // above. The legacy Bookings list (Hotels / Transport / Activities &
  // other), the Want to see brainstorm, the Trip diary / Visited
  // history, the cumulative Spend total, and the per-destination Ask
  // Max row used to render here as leftover from the old Tracker tab —
  // none are action items. Hotel bookings already render on the Stay
  // & Eat tab; transport bookings on the routing surface under On the
  // ground; the Ask Max input is duplicated at the bottom of every
  // destination card. The Want to see / Visited / Activities & other
  // lists are dropped pending a follow-up home. Code below this point
  // still runs (it appends to local divs) but the divs are never
  // attached to wrap, so nothing reaches the DOM.
  wrap.appendChild(futureSec);
  return wrap;
  // Unreachable from here on — preserved to keep DOM ids /
  // event-handler shapes intact for any external callers.
  // eslint-disable-next-line no-unreachable
  var bookedDiv=document.createElement("div");

  // Hotels section
  var hSec=document.createElement("div"); hSec.className="tk-section"; hSec.id="tk-hotels-"+dest.id;
  var hLbl=document.createElement("div"); hLbl.className="tk-subsection-lbl"; hLbl.textContent="Hotels";
  hSec.appendChild(hLbl);
  if(dest.hotelBookings.length===0){
    var he=document.createElement("div"); he.className="tk-empty"; he.textContent="No hotel bookings yet \u2014 log one from the Stay tab.";
    hSec.appendChild(he);
  } else {
    dest.hotelBookings.forEach(function(b){hSec.appendChild(mkHotelRecord(b,dest.id));});
  }
  bookedDiv.appendChild(hSec);

  // Transport section
  var hasTransport=false;
  Object.keys(trip.legs).forEach(function(k){
    var leg=trip.legs[k];
    if((leg.fromId===dest.id||leg.toId===dest.id)&&leg.bookings.length>0) hasTransport=true;
  });
  var tSec=document.createElement("div"); tSec.className="tk-section"; tSec.id="tk-transport-"+dest.id;
  var tLbl=document.createElement("div"); tLbl.className="tk-subsection-lbl"; tLbl.textContent="Transport";
  tSec.appendChild(tLbl);
  if(!hasTransport){
    var te=document.createElement("div"); te.className="tk-empty"; te.textContent="No transport bookings yet \u2014 log one from the Routing tab.";
    tSec.appendChild(te);
  } else {
    Object.keys(trip.legs).forEach(function(k){
      var leg=trip.legs[k];
      if(leg.fromId!==dest.id&&leg.toId!==dest.id)return;
      leg.bookings.forEach(function(b){tSec.appendChild(mkTransportRecord(b,leg.fromId,leg.toId));});
    });
  }
  bookedDiv.appendChild(tSec);

  // General bookings section
  var gSec=document.createElement("div"); gSec.className="tk-section";
  var gLbl=document.createElement("div"); gLbl.className="tk-subsection-lbl"; gLbl.textContent="Activities \u0026 other";
  gSec.appendChild(gLbl);
  var gFormId="gbf-"+dest.id;
  dest.generalBookings.forEach(function(b){gSec.appendChild(mkGeneralRecord(b,dest.id));});
  var gAddBtn=document.createElement("button"); gAddBtn.className="bk-log-btn"; gAddBtn.textContent="+ Book";
  (function(btn,sec,did){btn.onclick=function(){toggleGeneralForm(btn,sec,gFormId,did);};})(gAddBtn,gSec,dest.id);
  gSec.appendChild(gAddBtn);
  bookedDiv.appendChild(gSec);

  futureSec.appendChild(bookedDiv);

  // ── Want to see (forward-facing aspirational list) ────────
  // Round FJ: was sub-tab-hidden; now inline with own add input.
  // Round FN.8.18: clarify what this is for. Empty state used to
  // be just an empty list under the heading — Neal's report ("how
  // do things get there?") was a fair question. Now the heading
  // has a one-line hint, and the empty state surfaces a starter
  // prompt explaining the input is freeform — anything you'd want
  // to remember as something to consider while planning.
  var seeSec=document.createElement("div"); seeSec.className="tk-section";
  var seeLbl=document.createElement("div"); seeLbl.className="tk-section-lbl"; seeLbl.style.marginTop="14px"; seeLbl.textContent="Want to see";
  seeSec.appendChild(seeLbl);
  var seeHint=document.createElement("div");
  seeHint.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin:0 0 6px;line-height:1.4;";
  seeHint.textContent = "Anything you've heard about and might want to look up later — a sight, a restaurant, a viewpoint. Type below and click Add.";
  seeSec.appendChild(seeHint);
  var seeListDiv=document.createElement("div"); seeListDiv.className="tlist"; seeListDiv.id="tl-"+dest.id+"-see";
  renderTList(dest,"see",seeListDiv);
  seeSec.appendChild(seeListDiv);
  var seeAddRow=document.createElement("div"); seeAddRow.className="tadd";
  var seeInp=document.createElement("input"); seeInp.className="tinp"; seeInp.id="ti-"+dest.id+"-see"; seeInp.placeholder="e.g. that bakery a friend mentioned, the river walk…";
  var seeBtn=document.createElement("button"); seeBtn.className="taddBtn"; seeBtn.id="tab-"+dest.id+"-see"; seeBtn.textContent="Add";
  (function(did,inp,btn){
    inp.oninput=function(){btn.className=inp.value.trim().length>=2?"taddBtn on":"taddBtn";};
    inp.onkeydown=function(e){if(e.key==="Enter")_doTIInline(did,"see",inp,btn);};
    btn.onclick=function(){_doTIInline(did,"see",inp,btn);};
  })(dest.id,seeInp,seeBtn);
  seeAddRow.appendChild(seeInp); seeAddRow.appendChild(seeBtn);
  seeSec.appendChild(seeAddRow);
  futureSec.appendChild(seeSec);

  wrap.appendChild(futureSec);

  // ============================================================
  // TRIP DIARY — history (visited + cumulative spend)
  // ============================================================
  var pastSec=document.createElement("div"); pastSec.className="tk-major-section tk-past-section";
  var pastHdr=document.createElement("div"); pastHdr.className="tk-major-hdr";
  pastHdr.textContent="Trip diary";
  pastSec.appendChild(pastHdr);
  // Round FN.8.20: brief diary intro so the empty state has context.
  // "Trip diary" alone reads as a heading without explanation; users
  // (Neal in 4.4) wondered how things end up here.
  var diaryHint=document.createElement("div");
  diaryHint.style.cssText="font-size:10.5px;color:var(--c-ink-3);margin:0 0 8px;line-height:1.4;";
  diaryHint.textContent="Sights, restaurants, and notes from each day land here once you mark them done. Anything else you want to remember about being here, log below.";
  pastSec.appendChild(diaryHint);

  // ── Visited (history list) ────────────────────────────────
  var visitedSec=document.createElement("div"); visitedSec.className="tk-section";
  var visitedLbl=document.createElement("div"); visitedLbl.className="tk-section-lbl"; visitedLbl.textContent="Visited";
  visitedSec.appendChild(visitedLbl);
  var visitedListDiv=document.createElement("div"); visitedListDiv.className="tlist"; visitedListDiv.id="tl-"+dest.id+"-visited";
  renderTList(dest,"visited",visitedListDiv);
  visitedSec.appendChild(visitedListDiv);
  var visAddRow=document.createElement("div"); visAddRow.className="tadd";
  var visInp=document.createElement("input"); visInp.className="tinp"; visInp.id="ti-"+dest.id+"-visited"; visInp.placeholder="Log what you did…";
  var visBtn=document.createElement("button"); visBtn.className="taddBtn"; visBtn.id="tab-"+dest.id+"-visited"; visBtn.textContent="Add";
  (function(did,inp,btn){
    inp.oninput=function(){btn.className=inp.value.trim().length>=2?"taddBtn on":"taddBtn";};
    inp.onkeydown=function(e){if(e.key==="Enter")_doTIInline(did,"visited",inp,btn);};
    btn.onclick=function(){_doTIInline(did,"visited",inp,btn);};
  })(dest.id,visInp,visBtn);
  visAddRow.appendChild(visInp); visAddRow.appendChild(visBtn);
  visitedSec.appendChild(visAddRow);
  pastSec.appendChild(visitedSec);

  // ── Spend total (cumulative — past spend up to now) ──────
  if(trip.trackSpending){
    var st=document.createElement("div"); st.className="spend-total"; st.style.marginTop="14px";
    var sl=document.createElement("div"); sl.className="spend-lbl"; sl.textContent="Trip spend so far";
    var sa=document.createElement("div"); sa.className="spend-amt"; sa.textContent=calcTotalSpend();
    st.appendChild(sl); st.appendChild(sa); pastSec.appendChild(st);
  }

  wrap.appendChild(pastSec);

  // Ask Max row
  var ffRow=document.createElement("div"); ffRow.className="frow";
  var finp=document.createElement("input"); finp.className="finp"; finp.id="ff-"+dest.id;
  finp.placeholder="Ask Max anything about this destination\u2026";
  (function(did){
    finp.oninput=function(){var v=finp.value.trim();g("ffb-"+did).className=v.length>=2?"taddBtn on":"taddBtn";};
    finp.onkeydown=function(e){if(e.key==="Enter")doFF(did);};
  })(dest.id);
  var ffb=document.createElement("button"); ffb.className="taddBtn"; ffb.id="ffb-"+dest.id; ffb.textContent="Ask \u2197";
  (function(did){ffb.onclick=function(){doFF(did);};})(dest.id);
  ffRow.appendChild(finp); ffRow.appendChild(ffb); wrap.appendChild(ffRow);

  var ffw=document.createElement("div"); ffw.id="ff-wrap-"+dest.id; wrap.appendChild(ffw);
  return wrap;
}

function renderTList(dest,cat,elOverride){
  var el=elOverride||g("tl-"+dest.id+"-"+cat);if(!el)return;
  var items=dest.trackerItems[cat];
  el.innerHTML=items.length?items.map(function(i){return "<div class='ti'>"+i+"</div>";}).join(""):"<div class='tempty'>Nothing here yet.</div>";
}

function switchCat(dest,cat,btn){
  dest.trackerCat=cat;
  var pane=g("tp-"+dest.id+"-track");
  if(pane)pane.querySelectorAll(".tcat").forEach(function(b){b.classList.remove("on");});
  btn.classList.add("on");
  ["booked","see","visited"].forEach(function(c){
    var el=g("tl-"+dest.id+"-"+c);
    if(el){if(c===cat)el.classList.remove("hidden");else el.classList.add("hidden");}
  });
}

function doTI(destId){
  var inp=g("ti-"+destId); var v=inp.value.trim();if(v.length<2)return;
  var dest=getDest(destId);if(!dest)return;
  dest.trackerItems[dest.trackerCat].push(v); renderTList(dest,dest.trackerCat);
  inp.value=""; g("tab-"+destId).className="taddBtn";
}

// Round FJ: per-list inline add. The old shared "Add to current list"
// input + sub-tab nav (`doTI` reading `dest.trackerCat`) was replaced
// with one input per list (Want to see / Visited). Each input passes
// its own category explicitly, so we don't need the trackerCat
// global. doTI stays for any legacy callers but isn't used by the
// new layout.
function _doTIInline(destId, cat, inpEl, btnEl){
  if (!inpEl) return;
  var v = inpEl.value.trim();
  if (v.length < 2) return;
  var dest = getDest(destId);
  if (!dest) return;
  if (!dest.trackerItems[cat]) dest.trackerItems[cat] = [];
  dest.trackerItems[cat].push(v);
  renderTList(dest, cat);
  inpEl.value = "";
  if (btnEl) btnEl.className = "taddBtn";
  if (typeof autoSave === "function") autoSave();
}

// ── Trip name editing ──────────────────────────────────────
function editTripName(clickedBlock){
  // NC.9.3: editTripName now operates on the CLICKED block, not always
  // on the static #trip-name-display. The picker chrome renders its
  // own .trip-name-block with a name span that has no ID — so clicking
  // it used to fall through to the static block, leave the input
  // inserted off-screen (in the trip-view header), and leave the
  // picker's block visible with the truncated label + pencil intact.
  // Neal: "This shouldn't look this way if you are editing the name."
  //
  // Resolution: callers now pass `this` from their onclick, so we get
  // the actual .trip-name-block the user clicked. We find the name
  // span by querying for either the legacy #trip-name-display id OR
  // the first <span> that isn't the pencil affordance. The pencil + any
  // other siblings inside the block stay visible (only the name span
  // and the affordance text need to swap).
  var block = clickedBlock || document.getElementById("trip-name-wrap");
  if (!block) {
    // Last-ditch fallback: any .trip-name-block on the page.
    block = document.querySelector(".trip-name-block");
  }
  if (!block) return;
  // PD.73h (architectural): re-entry guard. The block's onclick fires
  // on EVERY click inside it — including clicks on the rename input
  // (to reposition the cursor mid-edit). Without this guard, each
  // re-click inserts a fresh input next to the previous one, creating
  // the "duplicate name" the user sees. Just refocus the existing input.
  var _existingInp = block.querySelector("input.trip-name-inp");
  if (_existingInp) {
    try { _existingInp.focus(); } catch(_){}
    return;
  }
  // Find the name span inside this block. Prefer #trip-name-display
  // for back-compat with the static chrome; otherwise grab the first
  // span that isn't the .trip-name-edit pencil affordance.
  var span = block.querySelector("#trip-name-display");
  if (!span) {
    var spans = block.querySelectorAll("span");
    for (var si = 0; si < spans.length; si++) {
      if (!spans[si].classList || !spans[si].classList.contains("trip-name-edit")) {
        span = spans[si];
        break;
      }
    }
  }
  if (!span) return;
  // Hide the pencil too — its purpose ("click to edit") is satisfied
  // once we're already editing; it would otherwise sit next to the
  // input and read as extra chrome. Restored on save/blur.
  var pencil = block.querySelector(".trip-name-edit");
  // PD.73g (architectural): don't snapshot the current inline display
  // value. If editTripName runs twice in a row (rapid double-click,
  // or a re-entry after a stuck input), the second call would see
  // span.style.display already "none" from the first call and capture
  // that as "the value to restore" — saving back to none and leaving
  // the name invisible forever. Always restore to "" so the element
  // falls back to its CSS default (inline for spans).
  var savedDisplay = "";
  var savedPencilDisplay = "";
  var inp=document.createElement("input"); inp.className="trip-name-inp";
  inp.value=trip.name||""; inp.placeholder="Trip name";
  // Match the visual weight of the trip-name-display span so the swap
  // doesn't jiggle the layout.
  inp.style.cssText="font-size:13px;font-weight:600;color:#222;background:transparent;border:none;border-bottom:1px solid #999;outline:none;font-family:inherit;width:100%;display:block;padding:0;";
  span.style.display="none";
  if (pencil) pencil.style.display = "none";
  // PD.83d (architectural): the old PD.73e hid all other .trip-name-block
  // elements while editing, to mask the "two names, one's an input"
  // confusion when the picker chrome and the static trip-view header
  // were both in the DOM. With PD.83c, picker-active makes #app
  // invisible (CSS + render guard), so only the picker's name-block
  // is on screen during a picker edit, and only the static one during
  // a trip-view edit. No parallel block to hide → no snapshot needed.
  span.parentNode.insertBefore(inp, span);
  inp.focus(); inp.select();
  var saved = false;
  function save(){
    if (saved) return; saved = true;
    var val=inp.value.trim()||trip.name||"Untitled trip";
    trip.name=val;
    span.textContent=val;
    span.style.display=savedDisplay;
    if (pencil) pencil.style.display = savedPencilDisplay;
    if (inp.parentNode) inp.parentNode.removeChild(inp);
    // PD.83d: no parallel name-blocks to restore — see edit-open.
    // Mirror the new name into any OTHER trip-name spans on the page
    // (e.g. the static header span while the picker chrome is active,
    // or vice versa) so reopening the other surface doesn't show stale.
    try {
      document.querySelectorAll(".trip-name-block span").forEach(function(s){
        if (s !== span && !s.classList.contains("trip-name-edit")) s.textContent = val;
      });
    } catch(_) {}
    updateIndexEntry(); autoSave();
  }
  inp.onblur=save;
  inp.onkeydown=function(e){if(e.key==="Enter")inp.blur();if(e.key==="Escape"){inp.value=trip.name||"";inp.blur();}};
}

// ── Spend tracking ─────────────────────────────────────────
function toggleSpending(){
  trip.trackSpending=!trip.trackSpending;
  var btn=g("spend-toggle-btn");
  if(btn) btn.className=trip.trackSpending?"spend-toggle on":"spend-toggle";
  // TM.4 (v330): emit replaces drawItin + autoSave.
  _emitTripMutation();
}

function calcTotalSpend(){
  var total={};
  trip.destinations.forEach(function(dest){
    dest.hotelBookings.filter(function(b){return b.status!=="cancelled"&&b.pricePaid;}).forEach(function(b){
      total[b.currency]=(total[b.currency]||0)+b.pricePaid;
    });
    dest.generalBookings.filter(function(b){return b.status!=="cancelled"&&b.pricePaid;}).forEach(function(b){
      total[b.currency]=(total[b.currency]||0)+b.pricePaid;
    });
  });
  Object.keys(trip.legs).forEach(function(k){
    trip.legs[k].bookings.filter(function(b){return b.status!=="cancelled"&&b.pricePaid;}).forEach(function(b){
      total[b.currency]=(total[b.currency]||0)+b.pricePaid;
    });
  });
  // PD.103: per-currency totals were already there (booking carries
  // its own currency code). Enrich with the country/region whose
  // primary currency that is, when MaxGeo recognizes it, so a
  // multi-country trip reads as "EUR 1240.00 (Italy) \u00b7 CHF 890.00
  // (Switzerland)". For currencies shared across many countries
  // (USD, EUR), we name the trip's destination countries that match
  // rather than the canonical issuer.
  var countriesByCurrency = {};
  if (typeof MaxGeo !== "undefined" && MaxGeo.all && Array.isArray(trip.destinations)) {
    var _tripCountryNames = {};
    trip.destinations.forEach(function(d){
      if (!d) return;
      var dc = d.country
        || (d.brief && d.brief.country)
        || (MaxGeo.byName(d.place) ? MaxGeo.byName(d.place).name : null);
      if (dc) _tripCountryNames[dc] = true;
    });
    MaxGeo.all().forEach(function(e){
      if (!e || !e.currency) return;
      if (!_tripCountryNames[e.name]) return;
      countriesByCurrency[e.currency] = countriesByCurrency[e.currency] || [];
      if (countriesByCurrency[e.currency].indexOf(e.name) < 0) countriesByCurrency[e.currency].push(e.name);
    });
  }
  return Object.keys(total).map(function(c){
    var note = countriesByCurrency[c] ? (" (" + countriesByCurrency[c].join(", ") + ")") : "";
    return c + " " + total[c].toFixed(2) + note;
  }).join("  \u00b7  ") || "0";
}

// ── General bookings ───────────────────────────────────────
function toggleGeneralForm(btn,container,formId,destId){
  var existing=g(formId);
  if(existing){existing.parentNode.removeChild(existing);btn.classList.remove("active");btn.textContent="+ Book";return;}
  btn.classList.add("active"); btn.textContent="Close";
  var form=document.createElement("div"); form.className="bk-form"; form.id=formId;
  var r1=document.createElement("div"); r1.className="bk-row";
  var typeSel=document.createElement("select"); typeSel.className="bk-inp";
  ["Tour","Ticket","Restaurant","Other"].forEach(function(t){
    var o=document.createElement("option"); o.value=t.toLowerCase(); o.textContent=t; typeSel.appendChild(o);
  });
  var labelInp=document.createElement("input"); labelInp.type="text"; labelInp.className="bk-inp"; labelInp.placeholder="e.g. Borghese Gallery entrance";
  var locationInp=document.createElement("input"); locationInp.type="text"; locationInp.className="bk-inp"; locationInp.placeholder="Meeting point or address";
  r1.appendChild(mkField("Type",typeSel)); r1.appendChild(mkField("Description",labelInp)); r1.appendChild(mkField("Location",locationInp));
  var r2=document.createElement("div"); r2.className="bk-row";
  var dateInp=document.createElement("input"); dateInp.type="date"; dateInp.className="bk-inp";
  var timeInp=document.createElement("input"); timeInp.type="time"; timeInp.className="bk-inp";
  var timeEndInp=document.createElement("input"); timeEndInp.type="time"; timeEndInp.className="bk-inp";
  var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="Confirmation #";
  r2.appendChild(mkField("Date",dateInp)); r2.appendChild(mkField("Start",timeInp)); r2.appendChild(mkField("End",timeEndInp)); r2.appendChild(mkField("Conf #",confInp));
  var r3=document.createElement("div"); r3.className="bk-row";
  var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01";
  var currSel=mkCurrSel(formId+"-cur","EUR");
  var notesInp=document.createElement("input"); notesInp.type="text"; notesInp.className="bk-inp"; notesInp.placeholder="Notes\u2026";
  r3.appendChild(mkField("Price paid",priceInp)); r3.appendChild(mkField("Currency",currSel)); r3.appendChild(mkField("Notes",notesInp));
  form.appendChild(r1); form.appendChild(r2); form.appendChild(r3);
  var cancelFieldG=mkCancelField(formId+"-gc"); form.appendChild(cancelFieldG);
  var acts=document.createElement("div"); acts.className="bk-form-actions";
  var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save booking";
  var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
  cx.onclick=function(){form.parentNode.removeChild(form);btn.classList.remove("active");btn.textContent="+ Book";};
  sv.onclick=function(){
    if(!labelInp.value.trim())return;
    var cp=cancelFieldG.getCancelPolicy();
    var bk={id:newBkId(),type:typeSel.value,label:labelInp.value.trim(),date:dateInp.value,time:timeInp.value,timeEnd:timeEndInp.value||null,
      confirmationNumber:confInp.value,pricePaid:parseFloat(priceInp.value)||null,currency:currSel.value,
      notes:notesInp.value,status:"booked",source:"manual",cancelType:cp.type,cancelDeadline:cp.deadline,cancelDeadlineTime:cp.deadlineTime||null};
    var dest=getDest(destId); if(!dest)return;
    dest.generalBookings.push(bk);
    form.parentNode.removeChild(form);
    btn.classList.remove("active"); btn.textContent="+ Book";
    container.insertBefore(mkGeneralRecord(bk,destId),btn);
    autoSave();
  };
  acts.appendChild(sv); acts.appendChild(cx); form.appendChild(acts);
  container.insertBefore(form,btn);
}

function mkGeneralRecord(bk,destId){
  var rec=document.createElement("div"); rec.className="bk-record"+(bk.status==="cancelled"?" cancelled":""); rec.id="bkrec-"+bk.id;
  var main=document.createElement("div"); main.className="bk-rec-main";
  main.textContent="\u2713 "+bk.label+(bk.date?" \u00b7 "+fmtD(bk.date):"")+(bk.time?" "+bk.time:"")+(bk.timeEnd?"\u2013"+bk.timeEnd:"");
  var parts=[]; if(bk.confirmationNumber)parts.push("Conf: "+bk.confirmationNumber);
  if(bk.pricePaid)parts.push(bk.currency+" "+bk.pricePaid.toFixed(2)); if(bk.notes)parts.push(bk.notes);
  rec.appendChild(main);
  if(parts.length){var meta=document.createElement("div");meta.className="bk-rec-meta";meta.textContent=parts.join(" \u00b7 ");rec.appendChild(meta);}
  if(bk.cancelType){var cpLine=document.createElement("div");cpLine.className="bk-rec-meta";cpLine.style.fontWeight="600";if(bk.cancelType==="deadline"){cpLine.style.color="#d97706";cpLine.textContent="Cancel by: "+(bk.cancelDeadline?fmtD(bk.cancelDeadline)+(bk.cancelDeadlineTime?" at "+bk.cancelDeadlineTime:""):"date not set");}else if(bk.cancelType==="non-cancellable"){cpLine.style.color="#e05050";cpLine.textContent="Non-cancellable";}rec.appendChild(cpLine);}
  var a=document.createElement("div"); a.className="bk-rec-acts";
  if(bk.status!=="cancelled"){
    var cb=document.createElement("button"); cb.className="bk-rec-btn danger"; cb.textContent="Cancel booking";
    (function(b,r){cb.onclick=function(){
      b.status="cancelled";
      var d=getDest(destId);
      addPendingAction({eventType:'booking',actionType:'Contact provider to adjust or cancel',
        eventName:b.label||b.type||'Booking',
        destName:d?d.label||d.place:'',
        confirmationNumber:b.confirmationNumber||null,
        detail:'Contact provider to cancel'+(b.date?' — booked for '+fmtD(b.date):''),
        requiresProviderAction:true});
      var n=mkGeneralRecord(b,destId);r.parentNode.replaceChild(n,r);autoSave();
    };})(bk,rec);
    a.appendChild(cb);
  }
  var db=document.createElement("button"); db.className="bk-rec-btn"; db.textContent="\u2715 Delete";
  // Round FN.8.20: undo toast on general-booking delete.
  (function(b,r){db.onclick=function(){
    var dRef = getDest(destId);
    if (!dRef) return;
    var snapGeneral = (dRef.generalBookings || []).slice();
    var snapPending = (trip.pendingActions || []).slice();
    var labelStr = b.label || b.type || "Booking";
    if(b.status!=="cancelled"){
      addPendingAction({eventType:"booking",actionType:"Contact provider to adjust or cancel",
        eventName:b.label||b.type||"Booking",destName:dRef?dRef.label||dRef.place:"",
        confirmationNumber:b.confirmationNumber||null,
        detail:"Contact provider to cancel"+(b.date?" \u2014 booked for "+fmtD(b.date):""),
        requiresProviderAction:true});
    }
    dRef.generalBookings = (dRef.generalBookings || []).filter(function(x){return x.id!==b.id;});
    if(r.parentNode) r.parentNode.removeChild(r);
    if (typeof autoSave === "function") autoSave();
    if (typeof _showDayTripToast === "function") {
      _showDayTripToast("Deleted booking <strong>" + labelStr + "</strong>", function(){
        var d3 = getDest(destId);
        if (!d3) return;
        d3.generalBookings = snapGeneral.slice();
        trip.pendingActions = snapPending.slice();
        if (typeof autoSave === "function") autoSave();
        if (typeof drawDestMode === "function") drawDestMode(destId);
      });
    }
  };})(bk,rec);
  a.appendChild(db); rec.appendChild(a); return rec;
}

// ── Data ───────────────────────────────────────────────────
// tier 1=budget, 2=mid, 3=upper, 4=luxury
// ── Routing ────────────────────────────────────────────────
function getRouting(fromPlace, toPlace){
  var f=fromPlace.toLowerCase(), t=toPlace.toLowerCase();
  var key=[f,t].sort().join("|");
  var R={
    "budapest|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"Railjet (OBB/MAV)",meta:"2h 40m \u00b7 \u20ac20\u201360",note:"Direct. Book on oebb.at \u2014 advance fares are significantly cheaper.",book:"https://www.oebb.at"},
      {icon:"\uD83D\uDE8C",name:"FlixBus",meta:"3h \u00b7 \u20ac8\u201325",note:"Cheaper but slower. Fine if trains are sold out.",book:"https://www.flixbus.com"}
    ]},
    "prague|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"Railjet (OBB)",meta:"4h \u00b7 \u20ac20\u201350",note:"Direct. Book on oebb.at. Morning trains fill fast on weekends.",book:"https://www.oebb.at"},
      {icon:"\uD83D\uDE8C",name:"RegioJet / FlixBus",meta:"4h 30m \u00b7 \u20ac8\u201318",note:"Budget option with free coffee on RegioJet.",book:"https://www.regiojet.com"}
    ]},
    "budapest|prague":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Bratislava or Vienna",meta:"6\u20137h \u00b7 \u20ac30\u201360",note:"No direct service \u2014 one change required. Check Slovak Rail (zssk.sk) or OBB.",book:"https://www.oebb.at"},
      {icon:"\uD83D\uDE8C",name:"RegioJet / FlixBus",meta:"7h \u00b7 \u20ac12\u201325",note:"Direct coaches. Surprisingly comfortable, especially RegioJet.",book:"https://www.regiojet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 15m \u00b7 \u20ac40\u2013100",note:"Worth considering given the train time. Fly from BUD to PRG.",book:null}
    ]},
    "berlin|prague":{options:[
      {icon:"\uD83D\uDE82",name:"EC Train",meta:"4h \u00b7 \u20ac20\u201360",note:"Direct. Book on bahn.de. One of the best train routes in Central Europe.",book:"https://www.bahn.de"},
      {icon:"\uD83D\uDE8C",name:"FlixBus",meta:"4h 30m \u00b7 \u20ac8\u201320",note:"Cheaper, roughly same journey time.",book:"https://www.flixbus.com"}
    ]},
    "berlin|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"Railjet / ICE",meta:"8h \u00b7 \u20ac30\u2013100",note:"Scenic route through Salzburg. Book on bahn.de or oebb.at.",book:"https://www.bahn.de"},
      {icon:"\uD83D\uDE82",name:"NightJet (overnight)",meta:"10h \u00b7 \u20ac50\u2013130",note:"Departs late evening, arrives morning. Saves a night\u2019s accommodation.",book:"https://www.nightjet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac50\u2013130",note:"Faster but airports add an hour each side.",book:null}
    ]},
    "berlin|budapest":{options:[
      {icon:"\uD83D\uDE82",name:"NightJet (overnight)",meta:"11h \u00b7 \u20ac50\u2013120",note:"Best option for this distance. Saves a night.",book:"https://www.nightjet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac50\u2013120",note:"Worth it here given the journey length.",book:null}
    ]},
    "amsterdam|paris":{options:[
      {icon:"\uD83D\uDE82",name:"Eurostar / Thalys",meta:"3h 20m \u00b7 \u20ac30\u2013110",note:"Direct. Book early on eurostar.com \u2014 cheap fares go fast.",book:"https://www.eurostar.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 15m + airports",note:"Not worth it \u2014 airport time cancels any saving over the train.",book:null}
    ]},
    "amsterdam|berlin":{options:[
      {icon:"\uD83D\uDE82",name:"ICE",meta:"6h \u00b7 \u20ac30\u2013100",note:"Direct from Amsterdam Centraal. Book on bahn.de.",book:"https://www.bahn.de"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 30m \u00b7 \u20ac50\u2013120",note:"Marginally faster door-to-door. AMS has good rail access.",book:null}
    ]},
    "amsterdam|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"NightJet (overnight)",meta:"13h \u00b7 \u20ac60\u2013140",note:"Direct overnight. Book on nightjet.com.",book:"https://www.nightjet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac60\u2013140",note:"Faster. AMS\u2013VIE is a well-served route.",book:null}
    ]},
    "berlin|paris":{options:[
      {icon:"\uD83D\uDE82",name:"ICE / TGV",meta:"8h \u00b7 \u20ac50\u2013150",note:"Change at Frankfurt or Strasbourg. Book on bahn.de.",book:"https://www.bahn.de"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac60\u2013140",note:"Worth it for this distance.",book:null}
    ]},
    "barcelona|paris":{options:[
      {icon:"\uD83D\uDE82",name:"TGV + AVE (high speed)",meta:"6h 30m \u00b7 \u20ac50\u2013150",note:"Direct. Book on renfe.com or sncf.com. One of the great rail journeys.",book:"https://www.renfe.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac50\u2013130",note:"Faster but train is worth the time.",book:null}
    ]},
    "barcelona|rome":{options:[
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac50\u2013150",note:"No practical train. BCN\u2013FCO or BCN\u2013CIA both work.",book:null},
      {icon:"\u26F4\uFE0F",name:"Ferry (Civitavecchia)",meta:"20h \u00b7 \u20ac50\u2013120",note:"Grimaldi Lines from Barcelona to Civitavecchia. Slow but a real experience.",book:"https://www.grimaldi-lines.com"}
    ]},
    "paris|rome":{options:[
      {icon:"\uD83D\uDE82",name:"TGV + Frecciarossa",meta:"10h \u00b7 \u20ac60\u2013160",note:"Change in Turin or Milan. Long but scenic through the Alps.",book:"https://www.sncf.com"},
      {icon:"\uD83D\uDE82",name:"NightJet (overnight)",meta:"13h \u00b7 \u20ac70\u2013150",note:"Paris to Venice, then onward to Rome. Saves a night.",book:"https://www.nightjet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac60\u2013140",note:"Quickest. CDG to FCO is well-served.",book:null}
    ]},
    "rome|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"NightJet (overnight)",meta:"13h \u00b7 \u20ac60\u2013140",note:"Direct overnight. Book on nightjet.com.",book:"https://www.nightjet.com"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac60\u2013130",note:"FCO to VIE. Worth it given journey length.",book:null}
    ]},
    "interlaken|vienna":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Zurich",meta:"8\u20139h \u00b7 CHF 80\u2013160",note:"Change in Zurich. Scenic through Vorarlberg and the Arlberg pass. Book on sbb.ch.",book:"https://www.sbb.ch"},
      {icon:"\u2708\uFE0F",name:"Flight from Zurich",meta:"1h 10m + transfer \u00b7 CHF 100\u2013250",note:"Train to Zurich (2h), then fly ZRH\u2013VIE. Only faster if you book well ahead.",book:null}
    ]},
    "interlaken|paris":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Basel",meta:"4h 30m \u00b7 CHF 60\u2013130",note:"Change in Basel. Book on sbb.ch. TGV from Basel makes this very manageable.",book:"https://www.sbb.ch"}
    ]},
    "interlaken|prague":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Zurich + Munich",meta:"9\u201310h \u00b7 CHF 90\u2013180",note:"Two changes. Long day \u2014 consider breaking in Munich.",book:"https://www.sbb.ch"},
      {icon:"\u2708\uFE0F",name:"Flight from Zurich",meta:"1h 20m + transfer \u00b7 CHF 120\u2013250",note:"Train to Zurich, then ZRH\u2013PRG.",book:null}
    ]},
    "interlaken|berlin":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Zurich + Frankfurt",meta:"8\u20139h \u00b7 CHF 80\u2013160",note:"Change in Zurich and Basel. Book on sbb.ch and bahn.de.",book:"https://www.sbb.ch"},
      {icon:"\u2708\uFE0F",name:"Flight from Zurich or Bern",meta:"1h 30m + transfer \u00b7 CHF 100\u2013220",note:"ZRH or BRN to BER.",book:null}
    ]},
    "copenhagen|stockholm":{options:[
      {icon:"\uD83D\uDE82",name:"SJ / DSB train",meta:"5h \u00b7 \u20ac30\u201380",note:"Direct across the \u00d8resund Bridge. Book on sj.se.",book:"https://www.sj.se"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h \u00b7 \u20ac50\u2013120",note:"Not worth it \u2014 train is seamless and city-centre to city-centre.",book:null}
    ]},
    "berlin|copenhagen":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Flensburg",meta:"4h 30m \u00b7 \u20ac30\u201380",note:"Direct IC trains. Book on bahn.de.",book:"https://www.bahn.de"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 20m \u00b7 \u20ac50\u2013120",note:"Marginally faster door-to-door.",book:null}
    ]},
    "amsterdam|copenhagen":{options:[
      {icon:"\uD83D\uDE82",name:"Train via Hamburg",meta:"5h 30m \u00b7 \u20ac40\u2013110",note:"Change in Hamburg. Book on bahn.de.",book:"https://www.bahn.de"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac50\u2013120",note:"AMS\u2013CPH is well served.",book:null}
    ]},
    "vienna|zurich":{options:[
      {icon:"\uD83D\uDE82",name:"Train (OBB/SBB)",meta:"8h \u00b7 \u20ac40\u2013120",note:"Direct overnight or via Munich. Scenic but long — consider flying for day trips.",book:"https://www.oebb.at"},
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 20m \u00b7 \u20ac50\u2013150",note:"Austrian, Swiss, Easyjet. Usually better value than the train for this route.",book:null}
    ]},
    "prague|zurich":{options:[
      {icon:"\u2708\uFE0F",name:"Flight",meta:"1h 30m \u00b7 \u20ac50\u2013150",note:"No direct train worth taking — fly. Easyjet and Swiss cover this route.",book:null},
      {icon:"\uD83D\uDE82",name:"Train via Munich",meta:"7\u20138h \u00b7 \u20ac60\u2013120",note:"Two changes required. Only worth it for the scenery.",book:"https://www.bahn.de"}
    ]},
    "budapest|zurich":{options:[
      {icon:"\u2708\uFE0F",name:"Flight",meta:"2h \u00b7 \u20ac60\u2013160",note:"No useful direct train. Fly from BUD — Easyjet and Wizz Air often cheapest.",book:null},
      {icon:"\uD83D\uDE82",name:"Train via Vienna + Munich",meta:"10\u201311h",note:"Long journey with connections. Only for those who love trains.",book:"https://www.oebb.at"}
    ]},
    "interlaken|zurich":{options:[
      {icon:"\uD83D\uDE82",name:"Train (SBB)",meta:"2h \u00b7 CHF30\u201350",note:"Direct IC. Spectacular Berner Oberland scenery. Book on sbb.ch.",book:"https://www.sbb.ch"},
      {icon:"\uD83D\uDE97",name:"Drive",meta:"1h 30m",note:"Scenic route via Bern. Easy if you have a car.",book:null}
    ]}
  };
  // First check the hardcoded table
  if(R[key]) return R[key];
  // Then check the trip's dynamic routing cache
  if(typeof trip !== "undefined" && trip && trip._routingCache && trip._routingCache[key]){
    return trip._routingCache[key];
  }
  // Ensure the in-flight tracker exists (defensive — in case script errored before its own init)
  if(typeof _routingFetchInFlight === "undefined" || !_routingFetchInFlight) _routingFetchInFlight = {};
  // Not cached — kick off an async fetch (fire-and-forget; cache and re-render on success)
  if(typeof trip !== "undefined" && trip && !_routingFetchInFlight[key]){
    _routingFetchInFlight[key] = true;
    if(typeof fetchRoutingAsync === "function") fetchRoutingAsync(fromPlace, toPlace, key);
  }
  return null;
}

// Track in-flight routing fetches so we don't duplicate requests
var _routingFetchInFlight = _routingFetchInFlight || {};

// Fetch transport options between two cities using Max. Caches on trip._routingCache
// and re-renders the trip view when the result lands.
async function fetchRoutingAsync(fromPlace, toPlace, key){
  try {
    var region = (trip && trip.brief && trip.brief.region) || "";
    var transportPref = (trip && trip.brief && trip.brief.transport) || "";
    var prompt = "A traveler is going from " + fromPlace + " to " + toPlace
      + (region ? " in " + region : "") + ".\n"
      + (transportPref ? "Their transport preference: " + transportPref + "\n" : "")
      + "\nACCURACY RULE — read first: WRONG INFORMATION IS WORSE THAN NO INFORMATION. Only return options you’re certain are correct. If unsure of a route’s endpoints, schedule, or operator, OMIT IT. Better to return one verified option than three confidently-wrong ones.\n\n"
      + "List the REALISTIC transport options between these two places. "
      + "ONLY include a named/branded scenic service if its actual operator-published endpoints match this leg. Do NOT shoehorn a famous train onto a route it doesn’t serve. If the traveler’s start city is the gateway to a scenic service rather than an endpoint, the realistic option is the regional service that gets them to the scenic service’s actual starting point — not the scenic service itself.\n"
      + "For each, give duration, approximate cost in local currency, whether a reservation is required, "
      + "and a one-sentence note about what the experience is like or any practical caveat (frequency, changes, seasonality, pass coverage).\n\n"
      + "Return ONLY a JSON object (no markdown), with an options array:\n"
      + '{"options":[{"icon":"\uD83D\uDE82","name":"Service name","meta":"duration \u00b7 cost","note":"One-sentence caveat or observation.","book":"https://url.example or null"}]}\n\n'
      + "Icons: \uD83D\uDE82 for trains, \uD83D\uDE8C for buses/coaches, \u2708\uFE0F for flights, \uD83D\uDE97 for driving, \u26F4\uFE0F for ferries. "
      + "2-4 options max. Do not invent routes that don't exist.";
    var text = await callMax([{role:"user",content:prompt}], 1200, 40000);
    var cleaned = text.replace(/```json|```/g,"").trim();
    var parsed;
    try { parsed = JSON.parse(cleaned); }
    catch(e){
      // Try to recover by extracting the {...options...} object
      var s = cleaned.indexOf("{"), e2 = cleaned.lastIndexOf("}");
      if(s>-1 && e2>s) parsed = JSON.parse(cleaned.substring(s, e2+1));
      else throw e;
    }
    if(!parsed || !parsed.options || !parsed.options.length) throw new Error("empty options");
    // Cache on the trip
    trip._routingCache = trip._routingCache || {};
    trip._routingCache[key] = parsed;
    if(typeof autoSave === "function") autoSave();
    // Re-render trip view so new options appear
    if(_leftMode === "trip" && typeof drawTripMode === "function") drawTripMode();
  } catch(err){
    console.warn("Routing fetch failed for " + key + ":", err && err.message);
    // Cache a sentinel null so we don't keep retrying indefinitely this session
    trip._routingCache = trip._routingCache || {};
    trip._routingCache[key] = {options:[], _failed:true};
  } finally {
    delete _routingFetchInFlight[key];
  }
}

function routingHeadline(routing){
  if(!routing||!routing.options.length)return null;
  var o=routing.options[0];
  return o.icon+" "+o.name;
}

function getPracticalInfo(place,intent,dest){
  // Generated city data takes priority
  var gen=_generatedCityData[place.toLowerCase()];
  if(gen&&!gen.loading&&gen.practicalInfo) return gen.practicalInfo;
  // Persisted on dest across reloads
  if(dest&&dest.generatedPracticalInfo) return dest.generatedPracticalInfo;
  // Generic fallback — populated once generateCityData returns
  return{
    currency:"Loading\u2026",
    tipping:"Loading\u2026",
    note:"",
    emergency:"112 (EU) \u00b7 Check local numbers on arrival"
  };
}

function getDistricts(place,intent,dest){
  var gen=_generatedCityData[place.toLowerCase()];
  if(gen&&!gen.loading&&gen.districts&&gen.districts.length) return gen.districts;
  // Check dest.generatedDistricts — persisted across page reloads
  if(dest&&dest.generatedDistricts&&dest.generatedDistricts.length) return dest.generatedDistricts;
  return[];
}

// v359.60.11: explicit window exports at end-of-script so Playwright
// tests can find these functions via page.evaluate(window.X). Top-
// level function declarations in this script SHOULD auto-attach to
// window, but they don't reliably for the test harness — possibly
// because the script is so large that Playwright's wait condition
// fires before everything has settled. Doing the assignment HERE
// guarantees the functions are fully parsed and addressable. Direct
// assignment (no setTimeout, no eval indirection).
