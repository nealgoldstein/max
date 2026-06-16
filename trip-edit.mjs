// @ts-check
// trip-edit.js — destination add/list editing, date editing & overlap
// detection, booking infrastructure, action queue, time-conflict
// detection, and transport booking. Extracted verbatim from index.html
// (PD.452, bloat reduction). Global declarations + a self-contained
// globalThis.destPendingCount exposure (its var is defined in this same
// block). Loaded after features-trip.js.

// ── Add destination ────────────────────────────────────────
function onFromChange(){
  var from=g("dest-from").value;
  var to=g("dest-to");
  if(from){
    var d=new Date(from+"T12:00:00");
    d.setDate(d.getDate()+4);
    var y=d.getFullYear();
    var m=String(d.getMonth()+1).padStart(2,"0");
    var day=String(d.getDate()).padStart(2,"0");
    var plus4=y+"-"+m+"-"+day;
    if(!to.value||to.value<=from) to.value=plus4;
  }
}

function addDest(){
  var intent=g("dest-intent").value.trim();
  var from=g("dest-from").value;
  var to=g("dest-to").value;
  if(!intent||!from||!to)return;
  destCtr++;
  var id="d"+destCtr;
  var place=guessPlace(intent);
  if(!place){
    var err=g("dest-err-vis")||g("dest-err");
    if(err){err.textContent="Couldn't parse a city name. Try: \"Lisbon\" or \"Tokyo — temples and food\"";err.style.display="block";}
    return;
  }
  var errEl=g("dest-err-vis")||g("dest-err"); if(errEl)errEl.style.display="none";
  var fD=new Date(from+"T12:00:00"), tD=new Date(to+"T12:00:00");
  var nights=Math.max(1,Math.round((+tD-+fD)/86400000));
  var dest={
    id:id,place:place,intent:intent,dateFrom:from,dateTo:to,nights:nights,
    days:makeDays(id,place,intent,from,nights),
    trackerItems:{booked:[],see:[],visited:[]},trackerCat:"booked",storyState:"idle",
    hotelBookings:[],generalBookings:[],locations:[],
    execMode:false,todayItems:[],discoveredItems:[],
    suggestions:[] // populated by generateCityData or Explore tab refresh
  };
  trip.destinations.push(dest);
  // Round NC.X: sync the new destination into mdcItems so Discovery
  // sees it as a proper picker row when reopened.
  if (typeof _ensureMdcItemsHasPlace === "function") {
    _ensureMdcItemsHasPlace(place, {
      role: "stay",
      nights: nights,
      description: intent
    });
  }
  // Keep destinations in date order
  trip.destinations.sort(function(a,b){return(a.dateFrom||'').localeCompare(b.dateFrom||'');});
  generateCityData(place, id);
  g("dest-from").value=to; g("dest-to").value=""; onFromChange();
  var visFrom=g("dest-from-vis"); if(visFrom)visFrom.value=to;
  var visTo=g("dest-to-vis"); if(visTo)visTo.value=g("dest-to").value||"";
  var visInp=g("dest-intent-vis"); if(visInp)visInp.value="";
  var addForm=g("tm-add-form"); if(addForm)addForm.style.display="none";
  var addBtn2=g("tm-add-btn"); if(addBtn2)addBtn2.textContent="+ Add destination";
  // TM.4 (v328): emit replaces autoSave + drawTripMode. The deferred
  // updateMainMap below is kept because it also runs invalidateSize()
  // (Leaflet needs that when the map container size changed).
  _emitTripMutation();
  setTimeout(function(){if(_mainMap)_mainMap.invalidateSize();},150);
  // Scroll the new destination card into view
  setTimeout(function(){
    var card=document.querySelector('.tm-dest[data-id="'+id+'"]');
    if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
  },150);
}

function guessPlace(txt){
  var t=txt.toLowerCase();
  var known=["interlaken","vienna","prague","budapest","amsterdam","paris","rome","barcelona","berlin","lisbon","athens","dubrovnik","edinburgh","copenhagen","stockholm","kyoto","tokyo"];
  for(var i=0;i<known.length;i++) if(t.indexOf(known[i])>-1) return known[i].charAt(0).toUpperCase()+known[i].slice(1);
  var words=t.split(/\s+/);
  for(var w=0;w<words.length;w++){
    var word=words[w];
    for(var i=0;i<known.length;i++){
      var plen=Math.ceil(known[i].length*0.6);
      if(word.length>=plen&&word.substring(0,plen)===known[i].substring(0,plen))
        return known[i].charAt(0).toUpperCase()+known[i].slice(1);
    }
  }
  // Not a known city — extract city name from free text
  return extractCityName(txt);
}

