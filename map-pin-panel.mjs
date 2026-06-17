// @ts-check
// map-pin-panel.js — Map pin action panel (bottom sheet). Extracted verbatim from index.html (PD.473, bloat reduction).

// ── Map pin action panel (bottom sheet on map) ───────────────
function showMapPinPanel(item,dest,itemType,mapEvent){
  var panel=document.getElementById('map-pin-popup');
  var cont=document.getElementById('mpp-content');
  if(!panel||!cont) return;
  cont.innerHTML='';
  var typeEl=document.createElement('div'); typeEl.className='mpp-type';
  var typeLabels={'restaurant-suggestion':'Restaurant — not scheduled',
    'suggestion':'Sight — not scheduled','restaurant':'Restaurant',
    'sight':'Sight','hotel':'Hotel','info':'Location','transit':'Transit',
    'atm':'ATM','bank':'Bank','grocery':'Grocery','tourist-info':'Tourist info','pharmacy':'Pharmacy'};
  typeEl.textContent=typeLabels[itemType]||itemType||'Location';
  cont.appendChild(typeEl);
  var nameEl=document.createElement('div'); nameEl.className='mpp-name'; nameEl.textContent=item.n||item.name||'';
  // Round DF: external link beside the name for sights/restaurants
  if (itemType === 'sight' || itemType === 'suggestion' || itemType === 'restaurant' || itemType === 'restaurant-suggestion') {
    var _mppExt = _sightExternalUrl(item, dest && dest.place);
    if (_mppExt) {
      var _mppA = document.createElement('a');
      _mppA.href = _mppExt.url; _mppA.target = '_blank'; _mppA.rel = 'noopener noreferrer';
      _mppA.textContent = _mppExt.label;
      _mppA.style.cssText = 'margin-left:8px;font-size:11px;color:' + (_mppExt.isOfficial ? '#1a5fa8' : '#999') + ';text-decoration:none;font-weight:600;';
      _mppA.onclick = function(e){ e.stopPropagation(); };
      nameEl.appendChild(_mppA);
    }
  }
  cont.appendChild(nameEl);
  if(item.note){var noteEl=document.createElement('div'); noteEl.className='mpp-note'; noteEl.textContent=item.note; cont.appendChild(noteEl);}
  var acts=document.createElement('div'); acts.className='mpp-actions';
  var isUnscheduled=(itemType==='suggestion'||itemType==='restaurant-suggestion');
  var isUtility=(itemType==='hotel'||itemType==='info'||itemType==='transit'||itemType==='atm'||itemType==='grocery');
  // Story button — only for sights and restaurants
  var storyTypes=['suggestion','restaurant-suggestion','sight','restaurant'];
  if(storyTypes.indexOf(itemType)>-1){
    var stb=document.createElement('button'); stb.className='mpp-btn'; stb.textContent='Story \u2197';
    // v353.2: id required so sStory's `g("ssa-" + sid)` lookup
    // succeeds \u2014 without it the function bailed silently and the
    // tap did nothing. Also: keep the popup OPEN after the tap
    // (was hidden immediately after click, which meant the LLM
    // would respond into a hidden popup the user never saw).
    stb.id = 'ssa-' + item.id;
    (function(sid,did){stb.onclick=function(){sStory(sid,did);};})(item.id,dest.id);
    acts.appendChild(stb);
  }
  if(isUtility){ /* no actions for hotel/transit/utility pins */ } else if(isUnscheduled){
    var addBtn=document.createElement('button'); addBtn.className='mpp-btn primary'; addBtn.textContent='Add to day \u2192';
    (function(it,tp){addBtn.onclick=function(e){
      var btnRect=panel.getBoundingClientRect();
      panel.style.display='none';
      showAddToDay(it,tp,dest,addBtn,{x:btnRect.left,y:btnRect.top,execDayId:_mapExecMode?_mapExecMode.dayId:null});
    };})(item,itemType==='restaurant-suggestion'?'restaurant':'sight');
    acts.appendChild(addBtn);
  } else {
    // Scheduled: done, move, delete
    var doneBtn=document.createElement('button'); doneBtn.className='mpp-btn done-btn';
    doneBtn.textContent=item.done?'Undo':'Done \u2713';
    if(item.done) doneBtn.style.background='#e8f5ee';
    (function(sid,did){doneBtn.onclick=function(){
      var sx=fS(sid,did); if(!sx)return; sx.done=!sx.done; autoSave();
      doneBtn.textContent=sx.done?'Undo':'Done \u2713';
      doneBtn.style.background=sx.done?'#e8f5ee':'';
      updateMainMap();
    };})(item.id,dest.id);
    acts.appendChild(doneBtn);
    var dayOfItem=fDayOf(item.id,dest.id);
    var moveBtn=document.createElement('button'); moveBtn.className='mpp-btn'; moveBtn.textContent='Move';
    (function(sid,did,dayId,isEve){moveBtn.onclick=function(e){
      e.stopPropagation(); panel.style.display='none';
      togMov(sid,dayId,did,e,isEve);
    };})(item.id,dest.id,dayOfItem?dayOfItem.id:null,item.slot==='evening');
    acts.appendChild(moveBtn);
    var delBtn=document.createElement('button'); delBtn.className='mpp-btn'; delBtn.style.color='#e05050'; delBtn.textContent='\u2715 Remove';
    (function(sid,did,dayId){delBtn.onclick=function(){delS(sid,dayId,did);panel.style.display='none';updateMainMap();};})(item.id,dest.id,dayOfItem?dayOfItem.id:null);
    acts.appendChild(delBtn);
  }
  cont.appendChild(acts);

  // Position popup above the clicked pin
  panel.style.display='block';
  if(mapEvent&&mapEvent.containerPoint){
    var cp=mapEvent.containerPoint;
    var rp=document.querySelector('.rp');
    var rpRect=/** @type {any} */ (rp?rp.getBoundingClientRect():{left:0,top:0});
    var pw=panel.offsetWidth||260;
    var ph=panel.offsetHeight||140;
    var x=cp.x-pw/2;
    var y=cp.y-ph-14; // 14px above the pin
    var maxX=rpRect.width-pw-8;
    x=Math.max(8,Math.min(x,maxX));
    if(y<8){y=cp.y+28;} // flip below if too close to top
    panel.style.left=x+'px';
    panel.style.top=y+'px';
  } else {
    // Fallback: center-ish
    var rp2=/** @type {HTMLElement} */ (document.querySelector('.rp'));
    var w2=rp2?rp2.offsetWidth:800;
    panel.style.left=Math.max(8,(w2-260)/2)+'px';
    panel.style.top='80px';
  }
}

// Cities with complete hand-curated static data — everything else triggers AI generation
// All destinations now route through generateCityData. Static shortcuts removed.
function ensureSuggestions(dest){
  if(!dest.suggestions||dest.suggestions.length===0){
    // Round ET: always call generateCityData when this dest's
    // suggestions are empty. If _generatedCityData[key] already has
    // cached data, EM's cache-hit branch inside generateCityData will
    // copy those sights into THIS dest's suggestions and run
    // auto-seed for it. The previous gate (`if(!_generatedCityData[
    // key])`) skipped that path, leaving the second/third dest with
    // the same place name (round-trip Zurich, repeat hubs) stuck
    // with empty Itinerary forever. Symptom Neal saw: first Zurich
    // stay had no sights even after EM shipped.
    generateCityData(dest.place,dest.id);
  }
}

