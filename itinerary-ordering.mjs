// @ts-check
// itinerary-ordering.js — Itinerary ordering. Extracted verbatim from index.html (PD.473, bloat reduction).

// ── ITINERARY ORDERING ─────────────────────────────────────
// Orders kept candidates so that route endpoints are adjacent and flow
// matches the overall trip entry→exit direction. Bunches condition-viable
// locations together. Returns {ordered, reasoning} where reasoning is a
// plain-English list of decisions for later display.
// orderKeptCandidates moved to engine-picker.js (Round HI.2 / Phase 3).

// For each destination, find which must-do events happen there
function findAttachedEvents(cand, mdcItems){
  if (!cand || !mdcItems || !mdcItems.length) return [];
  var cN = _normPlaceName(cand.place);
  var events = [];
  mdcItems.forEach(function(m){
    if (!m.checked) return;
    var places = m.requiredPlaces || m.endpoints || m.viableLocations || [];
    var matches = places.some(function(p){
      // Round DX: rejected places (kept in the record so the picker
      // can show them on re-edit) shouldn't pull an activity onto a
      // candidate. Only kept places drive attachment.
      if (p && p._keep === false) return false;
      var pN = _normPlaceName(p.place);
      return pN === cN || pN.indexOf(cN) >= 0 || cN.indexOf(pN) >= 0;
    });
    if (matches) {
      events.push({
        id: m.id,
        name: m.name,
        type: m.type,
        description: m.description,
        recovery: m.recovery,
        modeOptions: m.modeOptions,
        chosenMode: m.chosenMode,
        direction: m.direction,
        durationHours: m.durationHours
      });
    }
  });
  return events;
}

// parseStartDateFromBrief moved to engine-picker.js (Round HH / Phase 3).

// Detect the user's pace intent from the freeform pace text on the trip brief.
// Accepts the first word / first clause and returns a structured mode we can
// pass to generation prompts and to the toast logic. Null if unrecognized —
// prompts fall back to their default heuristics.
function _getPaceMode(paceText){
  if (!paceText) return null;
  var t = String(paceText).toLowerCase().trim();
  // Match at the start, allowing common delimiters
  var head = t.split(/[\s\u2014\-,.:;]/)[0];
  if (head === "loose") return "loose";
  if (head === "enough") return "enough";
  // "not much" — special case because head would be just "not"
  if (t.indexOf("not much") === 0 || t.indexOf("notmuch") === 0) return "notmuch";
  return null;
}

// v353.3: defaults for the picker brief's per-trip pace fields.
// Pre-fill from the user's saved welcome-modal prefs (paceHours,
// sightsPerDay). Falls back to the historical hardcoded defaults
// (6 hrs/day, 2 big sights/day) if no pref is set or invalid.
// The picker brief lets the user override per-trip — these are
// just the seeds.
function _defaultHoursPerDay(){
  try {
    var pref = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("paceHours"), 10) : NaN;
    if (isFinite(pref) && pref >= 2 && pref <= 10) return pref;
  } catch (_) {}
  return 6;
}
function _defaultMaxBigSightsPerDay(){
  // v353.4: direct mapping. Welcome's "sights per day" pref IS the
  // max big sights cap. Earlier ceil(sp/2) derivation was confusing
  // — changing the pref by 1 often looked like "nothing changed"
  // because adjacent values rounded to the same number. Constrained
  // to [1,6] to match the picker brief's input range.
  try {
    var sp = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("sightsPerDay"), 10) : NaN;
    if (isFinite(sp) && sp >= 1 && sp <= 6) return sp;
    if (isFinite(sp) && sp > 6) return 6;
  } catch (_) {}
  return 2;
}

// v359.6: two new defaults added to the Settings panel. Pace mode
// ("loose"/"enough"/"notmuch" — labeled Relaxed/Balanced/Intense in
// UI) and day-trip drive-time threshold (hours). Both fall through
// to historical hardcoded defaults so older trips keep working when
// the prefs are absent.
function _defaultPaceMode(){
  try {
    var m = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("paceMode") : null;
    if (m === "loose" || m === "enough" || m === "notmuch") return m;
  } catch(_){}
  return "enough";
}
function _defaultDayTripHours(){
  try {
    var h = (window.MaxDB && MaxDB.prefs) ? parseFloat(MaxDB.prefs.get("dayTripHours")) : NaN;
    if (isFinite(h) && h > 0 && h <= 6) return h;
  } catch(_){}
  return 3;
}
// v359.51.14: day-trip radius now Settings-backed. Was hardcoded to
// 60 km in five places (engine-picker.js, picker-ui.js, this file's
// predictor + eligibility + role popover). All callers route through
// this function so a single Settings change moves everything in
// lockstep. Clamped to a sane range (10–250 km).
function _defaultDayTripRadiusKm(){
  try {
    var r = (window.MaxDB && MaxDB.prefs) ? parseFloat(MaxDB.prefs.get("dayTripRadiusKm")) : NaN;
    if (isFinite(r) && r >= 10 && r <= 250) return r;
  } catch(_){}
  return 60;
}

// v359.9: four more Settings-backed defaults (Bucket C completion).
// Travelers count + with-kids are C1 (frequently varies — show on brief);
// transport preference + accommodation preference are C2 (rarely varies —
// today still on the brief, will collapse behind an expander in v5).
function _defaultTravelersCount(){
  try {
    var n = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("travelersCount"), 10) : NaN;
    if (isFinite(n) && n >= 1 && n <= 40) return n;
  } catch(_){}
  return 2;
}
function _defaultWithKids(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("withKids") : null;
    if (v === true || v === "true" || v === 1 || v === "1") return true;
    if (v === false || v === "false" || v === 0 || v === "0") return false;
  } catch(_){}
  return false;
}
function _defaultTransport(){
  try {
    var s = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("transport") : null;
    if (typeof s === "string" && s.length) return s;
  } catch(_){}
  return "";
}
function _defaultAccommodation(){
  try {
    var s = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("accommodation") : null;
    if (typeof s === "string" && s.length) return s;
  } catch(_){}
  return "";
}
// v360.4 (#124 follow-up): hard limits is now a global default too,
// captured during the welcome onboarding. Trip profile editor's
// hardlimits textarea pre-fills from this; per-trip overrides
// continue to write to _tb.hardlimits and override the global.
function _defaultHardLimits(){
  try {
    var s = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("hardLimits") : null;
    if (typeof s === "string" && s.length) return s;
  } catch(_){}
  return "";
}

// v359.11 (v5 — progressive disclosure). Returning users see a
// collapsed summary of their defaults instead of every C-bucket
// field. Flag is set on first brief submission. To override for
// a specific trip, click "Change them just for this trip."
// v359.12.2: ONLY the briefSeenOnce flag now signals "returning."
// Earlier versions also counted "any saved pref" and "any trip in
// the index" but both produced wrong-feeling behavior:
//   - Welcome onboarding sets paceHours + sightsPerDay immediately
//     on first sign-in. With sawPref counting as "returning," a
//     brand-new user would land on the collapsed brief on their
//     very first trip, before they'd ever even seen the full
//     layout. The full brief is part of how users learn the
//     system; the collapsed view earns its place by showing on
//     the SECOND and subsequent trips, not the first.
//   - Trips persist across Reset preferences, so leaving the trip
//     fallback in defeated the whole "test as a new user" flow.
// briefSeenOnce is set ONLY when the user submits a brief (any
// brief — first or refresh). That's the right trigger.
// v359.13: per-field "Override for this trip" toggle. When a global
// default exists, the brief renders the field as locked (display
// value + override link). Click the link → flip a flag on _tb →
// re-render → field becomes editable. Same flag is checked at
// goToTripStep2 submission time: locked fields fall through to the
// default; unlocked fields use the typed value.
function _tbUnlockShape(overrideKey){
  if (!_tb._overrides) _tb._overrides = {};
  _tb._overrides[overrideKey] = true;
  _tb._preserveScrollOnce = true;
  // v360.4: dispatch to whichever editor is active. _tb._editMode is
  // true when the user is in renderTripBriefEdit (Profile… menu from
  // an existing trip); false for the new-trip flow.
  if (_tb._editMode && typeof renderTripBriefEdit === "function") {
    renderTripBriefEdit();
  } else {
    renderTripStep1Place();
  }
}
window._tbUnlockShape = _tbUnlockShape;