function extractCityName(txt){
  // Strip common travel filler phrases
  var stripped=txt.replace(/\b(I want to|want to|id like to|i'd like to|going to|travel to|trip to|visit|explore|discover|see|vacation in|holiday in|travelling to|traveling to)\b/gi,'').trim();
  // Take text before — - , ;
  var part=stripped.split(/[—–\-,;]/)[0].trim();
  // Find capitalized word(s) in original text (city names are proper nouns)
  var origPart=txt.split(/[—–\-,;]/)[0].trim();
  var origWords=origPart.split(/\s+/);
  var cityWords=[];
  for(var i=0;i<origWords.length;i++){
    var w=origWords[i].replace(/[^a-zA-Z]/g,'');
    if(w.length>1 && w[0]===w[0].toUpperCase() && w[0]!==w[0].toLowerCase()){
      // Skip sentence-start "I"
      if(w==='I'&&i===0) continue;
      cityWords.push(origWords[i]);
      // Compound city: "New York", "Buenos Aires", "São Paulo", "Cape Town"
      for(var j=i+1;j<=i+2&&j<origWords.length;j++){
        var nw=origWords[j].replace(/[^a-zA-ZÀ-ÿ]/g,'');
        if(nw.length>1&&nw[0]===nw[0].toUpperCase()&&nw[0]!==nw[0].toLowerCase()&&!nw.match(/^(I|In|On|At|The|A|An|And|For|With|To)$/))
          cityWords.push(origWords[j]);
        else break;
      }
      break;
    }
  }
  if(cityWords.length) return cityWords.join(' ').replace(/[,;\.!?]+$/,'');
  // Last resort: first word, capitalised
  var fw=part.split(/\s+/)[0];
  return fw ? fw.charAt(0).toUpperCase()+fw.slice(1).toLowerCase() : null;
}

// v353.6: weather per destination (Open-Meteo, no API key).
// Forecast for dates within ~16 days from today; climate
// normals (averaged from same month across recent years) for
// dates further out. Cached in localStorage with a 6-hour TTL
// for forecast and 30-day TTL for climate to avoid hammering
// the API every render.
//
// Public surface:
//   getDestWeather(lat,lng,fromISO,toISO) → Promise<{kind, summary, daily?}>
//     kind: "forecast" | "climate" | "none"
//     summary: short string ("avg 18°/9°C · 30% rain") for the strip
//     daily: array of {date, tMax, tMin, precipPct, code} when forecast
//
// Render hook: renderDestWeatherStrip(destObj, container) appends a
// .dest-weather-strip element and asynchronously populates it.
var _weatherCache = (function(){
  try { return JSON.parse(localStorage.getItem("max-weather-cache") || "{}"); }
  catch(_){ return {}; }
})();
function _saveWeatherCache(){
  try { localStorage.setItem("max-weather-cache", JSON.stringify(_weatherCache)); } catch(_){}
}
function _weatherKey(lat, lng, fromISO, toISO){
  // Round coords to 2 decimals so nearby places share cache.
  var rl = function(n){ return (Math.round(n * 100) / 100).toFixed(2); };
  return rl(lat) + "," + rl(lng) + "|" + (fromISO||"") + "|" + (toISO||"");
}
function _weatherCacheTtl(kind){
  // PD.332: "none" (a FAILED fetch — network error, 429 rate limit)
  // gets a SHORT ttl. It was falling into the 30-day climate bucket,
  // so one transient 429 burst meant no weather for that place for a
  // month.
  if (kind === "forecast") return 6 * 3600 * 1000;
  if (kind === "none")     return 30 * 60 * 1000;
  return 30 * 86400 * 1000;
}
// PD.332: in-flight dedupe + global 429 backoff. Without these, every
// trip-view render fired one fetch per visible place (destinations +
// Considered set) BEFORE any response could land in the cache — a
// 129-place trip burst >100 concurrent requests, open-meteo started
// 429ing, and each re-render re-burst the whole set (the console
// flood Neal hit). One promise per cache key; any 429 pauses ALL
// weather fetching for 10 minutes (it's a free unauthenticated API —
// being a good citizen is also what un-blocks us fastest).
var _weatherInflight = {};
var _weatherBackoffUntil = 0;
function _wxCodeIcon(c){
  // WMO weather codes → emoji. Subset; defaults to a sun.
  if (c == null) return "☀️";
  if (c === 0) return "☀️";
  if (c <= 2) return "🌤️";
  if (c === 3) return "☁️";
  if (c >= 45 && c <= 48) return "🌫️";
  if (c >= 51 && c <= 67) return "🌦️";
  if (c >= 71 && c <= 77) return "🌨️";
  if (c >= 80 && c <= 82) return "🌧️";
  if (c >= 85 && c <= 86) return "❄️";
  if (c >= 95) return "⛈️";
  return "☁️";
}
async function getDestWeather(lat, lng, fromISO, toISO){
  if (!isFinite(lat) || !isFinite(lng) || !fromISO) {
    return { kind: "none", summary: "" };
  }
  var key = _weatherKey(lat, lng, fromISO, toISO);
  var cached = _weatherCache[key];
  if (cached && (Date.now() - cached.fetchedAt) < _weatherCacheTtl(cached.data && cached.data.kind)) {
    return cached.data;
  }
  // PD.332: global backoff after a 429 — don't even try, and don't
  // poison the cache; the next render after the window retries.
  if (Date.now() < _weatherBackoffUntil) {
    return { kind: "none", summary: "" };
  }
  // PD.332: in-flight dedupe — N strips asking for the same place
  // share one fetch.
  if (_weatherInflight[key]) return _weatherInflight[key];
  _weatherInflight[key] = _getDestWeatherUncached(lat, lng, fromISO, toISO, key);
  try {
    return await _weatherInflight[key];
  } finally {
    delete _weatherInflight[key];
  }
}
async function _getDestWeatherUncached(lat, lng, fromISO, toISO, key){
  // Decide forecast vs climate based on distance from today.
  var today = new Date(); today.setHours(12,0,0,0);
  var msDay = 86400 * 1000;
  var startDays = Math.round((+new Date(fromISO+"T12:00:00") - +today) / msDay);
  var endDays   = toISO ? Math.round((+new Date(toISO+"T12:00:00") - +today) / msDay) : startDays;
  var data;
  try {
    if (endDays >= 0 && startDays <= 16) {
      // Forecast (clamp to 0..16 days from today).
      var forecastStart = startDays < 0 ? 0 : startDays;
      var forecastEnd   = Math.min(endDays, 16);
      var startISO = new Date(today.getTime() + forecastStart * msDay).toISOString().slice(0,10);
      var endISOFc = new Date(today.getTime() + forecastEnd * msDay).toISOString().slice(0,10);
      var url = "https://api.open-meteo.com/v1/forecast"
        + "?latitude=" + lat + "&longitude=" + lng
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code"
        + "&start_date=" + startISO + "&end_date=" + endISOFc
        + "&timezone=auto";
      var r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      var j = await r.json();
      var d = j.daily || {};
      var days = [];
      var tMaxs = [], tMins = [], pps = [];
      (d.time || []).forEach(function(date, i){
        var tx = d.temperature_2m_max && d.temperature_2m_max[i];
        var tn = d.temperature_2m_min && d.temperature_2m_min[i];
        var pp = d.precipitation_probability_max && d.precipitation_probability_max[i];
        var wc = d.weather_code && d.weather_code[i];
        days.push({ date: date, tMax: tx, tMin: tn, precipPct: pp, code: wc });
        if (isFinite(tx)) tMaxs.push(tx);
        if (isFinite(tn)) tMins.push(tn);
        if (isFinite(pp)) pps.push(pp);
      });
      var avgMax = tMaxs.length ? Math.round(tMaxs.reduce(function(a,b){return a+b;}, 0) / tMaxs.length) : null;
      var avgMin = tMins.length ? Math.round(tMins.reduce(function(a,b){return a+b;}, 0) / tMins.length) : null;
      var avgPp  = pps.length   ? Math.round(pps.reduce(function(a,b){return a+b;}, 0) / pps.length)   : null;
      // v359.12: respect user's temperature pref. The Open-Meteo response
      // is in Celsius (the default), so convert at display time. The
      // _fmtTempUnit() suffix swaps °C/°F to match.
      var displayMax = (typeof _fmtTemp === "function" && avgMax != null) ? _fmtTemp(avgMax).replace(/°[CF]$/,"") : avgMax;
      var displayMin = (typeof _fmtTemp === "function" && avgMin != null) ? _fmtTemp(avgMin).replace(/°[CF]$/,"") : avgMin;
      var unitSuffix = (typeof _fmtTempUnit === "function") ? _fmtTempUnit() : "°C";
      var summary = (avgMax != null && avgMin != null)
        ? "Forecast " + displayMax + "°/" + displayMin + unitSuffix + (avgPp != null ? " · " + avgPp + "% rain" : "")
        : "Forecast unavailable";
      data = { kind: "forecast", summary: summary, daily: days };
    } else {
      // Climate normals — average the same month across the past 5 years.
      var month = (new Date(fromISO + "T12:00:00")).getUTCMonth() + 1;
      var year = new Date().getUTCFullYear() - 1;
      var startISOh = (year - 4) + "-" + String(month).padStart(2,"0") + "-01";
      // Use a safe end-of-month: 28 covers every month.
      var endISOh   = year + "-" + String(month).padStart(2,"0") + "-28";
      var urlH = "https://archive-api.open-meteo.com/v1/archive"
        + "?latitude=" + lat + "&longitude=" + lng
        + "&start_date=" + startISOh + "&end_date=" + endISOh
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
        + "&timezone=auto";
      var rh = await fetch(urlH);
      if (!rh.ok) throw new Error("HTTP " + rh.status);
      var jh = await rh.json();
      var dh = jh.daily || {};
      var allMax = (dh.temperature_2m_max || []).filter(function(v){return isFinite(v);});
      var allMin = (dh.temperature_2m_min || []).filter(function(v){return isFinite(v);});
      var allPr  = (dh.precipitation_sum   || []).filter(function(v){return isFinite(v);});
      var avgMaxC = allMax.length ? Math.round(allMax.reduce(function(a,b){return a+b;},0) / allMax.length) : null;
      var avgMinC = allMin.length ? Math.round(allMin.reduce(function(a,b){return a+b;},0) / allMin.length) : null;
      // Days with measurable rain (>= 1mm) as a % of total days.
      var rainDays = (dh.precipitation_sum || []).filter(function(v){return v >= 1;}).length;
      var totalDays = (dh.precipitation_sum || []).length || 1;
      var rainPct = Math.round((rainDays / totalDays) * 100);
      var displayMaxC = (typeof _fmtTemp === "function" && avgMaxC != null) ? _fmtTemp(avgMaxC).replace(/°[CF]$/,"") : avgMaxC;
      var displayMinC = (typeof _fmtTemp === "function" && avgMinC != null) ? _fmtTemp(avgMinC).replace(/°[CF]$/,"") : avgMinC;
      var unitSuffixC = (typeof _fmtTempUnit === "function") ? _fmtTempUnit() : "°C";
      var summaryC = (avgMaxC != null && avgMinC != null)
        ? "Typical " + displayMaxC + "°/" + displayMinC + unitSuffixC + " · " + rainPct + "% rainy days"
        : "Climate unavailable";
      data = { kind: "climate", summary: summaryC };
    }
  } catch (e) {
    data = { kind: "none", summary: "" };
    // PD.332: rate-limited → pause ALL weather fetching for 10 min
    // and do NOT cache this miss (it's the API saying "later," not
    // "no data"). Everything else (network down, bad coords) caches
    // the short-ttl "none" so render loops don't re-fetch.
    if (e && e.message && e.message.indexOf("HTTP 429") !== -1) {
      _weatherBackoffUntil = Date.now() + 10 * 60 * 1000;
      console.warn("[Max weather] open-meteo rate-limited — pausing weather fetches for 10 min");
      return data;
    }
  }
  _weatherCache[key] = { fetchedAt: Date.now(), data: data };
  _saveWeatherCache();
  return data;
}

// Render hook called from trip-ui's dest card render. Inserts a
// small strip below the dates row. Async fetch fills it in once
// the data lands; meanwhile the strip shows a faint placeholder.
function renderDestWeatherStrip(dest, container){
  if (!container || !dest) return;
  // Remove any prior strip if re-rendering.
  var existing = container.querySelector(".dest-weather-strip");
  if (existing) existing.remove();
  // Need lat/lng. Try the geocode cache via getCityCenter if present.
  var coords = null;
  if (typeof getCityCenter === "function") {
    coords = getCityCenter(dest.place || dest.label);
  }
  if (!coords || !isFinite(coords[0]) || !isFinite(coords[1])) return;
  if (!dest.dateFrom) return;
  var strip = document.createElement("div");
  strip.className = "dest-weather-strip";
  strip.style.cssText = "margin-top:6px;font-size:11px;color:#666;display:flex;align-items:center;gap:6px;";
  strip.innerHTML = '<span style="opacity:0.5;">Loading weather…</span>';
  container.appendChild(strip);
  getDestWeather(coords[0], coords[1], dest.dateFrom, dest.dateTo || dest.dateFrom).then(function(w){
    if (w.kind === "none" || !w.summary) {
      strip.remove();
      return;
    }
    var icon = (w.daily && w.daily[0]) ? _wxCodeIcon(w.daily[0].code) : "🌤️";
    strip.innerHTML = '<span>' + icon + '</span><span>' + w.summary + '</span>'
      + (w.kind === "climate" ? '<span style="font-size:9px;color:var(--c-ink-4);margin-left:4px;">(climate avg)</span>' : '');
  }).catch(function(){ strip.remove(); });
}

// v353.6: per-day weather chip. Smaller than the dest strip — just
// icon + high/low for that single day. Re-uses getDestWeather's
// cache (range query for the whole dest already populated by
// renderDestWeatherStrip), then picks the matching entry from
// w.daily by date. For dates beyond the 16-day forecast horizon we
// silently skip — the climate avg is on the dest strip and doesn't
// vary day-to-day, so per-day chips would be redundant noise.
function renderDayWeatherChip(dest, day, container){
  if (!container || !dest || !day || !day.date) return;
  // Don't double-render if a chip is already there.
  var existing = container.querySelector(".day-weather-chip");
  if (existing) existing.remove();
  var coords = null;
  if (typeof getCityCenter === "function") {
    coords = getCityCenter(dest.place || dest.label);
  }
  if (!coords || !isFinite(coords[0]) || !isFinite(coords[1])) return;
  if (!dest.dateFrom) return;
  var chip = document.createElement("span");
  chip.className = "day-weather-chip";
  chip.style.cssText = "margin-left:8px;font-size:10px;color:#666;display:inline-flex;align-items:center;gap:3px;font-weight:500;opacity:0.85;";
  chip.innerHTML = '<span style="opacity:0.4;">…</span>';
  container.appendChild(chip);
  getDestWeather(coords[0], coords[1], dest.dateFrom, dest.dateTo || dest.dateFrom).then(function(w){
    if (w.kind !== "forecast" || !w.daily || !w.daily.length) {
      // Climate-only or no data — drop the chip rather than show
      // the dest-wide average on every day card.
      chip.remove();
      return;
    }
    var match = null;
    for (var i = 0; i < w.daily.length; i++) {
      if (w.daily[i] && w.daily[i].date === day.date) { match = w.daily[i]; break; }
    }
    if (!match) { chip.remove(); return; }
    var icon = _wxCodeIcon(match.code);
    var tx = isFinite(match.tMax) ? Math.round(match.tMax) + "°" : "";
    var tn = isFinite(match.tMin) ? Math.round(match.tMin) + "°" : "";
    var temps = (tx && tn) ? (tx + "/" + tn) : (tx || tn || "");
    var rain = isFinite(match.precipPct) && match.precipPct >= 30
      ? '<span style="color:#3a7ab8;margin-left:3px;">' + match.precipPct + '% rain</span>'
      : '';
    chip.innerHTML = '<span>' + icon + '</span>' + (temps ? '<span>' + temps + '</span>' : '') + rain;
  }).catch(function(){ chip.remove(); });
}

function fmtD(s){
  if(!s)return"";
  var d=new Date(s+"T12:00:00");
  // v359.60.30: long formats with weekday + year are the new
  // defaults. Old short "us" (no year) maps to "us-long" via
  // _defaultDateFormat's back-compat shim.
  //   "us-long"   → Mon, Aug 5, 2026   (default — weekday, month, day, year)
  //   "intl-long" → Mon, 5 Aug 2026    (weekday, day, month, year)
  //   "iso"       → 2026-08-05         (raw ISO, no formatting)
  //   "locale"    → browser default with weekday short + year
  var fmt = (typeof _defaultDateFormat === "function") ? _defaultDateFormat() : "us-long";
  if (fmt === "iso") return s;
  if (fmt === "intl-long") return d.toLocaleDateString("en-GB", {weekday:"short", day:"numeric", month:"short", year:"numeric"});
  if (fmt === "locale")    return d.toLocaleDateString(undefined,  {weekday:"short", month:"short", day:"numeric", year:"numeric"});
  return d.toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric", year:"numeric"});
}

// v359.12: distance/temperature formatters honoring user prefs.
function _fmtDistance(km){
  if (km == null || !isFinite(km)) return "";
  var pref = (typeof _defaultDistanceUnits === "function") ? _defaultDistanceUnits() : "metric";
  if (pref === "imperial") {
    var mi = Math.round(km * 0.621371);
    return mi + " mi";
  }
  return Math.round(km) + " km";
}
function _fmtTemp(c){
  if (c == null || !isFinite(c)) return "";
  var pref = (typeof _defaultTemperatureUnits === "function") ? _defaultTemperatureUnits() : "celsius";
  if (pref === "fahrenheit") {
    var f = Math.round((c * 9/5) + 32);
    return f + "°F";
  }
  return Math.round(c) + "°C";
}
// Returns just the unit suffix ("°C" or "°F") — used when two temps
// share one suffix as in "18°/9°C".
function _fmtTempUnit(){
  var pref = (typeof _defaultTemperatureUnits === "function") ? _defaultTemperatureUnits() : "celsius";
  return pref === "fahrenheit" ? "°F" : "°C";
}
// API parameter for Open-Meteo so it returns temps in user's unit.
function _fmtTempApiUnit(){
  var pref = (typeof _defaultTemperatureUnits === "function") ? _defaultTemperatureUnits() : "celsius";
  return pref === "fahrenheit" ? "fahrenheit" : "celsius";
}

// Round DF — return a {url, label, isOfficial} for a sight or restaurant.
// Prefer the LLM-supplied url when present; otherwise fall back to a
// Google search for "<name> <place>" so the link always lands the user
// somewhere useful. The LLM is told to OMIT url when not certain, so
// we trust an explicit url here. The fallback is reliable but takes one
// extra click to reach the official site.
function _sightExternalUrl(item, place){
  if (item && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
    return { url: item.url, label: "↗ official site", isOfficial: true };
  }
  var name = (item && (item.n || item.name)) || "";
  if (!name) return null;
  var q = encodeURIComponent(name + (place ? " " + place : ""));
  return { url: "https://www.google.com/search?q=" + q, label: "↗ search", isOfficial: false };
}

// Round DG — open an inline URL editor anchored to a button. The user
// can paste/type a URL to override (or set) the LLM-supplied url on a
// sight item. Empty value clears, which makes _sightExternalUrl fall
// back to the Google search link. Saves directly onto the item, calls
// autoSave, and triggers re-render via the optional onSaved callback.
// Single editor at a time — opening one closes any existing instance.
function _openSightUrlEditor(anchor, item, onSaved){
  if (!anchor || !item) return;
  // Toggle off if already open for this item
  var existing = document.getElementById("sight-url-pop");
  if (existing) {
    var existingId = existing.getAttribute("data-item-id");
    existing.remove();
    if (existingId === item.id) return;
  }
  var pop = document.createElement("div");
  pop.id = "sight-url-pop";
  pop.setAttribute("data-item-id", item.id || "");
  pop.style.cssText = "position:absolute;background:var(--c-bg);border:1px solid #d8d4c8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.15);z-index:10000;padding:10px 12px;min-width:320px;max-width:calc(100vw - 24px);font-family:inherit;";
  var lbl = document.createElement("div");
  lbl.style.cssText = "font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666;margin-bottom:6px;";
  lbl.textContent = "URL for " + (item.n || item.name || "this sight");
  pop.appendChild(lbl);
  var inp = document.createElement("input");
  inp.type = "url";
  inp.placeholder = "https:// — paste an official site or any link. Leave blank to use the search fallback.";
  inp.value = item.url || "";
  inp.style.cssText = "width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--c-border-strong);border-radius:4px;font-family:inherit;box-sizing:border-box;";
  inp.spellcheck = false;
  pop.appendChild(inp);
  var actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;justify-content:flex-end;margin-top:8px;";
  var saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.style.cssText = "font-size:11px;font-weight:600;padding:4px 10px;border-radius:4px;border:1px solid var(--c-primary);background:var(--c-primary);color:var(--c-on-dark);cursor:pointer;font-family:inherit;";
  var cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "font-size:11px;font-weight:500;padding:4px 10px;border-radius:4px;border:1px solid #d8d4c8;background:var(--c-bg);color:#666;cursor:pointer;font-family:inherit;";
  actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  pop.appendChild(actions);

  function commit(){
    var v = (inp.value || "").trim();
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    item.url = v || null;
    if (typeof autoSave === "function") autoSave();
    pop.remove();
    if (typeof onSaved === "function") onSaved();
  }
  function dismiss(){ pop.remove(); }
  saveBtn.onclick = commit;
  cancelBtn.onclick = dismiss;
  inp.onkeydown = function(e){
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); dismiss(); }
  };

  document.body.appendChild(pop);
  // Position below the anchor
  var rect = anchor.getBoundingClientRect();
  var pw = pop.offsetWidth || 320;
  var x = Math.min(rect.left + window.scrollX, window.innerWidth - pw - 10);
  x = Math.max(8, x);
  pop.style.left = x + "px";
  pop.style.top = (rect.bottom + window.scrollY + 4) + "px";
  inp.focus(); inp.select();

  // Click-outside to dismiss (defer one tick to avoid catching the open click)
  setTimeout(function(){
    function outside(ev){
      if (!pop.contains(ev.target)) {
        pop.remove();
        document.removeEventListener("click", outside, true);
      }
    }
    document.addEventListener("click", outside, true);
  }, 10);
}

// ── Dest list (left panel) ─────────────────────────────────
function renderDestList(){
  if(_leftMode==="trip") drawTripMode();
}

function toggleListDateEdit(destId){
  var row=g("di-edit-row-"+destId);
  var btn=g("di-edit-btn-"+destId);
  if(!row)return;
  var open=row.style.display!=="none";
  if(open){closeListDateEdit(destId);}
  else{row.style.display="block"; if(btn)btn.textContent="cancel";}
}