async function fetchCityMeta(dest){
  // Fills in missing districts/practicalInfo/transitHub/essentials for saved generated cities
  var hasEssentials=(dest.suggestions||[]).some(function(s){return ["atm","bank","grocery","tourist-info","pharmacy"].indexOf(s.type)>-1;});
  if(dest.generatedDistricts&&dest.generatedPracticalInfo&&hasEssentials) return; // already have it
  var lockKey='_metaLoading_'+dest.id;
  if(window[lockKey]) return;
  window[lockKey]=true;
  try{
    var prompt='For '+dest.place+', return ONLY a JSON object with these fields:\n'+
      '{"districts":[{"name":"...","good":"...","bad":"...","hotels":[{"name":"...","desc":"...","price":"...","tier":2}]}],'+
      '"practicalInfo":{"currency":"...","tipping":"...","note":"...","emergency":"..."},'+
      '"transitHub":{"arrival":{"name":"...","lat":0,"lng":0},"departure":{"name":"...","lat":0,"lng":0}},'+
      '"essentials":{"atms":[{"name":"...","note":"..."}],"banks":[{"name":"...","note":"..."}],"groceries":[{"name":"...","note":"..."}],"touristInfo":[{"name":"...","note":"..."}],"pharmacies":[{"name":"...","note":"..."}]}}\n'+
      '2-3 districts with 1-2 hotels each. Essentials are ALL required — do not omit any field. Include 2-3 ATMs, 1-2 banks (named branches — UBS, Raiffeisen, Barclays, BNP, etc. — whatever operates locally), 2-3 groceries, 1 tourist info, AND 1-2 pharmacies (chemists / drugstores / Apotheke / farmacia / pharmacie — whatever the local term). Real named places. Be specific.';
    var text=await callMax([{role:'user',content:prompt}],1800);
    var json=text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    var s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s>-1&&e>-1) json=json.substring(s,e+1);
    var data=JSON.parse(json);
    if(data.districts) dest.generatedDistricts=data.districts;
    if(data.practicalInfo) dest.generatedPracticalInfo=data.practicalInfo;
    if(data.transitHub) dest.generatedTransitHub=data.transitHub;
    if(data.essentials){
      mergeEssentialsIntoSuggestions(dest,data.essentials);
      geocodeEssentials(dest);
    }
    // TM.4 (v328): emit replaces autoSave + conditional redraw.
    // The bus listener already gates on _leftMode === "dest" + activeDest.
    _emitTripMutation();
  }catch(e){ console.error('fetchCityMeta failed:',e); }
  window[lockKey]=false;
}

// ────────────────────────────────────────────────────────────────────────
// PD.241 — SOURCES MODEL for destination sights
//
// `dest.suggestions` was a free-for-all mutable array; any code anywhere
// could replace it, append to it, or filter it. The pipeline that adds
// user-listed sights (classifier → PD.223) would commit data sync during
// publishTrip, then async paths (generateCityData, auto-seed dedup, etc.)
// would later overwrite or filter it, silently wiping user data.
//
// This module introduces typed SOURCES on each destination:
//
//   dest._sightSources = {
//     user:      [],   // PD.223 attaches here (classifier output)
//     llm:       [],   // generateCityData writes here
//     essentials:[],   // mergeEssentialsIntoSuggestions writes here
//     userAdded: [],   // user UI actions (custom add, drag-to-dest)
//   }
//
// `dest.suggestions` becomes the COMPUTED VIEW: union of all sources,
// minus any item whose name already appears on a day in `dest.days`.
// Recompute is called after every source change.
//
// Migration is automatic: the first time _initSightSources is called on
// a destination, it inspects current `dest.suggestions` and buckets each
// item into the right source (by `_fromUserList`, by `type === "atm"`
// etc., default LLM). Existing trips work without re-import.
// ────────────────────────────────────────────────────────────────────────

function _initSightSources(dest) {
  if (!dest) return;
  if (dest._sightSources) {
    // PD.269: ensure new buckets exist on objects minted before PD.269.
    if (!dest._sightSources.considered) dest._sightSources.considered = [];
    if (!dest._sightSources.rejected)   dest._sightSources.rejected   = [];
    return;
  }
  // PD.269: added `considered` (user unchecked but kept around as "maybe"
  // — render as grey "+ Add" rows under their parent destination) and
  // `rejected` (user said no — used purely as a dedup filter against the
  // LLM and other sources; never rendered).
  dest._sightSources = {
    user: [], llm: [], essentials: [], userAdded: [],
    considered: [], rejected: []
  };
  var ESSENTIAL_TYPES = { atm:1, bank:1, grocery:1, "tourist-info":1, pharmacy:1, transit:1 };
  (Array.isArray(dest.suggestions) ? dest.suggestions : []).forEach(function(s) {
    if (!s) return;
    if (s._fromUserList) {
      dest._sightSources.user.push(s);
    } else if (s.type && ESSENTIAL_TYPES[s.type]) {
      dest._sightSources.essentials.push(s);
    } else {
      dest._sightSources.llm.push(s);
    }
  });
}

function _placedDayItemNamesSet(dest) {
  var placed = Object.create(null);
  (dest.days || []).forEach(function(day){
    (day.items || []).forEach(function(it){
      if (it && it.n) placed[it.n.toLowerCase()] = true;
    });
  });
  return placed;
}

// PD.269: token-subset matcher used by _recomputeSuggestions for
// rejected-list filtering and considered/LLM dedup. Lifted to module
// scope so the LLM-dedup pass at day-plan completion can call it too.
function _sightTokensMatchAny(name, tokenSets) {
  if (!name || !tokenSets || !tokenSets.length) return false;
  var nrm = (typeof globalThis._normPlaceName === "function")
    ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var userToks = (nrm(name) || "").split(/\s+/).filter(Boolean);
  if (!userToks.length) return false;
  var userSet = {};
  userToks.forEach(function(t){ userSet[t] = true; });
  for (var i = 0; i < tokenSets.length; i++) {
    var set = tokenSets[i];
    if (!set) continue;
    var setKeys = Object.keys(set);
    if (!setKeys.length) continue;
    var userInSet = userToks.every(function(t){ return set[t]; });
    var setInUser = setKeys.every(function(t){ return userSet[t]; });
    if (userInSet || setInUser) return true;
  }
  return false;
}

function _buildRejectedTokenSets(dest) {
  if (!dest || !dest._sightSources || !dest._sightSources.rejected) return [];
  var nrm = (typeof globalThis._normPlaceName === "function")
    ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  return dest._sightSources.rejected.map(function(r) {
    var name = r && (r.n || r.name);
    var toks = nrm(name || "").split(/\s+/).filter(Boolean);
    var set = {};
    toks.forEach(function(t){ set[t] = true; });
    return set;
  });
}