// v360.4: locked-when-default helpers, hoisted from inside
// renderTripStep1Place so renderTripBriefEdit can use them too.
// A field is "locked" when a global default is saved for it AND
// the user hasn't explicitly clicked Override. Locked → render
// summary + Override link. Unlocked → render the editable input.
function _briefIsLocked(prefKey, overrideKey){
  if (!window.MaxDB || !MaxDB.prefs) return false;
  var pref = MaxDB.prefs.get(prefKey);
  if (pref == null || pref === "") return false;
  return !(_tb._overrides && _tb._overrides[overrideKey]);
}
function _briefRenderLocked(label, displayValue, overrideKey){
  return '<div class="tb-field" style="margin-bottom:14px;">'
    + '<label style="font-weight:500;color:#222;margin:0 0 4px;font-size:12.5px;text-transform:none;letter-spacing:0;display:block;">' + label + '</label>'
    + '<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;">'
    +   '<span style="font-size:13px;font-weight:600;color:#222;">' + displayValue + '</span>'
    +   '<a href="#" onclick="_tbUnlockShape(\'' + overrideKey + '\');event.preventDefault();" style="font-size:11.5px;font-weight:600;color:var(--c-primary);text-decoration:none;cursor:pointer;white-space:nowrap;">Override for this trip ↻</a>'
    + '</div>'
    + '</div>';
}
function _briefTrunc(s, n){
  s = String(s||"").trim();
  return s.length > n ? s.substring(0, n-1) + "…" : s;
}
window._briefIsLocked = _briefIsLocked;
window._briefRenderLocked = _briefRenderLocked;
window._briefTrunc = _briefTrunc;

// v360.4: _tbApplyToDefault and _tbApplyToDefaultLinkHtml removed —
// both were transitional helpers used by renderTripBriefEdit when it
// had its own inline "↑ Apply to defaults" links. Now both editors
// share _tbSetupShapeBadges (via setupTextField / setupNumberField /
// setupRadioField / setupCompoundTravelers / setupMobilityChips),
// which handles the badge + promote link UX with dynamic state. No
// remaining callers to either helper.

// v359.12.4: inline display-prefs handler. Wired onto the radios at
// the bottom of the brief. Writes the chosen value to MaxDB.prefs
// immediately so it applies to this trip and persists globally.
// Validates the key/value pair so radio markup mistakes can't poison
// the prefs blob.
function _tbSetDisplayPref(name, value){
  if (!window.MaxDB || !MaxDB.prefs) return;
  var keyMap = { "tb-dist-units": "distanceUnits", "tb-temp-units": "temperatureUnits", "tb-date-fmt": "dateFormat" };
  var validMap = {
    "tb-dist-units": ["metric", "imperial"],
    "tb-temp-units": ["celsius", "fahrenheit"],
    "tb-date-fmt": ["iso", "us", "locale"]
  };
  var prefKey = keyMap[name];
  var valid = validMap[name];
  if (!prefKey || !valid || valid.indexOf(value) < 0) return;
  try { MaxDB.prefs.set(prefKey, value); } catch(_){}
}
window._tbSetDisplayPref = _tbSetDisplayPref;

function _isReturningUser(){
  var DBG = "[Max returning-user]";
  var sawFlag = false;
  try {
    sawFlag = !!(window.MaxDB && MaxDB.prefs && MaxDB.prefs.get("briefSeenOnce"));
  } catch(_){}
  console.log(DBG, "sawFlag:", sawFlag);
  return sawFlag;
}

// v359.10 (Bucket A): personal + display preferences. These are
// "rarely change, ask once" settings — mobility, dietary, languages,
// and four display preferences (distance units, temperature, date
// format, currency). Today they live only in Settings; the brief
// reads mobility's default. Display preferences will get wired into
// the rest of the UI in follow-up commits — for now they collect
// the user's intent.
function _defaultMobility(){
  try {
    var m = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("mobility") : null;
    var valid = ["fit","moderate","limited","elderly","mobility","other"];
    if (typeof m === "string" && valid.indexOf(m) >= 0) return m;
  } catch(_){}
  return "";
}
function _defaultDietary(){
  try {
    var d = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("dietary") : null;
    if (typeof d === "string" && d.length) return d;
  } catch(_){}
  return "";
}
function _defaultLanguages(){
  try {
    var l = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("languages") : null;
    if (typeof l === "string" && l.length) return l;
  } catch(_){}
  return "";
}
// v360.4: defaults for the remaining Personal-profile fields so
// welcome + trip editors can pre-fill from Settings-saved values.
function _defaultAllergies(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("allergies") : null;
    if (typeof v === "string" && v.length) return v;
  } catch(_){}
  return "";
}
function _defaultEmergencyName(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("emergencyContactName") : null;
    if (typeof v === "string" && v.length) return v;
  } catch(_){}
  return "";
}
function _defaultEmergencyPhone(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("emergencyContactPhone") : null;
    if (typeof v === "string" && v.length) return v;
  } catch(_){}
  return "";
}
function _defaultLoyaltyPrograms(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("loyaltyPrograms") : null;
    if (typeof v === "string" && v.length) return v;
  } catch(_){}
  return "";
}
function _defaultDistanceUnits(){
  try {
    var u = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("distanceUnits") : null;
    if (u === "imperial") return "imperial";
  } catch(_){}
  return "metric";
}
function _defaultTemperatureUnits(){
  try {
    var u = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("temperatureUnits") : null;
    if (u === "fahrenheit") return "fahrenheit";
  } catch(_){}
  return "celsius";
}
function _defaultDateFormat(){
  // v359.60.30: new long formats with weekday + year (the user-stated
  // contract). Old short "us" (Sat, May 12 — no year) is soft-migrated
  // to "us-long" so existing trips don't need a manual pref update.
  //   "us-long"   → Mon, Aug 5, 2026  (default — weekday, month, day, year)
  //   "intl-long" → Mon, 5 Aug 2026   (weekday, day, month, year)
  //   "iso"       → 2026-08-05        (raw ISO)
  //   "locale"    → browser-locale toLocaleDateString
  try {
    var f = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("dateFormat") : null;
    if (f === "us") return "us-long";       // back-compat
    if (f === "us-long" || f === "intl-long" || f === "iso" || f === "locale") return f;
  } catch(_){}
  return "us-long";
}
function _defaultCurrency(){
  try {
    var c = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("currency") : null;
    if (typeof c === "string" && c.length) return c;
  } catch(_){}
  return "";
}

// v359.15: avoidances default. The user's soft avoidances live in
// _tb.avoid (object of {avoidanceId: bool}) plus _tb.avoidOther (text).
// Saved globally as avoidDefaults / avoidOtherDefaults so every new
// trip pre-fills from them. Per-trip override (the brief's locked
// row + "Override for this trip" link) lets the user diverge.
function _defaultAvoid(){
  try {
    var v = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("avoidDefaults") : null;
    if (v && typeof v === "object") return v;
  } catch(_){}
  return {};
}
function _defaultAvoidOther(){
  try {
    var s = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs.get("avoidOtherDefaults") : null;
    if (typeof s === "string" && s.length) return s;
  } catch(_){}
  return "";
}
// Whether ANY avoidance default is configured — used by the brief to
// decide whether to render the row locked-with-override.
function _hasAvoidDefaults(){
  var v = _defaultAvoid();
  if (v && typeof v === "object") {
    for (var k in v) if (v[k]) return true;
  }
  return !!_defaultAvoidOther();
}