function closeListDateEdit(destId){
  var row=g("di-edit-row-"+destId);
  var btn=g("di-edit-btn-"+destId);
  if(row)row.style.display="none";
  if(btn)btn.textContent="edit";
}

function selectDest(id){
  activeDest=id;
  drawDestMode(id);
}

// Round FN.8.18: undo-toast wrapper for × Remove. Replaces the
// confirm() dialog with optimistic delete + 6-second undo toast.
// Snapshots trip.destinations + trip.pendingActions + per-dest aux
// state (ffHistory / story / notes), runs delDest, then shows the
// undo. On undo, restore everything verbatim — including the date
// shifts delDest applied to surviving destinations and the pending
// actions it cascaded.
function delDestWithUndo(e, id) {
  if (e) e.stopPropagation();
  var dest = trip.destinations.find(function(d){return d.id===id;});
  if (!dest) return;
  var dName = dest.label || dest.place;
  // Deep snapshot — JSON round-trip is fine since dest data is
  // plain objects/arrays (no functions, no circular refs).
  var snapDestinations = JSON.parse(JSON.stringify(trip.destinations));
  var snapPendingActions = JSON.parse(JSON.stringify(trip.pendingActions||[]));
  var snapActiveDest = activeDest;
  var snapFf = _ffHistories[id] ? JSON.parse(JSON.stringify(_ffHistories[id])) : null;
  var snapStory = _destStories[id] ? JSON.parse(JSON.stringify(_destStories[id])) : null;
  var snapNotes = _destNotes[id] ? JSON.parse(JSON.stringify(_destNotes[id])) : null;
  var snapOverBudget = trip.overBudgetNotice ? JSON.parse(JSON.stringify(trip.overBudgetNotice)) : null;

  // v353.2: if the destination being removed has attached
  // activities, move them to the closest remaining destination
  // before deletion. Otherwise the user loses the reason they
  // wanted that place — e.g., removing Diamond Beach (a sight-
  // level destination the LLM mistakenly elevated) wipes the
  // "Walk on black sand beaches" activity along with it. With
  // relocation, the activity reattaches to Höfn (or whichever
  // remaining stay is closest by haversine), where it can
  // legitimately happen as a day-trip from the new base.
  // Snapshot is taken BEFORE this mutation so undo restores both
  // the deletion and the attachment shift.
  var attached = (dest.attachedEvents && dest.attachedEvents.length) ? dest.attachedEvents : [];
  var relocatedTo = /** @type {any} */ (null);
  var relocatedCount = 0;
  if (attached.length && typeof _fqHaversineKm === "function" &&
      typeof dest.lat === "number" && typeof dest.lng === "number") {
    // Find closest other destination with coords.
    var nearest = /** @type {any} */ (null), nearestKm = Infinity;
    trip.destinations.forEach(function (d) {
      if (!d || d.id === id) return;
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return;
      var km = _fqHaversineKm(dest.lat, dest.lng, d.lat, d.lng);
      if (km < nearestKm) { nearestKm = km; nearest = d; }
    });
    if (nearest) {
      if (!Array.isArray(nearest.attachedEvents)) nearest.attachedEvents = [];
      attached.forEach(function (ev) {
        // Avoid duplicating an event that's already there by name.
        var dup = nearest.attachedEvents.some(function (existing) {
          return existing && existing.name && ev && ev.name &&
                 existing.name.toLowerCase() === ev.name.toLowerCase();
        });
        if (!dup) {
          nearest.attachedEvents.push(JSON.parse(JSON.stringify(ev)));
          relocatedCount++;
        }
      });
      if (relocatedCount > 0) relocatedTo = nearest;
    }
  }

  delDest(null, id);

  // Compose the toast message based on whether we relocated.
  var toastMsg = "Removed <strong>" + dName + "</strong>";
  if (relocatedTo && relocatedCount > 0) {
    toastMsg += " — moved " + relocatedCount + " activit" +
                (relocatedCount === 1 ? "y" : "ies") +
                " to <strong>" + (relocatedTo.label || relocatedTo.place) + "</strong>";
  }

  if (typeof _showDayTripToast === "function") {
    _showDayTripToast(
      toastMsg,
      function(){
        trip.destinations = snapDestinations;
        trip.pendingActions = snapPendingActions;
        if (snapFf) _ffHistories[id] = snapFf;
        if (snapStory) _destStories[id] = snapStory;
        if (snapNotes) _destNotes[id] = snapNotes;
        if (snapOverBudget) trip.overBudgetNotice = snapOverBudget;
        else delete trip.overBudgetNotice;
        activeDest = snapActiveDest;
        if (typeof _reEvaluateOverBudget === "function") _reEvaluateOverBudget();
        if (typeof autoSave === "function") autoSave();
        if (_leftMode === "trip") drawTripMode();
        else if (activeDest) drawDestMode(activeDest);
        else if (typeof setLeftMode === "function") setLeftMode("trip");
        if (typeof updateMainMap === "function") updateMainMap();
      }
    );
  }
}

// path-to-10:A done — mutator emits tripChange + mapDataChange via _emitTripMutation; no direct drawXxx calls. See path-to-10.md item A (HY round, May 2026).
function delDest(e,id){
  if(e)e.stopPropagation();
  var dest=trip.destinations.find(function(d){return d.id===id;});
  if(dest){
    var dName=dest.label||dest.place;
    // Generate pending actions for all active bookings before deleting
    (dest.hotelBookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
      addPendingAction({eventType:'hotel',actionType:'Contact provider to adjust or cancel',
        eventName:b.name,destName:dName,confirmationNumber:b.confirmationNumber||null,
        detail:'Destination removed — contact hotel to cancel reservation',requiresProviderAction:true});
    });
    (dest.generalBookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
      addPendingAction({eventType:'booking',actionType:'Contact provider to adjust or cancel',
        eventName:b.label||b.type||'Booking',destName:dName,confirmationNumber:b.confirmationNumber||null,
        detail:'Destination removed — contact provider to cancel',requiresProviderAction:true});
    });
    Object.keys(trip.legs||{}).forEach(function(k){
      var leg=trip.legs[k];
      if(leg.fromId!==id&&leg.toId!==id) return;
      (leg.bookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
        addPendingAction({eventType:'transport',actionType:'Contact provider to adjust or cancel',
          eventName:b.operator||'Transport',destName:dName,confirmationNumber:b.confirmationNumber||null,
          detail:'Destination removed — contact provider to cancel',requiresProviderAction:true});
      });
    });
  }
  // Round FN: capture the trip's original start date BEFORE filtering,
  // so we can re-anchor dates of the remaining destinations and close
  // the gap left by the removed one.
  var startBefore = (trip.destinations.length>0 && trip.destinations[0].dateFrom) ? trip.destinations[0].dateFrom : null;
  trip.destinations=trip.destinations.filter(function(d){return d.id!==id;});
  delete _ffHistories[id]; delete _destStories[id]; delete _destNotes[id];
  // Round FN: recompute dateFrom/dateTo across surviving destinations
  // so removing a middle destination doesn't leave a calendar gap.
  // Mirrors the picker rebuild's date-recompute pass (line ~12873).
  if (startBefore && trip.destinations.length > 0) {
    var curDate = new Date(startBefore + 'T12:00:00');
    trip.destinations.forEach(function(d){
      var dateFrom = curDate.toISOString().slice(0,10);
      var next = new Date(curDate); next.setDate(next.getDate() + (d.nights || 0));
      var dateTo = next.toISOString().slice(0,10);
      d.dateFrom = dateFrom;
      d.dateTo = dateTo;
      // If days array exists and length matches, shift each day's date forward.
      if (Array.isArray(d.days) && d.days.length === (d.nights || 0)) {
        var dayCur = new Date(curDate);
        d.days.forEach(function(day){
          day.date = dayCur.toISOString().slice(0,10);
          dayCur.setDate(dayCur.getDate() + 1);
        });
      }
      curDate = next;
    });
  }
  // Round FN: re-evaluate over-budget banner since night totals may have changed.
  if (typeof _reEvaluateOverBudget === "function") _reEvaluateOverBudget();
  if(activeDest===id){
    activeDest=trip.destinations.length>0?trip.destinations[trip.destinations.length-1].id:null;
  }
  // Round HD: if we just deleted the only destination AND we were on
  // the dest detail view, fall back to the trip list. setLeftMode
  // also re-renders, but the subsequent _emitTripMutation re-renders
  // again — tolerated as a small wasted cycle so we don't fork the
  // logic. Other navigation states are handled by the central
  // subscription's _leftMode-aware re-render.
  if (!activeDest && _leftMode === 'dest' && typeof setLeftMode === "function") {
    setLeftMode("trip");
  }
  _emitTripMutation();
}

function getDest(id){
  for(var i=0;i<trip.destinations.length;i++) if(trip.destinations[i].id===id) return trip.destinations[i];
  return null;
}

// SCAFFOLD-6: shared "?" rationale popover button. Returns a button
// element that, when clicked, opens a fixed-position popover with the
// supplied text. Used by dest-card nights, per-day, district, transit
// chip, and per-item placement rationales. position:fixed escapes
// #lp's overflow:hidden; window.innerWidth clamping keeps the popover
// inside the viewport. Outside-click + window-resize close all open
// popovers (one global listener).
function _sf6Btn(rationale, opts){
  opts = opts || {};
  if (!rationale) return null;
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "?";
  btn.title = opts.title || "Why this?";
  btn.style.cssText = "font-size:9.5px;font-weight:700;width:15px;height:15px;line-height:1;padding:0;border-radius:50%;border:1px solid #c8b888;background:#fbf6e8;color:#7d5e00;cursor:pointer;font-family:inherit;vertical-align:middle;margin-left:6px;flex-shrink:0;" + (opts.style || "");
  btn.onmouseover = function(){ btn.style.background = "#f0e3b8"; };
  btn.onmouseout  = function(){ btn.style.background = "#fbf6e8"; };
  var pop = null;
  function ensurePop(){
    if (pop) return pop;
    pop = document.createElement("div");
    pop.className = "sf6-pop";
    pop.style.cssText = "display:none;position:fixed;width:300px;max-width:calc(100vw - 24px);font-size:11px;line-height:1.55;color:#5a4520;background:var(--c-bg);border:1px solid #e6d5a0;border-radius:6px;padding:9px 11px;box-shadow:0 4px 14px rgba(0,0,0,.18);z-index:8500;font-weight:500;text-align:left;white-space:normal;";
    pop.textContent = rationale;
    document.body.appendChild(pop);
    return pop;
  }
  function position(){
    var p = ensurePop();
    var r = btn.getBoundingClientRect();
    var popW = 300, margin = 8;
    var top = r.bottom + 4;
    var left = r.left;
    if (left + popW > window.innerWidth - margin) left = window.innerWidth - popW - margin;
    if (left < margin) left = margin;
    p.style.top  = top  + "px";
    p.style.left = left + "px";
  }
  btn.onclick = function(e){
    e.stopPropagation();
    var p = ensurePop();
    var wasOpen = p.style.display === "block";
    document.querySelectorAll(".sf6-pop-open").forEach(function(el){
      el.style.display = "none";
      el.classList.remove("sf6-pop-open");
    });
    if (!wasOpen) {
      position();
      p.style.display = "block";
      p.classList.add("sf6-pop-open");
    }
  };
  if (!window._sf6PopCloser){
    window._sf6PopCloser = true;
    document.addEventListener("click", function(){
      document.querySelectorAll(".sf6-pop-open").forEach(function(el){
        el.style.display = "none";
        el.classList.remove("sf6-pop-open");
      });
    });
    window.addEventListener("resize", function(){
      document.querySelectorAll(".sf6-pop-open").forEach(function(el){
        el.style.display = "none";
        el.classList.remove("sf6-pop-open");
      });
    });
  }
  return btn;
}

// ── Date editing & overlap detection ──────────────────────
function editDates(destId){
  var dest=getDest(destId); if(!dest)return;
  var span=g("ud-dates-"+destId); if(!span)return;
  var btn=g("ud-edit-btn-"+destId); if(btn)btn.style.display="none";
  span.textContent="";
  var row=document.createElement("div"); row.className="date-edit-row";
  var fi=document.createElement("input"); fi.type="date"; fi.className="date-edit-inp"; fi.id="edit-from-"+destId; fi.value=dest.dateFrom; fi.min="";
  var arrow=document.createElement("span"); arrow.style.cssText="font-size:10px;color:var(--c-ink-4);"; arrow.textContent="\u2192";
  var ti=document.createElement("input"); ti.type="date"; ti.className="date-edit-inp"; ti.id="edit-to-"+destId; ti.value=dest.dateTo;
  ti.min=dest.dateFrom;
  fi.onchange=function(){ti.min=fi.value;if(ti.value&&ti.value<fi.value)ti.value="";};
    ti.onchange=function(){ti.blur();};
  var sv=document.createElement("button"); sv.className="date-save-btn"; sv.textContent="Save";
  (function(did){sv.onclick=function(){saveDates(did);};})(destId);
  var cx=document.createElement("button"); cx.className="date-cancel-btn"; cx.textContent="Cancel";
  (function(did){cx.onclick=function(){cancelEditDates(did);};})(destId);
  row.appendChild(fi); row.appendChild(arrow); row.appendChild(ti); row.appendChild(sv); row.appendChild(cx);
  span.appendChild(row);
}

function cancelEditDates(destId){
  var dest=getDest(destId); if(!dest)return;
  var span=g("ud-dates-"+destId); if(!span)return;
  var btn=g("ud-edit-btn-"+destId);
  span.innerHTML="";
  span.textContent=fmtD(dest.dateFrom)+" \u2013 "+fmtD(dest.dateTo)+" ("+dest.nights+" night"+(dest.nights!==1?"s":"")+")";
  if(btn)btn.style.display="";
}