function _recomputeSuggestions(dest) {
  if (!dest) return;
  _initSightSources(dest);
  var placed = _placedDayItemNamesSet(dest);
  var rejectedSets = _buildRejectedTokenSets(dest);
  var merged = [];
  var seen = Object.create(null);
  // Priority order: user first, then LLM, then essentials, then userAdded,
  // then considered last. First occurrence wins for canonical fields;
  // user source upgrades any duplicate with the _fromUserList flag;
  // considered source upgrades with _considered:true so the renderer
  // can render greyed "+ Add" rows.
  // PD.269: rejected items are filtered out via token-subset match —
  // anything whose tokens match a rejected entry is suppressed across
  // all sources.
  // PD.272: considered items dedupe against earlier-priority sources
  // (user/LLM/essentials/userAdded) via token-subset match too. The
  // user considered "Skaftafell" and Max independently suggests
  // "Skaftafell Glacier Outlets" — those are the same place. Drop
  // the considered duplicate and mark the merged entry with
  // _alsoConsidered:true so the renderer can show a "you considered
  // this too" affirmation.
  var nrm = (typeof globalThis._normPlaceName === "function")
    ? globalThis._normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  ["user", "llm", "essentials", "userAdded", "considered"].forEach(function(srcName) {
    (dest._sightSources[srcName] || []).forEach(function(item) {
      if (!item || !item.n) return;
      var key = item.n.toLowerCase();
      if (placed[key]) return;
      if (_sightTokensMatchAny(item.n, rejectedSets)) return;
      // Exact-key dupe across sources.
      if (seen[key] !== undefined) {
        if (srcName === "user") {
          merged[seen[key]]._fromUserList = true;
          if (item._parentRelation) merged[seen[key]]._parentRelation = item._parentRelation;
        } else if (srcName === "considered") {
          merged[seen[key]]._alsoConsidered = true;
        }
        return;
      }
      // PD.272: token-subset dupe — applies to the considered source
      // only. Scan merged for any entry whose tokens overlap (either
      // direction). If found, this considered entry is the same place
      // the LLM/user already surfaced; mark and skip.
      if (srcName === "considered") {
        var itemToks = (nrm(item.n) || "").split(/\s+/).filter(Boolean);
        if (itemToks.length) {
          var dupIdx = -1;
          for (var mi = 0; mi < merged.length; mi++) {
            var mItem = merged[mi];
            if (!mItem || !mItem.n) continue;
            var mToks = (nrm(mItem.n) || "").split(/\s+/).filter(Boolean);
            if (!mToks.length) continue;
            var mSet = {}; mToks.forEach(function(t){ mSet[t] = true; });
            var iSet = {}; itemToks.forEach(function(t){ iSet[t] = true; });
            var itemInM = itemToks.every(function(t){ return mSet[t]; });
            var mInItem = mToks.every(function(t){ return iSet[t]; });
            if (itemInM || mInItem) { dupIdx = mi; break; }
          }
          if (dupIdx >= 0) {
            merged[dupIdx]._alsoConsidered = true;
            return;
          }
        }
      }
      var clone = Object.assign({}, item);
      if (srcName === "user") clone._fromUserList = true;
      if (srcName === "considered") clone._considered = true;
      merged.push(clone);
      seen[key] = merged.length - 1;
    });
  });
  dest.suggestions = merged;
}

// Public mutators — every writer that wants to change a destination's
// sights goes through one of these. They mutate the corresponding source
// and recompute dest.suggestions.

function _setLLMSights(dest, sights) {
  if (!dest) return;
  _initSightSources(dest);
  dest._sightSources.llm = (Array.isArray(sights) ? sights : []).slice();
  _recomputeSuggestions(dest);
}

function _addUserListedSight(dest, sight) {
  if (!dest || !sight) return;
  _initSightSources(dest);
  var key = (sight.n || "").toLowerCase();
  if (!key) return;
  var existingIdx = dest._sightSources.user.findIndex(function(s) {
    return s && s.n && s.n.toLowerCase() === key;
  });
  var clone = Object.assign({}, sight, { _fromUserList: true });
  if (existingIdx >= 0) {
    dest._sightSources.user[existingIdx] = clone;
  } else {
    dest._sightSources.user.push(clone);
  }
  _recomputeSuggestions(dest);
}

function _addEssentialsSights(dest, sights) {
  if (!dest) return;
  _initSightSources(dest);
  var existingNames = {};
  dest._sightSources.essentials.forEach(function(s) {
    if (s && s.n) existingNames[s.n.toLowerCase()] = true;
  });
  (sights || []).forEach(function(s) {
    if (!s || !s.n) return;
    if (existingNames[s.n.toLowerCase()]) return;
    dest._sightSources.essentials.push(s);
    existingNames[s.n.toLowerCase()] = true;
  });
  _recomputeSuggestions(dest);
}

function _addUserAddedSight(dest, sight) {
  if (!dest || !sight) return;
  _initSightSources(dest);
  dest._sightSources.userAdded.push(sight);
  _recomputeSuggestions(dest);
}

function _removeSightById(dest, sightId) {
  if (!dest || !sightId) return;
  _initSightSources(dest);
  ["user", "llm", "essentials", "userAdded", "considered"].forEach(function(srcName) {
    dest._sightSources[srcName] = (dest._sightSources[srcName] || []).filter(function(s) {
      return s && s.id !== sightId;
    });
  });
  _recomputeSuggestions(dest);
}

// PD.269: considered sights — user unchecked them in Discovery but
// didn't reject. Render as grey "+ Add" rows. _addConsideredSight is
// idempotent (matches by lowercased n).
function _addConsideredSight(dest, sight) {
  if (!dest || !sight) return;
  _initSightSources(dest);
  var key = (sight.n || "").toLowerCase();
  if (!key) return;
  var existingIdx = dest._sightSources.considered.findIndex(function(s) {
    return s && s.n && s.n.toLowerCase() === key;
  });
  var clone = Object.assign({}, sight, { _considered: true, _keep: false });
  if (existingIdx >= 0) {
    dest._sightSources.considered[existingIdx] = clone;
  } else {
    dest._sightSources.considered.push(clone);
  }
  _recomputeSuggestions(dest);
}

// PD.269: rejected sights — user said no. Stored just for token-subset
// dedup against the LLM and other sources. Only the name is needed.
function _addRejectedSight(dest, sight) {
  if (!dest || !sight) return;
  _initSightSources(dest);
  var name = (sight.n || sight.name || "").trim();
  if (!name) return;
  var existing = dest._sightSources.rejected.find(function(r) {
    return r && (r.n || r.name) && String(r.n || r.name).toLowerCase() === name.toLowerCase();
  });
  if (existing) return;
  dest._sightSources.rejected.push({ n: name });
  _recomputeSuggestions(dest);
}

// PD.269: promote a considered sight to a kept item. Removes from
// considered, returns the sight object so the caller can route it
// (e.g., add to a specific day, or to userAdded if it's a standalone
// sight). _recomputeSuggestions runs once after the caller decides.
function _promoteConsideredSight(dest, sightId) {
  if (!dest || !sightId) return null;
  _initSightSources(dest);
  var idx = dest._sightSources.considered.findIndex(function(s) {
    return s && s.id === sightId;
  });
  if (idx < 0) return null;
  var sight = dest._sightSources.considered[idx];
  dest._sightSources.considered.splice(idx, 1);
  var clone = Object.assign({}, sight);
  delete clone._considered;
  delete clone._keep;
  return clone;
}

// Expose globally so engine-picker.js can call these.
if (typeof globalThis !== "undefined") {
  globalThis._initSightSources    = _initSightSources;
  globalThis._setLLMSights        = _setLLMSights;
  globalThis._addUserListedSight  = _addUserListedSight;
  globalThis._addEssentialsSights = _addEssentialsSights;
  globalThis._addUserAddedSight   = _addUserAddedSight;
  globalThis._removeSightById     = _removeSightById;
  globalThis._recomputeSuggestions = _recomputeSuggestions;
  // PD.269
  globalThis._addConsideredSight  = _addConsideredSight;
  globalThis._addRejectedSight    = _addRejectedSight;
  globalThis._promoteConsideredSight = _promoteConsideredSight;
  globalThis._sightTokensMatchAny = _sightTokensMatchAny;
}