// v359.6: Settings panel — user-level "My preferences" editor. Opens from
// the ⚙ button in any of three headers (home, picker, trip-view).
// Writes to MaxDB.prefs so changes sync across devices via the
// existing prefs bridge. Four fields in v1:
//   - paceHours:    hours of sightseeing on a full day (2-10)
//   - sightsPerDay: max big (2+ hr) sights per day (1-6)
//   - paceMode:     loose / enough / notmuch
//   - dayTripHours: max drive time for a day trip (1-5 hours)
// Per-trip override UI lands in a later commit (Shape B + badges
// + apply-to-defaults links). For now this panel just edits the
// globals — any existing per-trip override still wins.
function showSettingsPanel(){
  var existing = document.getElementById("settings-panel-overlay");
  if (existing) existing.remove();

  // Read current values.
  var curHours = 6, curSights = 2, curPace = "enough", curDtHours = 3, curDtRadius = 60;
  // v360.4: transport removed — per-trip field, not a profile default.
  var curTravelers = 2, curWithKids = false, curAccom = "";
  var curMobility = "", curDietary = "", curLanguages = "";
  // v359.60.75: personal profile extensions.
  var curAllergies = "", curEmergencyName = "", curEmergencyPhone = "", curLoyalty = "";
  var curDistUnits = "metric", curTempUnits = "celsius", curDateFmt = "us-long", curCurrency = "";
  // v359.15: avoidance defaults.
  var curAvoidDefaults = {}, curAvoidOtherDefaults = "";
  // v360.4: hard limits global default — captured in welcome onboarding,
  // pre-filled on the trip editors. Read + editable here too.
  var curHardLimits = "";
  try {
    if (window.MaxDB && MaxDB.prefs) {
      var ph = parseInt(MaxDB.prefs.get("paceHours"), 10);
      if (isFinite(ph) && ph >= 2 && ph <= 10) curHours = ph;
      var sp = parseInt(MaxDB.prefs.get("sightsPerDay"), 10);
      if (isFinite(sp) && sp >= 1 && sp <= 6) curSights = sp;
      var pm = MaxDB.prefs.get("paceMode");
      if (pm === "loose" || pm === "enough" || pm === "notmuch") curPace = pm;
      var dh = parseFloat(MaxDB.prefs.get("dayTripHours"));
      if (isFinite(dh) && dh > 0 && dh <= 6) curDtHours = dh;
      // v359.51.14: day-trip radius preference.
      var drk = parseFloat(MaxDB.prefs.get("dayTripRadiusKm"));
      if (isFinite(drk) && drk >= 10 && drk <= 250) curDtRadius = drk;
      // v359.9: four more settings-backed defaults.
      var tc = parseInt(MaxDB.prefs.get("travelersCount"), 10);
      if (isFinite(tc) && tc >= 1 && tc <= 40) curTravelers = tc;
      var wk = MaxDB.prefs.get("withKids");
      curWithKids = (wk === true || wk === "true" || wk === 1 || wk === "1");
      // v360.4: transport pref no longer read here — per-trip field.
      var ac = MaxDB.prefs.get("accommodation");
      if (typeof ac === "string") curAccom = ac;
      // v359.10: Bucket A (personal + display) preferences.
      var mob = MaxDB.prefs.get("mobility");
      if (typeof mob === "string" && ["fit","moderate","limited","elderly","mobility","other"].indexOf(mob) >= 0) curMobility = mob;
      var di = MaxDB.prefs.get("dietary");
      if (typeof di === "string") curDietary = di;
      var lg = MaxDB.prefs.get("languages");
      if (typeof lg === "string") curLanguages = lg;
      // v359.60.75: read new personal profile fields.
      var al = MaxDB.prefs.get("allergies");
      if (typeof al === "string") curAllergies = al;
      var ecn = MaxDB.prefs.get("emergencyContactName");
      if (typeof ecn === "string") curEmergencyName = ecn;
      var ecp = MaxDB.prefs.get("emergencyContactPhone");
      if (typeof ecp === "string") curEmergencyPhone = ecp;
      var loy = MaxDB.prefs.get("loyaltyPrograms");
      if (typeof loy === "string") curLoyalty = loy;
      var du = MaxDB.prefs.get("distanceUnits");
      if (du === "imperial") curDistUnits = "imperial";
      var tu = MaxDB.prefs.get("temperatureUnits");
      if (tu === "fahrenheit") curTempUnits = "fahrenheit";
      var df = MaxDB.prefs.get("dateFormat");
      // v359.60.30: accept the new long formats AND back-compat alias "us" → "us-long".
      if (df === "us") curDateFmt = "us-long";
      else if (df === "us-long" || df === "intl-long" || df === "iso" || df === "locale") curDateFmt = df;
      var cu = MaxDB.prefs.get("currency");
      if (typeof cu === "string") curCurrency = cu;
      // v359.15: avoid defaults.
      var av = MaxDB.prefs.get("avoidDefaults");
      if (av && typeof av === "object") curAvoidDefaults = av;
      var avO = MaxDB.prefs.get("avoidOtherDefaults");
      if (typeof avO === "string") curAvoidOtherDefaults = avO;
      // v360.4: hard limits global default.
      var hL = MaxDB.prefs.get("hardLimits");
      if (typeof hL === "string") curHardLimits = hL;
    }
  } catch(_){}

  var ov = document.createElement("div");
  ov.id = "settings-panel-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:11900;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;";
  var box = document.createElement("div");
  box.style.cssText = "background:var(--c-bg);border-radius:12px;width:520px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:0;box-shadow:0 12px 40px rgba(0,0,0,.25);";

  function _paceRadio(value, label, desc){
    var checked = (curPace === value) ? "checked" : "";
    return ''
      + '<label style="display:flex;align-items:flex-start;gap:10px;padding:9px 11px;border:1px solid #ddd;border-radius:7px;cursor:pointer;margin-bottom:6px;background:'+(curPace===value?"#eef5ff":"#fff")+';transition:background 0.15s;">'
      +   '<input type="radio" name="sp-pace" value="'+value+'" '+checked+' style="margin-top:2px;flex-shrink:0;" />'
      +   '<div>'
      +     '<div style="font-size:12.5px;font-weight:600;color:#222;">'+label+'</div>'
      +     '<div style="font-size:11px;color:#666;margin-top:2px;line-height:1.45;">'+desc+'</div>'
      +   '</div>'
      + '</label>';
  }

  box.innerHTML = ''
    // Header
    + '<div style="padding:18px 22px 14px;border-bottom:1px solid var(--c-border-3);display:flex;align-items:center;gap:10px;">'
    +   '<div style="width:30px;height:30px;border-radius:50%;background:var(--c-primary);color:var(--c-on-dark);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">&#9881;</div>'
    +   '<div style="flex:1;">'
    +     '<div style="font-size:15px;font-weight:700;color:#222;">Profile</div>'
    +     '<div style="font-size:11.5px;color:var(--c-ink-3);margin-top:1px;">How you generally travel. Max carries these into every trip; tune them for a specific trip from that trip\'s page.</div>'
    +   '</div>'
    +   '<button id="sp-close-x" type="button" style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;font-size:13px;color:#666;padding:5px 9px;cursor:pointer;font-family:inherit;" title="Close">&times;</button>'
    + '</div>'
    // Body
    + '<div style="padding:18px 22px;font-size:12.5px;color:#333;line-height:1.55;">'

    // v360.4: section order aligned with welcome / trip editors —
    // Mobility first (most-impactful constraint Max needs to know),
    // then Where you stay, then Pace, then Day trips, then Hard
    // limits, then Avoidances, then Travelers, then Personal
    // (dietary / languages / allergies / emergency / loyalty),
    // then Display.

    // ── MOBILITY ──────────────────────────────────
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Mobility</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Mobility of the slowest member</label>'
    +     (function(){
        var opts = [
          {id:"fit",label:"Fit and active"},
          {id:"moderate",label:"Moderate"},
          {id:"limited",label:"Limited walking"},
          {id:"elderly",label:"Elderly"},
          {id:"mobility",label:"Mobility aid"},
          {id:"other",label:"Other"}
        ];
        return '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + opts.map(function(o){
          return '<span class="tb-toggle' + (curMobility===o.id?' on':'') + '" data-sp-mob="' + o.id + '" style="cursor:pointer;">' + o.label + '</span>';
        }).join("") + '</div>';
      })()
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Of the slowest traveler in your usual party. Override per trip if it changes.</div>'
    +   '</div>'

    // ── WHERE YOU STAY ────────────────────────────
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Where you stay</div>'
    +   '<div style="margin-bottom:6px;">'
    +     '<label for="sp-accom" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Where you’d like to stay</label>'
    +     '<textarea id="sp-accom" rows="2" placeholder="e.g. Small family hotels, en suite required, no hostels" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;resize:vertical;min-height:54px;">'+curAccom.replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Your usual lodging style. Carried into every trip.</div>'
    +   '</div>'

    // ── PACE & DURATION ───────────────────────────
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Pace &amp; duration</div>'

    +   '<div style="margin-bottom:14px;">'
    +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">'
    +       '<label for="sp-hpd" style="font-weight:600;color:#222;flex:1;">Hours of sightseeing per day</label>'
    +       '<input id="sp-hpd" type="number" min="2" max="10" step="1" value="'+curHours+'" inputmode="numeric" style="width:64px;text-align:center;font-size:13px;font-weight:600;padding:5px 7px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;" />'
    +     '</div>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;">How many hours you actually spend on sights — not what you &ldquo;should.&rdquo; Range 2&ndash;10.</div>'
    +   '</div>'

    +   '<div style="margin-bottom:14px;">'
    +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">'
    +       '<label for="sp-spd" style="font-weight:600;color:#222;flex:1;">Max big sights per day</label>'
    +       '<input id="sp-spd" type="number" min="1" max="6" step="1" value="'+curSights+'" inputmode="numeric" style="width:64px;text-align:center;font-size:13px;font-weight:600;padding:5px 7px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;" />'
    +     '</div>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;">A &ldquo;big&rdquo; sight is a 2+ hour anchor &mdash; major museum, mountain railway, long hike. The cap keeps days from becoming a forced march.</div>'
    +   '</div>'

    +   '<div style="margin-bottom:16px;">'
    +     '<div style="font-weight:600;color:#222;margin-bottom:6px;">Default pace</div>'
    +     _paceRadio("loose",   "Relaxed", "Longer stays, fewer sights, open evenings. Optimize for sitting in cafes and unscheduled discovery.")
    +     _paceRadio("enough",  "Balanced", "Moderate stays, 6&ndash;8 sights per destination, deliberate gaps for unexpected opportunities.")
    +     _paceRadio("notmuch", "Intense", "Shorter stays, more sights, full evenings. Pack the days.")
    +   '</div>'

    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Day trips</div>'

    +   '<div style="margin-bottom:14px;">'
    +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">'
    +       '<label for="sp-dth" style="font-weight:600;color:#222;flex:1;">Max drive time for a day trip</label>'
    +       '<div style="display:flex;align-items:center;gap:5px;">'
    +         '<input id="sp-dth" type="number" min="1" max="6" step="0.5" value="'+curDtHours+'" inputmode="decimal" style="width:64px;text-align:center;font-size:13px;font-weight:600;padding:5px 7px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;" />'
    +         '<span style="font-size:12px;color:#666;">hours</span>'
    +       '</div>'
    +     '</div>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;">Anything within this drive time from a hub can be a day trip instead of its own overnight stop. Total round-trip; one hour each way is fine, two hours each way is the upper end.</div>'
    +   '</div>'

    // v359.51.14: day-trip radius. Drives the picker's predictor,
    // hub-eligibility check, role popover, AND the engine-picker
    // clustering writer. Set in one place; flows everywhere.
    // v359.51.15: input unit follows the user's distanceUnits pref
    // (km vs miles). Internal storage stays km (canonical) — the
    // input is converted to km on save, and the displayed value is
    // converted from km on load.
    +   (function(){
        var imp = (typeof _defaultDistanceUnits === "function" && _defaultDistanceUnits() === "imperial");
        // Convert km → display unit for the field's initial value,
        // and pick range/step that feels natural in that unit.
        var displayVal, minDisp, maxDisp, stepDisp, unitLbl, defaultLbl;
        if (imp) {
          displayVal = Math.round(curDtRadius * 0.621371);
          minDisp = 6; maxDisp = 155; stepDisp = 5;
          unitLbl = "miles";
          defaultLbl = "~37 miles (60 km)";
        } else {
          displayVal = curDtRadius;
          minDisp = 10; maxDisp = 250; stepDisp = 5;
          unitLbl = "km";
          defaultLbl = "60 km";
        }
        return '<div style="margin-bottom:6px;">'
          +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">'
          +       '<label for="sp-dt-radius" style="font-weight:600;color:#222;flex:1;">Day-trip radius from a hub</label>'
          +       '<div style="display:flex;align-items:center;gap:5px;">'
          +         '<input id="sp-dt-radius" type="number" min="'+minDisp+'" max="'+maxDisp+'" step="'+stepDisp+'" value="'+displayVal+'" inputmode="numeric" data-unit="'+(imp?"imperial":"metric")+'" style="width:64px;text-align:center;font-size:13px;font-weight:600;padding:5px 7px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;" />'
          +         '<span style="font-size:12px;color:#666;">'+unitLbl+'</span>'
          +       '</div>'
          +     '</div>'
          +     '<div style="font-size:11px;color:#777;line-height:1.5;">Straight-line distance from a hub a place must be within to qualify as a day trip. Default is '+defaultLbl+' (urban / Europe-style trips). Bump it up for long-range road trips, down for dense city clusters.</div>'
          +   '</div>';
      })()

    // v360.4: HARD LIMITS — moved above Avoidances to match welcome
    // and trip-editor order (hard first, then soft). Captured in
    // welcome onboarding; pre-fills the trip-editor hardlimits
    // textarea via _defaultHardLimits().
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Hard limits</div>'
    +   '<div style="margin-bottom:6px;">'
    +     '<label for="sp-hardlimits" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Things Max won’t route around</label>'
    +     '<textarea id="sp-hardlimits" rows="2" placeholder="e.g. No car rentals. Vegetarian. Wheelchair access required." style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;resize:vertical;min-height:54px;">'+curHardLimits.replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Optional but consequential. Things Max won’t route around.</div>'
    +   '</div>'

    // v359.15: AVOIDANCES — soft preferences that apply to every trip
    // unless overridden on the brief.
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Anything you’d like to avoid?</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Soft avoidances</label>'
    +     (function(){
        var opts = [
          {id:"altitude",   label:"High altitude"},
          {id:"crowds",     label:"Crowds / tourist density"},
          {id:"heat",       label:"Extreme heat"},
          {id:"cold",       label:"Extreme cold"},
          {id:"longDrives", label:"Long drives"}
        ];
        return '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + opts.map(function(o){
          return '<span class="tb-chip' + (curAvoidDefaults[o.id]?' on':'') + '" data-sp-avoid="' + o.id + '" style="cursor:pointer;">' + o.label + '</span>';
        }).join("") + '</div>';
      })()
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:6px;">Things you’d like Max to weigh against any suggestion. Soft — not hard limits.</div>'
    +   '</div>'
    +   '<div style="margin-bottom:6px;">'
    +     '<label for="sp-avoid-other" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Anything else to avoid</label>'
    +     '<textarea id="sp-avoid-other" rows="2" placeholder="e.g. group tours, chain restaurants, cruise-ship ports" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;resize:vertical;min-height:54px;">'+curAvoidOtherDefaults.replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Free-form preferences that aren’t in the chip list above.</div>'
    +   '</div>'

    // v360.4: Hard limits moved up above Avoidances. Its original
    // position here is empty.

    // v359.9: travelers section.
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Travelers</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">'
    +       '<label for="sp-travelers" style="font-weight:600;color:#222;flex:1;">How many travelers?</label>'
    +       '<input id="sp-travelers" type="number" min="1" max="40" value="'+curTravelers+'" inputmode="numeric" style="width:64px;text-align:center;font-size:13px;font-weight:600;padding:5px 7px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;" />'
    +     '</div>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;">Your usual party size. Most people travel solo, as a couple, or as a family — pick whichever you do most. You can change it for any specific trip.</div>'
    +   '</div>'
    +   '<div style="margin-bottom:6px;">'
    +     '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;color:#222;">'
    +       '<input id="sp-with-kids" type="checkbox" '+(curWithKids?"checked":"")+' style="margin:0;width:auto;" />'
    +       '<span>Default to traveling with kids</span>'
    +     '</label>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;margin-left:24px;">Pre-checks the "with kids" box on every brief. Adjust per trip when needed.</div>'
    +   '</div>'

    // v360.4: Where you stay moved up to right after Mobility (see
    // top of Settings panel body). Its original position here is
    // now empty; section blocks below renumber accordingly.

    // v360.4: PERSONAL — dietary, languages, allergies, emergency
    // contact, loyalty. Mobility was extracted from this section
    // and promoted to the top of the Settings panel (matches
    // welcome / trip-editor order).
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:10px;">Personal &amp; medical</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<label for="sp-dietary" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Dietary restrictions</label>'
    +     '<input id="sp-dietary" type="text" value="'+curDietary.replace(/"/g,"&quot;")+'" placeholder="e.g. vegetarian; tree-nut allergy" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Affects restaurant suggestions.</div>'
    +   '</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<label for="sp-languages" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Languages you speak</label>'
    +     '<input id="sp-languages" type="text" value="'+curLanguages.replace(/"/g,"&quot;")+'" placeholder="e.g. English, conversational French" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Helps Max gauge how off-the-beaten-path is realistic.</div>'
    +   '</div>'

    // v359.60.75: personal profile extensions — allergies, emergency
    // contact, loyalty programs. All optional; persist as user-level
    // prefs (MaxDB.prefs) so they apply across every trip.
    +   '<div style="margin-bottom:14px;">'
    +     '<label for="sp-allergies" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Allergies / medical</label>'
    +     '<input id="sp-allergies" type="text" value="'+curAllergies.replace(/"/g,"&quot;")+'" placeholder="e.g. peanut, shellfish, penicillin" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Severe enough to matter at a restaurant or hospital. Separate from general dietary preference above.</div>'
    +   '</div>'
    +   '<div style="margin-bottom:14px;">'
    +     '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Emergency contact</label>'
    +     '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    +       '<input id="sp-emergency-name" type="text" value="'+curEmergencyName.replace(/"/g,"&quot;")+'" placeholder="Name" style="font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +       '<input id="sp-emergency-phone" type="tel" value="'+curEmergencyPhone.replace(/"/g,"&quot;")+'" placeholder="Phone (with country code)" style="font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +     '</div>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Someone back home to reach in an emergency. Include the country code so it dials from anywhere.</div>'
    +   '</div>'
    +   '<div style="margin-bottom:6px;">'
    +     '<label for="sp-loyalty" style="font-weight:600;color:#222;display:block;margin-bottom:4px;">Loyalty programs</label>'
    +     '<textarea id="sp-loyalty" rows="3" placeholder="e.g. United MileagePlus 12345678\nHilton Honors 87654321\nHertz Gold 5555555" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;resize:vertical;min-height:64px;">'+curLoyalty.replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +     '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Frequent flyer numbers, hotel loyalty IDs, rental car accounts. One per line. Useful when re-booking.</div>'
    +   '</div>'

    // v359.10: DISPLAY — units, temperature, date format, currency.
    +   '<div style="margin:18px 0 10px;border-top:1px dashed #d8d4c8;"></div>'
    +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--c-ink-3);margin-bottom:4px;">Display</div>'
    +   '<div style="font-size:11px;color:var(--c-ink-4);font-style:italic;margin-bottom:10px;line-height:1.5;">Collected here now; the rest of the UI will pick them up in a follow-up pass.</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">'
    +     '<div>'
    +       '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Distance units</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-dist" value="metric" '+(curDistUnits==="metric"?"checked":"")+' style="margin:0;width:auto;" /> Metric (km)</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-dist" value="imperial" '+(curDistUnits==="imperial"?"checked":"")+' style="margin:0;width:auto;" /> Imperial (mi)</label>'
    +     '</div>'
    +     '<div>'
    +       '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Temperature</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-temp" value="celsius" '+(curTempUnits==="celsius"?"checked":"")+' style="margin:0;width:auto;" /> Celsius (°C)</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-temp" value="fahrenheit" '+(curTempUnits==="fahrenheit"?"checked":"")+' style="margin:0;width:auto;" /> Fahrenheit (°F)</label>'
    +     '</div>'
    +   '</div>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:6px;">'
    +     '<div>'
    +       '<label style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Date format</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-date" value="us-long" '+(curDateFmt==="us-long"?"checked":"")+' style="margin:0;width:auto;" /> Mon, Aug 5, 2026</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-date" value="intl-long" '+(curDateFmt==="intl-long"?"checked":"")+' style="margin:0;width:auto;" /> Mon, 5 Aug 2026</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-date" value="iso" '+(curDateFmt==="iso"?"checked":"")+' style="margin:0;width:auto;" /> ISO (2026-08-05)</label>'
    +       '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;"><input type="radio" name="sp-date" value="locale" '+(curDateFmt==="locale"?"checked":"")+' style="margin:0;width:auto;" /> Locale (browser default)</label>'
    +     '</div>'
    +     '<div>'
    +       '<label for="sp-currency" style="font-weight:600;color:#222;display:block;margin-bottom:6px;">Currency</label>'
    +       '<input id="sp-currency" type="text" value="'+curCurrency.replace(/"/g,"&quot;")+'" placeholder="e.g. USD, EUR, GBP" style="width:100%;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;" />'
    +       '<div style="font-size:11px;color:#777;line-height:1.5;margin-top:4px;">Three-letter code. For cost displays.</div>'
    +     '</div>'
    +   '</div>'

    + '</div>'
    // v359.12: "Reset all preferences" link tucked into the footer.
    // Wipes every Bucket A/C pref, the briefSeenOnce flag, and the
    // welcome-onboarded localStorage marker so the next session
    // looks like a fresh new-user install. Confirms first; harm
    // reversibility is "type your prefs back in," not catastrophic.
    + '<div style="padding:10px 22px 12px;border-top:1px solid var(--c-border-3);background:var(--c-bg);font-size:11px;text-align:center;">'
    +   '<a href="#" id="sp-reset-all" style="color:#c44;text-decoration:none;font-weight:600;cursor:pointer;">Reset all preferences (start over as a new user)</a>'
    + '</div>'
    // Footer
    + '<div style="padding:14px 22px;border-top:1px solid var(--c-border-3);display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--c-panel);">'
    +   '<div id="sp-status" style="font-size:11px;color:var(--c-ink-3);flex:1;"></div>'
    +   '<button id="sp-cancel" type="button" style="font-size:12px;font-weight:600;padding:7px 14px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;color:#666;cursor:pointer;font-family:inherit;">Cancel</button>'
    +   '<button id="sp-save" type="button" style="font-size:12px;font-weight:700;padding:7px 16px;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:6px;cursor:pointer;font-family:inherit;">Save</button>'
    + '</div>';

  ov.appendChild(box);
  document.body.appendChild(ov);

  // Wire close + cancel.
  function close(){ if (ov.parentNode) ov.parentNode.removeChild(ov); }
  document.getElementById("sp-close-x").onclick = close;
  document.getElementById("sp-cancel").onclick = close;
  ov.addEventListener("click", function(e){ if (e.target === ov) close(); });

  // Highlight selected radio's pill background as user clicks.
  var radioLabels = box.querySelectorAll('label[style*="border-radius:7px"]');
  box.querySelectorAll('input[name="sp-pace"]').forEach(function(rb){
    rb.addEventListener("change", function(){
      radioLabels.forEach(function(lbl){
        var inp = lbl.querySelector('input[name="sp-pace"]');
        if (inp && inp.checked) lbl.style.background = "#eef5ff";
        else if (lbl.style.background) lbl.style.background = "#fff";
      });
    });
  });

  // v359.10: wire mobility chips. Single-select; clicking a chip
  // toggles 'on' state on that chip and clears all others.
  var mobChips = box.querySelectorAll('[data-sp-mob]');
  mobChips.forEach(function(c){
    c.onclick = function(){
      mobChips.forEach(function(o){ o.classList.remove("on"); });
      c.classList.add("on");
    };
  });

  // v359.15: wire avoidance chips. Multi-select; each click toggles
  // its own .on state.
  box.querySelectorAll('[data-sp-avoid]').forEach(function(c){
    c.onclick = function(){ c.classList.toggle("on"); };
  });

  // v359.12: Reset all preferences. Uses MaxDB.prefs.clear() which
  // wipes the entire prefs blob (much cleaner than setting each key
  // to null — earlier version did that and it didn't fully reset
  // because some prefs were never being null-comparable). Also
  // removes the local "max-onboarded" marker so the welcome modal
  // re-fires on the next session. Trips are NOT touched.
  var resetLink = document.getElementById("sp-reset-all");
  if (resetLink) {
    resetLink.onclick = function(e){
      e.preventDefault();
      if (!confirm("Reset all your preferences?\n\nThis clears every default you've set — pace, day-trip threshold, transport, accommodation, mobility, dietary, languages, units, and display preferences. Your TRIPS are not touched.\n\nThe next time you start a trip, you'll see the full first-time brief.\n\nContinue?")) return;
      try {
        if (window.MaxDB && MaxDB.prefs && typeof MaxDB.prefs.clear === "function") {
          MaxDB.prefs.clear();
        }
      } catch(e2) {
        console.warn("[Max settings] prefs.clear failed:", e2);
      }
      // v359.12.5: do NOT clear max-onboarded. Welcome onboarding
      // (which saves paceHours + sightsPerDay) was re-firing after
      // Reset and partially re-populating prefs — defeating the
      // "test as a fresh user" goal. Welcome stays a one-time
      // first-install experience.
      var status = document.getElementById("sp-status");
      if (status) { status.style.color = "#c44"; status.textContent = "Preferences cleared. Reloading…"; }
      setTimeout(function(){ location.reload(); }, 800);
    };
  }

  // Save: validate, write to prefs, close.
  document.getElementById("sp-save").onclick = function(){
    var hpd = parseInt(document.getElementById("sp-hpd").value, 10);
    var spd = parseInt(document.getElementById("sp-spd").value, 10);
    var pm  = (/** @type {any} */ (box.querySelector('input[name="sp-pace"]:checked') || {})).value || "enough";
    var dth = parseFloat(document.getElementById("sp-dth").value);
    // v359.51.14: day-trip radius pref. v359.51.15: convert from
    // input unit (km or miles, per data-unit attribute) to km
    // before persisting — storage is canonical km.
    var drkEl = document.getElementById("sp-dt-radius");
    var drk = NaN;
    if (drkEl) {
      var raw = parseFloat(drkEl.value);
      if (drkEl.getAttribute("data-unit") === "imperial") {
        drk = raw * 1.609344; // miles → km
      } else {
        drk = raw;
      }
    }
    var trav = parseInt(document.getElementById("sp-travelers").value, 10);
    var wk = !!document.getElementById("sp-with-kids").checked;
    // v360.4: transport no longer collected — per-trip field.
    var ac = (document.getElementById("sp-accom").value || "").trim();
    // v359.10: Bucket A reads.
    var mobChip = box.querySelector('[data-sp-mob].on');
    var mob = mobChip ? mobChip.getAttribute("data-sp-mob") : "";
    var di = (document.getElementById("sp-dietary").value || "").trim();
    var lg = (document.getElementById("sp-languages").value || "").trim();
    // v359.60.75: personal profile extensions.
    var al = (document.getElementById("sp-allergies") && document.getElementById("sp-allergies").value || "").trim();
    var ecn = (document.getElementById("sp-emergency-name") && document.getElementById("sp-emergency-name").value || "").trim();
    var ecp = (document.getElementById("sp-emergency-phone") && document.getElementById("sp-emergency-phone").value || "").trim();
    var loy = (document.getElementById("sp-loyalty") && document.getElementById("sp-loyalty").value || "").trim();
    var distR = box.querySelector('input[name="sp-dist"]:checked');
    var du = distR ? distR.value : "metric";
    var tempR = box.querySelector('input[name="sp-temp"]:checked');
    var tu = tempR ? tempR.value : "celsius";
    var dateR = box.querySelector('input[name="sp-date"]:checked');
    var df = dateR ? dateR.value : "us-long";
    var cu = (document.getElementById("sp-currency").value || "").trim().toUpperCase();
    // v359.15: avoid defaults.
    var avoidObj = {};
    box.querySelectorAll('[data-sp-avoid].on').forEach(function(c){
      var id = c.getAttribute("data-sp-avoid");
      if (id) avoidObj[id] = true;
    });
    var avoidOther = (document.getElementById("sp-avoid-other").value || "").trim();
    // v360.4: hard limits.
    var hlEl = document.getElementById("sp-hardlimits");
    var hL = (hlEl && hlEl.value || "").trim();
    if (!isFinite(hpd) || hpd < 2 || hpd > 10) hpd = 6;
    if (!isFinite(spd) || spd < 1 || spd > 6) spd = 2;
    if (pm !== "loose" && pm !== "enough" && pm !== "notmuch") pm = "enough";
    if (!isFinite(dth) || dth <= 0 || dth > 6) dth = 3;
    // v359.51.14: clamp radius into the same range _defaultDayTripRadiusKm uses.
    if (!isFinite(drk) || drk < 10 || drk > 250) drk = 60;
    if (!isFinite(trav) || trav < 1 || trav > 40) trav = 2;
    try {
      if (window.MaxDB && MaxDB.prefs) {
        MaxDB.prefs.set("paceHours", hpd);
        MaxDB.prefs.set("sightsPerDay", spd);
        MaxDB.prefs.set("paceMode", pm);
        MaxDB.prefs.set("dayTripHours", dth);
        // v359.51.14: persist day-trip radius (km).
        MaxDB.prefs.set("dayTripRadiusKm", drk);
        MaxDB.prefs.set("travelersCount", trav);
        MaxDB.prefs.set("withKids", wk);
        // v360.4: transport pref no longer written from Settings —
        // per-trip field, lives on each trip's page.
        MaxDB.prefs.set("accommodation", ac);
        MaxDB.prefs.set("mobility", mob);
        MaxDB.prefs.set("dietary", di);
        MaxDB.prefs.set("languages", lg);
        // v359.60.75: persist personal profile extensions.
        MaxDB.prefs.set("allergies", al);
        MaxDB.prefs.set("emergencyContactName", ecn);
        MaxDB.prefs.set("emergencyContactPhone", ecp);
        MaxDB.prefs.set("loyaltyPrograms", loy);
        MaxDB.prefs.set("distanceUnits", du);
        MaxDB.prefs.set("temperatureUnits", tu);
        MaxDB.prefs.set("dateFormat", df);
        MaxDB.prefs.set("currency", cu);
        MaxDB.prefs.set("avoidDefaults", avoidObj);
        MaxDB.prefs.set("avoidOtherDefaults", avoidOther);
        // v360.4: hard limits.
        MaxDB.prefs.set("hardLimits", hL);
      }
    } catch(_){}
    var status = document.getElementById("sp-status");
    if (status) { status.style.color = "#3a7a4a"; status.textContent = "Saved &#10003;"; }
    setTimeout(close, 600);
  };
}
window.showSettingsPanel = showSettingsPanel;