function saveDates(destId,newFrom,newTo){
  if(!newFrom||!newTo){
    var fi=g("edit-from-"+destId); var ti=g("edit-to-"+destId);
    if(!fi||!ti)return;
    newFrom=fi.value; newTo=ti.value;
  }
  // Round FN.5: when user tries to set dateTo <= dateFrom (would make
  // 0 nights, e.g. shrinking a 1-night destination), silently
  // returning leaves them confused. Now alert with a clear message
  // pointing them at × Remove instead.
  if(newFrom && newTo && newTo<=newFrom){
    alert('A destination needs at least one night.\n\nIf you want a zero-night stop, use × Remove on the destination card to drop it from the trip.');
    return;
  }
  if(!newFrom||!newTo)return;
  var dest=getDest(destId); if(!dest)return;
  var oldFrom=dest.dateFrom, oldTo=dest.dateTo;
  var datesChanged=(newFrom!==oldFrom||newTo!==oldTo);

  if(datesChanged){
    // Compute what would be affected before asking
    var affected=computeDateChangeImpact(dest,newFrom,newTo);
    if(affected.bookings.length>0||affected.overlapping.length>0){
      showDateChangeDialog(dest,newFrom,newTo,affected,function(){
        applyDateChange(dest,newFrom,newTo,affected);
      });
      return;
    }
  }
  applyDateChange(dest,newFrom,newTo,null);
}

function computeDateChangeImpact(dest,newFrom,newTo){
  var affected={bookings:[],overlapping:[]};
  var extending=newTo>dest.dateTo;

  // 1. Own hotel booking — remove from Max, contact provider to adjust dates
  (dest.hotelBookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
    affected.bookings.push({dest:dest.label||dest.place,type:'Hotel',name:b.name,
      detail:'Conf: '+(b.confirmationNumber||'see booking')+' — contact provider to adjust or cancel',
      keepInApp:false});
  });

  // 2. Own general/restaurant bookings after the new end date — no longer valid
  (dest.generalBookings||[]).forEach(function(b){
    if(b.date&&b.date>newTo)
      affected.bookings.push({dest:dest.label||dest.place,type:'Reservation',name:b.name||b.type||'Booking',detail:'Booked for '+fmtD(b.date)+' — after new end date'});
  });

  // 3. Transport leg departing this destination — departure date may be invalid
  var destIdx=trip.destinations.indexOf(dest);
  if(destIdx<trip.destinations.length-1){
    var nextDest=trip.destinations[destIdx+1];
    var leg=getLeg(dest.id,nextDest.id);
    (leg.bookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
      affected.bookings.push({dest:dest.label||dest.place,type:'Transport',
        name:b.operator||'Transport to '+(nextDest.label||nextDest.place),
        detail:'Departs '+fmtD(b.departure||dest.dateTo)+' — date may be invalid'});
    });
  }

  // 4. Overlap detection — check both directions

  // Next destination overlap (end date extends later)
  if(newTo>dest.dateTo&&destIdx<trip.destinations.length-1){
    var nd=trip.destinations[destIdx+1];
    if(newTo>nd.dateFrom){
      var overlapDays=Math.ceil((+new Date(newTo+'T12:00:00')-+new Date(nd.dateFrom+'T12:00:00'))/86400000)+1;
      var ovBookings=[];
      (nd.hotelBookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
        ovBookings.push({type:'Hotel',name:b.name,detail:'Conf: '+(b.confirmationNumber||'see booking')+' — contact provider to adjust or cancel',keepInApp:false});
      });
      (nd.generalBookings||[]).forEach(function(b){
        ovBookings.push({type:'Reservation',name:b.name||b.type||'Booking',detail:b.date?'Booked for '+fmtD(b.date):'',keepInApp:false});
      });
      Object.keys(trip.legs||{}).forEach(function(k){
        if(k.indexOf(nd.id)>-1){
          (trip.legs[k].bookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
            ovBookings.push({type:'Transport',name:b.operator||'Transport',detail:b.departure?'Departs '+fmtD(b.departure):'',keepInApp:false});
          });
        }
      });
      affected.overlapping.push({dest:nd.label||nd.place,id:nd.id,
        detail:'New end date overlaps '+nd.place+' by '+overlapDays+' day'+(overlapDays!==1?'s':''),
        bookings:ovBookings});
    }
  }

  // Previous destination overlap (start date moves earlier)
  if(newFrom<dest.dateFrom&&destIdx>0){
    var pd=trip.destinations[destIdx-1];
    if(pd.dateTo>newFrom){
      var pdOverlapDays=Math.ceil((+new Date(pd.dateTo+'T12:00:00')-+new Date(newFrom+'T12:00:00'))/86400000)+1;
      var pdBookings=[];
      (pd.hotelBookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
        pdBookings.push({type:'Hotel',name:b.name,detail:'Conf: '+(b.confirmationNumber||'see booking')+' — contact provider to adjust or cancel',keepInApp:false});
      });
      (pd.generalBookings||[]).forEach(function(b){
        pdBookings.push({type:'Reservation',name:b.name||b.type||'Booking',detail:b.date?'Booked for '+fmtD(b.date):'',keepInApp:false});
      });
      Object.keys(trip.legs||{}).forEach(function(k){
        if(k.indexOf(pd.id)>-1){
          (trip.legs[k].bookings||[]).filter(function(b){return b.status==='booked';}).forEach(function(b){
            pdBookings.push({type:'Transport',name:b.operator||'Transport',detail:b.departure?'Departs '+fmtD(b.departure):'',keepInApp:false});
          });
        }
      });
      affected.overlapping.push({dest:pd.label||pd.place,id:pd.id,
        detail:'New start date overlaps '+pd.place+' by '+pdOverlapDays+' day'+(pdOverlapDays!==1?'s':''),
        bookings:pdBookings});
    }
  }

  return affected;
}

function buildCancelItems(dest,affected){
  var items=[];
  (affected.bookings||[]).forEach(function(b){
    items.push({type:b.type,name:b.name,detail:b.detail,dest:dest.label||dest.place,keepInApp:b.keepInApp||false});
  });
  (affected.overlapping||[]).forEach(function(d){
    (d.bookings||[]).forEach(function(b){
      items.push({type:b.type,name:b.name,detail:b.detail,dest:d.dest,keepInApp:false});
    });
  });
  return items;
}