// Auto-seed LLM-flagged iconic sights into a destination's day plan so the
// user lands on a plausible schedule rather than an empty grid. Non-iconic
// sights stay in dest.suggestions for the user to opt into via the Explore
// tab. Idempotent: skips any sight whose name already exists as a day item,
// so Refresh doesn't double-add.
//
// Round DB — duration-aware. Each sight carries a `durationHours` estimate
// from the LLM (Pilatus 5-6h, Chapel Bridge 1h, Uffizi 3h). The seeder gives
// each day a "sight budget" (4h on arrival/departure book-ends, 6h on middle
// days) and packs sights in until the budget is full. A sight ≥4h takes the
// whole day on its own; two short sights (each ≤2-3h) pair up. This avoids
// landing two mountain-railway trips on the same day, which the old
// fixed-cap-of-2 logic happily did.
function _autoSeedIconicSightsToDays(dest){
  // Round EL: explicit logging so we can see why a destination's
  // Itinerary stays empty after auto-seed.
  var _logTag = "[Max autoSeed " + (dest && dest.place || "?") + "]";
  if (!dest) { console.log(_logTag, "skip: no dest"); return; }
  if (!Array.isArray(dest.suggestions)) { console.log(_logTag, "skip: no suggestions array"); return; }
  if (!dest.suggestions.length) { console.log(_logTag, "skip: suggestions empty"); return; }
  if (!Array.isArray(dest.days)) { console.log(_logTag, "skip: no days array"); return; }
  if (!dest.days.length) { console.log(_logTag, "skip: days array empty"); return; }
  // PD.235 (architectural): "iconic" was the wrong filter. The right
  // concept is "important enough to pre-seed into the day plan
  // without asking the user." That set is iconic OR user-listed.
  // The LLM speaks for "everyone considers this canonical"; the user
  // speaks for "I personally want this." Both belong on the day
  // plan by default. Without this, sights that the user explicitly
  // listed but that the LLM didn't flag iconic (Monument to the
  // Unknown Bureaucrat, niche museums, personal interest stops)
  // ended up in suggestions but never on the day, and the user had
  // to manually drag them over — even though they were the most
  // explicit signal of intent in the whole picker.
  // PD.342: also consult the DURABLE listed-names map — flag
  // propagation has dropped _fromUserList on some paths (Harpa
  // Concert Hall sat in "sights you identified" while the Monument
  // got a day slot). The map is the source of truth for "the user
  // asked for this."
  var _listedMapSeed = (typeof trip !== "undefined" && trip && trip.brief && trip.brief._userListedNames) || {};
  var _nrmSeed = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){ return String(s||"").toLowerCase().trim(); };
  var iconic = dest.suggestions.filter(function(s){
    if (s.iconic || s._fromUserList) return true;
    var _sk = _nrmSeed(s.n || s.name || "");
    return !!(_sk && _listedMapSeed[_sk]);
  });
  console.log(_logTag, "suggestions:", dest.suggestions.length, "auto-seed candidates (iconic ∪ user-listed):", iconic.length, "days:", dest.days.length);
  // Round EK: fallback when LLM returned no iconic flags. Some prompts
  // (or older cached responses) come back without `iconic` set on any
  // sight, leaving the destination's Itinerary tab empty even when
  // Explore is full. Take the first 4 sights by LLM order so the user
  // lands on a starting plan they can edit, not a blank grid.
  if (!iconic.length) {
    iconic = dest.suggestions.slice(0, 4);
    console.log(_logTag, "no iconic flags; falling back to first", iconic.length);
    if (!iconic.length) return;
  }

  // Build a set of existing day-item names so we don't duplicate on regen.
  var existingNames = {};
  var existingCount = 0;
  dest.days.forEach(function(day){
    (day.items || []).forEach(function(item){
      if (item.type === "sight" && item.n) { existingNames[item.n.toLowerCase()] = true; existingCount++; }
    });
  });
  iconic = iconic.filter(function(s){ return !existingNames[(s.n || "").toLowerCase()]; });
  console.log(_logTag, "after dedupe vs", existingCount, "existing items, iconic to place:", iconic.length);
  if (!iconic.length) return;

  // Prefer middle days for iconic sights — the user often wants lighter
  // arrival/departure days. If there aren't many days, just use all of them.
  var dayCount = dest.days.length;
  var dayOrder = [];
  if (dayCount >= 4) {
    for (var i = 1; i < dayCount - 1; i++) dayOrder.push(i);
    dayOrder.push(0); dayOrder.push(dayCount - 1);
  } else {
    for (var j = 0; j < dayCount; j++) dayOrder.push(j);
  }

  // v302: per-day sight-time budget reads from trip.brief.hoursPerDay
  // (default 6 for trips that pre-date the structured fields). Travel
  // days (arrival + departure) get min(hoursPerDay, 4) since landing at
  // noon and racing to a 6-hour cogwheel rarely works.
  // v353.4: per-trip override if set, else live MaxDB.prefs.paceHours,
  // else legacy default 6. Same fallback chain for maxBigSightsPerDay.
  // Means changing the welcome-modal pace flows into trips that didn't
  // explicitly override their pace at brief time.
  function _livePaceHours() {
    try {
      var p = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("paceHours"), 10) : NaN;
      if (isFinite(p) && p >= 2 && p <= 10) return p;
    } catch (_) {}
    return 6;
  }
  function _liveMaxBigSights() {
    try {
      var sp = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("sightsPerDay"), 10) : NaN;
      // v353.4: direct mapping — welcome's "sights" pref IS the max
      // big sights cap. Clamp to [1,6] to match the picker brief.
      if (isFinite(sp) && sp >= 1 && sp <= 6) return sp;
      if (isFinite(sp) && sp > 6) return 6;
    } catch (_) {}
    return 2;
  }
  var _briefHpd = (trip && trip.brief && typeof trip.brief.hoursPerDay === "number")
    ? trip.brief.hoursPerDay : _livePaceHours();
  var _briefMaxBig = (trip && trip.brief && typeof trip.brief.maxBigSightsPerDay === "number")
    ? trip.brief.maxBigSightsPerDay : _liveMaxBigSights();
  var _travelBudget = Math.min(_briefHpd, 4);
  function budgetForDay(dIdx) {
    if (dayCount <= 1) return _travelBudget;
    if (dIdx === 0 || dIdx === dayCount - 1) return _travelBudget;
    return _briefHpd;
  }
  function durationOf(s) {
    var d = (s && typeof s.durationHours === "number") ? s.durationHours : 0;
    if (d > 0) return d;
    return 2;
  }
  function hoursOnDay(dIdx) {
    var h = 0;
    (dest.days[dIdx].items || []).forEach(function(it){
      if (it.type !== "sight") return;
      h += (typeof it.durationHours === "number" && it.durationHours > 0) ? it.durationHours : 2;
    });
    return h;
  }
  // v302: count "big" sights (>= 2h durationHours) already on a day —
  // user-set cap prevents stacking too many demanding sights.
  function bigSightsOnDay(dIdx) {
    var n = 0;
    (dest.days[dIdx].items || []).forEach(function(it){
      if (it.type !== "sight") return;
      var h = (typeof it.durationHours === "number" && it.durationHours > 0) ? it.durationHours : 2;
      if (h >= 2) n++;
    });
    return n;
  }

  var placedIds = {};
  // Walk iconic sights in their LLM-supplied order. For each, place on the
  // first day in dayOrder that has remaining budget for it. A long sight
  // (>=4h) requires an empty day — if used > 0, skip.
  iconic.forEach(function(s){
    var dur = durationOf(s);
    var isBig = dur >= 2;
    for (var k = 0; k < dayOrder.length; k++) {
      var dIdx = dayOrder[k];
      var used = hoursOnDay(dIdx);
      var budget = budgetForDay(dIdx);
      if (dur >= 4 && used > 0) continue;            // half-day+ wants the day to itself
      if (used + dur > budget) continue;              // doesn't fit
      // v302: respect the user-set max big sights per day cap.
      if (isBig && bigSightsOnDay(dIdx) >= _briefMaxBig) continue;
      var day = dest.days[dIdx];
      if (!day.items) day.items = [];
      sidCtr++;
      day.items.push({
        id: "s" + sidCtr,
        type: "sight",
        slot: "day",
        n: s.n,
        p: "must",
        done: false,
        st: s.st || s.n,
        note: s.note || null,
        timeStart: null,
        timeEnd: null,
        lat: s.lat || null,
        lng: s.lng || null,
        durationHours: (typeof s.durationHours === "number" && s.durationHours > 0) ? s.durationHours : null,
        url: s.url || null,
        autoSeeded: true,
        // SCAFFOLD-2: Max put this here, user hasn't confirmed yet.
        // commitmentState() reads this; cleared when user clicks Keep,
        // edits, drags, or sets a time on the row.
        tentative: true
      });
      placedIds[s.id] = true;
      break;
    }
  });

  // PD.241: don't filter dest.suggestions imperatively anymore.
  // _recomputeSuggestions automatically excludes any item whose name
  // matches a day item — same outcome, but the source data isn't
  // mutated, which means user-listed sights survive across all the
  // async writes that used to wipe them.
  if (Object.keys(placedIds).length && typeof _recomputeSuggestions === "function") {
    _recomputeSuggestions(dest);
  }
  console.log(_logTag, "placed:", Object.keys(placedIds).length, "items across", dest.days.length, "days");
}