// LLM-readable directive for a given pace mode. Appended to candidate and
// city-data generation prompts so the model shapes stay lengths, sight counts,
// and evening suggestions to match what the user actually wants.
function _paceDirective(mode){
  // v353.2: prepend the user's numeric pace preference if set.
  // The mode-string directive below stays as a fallback / context;
  // the numeric hours/day is more precise and is what the user
  // explicitly chose in the welcome modal. Both flow into the same
  // LLM prompt so the model has both the rough shape and the
  // specific number. Pace lives in the unified MaxDB.prefs blob.
  // v353.3: also append SIGHTS-PER-DAY — orthogonal axis. Pace
  // tells the LLM the time budget; sights count tells it whether
  // to recommend "few but deep" or "lots but short."
  var hourPrefix = "";
  try {
    var ph = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("paceHours"), 10) : NaN;
    if (isFinite(ph) && ph >= 2 && ph <= 10) {
      hourPrefix = "PACE-HOURS: The traveler prefers about " + ph +
        " hours of sightseeing on a full day (lighter on travel days, fuller in the middle). " +
        "Allocate sights and evening suggestions to fit roughly that hour budget per day, " +
        "assuming a committed traveler. ";
    }
    var sp = (window.MaxDB && MaxDB.prefs) ? parseInt(MaxDB.prefs.get("sightsPerDay"), 10) : NaN;
    if (isFinite(sp) && sp >= 1 && sp <= 6) {
      hourPrefix += "MAX-BIG-SIGHTS-PER-DAY: The traveler caps big (2+ hour) sights at " + sp +
        " per day. A 'big' sight is a major museum, a long hike, a mountain railway — anything that anchors a day. Don't pack more than " + sp +
        " of these into one day; if you suggest one, surround it with smaller items (1-hour stops, walks, food, scenic detours) so the day doesn't turn into a forced march. ";
    }
  } catch (_) {}
  if (mode === "loose") {
    return hourPrefix + "PACE: Loose. The traveler wants white space. Prefer LONGER stays (nudge stayRange up by 1 night where reasonable). Recommend FEWER sights per destination (5-6). Leave evenings open. Optimize for sitting in cafes, people-watching, unscheduled discovery.";
  }
  if (mode === "notmuch") {
    return hourPrefix + "PACE: Not much. The traveler has limited time and wants high throughput. Prefer SHORTER stays (minimum that makes sense). Recommend MORE sights per destination (8-10). Include evening suggestions. Pack the days.";
  }
  if (mode === "enough") {
    return hourPrefix + "PACE: Enough. Balanced. Moderate stays, 6-8 sights per destination, deliberate gaps for unexpected opportunities.";
  }
  return hourPrefix;
}

