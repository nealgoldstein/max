// exec-mode.js — Execution-mode (on-the-ground) renderer. Extracted from index.html (PD.454).

// ── Execution mode ─────────────────────────────────────────
var _exMapInstance=null;
var _exSheetOpen=false;
var _exFullMap=false;

function setDestMode(destId,exec){
  var dest=getDest(destId); if(!dest)return;
  if(!dest.todayItems) dest.todayItems=[];
  if(!dest.discoveredItems) dest.discoveredItems=[];
  dest.execMode=exec;
  // TM.4 (v330): emit replaces autoSave + drawItin.
  _emitTripMutation();
}

function isToday(dateStr){
  if(!dateStr)return false;
  var today=new Date(); today.setHours(0,0,0,0);
  var d=new Date(dateStr+"T00:00:00"); d.setHours(0,0,0,0);
  return d.getTime()===today.getTime();
}

function shouldAutoExec(dest){
  if(!dest.dateFrom||!dest.dateTo)return false;
  var today=new Date(); today.setHours(0,0,0,0);
  var from=new Date(dest.dateFrom+"T00:00:00"); from.setHours(0,0,0,0);
  var to=new Date(dest.dateTo+"T00:00:00"); to.setHours(0,0,0,0);
  return today>=from && today<=to;
}

function getAllSights(dest){
  var sights=[];
  dest.days.forEach(function(day,di){
    (day.items||day.sights||[]).filter(function(s){return s.type==="sight";}).forEach(function(s){
      sights.push({id:s.id,n:s.n,p:s.p,done:s.done,dayIdx:di,dayLbl:day.lbl,st:s.st});
    });
  });
  if(dest.discoveredItems){
    dest.discoveredItems.forEach(function(d){
      sights.push({id:d.id,n:d.n,p:"nice",done:d.done||false,dayIdx:-1,dayLbl:"Discovered",st:null,note:d.note});
    });
  }
  return sights;
}

function getTodayIds(dest){
  var key="ex-today-"+dest.id+"-"+(new Date().toISOString().slice(0,10));
  try{var s=localStorage.getItem(key);return s?JSON.parse(s):[];}catch(e){return [];}
}

function saveTodayIds(dest,ids){
  if(_inIframe)return;
  var key="ex-today-"+dest.id+"-"+(new Date().toISOString().slice(0,10));
  try{localStorage.setItem(key,JSON.stringify(ids));}catch(e){}
}

function calcRouteSummary(dest,todayIds){
  if(!todayIds||todayIds.length===0)return null;
  var allSights=getAllSights(dest);
  var items=todayIds.map(function(id){return allSights.find(function(s){return s.id===id;});}).filter(Boolean);
  if(items.length===0)return null;
  var booked=dest.hotelBookings&&dest.hotelBookings.find(function(b){return b.status==="booked";});
  var parts=[];
  if(booked) parts.push(booked.name.split(" ").slice(0,2).join(" "));
  items.forEach(function(s){parts.push(s.n.length>18?s.n.substring(0,16)+"\u2026":s.n);});
  // Estimate legs
  var legs=[];
  for(var i=0;i<parts.length-1;i++){
    // Simple heuristic: alternate walk/transit
    var mode=i%2===0?"\uD83D\uDEB6 ~12 min":"\uD83D\uDE87 2 stops";
    legs.push(mode);
  }
  var summary=parts[0];
  for(var j=0;j<legs.length;j++) summary+="\u2192"+legs[j]+"\u2192"+parts[j+1];
  return summary;
}