// PD.241: routes through _addEssentialsSights (sources model) so the
// essentials live in their own source bucket and survive across LLM
// replacements. The dedup-by-name behavior is preserved inside
// _addEssentialsSights.
function mergeEssentialsIntoSuggestions(dest, essentials){
  if (!dest || !essentials) return;
  var center = getCityCenter(dest.place);
  var collected = [];
  function collect(type, list){
    (list || []).forEach(function(item){
      if (!item || !item.name) return;
      sidCtr++;
      var lat = center ? center[0] + (Math.random() - .5) * .003 : null;
      var lng = center ? center[1] + (Math.random() - .5) * .004 : null;
      collected.push({
        id: "s" + sidCtr, type: type, n: item.name, st: item.name,
        note: item.note || null, lat: lat, lng: lng, approx: true
      });
    });
  }
  collect("atm",          essentials.atms);
  collect("bank",         essentials.banks);
  collect("grocery",      essentials.groceries);
  collect("tourist-info", essentials.touristInfo);
  collect("pharmacy",     essentials.pharmacies);
  if (collected.length) _addEssentialsSights(dest, collected);
}

// Round CL: Nominatim circuit breaker. The free Nominatim service rate-
// limits at ~1 req/sec; bursts get 429s and the IP can be blacklisted.
// CORS-blocked fetches also fail fast from localhost. Once we hit either,
// stop hammering for the rest of the session — the user can refresh the
// page to retry. Saves their browser from getting blocklisted and avoids
// 200 console errors per page.
var _nominatimBlocked = false;
function _markNominatimBlocked(reason){
  if (_nominatimBlocked) return;
  _nominatimBlocked = true;
  console.warn("[Max] Nominatim disabled for session: " + reason);
}

// Geocode any essential-type suggestion that's still approx via Nominatim (throttled).
async function geocodeEssentials(dest){
  if (_nominatimBlocked) return; // skip silently
  var types=["atm","bank","grocery","tourist-info","pharmacy"];
  var pending=(dest.suggestions||[]).filter(function(s){
    return types.indexOf(s.type)>-1 && s.approx;
  });
  var didAnyChange = false;
  for(var i=0;i<pending.length;i++){
    if (_nominatimBlocked) break;
    var s=pending[i];
    try{
      // Round CL: bumped from 400ms to 1100ms — Nominatim rate limits at
      // 1 req/sec, sub-second bursts get 429s.
      await new Promise(function(r){setTimeout(r,1100);});
      var q=encodeURIComponent(s.n+', '+dest.place);
      var r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+q,{headers:{'Accept-Language':'en'}});
      if (r.status === 429 || r.status === 403) {
        _markNominatimBlocked("rate-limited (HTTP " + r.status + ")");
        break;
      }
      if (!r.ok) continue;
      var res=await r.json();
      if(res.length){
        s.lat=parseFloat(res[0].lat);
        s.lng=parseFloat(res[0].lon);
        s.approx=false;
        didAnyChange = true;
      }
    }catch(ge){
      // CORS or network error — also a circuit-breaker condition
      _markNominatimBlocked("fetch failed (likely CORS or network)");
      break;
    }
    // Update map silently as coords arrive
    if(i%3===2&&activeDest===dest.id) updateMainMap();
  }
  if(activeDest===dest.id) updateMainMap();
  // Only save if we actually changed something — avoids triggering a
  // Quota error save when no coords were resolved.
  if (didAnyChange) autoSave();
}