// Pick a sights-count string appropriate for the pace mode
function _paceSightCount(mode){
  if (mode === "loose") return "5-6 sights";
  if (mode === "notmuch") return "8-10 sights";
  return "6-8 sights";
}

// parseNightsFromRange moved to engine-picker.js (Round HH / Phase 3).

function showLogisticsNudge() {
  // Retired — the "How you're moving" fields now live on Step 2 of the trip brief.
  // If the user wants to change arrival/departure/transport, they click Constraints.
}

// ─── PACE TOAST ─────────────────────────────────────────────
// Iterative pace-tuning loop. Two adjustable levers:
//   Items  — pulls an item out of the fullest day (looser) or promotes one from
//           the suggestions pool into the emptiest day (tighter).
//   Nights — adds a night to the most-packed destination (looser) or removes a
//           night from the least-packed one (tighter). Cascades dates through
//           the rest of the trip and warns before losing scheduled content.
// Dismissed with "Feels good" (session-scoped, per trip).
var _paceMode = "items"; // "items" | "nights"

function showPaceToast(){
  if (!trip || !trip.destinations || !trip.destinations.length) return;
  var key = "pace-toast-dismissed-" + (_currentTripId || trip.name || "trip");
  try { if (sessionStorage.getItem(key) === "1") return; } catch(e){}
  if (document.getElementById("pace-toast")) return;
  var t = document.createElement("div");
  t.id = "pace-toast";
  t.style.cssText = "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:900;background:#2a2a2a;color:var(--c-on-dark);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.25);padding:10px 14px;display:flex;align-items:center;gap:10px;font-family:inherit;max-width:calc(100vw - 32px);flex-wrap:wrap;";
  function modeBtn(id,label){
    var on=_paceMode===id;
    return '<button id="pace-mode-'+id+'" style="font-size:10px;padding:4px 9px;border-radius:11px;border:1px solid '+(on?"#fff":"#555")+';background:'+(on?"#fff":"transparent")+';color:'+(on?"#111":"#aaa")+';cursor:pointer;font-family:inherit;font-weight:'+(on?"700":"500")+';">'+label+'</button>';
  }
  // Rebalance button — only meaningful in Nights mode (net-zero transfer between destinations)
  var rebalanceHtml = _paceMode === "nights"
    ? '<button id="pace-balance" style="font-size:11px;padding:5px 10px;border-radius:5px;border:1px solid #4a6a8a;background:#2a3a5a;color:var(--c-on-dark);cursor:pointer;font-family:inherit;" title="Move 1 night from the least-packed destination to the most-packed one (trip length unchanged)">Even out</button>'
    : '';
  t.innerHTML =
    '<span style="font-size:12px;font-weight:500;">Pace feel right?</span>'
    +'<span style="font-size:10px;color:var(--c-ink-3);margin-right:-4px;">Adjust:</span>'
    +modeBtn("items","Items")+modeBtn("nights","Nights")
    +'<span style="width:1px;background:#555;align-self:stretch;margin:0 2px;"></span>'
    +'<button id="pace-loose" style="font-size:11px;padding:5px 10px;border-radius:5px;border:1px solid #555;background:#3a3a3a;color:var(--c-on-dark);cursor:pointer;font-family:inherit;">Too tight</button>'
    +'<button id="pace-tight" style="font-size:11px;padding:5px 10px;border-radius:5px;border:1px solid #555;background:#3a3a3a;color:var(--c-on-dark);cursor:pointer;font-family:inherit;">Too loose</button>'
    +rebalanceHtml
    +'<button id="pace-ok" style="font-size:11px;padding:5px 10px;border-radius:5px;border:1px solid #4a7a4e;background:#2a5a3e;color:var(--c-on-dark);cursor:pointer;font-family:inherit;font-weight:600;">\u2713 Feels good</button>'
    +'<button id="pace-x" style="font-size:13px;color:#999;background:none;border:none;cursor:pointer;font-family:inherit;padding:0 4px;line-height:1;" title="Dismiss">\u00d7</button>';
  document.body.appendChild(t);
  document.getElementById("pace-mode-items").onclick = function(){ _paceMode="items"; dismissPaceToast(false); showPaceToast(); };
  document.getElementById("pace-mode-nights").onclick = function(){ _paceMode="nights"; dismissPaceToast(false); showPaceToast(); };
  document.getElementById("pace-loose").onclick = function(){ adjustPace("looser"); };
  document.getElementById("pace-tight").onclick = function(){ adjustPace("tighter"); };
  var bb=document.getElementById("pace-balance"); if (bb) bb.onclick = function(){ rebalanceNights(); };
  document.getElementById("pace-ok").onclick = function(){ dismissPaceToast(true); };
  document.getElementById("pace-x").onclick = function(){ dismissPaceToast(false); };
}