function drawExecMode(dest){
  var wrap=g("rp-itin");
  wrap.innerHTML="";
  wrap.style.padding="0";
  wrap.style.overflow="hidden";
  wrap.style.height="100%";

  // Auto-set exec mode if traveling today
  if(!dest.execMode&&shouldAutoExec(dest)){dest.execMode=true;}
  if(!dest.todayItems)dest.todayItems=[];
  if(!dest.discoveredItems)dest.discoveredItems=[];

  var todayIds=getTodayIds(dest);
  var allSights=getAllSights(dest);
  var poolSights=allSights.filter(function(s){return todayIds.indexOf(s.id)===-1&&!s.done;});

  var exWrap=document.createElement("div"); exWrap.className="ex-wrap"; exWrap.id="ex-wrap-"+dest.id;

  // ── Left panel ─────────────────────────────────────────
  var listPanel=document.createElement("div"); listPanel.className="ex-list"; listPanel.id="ex-list-panel";

  // Header
  var hdr=document.createElement("div"); hdr.className="ex-hdr";
  var titleRow=document.createElement("div"); titleRow.style.cssText="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;";
  var titleTxt=document.createElement("div"); titleTxt.className="ex-title"; titleTxt.textContent=dest.place;
  var modeToggle=document.createElement("div"); modeToggle.className="mode-toggle";
  var planBtn=document.createElement("button"); planBtn.className="mode-btn"; planBtn.textContent="Plan";
  var execBtn=document.createElement("button"); execBtn.className="mode-btn on"; execBtn.textContent="Execute";
  (function(did){planBtn.onclick=function(){setDestMode(did,false);};})(dest.id);
  modeToggle.appendChild(planBtn); modeToggle.appendChild(execBtn);
  titleRow.appendChild(titleTxt); titleRow.appendChild(modeToggle);
  hdr.appendChild(titleRow);

  // Date + map button row
  var subRow=document.createElement("div"); subRow.style.cssText="display:flex;align-items:center;justify-content:space-between;";
  var sub=document.createElement("div"); sub.className="ex-sub";
  var todayStr=new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});
  sub.textContent=todayStr+" \u00b7 "+fmtD(dest.dateFrom)+" \u2013 "+fmtD(dest.dateTo);
  var mapBtn2=document.createElement("button"); mapBtn2.className="ex-act today-act";
  mapBtn2.textContent="\uD83D\uDDFA Map";
  (function(did){mapBtn2.onclick=function(){openMap(did);};})(dest.id);
  subRow.appendChild(sub); subRow.appendChild(mapBtn2);
  hdr.appendChild(subRow);

  // Max orientation line
  var maxLineEl=g("ex-max-line-"+dest.id);
  var savedMaxLine=null;
  try{savedMaxLine=sessionStorage.getItem("ex-maxline-"+dest.id);}catch(e){}
  if(savedMaxLine){
    var ml=document.createElement("div"); ml.className="ex-max-line"; ml.textContent=savedMaxLine;
    hdr.appendChild(ml);
  } else {
    var ml=document.createElement("div"); ml.className="ex-max-line max-thinking"; ml.id="ex-max-line-"+dest.id;
    ml.textContent="Max is thinking\u2026";
    hdr.appendChild(ml);
    (function(el,did){
      callMax([{role:"user",content:"I just arrived in "+dest.place+". Give me one sentence of practical orientation — the kind of thing a knowledgeable friend would say when you arrive. Not a welcome. A useful observation."}])
        .then(function(t){
          el.textContent=t;
          el.classList.remove("max-thinking");
          try{sessionStorage.setItem("ex-maxline-"+did,t);}catch(e){}
        }).catch(function(){el.parentNode&&el.parentNode.removeChild(el);});
    })(ml,dest.id);
  }

  // Route summary
  if(todayIds.length>0){
    var summary=calcRouteSummary(dest,todayIds);
    if(summary){
      var rs=document.createElement("div"); rs.className="ex-route-summary"; rs.textContent=summary;
      hdr.appendChild(rs);
    }
  }
  listPanel.appendChild(hdr);

  // ── Scrollable list ─────────────────────────────────
  var listInner=document.createElement("div"); listInner.className="ex-list-inner";

  // TODAY section
  var todaySec=document.createElement("div"); todaySec.className="ex-today-section";
  var todayHdr=document.createElement("div"); todayHdr.className="ex-section-hdr"; todayHdr.style.padding="8px 6px 4px";
  var todayLbl=document.createElement("span"); todayLbl.className="ex-section-lbl"; todayLbl.textContent="Today";
  var todayCount=document.createElement("span"); todayCount.className="ex-section-count"; todayCount.textContent=todayIds.length+" item"+(todayIds.length!==1?"s":"");
  todayHdr.appendChild(todayLbl); todayHdr.appendChild(todayCount); todaySec.appendChild(todayHdr);

  if(todayIds.length===0){
    var emp=document.createElement("div"); emp.className="ex-empty"; emp.textContent="Nothing for today yet \u2014 add from the pool below.";
    todaySec.appendChild(emp);
  } else {
    todayIds.forEach(function(sid){
      var s=allSights.find(function(x){return x.id===sid;});
      if(!s)return;
      todaySec.appendChild(mkExSight(s,dest,todayIds,allSights,"today"));
    });
  }
  listInner.appendChild(todaySec);

  // POOL section
  var poolSep=document.createElement("div"); poolSep.className="ex-pool-sep"; listInner.appendChild(poolSep);
  var poolSec=document.createElement("div"); poolSec.className="ex-pool-section";
  var poolHdr=document.createElement("div"); poolHdr.className="ex-section-hdr"; poolHdr.style.padding="4px 6px";
  var poolLbl=document.createElement("span"); poolLbl.className="ex-section-lbl"; poolLbl.textContent="Pool";
  var poolCount=document.createElement("span"); poolCount.className="ex-section-count"; poolCount.textContent=poolSights.length+" remaining";
  poolHdr.appendChild(poolLbl); poolHdr.appendChild(poolCount); poolSec.appendChild(poolHdr);

  // Group by day
  var byDay={};
  poolSights.forEach(function(s){
    var k=s.dayLbl||"Unassigned";
    if(!byDay[k])byDay[k]=[];
    byDay[k].push(s);
  });
  Object.keys(byDay).forEach(function(dayLbl){
    var chip=document.createElement("div"); chip.className="ex-day-chip"; chip.textContent=dayLbl;
    poolSec.appendChild(chip);
    byDay[dayLbl].forEach(function(s){
      poolSec.appendChild(mkExSight(s,dest,todayIds,allSights,"pool"));
    });
  });

  if(poolSights.length===0){
    var pEmp=document.createElement("div"); pEmp.className="ex-empty"; pEmp.textContent="Pool is empty.";
    poolSec.appendChild(pEmp);
  }

  // Discovered button
  var discWrap=document.createElement("div"); discWrap.style.padding="0 0 8px";
  var discBtn=document.createElement("button"); discBtn.className="ex-disc-btn";
  discBtn.innerHTML='<span style="font-size:14px;">+</span> I discovered something\u2026';
  var discFormDiv=document.createElement("div"); discFormDiv.className="ex-disc-form"; discFormDiv.style.display="none";
  var discInp=document.createElement("input"); discInp.className="ex-disc-inp"; discInp.placeholder="What did you find?";
  var discActs=document.createElement("div"); discActs.className="ex-disc-actions";
  var discSave=document.createElement("button"); discSave.className="ex-act today-act"; discSave.textContent="Add to pool";
  var discCancel=document.createElement("button"); discCancel.className="ex-act"; discCancel.textContent="Cancel";
  discActs.appendChild(discSave); discActs.appendChild(discCancel);
  discFormDiv.appendChild(discInp); discFormDiv.appendChild(discActs);

  discBtn.onclick=function(){discBtn.style.display="none";discFormDiv.style.display="block";setTimeout(function(){discInp.focus();},50);};
  discCancel.onclick=function(){discBtn.style.display="";discFormDiv.style.display="none";discInp.value="";};
  (function(d,inp,fd,db){
    discSave.onclick=function(){
      var v=inp.value.trim(); if(!v)return;
      // Add to pool immediately as pending
      sidCtr++;
      var newItem={id:"s"+sidCtr,n:v,p:"nice",done:false,dayIdx:-1,dayLbl:"Discovered",st:null,note:null};
      if(!d.discoveredItems)d.discoveredItems=[];
      d.discoveredItems.push(newItem);
      inp.value=""; db.style.display=""; fd.style.display="none";
      autoSave();
      // Ask Max for context
      callMax([{role:"user",content:"I am in "+d.place+" and I just discovered: \""+v+"\". Give me two sentences of context \u2014 what is it, why does it matter. Be concrete."}])
        .then(function(t){
          newItem.note=t; _emitTripMutation();
        }).catch(function(){_emitTripMutation();});
      if(activeDest) drawDestMode(activeDest);
    };
  })(dest,discInp,discFormDiv,discBtn);

  discWrap.appendChild(discBtn); discWrap.appendChild(discFormDiv);
  poolSec.appendChild(discWrap);
  listInner.appendChild(poolSec);
  listPanel.appendChild(listInner);
  exWrap.appendChild(listPanel);

  // ── Map panel ──────────────────────────────────────────
  var mapPanel=document.createElement("div"); mapPanel.className="ex-map";
  var exMapDiv=document.createElement("div"); exMapDiv.id="ex-map-div"; exMapDiv.style.cssText="width:100%;height:100%;";
  var expandBtn=document.createElement("button"); expandBtn.className="ex-map-expand";
  expandBtn.textContent=_exFullMap?"\u2194 Split":"\u26F6 Full map";
  expandBtn.onclick=function(){
    _exFullMap=!_exFullMap;
    if(_exFullMap){
      listPanel.style.display="none";
      expandBtn.textContent="\u2194 Split";
      // Show bottom sheet
      var sheet=g("ex-bottom-sheet");
      if(sheet)sheet.style.display="block";
    } else {
      listPanel.style.display="";
      expandBtn.textContent="\u26F6 Full map";
      var sheet=g("ex-bottom-sheet");
      if(sheet)sheet.style.display="none";
    }
    setTimeout(function(){if(_exMapInstance)_exMapInstance.invalidateSize();},100);
  };
  mapPanel.appendChild(exMapDiv); mapPanel.appendChild(expandBtn);

  // Bottom sheet (full map mode)
  var sheet=document.createElement("div"); sheet.className="ex-sheet"; sheet.id="ex-bottom-sheet";
  sheet.style.display=_exFullMap?"block":"none";
  var shHandle=document.createElement("div"); shHandle.className="ex-sheet-handle";
  var shPeek=document.createElement("div"); shPeek.className="ex-sheet-peek";
  shPeek.textContent=todayIds.length>0?"Today: "+todayIds.map(function(id){var s=allSights.find(function(x){return x.id===id;});return s?s.n:"";}).filter(Boolean).join(" \u00b7 "):"Tap to see sights list";
  var shBody=document.createElement("div"); shBody.className="ex-sheet-body";
  // Clone today items into sheet
  if(todayIds.length>0){
    todayIds.forEach(function(sid){
      var s=allSights.find(function(x){return x.id===sid;});
      if(s)shBody.appendChild(mkExSight(s,dest,todayIds,allSights,"today"));
    });
  }
  var toggleSheet=function(){
    _exSheetOpen=!_exSheetOpen;
    sheet.className="ex-sheet"+(_exSheetOpen?" open":"");
  };
  shHandle.onclick=toggleSheet; shPeek.onclick=toggleSheet;
  sheet.appendChild(shHandle); sheet.appendChild(shPeek); sheet.appendChild(shBody);
  mapPanel.appendChild(sheet);
  exWrap.appendChild(mapPanel);
  wrap.appendChild(exWrap);

  // Init exec map
  setTimeout(function(){
    if(_exMapInstance){_exMapInstance.remove();_exMapInstance=null;}
    var center=getCityCenter(dest.place);
    _exMapInstance=L.map("ex-map-div",{zoomControl:true}).setView(center,14);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"\u00a9 Esri",maxZoom:19}).addTo(_exMapInstance);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",{opacity:1.0,maxZoom:19}).addTo(_exMapInstance);
    // Plot sights — today sights brighter, pool dimmed
    allSights.forEach(function(s){
      var inToday=todayIds.indexOf(s.id)>-1;
      var center2=getCityCenter(dest.place);
      var lat=center2[0]+(Math.random()-.5)*.018;
      var lng=center2[1]+(Math.random()-.5)*.022;
      var styleKey=s.p==="must"?"sight-must":"sight-nice";
      var icon=makeMapIcon(styleKey);
      var marker=L.marker([lat,lng],{icon:icon,opacity:inToday?1:0.4});
      var popupHtml='<div class="mp-type">'+( inToday?"Today":"Pool")+'</div><div class="mp-name">'+s.n+'</div>';
      if(s.note)popupHtml+='<div class="mp-note">'+s.note+'</div>';
      marker.bindPopup(popupHtml).addTo(_exMapInstance);
    });
    // Essentials (from dest.suggestions)
    var essentialTypes=["atm","bank","grocery","tourist-info","pharmacy"];
    (dest.suggestions||[]).filter(function(s){return essentialTypes.indexOf(s.type)>-1&&s.lat&&s.lng;}).forEach(function(loc){
      var icon=makeMapIcon(loc.type);
      L.marker([loc.lat,loc.lng],{icon:icon}).bindPopup(makePopup(loc.n,loc.type.replace("-"," "),loc.note||"")).addTo(_exMapInstance);
    });
  },80);
}