async function generateCityData(place,destId,_isAutoRetry){
  var key=place.toLowerCase();
  // Round EM: when generateCityData is called for a place whose data
  // is already loaded, populate destRef from the cached data so this
  // dest also gets suggestions + auto-seed. Without this, a round
  // trip with two Zurich destinations (arrival + departure) only
  // populates whichever dest was first to call generateCityData; the
  // second dest stays empty because the cache guard early-returns
  // before suggestions get copied to its dest object. Symptom: Neal
  // saw arrival-Zurich empty while departure-Zurich was populated.
  if(!_isAutoRetry && _generatedCityData[key] && !_generatedCityData[key].loading){
    var _cached = _generatedCityData[key];
    var _destRef = (typeof getDest === "function") ? getDest(destId) : null;
    // PD.241: cached path routes through _setLLMSights. The sources
    // model preserves user-listed items across the replace, so the
    // cached result can land even if PD.223 already added user sights.
    if (_destRef && _cached.sights) {
      var _genCenter = _cached.cityCenter && _cached.cityCenter[0] ? _cached.cityCenter : (typeof getCityCenter === "function" ? getCityCenter(_destRef.place) : null);
      var _cachedNewList = (Array.isArray(_cached.sights) ? _cached.sights : []).map(function(s){
        sidCtr++;
        var sLat = s.lat || (_genCenter ? _genCenter[0] + (Math.random() - .5) * .003 : null);
        var sLng = s.lng || (_genCenter ? _genCenter[1] + (Math.random() - .5) * .004 : null);
        return {id:"s"+sidCtr, type:"sight", n:s.name, st:s.st||s.name, note:s.desc||null, lat:sLat, lng:sLng, approx:!s.lat, iconic:!!s.iconic, durationHours:(typeof s.durationHours==="number"&&s.durationHours>0)?s.durationHours:null, url:s.url||null};
      });
      _setLLMSights(_destRef, _cachedNewList);
      if (_cached.districts && !_destRef.generatedDistricts) _destRef.generatedDistricts = _cached.districts;
      if (_cached.practicalInfo && !_destRef.generatedPracticalInfo) _destRef.generatedPracticalInfo = _cached.practicalInfo;
      if (_cached.transitHub && !_destRef.generatedTransitHub) _destRef.generatedTransitHub = _cached.transitHub;
      if (typeof _autoSeedIconicSightsToDays === "function") _autoSeedIconicSightsToDays(_destRef);
      if (typeof autoSave === "function") autoSave();
      if (activeDest === destId && _leftMode === "dest" && typeof drawDestMode === "function") drawDestMode(destId);
    }
    return;
  }
  _generatedCityData[key]={loading:true};

  // First: geocode the city via Nominatim so map shows correct location even with no API key
  // Round CL.5: gate behind the same circuit breaker as geocodeEssentials.
  // v359.60.23: scope the Nominatim query to the trip's region so
  // ambiguous place names ("Selfoss" exists in both Iceland and
  // France, "Húsavík" exists in Iceland and the Faroe Islands)
  // disambiguate to the correct hit. The bare-name query was
  // landing one Iceland-list destination in southern France. Falls
  // back to the unscoped query if no region is set on the brief.
  if(!_nominatimBlocked){
    try{
      var _gcRegion = (trip && trip.brief && trip.brief.region) ? trip.brief.region : "";
      var _gcQuery = _gcRegion ? (place + ", " + _gcRegion) : place;
      var geoResp=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(_gcQuery),{headers:{'Accept-Language':'en'}});
      if (geoResp.status === 429 || geoResp.status === 403) {
        _markNominatimBlocked("rate-limited (HTTP " + geoResp.status + ")");
      } else if (geoResp.ok) {
        var geoData=await geoResp.json();
        if(geoData.length&&_generatedCityData[key]){
          _generatedCityData[key].cityCenter=[parseFloat(geoData[0].lat),parseFloat(geoData[0].lon)];
          _generatedCityData[key].loading=true; // still loading full data
          if(activeDest===destId&&_leftMode==='dest') updateMainMap();
        }
      }
    }catch(e){
      _markNominatimBlocked("fetch failed (likely CORS or network)");
    }
  }

  showSaveStatus('Max is generating '+place+' data\u2026',60000);

  var _paceModeGD = _getPaceMode((trip && trip.brief && trip.brief.pace) || (_tb && _tb.pace) || "");
  var _sightsCountGD = _paceSightCount(_paceModeGD);
  var _paceDirGD = _paceDirective(_paceModeGD);
  // Detect region/pass/area-style destination names so the prompt can tell the
  // model it's okay if this isn't a single city. Without this, "Bernina Pass
  // Region" or "Engadin Valley" come back empty because the LLM was told to
  // list sights in a city that doesn't exist by that exact name.
  var _regionLike = /\b(region|area|pass|valley|plateau|peninsula|coast|highlands|lakes?)\b/i.test(place);
  var _placeFraming = _regionLike
    ? 'This place is a broader area (a mountain pass, valley, alpine region, or similar), not a single city. List sights across the area — viewpoints, lakes, passes, cable-car summits, alpine huts, villages, historic sites — the things a traveler goes to see when they visit this region. Pick sights from the whole area, naming the specific village/viewpoint/summit each one belongs to in the description.'
    : 'This is a city or town. List real sights within it or its immediate surroundings.';
  var prompt='Generate travel data for '+place+'. Return ONLY valid JSON, no markdown:\n{"cityCenter":[lat,lng],"sights":[{"name":"...","st":"...","desc":"one sentence","iconic":true,"durationHours":3,"url":"https://..."}],"districts":[{"name":"...","good":"...","bad":"...","hotels":[{"name":"...","desc":"...","price":"...","tier":2}]}],"practicalInfo":{"currency":"...","tipping":"...","note":"...","emergency":"..."},"transitHub":{"arrival":{"name":"...","lat":0,"lng":0},"departure":{"name":"...","lat":0,"lng":0}},"essentials":{"atms":[{"name":"...","note":"..."}],"banks":[{"name":"...","note":"..."}],"groceries":[{"name":"...","note":"..."}],"touristInfo":[{"name":"...","note":"..."}],"pharmacies":[{"name":"...","note":"..."}]}}\n'
    + _placeFraming + '\n'
    + _sightsCountGD + ', 2 districts, 1-2 hotels each. SIGHTS must be real cultural, historical, architectural, or natural attractions a tourist visits for the experience — museums, churches, landmarks, viewpoints, gondolas, trails, squares, gardens, ruins. Do NOT include hotels, spa retreats, wellness retreats, lodges, banks, ATMs, pharmacies, grocery stores, or other everyday services as sights — those belong in hotels or essentials, not sights. '
    + 'ICONIC FLAG: mark 3\u20135 sights as "iconic":true — the ones a first-time visitor would be disappointed to miss (Jungfraujoch in Interlaken, Matterhorn at Gornergrat in Zermatt, Duomo in Milan, etc.). These will be auto-seeded onto the traveler\u2019s days; the rest are opt-in optional picks. All other sights get "iconic":false or omit the field. Err toward fewer iconic flags, not more — if everything is iconic, nothing is. '
    + 'DURATION HOURS: every sight gets a `durationHours` integer for how long a committed traveler spends there from arrival to departure. Include the round trip for peripheral mountain railways / cable cars / boat rides: a Pilatus or Rigi cogwheel-summit-return is 5-6 hours; Jungfraujoch is 6-7 (long railway up + altitude time + descent). A major museum (Uffizi, Louvre, Met) is 3-4 hours. A cathedral interior + climb is 1-2. A landmark like the Chapel Bridge or Lion Monument is 30 minutes - round to 1 hour. A scenic train ride that IS the activity (Glacier Express, Bernina Express) is 6-8. Auto-seeding uses this so a half-day-or-longer sight (4+ hours) takes the whole day; two short sights can pair on one day. Round to whole hours; minimum 1, never 0. '
    + 'URL: include `url` ONLY when you are confident of the canonical official site (the museum\'s own domain, the railway operator\'s booking page, the cable car company, the official tourism site for a specific landmark). For famous, well-known sights (Louvre louvre.fr, Tate Modern tate.org.uk, Glacier Express glacierexpress.ch, Jungfraubahn jungfrau.ch, Uffizi uffizi.it) you should know these. For obscure or small sights — small chapels, village viewpoints, generic city squares — OMIT the url field rather than guess. Wrong URLs are worse than no URLs because they send the traveler to dead pages and erode trust. When you omit, the app falls back to a Google search for the sight name, which always works. Use https:// (not http), and the canonical domain (not a third-party aggregator like TripAdvisor or Wikipedia — only the official owner of the sight). '
    + 'Essentials are ALL required — do not omit any field. Include 2-3 ATMs, 1-2 banks (named branches — UBS, Raiffeisen, Barclays, BNP, etc. — whatever operates locally), 2-3 groceries, 1 tourist info, AND 1-2 pharmacies (chemists / drugstores / Apotheke / farmacia / pharmacie — whatever the local term). Real named places. Be concise.'
    + (_paceDirGD ? "\n\n"+_paceDirGD : "");
    // v359.16 (reverted in v359.17): the ROUTE-TRIP CONTEXT block
    // crowded out non-route iconics (Northern Lights, Blue Lagoon,
    // etc.) and missed destinations. Reverting; if we want route
    // stops as a first-class feature, build them as a separate
    // generateRouteStops(prevDest, nextDest) LLM call so they live
    // in their own dataset and don't compete with city sights.

  try{
    // Round DR: bumped to 90s timeout AND threaded into callMax so it
    // actually applies. Previously the outer 60s race was decoration —
    // callMax's default 25s timeout fired first, causing "API timeout"
    // failures on Zürich-sized responses (sights + districts + hotels
    // + essentials + transit hubs + practical info, all in one call).
    // 90s gives the model room when the API is congested.
    var genTimeout=new Promise(function(_,reject){setTimeout(function(){reject(new Error('Generation timed out after 90s'));},90000);});
    var text=await Promise.race([callMax([{role:'user',content:prompt}], 2400, 90000), genTimeout]);
    var json=text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    var s=json.indexOf('{'),e=json.lastIndexOf('}');
    if(s>-1&&e>-1)json=json.substring(s,e+1);
    var data=JSON.parse(json);

    // Fallback when the first pass returns no sights — common for region-style
    // destinations ("Bernina Pass Region", "Engadin Valley") where the model
    // hedges because the name isn't a tidy city. Retry once with a stronger,
    // more permissive prompt that gives concrete examples.
    if (!Array.isArray(data.sights) || data.sights.length === 0) {
      var regionRegion = (trip && trip.brief && trip.brief.region) ? trip.brief.region : ((_tb && _tb.region) ? _tb.region : "");
      var retryPrompt = 'List real, named sights a traveler visits in ' + place
        + (regionRegion ? ' (within ' + regionRegion + ')' : '')
        + '. This name may refer to a broader area — a pass, a valley, a lakeshore, a coast, a cluster of alpine villages — not a single city. List sights from the whole area: scenic viewpoints, summits reached by cable car or cogwheel, alpine lakes, historic passes, named villages with something to see, churches, museums, glacier overlooks, significant trails. For each, say where in the area it is.\n\n'
        + 'Return ONLY JSON: {"sights":[{"name":"...","st":"...","desc":"one sentence about what it is and where in ' + place + ' it sits"}]}. Aim for '
        + (_sightsCountGD.replace(/[^\d]/g, '') || '8')
        + ' sights.';
      try {
        var retryText = await Promise.race([
          callMax([{role:'user',content:retryPrompt}], 1400),
          new Promise(function(_,reject){setTimeout(function(){reject(new Error('Retry timed out'));},25000);})
        ]);
        var rj = retryText.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
        var rs = rj.indexOf('{'), re = rj.lastIndexOf('}');
        if (rs > -1 && re > -1) rj = rj.substring(rs, re + 1);
        var rdata = JSON.parse(rj);
        if (Array.isArray(rdata.sights) && rdata.sights.length) {
          data.sights = rdata.sights;
        }
      } catch(_retryErr) { /* keep the empty list, the UI's retry affordance still works */ }
    }

    // v359.60.23: preserve the Nominatim-fetched cityCenter across
    // the LLM cache replacement. Nominatim is a real geocoder grounded
    // in OpenStreetMap; the LLM's `cityCenter` is whatever it
    // remembered, and can be hundreds of km off (Neal's Iceland trip
    // had one place coord land in southern France). Nominatim wins
    // when it succeeded; the LLM's value is fallback only.
    var _nomCenter = (_generatedCityData[key] && _generatedCityData[key].cityCenter) || null;
    _generatedCityData[key]=data;
    if (_nomCenter && Array.isArray(_nomCenter) && isFinite(_nomCenter[0]) && isFinite(_nomCenter[1])
        && !(_nomCenter[0] === 0 && _nomCenter[1] === 0)) {
      _generatedCityData[key].cityCenter = _nomCenter;
    }

    // Populate suggestions — user assigns to days from Explore tab
    var destRef=getDest(destId);
    if(destRef){
      var genCenter=data.cityCenter&&data.cityCenter[0]?data.cityCenter:getCityCenter(destRef.place);
      // Persist generated data to dest so it survives page reloads
      if(data.districts) destRef.generatedDistricts=data.districts;
      if(data.practicalInfo) destRef.generatedPracticalInfo=data.practicalInfo;
      if(data.transitHub) destRef.generatedTransitHub=data.transitHub;
      // PD.241: LLM-call path routes through _setLLMSights, which puts
      // sights in dest._sightSources.llm and recomputes dest.suggestions.
      // The sources model preserves user-listed items automatically.
      var _llmNewList = (Array.isArray(data.sights) ? data.sights : []).map(function(s){
        sidCtr++;
        var sLat = s.lat || (genCenter ? genCenter[0] + (Math.random() - .5) * .003 : null);
        var sLng = s.lng || (genCenter ? genCenter[1] + (Math.random() - .5) * .004 : null);
        return {id:"s"+sidCtr, type:"sight", n:s.name, st:s.st||s.name, note:s.desc||null, lat:sLat, lng:sLng, approx:!s.lat, iconic:!!s.iconic, durationHours:(typeof s.durationHours==="number"&&s.durationHours>0)?s.durationHours:null, url:s.url||null};
      });
      _setLLMSights(destRef, _llmNewList);
      // Auto-seed iconic sights onto days so the user lands on a plan, not
      // an empty day grid. Non-iconic sights stay in the Explore list as
      // opt-in picks. See design-notes.md — this is the "Option C" default
      // that shifts the day-level from "assemble" to "curate/trim".
      _autoSeedIconicSightsToDays(destRef);
      // Append essentials as additional suggestion pins
      if(data.essentials) mergeEssentialsIntoSuggestions(destRef,data.essentials);
      autoSave();
    }
    showSaveStatus(place+' data ready \u2713 \u2014 see Explore tab',3000);

    // Redraw now with correct sights
    if(activeDest===destId && _leftMode==='dest'){
      drawDestMode(destId);
      updateMainMap();
      setTimeout(function(){if(_mainMap)_mainMap.invalidateSize();},100);
    } else if(_leftMode==='trip'){
      // Preserve scroll position across the re-render so the user isn't jerked
      // around each time a destination's generation finishes.
      var _lpc = g("lp-content");
      var _prevScroll = _lpc ? _lpc.scrollTop : 0;
      drawTripMode();
      var _lpc2 = g("lp-content");
      if (_lpc2) _lpc2.scrollTop = _prevScroll;
      updateMainMap();
    } else {
      updateMainMap();
    }

    // City center: always verify against Nominatim. LLMs hallucinate coordinates
    // with confidence — Tirano has landed in Africa, etc. Geocode the place,
    // and if the LLM's guess is more than ~300km off the Nominatim result
    // (or obviously bogus — near 0,0, non-finite), override with Nominatim.
    // Round CL.5: skip if circuit breaker is tripped.
    if(_nominatimBlocked){ /* keep LLM coords as-is */ } else
    try{
      var rq = place + ((trip && trip.brief && trip.brief.region) ? ", " + trip.brief.region : "");
      var r=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(rq),{headers:{'Accept-Language':'en'}});
      if (r.status === 429 || r.status === 403) { _markNominatimBlocked("rate-limited (HTTP " + r.status + ")"); throw new Error("blocked"); }
      if (!r.ok) throw new Error("not ok");
      var res=await r.json();
      if(res && res.length){
        var nLat = parseFloat(res[0].lat), nLon = parseFloat(res[0].lon);
        if(isFinite(nLat) && isFinite(nLon)){
          var llmLat = data.cityCenter && data.cityCenter[0];
          var llmLon = data.cityCenter && data.cityCenter[1];
          var bogus = !isFinite(llmLat) || !isFinite(llmLon) || Math.abs(llmLat) < 0.5 || Math.abs(llmLon) < 0.5;
          var offKm = (isFinite(llmLat) && isFinite(llmLon))
            ? Math.sqrt(Math.pow(llmLat - nLat, 2) + Math.pow(llmLon - nLon, 2)) * 111
            : Infinity;
          if (bogus || offKm > 300) {
            console.warn("[Max] overriding LLM cityCenter for " + place + " (off " + (isFinite(offKm)?offKm.toFixed(0):"∞") + "km) → using Nominatim");
            data.cityCenter = [nLat, nLon];
          }
          // Cache it for fast re-use by getCityCenter elsewhere
          _coarseGeocode[place.toLowerCase()] = [nLat, nLon];
        }
        if(activeDest===destId&&_leftMode==='dest') updateMainMap();
      }
    }catch(ge){}

    // Nominatim: geocode sights in background (throttled)
    // Round CL.5: skip the entire sight-geocoding loop if the circuit
    // breaker is tripped. The LLM-supplied lat/lng on each sight is good
    // enough; Nominatim is a polish-pass.
    if(data.sights && !_nominatimBlocked){
      for(var i=0;i<Math.min(data.sights.length,8);i++){
        if(_nominatimBlocked) break;
        if(data.sights[i].lat&&data.sights[i].lng)continue;
        try{
          // Round CL.5: bumped 350ms → 1100ms to respect Nominatim's 1 req/sec
          // rate limit.
          await new Promise(function(res){setTimeout(res,1100);});
          var sr=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(data.sights[i].name+', '+place),{headers:{'Accept-Language':'en'}});
          if (sr.status === 429 || sr.status === 403) { _markNominatimBlocked("rate-limited (HTTP " + sr.status + ")"); break; }
          if (!sr.ok) continue;
          var sres=await sr.json();
          if(sres.length){
            data.sights[i].lat=parseFloat(sres[0].lat);data.sights[i].lng=parseFloat(sres[0].lon);
            // Update matching suggestion with real coordinates
            var destRef2=getDest(destId);
            if(destRef2&&destRef2.suggestions){
              var ms=destRef2.suggestions.find(function(sg){return sg.n===data.sights[i].name;});
              if(ms){ms.lat=data.sights[i].lat;ms.lng=data.sights[i].lng;}
            }
          }
        }catch(ge){
          _markNominatimBlocked("fetch failed (likely CORS or network)");
          break;
        }
      }
      // Final map update with geocoded sight pins
      if(activeDest===destId&&_leftMode==='dest') updateMainMap();
      else updateMainMap();
      // Geocode essentials too — fire-and-forget so it doesn't block restaurants
      var destForEss=getDest(destId);
      if(destForEss) geocodeEssentials(destForEss);
      // Auto-generate restaurants if none exist yet
      var destForRest=getDest(destId);
      if(destForRest&&(!destForRest.restaurantSuggestions||destForRest.restaurantSuggestions.length===0)){
        refreshRestaurantSuggestions(destForRest,null);
      }
    }
  }catch(err){
    // Auto-retry once silently before showing failure to the user. The first
    // failure is often a transient hiccup — timeout, parse glitch, brief
    // network blip. Worth one retry before bothering the user.
    // Wait 2 seconds before retrying so we don't hit the same rate-limit
    // ceiling that caused the first failure (Nominatim 429s, API congestion).
    if (!_isAutoRetry) {
      console.warn('[Max] generateCityData first attempt failed; auto-retrying once after 2s. Error:', err && err.message);
      var prev = _generatedCityData[key] || {};
      delete _generatedCityData[key];
      await new Promise(function(r){ setTimeout(r, 2000); });
      return generateCityData(place, destId, true);
    }
    // Preserve any geocoded city center, just clear the loading state
    var existingData=_generatedCityData[key]||{};
    _generatedCityData[key]={cityCenter:existingData.cityCenter||null,loading:false,failed:true};
    var errDetail=err&&err.message?err.message:'Unknown error';
    console.error('generateCityData failed (after auto-retry):',errDetail);
    var d2=getDest(destId);
    if(d2&&(!d2.suggestions||d2.suggestions.length===0)){
      var noKeyMsg=errDetail.indexOf('No API key')>-1?
        place+' suggestions need an API key — add yours in Settings, then click Refresh.':
        'Could not load '+place+' data. Click Refresh to try again.';
      showSaveStatus('\u26a0 '+noKeyMsg,8000);
    }
    if(activeDest===destId&&_leftMode==='dest') drawDestMode(destId);
    else if(_leftMode==='trip') drawTripMode();
    // Only show error pane if suggestions are genuinely missing
    var d2=getDest(destId);
    var alreadyHasData=d2&&d2.suggestions&&d2.suggestions.length>0;
    if(!alreadyHasData&&d2&&activeDest===destId&&_leftMode==='dest'){
      var explPane=document.getElementById('dm-pane-explore');
      if(explPane){
        // v359.3.1: classify the failure so the user gets something
        // actionable. "Failed to fetch" is the browser's network-level
        // rejection — meaning the POST never reached the server at all
        // (offline, DNS, CORS, server down). Before this, the user
        // just saw "Could not load X data: Failed to fetch" and had
        // no idea whether to check their connection, sign in again,
        // or paste a fresh API key.
        var _useProxyForDiag = (typeof MaxSync !== "undefined"
          && typeof MaxSync.isSignedIn === "function"
          && MaxSync.isSignedIn());
        var _endpoint = _useProxyForDiag
          ? (typeof MaxSync !== "undefined" && typeof MaxSync.getServerUrl === "function"
              ? MaxSync.getServerUrl() : "the sync server")
          : "api.anthropic.com";
        var _short = "", _hint = "";
        var _det = (errDetail || "").toString();
        if (/failed to fetch/i.test(_det) || _det === "Load failed") {
          // Load failed = Safari's variant of TypeError: Failed to fetch.
          _short = "Couldn't reach " + _endpoint + ".";
          _hint = _useProxyForDiag
            ? "Check your network connection. If the sync server is down, you can fall back to your own API key from the 🔑 button on the home screen."
            : "Check your network connection, or pop into the 🔑 settings to confirm your API key is still valid.";
        } else if (/API timeout|timed out/i.test(_det)) {
          _short = "Request took longer than 90 seconds.";
          _hint = "The model is likely overloaded — wait a moment and click Retry.";
        } else if (/Session expired|Sign in to use/i.test(_det)) {
          _short = "You're signed out.";
          _hint = "Sign in via the ⇄ button to use the shared key, or add your own via 🔑.";
        } else if (/API key/i.test(_det)) {
          _short = _det;
          _hint = "Open 🔑 to add or refresh your Anthropic API key.";
        } else {
          _short = _det || "Unknown error.";
          _hint = "Click Retry. If it keeps failing, check the browser console for details.";
        }
        var errMsg=document.createElement('div');
        errMsg.style.cssText='margin:12px 14px;padding:10px 12px;background:#fff5f5;border:1px solid #f8c8c8;border-radius:7px;font-size:12px;color:#b04040;line-height:1.5;';
        var head=document.createElement('div');
        head.style.cssText='font-weight:700;margin-bottom:3px;';
        head.textContent='Could not load '+place+' data';
        errMsg.appendChild(head);
        var line1=document.createElement('div');
        line1.textContent=_short;
        errMsg.appendChild(line1);
        var line2=document.createElement('div');
        line2.style.cssText='font-size:11px;color:#7a5050;margin-top:4px;';
        line2.textContent=_hint;
        errMsg.appendChild(line2);
        var actions=document.createElement('div');
        actions.style.cssText='margin-top:7px;display:flex;gap:6px;flex-wrap:wrap;';
        var retryBtn=document.createElement('button');
        retryBtn.style.cssText='font-size:11px;padding:3px 10px;border:1px solid #f8c8c8;border-radius:11px;background:var(--c-bg);color:#b04040;cursor:pointer;font-family:inherit;font-weight:600;';
        retryBtn.textContent='Retry';
        (function(p,did){retryBtn.onclick=function(){delete _generatedCityData[p.toLowerCase()];generateCityData(p,did);drawDestMode(did);};})(place,destId);
        actions.appendChild(retryBtn);
        errMsg.appendChild(actions);
        explPane.insertBefore(errMsg,explPane.firstChild);
      }
    }
  }
}