function dismissPaceToast(persist){
  var t = document.getElementById("pace-toast");
  if (t) t.remove();
  if (persist) {
    var key = "pace-toast-dismissed-" + (_currentTripId || (trip && trip.name) || "trip");
    try { sessionStorage.setItem(key, "1"); } catch(e){}
  }
}

function adjustPace(direction){
  if (_paceMode === "nights") return adjustPaceByNights(direction);
  return adjustPaceByItems(direction);
}

function adjustPaceByItems(direction){
  // direction: "looser" → remove the last item from the fullest scheduled day of each destination
  //            "tighter" → add the first unscheduled suggestion to the emptiest day of each destination
  if (!trip || !trip.destinations) return;
  var touched = 0;
  trip.destinations.forEach(function(dest){
    var days = dest.days || [];
    if (!days.length) return;
    if (direction === "looser") {
      var target = /** @type {any} */ (null);
      days.forEach(function(d){
        if (!d.items || !d.items.length) return;
        if (!target || d.items.length > target.items.length) target = d;
      });
      if (target && target.items && target.items.length) {
        var popped = target.items.pop();
        if (popped.type === "restaurant") {
          dest.restaurantSuggestions = dest.restaurantSuggestions || [];
          dest.restaurantSuggestions.unshift({id:popped.id, type:"restaurant", n:popped.n, st:popped.st, note:popped.note, lat:popped.lat, lng:popped.lng});
        } else {
          dest.suggestions = dest.suggestions || [];
          dest.suggestions.unshift({id:popped.id, type:"sight", n:popped.n, st:popped.st, note:popped.note, lat:popped.lat, lng:popped.lng});
        }
        touched++;
      }
    } else {
      var target2 = /** @type {any} */ (null);
      days.forEach(function(d){
        d.items = d.items || [];
        if (!target2 || d.items.length < target2.items.length) target2 = d;
      });
      var pool = (dest.suggestions || []).filter(function(s){return s.type==="sight";});
      if (target2 && pool.length) {
        var pick = pool[0];
        sidCtr++;
        var ni = {id:"s"+sidCtr, type:"sight", slot:"day", n:pick.n, p:"nice", done:false,
          st:pick.st||pick.n, note:pick.note||null, timeStart:null, timeEnd:null,
          lat:pick.lat||null, lng:pick.lng||null, url:pick.url||null,
          // SCAFFOLD-2: auto-pulled from suggestions pool — tentative by default.
          tentative:true};
        target2.items.push(ni);
        // PD.241: route through sources model.
        if (typeof _removeSightById === "function") _removeSightById(dest, pick.id);
        else dest.suggestions = dest.suggestions.filter(function(x){return x.id !== pick.id;});
        touched++;
      }
    }
  });
  // TM.4 (v328): emit replaces autoSave + activeDest-routed redraw.
  // The old code used `activeDest` as a proxy for "are we on dest view"
  // — but activeDest can be set even on trip view (sticky from last
  // visit), which made the old code redraw the wrong panel. The bus
  // listener correctly uses `_leftMode`.
  _emitTripMutation();
  setTimeout(showPaceToast, 20);
  showSaveStatus(touched
    ? (direction === "looser" ? "Loosened \u2014 moved " + touched + " item" + (touched!==1?"s":"") + " back to the pool" : "Tightened \u2014 added " + touched + " suggestion" + (touched!==1?"s":"") + " to your days")
    : (direction === "looser" ? "Already loose \u2014 no items scheduled yet to pull back" : "No suggestions available to add \u2014 try loading the Explore tab first"), 3500);
}