function openMailtoChecklist(destName,items){
  var subject='Cancellation checklist — '+destName+' date change';
  var body='The following bookings need to be cancelled or adjusted with providers:\n\n';
  items.forEach(function(it){
    body+=it.type+': '+it.name+' ('+it.dest+')';
    if(it.detail) body+=' — '+it.detail;
    body+=' [contact provider]';
    body+='\n';
  });
  body+='\n— Sent from Max';
  window.location.href='mailto:?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

function buildCancelRows(container,items){
  var groups={};
  items.forEach(function(it){if(!groups[it.dest])groups[it.dest]=[];groups[it.dest].push(it);});
  Object.keys(groups).forEach(function(gDest){
    var hdr=document.createElement('div'); hdr.className='move-dialog-label';
    hdr.textContent=gDest; container.appendChild(hdr);
    var list=document.createElement('div'); list.style.cssText='margin-bottom:10px;';
    groups[gDest].forEach(function(b){
      var row=document.createElement('div');
      row.style.cssText='font-size:11px;padding:4px 8px;background:var(--c-tint-amber);border:1px solid #f0dcc0;border-radius:4px;margin-bottom:3px;';
      row.innerHTML='<strong>'+b.type+'</strong>: '+b.name
        +(b.detail?' <span style="color:#999;">('+b.detail+')</span>':'')
        +'<span style="margin-left:6px;color:var(--c-warn);font-size:10px;">removed from Max — contact provider</span>';
      list.appendChild(row);
    });
    container.appendChild(list);
  });
}

function showCancellationChecklist(dest){
  if(!dest.pendingCancellations||!dest.pendingCancellations.items||!dest.pendingCancellations.items.length)return;
  var pc=dest.pendingCancellations;
  var overlay=document.createElement('div'); overlay.className='move-dialog-overlay';
  var dlg=document.createElement('div'); dlg.className='move-dialog';
  var title=document.createElement('div'); title.className='move-dialog-title';
  title.style.color='#2a7a4e'; title.textContent='\u2713 Dates updated in Max';
  dlg.appendChild(title);
  var notice=document.createElement('div'); notice.className='move-dialog-warn';
  notice.innerHTML='<strong>Max has been updated.</strong> Contact each provider below to cancel or adjust your reservations.';
  dlg.appendChild(notice);
  buildCancelRows(dlg,pc.items);
  var acts=document.createElement('div'); acts.className='move-dialog-actions';
  var emailBtn=document.createElement('button'); emailBtn.className='move-dialog-cancel'; emailBtn.textContent='\u2709 Email myself this list';
  (function(dn,its){emailBtn.onclick=function(){openMailtoChecklist(dn,its);};})(pc.destName,pc.items);
  var doneBtn=document.createElement('button'); doneBtn.className='move-dialog-confirm'; doneBtn.textContent='Done \u2014 Provider contacted';
  doneBtn.onclick=function(){dest.pendingCancellations=null;document.body.removeChild(overlay);_emitTripMutation();};
  acts.appendChild(emailBtn); acts.appendChild(doneBtn); dlg.appendChild(acts);
  overlay.appendChild(dlg);
  document.body.appendChild(overlay);
}

function showDateChangeDialog(dest,newFrom,newTo,affected,onConfirm){
  var overlay=document.createElement('div'); overlay.className='move-dialog-overlay';
  var dlg=document.createElement('div'); dlg.className='move-dialog';

  function showPhase1(){
    dlg.innerHTML='';
    var title=document.createElement('div'); title.className='move-dialog-title';
    title.textContent='Update dates for '+(dest.label||dest.place); dlg.appendChild(title);

    var hasOwnBookings=affected.bookings.length>0;
    var hasOverlaps=affected.overlapping.length>0;
    var hasAnything=hasOwnBookings||hasOverlaps;

    // Overlap warning
    if(hasOverlaps){
      var ovNames=affected.overlapping.map(function(o){return o.dest;}).join(', ');
      var ovWarn=document.createElement('div'); ovWarn.className='move-dialog-warn';
      ovWarn.style.cssText='background:#fff3cd;border-color:#ffc107;color:#856404;';
      ovWarn.innerHTML='<strong>\u26a0 These dates overlap with '+ovNames+'.</strong> Changes to both destinations are shown below. Do you still want to proceed?';
      dlg.appendChild(ovWarn);
    }

    // Helper to render a destination section
    function mkDestSection(name, bookings, extraNote){
      var sec=document.createElement('div');
      sec.style.cssText='margin-bottom:10px;border:1px solid #e8e0d8;border-radius:6px;overflow:hidden;';
      var hdr=document.createElement('div');
      hdr.style.cssText='font-size:11px;font-weight:700;padding:5px 10px;background:#f7f3ee;border-bottom:1px solid #e8e0d8;color:#333;';
      hdr.textContent='In '+name;
      sec.appendChild(hdr);
      var body=document.createElement('div'); body.style.cssText='padding:5px 10px 8px;';
      if(bookings&&bookings.length>0){
        bookings.forEach(function(b){
          var row=document.createElement('div'); row.style.cssText='font-size:11px;padding:3px 0;display:flex;align-items:baseline;gap:6px;';
          row.innerHTML='<span style="color:var(--c-warn);">✕</span><span><strong>'+b.type+':</strong> '+b.name+(b.detail?' <span style="color:#999;font-size:10px;">('+b.detail+')</span>':'')+'</span>';
          body.appendChild(row);
        });
      } else if(extraNote){
        var note=document.createElement('div'); note.style.cssText='font-size:11px;color:var(--c-ink-3);';
        note.textContent=extraNote; body.appendChild(note);
      } else {
        var ok=document.createElement('div'); ok.style.cssText='font-size:11px;color:var(--c-see);';
        ok.textContent='No bookings affected.'; body.appendChild(ok);
      }
      sec.appendChild(body);
      return sec;
    }

    if(hasAnything){
      // Current destination section
      dlg.appendChild(mkDestSection(
        dest.label||dest.place,
        affected.bookings,
        hasOwnBookings?null:'No bookings to update.'
      ));
      // Overlapping destination sections
      affected.overlapping.forEach(function(d){
        var note=null;
        if(!d.bookings||d.bookings.length===0){
          note='No bookings — any itinerary items in overlapping days will be returned to suggestions.';
        }
        dlg.appendChild(mkDestSection(d.dest, d.bookings, note));
      });
    }

    var acts=document.createElement('div'); acts.className='move-dialog-actions';
    var backBtn=document.createElement('button'); backBtn.className='move-dialog-cancel'; backBtn.textContent='Go back';
    backBtn.onclick=function(){document.body.removeChild(overlay);};
    var confirmText=hasOverlaps?'Yes, update dates':'Update dates';
    var confirmBtn=document.createElement('button'); confirmBtn.className='move-dialog-confirm'; confirmBtn.textContent=confirmText;
    confirmBtn.onclick=function(){
      var items=buildCancelItems(dest,affected);
      dest.pendingCancellations=null;
      (affected.overlapping||[]).forEach(function(ov){var od=getDest(ov.id);if(od)od.pendingCancellations=null;});
      items.forEach(function(it){
        addPendingAction({eventType:it.type.toLowerCase(),actionType:'Contact provider to adjust or cancel',
          eventName:it.name,destName:it.dest,
          confirmationNumber:it.detail&&it.detail.indexOf('Conf:')>-1?it.detail.replace(/.*Conf:\s*/,'').replace(/ \u2014.*/,''):null,
          detail:it.detail,requiresProviderAction:true});
      });
      if(items.length>0){dest.pendingCancellations={destName:dest.label||dest.place,items:items};autoSave();}
      onConfirm(); showPhase2(items);
    };
    acts.appendChild(backBtn); acts.appendChild(confirmBtn); dlg.appendChild(acts);
  }

  function showPhase2(items){
    dlg.innerHTML='';
    var title=document.createElement('div'); title.className='move-dialog-title';
    title.style.color='#2a7a4e'; title.textContent='\u2713 Dates updated in Max'; dlg.appendChild(title);
    if(items.length>0){
      var notice=document.createElement('div'); notice.className='move-dialog-warn';
      notice.innerHTML='<strong>Max has been updated.</strong> You can keep this open while you make your arrangements, and/or email the changes to yourself.';
      dlg.appendChild(notice);
      buildCancelRows(dlg,items);
    } else {
      var noItems=document.createElement('div'); noItems.className='move-dialog-warn';
      noItems.style.cssText='background:var(--c-tint-green);border-color:#b8dfc9;color:var(--c-see);';
      noItems.innerHTML='<strong>All done</strong> \u2014 no provider contact needed for this change.';
      dlg.appendChild(noItems);
    }
    var acts=document.createElement('div'); acts.className='move-dialog-actions';
    if(items.length>0){
      var emailBtn=document.createElement('button'); emailBtn.className='move-dialog-cancel'; emailBtn.textContent='\u2709 Email myself this list';
      (function(dn,its){emailBtn.onclick=function(){openMailtoChecklist(dn,its);};})(dest.label||dest.place,items);
      acts.appendChild(emailBtn);
    }
    var doneBtn=document.createElement('button'); doneBtn.className='move-dialog-confirm'; doneBtn.textContent='Done';
    doneBtn.onclick=function(){dest.pendingCancellations=null;document.body.removeChild(overlay);_emitTripMutation();};
    acts.appendChild(doneBtn); dlg.appendChild(acts);
  }

  showPhase1();
  overlay.appendChild(dlg);
  // No click-outside-to-close: this dialog is a working reference
  document.body.appendChild(overlay);
}


// path-to-10:A done — mutator emits tripChange + mapDataChange via _emitTripMutation; no direct drawXxx calls. See path-to-10.md item A (HY round, May 2026).
function applyDateChange(dest,newFrom,newTo,affected){
  var destId=dest.id;
  var oldTo=dest.dateTo;
  dest.dateFrom=newFrom; dest.dateTo=newTo;
  var fD=new Date(newFrom+"T12:00:00"), tD=new Date(newTo+"T12:00:00");
  dest.nights=Math.max(1,Math.round((+tD-+fD)/86400000));
  // Update existing day labels; add/remove days as needed
  var count=Math.min(dest.nights,7);
  for(var i=0;i<count;i++){
    var d=new Date(newFrom+"T12:00:00"); d.setDate(d.getDate()+i);
    var lbl=d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
    if(dest.days[i]) dest.days[i].lbl=lbl;
    else dest.days.push({id:"dy"+destId+"_"+i,lbl:lbl,note:"",items:[]});
  }
  if(dest.days.length>count) dest.days=dest.days.slice(0,count);

  // Clear own bookings including hotel — user must contact all providers directly
  if(affected){
    dest.hotelBookings=[]; dest.generalBookings=[];
    // Clear transport legs to/from this dest
    Object.keys(trip.legs||{}).forEach(function(k){
      var parts=k.split('-');
      if(parts.length===2&&(parts[0]===dest.id||parts[1]===dest.id)) trip.legs[k]={bookings:[]};
    });
    // For overlapping destinations: move overlap-period items back to pool, clear bookings
    (affected.overlapping||[]).forEach(function(ov){
      var od=trip.destinations.find(function(d){return d.id===ov.id;});
      if(!od) return;
      // Clear bookings
      od.hotelBookings=[]; od.generalBookings=[];
      Object.keys(trip.legs||{}).forEach(function(k){
        var parts=k.split('-');
        if(parts.length===2&&(parts[0]===od.id||parts[1]===od.id)) trip.legs[k]={bookings:[]};
      });
      // Return items from overlapping days back to suggestions, collecting names for log
      var returnedItems=[];
      if(od.days){
        od.days.forEach(function(day,di){
          var dayDate=new Date(od.dateFrom+'T12:00:00'); dayDate.setDate(dayDate.getDate()+di);
          var dayStr=dayDate.toISOString().slice(0,10);
          var inOverlap=dayStr<=newTo;
          if(inOverlap){
            (day.items||[]).forEach(function(s){
              returnedItems.push(s.n);
              if(s.type==='sight'){
                if(!od.suggestions) od.suggestions=[];
                var alreadyIn=od.suggestions.some(function(sg){return sg.n===s.n;});
                if(!alreadyIn) od.suggestions.push({id:s.id,type:'sight',n:s.n,st:s.st||s.n,
                  note:s.note||null,lat:s.lat||null,lng:s.lng||null,approx:!!s.approx});
              } else if(s.type==='restaurant'){
                if(!od.restaurantSuggestions) od.restaurantSuggestions=[];
                var alreadyInR=od.restaurantSuggestions.some(function(rs){return rs.n===s.n;});
                if(!alreadyInR) od.restaurantSuggestions.push({id:s.id,type:'restaurant',n:s.n,
                  st:s.st||s.n,note:s.note||null,lat:s.lat||null,lng:s.lng||null});
              }
            });
            day.items=[];
          }
          // Non-overlapping days keep their items untouched
        });
      }
      ov._returnedItems=returnedItems;
    });
  }

  // Build action log
  var logEntries=[];
  if(affected){
    (affected.bookings||[]).forEach(function(b){
      logEntries.push({type:'cleared',icon:'❌',text:b.type+' removed: '+b.name+' ('+b.detail+')'});
    });
    (affected.overlapping||[]).forEach(function(ov){
      var hadBookings=ov.bookings&&ov.bookings.length>0;
      var returnedItems=ov._returnedItems||[];
      if(hadBookings){
        logEntries.push({type:'cleared',icon:'❌',text:'Bookings cleared for '+ov.dest+' — '+ov.detail});
      }
      if(returnedItems.length>0){
        logEntries.push({type:'pool',icon:'↩️',text:'Returned to '+ov.dest+' suggestions: '+returnedItems.join(', ')});
      }
    });
  }
  if(logEntries.length>0) showActionLog(logEntries);

  closeListDateEdit(destId);
  trip.destinations.sort(function(a,b){return(a.dateFrom||'').localeCompare(b.dateFrom||'');});
  // Round FN.2: cascade dates forward to close any gap created by shrink
  // or push subsequent destinations later on extend. Walks from the
  // edited destination's index forward, setting each subsequent dest's
  // dateFrom to the previous dest's dateTo. Each kept destination's
  // own nights count is preserved; only its calendar position shifts.
  // Mirrors the picker rebuild's recompute pass.
  var editedIdx = trip.destinations.findIndex(function(d){return d.id===destId;});
  if (editedIdx >= 0) {
    var prevTo = dest.dateTo;
    for (var i = +(editedIdx + 1); i < trip.destinations.length; i++) {
      var nd = trip.destinations[i];
      var newFromIso = prevTo;
      var fromD = new Date(newFromIso + 'T12:00:00');
      var toD = new Date(fromD); toD.setDate(toD.getDate() + (nd.nights || 0));
      var newToIso = toD.toISOString().slice(0,10);
      nd.dateFrom = newFromIso;
      nd.dateTo = newToIso;
      // If nd.days is intact, shift each day's date forward too.
      if (Array.isArray(nd.days) && nd.days.length === (nd.nights || 0)) {
        var dayCur = new Date(fromD);
        nd.days.forEach(function(day){
          day.date = dayCur.toISOString().slice(0,10);
          dayCur.setDate(dayCur.getDate() + 1);
        });
      }
      prevTo = newToIso;
    }
  }
  // v324: backward cascade. The forward pass above only walks from
  // editedIdx + 1 — so editing a destination's dateFrom EARLIER than
  // the previous destination's dateTo left those previous destinations
  // sitting on the same calendar slot ("Dates overlap with…"). Now we
  // also walk from editedIdx − 1 down to 0: for each prev dest whose
  // dateTo extends past the next dest's dateFrom, snap prev's dateTo
  // to next.dateFrom and shift dateFrom = dateTo − nights. Stops as
  // soon as a prev fits cleanly (relationships farther back are
  // already valid since we didn't shift them pre-edit).
  if (editedIdx > 0) {
    var nextFrom = dest.dateFrom;
    for (var j = editedIdx - 1; j >= 0; j--) {
      var pd = trip.destinations[j];
      if (pd.dateTo > nextFrom) {
        pd.dateTo = nextFrom;
        var ptoD = new Date(pd.dateTo + 'T12:00:00');
        var pfromD = new Date(ptoD); pfromD.setDate(pfromD.getDate() - (pd.nights || 0));
        pd.dateFrom = pfromD.toISOString().slice(0,10);
        if (Array.isArray(pd.days) && pd.days.length === (pd.nights || 0)) {
          var pDayCur = new Date(pfromD);
          pd.days.forEach(function(day){
            day.date = pDayCur.toISOString().slice(0,10);
            pDayCur.setDate(pDayCur.getDate() + 1);
          });
        }
        nextFrom = pd.dateFrom;
      } else {
        break;
      }
    }
  }
  // Re-evaluate over-budget banner since the trip's end-date may have moved.
  if (typeof _reEvaluateOverBudget === "function") _reEvaluateOverBudget();
  // Round HE: emit instead of direct drawXxx tail. setTimeout scroll
  // below still works — emit is synchronous so the new card list is
  // already in the DOM when the timeout fires.
  _emitTripMutation();
  // Scroll the card into view after sort reorders the list
  setTimeout(function(){
    var card=document.querySelector('.tm-dest[data-id="'+destId+'"]')||document.getElementById('tm-card-'+destId);
    if(!card){
      // fallback: find by active class or dest name
      var cards=document.querySelectorAll('.tm-dest');
      cards.forEach(function(c){if(c.querySelector('[id*="'+destId+'"]'))card=c;});
    }
    if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
  },100);
}

function checkOverlaps(){
  var overlaps=[]; var ds=trip.destinations;
  for(var i=0;i<ds.length;i++) for(var j=i+1;j<ds.length;j++)
    if(ds[i].dateFrom<ds[j].dateTo&&ds[j].dateFrom<ds[i].dateTo)
      overlaps.push({a:ds[i],b:ds[j]});
  return overlaps;
}

function checkAndShowOverlaps(){
  var overlaps=checkOverlaps();
  trip.destinations.forEach(function(dest){
    var warn=g("ov-warn-"+dest.id); if(!warn)return;
    var rel=overlaps.filter(function(o){return o.a.id===dest.id||o.b.id===dest.id;});
    if(rel.length){
      warn.classList.remove("hidden");
      warn.textContent="\u26a0\ufe0f Dates overlap with: "+rel.map(function(o){
        var other=o.a.id===dest.id?o.b:o.a;
        return other.place+" ("+fmtD(other.dateFrom)+"\u2013"+fmtD(other.dateTo)+")";
      }).join(", ");
    } else {
      warn.classList.add("hidden"); warn.textContent="";
    }
  });
}

// ── Booking infrastructure ─────────────────────────────────
// ── Action queue ───────────────────────────────────────────
function newActionId(){ return "act"+(++_actionCtr); }

// addPendingAction moved to engine-trip.js (Round HO).

function clearPendingAction(id){
  if(!trip.pendingActions) return;
  var a=trip.pendingActions.find(function(x){return x.id===id;});
  if(a){a.cleared=true;autoSave();updateTrackerBadge();}
}

function clearAllPendingActions(){
  if(!trip.pendingActions) return;
  trip.pendingActions.forEach(function(a){a.cleared=true;});
  autoSave(); updateTrackerBadge();
}

function pendingCount(){
  if(!trip.pendingActions) return 0;
  return trip.pendingActions.filter(function(a){return !a.cleared&&a.requiresProviderAction;}).length;
}

// v359.60.64: per-destination count for badge + per-dest UI. Counts
// open provider actions whose destName matches this destination's
// label/place AND any cancellation deadlines that resolve to this
// destination — same scope the Action needed surface shows.
function destPendingCount(dest){
  if (!dest) return 0;
  var dName = (dest.label || dest.place || "").toLowerCase();
  var n = 0;
  if (Array.isArray(trip.pendingActions)) {
    n += trip.pendingActions.filter(function(a){
      if (!a || a.cleared || !a.requiresProviderAction) return false;
      return (a.destName || "").toLowerCase() === dName;
    }).length;
  }
  try {
    if (typeof collectDeadlines === "function") {
      n += (collectDeadlines(dest) || []).length;
    }
  } catch (_) {}
  return n;
}
if (typeof globalThis !== "undefined") globalThis.destPendingCount = destPendingCount;

function updateTrackerBadge(){
  // v359.60.64: badge is per-destination, not trip-wide. activeDest
  // is the destination currently rendered in destMode.
  var dest = (typeof activeDest !== "undefined" && activeDest && typeof getDest === "function")
    ? getDest(activeDest) : null;
  var n = dest ? destPendingCount(dest) : 0;
  document.querySelectorAll('#dm-tab-actionNeeded').forEach(function(btn){
    var badge=btn.querySelector('.dm-tab-badge');
    if(n>0){
      if(!badge){badge=document.createElement('span');badge.className='dm-tab-badge';btn.appendChild(badge);}
      badge.textContent=String(n);
      // Round FN.3: also flag the tab itself so the attention signal
      // shows even when the user is looking at a different tab.
      btn.classList.add('has-attention');
    } else {
      if(badge) badge.parentNode.removeChild(badge);
      btn.classList.remove('has-attention');
    }
  });
}

function openMailtoActions(){
  if(!trip.pendingActions) return;
  var open=trip.pendingActions.filter(function(a){return !a.cleared&&a.requiresProviderAction;});
  if(!open.length) return;
  var subject='Provider action needed — '+trip.name;
  var body='The following bookings need action with providers:\n\n';
  open.forEach(function(a){
    body+=a.eventType.charAt(0).toUpperCase()+a.eventType.slice(1)+': '+a.eventName;
    if(a.destName) body+=' ('+a.destName+')';
    body+=' — '+a.actionType;
    if(a.confirmationNumber) body+='\nConf: '+a.confirmationNumber;
    if(a.detail) body+='\n'+a.detail;
    body+='\n\n';
  });
  body+='— Sent from Max';
  window.location.href='mailto:?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}

// ── Time conflict detection ─────────────────────────────────
function timeToMins(t){
  if(!t) return null;
  var p=t.split(':'); return parseInt(p[0])*60+parseInt(p[1]);
}

function timesOverlap(startA,endA,startB,endB){
  var sa=timeToMins(startA),ea=timeToMins(endA);
  var sb=timeToMins(startB),eb=timeToMins(endB);
  if(sa===null||sb===null) return false;
  // If no end time, treat as point event — only flag if same start
  var eaR=ea!==null?ea:sa+1;
  var ebR=eb!==null?eb:sb+1;
  return sa<ebR&&eaR>sb;
}

function checkTimeConflicts(dest,dayId){
  if(!dest) return;
  dest.days.forEach(function(day){
    if(dayId&&day.id!==dayId) return;
    var items=(day.items||[]).filter(function(s){return s.timeStart;});

    // Include booked events with times — transport and general bookings
    var bookedEvents=[];
    Object.keys(trip.legs||{}).forEach(function(k){
      var leg=trip.legs[k];
      if(leg.fromId!==dest.id) return;
      (leg.bookings||[]).filter(function(b){return b.status==='booked'&&b.departureTime;}).forEach(function(b){
        bookedEvents.push({id:'bk-'+b.id,n:b.operator||'Transport',
          timeStart:b.departureTime,timeEnd:b.arrivalTime||null,_isBooking:true});
      });
    });
    (dest.generalBookings||[]).filter(function(b){
      return b.status==='booked'&&b.date&&b.time;
    }).forEach(function(b){
      bookedEvents.push({id:'bk-'+b.id,n:b.label||b.type,
        timeStart:b.time,timeEnd:b.timeEnd||null,_isBooking:true});
    });

    var all=items.concat(bookedEvents);
    all.forEach(function(s){
      s._timeConflict=false;
      var el=document.getElementById('sr-'+s.id);
      if(el){el.classList.remove('conflict-item');
        var tl=el.querySelector('.srow-time');if(tl)tl.classList.remove('conflict');}
    });
    for(var i=0;i<all.length;i++){
      for(var j=i+1;j<all.length;j++){
        if(timesOverlap(all[i].timeStart,all[i].timeEnd,all[j].timeStart,all[j].timeEnd)){
          all[i]._timeConflict=true; all[j]._timeConflict=true;
        }
      }
    }
    all.forEach(function(s){
      var el=document.getElementById('sr-'+s.id);
      if(el&&s._timeConflict){
        el.classList.add('conflict-item');
        var tl=el.querySelector('.srow-time');if(tl)tl.classList.add('conflict');
      }
    });
    // Surface booking conflicts in Tracker
    bookedEvents.filter(function(e){return e._timeConflict;}).forEach(function(e){
      var existingConflict=trip.pendingActions&&trip.pendingActions.find(function(a){
        return a.eventName===e.n&&a.actionType==='time conflict'&&!a.cleared;
      });
      if(!existingConflict){
        addPendingAction({eventType:'booking',actionType:'time conflict',
          eventName:e.n,destName:dest.label||dest.place,
          detail:'Time overlaps with another event — review schedule',
          requiresProviderAction:false}); // No provider action — just user awareness
      }
    });
  });
}

function newBkId(){ return "bk"+(++bkCtr); }

function getLeg(fromId,toId){
  var key=fromId+"|"+toId;
  if(!trip.legs[key]) trip.legs[key]={fromId:fromId,toId:toId,bookings:[]};
  return trip.legs[key];
}

function mkDateInp(id, value, opts){
  // Text input backed by Pikaday — clean date picker
  var inp=document.createElement("input");
  inp.type="text"; inp.className="bk-inp date-edit-inp";
  inp.style.cssText="cursor:pointer;width:90px;";
  if(id) inp.id=id;
  inp.readOnly=true;
  inp.placeholder="Pick date";

  // Store ISO value separately
  inp._isoValue = value||"";
  if(value){
    var dv=new Date(value+"T12:00:00");
    inp.value=dv.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  }

  var _pik=null;
  function getPik(){
    if(_pik) return _pik;
    if(typeof Pikaday==="undefined") return null;
    var pikOpts={
      field: inp,
      toString: function(d){ return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); },
      parse: function(s){ var d=new Date(s); return isNaN(+d)?new Date():d; },
      onSelect: function(date){
        inp._isoValue=date.toISOString().slice(0,10);
        inp.value=_pik.toString(date);
        if(opts&&opts.onSelect) opts.onSelect(inp._isoValue, date);
      },
      yearRange: [2020,2030]
    };
    if(opts&&opts.minDate) pikOpts.minDate=new Date(opts.minDate+"T12:00:00");
    _pik=new Pikaday(pikOpts);
    return _pik;
  }

  inp.addEventListener("click", function(){
    var p=getPik(); if(p) p.show();
  });
  inp.addEventListener("focus", function(){
    var p=getPik(); if(p) p.show();
  });

  inp.getIso=function(){ return inp._isoValue||""; };
  inp.setIso=function(v){
    inp._isoValue=v||"";
    if(v){ var d=new Date(v+"T12:00:00"); inp.value=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
    else inp.value="";
  };
  inp.setMin=function(minIso){
    var p=getPik();
    if(p&&minIso) p.setMinDate(new Date(minIso+"T12:00:00"));
    else if(p) p.setMinDate(null);
  };
  inp.destroy=function(){ if(_pik){ _pik.destroy(); _pik=null; } };
  return inp;
}


function mkField(labelText,inputEl){
  var w=document.createElement("div"); w.className="bk-field";
  var l=document.createElement("div"); l.className="bk-lbl"; l.textContent=labelText;
  w.appendChild(l); w.appendChild(inputEl); return w;
}

function mkCancelField(formId){
  // v353.6: dropped the deadline-time input. Property-local vs
  // user-local time zones, ambiguous AM/PM in raw text, and the
  // rarity of cases where minute precision actually mattered made
  // the time field more confusing than useful. We now capture the
  // date only. cancelDeadlineTime stays in the data shape (the
  // field is preserved on already-saved bookings for legacy display)
  // but new entries via this form always pass deadlineTime:null.
  var wrap=document.createElement('div'); wrap.className='cancel-row';
  var lbl=document.createElement('span'); lbl.className='cancel-lbl'; lbl.textContent='Enter cancellation policy'; lbl.style.color='#c0392b';
  var optsDiv=document.createElement('div'); optsDiv.className='cancel-opts';
  var dateInp=document.createElement('input'); dateInp.type='date'; dateInp.className='cancel-date-inp'; dateInp.id=formId+'-cancel-date';
  var selected='';
  [{val:'deadline',lbl:'Cancel by date'},{val:'non-cancellable',lbl:'Non-cancellable'}].forEach(function(o){
    var btn=document.createElement('button'); btn.className='cancel-opt '+o.val.replace(/-/g,'');
    btn.textContent=o.lbl; btn.type='button';
    btn.onclick=function(e){
      e.preventDefault(); e.stopPropagation();
      selected=o.val;
      optsDiv.querySelectorAll('.cancel-opt').forEach(function(b){b.classList.remove('selected');});
      btn.classList.add('selected');
      dateInp.style.display=o.val==='deadline'?'inline-block':'none';
    };
    optsDiv.appendChild(btn);
  });
  dateInp.style.display='none';
  wrap.appendChild(lbl); wrap.appendChild(optsDiv); wrap.appendChild(dateInp);
  wrap.getCancelPolicy=function(){return {
    type:selected,
    deadline:selected==='deadline'?(dateInp.value||null):null,
    // Always null on new entries — see comment above. Existing saved
    // bookings keep their original cancelDeadlineTime untouched.
    deadlineTime:null
  };};
  return wrap;
}

function mkCurrSel(id,val){
  var sel=document.createElement("select"); sel.className="bk-inp"; sel.id=id;
  // Round FN.9: extended currency list to cover the destinations
  // we already model — Iceland (ISK), Japan (JPY), Norway (NOK),
  // Sweden (SEK), Denmark (DKK), Australia (AUD), Canada (CAD),
  // New Zealand (NZD), Mexico (MXN). Common-first ordering, then
  // alphabetical for the rest.
  ["EUR","USD","GBP","CHF","CZK","HUF","ISK","JPY","NOK","SEK","DKK","AUD","CAD","NZD","MXN"].forEach(function(c){
    var o=document.createElement("option"); o.value=c; o.textContent=c;
    if(c===(val||"EUR")) o.selected=true; sel.appendChild(o);
  });
  return sel;
}

// ── Transport booking ──────────────────────────────────────
function toggleTransportForm(btn,container,formId,opts){
  var existing=g(formId);
  if(existing){existing.parentNode.removeChild(existing);btn.classList.remove("active");btn.textContent="Book";return;}
  btn.classList.add("active"); btn.textContent="Close";
  var form=document.createElement("div"); form.className="bk-form"; form.id=formId;
  var r1=document.createElement("div"); r1.className="bk-row";
  var dateInp=document.createElement("input"); dateInp.type="date"; dateInp.className="bk-inp"; dateInp.value=opts.defaultDate||"";
  var timeInp=document.createElement("input"); timeInp.type="time"; timeInp.className="bk-inp";
  var arrDateInp=document.createElement("input"); arrDateInp.type="date"; arrDateInp.className="bk-inp"; arrDateInp.value=opts.defaultDate||"";
  var arrTimeInp=document.createElement("input"); arrTimeInp.type="time"; arrTimeInp.className="bk-inp";
  var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="Confirmation #";
  // Auto-fill arrival date when departure date changes
  dateInp.onchange=function(){if(!arrDateInp.value)arrDateInp.value=dateInp.value;};
  r1.appendChild(mkField("Depart date",dateInp)); r1.appendChild(mkField("Time",timeInp)); r1.appendChild(mkField("Arrive date",arrDateInp)); r1.appendChild(mkField("Time",arrTimeInp)); r1.appendChild(mkField("Conf #",confInp));
  var r2=document.createElement("div"); r2.className="bk-row";
  var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01";
  var currSel=mkCurrSel(formId+"-cur",opts.currency);
  var notesInp=document.createElement("input"); notesInp.type="text"; notesInp.className="bk-inp"; notesInp.placeholder="Seat, platform, baggage\u2026";
  r2.appendChild(mkField("Price paid",priceInp)); r2.appendChild(mkField("Currency",currSel)); r2.appendChild(mkField("Notes",notesInp));
  // Round DE: booking URL \u2014 paste the airline/rail confirmation page
  var rT3=document.createElement("div"); rT3.className="bk-row";
  var urlInpT=document.createElement("input"); urlInpT.type="url"; urlInpT.className="bk-inp"; urlInpT.placeholder="https:// \u2014 confirmation page or carrier site"; urlInpT.style.flex="1";
  rT3.appendChild(mkField("Booking URL",urlInpT));
  form.appendChild(r1); form.appendChild(r2); form.appendChild(rT3);
  var cancelFieldT=mkCancelField(formId+"-tc"); form.appendChild(cancelFieldT);
  var acts=document.createElement("div"); acts.className="bk-form-actions";
  var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save booking";
  var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
  cx.onclick=function(){form.parentNode.removeChild(form);btn.classList.remove("active");btn.textContent="Book";};
  sv.onclick=function(){
    var cp=cancelFieldT.getCancelPolicy();
    var bk={id:newBkId(),mode:opts.mode,operator:opts.operator,from:opts.from,to:opts.to,
      departure:dateInp.value,departureTime:timeInp.value,
      arrival:arrDateInp.value||null,arrivalTime:arrTimeInp.value||null,
      confirmationNumber:confInp.value,
      pricePaid:parseFloat(priceInp.value)||null,currency:currSel.value,notes:notesInp.value,
      url:urlInpT.value.trim()||null,
      status:"booked",source:"manual",cancelType:cp.type,cancelDeadline:cp.deadline,cancelDeadlineTime:cp.deadlineTime||null};
    getLeg(opts.fromId,opts.toId).bookings.push(bk);
    form.parentNode.removeChild(form);
    btn.classList.remove("active"); btn.textContent="Book";
    container.appendChild(mkTransportRecord(bk,opts.fromId,opts.toId));
    // Sync to tracker Transport section on both involved destinations
    [opts.fromId,opts.toId].forEach(function(did){
      var tkTrans=g("tk-transport-"+did);
      if(tkTrans){
        var emp=tkTrans.querySelector(".tk-empty"); if(emp)emp.parentNode.removeChild(emp);
        tkTrans.appendChild(mkTransportRecord(bk,opts.fromId,opts.toId));
      }
    });
    autoSave();
    // Redraw itinerary so transport chip updates to show booked state
    if(activeDest&&_leftMode==='dest') setTimeout(function(){drawDestMode(activeDest);},50);
  };
  acts.appendChild(sv); acts.appendChild(cx); form.appendChild(acts);
  container.appendChild(form);
}

function mkTransportRecord(bk,fromId,toId){
  var rec=document.createElement("div"); rec.className="bk-record"+(bk.status==="cancelled"?" cancelled":""); rec.id="bkrec-"+bk.id;
  var main=document.createElement("div"); main.className="bk-rec-main";
  main.textContent="\u2713 "+bk.operator+(bk.departure?" \u00b7 "+fmtD(bk.departure):"")+(bk.departureTime?" "+bk.departureTime:"")+(bk.arrival&&bk.arrival!==bk.departure?" \u2192 "+fmtD(bk.arrival)+(bk.arrivalTime?" "+bk.arrivalTime:""):bk.arrivalTime?" \u2192 "+bk.arrivalTime:"");
  var parts=[]; if(bk.confirmationNumber)parts.push("Conf: "+bk.confirmationNumber);
  if(bk.pricePaid)parts.push(bk.currency+" "+bk.pricePaid.toFixed(2)); if(bk.notes)parts.push(bk.notes);
  rec.appendChild(main);
  if(parts.length){var meta=document.createElement("div");meta.className="bk-rec-meta";meta.textContent=parts.join(" \u00b7 ");rec.appendChild(meta);}
  // Round DE: clickable URL row when set
  if(bk.url){
    var urlRow=document.createElement("div"); urlRow.className="bk-rec-meta";
    var urlA=document.createElement("a");
    urlA.href=bk.url; urlA.target="_blank"; urlA.rel="noopener noreferrer";
    urlA.style.cssText="color:var(--c-primary);text-decoration:none;font-weight:500;";
    urlA.textContent="\u2197 Booking";
    urlRow.appendChild(urlA);
    rec.appendChild(urlRow);
  }
  if(bk.cancelType){var cpLine=document.createElement("div");cpLine.className="bk-rec-meta";cpLine.style.fontWeight="600";if(bk.cancelType==="deadline"){cpLine.style.color="#d97706";cpLine.textContent="Cancel by: "+(bk.cancelDeadline?fmtD(bk.cancelDeadline)+(bk.cancelDeadlineTime?" at "+bk.cancelDeadlineTime:""):"date not set");}else if(bk.cancelType==="non-cancellable"){cpLine.style.color="#e05050";cpLine.textContent="Non-cancellable";}rec.appendChild(cpLine);}
  var a=document.createElement("div"); a.className="bk-rec-acts";
  if(bk.status!=="cancelled"){
    // Round FN.1: Edit affordance on transport records. Mirrors the
    // hotel record's edit flow — opens an inline form pre-filled with
    // the current values so the user can correct or backfill fields
    // (notably time, URL, cancellation policy on bookings made before
    // those inputs existed).
    var eb=document.createElement("button"); eb.className="bk-rec-btn"; eb.textContent="Edit";
    (function(b,r,fId,tId){eb.onclick=function(){
      var editId="bk-edit-t-"+b.id;
      var existing=g(editId);
      if(existing){existing.parentNode.removeChild(existing);eb.textContent="Edit";return;}
      eb.textContent="Close";
      var form=document.createElement("div"); form.id=editId; form.className="bk-form"; form.style.marginTop="6px";
      var r1=document.createElement("div"); r1.className="bk-row";
      var dateInp=document.createElement("input"); dateInp.type="date"; dateInp.className="bk-inp"; dateInp.value=b.departure||"";
      var timeInp=document.createElement("input"); timeInp.type="time"; timeInp.className="bk-inp"; timeInp.value=b.departureTime||"";
      var arrDateInp=document.createElement("input"); arrDateInp.type="date"; arrDateInp.className="bk-inp"; arrDateInp.value=b.arrival||"";
      var arrTimeInp=document.createElement("input"); arrTimeInp.type="time"; arrTimeInp.className="bk-inp"; arrTimeInp.value=b.arrivalTime||"";
      var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="Confirmation #"; confInp.value=b.confirmationNumber||"";
      r1.appendChild(mkField("Depart date",dateInp)); r1.appendChild(mkField("Time",timeInp)); r1.appendChild(mkField("Arrive date",arrDateInp)); r1.appendChild(mkField("Time",arrTimeInp)); r1.appendChild(mkField("Conf #",confInp));
      var r2=document.createElement("div"); r2.className="bk-row";
      var operatorInp=document.createElement("input"); operatorInp.type="text"; operatorInp.className="bk-inp"; operatorInp.placeholder="Operator"; operatorInp.value=b.operator||"";
      var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01"; priceInp.value=b.pricePaid||"";
      var currSel=mkCurrSel(editId+"-cur",b.currency||"EUR");
      var notesInp=document.createElement("input"); notesInp.type="text"; notesInp.className="bk-inp"; notesInp.placeholder="Seat, platform, baggage…"; notesInp.value=b.notes||"";
      r2.appendChild(mkField("Operator",operatorInp)); r2.appendChild(mkField("Price paid",priceInp)); r2.appendChild(mkField("Currency",currSel)); r2.appendChild(mkField("Notes",notesInp));
      var r3=document.createElement("div"); r3.className="bk-row";
      var urlInp=document.createElement("input"); urlInp.type="url"; urlInp.className="bk-inp"; urlInp.placeholder="https:// — confirmation page or carrier site"; urlInp.value=b.url||""; urlInp.style.flex="1";
      r3.appendChild(mkField("Booking URL",urlInp));
      form.appendChild(r1); form.appendChild(r2); form.appendChild(r3);
      var cancelFieldT=mkCancelField(editId+"-tc");
      // Pre-select existing cancellation policy if any
      if(b.cancelType){
        setTimeout(function(){
          var optBtns=cancelFieldT.querySelectorAll('.cancel-opt');
          optBtns.forEach(function(btn){
            if((b.cancelType==='deadline'&&btn.classList.contains('deadline'))||
               (b.cancelType==='non-cancellable'&&btn.classList.contains('noncancellable'))){
              btn.click();
            }
          });
          if(b.cancelType==='deadline'&&b.cancelDeadline){
            var dInps=cancelFieldT.querySelectorAll('.cancel-date-inp');
            if(dInps[0])dInps[0].value=b.cancelDeadline;
            if(dInps[1]&&b.cancelDeadlineTime)dInps[1].value=b.cancelDeadlineTime;
          }
        },0);
      }
      form.appendChild(cancelFieldT);
      var acts2=document.createElement("div"); acts2.className="bk-form-actions";
      var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save changes";
      var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
      cx.onclick=function(){form.parentNode.removeChild(form);eb.textContent="Edit";};
      sv.onclick=function(){
        b.departure=dateInp.value||null;
        b.departureTime=timeInp.value||null;
        b.arrival=arrDateInp.value||null;
        b.arrivalTime=arrTimeInp.value||null;
        b.confirmationNumber=confInp.value;
        if(operatorInp.value.trim()) b.operator=operatorInp.value.trim();
        b.pricePaid=parseFloat(priceInp.value)||null;
        b.currency=currSel.value;
        b.notes=notesInp.value;
        b.url=urlInp.value.trim()||null;
        var cp3=cancelFieldT.getCancelPolicy();
        if(cp3.type){ b.cancelType=cp3.type; b.cancelDeadline=cp3.deadline; b.cancelDeadlineTime=cp3.deadlineTime||null; }
        autoSave();
        // Replace the record in place with a fresh render so the user
        // sees the updated values without a full page redraw.
        var fresh=mkTransportRecord(b,fId,tId);
        r.parentNode.replaceChild(fresh,r);
      };
      acts2.appendChild(sv); acts2.appendChild(cx); form.appendChild(acts2);
      r.appendChild(form);
      setTimeout(function(){form.scrollIntoView({block:"nearest",behavior:"smooth"});},60);
    };})(bk,rec,fromId,toId);
    a.appendChild(eb);
    var cb=document.createElement("button"); cb.className="bk-rec-btn danger"; cb.textContent="Cancel booking";
    (function(b,r){cb.onclick=function(){
      b.status="cancelled";
      var fromDest=getDest(fromId); var toDest=getDest(toId);
      addPendingAction({eventType:'transport',actionType:'Contact provider to adjust or cancel',
        eventName:b.operator||'Transport',
        destName:(fromDest?fromDest.label||fromDest.place:'')+(toDest?' → '+toDest.label||toDest.place:''),
        confirmationNumber:b.confirmationNumber||null,
        detail:'Contact provider to cancel'+(b.departure?' — departs '+fmtD(b.departure):''),
        requiresProviderAction:true});
      autoSave();var n=mkTransportRecord(b,fromId,toId);r.parentNode.replaceChild(n,r);
    };})(bk,rec);
    a.appendChild(cb);
  }
  var db=document.createElement("button"); db.className="bk-rec-btn"; db.textContent="\u2715 Delete";
  // Round FN.8.20: undo toast on transport-record delete. Snapshots
  // leg.bookings + trip.pendingActions before mutation.
  (function(b,r){db.onclick=function(){
    var legObj = getLeg(fromId, toId);
    var snapLegBookings = (legObj.bookings || []).slice();
    var snapPending = (trip.pendingActions || []).slice();
    var labelStr = b.operator || "Transport";
    if(b.status!=="cancelled"){
      var fromDest=getDest(fromId);var toDest=getDest(toId);
      addPendingAction({eventType:"transport",actionType:"Contact provider to adjust or cancel",
        eventName:b.operator||"Transport",
        destName:(fromDest?fromDest.label||fromDest.place:"")+(toDest?" \u2192 "+toDest.label||toDest.place:""),
        confirmationNumber:b.confirmationNumber||null,
        detail:"Contact provider to cancel"+(b.departure?" \u2014 departs "+fmtD(b.departure):""),
        requiresProviderAction:true});
    }
    legObj.bookings = (legObj.bookings || []).filter(function(x){return x.id!==b.id;});
    if(r.parentNode) r.parentNode.removeChild(r);
    if (typeof autoSave === "function") autoSave();
    if (typeof _showDayTripToast === "function") {
      _showDayTripToast("Deleted transport booking <strong>" + labelStr + "</strong>", function(){
        var lg = getLeg(fromId, toId);
        lg.bookings = snapLegBookings.slice();
        trip.pendingActions = snapPending.slice();
        if (typeof autoSave === "function") autoSave();
        if (activeDest && typeof drawDestMode === "function") drawDestMode(activeDest);
      });
    }
  };})(bk,rec);
  a.appendChild(db); rec.appendChild(a); return rec;
}

function toggleHotelForm(btn,container,formId,opts,onSaved){
  var existing=g(formId);
  if(existing){
    existing.parentNode.removeChild(existing);
    btn.classList.remove("active");
    // v359.60.45: restore the ORIGINAL button label instead of
    // hardcoding "Book". "Book any hotel" was getting clobbered to
    // just "Book" after a single open/close cycle.
    btn.textContent = btn.dataset.originalText || "Book";
    return;
  }
  if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
  btn.classList.add("active"); btn.textContent="Close";
  var form=document.createElement("div"); form.className="bk-form"; form.id=formId;
  // v359.60.45: Hotel-name input. Pre-fills from opts.hotelName when
  // a suggestion's Book button was clicked; blank for the manual
  // "Add and book a hotel" path. Either way the user can edit before
  // save. Previously this form had no name input — a manual add
  // saved a booking with empty name, and a suggestion-driven add had
  // no way to correct a wrong suggestion name on the spot.
  var r0=document.createElement("div"); r0.className="bk-row";
  var nameInp=document.createElement("input"); nameInp.type="text"; nameInp.className="bk-inp"; nameInp.placeholder="Hotel name"; nameInp.value=opts.hotelName||""; nameInp.style.flex="1";
  r0.appendChild(mkField("Hotel name",nameInp));
  var r1=document.createElement("div"); r1.className="bk-row";
  var ciInp=document.createElement("input"); ciInp.type="date"; ciInp.className="bk-inp"; ciInp.value=opts.checkIn||"";
  var ciTime=document.createElement("input"); ciTime.type="time"; ciTime.className="bk-inp"; ciTime.value=opts.checkInTime||"";
  var coInp=document.createElement("input"); coInp.type="date"; coInp.className="bk-inp"; coInp.value=opts.checkOut||"";
  var coTime=document.createElement("input"); coTime.type="time"; coTime.className="bk-inp"; coTime.value=opts.checkOutTime||"";
  var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="e.g. ABC123";
  r1.appendChild(mkField("Check-in",ciInp)); r1.appendChild(mkField("Time",ciTime)); r1.appendChild(mkField("Check-out",coInp)); r1.appendChild(mkField("Time",coTime)); r1.appendChild(mkField("Conf #",confInp));
  var r2=document.createElement("div"); r2.className="bk-row";
  // Round FN.9: enforce non-negative price via min=0 attribute.
  var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01"; priceInp.min="0";
  var currSel=mkCurrSel(formId+"-cur",opts.currency);
  var notesInp=document.createElement("input"); notesInp.type="text"; notesInp.className="bk-inp"; notesInp.placeholder="Room notes, access code\u2026";
  r2.appendChild(mkField("Total paid",priceInp)); r2.appendChild(mkField("Currency",currSel)); r2.appendChild(mkField("Notes",notesInp));
  // Round DE: booking URL \u2014 paste the confirmation page or the property's
  // booking link. User-editable; persists on the booking object.
  var r3=document.createElement("div"); r3.className="bk-row";
  var urlInp=document.createElement("input"); urlInp.type="url"; urlInp.className="bk-inp"; urlInp.placeholder="https:// \u2014 booking page, confirmation, or hotel site"; urlInp.style.flex="1";
  r3.appendChild(mkField("Reservation URL",urlInp));
  form.appendChild(r0); form.appendChild(r1); form.appendChild(r2); form.appendChild(r3);
  var cancelFieldH=mkCancelField(formId+"-hc"); form.appendChild(cancelFieldH);
  var acts=document.createElement("div"); acts.className="bk-form-actions";
  var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save booking";
  var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
  cx.onclick=function(){
    form.parentNode.removeChild(form);
    btn.classList.remove("active");
    btn.textContent = btn.dataset.originalText || "Book";
  };
  sv.onclick=function(){
    // Round FN.9: validate before persisting.
    //   1. Defend against the dest being removed while form is open.
    //   2. Reject backwards or zero-night dates (would corrupt downstream).
    //   3. Reject negative prices.
    var dest=getDest(opts.destId);
    if (!dest) {
      alert("Can't save — the destination was removed while this form was open. Close this form and try from the destination's Stay tab.");
      return;
    }
    if (ciInp.value && coInp.value && coInp.value <= ciInp.value) {
      alert("Check-out date must be after check-in. Update the dates and try again.");
      return;
    }
    var priceVal = parseFloat(priceInp.value);
    if (!isNaN(priceVal) && priceVal < 0) {
      alert("Price can't be negative. Leave it blank if you don't want to track cost.");
      return;
    }
    var cp=cancelFieldH.getCancelPolicy();
    // v359.60.45: the typed name wins over opts.hotelName so manual
    // adds and edited-suggestion adds both save the right name. If
    // the user left it blank, require it before saving.
    var finalName = (nameInp.value || "").trim() || opts.hotelName || "";
    if (!finalName) {
      alert("Enter a hotel name before saving.");
      try { nameInp.focus(); } catch(_) {}
      return;
    }
    var hotelCoords=/** @type {any} */(null);
    var allDists=getDistricts(dest.place,dest.intent);
    allDists.forEach(function(d){d.hotels.forEach(function(h){if(h.name===finalName&&h.lat){hotelCoords={lat:h.lat,lng:h.lng};}});});
    var bk={id:newBkId(),name:finalName,area:opts.area,checkIn:ciInp.value,checkInTime:ciTime.value||null,checkOut:coInp.value,checkOutTime:coTime.value||null,
      confirmationNumber:confInp.value,pricePaid:isNaN(priceVal)?null:priceVal,currency:currSel.value,
      notes:notesInp.value,url:urlInp.value.trim()||null,status:"booked",source:"manual",
      cancelType:cp.type,cancelDeadline:cp.deadline,cancelDeadlineTime:cp.deadlineTime||null,
      lat:hotelCoords?hotelCoords.lat:null,lng:hotelCoords?hotelCoords.lng:null};
    dest.hotelBookings.push(bk);
    // TM.4 (v328): emit handles autoSave + drawDestMode. The onSaved
    // callback path (used by callers that take over post-save UI)
    // still gets autoSave + custom rendering.
    if(onSaved){autoSave();onSaved();}else{_emitTripMutation();}
  };
  acts.appendChild(sv); acts.appendChild(cx); form.appendChild(acts);
  container.appendChild(form);
  setTimeout(function(){form.scrollIntoView({block:"nearest",behavior:"smooth"});},60);
}

function mkHotelRecord(bk,destId){
  var rec=document.createElement("div"); rec.className="bk-record"+(bk.status==="cancelled"?" cancelled":""); rec.id="bkrec-"+bk.id;
  var main=document.createElement("div"); main.className="bk-rec-main";
  // Round FN: include the hotel name on the main line. Previously the
  // tracker record read "\u2713 Booked \u00b7 Jul 1 \u2013 Jul 4" with no indication
  // of which hotel \u2014 visible on the Stay tab only because the name was
  // rendered in a separate banner above. On the Tracker tab the record
  // sits under a generic "Hotels" subsection, so the name belongs in
  // the record itself.
  main.textContent="\u2713 "+(bk.name||"Booked")+(bk.checkIn?" \u00b7 "+fmtD(bk.checkIn)+(bk.checkInTime?" "+bk.checkInTime:"")+" \u2013 "+fmtD(bk.checkOut)+(bk.checkOutTime?" "+bk.checkOutTime:""):"");
  var parts=[]; if(bk.confirmationNumber)parts.push("Conf: "+bk.confirmationNumber);
  if(bk.pricePaid)parts.push(bk.currency+" "+bk.pricePaid.toFixed(2)+" total"); if(bk.notes)parts.push(bk.notes);
  rec.appendChild(main);
  if(parts.length){var meta=document.createElement("div");meta.className="bk-rec-meta";meta.textContent=parts.join(" \u00b7 ");rec.appendChild(meta);}
  // Round DE: clickable URL row when set
  if(bk.url){
    var urlRow=document.createElement("div"); urlRow.className="bk-rec-meta";
    var urlA=document.createElement("a");
    urlA.href=bk.url; urlA.target="_blank"; urlA.rel="noopener noreferrer";
    urlA.style.cssText="color:var(--c-primary);text-decoration:none;font-weight:500;";
    urlA.textContent="\u2197 Reservation";
    urlRow.appendChild(urlA);
    rec.appendChild(urlRow);
  }
  if(bk.cancelType){var cpLine=document.createElement("div");cpLine.className="bk-rec-meta";cpLine.style.fontWeight="600";if(bk.cancelType==="deadline"){cpLine.style.color="#d97706";cpLine.textContent="Cancel by: "+(bk.cancelDeadline?fmtD(bk.cancelDeadline)+(bk.cancelDeadlineTime?" at "+bk.cancelDeadlineTime:""):"date not set");}else if(bk.cancelType==="non-cancellable"){cpLine.style.color="#e05050";cpLine.textContent="Non-cancellable";}rec.appendChild(cpLine);}
  var a=document.createElement("div"); a.className="bk-rec-acts";
  if(bk.status!=="cancelled"){
    // Edit button
    var eb=document.createElement("button"); eb.className="bk-rec-btn"; eb.textContent="Edit";
    (function(b,r,did){eb.onclick=function(){
      var editId="bk-edit-"+b.id;
      var existing=g(editId);
      if(existing){existing.parentNode.removeChild(existing);eb.textContent="Edit";return;}
      eb.textContent="Close";
      var form=document.createElement("div"); form.id=editId; form.className="bk-form"; form.style.marginTop="6px";
      // v359.60.44: name field was missing from this form — the user
      // could edit every field EXCEPT the hotel name. Lands at the
      // top of the form so a paste-batch-imported booking with a
      // wrong/missing name is the first thing the user fixes.
      var r0=document.createElement("div"); r0.className="bk-row";
      var nameInp=document.createElement("input"); nameInp.type="text"; nameInp.className="bk-inp"; nameInp.placeholder="Hotel name"; nameInp.value=b.name||""; nameInp.style.flex="1";
      r0.appendChild(mkField("Hotel name",nameInp));
      var r1=document.createElement("div"); r1.className="bk-row";
      var ciInp=document.createElement("input"); ciInp.type="date"; ciInp.className="bk-inp"; ciInp.value=b.checkIn||"";
      var ciTime=document.createElement("input"); ciTime.type="time"; ciTime.className="bk-inp"; ciTime.value=b.checkInTime||"";
      var coInp=document.createElement("input"); coInp.type="date"; coInp.className="bk-inp"; coInp.value=b.checkOut||"";
      var coTime=document.createElement("input"); coTime.type="time"; coTime.className="bk-inp"; coTime.value=b.checkOutTime||"";
      var confInp=document.createElement("input"); confInp.type="text"; confInp.className="bk-inp"; confInp.placeholder="Confirmation #"; confInp.value=b.confirmationNumber||"";
      r1.appendChild(mkField("Check-in",ciInp)); r1.appendChild(mkField("Time",ciTime)); r1.appendChild(mkField("Check-out",coInp)); r1.appendChild(mkField("Time",coTime)); r1.appendChild(mkField("Conf #",confInp));
      var r2=document.createElement("div"); r2.className="bk-row";
      var priceInp=document.createElement("input"); priceInp.type="number"; priceInp.className="bk-inp"; priceInp.placeholder="0.00"; priceInp.step="0.01"; priceInp.value=b.pricePaid||"";
      var currSel=mkCurrSel(editId+"-cur",b.currency||"EUR");
      var notesInp=document.createElement("input"); notesInp.type="text"; notesInp.className="bk-inp"; notesInp.placeholder="Notes\u2026"; notesInp.value=b.notes||"";
      r2.appendChild(mkField("Total paid",priceInp)); r2.appendChild(mkField("Currency",currSel)); r2.appendChild(mkField("Notes",notesInp));
      // Round DE: edit URL on the booking
      var r3=document.createElement("div"); r3.className="bk-row";
      var urlInp=document.createElement("input"); urlInp.type="url"; urlInp.className="bk-inp"; urlInp.placeholder="https:// \u2014 booking page or hotel site"; urlInp.value=b.url||""; urlInp.style.flex="1";
      r3.appendChild(mkField("Reservation URL",urlInp));
      form.appendChild(r0); form.appendChild(r1); form.appendChild(r2); form.appendChild(r3);
      // Round FN: cancellation policy was missing from the edit form,
      // so once you booked you couldn't change "cancel by Jul 12" to
      // "cancel by Jul 19" if the hotel updated their policy. Add the
      // same mkCancelField the booking form uses, pre-selected to the
      // current policy so editing doesn't clobber it.
      var cancelFieldEdit=mkCancelField(editId+"-edit-c");
      // Pre-select existing policy
      if(b.cancelType){
        setTimeout(function(){
          var optBtns=cancelFieldEdit.querySelectorAll('.cancel-opt');
          optBtns.forEach(function(btn){
            if((b.cancelType==='deadline'&&btn.classList.contains('deadline'))||
               (b.cancelType==='non-cancellable'&&btn.classList.contains('noncancellable'))){
              btn.click();
            }
          });
          if(b.cancelType==='deadline'&&b.cancelDeadline){
            var dInps=cancelFieldEdit.querySelectorAll('.cancel-date-inp');
            // First .cancel-date-inp is the date, second (if present) is the time
            if(dInps[0])dInps[0].value=b.cancelDeadline;
            if(dInps[1]&&b.cancelDeadlineTime)dInps[1].value=b.cancelDeadlineTime;
          }
        },0);
      }
      form.appendChild(cancelFieldEdit);
      var acts2=document.createElement("div"); acts2.className="bk-form-actions";
      var sv=document.createElement("button"); sv.className="bk-save-btn"; sv.textContent="Save changes";
      var cx=document.createElement("button"); cx.className="bk-dismiss-btn"; cx.textContent="Cancel";
      cx.onclick=function(){form.parentNode.removeChild(form);eb.textContent="Edit";};
      sv.onclick=function(){
        // v359.60.44: persist name edits.
        b.name=nameInp.value.trim()||b.name||"Untitled hotel";
        b.checkIn=ciInp.value; b.checkInTime=ciTime.value||null; b.checkOut=coInp.value; b.checkOutTime=coTime.value||null;
        b.confirmationNumber=confInp.value;
        b.pricePaid=parseFloat(priceInp.value)||null;
        b.currency=currSel.value;
        b.notes=notesInp.value;
        b.url=urlInp.value.trim()||null;
        var cp2=cancelFieldEdit.getCancelPolicy();
        if(cp2.type){ b.cancelType=cp2.type; b.cancelDeadline=cp2.deadline; b.cancelDeadlineTime=cp2.deadlineTime||null; }
        // TM.4 (v328): emit replaces autoSave + drawDestMode.
        _emitTripMutation();
      };
      acts2.appendChild(sv); acts2.appendChild(cx); form.appendChild(acts2);
      r.appendChild(form);
      setTimeout(function(){form.scrollIntoView({block:"nearest",behavior:"smooth"});},60);
    };})(bk,rec,destId);
    a.appendChild(eb);
    var cb=document.createElement("button"); cb.className="bk-rec-btn danger"; cb.textContent="Cancel booking";
    (function(b,r,did){cb.onclick=function(){
      var conf=confirm("Mark this booking as cancelled in Max?\n\nRemember: you must also contact the hotel directly to cancel your reservation.");
      if(!conf)return;
      b.status="cancelled";
      var d=getDest(did);
      addPendingAction({eventType:'hotel',actionType:'Contact provider to adjust or cancel',eventName:b.name,
        destName:d?d.label||d.place:'',confirmationNumber:b.confirmationNumber||null,
        detail:'Contact hotel to cancel reservation'+(b.cancelDeadline?' — cancel by '+fmtD(b.cancelDeadline):''),
        requiresProviderAction:true});
      if(_showAllHotelsDests)_showAllHotelsDests.delete(did);_emitTripMutation();
    };})(bk,rec,destId);
    a.appendChild(cb);
  }
  var db=document.createElement("button"); db.className="bk-rec-btn"; db.textContent="\u2715 Delete";
  // Round FN.8.20: undo toast on hotel-record delete. Snapshots
  // dest.hotelBookings + trip.pendingActions before mutation; on
  // undo, restore both and redraw the destination.
  (function(b,r){db.onclick=function(){
    var dRef = getDest(destId);
    if (!dRef) return;
    var snapHotelBookings = (dRef.hotelBookings || []).slice();
    var snapPending = (trip.pendingActions || []).slice();
    var labelStr = b.name || "Hotel booking";
    if(b.status!=="cancelled"){
      addPendingAction({eventType:"hotel",actionType:"Contact provider to adjust or cancel",
        eventName:b.name,destName:dRef?dRef.label||dRef.place:"",
        confirmationNumber:b.confirmationNumber||null,
        detail:"Contact hotel to cancel reservation",requiresProviderAction:true});
    }
    dRef.hotelBookings = (dRef.hotelBookings || []).filter(function(x){return x.id!==b.id;});
    if(r.parentNode) r.parentNode.removeChild(r);
    if (typeof autoSave === "function") autoSave();
    if (typeof _showDayTripToast === "function") {
      _showDayTripToast("Deleted hotel booking <strong>" + labelStr + "</strong>", function(){
        var d3 = getDest(destId);
        if (!d3) return;
        d3.hotelBookings = snapHotelBookings.slice();
        trip.pendingActions = snapPending.slice();
        if (typeof autoSave === "function") autoSave();
        if (typeof drawDestMode === "function") drawDestMode(destId);
      });
    }
  };})(bk,rec);
  a.appendChild(db); rec.appendChild(a); return rec;
}

export {};