/* #2 Stage 2 interim: expose this module's top-level bindings as globals for
   other-module/classic consumers (incl. window.* reads tsc cannot see) and
   app-main.js boot-time bare-global refs. esbuild isolates each .mjs to an IIFE;
   the any-cast keeps this valid without ambient decls; import-rewiring removes it. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg.showMapPinPanel = showMapPinPanel;
  __expg.ensureSuggestions = ensureSuggestions;
  __expg.fetchCityMeta = fetchCityMeta;
  __expg._initSightSources = _initSightSources;
  __expg._placedDayItemNamesSet = _placedDayItemNamesSet;
  __expg._sightTokensMatchAny = _sightTokensMatchAny;
  __expg._buildRejectedTokenSets = _buildRejectedTokenSets;
  __expg._recomputeSuggestions = _recomputeSuggestions;
  __expg._setLLMSights = _setLLMSights;
  __expg._addUserListedSight = _addUserListedSight;
  __expg._addEssentialsSights = _addEssentialsSights;
  __expg._addUserAddedSight = _addUserAddedSight;
  __expg._removeSightById = _removeSightById;
  __expg._addConsideredSight = _addConsideredSight;
  __expg._addRejectedSight = _addRejectedSight;
  __expg._promoteConsideredSight = _promoteConsideredSight;
  __expg._autoSeedIconicSightsToDays = _autoSeedIconicSightsToDays;
  __expg.mergeEssentialsIntoSuggestions = mergeEssentialsIntoSuggestions;
  __expg._nominatimBlocked = _nominatimBlocked;
  __expg._markNominatimBlocked = _markNominatimBlocked;
  __expg.geocodeEssentials = geocodeEssentials;
  __expg.generateCityData = generateCityData;
}

export {};