// Shift a YYYY-MM-DD date string by N days (positive or negative) and return YYYY-MM-DD
function _shiftDate(dateStr, days){
  if (!dateStr) return dateStr;
  var d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

// Total trip length in days (last dateTo - first dateFrom)
function _tripLengthDays(){
  if (!trip || !trip.destinations || !trip.destinations.length) return 0;
  var first = trip.destinations[0].dateFrom;
  var last = trip.destinations[trip.destinations.length-1].dateTo;
  if (!first || !last) return 0;
  var a = new Date(first+"T12:00:00"), b = new Date(last+"T12:00:00");
  return Math.round((+b-+a)/86400000);
}

// Find bookings on this destination whose dates would fall OUTSIDE the new [from,to] window.
// Returns a list of human-readable conflict lines. Empty array = safe to proceed.
function _collectBookingConflicts(dest, newFrom, newTo){
  var conflicts = [];
  (dest.hotelBookings||[]).forEach(function(b){
    if (b.status !== "booked") return;
    if (b.checkIn && b.checkIn < newFrom) conflicts.push("\u2022 "+b.name+" check-in "+b.checkIn+" is before the new start "+newFrom);
    if (b.checkOut && b.checkOut > newTo) conflicts.push("\u2022 "+b.name+" check-out "+b.checkOut+" is after the new end "+newTo);
  });
  (dest.generalBookings||[]).forEach(function(b){
    if (b.status !== "booked") return;
    if (b.date && (b.date < newFrom || b.date > newTo)) {
      conflicts.push("\u2022 "+(b.label||b.type||"booking")+" "+b.date+" falls outside the new range "+newFrom+"\u2013"+newTo);
    }
  });
  return conflicts;
}

function adjustPaceByNights(direction){
  // direction: "looser" → add a night to the most-packed destination
  //            "tighter" → remove a night from the least-packed destination (min 1 night)
  if (!trip || !trip.destinations || !trip.destinations.length) return;
  var delta = direction === "looser" ? 1 : -1;

  // Candidate pool — tightening needs destinations with >1 night
  var candidates = trip.destinations.slice();
  if (direction === "tighter") candidates = candidates.filter(function(d){return (d.nights||0) > 1;});
  if (!candidates.length) {
    showSaveStatus(direction==="tighter" ? "Can't tighten further \u2014 every destination is already 1 night" : "No destinations to adjust", 3500);
    return;
  }

  // Score each destination by items-per-day, pick the winner for this direction
  function itemsPerDay(d){
    var items = (d.days||[]).reduce(function(s,day){return s + ((day.items||[]).length);}, 0);
    return items / Math.max(d.nights||1, 1);
  }
  candidates.sort(function(a,b){
    return direction === "looser" ? itemsPerDay(b) - itemsPerDay(a) : itemsPerDay(a) - itemsPerDay(b);
  });
  var target = /** @type {any} */ (candidates[0]);
  var targetIdx = trip.destinations.indexOf(target);

  // Safety: trip duration budget from the brief
  var budget = _parseTripDuration((trip.brief && trip.brief.duration) || (_tb && _tb.duration) || "");
  if (budget) {
    var newLen = _tripLengthDays() + delta;
    if (delta > 0 && newLen > budget.max) {
      if (!confirm("Adding a night will make your trip " + newLen + " days \u2014 beyond your stated budget of " + (budget.min===budget.max?budget.max:(budget.min+"\u2013"+budget.max)) + " days. Continue?")) return;
    } else if (delta < 0 && newLen < budget.min) {
      if (!confirm("Removing a night will make your trip " + newLen + " days \u2014 below your stated budget of " + (budget.min===budget.max?budget.max:(budget.min+"\u2013"+budget.max)) + " days. Continue?")) return;
    }
  }

  // Safety: losing a day with scheduled content
  if (delta < 0) {
    var lastDay = target.days && target.days[target.days.length - 1];
    if (lastDay && lastDay.items && lastDay.items.length) {
      if (!confirm("Removing a night from " + target.place + " will drop day '" + lastDay.lbl + "' (" + lastDay.items.length + " item" + (lastDay.items.length!==1?"s":"") + "). Continue?")) return;
    }
  }

  // Safety: check booking dates specifically — warn only if the change would actually break them
  var newTargetFrom = target.dateFrom;
  var newTargetTo = _shiftDate(target.dateFrom, (target.nights||1) + delta);
  var conflicts = _collectBookingConflicts(target, newTargetFrom, newTargetTo);
  // Also inspect subsequent destinations whose dates cascade
  for (var ci = trip.destinations.indexOf(target)+1; ci < trip.destinations.length; ci++) {
    var cd = trip.destinations[ci];
    conflicts = conflicts.concat(_collectBookingConflicts(cd, _shiftDate(cd.dateFrom, delta), _shiftDate(cd.dateTo, delta)));
  }
  if (conflicts.length) {
    if (!confirm("These bookings may no longer fit the new dates:\n\n" + conflicts.join("\n") + "\n\nContinue anyway?")) return;
  }

  // Apply the change to the target
  target.nights = (target.nights||1) + delta;
  target.dateTo = _shiftDate(target.dateFrom, target.nights);
  if (delta > 0) {
    var idx = (target.days||[]).length;
    var d = new Date(target.dateFrom + "T12:00:00"); d.setDate(d.getDate() + idx);
    var lbl = d.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    target.days = target.days || [];
    target.days.push({id:"dy"+target.id+"_ext"+Date.now(), lbl:lbl, note:"", items:[]});
  } else {
    target.days.pop();
  }

  // Cascade — shift every subsequent destination's dates by `delta`
  for (var i = targetIdx + 1; i < trip.destinations.length; i++) {
    var dst = trip.destinations[i];
    dst.dateFrom = _shiftDate(dst.dateFrom, delta);
    dst.dateTo   = _shiftDate(dst.dateTo,   delta);
    // Day labels — re-derive from new dateFrom so the UI reflects the shift
    (dst.days||[]).forEach(function(day, di){
      var dd = new Date(dst.dateFrom + "T12:00:00"); dd.setDate(dd.getDate() + di);
      day.lbl = dd.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    });
  }

  // TM.4 (v328): emit replaces autoSave + activeDest-routed redraw.
  // The old code used `activeDest` as a proxy for "are we on dest view"
  // — but activeDest can be set even on trip view (sticky from last
  // visit), which made the old code redraw the wrong panel. The bus
  // listener correctly uses `_leftMode`.
  _emitTripMutation();
  setTimeout(showPaceToast, 20);
  showSaveStatus((delta > 0 ? "Loosened \u2014 added a night in " : "Tightened \u2014 removed a night from ") + target.place
    + "; trip end " + (delta > 0 ? "pushed" : "pulled in") + " by 1 day", 3800);
}

// Move 1 night from the least-packed destination (nights > 1) to the most-packed
// one. Net trip length unchanged. Cascades only the destinations between source
// and sink — earlier and later destinations keep their dates.
function rebalanceNights(){
  if (!trip || !trip.destinations || trip.destinations.length < 2) {
    showSaveStatus("Need at least two destinations to rebalance", 3000);
    return;
  }
  function itemsPerDay(d){
    var items = (d.days||[]).reduce(function(s,day){return s + ((day.items||[]).length);}, 0);
    return items / Math.max(d.nights||1, 1);
  }
  var src = /** @type {any} */ (null), sink = /** @type {any} */ (null);
  var srcScore = Infinity, sinkScore = -Infinity;
  trip.destinations.forEach(function(d){
    var s = itemsPerDay(d);
    if ((d.nights||0) > 1 && s < srcScore) { src = d; srcScore = s; }
    if (s > sinkScore) { sink = d; sinkScore = s; }
  });
  if (!src || !sink || src === sink) {
    showSaveStatus("Already balanced \u2014 or no destination has enough nights to donate", 3000);
    return;
  }
  // Safety: is the donating destination's last day scheduled?
  var lastDay = src.days[src.days.length-1];
  if (lastDay && lastDay.items && lastDay.items.length) {
    if (!confirm("Moving a night from " + src.place + " will drop day '" + lastDay.lbl + "' (" + lastDay.items.length + " item" + (lastDay.items.length!==1?"s":"") + "). Continue?")) return;
  }
  // Booking conflict check — scan all destinations post-rebalance
  // (After the shift, destinations before min(src,sink) and after max(src,sink) keep their dates.
  //  Between them, dates shift but the totals add up, so only src and sink really "change length.")
  var confSrc = _collectBookingConflicts(src, src.dateFrom, _shiftDate(src.dateFrom, (src.nights||1) - 1));
  if (confSrc.length) {
    if (!confirm("These bookings on " + src.place + " may no longer fit:\n\n" + confSrc.join("\n") + "\n\nContinue?")) return;
  }

  // Apply nights delta, pop src's last day, append an empty day to sink.
  src.nights -= 1;
  src.days.pop();
  sink.nights += 1;
  sink.days = sink.days || [];
  sink.days.push({id:"dy"+sink.id+"_ext"+Date.now(), lbl:"", note:"", items:[]});

  // Recompute every destination's dates starting from destinations[0].dateFrom —
  // since src lost 1 night and sink gained 1, total nights are preserved, so
  // destinations before min(src,sink) and after max(src,sink) keep identical dates.
  var cur = trip.destinations[0].dateFrom;
  trip.destinations.forEach(function(d){
    d.dateFrom = cur;
    d.dateTo = _shiftDate(cur, d.nights||1);
    (d.days||[]).forEach(function(day, di){
      var dd = new Date(cur + "T12:00:00"); dd.setDate(dd.getDate() + di);
      day.lbl = dd.toLocaleDateString("en-US", {month:"short", day:"numeric"});
    });
    cur = d.dateTo;
  });

  // TM.4 (v328): emit replaces autoSave + activeDest-routed redraw.
  // The old code used `activeDest` as a proxy for "are we on dest view"
  // — but activeDest can be set even on trip view (sticky from last
  // visit), which made the old code redraw the wrong panel. The bus
  // listener correctly uses `_leftMode`.
  _emitTripMutation();
  setTimeout(showPaceToast, 20);
  showSaveStatus("Evened out \u2014 moved 1 night from " + src.place + " to " + sink.place, 3800);
}

// Round FS: showShortlistBanner deleted. Was a confirmation banner
// shown 200ms after first build ("\u2713 N places \u2014 draft schedule below");
// redundant with the trip view itself, the FQ verdict banner, and the
// always-visible Parameters button. See tripsAfterCandidates for the
// removed call site.


function doCreateTrip(){
  var name=g("ntp-name").value.trim(); if(name.length<2)return;
  trip={name:name,destinations:[],legs:{},trackSpending:false,pendingActions:[]};
  activeDest=null; destCtr=0; sidCtr=100; bkCtr=0; _actionCtr=0; _fileHandle=null;
  var id="trip-"+Date.now(); _currentTripId=id;
  // PD.333 (audit C7/A2): one id, one key; anchor TripStore so every
  // subsequent mutator acts on THIS trip.
  trip.id = id;
  if (typeof TripStore !== "undefined" && typeof TripStore.replace === "function") {
    try { TripStore.replace(trip); trip = TripStore.trip; } catch(_){}
  }
  // PD.327: single mutator (dedup by id). Was raw _tripsIndex.push.
  _upsertTripIndexEntry({id:id,name:name,destCount:0,dateRange:"",savedAt:new Date().toISOString()});
  localSave();
  hideNewTripForm();
  enterApp();
}

export {};

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._briefIsLocked = _briefIsLocked;
  __expg._briefRenderLocked = _briefRenderLocked;
  __expg._briefTrunc = _briefTrunc;
  __expg._collectBookingConflicts = _collectBookingConflicts;
  __expg._defaultAccommodation = _defaultAccommodation;
  __expg._defaultAllergies = _defaultAllergies;
  __expg._defaultAvoid = _defaultAvoid;
  __expg._defaultAvoidOther = _defaultAvoidOther;
  __expg._defaultCurrency = _defaultCurrency;
  __expg._defaultDateFormat = _defaultDateFormat;
  __expg._defaultDayTripHours = _defaultDayTripHours;
  __expg._defaultDayTripRadiusKm = _defaultDayTripRadiusKm;
  __expg._defaultDietary = _defaultDietary;
  __expg._defaultDistanceUnits = _defaultDistanceUnits;
  __expg._defaultEmergencyName = _defaultEmergencyName;
  __expg._defaultEmergencyPhone = _defaultEmergencyPhone;
  __expg._defaultHardLimits = _defaultHardLimits;
  __expg._defaultHoursPerDay = _defaultHoursPerDay;
  __expg._defaultLanguages = _defaultLanguages;
  __expg._defaultLoyaltyPrograms = _defaultLoyaltyPrograms;
  __expg._defaultMaxBigSightsPerDay = _defaultMaxBigSightsPerDay;
  __expg._defaultMobility = _defaultMobility;
  __expg._defaultPaceMode = _defaultPaceMode;
  __expg._defaultTemperatureUnits = _defaultTemperatureUnits;
  __expg._defaultTransport = _defaultTransport;
  __expg._defaultTravelersCount = _defaultTravelersCount;
  __expg._defaultWithKids = _defaultWithKids;
  __expg._getPaceMode = _getPaceMode;
  __expg._hasAvoidDefaults = _hasAvoidDefaults;
  __expg._isReturningUser = _isReturningUser;
  __expg._paceDirective = _paceDirective;
  __expg._paceMode = _paceMode;
  __expg._paceSightCount = _paceSightCount;
  __expg._shiftDate = _shiftDate;
  __expg._tbSetDisplayPref = _tbSetDisplayPref;
  __expg._tbUnlockShape = _tbUnlockShape;
  __expg._tripLengthDays = _tripLengthDays;
  __expg.adjustPace = adjustPace;
  __expg.adjustPaceByItems = adjustPaceByItems;
  __expg.adjustPaceByNights = adjustPaceByNights;
  __expg.dismissPaceToast = dismissPaceToast;
  __expg.doCreateTrip = doCreateTrip;
  __expg.findAttachedEvents = findAttachedEvents;
  __expg.rebalanceNights = rebalanceNights;
  __expg.showLogisticsNudge = showLogisticsNudge;
  __expg.showPaceToast = showPaceToast;
  __expg.showSettingsPanel = showSettingsPanel;
}