function mkExSight(s,dest,todayIds,allSights,context){
  var inToday=todayIds.indexOf(s.id)>-1;
  var row=document.createElement("div"); row.className="ex-sight"+(s.done?" done":"");
  var dot=document.createElement("div"); dot.className="ex-sight-dot "+(s.p==="must"?"must":"nice");
  var body=document.createElement("div"); body.className="ex-sight-body";
  var name=document.createElement("div"); name.className="ex-sight-name"; name.textContent=s.n;
  // Round DF: append external-site link inline with the name
  var _exExt = _sightExternalUrl(s, dest && dest.place);
  if (_exExt) {
    var _exA = document.createElement("a");
    _exA.href = _exExt.url; _exA.target = "_blank"; _exA.rel = "noopener noreferrer";
    _exA.textContent = " \u2197";
    _exA.title = _exExt.isOfficial ? "Official site" : "Search the web for this sight";
    _exA.style.cssText = "font-size:10px;color:" + (_exExt.isOfficial ? "#1a5fa8" : "#999") + ";text-decoration:none;font-weight:600;";
    _exA.onclick = function(e){ e.stopPropagation(); };
    name.appendChild(_exA);
    // Round DG: \u270e to edit/set a custom URL
    var _exEdit = document.createElement("button");
    _exEdit.type = "button";
    _exEdit.textContent = "\u270e";
    _exEdit.title = s.url ? "Edit URL" : "Set a custom URL";
    _exEdit.style.cssText = "margin-left:3px;font-size:10px;color:#aaa;background:none;border:none;cursor:pointer;padding:0 2px;font-family:inherit;line-height:1;";
    (function(item,d){_exEdit.onclick = function(e){
      e.stopPropagation();
      _openSightUrlEditor(_exEdit, item, function(){
        if (d && d.id && typeof drawDestMode === "function") drawDestMode(d.id);
        else if (activeDest && typeof drawDestMode === "function") drawDestMode(activeDest);
      });
    };})(s, dest);
    name.appendChild(_exEdit);
  }
  if(s.note){
    var note=document.createElement("div"); note.className="ex-sight-day"; note.style.fontStyle="italic"; note.textContent=s.note.substring(0,60)+(s.note.length>60?"\u2026":"");
    body.appendChild(name); body.appendChild(note);
  } else {
    if(s.dayLbl&&context==="pool"){
      // day label shown in group header, skip inline
    }
    body.appendChild(name);
  }
  var acts=document.createElement("div"); acts.className="ex-sight-acts";

  if(context==="today"){
    if(!s.done){
      var doneBtn=document.createElement("button"); doneBtn.className="ex-act done-act"; doneBtn.textContent="\u2713 Done";
      (function(sid,d,tids){doneBtn.onclick=function(){
        d.days.forEach(function(day){(day.items||day.sights||[]).forEach(function(x){if(x.id===sid)x.done=true;});});
        if(d.discoveredItems)d.discoveredItems.forEach(function(x){if(x.id===sid)x.done=true;});
        _emitTripMutation();
      };})(s.id,dest,todayIds);
      acts.appendChild(doneBtn);
    }
    // Calendar: move to a specific day (stays removed from today)
    var calBtn2=document.createElement("button"); calBtn2.className="ex-act"; calBtn2.textContent="\uD83D\uDCC5";
    calBtn2.title="Move to a day";
    (function(sid,d,btn){calBtn2.onclick=function(e){
      e.stopPropagation();
      var existing=document.getElementById("day-pick-"+sid);
      if(existing){existing.parentNode.removeChild(existing);return;}
      var picker=document.createElement("div"); picker.id="day-pick-"+sid;
      picker.style.cssText="position:fixed;z-index:900;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:6px 0;min-width:140px;";
      var rect=btn.getBoundingClientRect();
      picker.style.left=rect.left+"px"; picker.style.top=(rect.bottom+4)+"px";
      d.days.forEach(function(day){
        var opt=document.createElement("div"); opt.style.cssText="padding:6px 14px;font-size:11px;cursor:pointer;color:#444;";
        opt.textContent=day.lbl;
        opt.onmouseover=function(){opt.style.background="#fafafa";};
        opt.onmouseout=function(){opt.style.background="";};
        (function(dayObj){opt.onclick=function(){
          // Remove from today list
          var ids=getTodayIds(d); ids=ids.filter(function(x){return x!==sid;}); saveTodayIds(d,ids);
          // Move sight to target day
          var sight=null;
          d.days.forEach(function(dy){var _ims=dy.items||dy.sights||[];for(var i=_ims.length-1;i>=0;i--){if(_ims[i].id===sid){sight=_ims.splice(i,1)[0];}}});
          if(d.discoveredItems){for(var j=d.discoveredItems.length-1;j>=0;j--){if(d.discoveredItems[j].id===sid){if(!sight)sight=d.discoveredItems[j];d.discoveredItems.splice(j,1);}}}
          if(sight){var tgt=d.days.find(function(dy){return dy.id===dayObj.id;});if(tgt){if(!tgt.items)tgt.items=[];tgt.items.push(sight);}}
          picker.parentNode.removeChild(picker); _emitTripMutation();
        };})(day);
        picker.appendChild(opt);
      });
      document.body.appendChild(picker);
      setTimeout(function(){document.addEventListener("click",function dismiss(ev){if(!picker.contains(ev.target)){picker.parentNode&&picker.parentNode.removeChild(picker);document.removeEventListener("click",dismiss);}});},10);
    };})(s.id,dest,calBtn2);
    acts.appendChild(calBtn2);
    var backBtn=document.createElement("button"); backBtn.className="ex-act skip-act"; backBtn.textContent="Later";
    (function(sid,d){backBtn.onclick=function(){
      var ids=getTodayIds(d); ids=ids.filter(function(x){return x!==sid;});
      saveTodayIds(d,ids); if(activeDest) drawDestMode(activeDest);
    };})(s.id,dest);
    acts.appendChild(backBtn);
    // Story button in today context
    if(s.st||s.n){
      var stBtnT=document.createElement("button"); stBtnT.className="ex-act"; stBtnT.id="ssa-"+s.id; stBtnT.textContent="story \u2197";
      stBtnT.setAttribute("data-state","idle");
      (function(sid,did){stBtnT.onclick=function(){sStory(sid,did);};})(s.id,dest.id);
      acts.appendChild(stBtnT);
    }
  } else {
    // Pool actions — calendar day picker + undo if done
    if(!s.done){
      var calBtn=document.createElement("button"); calBtn.className="ex-act today-act"; calBtn.textContent="\uD83D\uDCC5";
      calBtn.title="Assign to a day";
      (function(sid,d,btn){calBtn.onclick=function(e){
        e.stopPropagation();
        // Remove any existing picker
        var existing=document.getElementById("day-pick-"+sid);
        if(existing){existing.parentNode.removeChild(existing);return;}
        var picker=document.createElement("div"); picker.id="day-pick-"+sid;
        picker.style.cssText="position:absolute;z-index:900;background:#fff;border:1px solid #ddd;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:6px 0;min-width:140px;";
        // Position below button
        var rect=btn.getBoundingClientRect();
        picker.style.left=(rect.left)+"px"; picker.style.top=(rect.bottom+4)+"px";
        picker.style.position="fixed";

        // Today option
        var todayOpt=document.createElement("div"); todayOpt.style.cssText="padding:7px 14px;font-size:12px;cursor:pointer;color:#1a5fa8;font-weight:500;";
        todayOpt.textContent="\u2605 Today";
        todayOpt.onmouseover=function(){todayOpt.style.background="#f0f7ff";};
        todayOpt.onmouseout=function(){todayOpt.style.background="";};
        todayOpt.onclick=function(){
          var ids=getTodayIds(d); if(ids.indexOf(sid)===-1)ids.push(sid);
          saveTodayIds(d,ids); picker.parentNode.removeChild(picker); if(activeDest) drawDestMode(activeDest);
        };
        picker.appendChild(todayOpt);

        // Divider
        var div=document.createElement("div"); div.style.cssText="height:1px;background:#f0f0f0;margin:4px 0;"; picker.appendChild(div);

        // Day options
        d.days.forEach(function(day){
          var opt=document.createElement("div"); opt.style.cssText="padding:6px 14px;font-size:11px;cursor:pointer;color:#444;";
          opt.textContent=day.lbl;
          opt.onmouseover=function(){opt.style.background="#fafafa";};
          opt.onmouseout=function(){opt.style.background="";};
          (function(dayObj){opt.onclick=function(){
            // Move sight to this day
            var found=false;
            d.days.forEach(function(dy){
              var _tm=dy.items||dy.sights||[];for(var i=_tm.length-1;i>=0;i--){if(_tm[i].id===sid){_tm.splice(i,1);found=true;}}
            });
            if(d.discoveredItems){
              for(var j=d.discoveredItems.length-1;j>=0;j--){if(d.discoveredItems[j].id===sid)d.discoveredItems.splice(j,1);}
            }
            if(!found){
              // sight was in discovered — already removed above
            }
            // Add to target day
            var target=d.days.find(function(dy){return dy.id===dayObj.id;});
            if(target){
              var sight=allSights.find(function(x){return x.id===sid;});
              if(sight){if(!target.items)target.items=[];target.items.push({id:sight.id,type:sight.type||"sight",slot:sight.slot||"day",n:sight.n,p:sight.p,done:sight.done,st:sight.st||sight.n,note:null,time:""});}
            }
            picker.parentNode.removeChild(picker);
            _emitTripMutation();
          };})(day);
          picker.appendChild(opt);
        });

        document.body.appendChild(picker);
        // Dismiss on outside click
        setTimeout(function(){
          document.addEventListener("click",function dismiss(ev){
            if(!picker.contains(ev.target)){picker.parentNode&&picker.parentNode.removeChild(picker);document.removeEventListener("click",dismiss);}
          });
        },10);
      };})(s.id,dest,calBtn);
      acts.appendChild(calBtn);
    }
    if(s.done){
      var undoBtn=document.createElement("button"); undoBtn.className="ex-act"; undoBtn.textContent="Undo";
      (function(sid,d){undoBtn.onclick=function(){
        d.days.forEach(function(day){(day.items||day.sights||[]).forEach(function(x){if(x.id===sid)x.done=false;});});
        if(d.discoveredItems)d.discoveredItems.forEach(function(x){if(x.id===sid)x.done=false;});
        _emitTripMutation();
      };})(s.id,dest);
      acts.appendChild(undoBtn);
    }
    // Story button in pool context
    if(s.st||s.n){
      var stBtnP=document.createElement("button"); stBtnP.className="ex-act"; stBtnP.id="ssa-"+s.id; stBtnP.textContent="story \u2197";
      stBtnP.setAttribute("data-state","idle");
      (function(sid,did){stBtnP.onclick=function(){sStory(sid,did);};})(s.id,dest.id);
      acts.appendChild(stBtnP);
    }
  }
  row.appendChild(dot); row.appendChild(body); row.appendChild(acts);
  return row;
}
function switchTab(destId, tab) {
  ["route","stay","info","days","track"].forEach(function(t){
    var pane = g("tp-"+destId+"-"+t);
    var btn  = g("tb-"+destId+"-"+t);
    if(pane) pane.className = "tab-pane" + (t===tab?" on":"");
    if(btn)  btn.className  = "tab-btn"  + (t===tab?" on":"");
  });
}
