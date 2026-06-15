// edit-constraints.js — re-open Step 1 (brief) from within planning. Extracted from
// index.html (PD.460).

// ── EDIT CONSTRAINTS (re-open Step 1 from within planning) ─────────────────

function editConstraints(){
  // v359.60.73: hydrate insurance + visa from trip.brief into _tb so
  // the form pre-populates with saved values. Other fields hydrate
  // earlier in the load path; these are new and don't have hydration
  // sites elsewhere yet. Deep copies prevent the form's oninput
  // handlers from mutating trip.brief before applyConstraintChanges
  // runs the diff.
  if (trip && trip.brief) {
    if (trip.brief.insurance && !_tb.insurance) {
      _tb.insurance = Object.assign({}, trip.brief.insurance);
    }
    if (trip.brief.visa && !_tb.visa) {
      _tb.visa = Object.assign({}, trip.brief.visa);
    }
    // v359.60.75: hydrate checklist + documents from trip.brief so
    // the Profile editor pre-populates with saved values on reopen.
    if (Array.isArray(trip.brief.checklist) && (!Array.isArray(_tb.checklist) || !_tb.checklist.length)) {
      _tb.checklist = JSON.parse(JSON.stringify(trip.brief.checklist));
    }
    if (Array.isArray(trip.brief.documents) && (!Array.isArray(_tb.documents) || !_tb.documents.length)) {
      _tb.documents = JSON.parse(JSON.stringify(trip.brief.documents));
    }
  }
  // Snapshot current values before editing
  var ov = g("trip-brief-overlay");
  if(ov) ov.style.zIndex = "10000";
  // v359.49.3: mirror _tbCaptureDates' canonicalization so the
  // snapshot stores the SAME serialized when/duration the form
  // will read back. Without this, opening Edit with no changes
  // and clicking Preview produced a phantom "(legacy free-form when)
  // → (ISO startDate)" diff, which fired applyConstraintChanges
  // → drawTripMode + (occasionally) resequenceWithCurrentBrief.
  var _snapWhen     = _tb.when||"";
  var _snapDuration = _tb.duration||"";
  if (_tb.dateMode === "specific") {
    if (_tb.startDate) _snapWhen = _tb.startDate;
    if (_tb.days)      _snapDuration = _tb.days + " days";
  }
  _tb._snapshot = {
    region:_tb.region||"", duration:_snapDuration, when:_snapWhen,
    // Dates (E) — structured pick-any-two
    dateMode:_tb.dateMode||"", startDate:_tb.startDate||"", endDate:_tb.endDate||"",
    days:(typeof _tb.days === "number" ? _tb.days : null), dateDerived:_tb.dateDerived||"",
    entry:_tb.entry||"", tbExit:_tb.tbExit||"",
    entryMode:_tb.entryMode||"", exitMode:_tb.exitMode||"",
    // Round FQ: betweenMode dropped from snapshot — pill removed from Step 2.
    entryFixed:!!_tb.entryFixed, exitFixed:!!_tb.exitFixed,
    transport:_tb.transport||"", accommodation:_tb.accommodation||"",
    pace:_tb.pace||"", compromises:_tb.compromises||"", hardlimits:_tb.hardlimits||"",
    // Party (G) + Avoidances (H)
    partyComposition:_tb.partyComposition||"", partySize:_tb.partySize||"",
    partyAges:_tb.partyAges||"", physicalAbility:_tb.physicalAbility||"",
    abilityNote:_tb.abilityNote||"",
    avoid: Object.assign({}, _tb.avoid||{}),
    avoidSummary:_tbAvoidSummary(),
    avoidOther:_tb.avoidOther||"",
    // v294.12: fields previewConstraintChanges reads but the
    // snapshot was missing. Without these, every Parameters reopen
    // showed a phantom "(not set) → current value" diff for the
    // already-saved value.
    gettingTo:_tb.gettingTo||"", gettingOut:_tb.gettingOut||"",
    // v359.49.2: snapshot must mirror the form's prefill fallback,
    // otherwise an empty travelersCount/withKids snapshot vs a
    // partySize/partyComposition-derived form value reads as a
    // diff and Brief→no-changes still routes through apply.
    travelersCount:(_tb.travelersCount||_tb.partySize||""),
    withKids:!!(_tb.withKids||_tb.partyComposition==="family-kids"),
    aboutTrip:_tb.aboutTrip||"",
    // v302: structured pace fields. Snapshot mirrors the form so the
    // diff doesn't fire spurious "(not set) → 6" phantoms when nothing
    // changed.
    hoursPerDay: _tb.hoursPerDay || 6,
    maxBigSightsPerDay: _tb.maxBigSightsPerDay || 2,
    // v359.60.73: travel insurance + visa as reference fields. Deep
    // copies so the snapshot isn't mutated by oninput handlers as the
    // user types — applyConstraintChanges compares against this for
    // change detection.
    insurance: _tb.insurance ? Object.assign({}, _tb.insurance) : null,
    visa: _tb.visa ? Object.assign({}, _tb.visa) : null,
    // v359.60.75: deep-copy arrays of plain objects (JSON round-trip)
    // so the snapshot survives in-place mutations during editing.
    checklist: _tb.checklist ? JSON.parse(JSON.stringify(_tb.checklist)) : [],
    documents: _tb.documents ? JSON.parse(JSON.stringify(_tb.documents)) : []
  };
  _tb._editMode = true;
  if(ov){
    // Reparent to body so the display:none home-screen ancestor doesn't hide it
    // when the user is in the trip view. Same fix as the Candidate Explorer.
    if (ov.parentElement !== document.body) document.body.appendChild(ov);
    ov.style.display="block";
    renderTripBriefEdit();
  }
}

function renderTripBriefEdit(){
  // Same as renderTripBrief but CTA goes to previewConstraintChanges
  var ov=g("trip-brief-overlay"); ov.className="tb-overlay";
  var _prevScroll = ov.scrollTop || 0;
  var _preserve = !!_tb._preserveScrollOnce;
  _tb._preserveScrollOnce = false;
  ov.style.cssText="position:fixed;inset:0;background:var(--c-panel);z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch;";
  setTimeout(function(){ ov.scrollTop = _preserve ? _prevScroll : 0; attachScrollHint(ov); }, 0);
  ov.innerHTML='<div class="tb-header">'
    +'<div class="tb-logo"><div class="tb-logo-m">M</div><div><div style="font-size:12px;font-weight:700;">Max</div><div class="tb-step">Editing your trip</div></div></div>'
    +'<div class="tb-title">Tell Max about your trip</div>'
    +'<div class="tb-sub">Make changes below. Max will show you what needs to be revisited before anything is applied.</div>'
    +'</div>'
    +'<div class="tb-body">'

    // \u2500\u2500 CONTEXT 1: TRIP PROFILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4 (#124 follow-up): same two-context structure as
    // renderTripStep1Place. The "Profile\u2026" menu item on the trip
    // page calls editConstraints \u2192 this function, so the splitting
    // and the transport-in-trip-profile move need to happen here too.
    +'<div style="margin:6px 0 22px;padding:14px 0 14px 18px;border-left:3px solid var(--c-primary);">'
    +'<div style="margin-bottom:14px;">'
    +  '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--c-primary);margin-bottom:2px;">This trip</div>'
    +  '<div style="font-size:14px;font-weight:700;color:#222;">Trip profile</div>'
    +  '<div style="font-size:11.5px;color:#666;margin-top:3px;line-height:1.55;">Specific to this trip \u2014 where you\u2019re going, why, when, how you\u2019d like to get around, and who\u2019s going.</div>'
    +'</div>'

    // \u2500\u2500 The destination \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: structure mirrors renderTripStep1Place \u2014 region, why
    // specifically, why generally, dates all inside one Destination
    // sub-section. Reads where \u2192 why \u2192 when, then transport, then
    // travelers below.
    + _tbSectionHead("The destination", "Where you\u2019re going, why, and when.")
    +'<div class="tb-field"><label>Where are you going?</label>'
    +'<input id="tb-region" value="'+(_tb.region||"").replace(/"/g,"&quot;")+'" placeholder="e.g. Central Europe, Swiss Alps, Japan\u2026" oninput="_tb.region=this.value;" />'
    +'<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Country, region, city, park \u2014 anywhere worth mapping.</div>'
    +'</div>'
    +'<div class="tb-field" style="margin-top:14px;"><label>Why this place, specifically?</label>'
    +'<input id="tb-why-specifically" placeholder="e.g. drive the entire ring road" autocomplete="off" value="'+(_tb.whySpecifically||"").replace(/"/g,"&quot;")+'" oninput="_tb.whySpecifically=this.value;" />'
    +'<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">What you want to do.</div>'
    +'</div>'
    +'<div class="tb-field"><label>Why this place, generally?</label>'
    +'<input id="tb-why-generally" placeholder="e.g. see the spectacular scenery" autocomplete="off" value="'+(_tb.whyGenerally||"").replace(/"/g,"&quot;")+'" oninput="_tb.whyGenerally=this.value;" />'
    +'<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Why this place at all.</div>'
    +'</div>'
    + _tbDatesFieldHtml()

    // \u2500\u2500 Getting around \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: sub-section head matches renderTripStep1Place.
    + _tbSectionHead("Getting around", "How you\u2019d like to get around in " + _pmEsc(_tb.region || "the region") + ".")
    +'<div class="tb-field">'
    +'<input id="tb-transport" value="'+(_tb.transport||"").replace(/"/g,"&quot;")+'" placeholder="e.g. Trains and walking only \u2014 no rental car. Swiss Travel Pass." oninput="_tb.transport=this.value;" />'
    +'<div style="font-size:10.5px;color:var(--c-warn);font-style:italic;margin-top:4px;line-height:1.55;">This shapes everything for this trip. Different regions reward different choices.</div>'
    +'</div>'

    // \u2500\u2500 The travelers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: locked-when-default pattern mirrors renderTripStep1Place.
    + _tbSectionHead("The travelers", "Who\u2019s going.")
    + (function(){
        if (_briefIsLocked("travelersCount", "travelersCount")) {
          var dCt = _defaultTravelersCount();
          var dKids = _defaultWithKids();
          var lbl = dCt + " traveler" + (dCt === 1 ? "" : "s") + (dKids ? ", with kids" : "") + " (your default)";
          return _briefRenderLocked("How many travelers?", lbl, "travelersCount");
        }
        return '<div class="tb-field"><label>How many travelers?</label>'
          + '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'
          +   '<input id="tb-travelers-count" type="number" min="1" max="40" inputmode="numeric" value="'+((_tb.travelersCount||_tb.partySize||_defaultTravelersCount())+"").replace(/"/g,"&quot;")+'" placeholder="e.g. 2" oninput="_tb.travelersCount=this.value;" style="max-width:120px;" />'
          +   '<label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;font-size:13px;margin:0;text-transform:none;letter-spacing:0;color:#222;">'
          +     '<input id="tb-with-kids" type="checkbox" '+(((typeof _tb.withKids === "boolean" ? _tb.withKids : _defaultWithKids())||_tb.partyComposition==="family-kids")?"checked":"")+' onchange="_tb.withKids=this.checked;" style="width:auto;margin:0;" /> Traveling with kids?'
          +   '</label>'
          +   '<span id="tb-trav-badge"></span>'
          +   '<a href="#" id="tb-trav-promote" style="display:none;">↑ Apply to defaults</a>'
          + '</div>'
          + '</div>';
      })()

    // Close the Trip Profile wrap; Traveler Profile wrap opens next.
    +'</div>'

    // \u2500\u2500 CONTEXT 2: TRAVELER PROFILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4 (#124 follow-up): same banner + wrap as renderTripStep1Place.
    // First-time vs returning hint copy switches on whether the user has
    // shaped a meaningful Traveler Profile globally (we count mobility,
    // accommodation, paceMode, avoidOtherDefaults \u2014 NOT paceHours /
    // sightsPerDay which the welcome seeds, and NOT transport which is
    // per-trip).
    +'<div style="margin:6px 0 6px;padding:14px 0 14px 18px;border-left:3px solid #7a5b3a;">'
    + (function(){
        var prefs = (window.MaxDB && MaxDB.prefs) ? MaxDB.prefs : null;
        function pget(k){ try { return prefs ? prefs.get(k) : null; } catch(_) { return null; } }
        var hasAnyProfileData = !!(
          pget("mobility") || (pget("accommodation") && String(pget("accommodation")).trim()) ||
          pget("paceMode") ||
          (pget("avoidOtherDefaults") && String(pget("avoidOtherDefaults")).trim())
        );
        // v360.4: context-agnostic first-time copy — works for both
        // new-trip and edit-existing-trip flows. Dropped the
        // "Before we get into [destination]" framing which assumed
        // new-trip timing.
        var hint = !hasAnyProfileData
          ? 'How do you generally travel? Max will remember these across all your trips. Fill them out once, update them anytime.'
          : 'Max understands this is how you usually travel. Tune them for this trip only, or update your profile to change them from now on.';
        return ''
          + '<div style="margin-bottom:14px;">'
          +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7a5b3a;margin-bottom:2px;">Carried across every trip</div>'
          +   '<div style="font-size:14px;font-weight:700;color:#3a2e1a;">Traveler profile</div>'
          +   '<div style="font-size:11.5px;color:#5a4a2a;margin-top:6px;line-height:1.6;">' + hint + '</div>'
          +   '<div style="margin-top:8px;font-size:11px;">'
          +     '<a href="#" onclick="if(typeof showSettingsPanel===\'function\')showSettingsPanel();event.preventDefault();" style="color:var(--c-primary);text-decoration:none;font-weight:600;">Open full profile \u2192</a>'
          +     '<span style="color:var(--c-ink-4);margin:0 8px;">\u00b7</span>'
          +     '<span style="color:#7a5b3a;">Anything you change below applies to this trip; use the \u201c\u2191 Apply to defaults\u201d link beside a field to also save it to your profile.</span>'
          +   '</div>'
          + '</div>';
      })()

    // v360.4 (#124 follow-up): Traveler Profile fields now use the
    // same locked-when-default pattern as renderTripStep1Place. If
    // a global default is saved for a field, it renders as
    // "<value> (your default) [Override for this trip \u21bb]". Click
    // the link \u2192 editable input appears. Same UX in both editors.

    // \u2500\u2500 Mobility (first, no section head) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    + (function(){
        if (_briefIsLocked("mobility", "mobility")) {
          var dMob = _defaultMobility();
          var labels = {fit:"Fit and active", moderate:"Moderate", limited:"Limited walking", elderly:"Elderly", mobility:"Mobility aid", other:"Other"};
          var lbl = (labels[dMob] || dMob) + " (your default)";
          return _briefRenderLocked("Mobility of the slowest member", lbl, "mobility");
        }
        var ab = _tb.physicalAbility || _defaultMobility() || "";
        var opts = [
          {id:"fit",      label:"Fit and active"},
          {id:"moderate", label:"Moderate"},
          {id:"limited",  label:"Limited walking"},
          {id:"elderly",  label:"Elderly"},
          {id:"mobility", label:"Mobility aid"},
          {id:"other",    label:"Other"}
        ];
        var chips = opts.map(function(o){
          return '<span class="tb-toggle'+(ab===o.id?" on":"")+'" data-ability-id="'+o.id+'" onclick="_tbPickAbility(\''+o.id+'\')">'+o.label+'</span>';
        }).join("");
        return '<div class="tb-field"><label>Mobility of the slowest member</label>'
          + '<div style="font-size:10.5px;color:#777;margin-top:2px;margin-bottom:6px;line-height:1.55;">Max shapes the trip around what the slowest or least-mobile traveler can manage comfortably.</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'+chips
          +   '<span id="tb-mob-badge" style="margin-left:8px;"></span>'
          +   '<a href="#" id="tb-mob-promote" style="display:none;margin-left:6px;">\u2191 Apply to defaults</a>'
          + '</div>'
          + '<input id="tb-ability-note" value="'+((_tb.abilityNote||"").replace(/"/g,"&quot;"))+'" placeholder="Anything specific Max should know \u2014 bad knees, pregnant, strollers, etc." oninput="_tb.abilityNote=this.value;" style="margin-top:8px;" />'
          + '</div>';
      })()

    // \u2500\u2500 Where you stay \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: about-trip moved to its own "Anything else" sub-section
    // below.
    + _tbSectionHead("Where you stay", "Your usual lodging style.")
    + (function(){
        if (_briefIsLocked("accommodation", "accommodation")) {
          return _briefRenderLocked("Where you\u2019d like to stay", _pmEsc(_briefTrunc(_defaultAccommodation(), 60)) + " (your default)", "accommodation");
        }
        return '<div class="tb-field"><label>Where you\u2019d like to stay</label>'
          + '<textarea id="tb-accommodation" rows="2" placeholder="e.g. Small family hotels, en suite required, no hostels." oninput="_tb.accommodation=this.value;" style="resize:vertical;min-height:54px;">'+(_tb.accommodation||_defaultAccommodation()||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
          + '<div style="display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap;">'
          +   '<span id="tb-accom-badge"></span>'
          +   '<a href="#" id="tb-accom-promote" style="display:none;">\u2191 Apply to defaults</a>'
          + '</div>'
          + '<div style="font-size:10.5px;color:var(--c-warn);font-style:italic;margin-top:4px;line-height:1.55;">Be explicit even if it feels obvious.</div>'
          + '</div>';
      })()

    // \u2500\u2500 Anything else \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: about-trip's own sub-section. Catch-all prose context.
    + _tbSectionHead("Anything else", "Free-form context Max should know. Optional.")
    +'<div class="tb-field"><textarea id="tb-about-trip" rows="4" placeholder="e.g. Couple in our 60s, first trip to this region. Would skip a famous-but-touristy day-trip; wouldn\u2019t skip a once-in-a-lifetime view." oninput="_tb.aboutTrip=this.value;">'+((_tb.aboutTrip||"").replace(/</g,"&lt;"))+'</textarea>'
    +'<div style="font-size:10px;color:var(--c-ink-4);margin-top:4px;line-height:1.5;">The more you share, the better the suggestions. Max reads this as prose \u2014 write naturally.</div>'
    +'</div>'

    // \u2500\u2500 The shape (hours, sights, default pace, day-trip drive time) \u2500\u2500
    + _tbSectionHead("The shape", "How long each day, how many sights \u2014 and how to think about day trips.")
    +'<div class="tb-field" id="tb-shape-fields">'
    // Hours/day
    +   (function(){
          if (_briefIsLocked("paceHours", "hoursPerDay")) {
            return _briefRenderLocked("Hours of sightseeing per day", _defaultHoursPerDay() + " hrs (your default)", "hoursPerDay");
          }
          return '<div class="tb-shape-row" style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">'
            + '<label style="font-weight:500;color:#222;flex:0 0 240px;margin:0;font-size:12.5px;text-transform:none;letter-spacing:0;">Hours of sightseeing per day</label>'
            + '<input id="tb-hours-per-day" type="number" min="2" max="10" inputmode="numeric" value="'+(_tb.hoursPerDay||_defaultHoursPerDay())+'" oninput="_tb.hoursPerDay=this.value;" style="width:64px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;text-align:center;" />'
            + '<span id="tb-hpd-badge"></span>'
            + '<a href="#" id="tb-hpd-promote" style="display:none;">↑ Apply to defaults</a>'
            + '</div>';
        })()
    // Big sights
    +   (function(){
          if (_briefIsLocked("sightsPerDay", "maxBigSightsPerDay")) {
            return _briefRenderLocked("Max big sights per day", _defaultMaxBigSightsPerDay() + " (your default)", "maxBigSightsPerDay");
          }
          return '<div class="tb-shape-row" style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;">'
            + '<label style="font-weight:500;color:#222;flex:0 0 240px;margin:0;font-size:12.5px;text-transform:none;letter-spacing:0;">Max big sights per day</label>'
            + '<input id="tb-max-big-sights" type="number" min="1" max="6" inputmode="numeric" value="'+(_tb.maxBigSightsPerDay||_defaultMaxBigSightsPerDay())+'" oninput="_tb.maxBigSightsPerDay=this.value;" style="width:64px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;text-align:center;" />'
            + '<span id="tb-spd-badge"></span>'
            + '<a href="#" id="tb-spd-promote" style="display:none;">↑ Apply to defaults</a>'
            + '</div>';
        })()
    // Default pace (radios)
    +   (function(){
          var paceLabelMap = {loose:"Relaxed", enough:"Balanced", notmuch:"Intense"};
          if (_briefIsLocked("paceMode", "paceMode")) {
            return _briefRenderLocked("Default pace", paceLabelMap[_defaultPaceMode()] + " (your default)", "paceMode");
          }
          var cur = _tb.paceMode || _defaultPaceMode();
          function rb(value, label, desc) {
            var checked = (cur === value) ? "checked" : "";
            return '<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;font-weight:500;color:#222;text-transform:none;letter-spacing:0;line-height:1.45;margin:0;padding:0;">'
              + '<input type="radio" name="tb-pace-mode" value="'+value+'" '+checked+' onchange="_tb.paceMode=this.value;" style="margin-top:2px;flex-shrink:0;width:auto;" />'
              + '<span><strong>'+label+'</strong><span style="font-weight:400;color:#666;font-size:11px;"> \u2014 '+desc+'</span></span>'
              + '</label>';
          }
          return '<div class="tb-shape-row" style="display:flex;align-items:flex-start;gap:10px;margin-bottom:14px;flex-wrap:wrap;">'
            + '<label style="font-weight:500;color:#222;flex:0 0 240px;margin:0;font-size:12.5px;text-transform:none;letter-spacing:0;padding-top:4px;">Default pace</label>'
            + '<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:260px;">'
            +   rb("loose", "Relaxed", "Longer stays, fewer sights, open evenings.")
            +   rb("enough", "Balanced", "Moderate stays, 6\u20138 sights per destination.")
            +   rb("notmuch", "Intense", "Shorter stays, more sights, full evenings.")
            +   '<div style="display:flex;align-items:center;gap:10px;margin-top:4px;">'
            +     '<span id="tb-pace-badge"></span>'
            +     '<a href="#" id="tb-pace-promote" style="display:none;">\u2191 Apply to defaults</a>'
            +   '</div>'
            + '</div>'
            + '</div>';
        })()
    // Day-trip drive time
    +   (function(){
          if (_briefIsLocked("dayTripHours", "dayTripHours")) {
            return _briefRenderLocked("Max drive time for a day trip", _defaultDayTripHours() + " hours (your default)", "dayTripHours");
          }
          return '<div class="tb-shape-row" style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">'
            + '<label style="font-weight:500;color:#222;flex:0 0 240px;margin:0;font-size:12.5px;text-transform:none;letter-spacing:0;">Max drive time for a day trip</label>'
            + '<div style="display:flex;align-items:center;gap:5px;">'
            +   '<input id="tb-day-trip-hours" type="number" min="1" max="6" step="0.5" inputmode="decimal" value="'+(_tb.dayTripHours||_defaultDayTripHours())+'" oninput="_tb.dayTripHours=this.value;" style="width:64px;padding:5px 8px;font-size:12px;border:1px solid var(--c-border);border-radius:6px;font-family:inherit;text-align:center;" />'
            +   '<span style="font-size:11px;color:#666;">hours</span>'
            + '</div>'
            + '<span id="tb-dth-badge"></span>'
            + '<a href="#" id="tb-dth-promote" style="display:none;">\u2191 Apply to defaults</a>'
            + '</div>';
        })()
    +'</div>'

    + _tbSectionHead("Hard limits", "Optional but consequential. Things Max won\u2019t route around.")
    +'<div class="tb-field"><textarea id="tb-hardlimits" rows="2" placeholder="e.g. No car rentals. Vegetarian. Wheelchair access required." oninput="_tb.hardlimits=this.value;">'+((_tb.hardlimits||_defaultHardLimits())||"")+'</textarea></div>'

    + _tbSectionHead("Anything you\u2019d like to avoid?", "Optional. Soft preferences Max will weigh.")
    + _tbAvoidFieldHtml()

    // \u2500\u2500 Personal & medical \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4: same Settings-only fields surfaced in renderTripStep1Place.
    + _tbSectionHead("Personal & medical", "Optional. Carried into every trip \u2014 useful for restaurants, doctors, and re-booking.")
    +'<div class="tb-field"><label>Dietary restrictions</label>'
    +  '<input id="tb-dietary" type="text" value="'+(_tb.dietary||_defaultDietary()||"").replace(/"/g,"&quot;")+'" placeholder="e.g. vegetarian; tree-nut allergy" oninput="_tb.dietary=this.value;" />'
    +  '<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Affects restaurant suggestions.</div>'
    +'</div>'
    +'<div class="tb-field"><label>Languages you speak</label>'
    +  '<input id="tb-languages" type="text" value="'+(_tb.languages||_defaultLanguages()||"").replace(/"/g,"&quot;")+'" placeholder="e.g. English, conversational French" oninput="_tb.languages=this.value;" />'
    +  '<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Helps Max gauge how off-the-beaten-path is realistic.</div>'
    +'</div>'
    +'<div class="tb-field"><label>Allergies / medical</label>'
    +  '<input id="tb-allergies" type="text" value="'+(_tb.allergies||_defaultAllergies()||"").replace(/"/g,"&quot;")+'" placeholder="e.g. peanut, shellfish, penicillin" oninput="_tb.allergies=this.value;" />'
    +  '<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Severe enough to matter at a restaurant or hospital. Separate from general dietary preference above.</div>'
    +'</div>'
    +'<div class="tb-field"><label>Emergency contact</label>'
    +  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    +    '<input id="tb-emergency-name" type="text" value="'+(_tb.emergencyContactName||_defaultEmergencyName()||"").replace(/"/g,"&quot;")+'" placeholder="Name" oninput="_tb.emergencyContactName=this.value;" />'
    +    '<input id="tb-emergency-phone" type="tel" value="'+(_tb.emergencyContactPhone||_defaultEmergencyPhone()||"").replace(/"/g,"&quot;")+'" placeholder="Phone (with country code)" oninput="_tb.emergencyContactPhone=this.value;" />'
    +  '</div>'
    +  '<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Someone back home to reach in an emergency. Include the country code so it dials from anywhere.</div>'
    +'</div>'
    +'<div class="tb-field"><label>Loyalty programs</label>'
    +  '<textarea id="tb-loyalty" rows="3" placeholder="e.g. United MileagePlus 12345678&#10;Hilton Honors 87654321&#10;Hertz Gold 5555555" oninput="_tb.loyaltyPrograms=this.value;" style="resize:vertical;min-height:64px;">'+(_tb.loyaltyPrograms||_defaultLoyaltyPrograms()||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea>'
    +  '<div style="font-size:10.5px;color:#777;margin-top:6px;line-height:1.5;">Frequent-flyer numbers, hotel loyalty IDs, rental-car accounts. One per line. Useful when re-booking.</div>'
    +'</div>'

    // Close the Traveler Profile wrap.
    +'</div>'

    // \u2500\u2500 CONTEXT 3: FOR THE ROAD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // v360.4 (#124 follow-up): the operational sections that follow
    // (insurance / visa / documents / email import / checklist) are
    // trip-specific reference data \u2014 neither part of the trip's
    // shape (Trip Profile) nor cross-trip defaults (Traveler
    // Profile). They get their own context wrap with a neutral
    // grey left-border so the user can see "this is a different
    // kind of content" rather than hitting a wall of bare sections.
    +'<div style="margin:6px 0 22px;padding:14px 0 14px 18px;border-left:3px solid #888;">'
    +'<div style="margin-bottom:14px;">'
    +  '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#666;margin-bottom:2px;">Practical stuff for this trip</div>'
    +  '<div style="font-size:14px;font-weight:700;color:#222;">For the road</div>'
    +  '<div style="font-size:11.5px;color:#666;margin-top:3px;line-height:1.55;">Documents, reservations, reminders \u2014 things you want on hand for the trip itself.</div>'
    +'</div>'

    // v359.60.73: Travel insurance \u2014 optional structured fields for
    // reference info that doesn't shape Max's recommendations but the
    // user wants on hand. Persisted to trip.brief.insurance.
    + _tbSectionHead("Travel insurance", "Optional. Stored for reference.")
    +'<div class="tb-field"><label>Provider</label><input id="tb-ins-provider" value="'+((_tb.insurance&&_tb.insurance.provider)||"").replace(/"/g,"&quot;")+'" placeholder="e.g. Allianz, World Nomads, Travelex" oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.provider=this.value;" /></div>'
    +'<div class="tb-field"><label>Policy number</label><input id="tb-ins-policy" value="'+((_tb.insurance&&_tb.insurance.policyNumber)||"").replace(/"/g,"&quot;")+'" placeholder="" oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.policyNumber=this.value;" /></div>'
    +'<div class="tb-field" style="display:flex;gap:14px;flex-wrap:wrap;">'
    +'<div style="flex:1;min-width:160px;"><label>Coverage start</label><input id="tb-ins-start" type="date" value="'+((_tb.insurance&&_tb.insurance.coverageStart)||"")+'" oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.coverageStart=this.value;" /></div>'
    +'<div style="flex:1;min-width:160px;"><label>Coverage end</label><input id="tb-ins-end" type="date" value="'+((_tb.insurance&&_tb.insurance.coverageEnd)||"")+'" oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.coverageEnd=this.value;" /></div>'
    +'</div>'
    +'<div class="tb-field"><label>Emergency contact phone</label><input id="tb-ins-phone" type="tel" value="'+((_tb.insurance&&_tb.insurance.contactPhone)||"").replace(/"/g,"&quot;")+'" placeholder="e.g. +1 800 555 0100" oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.contactPhone=this.value;" /></div>'
    +'<div class="tb-field"><label>Notes</label><textarea id="tb-ins-notes" rows="2" placeholder="Coverage details, deductible, claim process, etc." oninput="if(!_tb.insurance)_tb.insurance={};_tb.insurance.notes=this.value;">'+((_tb.insurance&&_tb.insurance.notes)||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea></div>'

    // v359.60.73: Visa \u2014 optional. status enum + reference fields.
    // Persisted to trip.brief.visa. Different destinations may need
    // different visas; for now this is a single trip-level record. The
    // notes field is the catch-all for trips that span visa regimes.
    + _tbSectionHead("Visa", "Optional. Status and document details for reference.")
    + (function(){
        var status = (_tb.visa && _tb.visa.status) || "";
        var opts = [
          {id:"",            label:"\u2014 select \u2014"},
          {id:"not-needed",  label:"Not needed"},
          {id:"needed",      label:"Needed \u2014 not yet applied"},
          {id:"applied",     label:"Applied"},
          {id:"approved",    label:"Approved"},
          {id:"denied",      label:"Denied"}
        ];
        var optsHtml = opts.map(function(o){
          return '<option value="'+o.id+'"'+(status===o.id?' selected':'')+'>'+o.label+'</option>';
        }).join("");
        return '<div class="tb-field"><label>Status</label>'
          + '<select id="tb-visa-status" onchange="if(!_tb.visa)_tb.visa={};_tb.visa.status=this.value;">'+optsHtml+'</select>'
          + '</div>';
      })()
    +'<div class="tb-field"><label>Document / visa number</label><input id="tb-visa-doc" value="'+((_tb.visa&&_tb.visa.documentNumber)||"").replace(/"/g,"&quot;")+'" oninput="if(!_tb.visa)_tb.visa={};_tb.visa.documentNumber=this.value;" /></div>'
    +'<div class="tb-field"><label>Valid through</label><input id="tb-visa-validthrough" type="date" value="'+((_tb.visa&&_tb.visa.validThrough)||"")+'" oninput="if(!_tb.visa)_tb.visa={};_tb.visa.validThrough=this.value;" /></div>'
    +'<div class="tb-field"><label>Notes</label><textarea id="tb-visa-notes" rows="2" placeholder="Multiple visas, appointment dates, country-specific requirements, etc." oninput="if(!_tb.visa)_tb.visa={};_tb.visa.notes=this.value;">'+((_tb.visa&&_tb.visa.notes)||"").replace(/</g,"&lt;").replace(/>/g,"&gt;")+'</textarea></div>'

    // v359.60.75: Trip documents — base64-encoded file attachments.
    // Passport scans, vaccination records, insurance PDFs, etc.
    // Reordered v360.0.0 to immediately follow Travel insurance + Visa
    // (the other "official documents" items) so the document-y stuff
    // stays grouped together.
    + _tbSectionHead("Trip documents", "Optional. Passport scans, vaccination records, confirmation PDFs.")
    + '<div class="tb-field"><div id="tb-documents-mount"></div></div>'

    // v360.0.0: Email import follows Trip documents — both are about
    // pulling external content into your trip. The forwarding-address
    // section + unassigned-bookings tray live in this mount.
    + _tbSectionHead("Email import", "Forward booking confirmations to this address — they'll auto-attach.")
    + '<div class="tb-field"><div id="tb-inbox-mount"></div></div>'

    // v359.60.75: Pre-trip checklist — structured array of {id, text,
    // done}. Distinct from "Keep in mind" freeform notes; this is a
    // proper task list with checkboxes that survive across sessions.
    // Mount point only — the dynamic list is rendered by
    // _mountChecklistSection() after innerHTML is set.
    + _tbSectionHead("Pre-trip checklist", "Optional. Things to do, buy, or arrange before you go.")
    + '<div class="tb-field"><div id="tb-checklist-mount"></div></div>'

    // Close the For the road wrap.
    +'</div>'

    +'</div>'
    +'<div class="tb-footer">'
    +'<button class="tb-btn-primary" onclick="previewConstraintChanges()">Preview changes \u2192</button>'
    +'<div style="display:flex;justify-content:space-between;margin-top:8px;">'
    +'<div class="tb-btn-back" onclick="cancelEditConstraints()">\u2190 Cancel</div>'
    +'</div>'
    +'</div>';
  // v359.60.75: mount the dynamic checklist + documents sections
  // after innerHTML is set. Each section manages its own DOM state
  // (add/check/delete for checklist; upload/download/delete for
  // documents) so the rest of the form's oninput pattern stays
  // unaffected.
  setTimeout(function(){
    if (typeof _mountChecklistSection === "function") _mountChecklistSection("tb-checklist-mount");
    if (typeof _mountDocumentsSection === "function") _mountDocumentsSection("tb-documents-mount");
    if (typeof _mountInboxSection === "function") _mountInboxSection("tb-inbox-mount");
    // v360.4: wire badges + Apply-to-defaults links on the Traveler
    // Profile fields. Same module-scope helper renderTripStep1Place
    // uses, so both editors now share identical dynamic-badge UX.
    if (typeof _tbSetupShapeBadges === "function") _tbSetupShapeBadges();
  }, 0);
}

// v359.60.75: pre-trip checklist mount. Reads/writes _tb.checklist[],
// each item {id, text, done}. Re-renders in place when items are
// added, toggled, or removed. Applied via applyConstraintChanges.
function _mountChecklistSection(mountId){
  var mount = document.getElementById(mountId);
  if (!mount) return;
  if (!Array.isArray(_tb.checklist)) _tb.checklist = [];
  mount.innerHTML = "";
  var listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-bottom:8px;";
  mount.appendChild(listEl);
  function _renderList(){
    listEl.innerHTML = "";
    if (!_tb.checklist.length) {
      var emp = document.createElement("div");
      emp.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:6px 0;";
      emp.textContent = "Nothing yet. Add an item below.";
      listEl.appendChild(emp);
      return;
    }
    _tb.checklist.forEach(function(item, idx){
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:5px 8px;background:"+(item.done?"#f4faf4":"#fff")+";border:1px solid #e0e0e0;border-radius:5px;";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = !!item.done;
      cb.style.cssText = "margin:0;flex-shrink:0;";
      cb.onchange = function(){ item.done = cb.checked; _renderList(); };
      var txt = document.createElement("input");
      txt.type = "text"; txt.value = item.text || "";
      txt.style.cssText = "flex:1;font-size:12.5px;padding:4px 6px;border:none;background:transparent;font-family:inherit;color:"+(item.done?"#888":"#222")+";text-decoration:"+(item.done?"line-through":"none")+";min-width:0;";
      txt.oninput = function(){ item.text = txt.value; };
      var del = document.createElement("button");
      del.type = "button"; del.textContent = "\u00d7";
      del.title = "Remove";
      del.style.cssText = "background:none;border:none;color:#bbb;cursor:pointer;font-size:16px;padding:0 6px;line-height:1;flex-shrink:0;font-family:inherit;";
      del.onmouseover = function(){ del.style.color = "#c05020"; };
      del.onmouseout = function(){ del.style.color = "#bbb"; };
      del.onclick = function(){ _tb.checklist.splice(idx, 1); _renderList(); };
      row.appendChild(cb); row.appendChild(txt); row.appendChild(del);
      listEl.appendChild(row);
    });
  }
  _renderList();
  var addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:6px;";
  var addInp = document.createElement("input");
  addInp.type = "text";
  addInp.placeholder = "e.g. Refill prescription, confirm pet sitter, buy adapter\u2026";
  addInp.style.cssText = "flex:1;font-size:12.5px;padding:6px 9px;border:1px solid var(--c-border-strong);border-radius:5px;font-family:inherit;box-sizing:border-box;";
  var addBtn = document.createElement("button");
  addBtn.type = "button"; addBtn.textContent = "+ Add";
  addBtn.style.cssText = "font-size:12px;font-weight:600;padding:6px 12px;border:1px solid var(--c-primary);background:var(--c-bg);color:var(--c-primary);border-radius:5px;cursor:pointer;font-family:inherit;flex-shrink:0;";
  function _doAdd(){
    var v = addInp.value.trim();
    if (!v) return;
    _tb.checklist.push({ id: "ck-" + Date.now() + "-" + Math.floor(Math.random()*1000), text: v, done: false });
    addInp.value = "";
    _renderList();
    addInp.focus();
  }
  addBtn.onclick = _doAdd;
  addInp.onkeydown = function(e){ if (e.key === "Enter") _doAdd(); };
  addRow.appendChild(addInp); addRow.appendChild(addBtn);
  mount.appendChild(addRow);
}

// v359.60.75: document attachments mount. Reads/writes _tb.documents[],
// each item {id, name, type, size, dataUrl, addedAt}. Files are
// stored as base64 data URLs in the trip object (which goes through
// localStorage + sync). Soft cap at 3 MB total to keep the trip
// payload reasonable.
// v360.0.0 — Phase 2 email auto-import UI. Renders two sub-sections:
//
// 1. Forwarding address: shows the user's unique address (minted
//    server-side on first GET), copy button, and a "Last forwarded
//    email: …" freshness indicator.
//
// 2. Unassigned bookings tray: parsed emails the auto-attacher
//    couldn't place (no date match, no destination match, etc.).
//    Each entry shows a summary + Attach button (attaches to the
//    current trip; for destination-anchored types like hotels, a
//    second dropdown picks the destination). Dismiss button on
//    each entry for spam / mis-classifications.
//
// Both sections fetch state lazily on mount. No local caching —
// the user opens this section rarely and the data isn't large.
function _mountInboxSection(mountId){
  var mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = '<div style="font-size:11px;color:var(--c-ink-3);font-style:italic;">Loading your forwarding inbox…</div>';
  if (typeof MaxSync === "undefined" || !MaxSync._request) {
    mount.innerHTML = '<div style="font-size:11px;color:#c44;">Sign in required.</div>';
    return;
  }
  // MaxSync._request returns parsed JSON directly and throws on
  // non-ok responses. No need to deal with the Response object.
  // v360.0.0 update: the unassigned-bookings tray moved to the
  // trip view's Trip-bookings section where users actually look
  // (Profile is for trip-meta editing, not booking management).
  // This mount only renders the forwarding address + freshness
  // indicator now.
  MaxSync._request('/user/inbox')
    .then(function(data){
      _renderInboxAddress(mount, data);
    })
    .catch(function(e){
      console.warn('[inbox] mount failed:', e);
      var msg = (e && e.message) || "Couldn't load your inbox.";
      mount.innerHTML = '<div style="font-size:11px;color:#c44;">' + msg.replace(/</g,"&lt;") + '</div>';
    });
}

function _renderInboxAddress(mount, data){
  mount.innerHTML = "";
  var box = document.createElement("div");
  box.style.cssText = "padding:10px 12px;background:#f5f8fc;border:1px solid #d4e0f0;border-radius:6px;margin-bottom:10px;";

  var ttl = document.createElement("div");
  ttl.style.cssText = "font-size:10.5px;font-weight:700;color:var(--c-primary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;";
  ttl.textContent = "Your forwarding address";
  box.appendChild(ttl);

  var addrRow = document.createElement("div");
  addrRow.style.cssText = "display:flex;gap:6px;align-items:stretch;margin-bottom:6px;";
  var addrInput = document.createElement("input");
  addrInput.type = "text";
  addrInput.readOnly = true;
  addrInput.value = data.address || "";
  addrInput.style.cssText = "flex:1;padding:7px 9px;font-size:12px;font-family:monospace;border:1px solid var(--c-border-strong);border-radius:4px;background:var(--c-bg);";
  var copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "📋 Copy";
  copyBtn.style.cssText = "padding:0 12px;font-size:11.5px;font-weight:600;background:var(--c-primary);color:var(--c-on-dark);border:none;border-radius:4px;cursor:pointer;flex-shrink:0;";
  copyBtn.onclick = function(){
    addrInput.select();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addrInput.value);
      } else {
        document.execCommand('copy');
      }
      copyBtn.textContent = "✓ Copied";
      setTimeout(function(){ copyBtn.textContent = "📋 Copy"; }, 1500);
    } catch(_) {}
  };
  addrRow.appendChild(addrInput);
  addrRow.appendChild(copyBtn);
  box.appendChild(addrRow);

  // v360.0.0: explanatory copy ("Forward booking confirmations...
  // they'll auto-attach to a matching trip") moved out of here.
  // The Profile is for trip-meta — this section just needs the
  // address + copy + freshness. Discoverability of the forwarding
  // feature lives on the Bookings surface (task #101).

  if (data.lastReceivedAt) {
    var ago = _fmtAgo(data.lastReceivedAt);
    var fresh = document.createElement("div");
    fresh.style.cssText = "font-size:10.5px;color:var(--c-see);margin-top:6px;";
    fresh.textContent = "✓ Last forwarded email received " + ago;
    box.appendChild(fresh);
  }

  // v360.0.2: spam-filter heads-up. Some outbound mail providers
  // (SiteGround, certain corporate mail servers) flag forwards to
  // unfamiliar domains as spam and refuse to send — the user never
  // sees their email arrive here because it didn't leave their
  // outbox. Telling them this upfront beats them debugging it cold.
  var providerWarn = document.createElement("details");
  providerWarn.style.cssText = "margin-top:8px;font-size:10.5px;color:#5c4520;";
  providerWarn.innerHTML =
    '<summary style="cursor:pointer;color:#a06d00;">Forwards getting bounced as spam?</summary>' +
    '<div style="margin-top:6px;padding:8px 10px;background:#fff8ed;border:1px solid #f0dcc0;border-radius:5px;line-height:1.55;">' +
      'Some email providers (e.g. SiteGround, some corporate mail) have aggressive outbound spam filtering ' +
      'and refuse to forward to unfamiliar domains. If your forward bounces with "<i>high probability of spam</i>," ' +
      'send from a personal Gmail, iCloud, Outlook, or Yahoo account instead — those have lenient outbound rules. ' +
      'The booking content is the same; only the sending account changes.' +
    '</div>';
  box.appendChild(providerWarn);

  // Tray placeholder — _renderUnassignedTray writes into this.
  var trayHost = document.createElement("div");
  trayHost.id = "tb-inbox-tray";
  box.appendChild(trayHost);

  mount.appendChild(box);
}

function _fmtAgo(ms){
  var diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.round(diff / 60000) + " minute" + (diff < 120000 ? "" : "s") + " ago";
  if (diff < 86400000) return Math.round(diff / 3600000) + " hour" + (diff < 7200000 ? "" : "s") + " ago";
  return Math.round(diff / 86400000) + " day" + (diff < 172800000 ? "" : "s") + " ago";
}

function _renderUnassignedTray(mount, items){
  var tray = mount.querySelector('#tb-inbox-tray');
  if (!tray) return;
  tray.innerHTML = "";
  if (!items.length) return;

  var hdr = document.createElement("div");
  hdr.style.cssText = "font-size:10.5px;font-weight:700;color:#a06d00;text-transform:uppercase;letter-spacing:0.04em;margin-top:12px;margin-bottom:6px;";
  hdr.textContent = "Unassigned bookings (" + items.length + ")";
  tray.appendChild(hdr);

  var sub = document.createElement("div");
  sub.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-bottom:8px;";
  sub.textContent = "These parsed successfully but Max couldn't auto-match a trip. Pick a destination (when needed), then Attach.";
  tray.appendChild(sub);

  items.forEach(function(it){
    var row = document.createElement("div");
    row.style.cssText = "padding:8px 10px;margin:5px 0;background:var(--c-bg);border:1px solid #e0d8c8;border-radius:5px;font-size:11.5px;line-height:1.5;";

    var p = it.parsed || {};
    var icon = (p.type === "car") ? "🚗" : (p.type === "flight") ? "✈" : (p.type === "hotel") ? "🏨" : "📋";
    var head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px;";
    var headL = document.createElement("div");
    headL.style.cssText = "font-weight:600;color:#444;";
    var summary = icon + " " + (p.type || "booking");
    if (p.carrier || p.name) summary += " · " + (p.carrier || p.name);
    headL.textContent = summary;
    var headR = document.createElement("div");
    headR.style.cssText = "font-size:10px;color:#999;";
    headR.textContent = "from " + (it.from || "?");
    head.appendChild(headL);
    head.appendChild(headR);
    row.appendChild(head);

    if (p.depDate || p.confirmationNumber) {
      var meta = document.createElement("div");
      meta.style.cssText = "font-size:10.5px;color:#666;margin-bottom:6px;";
      var bits = [];
      if (p.depDate) bits.push(p.depDate + (p.arrDate ? " → " + p.arrDate : ""));
      if (p.confirmationNumber) bits.push("Conf " + p.confirmationNumber);
      if (p.price != null) bits.push((p.currency || "") + " " + p.price);
      meta.textContent = bits.join(" · ");
      row.appendChild(meta);
    }

    // Destination picker only for hotel + generalBookings types.
    var needsDest = (p.type !== "car" && p.type !== "flight");
    var destSel = null;
    var localTrip = (typeof trip !== "undefined" && trip) ? trip : null;
    if (needsDest && localTrip && Array.isArray(localTrip.destinations)) {
      destSel = document.createElement("select");
      destSel.style.cssText = "width:100%;padding:5px 8px;font-size:11.5px;border:1px solid var(--c-border-strong);border-radius:4px;background:var(--c-bg);margin-bottom:6px;";
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "Pick a destination on " + (localTrip.name || "this trip") + "…";
      destSel.appendChild(opt0);
      localTrip.destinations.forEach(function(d){
        var o = document.createElement("option");
        o.value = d.id;
        var dateStr = d.dateFrom ? " (" + d.dateFrom + (d.dateTo && d.dateTo !== d.dateFrom ? " → " + d.dateTo : "") + ")" : "";
        o.textContent = (d.place || d.label || "Untitled") + dateStr;
        destSel.appendChild(o);
      });
      row.appendChild(destSel);
    }

    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    var attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.textContent = "✓ Attach to trip";
    attachBtn.style.cssText = "padding:5px 12px;font-size:11.5px;font-weight:600;background:var(--c-see);color:var(--c-on-dark);border:none;border-radius:4px;cursor:pointer;";
    var dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "✕ Dismiss";
    dismissBtn.style.cssText = "padding:5px 12px;font-size:11.5px;background:var(--c-bg);color:#666;border:1px solid var(--c-border);border-radius:4px;cursor:pointer;";

    (function(id, pType){
      attachBtn.onclick = function(){
        if (!localTrip || !localTrip.id) {
          maxAlert("Open a trip first so Max knows where to attach this booking.");
          return;
        }
        var destId = destSel ? destSel.value : "";
        if (needsDest && !destId) {
          maxAlert("Pick a destination first.");
          return;
        }
        attachBtn.disabled = true;
        attachBtn.textContent = "Attaching…";
        var payload = { tripId: localTrip.id };
        if (destId) payload.destinationId = destId;
        MaxSync._request('/user/unassigned-bookings/' + encodeURIComponent(id) + '/attach', {
          method: 'POST',
          body: payload,
        })
          .then(function(){
            row.style.opacity = "0.4";
            row.innerHTML = '<div style="text-align:center;font-size:11px;color:var(--c-see);">✓ Attached. Refresh the trip to see it.</div>';
            // Trigger a fresh sync so the trip body updates locally.
            if (MaxSync.pullAll) try { MaxSync.pullAll(); } catch(_){}
          })
          .catch(function(e){
            console.warn('[inbox] attach failed:', e);
            attachBtn.disabled = false;
            attachBtn.textContent = "✓ Attach to trip";
            maxAlert("Attach failed. " + ((e && e.message) || ""));
          });
      };
      dismissBtn.onclick = function(){
        if (!global.confirm || global.confirm("Dismiss this booking? You won't see it again.")) {
          MaxSync._request('/user/unassigned-bookings/' + encodeURIComponent(id) + '/dismiss', {
            method: 'POST',
          })
            .then(function(){
              row.parentNode.removeChild(row);
            })
            .catch(function(e){ console.warn('[inbox] dismiss failed:', e); });
        }
      };
    })(it.id, p.type);

    btnRow.appendChild(dismissBtn);
    btnRow.appendChild(attachBtn);
    row.appendChild(btnRow);
    tray.appendChild(row);
  });
}

function _mountDocumentsSection(mountId){
  var mount = document.getElementById(mountId);
  if (!mount) return;
  if (!Array.isArray(_tb.documents)) _tb.documents = [];
  mount.innerHTML = "";
  var listEl = document.createElement("div");
  listEl.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-bottom:8px;";
  mount.appendChild(listEl);
  function _fmtBytes(n){
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n/1024).toFixed(1) + " KB";
    return (n/1048576).toFixed(1) + " MB";
  }
  function _totalBytes(){
    return _tb.documents.reduce(function(s, d){ return s + (d.size||0); }, 0);
  }
  function _renderList(){
    listEl.innerHTML = "";
    if (!_tb.documents.length) {
      var emp = document.createElement("div");
      emp.style.cssText = "font-size:11.5px;color:#999;font-style:italic;padding:6px 0;";
      emp.textContent = "No documents attached. Use the upload button below.";
      listEl.appendChild(emp);
      return;
    }
    _tb.documents.forEach(function(doc, idx){
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--c-panel);border:1px solid #e0e0e0;border-radius:5px;";
      var icon = document.createElement("span");
      icon.style.cssText = "font-size:16px;flex-shrink:0;";
      icon.textContent = doc.type && doc.type.indexOf("image") === 0 ? "\ud83d\uddbc" : doc.type && doc.type.indexOf("pdf") >= 0 ? "\ud83d\udcc4" : "\ud83d\udcce";
      var meta = document.createElement("div");
      meta.style.cssText = "flex:1;min-width:0;";
      var nm = document.createElement("div");
      nm.style.cssText = "font-size:12.5px;font-weight:600;color:#222;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      nm.textContent = doc.name || "Document";
      var sub = document.createElement("div");
      sub.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-top:1px;";
      sub.textContent = _fmtBytes(doc.size||0);
      meta.appendChild(nm); meta.appendChild(sub);
      var view = document.createElement("a");
      view.href = doc.dataUrl; view.target = "_blank"; view.rel = "noopener noreferrer"; view.download = doc.name;
      view.textContent = "View";
      view.style.cssText = "font-size:11px;font-weight:600;color:var(--c-primary);text-decoration:none;padding:3px 8px;border:1px solid var(--c-border-blue);border-radius:5px;flex-shrink:0;";
      var del = document.createElement("button");
      del.type = "button"; del.textContent = "\u00d7";
      del.title = "Remove";
      del.style.cssText = "background:none;border:none;color:#bbb;cursor:pointer;font-size:16px;padding:0 6px;line-height:1;flex-shrink:0;font-family:inherit;";
      del.onmouseover = function(){ del.style.color = "#c05020"; };
      del.onmouseout = function(){ del.style.color = "#bbb"; };
      del.onclick = function(){
        if (!confirm("Remove " + (doc.name||"this document") + " from this trip?")) return;
        _tb.documents.splice(idx, 1);
        _renderList();
      };
      row.appendChild(icon); row.appendChild(meta); row.appendChild(view); row.appendChild(del);
      listEl.appendChild(row);
    });
    var sizeLine = document.createElement("div");
    sizeLine.style.cssText = "font-size:10.5px;color:var(--c-ink-3);margin-top:4px;text-align:right;";
    sizeLine.textContent = "Total: " + _fmtBytes(_totalBytes());
    listEl.appendChild(sizeLine);
  }
  _renderList();
  // v359.60.76: shared file-list processor. Used by both the regular
  // file picker AND the camera-capture input below so they go through
  // the same size-check + base64 + push path.
  function _processFiles(files, clearFn){
    if (!files || !files.length) return;
    var totalAfter = _totalBytes() + files.reduce(function(s, f){ return s + f.size; }, 0);
    if (totalAfter > 3 * 1048576) {
      if (!confirm("Attaching these files would push total documents over 3 MB (" + _fmtBytes(totalAfter) + "). Large attachments slow down trip syncing. Continue?")) {
        if (clearFn) clearFn(); return;
      }
    }
    var pending = files.length;
    files.forEach(function(f){
      var reader = new FileReader();
      reader.onload = function(){
        _tb.documents.push({
          id: "doc-" + Date.now() + "-" + Math.floor(Math.random()*10000),
          name: f.name,
          type: f.type || "",
          size: f.size || 0,
          dataUrl: reader.result,
          addedAt: new Date().toISOString()
        });
        pending--;
        if (pending === 0) { _renderList(); if (clearFn) clearFn(); }
      };
      reader.onerror = function(){
        pending--;
        if (pending === 0) { _renderList(); if (clearFn) clearFn(); }
      };
      reader.readAsDataURL(f);
    });
  }
  var addRow = document.createElement("div");
  addRow.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";
  var fileInp = document.createElement("input");
  fileInp.type = "file";
  fileInp.multiple = true;
  fileInp.style.cssText = "flex:1;min-width:140px;font-size:12px;font-family:inherit;";
  fileInp.onchange = function(){
    _processFiles(Array.from(fileInp.files || []), function(){ fileInp.value = ""; });
  };
  addRow.appendChild(fileInp);
  // v359.60.76: camera-capture button. Hidden input with
  // capture="environment" opens the rear camera directly on mobile.
  // Desktop browsers fall back to a normal file picker; harmless.
  var camWrap = document.createElement("label");
  camWrap.style.cssText = "font-size:12px;font-weight:600;padding:6px 12px;border:1px solid var(--c-primary);background:var(--c-bg);color:var(--c-primary);border-radius:5px;cursor:pointer;font-family:inherit;flex-shrink:0;display:inline-flex;align-items:center;gap:5px;";
  camWrap.textContent = "📷 Take photo";
  camWrap.title = "Snap a photo of a passport, visa, or confirmation — opens the camera on mobile";
  var camInp = document.createElement("input");
  camInp.type = "file";
  camInp.accept = "image/*";
  camInp.setAttribute("capture", "environment");
  camInp.style.display = "none";
  camInp.onchange = function(){
    _processFiles(Array.from(camInp.files || []), function(){ camInp.value = ""; });
  };
  camWrap.appendChild(camInp);
  addRow.appendChild(camWrap);
  mount.appendChild(addRow);
}

function cancelEditConstraints(){
  // Restore snapshot, close overlay
  if(_tb._snapshot){ Object.assign(_tb, _tb._snapshot); }
  _tb._editMode = false;
  g("trip-brief-overlay").style.display="none";
}

async function previewConstraintChanges(){
  _tbCaptureAvoid();
  _tbCaptureDates();
  // Read new values
  var nw = {
    region:        g("tb-region")        ? g("tb-region").value.trim()        : (_tb.region||""),
    duration:      g("tb-duration")      ? g("tb-duration").value.trim()      : (_tb.duration||""),
    when:          g("tb-when")          ? g("tb-when").value.trim()          : (_tb.when||""),
    gettingTo:     g("tb-gettingTo")     ? g("tb-gettingTo").value.trim()     : (_tb.gettingTo||""),
    gettingOut:    g("tb-gettingOut")    ? g("tb-gettingOut").value.trim()    : (_tb.gettingOut||""),
    entry:         g("tb-entry")         ? g("tb-entry").value.trim()         : (_tb.entry||""),
    tbExit:        g("tb-exit")          ? g("tb-exit").value.trim()          : (_tb.tbExit||""),
    entryFixed:    !!_tb.entryFixed,
    exitFixed:     !!_tb.exitFixed,
    transport:     g("tb-transport")     ? g("tb-transport").value.trim()     : (_tb.transport||""),
    accommodation: g("tb-accommodation") ? g("tb-accommodation").value.trim() : (_tb.accommodation||""),
    hardlimits:    g("tb-hardlimits")    ? g("tb-hardlimits").value.trim()    : (_tb.hardlimits||""),
    travelersCount: g("tb-travelers-count") ? g("tb-travelers-count").value.trim() : (_tb.travelersCount||""),
    withKids:       g("tb-with-kids") ? !!g("tb-with-kids").checked : !!_tb.withKids,
    aboutTrip:      g("tb-about-trip") ? g("tb-about-trip").value.trim() : (_tb.aboutTrip||""),
    // v302: structured pace fields. Same min/max clamp as goToTripStep2.
    hoursPerDay:        g("tb-hours-per-day") ? Math.max(1, Math.min(12, parseInt(g("tb-hours-per-day").value, 10) || _defaultHoursPerDay())) : (_tb.hoursPerDay || _defaultHoursPerDay()),
    maxBigSightsPerDay: g("tb-max-big-sights") ? Math.max(1, Math.min(6,  parseInt(g("tb-max-big-sights").value, 10) || _defaultMaxBigSightsPerDay())) : (_tb.maxBigSightsPerDay || _defaultMaxBigSightsPerDay()),
    // v306: mobility chips + note. _tb.physicalAbility is mutated by
    // _tbPickAbility on chip click; the note has its own oninput.
    physicalAbility:    _tb.physicalAbility || "",
    abilityNote:        g("tb-ability-note") ? g("tb-ability-note").value.trim() : (_tb.abilityNote||""),
    avoidSummary:     _tbAvoidSummary(),
    avoidOther:       _tb.avoidOther||"",
    entryMode:        _tb.entryMode||"",
    exitMode:         _tb.exitMode||"",
    // v359.60.73: read insurance + visa back from _tb. The oninput
    // handlers wrote to _tb.insurance and _tb.visa directly as the
    // user typed, so the live state is already canonical — read it
    // back into pending for the snapshot diff comparison.
    insurance:        _tb.insurance ? Object.assign({}, _tb.insurance) : null,
    visa:             _tb.visa ? Object.assign({}, _tb.visa) : null,
    // v359.60.75: checklist + documents — the mount functions write
    // directly to _tb arrays, so deep-copy them here.
    checklist:        _tb.checklist ? JSON.parse(JSON.stringify(_tb.checklist)) : [],
    documents:        _tb.documents ? JSON.parse(JSON.stringify(_tb.documents)) : []
    // Round FQ: betweenMode dropped — pill removed from Step 2.
  };
  var snap = _tb._snapshot || {};

  // Build diff
  var labels = {
    region:"Destination scope", duration:"Duration", when:"When",
    entry:"Arrival point", tbExit:"Departure point",
    entryMode:"Arrival mode", exitMode:"Departure mode",
    entryFixed:"Arrival (fixed vs flexible)", exitFixed:"Departure (fixed vs flexible)",
    transport:"Transport", accommodation:"Accommodation",
    hardlimits:"Hard limits",
    travelersCount:"Number of travelers",
    withKids:"Traveling with kids?",
    aboutTrip:"About this trip",
    avoidSummary:"Avoidances", avoidOther:"Other avoidances"
  };
  var diffs = [];
  Object.keys(labels).forEach(function(k){
    var ov = (k==="entryFixed"||k==="exitFixed") ? (snap[k]?"Fixed":"Flexible")
           : (k==="withKids") ? (snap[k]?"Yes":"No")
           : (snap[k]||"");
    var nv = (k==="entryFixed"||k==="exitFixed") ? (nw[k]?"Fixed":"Flexible")
           : (k==="withKids") ? (nw[k]?"Yes":"No")
           : (nw[k]||"");
    if(ov !== nv) diffs.push({field:labels[k], from:ov||"(not set)", to:nv||"(not set)"});
  });

  if(diffs.length === 0){
    cancelEditConstraints();
    return;
  }

  // Store pending changes
  _tb._pending = nw;

  // Show loading state
  var ov = g("trip-brief-overlay");
  ov.innerHTML = '<div class="tb-overlay-inner" style="padding:32px 28px;text-align:center;">'
    +'<div style="font-size:13px;font-weight:600;margin-bottom:8px;">Analysing changes\u2026</div>'
    +'<div style="font-size:11px;color:var(--c-ink-4);">Max is working out what needs to be revisited.</div>'
    +'</div>';

  // Build trip context summary — include booking counts so Max can flag invalidations
  var destNames = (trip.destinations||[]).map(function(d){ return d.city+(d.country?", "+d.country:""); }).join("; ");
  var destList = (trip.destinations||[]).map(function(d, i){
    var bookCount = (d.hotelBookings||[]).length + (d.generalBookings||[]).length;
    return (i+1) + ". " + d.place + (d.dateFrom ? " (" + d.dateFrom + " to " + d.dateTo + ")" : "") + (bookCount ? " \u2014 " + bookCount + " booking(s)" : "");
  }).join("\n");
  var totalBookings = (trip.destinations||[]).reduce(function(s, d){ return s + (d.hotelBookings||[]).length + (d.generalBookings||[]).length; }, 0);
  var diffText = diffs.map(function(d){ return d.field+": \u201c"+d.from+"\u201d \u2192 \u201c"+d.to+"\u201d"; }).join("\n");

  // PD.112: include the user's listed places + Discovery state in
  // the impact prompt. Without this, a user mid-Discovery (44 places
  // listed, no destinations published yet) got generic prose because
  // the prompt's only context was "no destinations". Now the LLM can
  // evaluate the change against actual intent.
  var listedSnippet = "";
  try {
    var lst = (trip && trip.brief && trip.brief._userListedNames)
      || (typeof _tb !== "undefined" && _tb && _tb._userListedNames)
      || null;
    if (lst) {
      var listedNames = Object.keys(lst);
      if (listedNames.length) {
        var sample = listedNames.slice(0, 60);
        listedSnippet = "\nThe traveler's paste-list / Discovery starting points:\n" + sample.join(", ")
          + (listedNames.length > sample.length ? "\n(+" + (listedNames.length - sample.length) + " more)" : "")
          + "\n";
      }
    }
  } catch(_){}
  var discoverySnippet = "";
  try {
    var candCount = (typeof _tb !== "undefined" && _tb && Array.isArray(_tb.candidates)) ? _tb.candidates.length : 0;
    var keptCount = (typeof _tb !== "undefined" && _tb && Array.isArray(_tb.placeActivities))
      ? _tb.placeActivities.reduce(function(s, it){
          return s + ((it.requiredPlaces||[]).filter(function(p){ return p && p._keep; }).length);
        }, 0)
      : 0;
    if (candCount || keptCount) {
      discoverySnippet = "\nDiscovery state: " + candCount + " candidate place(s), " + keptCount + " currently kept.\n";
    }
  } catch(_){}

  // Whether this change is likely to force a trip-order rebuild
  var affectsOrder = diffs.some(function(d){
    return d.field === "Arrival point" || d.field === "Departure point";
  });

  var prompt = "A traveler is updating their trip constraints mid-planning. Here are the changes they made:\n\n"
    + diffText + "\n\n"
    + "Current trip order:\n" + (destList||"(no destinations yet)") + "\n"
    + listedSnippet
    + discoverySnippet
    + (totalBookings > 0 ? "\nThe traveler has " + totalBookings + " booking(s) already entered. " : "")
    + (affectsOrder ? "IMPORTANT: changing arrival or departure will re-sequence destinations and reassign dates. Call out any bookings whose dates or locations may no longer match.\n" : "")
    + "Trip name: " + (trip.name||"") + "\n\n"
    + "Analyse the impact of these changes on the current trip. Consider both committed destinations and the traveler's stated intent (their listed places + Discovery state). Be specific and concrete:\n"
    + "- Which destinations or plans are directly affected?\n"
    + "- What are definite conflicts (things that must change \u2014 bookings, dates, routes)?\n"
    + "- What are flags worth checking (things that may need revisiting)?\n"
    + "- What stays fine as-is?\n\n"
    + "Be brief and direct. Use plain language, no bullet-point headers. 3\u20135 short paragraphs maximum. "
    + "End with a single sentence summarising whether the changes are minor or require significant replanning.";

  var analysis = "";
  try {
    analysis = await callMax([{role:"user", content:prompt}], 600);
  } catch(e) {
    analysis = "Could not reach Max to analyse changes. You can still apply them manually.";
  }

  showConstraintConfirmation(diffs, analysis, nw);
}

function showConstraintConfirmation(diffs, analysis, pendingValues){
  var ov = g("trip-brief-overlay");
  var diffHtml = diffs.map(function(d){
    return '<div style="margin-bottom:8px;">'
      +'<div style="font-size:10px;font-weight:600;color:var(--c-ink-2);text-transform:uppercase;letter-spacing:0.05em;">'+d.field+'</div>'
      +'<div style="font-size:11px;color:#999;text-decoration:line-through;">'+d.from+'</div>'
      +'<div style="font-size:11px;color:var(--c-ink);">'+d.to+'</div>'
      +'</div>';
  }).join("");

  ov.innerHTML = '<div class="tb-header">'
    +'<div class="tb-logo"><div class="tb-logo-m">M</div><div><div style="font-size:12px;font-weight:700;">Max</div><div class="tb-step">Review changes</div></div></div>'
    +'<div class="tb-title">Here\u2019s what changes</div>'
    +'<div class="tb-sub">Review Max\u2019s analysis before confirming.</div>'
    +'</div>'
    +'<div class="tb-body">'
    +'<div style="background:#f7f7f7;border-radius:7px;padding:14px 16px;margin-bottom:16px;">'+diffHtml+'</div>'
    +'<div style="font-size:12px;line-height:1.7;color:#333;white-space:pre-wrap;border-left:3px solid var(--c-border);padding-left:14px;max-height:55vh;overflow-y:auto;-webkit-overflow-scrolling:touch;">'+analysis+'</div>'
    +'</div>'
    +'<div class="tb-footer">'
    +'<button class="tb-btn-primary" onclick="applyConstraintChanges()">Yes, apply these changes</button>'
    +'<div class="tb-btn-back" style="margin-top:10px;" onclick="renderTripBriefEdit()">\u2190 Go back and edit</div>'
    +'</div>';
}

function applyConstraintChanges(){
  var p = _tb._pending;
  if(!p) return;
  var snap = _tb._snapshot || {};
  // Detect whether this change affects trip ordering (entry or exit changed)
  var orderAffected = (p.entry || "") !== (snap.entry || "")
                   || (p.tbExit || "") !== (snap.tbExit || "");
  // Round EW.2: also detect duration changes so we can re-evaluate
  // the over-budget banner when the user fixes the budget through
  // Parameters instead of the banner's Extend button.
  var durationChanged = (typeof p.duration !== "undefined") && ((p.duration || "") !== (snap.duration || ""));
  Object.assign(_tb, p);
  // If the user set an explicit entry, clear the "Max inferred this" marker
  if (p.entry && p.entry !== (snap.entry || "")) {
    _tb.entryInferred = false;
    if (trip.brief) trip.brief.entryInferred = false;
  }
  // Mirror relevant changes onto trip.brief so saved state stays consistent
  if (trip.brief) {
    if (typeof p.entry !== "undefined") trip.brief.entry = p.entry;
    if (typeof p.tbExit !== "undefined") trip.brief.exit = p.tbExit;
    if (typeof p.gettingTo !== "undefined") trip.brief.gettingTo = p.gettingTo;
    if (typeof p.gettingOut !== "undefined") trip.brief.gettingOut = p.gettingOut;
    if (typeof p.transport !== "undefined") trip.brief.transport = p.transport;
    // v360.0.0: travelersCount + withKids were being lost on apply —
    // the form input writes _tb.travelersCount, but the trip's
    // canonical storage is trip.brief.partySize. Without this mirror,
    // every Apply would silently drop the value and the next Preview
    // would show the same "(not set) → 2" false-positive forever.
    if (typeof p.travelersCount !== "undefined") trip.brief.partySize = p.travelersCount;
    if (typeof p.withKids !== "undefined") {
      trip.brief.withKids = !!p.withKids;
      trip.brief.partyComposition = p.withKids ? 'family-kids' : (trip.brief.partyComposition === 'family-kids' ? 'adults-only' : trip.brief.partyComposition);
    }
    // Round EW.2: duration was missing from the mirror list. Without
    // this, changing the duration in Parameters left trip.brief.duration
    // stale, and the over-budget banner kept appearing against the old
    // budget. Mirror it now.
    if (typeof p.duration !== "undefined") trip.brief.duration = p.duration;
    if (typeof p.when !== "undefined") trip.brief.when = p.when;
    if (typeof p.startDate !== "undefined") trip.brief.startDate = p.startDate;
    if (typeof p.endDate !== "undefined") trip.brief.endDate = p.endDate;
    if (typeof p.intent !== "undefined") {
      var intentChanged = (p.intent || '') !== (snap.intent || '');
      trip.brief.intent = p.intent;
      // v360.2 (A.3): when intent changes, diff against initial-why
      // wisps and update the stream. Dropped fragments become gone
      // (the user rescinded that piece of the why); new fragments
      // become new initial wisps. The trip's destinations, bookings,
      // and other state are untouched — lineage outlives the wisp.
      if (intentChanged && typeof _syncInitialIntentWisps === "function") {
        try { _syncInitialIntentWisps(trip, p.intent); } catch (_) {}
      }
    }
    if (typeof p.pace !== "undefined") trip.brief.pace = p.pace;
    if (typeof p.accommodation !== "undefined") trip.brief.accommodation = p.accommodation;
    // v302: structured pace fields mirrored to trip.brief so the
    // engine reads them after Parameters saves.
    // v353.4: only persist as a per-trip OVERRIDE when the value
    // differs from the user's current welcome-modal pref. If the
    // user accepted the default (or didn't touch the field), we
    // leave trip.brief.hoursPerDay unset and the engine falls back
    // to the live pref (MaxDB.prefs.paceHours). Means changing the
    // welcome-modal pace later will flow into trips that didn't
    // explicitly override; trips that did override stay overridden.
    if (typeof p.hoursPerDay !== "undefined") {
      var _prefHpd = (typeof _defaultHoursPerDay === "function") ? _defaultHoursPerDay() : 6;
      if (p.hoursPerDay === _prefHpd) {
        delete trip.brief.hoursPerDay;
      } else {
        trip.brief.hoursPerDay = p.hoursPerDay;
      }
    }
    if (typeof p.maxBigSightsPerDay !== "undefined") {
      var _prefBig = (typeof _defaultMaxBigSightsPerDay === "function") ? _defaultMaxBigSightsPerDay() : 2;
      if (p.maxBigSightsPerDay === _prefBig) {
        delete trip.brief.maxBigSightsPerDay;
      } else {
        trip.brief.maxBigSightsPerDay = p.maxBigSightsPerDay;
      }
    }
    // v306: mobility mirrored to trip.brief.
    if (typeof p.physicalAbility !== "undefined") trip.brief.physicalAbility = p.physicalAbility;
    if (typeof p.abilityNote !== "undefined") trip.brief.abilityNote = p.abilityNote;
    // v359.60.73: insurance + visa mirrored. Stored as objects to
    // keep the structured fields together; null means "not set".
    if (typeof p.insurance !== "undefined") trip.brief.insurance = p.insurance;
    if (typeof p.visa !== "undefined") trip.brief.visa = p.visa;
    // v359.60.75: checklist + documents mirrored. Arrays of plain
    // objects; replace wholesale rather than merge.
    if (typeof p.checklist !== "undefined") trip.brief.checklist = p.checklist;
    if (typeof p.documents !== "undefined") trip.brief.documents = p.documents;
  }
  _tb._editMode = false;
  _tb._snapshot = null;
  _tb._pending = null;

  // If entry/exit changed and we have a built trip, re-sequence using the new logic.
  // Bookings and tracker items are preserved on each destination — only date ranges
  // and order shift. The user will see any invalidations flagged by Max's preview.
  if (orderAffected && trip && trip.destinations && trip.destinations.length > 1) {
    resequenceWithCurrentBrief();
  }

  // Round EW.2: re-evaluate over-budget and re-render trip view if
  // duration changed. This way changing duration in Parameters has
  // the same immediate effect as clicking "Extend the trip" on the
  // banner — banner clears (or appears) based on the new math.
  if (durationChanged) {
    if (typeof _reEvaluateOverBudget === "function") _reEvaluateOverBudget();
    if (typeof drawTripMode === "function") drawTripMode();
  }

  autoSave();

  // v360.0.4: visible feedback for the Apply step. Without this,
  // clicking "Yes, apply these changes" just closes the overlay
  // with no acknowledgment — new users wonder if anything happened.
  if (typeof showSaveStatus === "function") showSaveStatus("✓ Trip preferences saved", 2400);

  // v359.49.2: After Parameters apply, just close the overlay and
  // leave the user where they were. Previously (v294.11) this
  // redirected to the picker / candidate explorer on every apply,
  // which felt punitive — touch one field, get dumped back into
  // re-curating destinations. Brief from the trip view should
  // return to the trip view; Brief from the picker should return
  // to the picker (it's still visible underneath). drawTripMode
  // already runs when duration changes (above), so the trip view
  // reflects any new dates.
  showSaveStatus("Parameters updated", 1800);
  g("trip-brief-overlay").style.display="none";
  // If the user came from the candidate explorer (mid-curation) and
  // candidates exist, re-render it so any edited inputs are reflected.
  // No-op when the explorer overlay isn't visible.
  var _ceOv = document.getElementById("candidate-explorer-overlay");
  if (_ceOv && _ceOv.style.display !== "none" &&
      _tb && _tb.candidates && _tb.candidates.length &&
      typeof renderCandidateCards === "function") {
    try { renderCandidateCards(_tb.candidates); } catch(e){}
  }
}

// Round EW.2: re-evaluate trip.overBudgetNotice based on current
// trip.destinations + trip.brief.duration. Used by any path that
// changes duration or destination nights without going through
// buildFromCandidates (Parameters edit, banner buttons, future inline
// nights edits). Mirrors the detect-only logic from
// detectOverBudget inside buildFromCandidates.
// _reEvaluateOverBudget moved to engine-trip.js (Round HO).

// Re-run orderKeptCandidates against the current trip's destinations + _tb entry/exit,
// reassign dates preserving night counts. Bookings stay attached to their destinations.
function resequenceWithCurrentBrief(){
  if (!trip || !trip.destinations || !trip.destinations.length) return;
  // PD.125: when the user hasn't named arrival/departure cities,
  // default to the country's capital via MaxGeo. Before this, the
  // sequencer picked the first destination in array order — which
  // gave an Iceland trip Vík as the starting point instead of
  // Reykjavík (the actual international gateway). Apply to both
  // _tb (live picker state) and trip.brief (persistent) so reopens
  // pick up the same default.
  try {
    if (typeof MaxGeo !== "undefined" && MaxGeo.byName && trip.brief && trip.brief.region) {
      var _ctry = MaxGeo.byName(trip.brief.region);
      if (_ctry && _ctry.capital) {
        if (!_tb || !_tb.entry) {
          if (_tb) _tb.entry = _ctry.capital;
          if (!trip.brief.entry) trip.brief.entry = _ctry.capital;
        }
        if (!_tb || !_tb.tbExit) {
          if (_tb) _tb.tbExit = _ctry.capital;
          if (!trip.brief.tbExit) trip.brief.tbExit = _ctry.capital;
        }
      }
    }
  } catch(_){}
  // Build pseudo-candidates from the current destinations so orderKeptCandidates can process them
  var pseudoKept = trip.destinations.map(function(d){
    var rf = (d.attachedEvents||[]).map(function(e){ return e.name; });
    return {
      id: d.id,
      place: d.place,
      country: d.country || "",
      _required: !!(d.attachedEvents && d.attachedEvents.length),
      _requiredFor: rf,
      _dest: d,  // back-reference
      stayRange: (d.nights||3) + " nights",
      status: "keep"
    };
  });
  var orderResult = orderKeptCandidates(pseudoKept, _mdcItems||[], _tb.entry||"", _tb.tbExit||"");
  var newOrder = orderResult.ordered.map(function(pc){ return pc._dest; }).filter(Boolean);

  // Preserve any destinations that didn't come back from the ordering (defensive)
  trip.destinations.forEach(function(d){
    if (newOrder.indexOf(d) < 0) newOrder.push(d);
  });

  // Reassign dates preserving night counts. Anchor to first destination's existing dateFrom.
  var anchorDate = newOrder[0] && newOrder[0].dateFrom ? new Date(newOrder[0].dateFrom + "T12:00:00") : new Date();
  var cur = new Date(anchorDate);
  newOrder.forEach(function(d){
    var nights = d.nights || 3;
    d.dateFrom = cur.toISOString().slice(0,10);
    cur.setDate(cur.getDate() + nights);
    d.dateTo = cur.toISOString().slice(0,10);
    d.days = makeDays(d.id, d.place, d.intent || d.place, d.dateFrom, nights);
  });
  trip.destinations = newOrder;
  trip.orderingReasoning = orderResult.reasoning;
  _emitTripMutation();
}

function cancelTripBrief(){
  g("trip-brief-overlay").style.display="none";
  var inp=g("ntp-name"); if(inp) inp.focus();
}

// Rebuild _tb.requiredPlaces from the currently-checked _mdcItems. Called
// any time a must-do is toggled on/off so candidate matching stays in sync.
// Same logic as expandMustDos but extracted so it's reusable.
function _rebuildRequiredPlacesFromMdcItems(){
  if (!_tb) return;
  var requiredMap = {};
  (_mdcItems || []).forEach(function(item){
    if (!item.checked) return;
    (item.requiredPlaces||[]).forEach(function(p){
      if (!p || !p.place) return;
      if (!requiredMap[p.place]) requiredMap[p.place] = {place:p.place, country:p.country||'', requiredFor:[], flexible:false};
      requiredMap[p.place].requiredFor.push(item.type === "manual" ? "__manual__" : item.name);
      if (item.type === "condition") requiredMap[p.place].flexible = true;
    });
  });
  _tb.requiredPlaces = Object.values(requiredMap);
}

// Called when the user clicks the × on a must-do in the summary panel.
// Soft uncheck — sets m.checked=false, rebuilds requiredPlaces, demotes any
// candidates that were ONLY required for this must-do (they stay as places to
// consider rather than being rejected). The user can re-check from the same
// summary if they change their mind.
function _toggleMustDoFromSummary(name){
  var m = (_mdcItems || []).find(function(x){ return x.name === name; });
  if (!m) return;
  m.checked = !m.checked;
  _rebuildRequiredPlacesFromMdcItems();
  // Demote candidates whose only required link was this must-do
  if (!m.checked) {
    (_tb.candidates || []).forEach(function(c){
      if (!c._requiredFor) return;
      c._requiredFor = c._requiredFor.filter(function(r){ return r !== name; });
      if (!c._requiredFor.length) {
        c._required = false;
      }
    });
  } else {
    // Re-checking — re-derive _required based on new requiredPlaces
    (_tb.candidates || []).forEach(function(c){
      if (typeof _findMatchingRequired === "function") {
        var match = _findMatchingRequired(c, _tb.requiredPlaces);
        if (match) {
          c._required = true;
          c._requiredFor = match.requiredFor || [];
        }
      }
    });
  }
  if (typeof renderCandidateCards === "function") renderCandidateCards(_tb.candidates);
}


// PD.309: legacy global findCandidates() forwards to MaxBuild for
// any external caller (console commands, debug tools) that still uses
// the old name. The 5 in-app callers have all been migrated to call
// MaxBuild.findCandidates({mode, ...input}) directly. Reads _tb to
// build a defensive input — but the in-app entry points should NOT
// rely on this forwarding (it's the _tb-as-argument-bag anti-pattern
// the orchestrator exists to prevent). Phase 7b: delete entirely
// once we've audited that no console / dev-tool path depends on it.
async function findCandidates(){
  _tb.region=g("tb-region")?g("tb-region").value.trim():(_tb.region||"");
  _tb.when=g("tb-when")?g("tb-when").value.trim():(_tb.when||"");
  _tb.intent=g("tb-intent")?g("tb-intent").value.trim():(_tb.intent||"");
  _tb.anchors=g("tb-anchors")?g("tb-anchors").value.trim():(_tb.anchors||"");
  _tb.constraints=g("tb-constraints")?g("tb-constraints").value.trim():(_tb.constraints||"");
  if (typeof MaxBuild !== "undefined" && MaxBuild && typeof MaxBuild.findCandidates === "function") {
    return MaxBuild.findCandidates({
      mode:     _tb._isRebuild ? "rebuild" : "candidate-first",
      region:   _tb.region || "",
      sentence: _tb.intent || "",
      anchors:  _tb.anchors || "",
      tripMode: _tb.tripMode || "sentence"
    }).catch(function(err){
      console.warn("[Max] legacy findCandidates() forward to MaxBuild failed:", err && err.message);
    });
  }
  // Fallback to legacy behavior (defensive — MaxBuild should always
  // be loaded by the time any caller fires).
  try {
    showCandidateExplorer(null);
    var prompt="You are a travel expert. Suggest 6-8 destination candidates based on this trip brief.\n\n"
      +"Trip: "+_tb.name
      +(_tb.region?"\nRegion: "+_tb.region:"")
      +(_tb.when?"\nWhen/how long: "+_tb.when:"")
      +(_tb.intent?"\nPurpose: "+_tb.intent:"")
      +(_tb.anchors?"\nMust-dos: "+_tb.anchors:"")
      +(_tb.interests&&_tb.interests.length?"\nInterests: "+_tb.interests.join(", "):"")
      +(_tb.constraints?"\nConstraints: "+_tb.constraints:"")
      +"\n\nReturn ONLY a valid JSON array (no markdown):\n"
      +'[{"place":"City","country":"Country","role":"base","stayRange":"2-4 nights","whyItFits":"Why.","tradeoffs":"Downside.","tags":["tag1","tag2"],"otherAttractions":"2-3 other things worth considering here.","widelyRecommended":false,"accepted":true,"lat":48.2,"lng":16.4}]\nSet widelyRecommended=true for canonical destinations.'
      +"\nMix roles: base, anchor, pass-through. Include real lat/lng."
      +"\nMark accepted=true for places a reasonable traveler with this brief would almost certainly include — the trip's core. Mark accepted=false for alternatives worth surfacing but that the traveler might reasonably skip. Aim for roughly 60-70% accepted on average; vary by trip ambition.";
    var text=await callMax([{role:"user",content:prompt}],2000);
    var cands=JSON.parse(text.replace(/```json|```/g,"").trim());
    cands.forEach(function(c,i){c.id="c"+i;c.status=null;c.order=null;c.manuallyOrdered=false;});
    _tb.candidates=cands;
    _ensureTripRoleDefaults(_tb.candidates);
    showCandidateExplorer(cands);
  }catch(e){
    var el=g("ce-cards");
    var noKey=e.message&&e.message.indexOf("No API key")>-1;
    if(el) el.innerHTML='<div style="padding:16px;font-size:11px;">'
      +(noKey
        ?'<div style="color:#c05020;font-weight:600;margin-bottom:8px;">No API key set</div>'
        +'<div style="color:var(--c-ink-2);margin-bottom:10px;">Max needs your Anthropic API key to think about places.</div>'
        +'<button onclick="cancelCandidateExplorer();setTimeout(function(){showApiKeyForm();},100);" style="font-size:11px;padding:6px 12px;background:var(--c-primary-top);color:var(--c-on-dark);border:none;border-radius:5px;cursor:pointer;font-family:inherit;">Set API key →</button>'
        :'<div style="color:#c05020;">Could not generate candidates: '+e.message+'</div>')
      +'</div>';
    var ld=g("ce-loading"); if(ld) ld.style.display="none";
  }
}

// ─── CANDIDATE EXPLORER ────────────────────────────────────
// Round HZ (picker hero map): sequence is now a first-class picker
// concern, not a downstream consequence of clicking Build. The default
// renderer is the map-led sidebar (renderPickerSidebar) which mirrors
// the route polyline on _ceMap; the legacy lens-based card grid lives
// in renderCandidateCards as a fallback for window._pickerUseHeroSidebar
// === false.
//
// Entry/exit isn't a separate decision anymore — the first kept dot in
// the route is the implicit arrival, the last is the implicit departure.
// orderKeptCandidates runs live on every status toggle via
// _tbResequenceCandidates, ordering the active set (accepted + unchecked)
// uniformly. publishTrip then narrows to accepted only; unchecked
// candidates carry forward on trip.candidates as the "considered, not
// added" set surfaced via the Considered (N) button on the trip view.
//
// The _ceLens variable below is retained for the legacy renderer.
// See picker-hero-map.md for the full model.
var _ceMap=null,_ceMarkers=[],_ceRejectedExpanded=true,_ceEditMode=false,_ceCardExpanded={},_ceLens="activity",_ceSectionExpanded={},_cePolyline=null;
// Card→pin selection: tapping a candidate card highlights its map marker so
// the user can locate the place geographically. _ceMarkerById persists only
// for the current render pass and is cleared at the top of renderCandidateCards.
var _ceSelectedCandId=null, _ceMarkerById={};

// Set the selected candidate and pan the map to its marker if it's off-screen.
// The visual swap to the "selected" icon happens inside _addCandidateMarker on
// the next render pass (which the caller triggers). Separated so selection
// state is globally reachable from any card click handler.
function _ceSelectCandidateOnMap(candId){
  _ceSelectedCandId = candId;
  // Pan into view after the re-render so the marker object exists at its new
  // id→marker mapping. Running synchronously here would look up the stale
  // marker from the previous render pass.
  setTimeout(function(){
    var m = _ceMarkerById[candId];
    if (!m || !_ceMap) return;
    try {
      var ll = m.getLatLng();
      if (!_ceMap.getBounds().contains(ll)) {
        _ceMap.panTo(ll, {animate: true});
      }
    } catch(e) { /* map not ready, ignore */ }
  }, 60);
}

// Round HZ (picker hero map): draw a polyline through the trip's sequence
// on the candidate-explorer map. Renders the route the user is shaping —
// connects active (non-rejected) candidates that have an `order` set by
// _tbResequenceCandidates, in ascending order. Called from
// renderCandidateCards (so the route refreshes on every status toggle) and
// from geocodeMissingCandidates (so late-arriving coords extend the line).
// Idempotent: each call removes the previous polyline before drawing the
// new one. Quiet no-op when the map isn't mounted or fewer than 2 points
// are placed.
function _redrawCePolyline(){
  // v359.51.3: route polyline removed from the candidate-explorer map
  // — same call Neal made for the place-mode picker (_pmMap) in v357:
  // the picker is about WHICH places to include; the visit sequence
  // gets committed in the trip view. Day-trip dashed spurs stay.
  // Function kept as a no-op so existing call sites don't need to be
  // hunted down; any pre-existing polyline state on the map gets torn
  // down here so a hot-reload from an older build clears cleanly.
  if (_cePolyline && _ceMap) {
    try { _ceMap.removeLayer(_cePolyline); } catch(e) {}
  }
  _cePolyline = null;
}

async function retryDiscoveryCandidates() {
  var existingReq = (_tb.candidates||[]).filter(function(c){ return c._required; });
  var skipList = existingReq.map(function(p){ return p.place; }).join(", ");
  var extraCount = Math.max(4, 8 - Math.min(existingReq.length, 6));
  var brief = "Region: " + (_tb.region||"")
    + (_tb.when ? "\nWhen: " + _tb.when : "")
    + (_tb.intent ? "\nWhat they want: " + _tb.intent : "");
  var releasedPlaces = _tb.releasedPlaces || [];
  var releasedNote = releasedPlaces.length
    ? "\nThese places were on train routes the traveler decided against — include them as candidates if they are genuinely worth visiting independently (not just for the train): "
      + releasedPlaces.map(function(p){ return p.place + " (was on " + p.releasedFrom + ")"; }).join(", ") + "\n"
    : "";

  // Build driver-aware instruction
  var driverInstruction = "";
  var drivers = _tb.drivers || [];
  if(drivers.indexOf("different") > -1 && _tb.gradient){
    driverInstruction = "\nThis traveler needs something different from their current life. Their gradient: " + _tb.gradient + ". Prioritize places that sit at the described distance from the familiar \u2014 not the most famous or most visited, but the ones that deliver the right register of experience.\n";
  } else if(drivers.indexOf("narrative") > -1){
    driverInstruction = "\nThis traveler has a stored intention \u2014 a place that has been waiting. Weight candidates that have genuine historical depth and the kinds of stories that reward a long-anticipated visit.\n";
  } else if(drivers.indexOf("doing") > -1){
    driverInstruction = "\nThis traveler is defined by what they want to do, not just see. Weight candidates that support the specific activity or mode of engagement they described.\n";
  }
  var familiarity = _tb.familiarity || "";
  var famNote = familiarity === "know" ? "\nThe traveler knows this region well (quite a bit). Skip obvious recommendations. Surface what repays a second or third look.\n"
              : familiarity === "before" ? "\nThe traveler has a passing understanding of this region. Fill in context as needed without over-explaining.\n"
              : "";

  var p2 = "You are a travel expert helping plan a trip to " + (_tb.region||"this region") + ".\n"
    + "Trip context: " + brief + "\n"
    + driverInstruction
    + famNote
    + releasedNote
    + (skipList ? "These stops are already confirmed: " + skipList + ". Do NOT include them again.\n" : "")
    + "\nSurvey ALL the destinations in this region that a serious traveler would consider. "
    + "Start by listing every place genuinely worth visiting — major cities, towns, natural areas — then select the " + extraCount + " that best fit this specific trip. "
    + "Do NOT skip well-known places because they seem obvious. Famous cities are famous for good reasons. "
    + "A traveler doing this trip would almost certainly regret missing: the major gateway cities, the cultural capitals, the places everyone who has been there mentions. Include those. "
    + "Then add less obvious places that specifically fit what this traveler wants.\n"
    + "Return ONLY a JSON array of exactly " + extraCount + " places (no markdown):\n"
    + '[{"place":"City","country":"Country","role":"base","stayRange":"2-4 nights","whyItFits":"What makes it worth visiting — specific, not generic.","tradeoffs":"One honest downside.","tags":["tag1"],"otherAttractions":"2-3 other things worth considering here.","widelyRecommended":false,"accepted":true,"lat":0.0,"lng":0.0}]\nSet widelyRecommended=true for canonical destinations.'
    + "\nMark accepted=true for places a reasonable traveler with this brief would almost certainly include — the trip's core. Mark accepted=false for alternatives worth surfacing but that the traveler might reasonably skip. Aim for 60-70% accepted on average.";
  try {
    var t = await callMax([{role:"user",content:p2}], 2000, 45000);
    var newCands = JSON.parse(t.replace(/```json|```/g,"").trim());
    newCands.forEach(function(c){ c._required=false; c._requiredFor=[]; });
    var allCands = existingReq.concat(newCands);
    var nextId = allCands.length;
    // v358.8: every candidate starts at status:null. See the
    // allCands.forEach in findCandidates above for the rationale —
    // user picks are the contract; LLM extras are opt-in via the
    // candidate-explorer.
    newCands.forEach(function(c,i){ c.id="c"+(existingReq.length+i); c.status=null; c.order=null; c.manuallyOrdered=false; });
    _tb.candidates = existingReq.concat(newCands);
    _ensureTripRoleDefaults(_tb.candidates);
    _tb.p2Failed = false;
    showCandidateExplorer(_tb.candidates);
  } catch(e) {
    alert("Couldn't load suggestions: " + e.message);
  }
}

async function geocodeMissingCandidates(missing, allCands) {
  if (!missing.length) return;
  try {
    var names = missing.map(function(c){ return c.place + (c.country ? ", " + c.country : ""); }).join("; ");
    var region = (_tb && _tb.region) ? _tb.region : "";
    var regionHint = region
      ? " These are destinations for a trip to "+region+" — if a name is ambiguous or possibly a typo (e.g. 'Apenzell' instead of 'Appenzell'), use the place in "+region+"."
      : "";
    var prompt = "Return ONLY a JSON array with accurate lat/lng for these places: " + names
      + "." + regionHint
      + '\n[{"place":"Name","lat":0.0,"lng":0.0}]\nUse real coordinates.';
    var text = await callMax([{role:"user",content:prompt}], 500, 20000);
    var coords = JSON.parse(text.replace(/```json|```/g,"").trim());
    coords.forEach(function(r){
      var match = allCands.find(function(c){
        return c.place && r.place && c.place.toLowerCase().indexOf(r.place.toLowerCase()) > -1;
      });
      if (match && r.lat && r.lng && r.lat !== 0) {
        match.lat = r.lat; match.lng = r.lng;
        // Add marker to map
        if (_ceMap && r.lat && r.lng) {
          // Round HZ (picker hero map, step 3): use the shared icon factory
          // so geocoded-late candidates get the sequence ordinal (1, 2, 3 …)
          // and the three-state color encoding instead of the previous
          // place-initials-only inline divIcon. The factory reads c.order
          // and c.status, matching what _addCandidateMarker does on the
          // normal render path.
          var icon = (typeof _makeCandidateIcon === "function")
            ? _makeCandidateIcon(match, false, _ceSelectedCandId === match.id)
            : null;
          if (!icon) {
            // NC.9.12: defensive fallback routes through MaxMapPin.
            // Maps status → role: keep → stay (blue), reject → maybe-
            // style gray, anything else → maybe. Earlier this hardcoded
            // its own status palette (green/gray/blue) which diverged
            // from the rest of the app.
            var _fbRole = (match.status === "keep") ? "stay"
                        : (match.status === "reject") ? "maybe"
                        : "maybe";
            var _fbStyle = MaxMapPin.style(_fbRole, {});
            var _fbLabel = (match.place || "").substring(0, 2);
            var _fbHtml = MaxMapPin.html(_fbStyle, { label: _fbLabel });
            icon = MaxMapPin.icon(_fbHtml, _fbStyle);
          }
          var m = L.marker([r.lat, r.lng], {icon:icon});
          m.bindTooltip(match.place||"", {permanent:false,direction:"top",offset:[0,-14]});
          m.addTo(_ceMap);
          _ceMarkers.push(m);
        }
      }
    });
    // Refit bounds with new markers
    var allBounds = [];
    allCands.forEach(function(c){ if(c.lat && c.lng && c.lat!==0) allBounds.push([c.lat,c.lng]); });
    if (allBounds.length > 1) {
      try { _ceMap.fitBounds(allBounds, {padding:[28,28]}); } catch(e) {}
    }
    // Round HZ (picker hero map): newly-geocoded candidates may now have
    // valid coords for the polyline — redraw so the route line extends.
    _redrawCePolyline();
  } catch(e) { console.warn("Geocoding failed:", e.message); }
}

function showCandidateDisclaimer() {
  // Only show once per session (not once per trip — it's a useful reminder)
  if (sessionStorage.getItem("ce-disclaimer-seen")) return;
  var el = document.getElementById("ce-cards");
  if (!el) return;

  var banner = document.createElement("div");
  banner.id = "ce-disclaimer";
  banner.style.cssText = "margin-bottom:10px;padding:10px 12px;background:var(--c-bg);border:1px solid var(--c-border-2);border-left:3px solid #999;border-radius:6px;font-size:11px;color:var(--c-ink-2);line-height:1.6;";
  banner.innerHTML = '<div style="font-weight:600;color:#333;margin-bottom:4px;">A note on these suggestions</div>'
    + '<div>Max generates these candidates \u2014 but the best trips are built by people who have done their own research. Use this as a starting point, not a finished answer.</div>'
    + '<div style="margin-top:6px;display:flex;justify-content:flex-end;">'
    + '<span id="ce-disc-dismiss" style="font-size:10px;color:var(--c-ink-4);cursor:pointer;">Got it</span>'
    + '</div>';
  banner.querySelector("#ce-disc-dismiss").onclick = function() {
    banner.remove();
  };
  el.insertBefore(banner, el.firstChild);
  sessionStorage.setItem("ce-disclaimer-seen", "1");
}

// Re-open the Candidate Explorer on an already-built trip so the user can flip
// keep/reject decisions. Hydrates _tb from the trip snapshot, flags edit mode,
// and opens the overlay. See applyCandidateChanges for reconciliation logic.
function reopenCandidateExplorer(){
  if (!trip || !trip.candidates || !trip.candidates.length) return;
  // Rehydrate trip-brief scratch from the trip so the Explorer's helpers work
  _tb = _tb || {};
  _tb.candidates = trip.candidates.map(function(c){
    return {
      id:c.id, place:c.place, country:c.country||null, role:c.role||null,
      whyItFits:c.whyItFits||"", tags:c.tags||[], tradeoffs:c.tradeoffs||null,
      stayRange:c.stayRange||"", lat:c.lat||null, lng:c.lng||null,
      status:c.status||null, _required:!!c._required, _requiredFor:(c._requiredFor||[]).slice(),
      // Round HZ (picker hero map): persist explicit sequence position +
      // manual-pin flag so a reopened picker re-acquires the user's order.
      // Missing on legacy trips → null/false, which the next
      // _tbResequenceCandidates pass repopulates from orderKeptCandidates.
      order:(typeof c.order==="number"?c.order:null), manuallyOrdered:!!c.manuallyOrdered,
      // Round NC.3e: c.role is the source of truth. Legacy trips with
      // only c.tripRole or c.intent get migrated via normalize on the
      // next line. c.overnightCapable falls back to !c.singleSight or
      // defaults to true if neither is present.
      role: c.role || null,
      overnightCapable: (typeof c.overnightCapable === "boolean") ? c.overnightCapable : null,
      // Round PD.23: see reopenPickerForEdit for the same fix.
      dayTripHub: c.dayTripHub || null,
      waysideFromHub: c.waysideFromHub || null,
      _roleTouched: !!c._roleTouched
    };
  });
  _ensureTripRoleDefaults(_tb.candidates);
  _tb.requiredPlaces = (trip.requiredPlaces||[]).slice();
  if (trip.brief) {
    _tb.region = trip.brief.region || _tb.region || "";
    _tb.when = trip.brief.when || _tb.when || "";
    _tb.duration = trip.brief.duration || _tb.duration || "";
    _tb.entry = trip.brief.entry || _tb.entry || "";
    _tb.tbExit = trip.brief.tbExit || _tb.tbExit || "";
    _tb.intent = trip.brief.intent || _tb.intent || "";
    _tb.interests = trip.brief.interests || _tb.interests || [];
    _tb.anchors = trip.brief.anchors || _tb.anchors || [];
    _tb.familiarity = trip.brief.familiarity || _tb.familiarity || "";
    // PD.89: rehydrate the user-listed names so the render-time
    // reconciliation keeps working after a reload / picker reopen.
    // PD.91 backfill: trips created before PD.89 don't have
    // _userListedNames stashed. Re-derive from the original paste
    // text (stashed on tripMeta.notes by the paste-list flow) so
    // existing trips also get the source-of-truth treatment.
    if (trip.brief._userListedNames) {
      _tb._userListedNames = Object.assign({}, trip.brief._userListedNames);
    } else if (trip.brief.tripMeta && trip.brief.tripMeta.notes
        && typeof parsePlacesList === "function") {
      try {
        var _backfill = parsePlacesList(trip.brief.tripMeta.notes);
        if (_backfill && Array.isArray(_backfill.destinations)) {
          var _bfNrm = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){return String(s||"").toLowerCase();};
          _tb._userListedNames = {};
          _tb._userListedDisplay = {};
          _backfill.destinations.forEach(function(p){
            if (!p || !p.place) return;
            var k = _bfNrm(p.place);
            if (k) {
              _tb._userListedNames[k] = p.isStay ? "stay" : "see";
              if (!_tb._userListedDisplay[k]) _tb._userListedDisplay[k] = String(p.place).trim();
            }
          });
          // PD.429: do NOT persist a parallel brief map — this re-parse is a
          // transient migration authority; _refreshUserListedFromRecords (run
          // on reopen) bakes it onto the records, which are the durable truth.
        }
      } catch(_){}
    }
    // PD.149: rehydrate display map separately too.
    if (trip.brief._userListedDisplay) {
      _tb._userListedDisplay = Object.assign({}, trip.brief._userListedDisplay);
    }
  }
  // Rehydrate must-dos so reject-cascade and required-badges work
  if (trip.placeActivities) _mdcItems = trip.placeActivities.slice();
  _ceRejectedExpanded = true;
  showCandidateExplorer(_tb.candidates, true);
}

function cancelEditCandidates(){
  if (document.body) document.body.classList.remove("picker-active");
  _ceEditMode = false;
  g("candidate-explorer-overlay").style.display="none";
  if(_ceMap){_ceMap.remove();_ceMap=null;} _cePolyline=null; if(_edMap){try{_edMap.remove();}catch(e){}_edMap=null;_edMarkers=[];}
  // PD.333: leaving Discovery (explorer) is a user action — record it
  // so the URL agrees with the trip view now on screen.
  try {
    if (typeof MaxRoute !== "undefined" && trip && trip.id) {
      MaxRoute.navigate({ screen: MaxRoute.SCREENS.TRIP, tripId: trip.id }, { replace: true });
    }
  } catch(_){}
}

// Re-open the merged activity-place PICKER (Step 3) on an already-built
// trip so the user can curate inside the same UI they used to create the
// trip. This replaces the old "Edit destinations" path that mounted the
// legacy candidate explorer with a different layout. State is rehydrated
// from trip.placeActivities + trip.brief; the picker's button reads "Save changes
// →" instead of "Choreograph my trip →" and routes through saveActivityPickerEdits.
function reopenPickerForEdit(){
  // PD.354: a fresh edit session starts clean — the CTA reads
  // "Return to my trip" until the user actually changes something.
  try { if (typeof _tb !== "undefined" && _tb) _tb._editDirty = false; } catch(_){}
  // v360.2: dedupe mdcItems before re-hydrating the picker. LLM extraction
  // sometimes produces multiple condition items with the same name (e.g.
  // "Northern Lights viewing" per viable location), and those persist as
  // duplicate rows in the picker. Collapsing here gives the user a clean
  // view on every reopen.
  if (typeof _mdcItemsDedupe === "function") {
    try { _mdcItemsDedupe(trip); } catch (_) {}
  }
  console.log("[Max] reopenPickerForEdit called. trip.placeActivities length:", (trip && trip.placeActivities) ? trip.placeActivities.length : "(none)");
  if (!trip || !Array.isArray(trip.placeActivities) || !trip.placeActivities.length) {
    // No mdcItems snapshot — fall back to the legacy explorer.
    console.log("[Max] reopenPickerForEdit: no mdcItems, falling back to reopenCandidateExplorer");
    if (typeof reopenCandidateExplorer === "function") {
      reopenCandidateExplorer();
    } else {
      alert("Can't edit this trip — its picker data is missing. Try building a new trip.");
    }
    return;
  }
  _tb = _tb || {};
  _tb._editMode = true;
  _tb.tripMode = "place";
  // Round NC.X: hydrate _tb.candidates from trip.candidates.
  // reopenPickerForEdit was setting _tb.placeActivities but not
  // _tb.candidates, leaving _tb.candidates at whatever state the
  // session had (often []). Console diagnostic: _renderPlaceActivityItems
  // logged candidates=0 after reopen even though trip.candidates had 35.
  // Consequences: (1) the picker map's c.role lookup never matched
  // anything, so role-based pin rendering fell through to legacy
  // info.kept paths; (2) the Trip→Discovery c.role=daytrip bridge had
  // no candidates to write to. Mirror the same hydration
  // reopenCandidateExplorer does so both paths arrive at a consistent
  // picker state.
  if (Array.isArray(trip.candidates)) {
    _tb.candidates = trip.candidates.map(function(c){
      return {
        id: c.id,
        place: c.place,
        country: c.country || null,
        role: c.role || null,
        whyItFits: c.whyItFits || "",
        tags: c.tags || [],
        tradeoffs: c.tradeoffs || null,
        stayRange: c.stayRange || "",
        lat: (typeof c.lat === "number") ? c.lat : null,
        lng: (typeof c.lng === "number") ? c.lng : null,
        status: c.status || null,
        _required: !!c._required,
        _requiredFor: (c._requiredFor || []).slice(),
        order: (typeof c.order === "number") ? c.order : null,
        manuallyOrdered: !!c.manuallyOrdered,
        overnightCapable: (typeof c.overnightCapable === "boolean") ? c.overnightCapable : null,
        intent: c.intent || null,
        dayTripHub: c.dayTripHub || null,
        waysideFromHub: c.waysideFromHub || null,
        waysideLeg: c.waysideLeg || null,
        // Round PD.23: preserve user-commitment flag across reopen
        // so the popup's "You selected" vs "Max suggests" label
        // (PD.22) reads truthfully. Without this, every reopened
        // candidate looked untouched even when the user had set a
        // role in the prior session.
        _roleTouched: !!c._roleTouched
      };
    });
    if (typeof _ensureTripRoleDefaults === "function") {
      _ensureTripRoleDefaults(_tb.candidates);
    }
  }
  // Rehydrate the brief so picker prompts and downstream rebuild see it.
  if (trip.brief) {
    _tb.region = trip.brief.region || _tb.region || "";
    _tb.placeName = trip.brief.placeName || trip.brief.region || _tb.placeName || "";
    _tb.placeContext = trip.brief.placeContext || _tb.placeContext || "";
    _tb.entry = trip.brief.entry || _tb.entry || "";
    _tb.tbExit = trip.brief.tbExit || _tb.tbExit || "";
    // Round GA: entryBuffer/exitBuffer default OFF on edit-rehydrate.
    // Older saved trips that explicitly set true keep their value;
    // undefined means "no opinion" → false (consistent with the new
    // opt-in via per-card buttons rather than picker checkboxes).
    _tb.entryBuffer = (trip.brief.entryBuffer === true) ? true : false;
    // Round GA: exitBuffer also defaults OFF on edit-rehydrate now.
    // Older saved trips that explicitly set true keep their value;
    // undefined → false. Buffers are opt-in via per-card buttons.
    _tb.exitBuffer = (trip.brief.exitBuffer === true) ? true : false;
    _tb.intent = trip.brief.intent || _tb.intent || "";
    _tb.duration = trip.brief.duration || _tb.duration || "";
    _tb.when = trip.brief.when || _tb.when || "";
    _tb.startDate = trip.brief.startDate || _tb.startDate || "";
    _tb.endDate = trip.brief.endDate || _tb.endDate || "";
    // PD.89: rehydrate user-listed names (renderActivityPicker path).
    // PD.91: backfill from tripMeta.notes for pre-PD.89 trips.
    if (trip.brief._userListedNames) {
      _tb._userListedNames = Object.assign({}, trip.brief._userListedNames);
    } else if (trip.brief.tripMeta && trip.brief.tripMeta.notes
        && typeof parsePlacesList === "function") {
      try {
        var _backfill2 = parsePlacesList(trip.brief.tripMeta.notes);
        if (_backfill2 && Array.isArray(_backfill2.destinations)) {
          var _bfNrm2 = (typeof _normPlaceName === "function") ? _normPlaceName : function(s){return String(s||"").toLowerCase();};
          _tb._userListedNames = {};
          _tb._userListedDisplay = {};
          _backfill2.destinations.forEach(function(p){
            if (!p || !p.place) return;
            var k = _bfNrm2(p.place);
            if (k) {
              _tb._userListedNames[k] = p.isStay ? "stay" : "see";
              if (!_tb._userListedDisplay[k]) _tb._userListedDisplay[k] = String(p.place).trim();
            }
          });
          // PD.429: transient migration authority only — not persisted as a
          // parallel brief map (records carry _origin:"user").
        }
      } catch(_){}
      // PD.149: also rehydrate the display map alone if it's already
      // persisted (renderActivityPicker path mirror).
      if (trip.brief._userListedDisplay) {
        _tb._userListedDisplay = Object.assign({}, trip.brief._userListedDisplay);
      }
    }
    _tb.partyComposition = trip.brief.partyComposition || _tb.partyComposition || "";
    _tb.partySize = trip.brief.partySize || _tb.partySize || "";
    _tb.partyAges = trip.brief.partyAges || _tb.partyAges || "";
    _tb.physicalAbility = trip.brief.physicalAbility || _tb.physicalAbility || "";
    _tb.abilityNote = trip.brief.abilityNote || _tb.abilityNote || "";
    _tb.pace = trip.brief.pace || _tb.pace || "";
    _tb.accommodation = trip.brief.accommodation || _tb.accommodation || "";
    _tb.transport = trip.brief.transport || _tb.transport || "";
    _tb.compromises = trip.brief.compromises || _tb.compromises || "";
    _tb.hardlimits = trip.brief.hardlimits || _tb.hardlimits || "";
    _tb.avoid = Object.assign({}, trip.brief.avoid || {});
    // v302: hydrate structured pace fields from trip.brief.
    if (typeof trip.brief.hoursPerDay === "number") _tb.hoursPerDay = trip.brief.hoursPerDay;
    if (typeof trip.brief.maxBigSightsPerDay === "number") _tb.maxBigSightsPerDay = trip.brief.maxBigSightsPerDay;
    // v359.55.3: hydrate the research-card data (notes, source links,
    // stay/see overrides) so it survives picker reopens after Choreograph.
    _tb.placeMeta = Object.assign({}, trip.brief.placeMeta || {});
    // Round NC.X: bridge each kept candidate's c.role BACK into
    // placeMeta.stayOverride so the Discovery role-chip reflects what
    // was committed in the trip. Without this, the picker reopens
    // with every place showing as "Stay" even when the user had
    // chosen "See" — the chip reads stayOverride, not c.role.
    //
    // Daytrip / onway are NOT bridged here: those are richer states
    // than the binary stayOverride and live on the requiredPlace
    // (_isDayTrip + _dayTripHub) plus c.role itself. Forcing them
    // through stayOverride=false would make the chip read "See"
    // when the truer rendering is "· day trip from <hub>" / "on
    // the way" — which the picker row renderer already handles via
    // the _dayTripPreds path and c.role lookup.
    //
    // Only seed when stayOverride is missing/null; an explicit prior
    // user override wins.
    try {
      var _normFn2 = (typeof _normPlaceName === "function")
        ? _normPlaceName
        : function(s){ return String(s||"").toLowerCase(); };
      // Round PD.15: legitimate exception #2 to the MaxRoleWriter
      // invariant — this is reopenPickerForEdit HYDRATING placeMeta
      // from the trip's c.role at picker-reopen time. The trip's
      // c.role is the source of truth; we're copying it into _tb
      // for the picker's view layer. Not a user mutation, so it
      // doesn't trip the writer's _roleTouched / event-emit
      // bookkeeping. If you find yourself adding a similar bridge
      // for another field, ask whether the writer should grow a
      // hydration mode first.
      (trip.candidates || []).forEach(function(c){
        if (!c || !c.place) return;
        var k = _normFn2(c.place);
        if (!k) return;
        var existing = _tb.placeMeta[k];
        if (existing && (existing.stayOverride === true || existing.stayOverride === false)) {
          return; // explicit prior override wins
        }
        if (!existing) {
          _tb.placeMeta[k] = { notes: "", links: [], stayOverride: null };
          existing = _tb.placeMeta[k];
        }
        if (c.role === "stay")      existing.stayOverride = true;
        else if (c.role === "see")  existing.stayOverride = false;
        // daytrip / onway / null → leave stayOverride at null so the
        // chip falls through to whichever role the picker derives
        // from c.role / _isDayTrip.
      });
    } catch(e) {
      console.warn("[Max reopenPickerForEdit] c.role → stayOverride bridge failed:", e && e.message);
    }
    // v359.55.13: hydrate trip-level meta too.
    if (trip.brief.tripMeta) {
      _tb.tripMeta = {
        notes: trip.brief.tripMeta.notes || "",
        links: (trip.brief.tripMeta.links || []).slice()
      };
    }
  }
  // Hydrate _tb.placeActivities from trip.placeActivities. Round DX: restore
  // each place's _keep state from the saved record so previously-rejected
  // places show up unchecked in the picker (and can be re-added by the
  // user) instead of vanishing. Legacy data without an explicit _keep
  // flag defaults to true — that's what every place was before this
  // round, so old saved trips behave the same as before.
  _tb.placeActivities = trip.placeActivities.map(function(m){
    return {
      id: m.id,
      name: m.name,
      type: m.type,
      section: m.section || (
        m.type === "route" ? "Travel on iconic trains between destinations"
        : m.type === "condition" ? "Wait for weather"
        : "Other things to do"
      ),
      iconic: !!m.iconic,
      // Round EN: restore the LLM-supplied category so the picker nav's
      // chips survive re-edit. Falls back to the name-based guess when
      // the saved item predates EN.
      category: m.category || (typeof _categoryFromSection === "function" ? _categoryFromSection(m.section || "") : null),
      // PD.383: the headliner flag is item-level and can't be recomputed
      // at render time (the intent matcher lives in the generation
      // closure), so it MUST survive the reopen clone.
      _headliner: (m._headliner === true),
      description: m.description || "",
      // Round DX.1: respect the saved `checked` flag. If the user
      // unchecked every place under this activity last time, m.checked
      // is false; the picker shows the row but with all places off.
      // Legacy data without an explicit `checked` field defaults to
      // true (the pre-DX.1 behavior).
      checked: (m.checked !== false),
      requiredPlaces: (m.requiredPlaces||[]).map(function(p){
        return {
          place: p.place,
          country: p.country || "",
          nights: typeof p.nights === "number" ? p.nights : 2,
          lat: (typeof p.lat === "number") ? p.lat : null,
          lng: (typeof p.lng === "number") ? p.lng : null,
          _keep: (p._keep !== false),
          // PD.378: provenance + verdict flags MUST survive the
          // reopen clone. This whitelist silently dropped
          // _autoCreated (so the stays rebuild wiped synthesized
          // hubs after every reopen) and _rejected (so a rejected
          // place quietly reverted to "considered" on the next
          // publish — taste memory lost). The "did we remember to
          // add the new field" bug class, in the flesh.
          _autoCreated: (p._autoCreated === true),
          _rejected: (p._rejected === true),
          _origin: (p._origin === "user" || p._origin === "max-hub" || p._origin === "max") ? p._origin : undefined, // PD.382

          // place-picker hero map: restore the user's day-trip toggle
          // from the trip envelope. Legacy data without these fields
          // defaults to false / "" — same as a fresh place.
          _isDayTrip: (p._isDayTrip === true),
          _dayTripHub: (typeof p._dayTripHub === "string") ? p._dayTripHub : ""
        };
      }),
      endpoints: (m.endpoints||[]).slice(),
      viableLocations: (m.viableLocations||[]).slice(),
      direction: m.direction,
      durationHours: m.durationHours,
      modeOptions: m.modeOptions,
      alternatives: m.alternatives,
      reservationNotes: m.reservationNotes,
      recovery: m.recovery,
      frequencyRequirement: m.frequencyRequirement,
      conditionNote: m.conditionNote
    };
  });
  // v357: removed the _tb._placePickerStart reset — the picker map
  // no longer carries a "Start from" hint (sequencing is trip-view-
  // only), so there's nothing to reset on rehydrate.

  // Round NC.X: bridge day-trip + wayside designations from the trip
  // BACK into the picker's requiredPlace flags. Without this, day
  // trips made in the trip view (via the destination role popover or
  // the picker map's "make day trip" pill) get lost when Discovery
  // reopens — Discovery is supposed to be the source of truth across
  // visits, so a daytrip in the trip view must read as a daytrip in
  // Discovery too. Walks two shapes:
  //   1) trip.destinations[*].dayTrips[*]      — legacy chip array
  //   2) trip.routes[*] where subKind==="dayTrip" + planItems         — modern
  // For each absorbed source place, find its requiredPlace ref in
  // _tb.placeActivities and stamp _isDayTrip=true + _dayTripHub.
  // Waysides (trip.routes[*].planItems[type==="stop"] on non-dayTrip
  // routes) are bridged by setting the matching candidate's c.role to
  // "onway" — the picker chip already reads role for the See/?/Stay
  // visuals.
  (function _bridgeTripDayTripsToPicker(){
    if (!trip || !Array.isArray(trip.destinations)) return;
    var norm = function(s){
      return (typeof _normPlaceName === "function") ? _normPlaceName(s||"") : String(s||"").toLowerCase().trim();
    };
    // Collect (sourceNorm, hubNorm) pairs from both shapes.
    var dayTripPairs = {}; // sourceKey -> hubKey
    trip.destinations.forEach(function(d){
      if (!d || !Array.isArray(d.dayTrips)) return;
      var hubKey = norm(d.place);
      if (!hubKey) return;
      d.dayTrips.forEach(function(chip){
        if (!chip || !chip.place) return;
        var srcKey = norm(chip.place);
        if (!srcKey || srcKey === hubKey) return;
        if (!(srcKey in dayTripPairs)) dayTripPairs[srcKey] = hubKey;
      });
    });
    // Modern routes shape — same data, different home. Some legacy
    // trips have ONLY the chip array; some new trips have ONLY the
    // route+planItem shape. Union both.
    //
    // Round NC.X bugfix: routes use r.fromDestId (a DESTINATION id),
    // not fromId / fromName / fromPlace. convertDestToDayTrip writes
    // {fromDestId: hubDestId, toDestId: hubDestId} — i.e. both point
    // at the hub destination (the source becomes a planItem stop).
    // The earlier bridge read non-existent fields, never resolved a
    // hub, and silently dropped every route. Dynjandi symptom:
    // converted to a day trip from Ísafjörður in trip view, but
    // reopening Discovery showed it as "See" because the bridge
    // couldn't find the hub.
    if (Array.isArray(trip.routes)) {
      trip.routes.forEach(function(r){
        if (!r) return;
        var isDT = (r.subKind === "dayTrip") || (r.kind === "dayTrip");
        if (!isDT) return;
        // Resolve hub: fromDestId → destinations[id===fromDestId].place
        var hubName = "";
        if (r.fromDestId && Array.isArray(trip.destinations)) {
          var hubDest = trip.destinations.find(function(d){ return d && d.id === r.fromDestId; });
          if (hubDest && hubDest.place) hubName = hubDest.place;
        }
        // Legacy fallbacks for old data shapes.
        if (!hubName) hubName = r.fromName || r.fromPlace || "";
        if (!hubName && r.fromId && trip.places && trip.places[r.fromId]) {
          hubName = trip.places[r.fromId].name || "";
        }
        var hubKey = norm(hubName);
        if (!hubKey) return;
        (r.planItems || []).forEach(function(pi){
          if (!pi || pi.type !== "stop") return;
          var nm = "";
          if (pi.placeId && trip.places && trip.places[pi.placeId]) nm = trip.places[pi.placeId].name || "";
          if (!nm) nm = pi.place || pi.name || "";
          var srcKey = norm(nm);
          if (!srcKey || srcKey === hubKey) return;
          if (!(srcKey in dayTripPairs)) dayTripPairs[srcKey] = hubKey;
        });
      });
    }
    var _dtBridged = 0;
    _tb.placeActivities.forEach(function(item){
      if (!item || !Array.isArray(item.requiredPlaces)) return;
      item.requiredPlaces.forEach(function(p){
        if (!p || !p.place) return;
        var k = norm(p.place);
        if (dayTripPairs[k]) {
          p._isDayTrip = true;
          p._dayTripHub = dayTripPairs[k]; // already lowercased / normalized
          _dtBridged++;
        }
      });
    });
    // Round NC.X: ALSO set c.role="daytrip" on the matching candidate
    // for each absorbed day-trip source. Without this, the picker map
    // popup's currentRole detection reads c.role first (NC.3 source of
    // truth) and gets "see" / "stay" from a stale value — so opening
    // the popup on Landmannalaugar (a day trip in the trip view) showed
    // "See — decide later" pre-selected instead of "Day trip from {hub}".
    // Bridge legacy flag + NC.3 role together so the popup is right.
    // Synthesize a candidate if the source isn't in _tb.candidates yet
    // — _hydratePickerFromCommittedSrc fills in later but the popup
    // needs the candidate to be present NOW.
    _tb.candidates = _tb.candidates || [];
    var _dtCandsBridged = 0;
    var _dtCandsSynthesized = 0;
    Object.keys(dayTripPairs).forEach(function(srcKey){
      var cand = _tb.candidates.find(function(c){
        return c && c.place && norm(c.place) === srcKey;
      });
      if (cand) {
        if (cand.role !== "daytrip") {
          // Round NC.X: route through MaxRoleWriter so the bridge
          // atomically updates c.role + flags + placeMeta + emits
          // candidateChange. Hub comes from the dayTripPairs map.
          MaxRoleWriter.set(cand.id || cand.place, "daytrip", { hub: dayTripPairs[srcKey], persist: false });
          _dtCandsBridged++;
        }
      } else {
        // Find a display name + coords from the requiredPlaces walk.
        var displayName = srcKey;
        var srcLat = null, srcLng = null;
        for (var _i = 0; _i < _tb.placeActivities.length && displayName === srcKey; _i++) {
          var rps = _tb.placeActivities[_i].requiredPlaces || [];
          for (var _j = 0; _j < rps.length; _j++) {
            if (rps[_j] && rps[_j].place && norm(rps[_j].place) === srcKey) {
              displayName = rps[_j].place;
              if (typeof rps[_j].lat === "number") srcLat = rps[_j].lat;
              if (typeof rps[_j].lng === "number") srcLng = rps[_j].lng;
              break;
            }
          }
        }
        _tb.candidates.push({
          id: "c-dt-" + srcKey.replace(/[^a-z0-9]+/g, "-").substring(0, 32) + "-" + Math.random().toString(36).slice(2, 6),
          place: displayName,
          country: (_tb.region || ""),
          role: "daytrip",
          intent: "dayTrip",
          dayTripHub: dayTripPairs[srcKey],
          status: "keep",
          lat: srcLat,
          lng: srcLng,
          stayRange: "0 nights",
          nights: 0,
          tags: ["picker-daytrip", "committed"],
          _roleTouched: true,
          _required: false,
          _requiredFor: []
        });
        _dtCandsSynthesized++;
      }
    });
    console.log("[Max reopenPickerForEdit] day-trip candidates: bridged=" + _dtCandsBridged + " synthesized=" + _dtCandsSynthesized);
    if (_dtBridged) {
      console.log("[Max reopenPickerForEdit] bridged " + _dtBridged +
        " day-trip flag(s) from trip → picker (" +
        Object.keys(dayTripPairs).length + " unique sources)");
    }

    // Waysides: walk non-dayTrip routes with planItem stops. These
    // are "on the way" places that the picker should render with
    // c.role === "onway". Apply to the matching candidate so the
    // Discovery render + the role popover both see the right role.
    //
    // Round NC.X: if a wayside stop has no matching candidate yet
    // (the trip's wayside-stops aren't always in trip.candidates;
    // sometimes they're hydrated later as synthetic candidates via
    // _hydratePickerFromCommittedSrc), SYNTHESIZE one inline so the
    // popup + map find it immediately. Otherwise opening the popup
    // on Skogafoss read "See" from a non-existent candidate
    // (falling through to default) and the user couldn't tell that
    // the trip already had it as a wayside.
    if (Array.isArray(trip.routes)) {
      _tb.candidates = _tb.candidates || [];
      var _wsBridged = 0;
      var _wsSynthesized = 0;
      var _wsRoutesWalked = 0;
      var _wsStopsWalked = 0;
      trip.routes.forEach(function(r){
        if (!r) return;
        var isDT = (r.subKind === "dayTrip") || (r.kind === "dayTrip");
        if (isDT) return;
        _wsRoutesWalked++;
        (r.planItems || []).forEach(function(pi){
          if (!pi || pi.type !== "stop") return;
          _wsStopsWalked++;
          var nm = "";
          var pLat = null, pLng = null;
          if (pi.placeId && trip.places && trip.places[pi.placeId]) {
            var p = trip.places[pi.placeId];
            nm = p.name || "";
            if (typeof p.lat === "number") pLat = p.lat;
            if (typeof p.lng === "number") pLng = p.lng;
          }
          if (!nm) nm = pi.place || pi.name || "";
          var srcKey = norm(nm);
          if (!srcKey) return;
          var cand = _tb.candidates.find(function(c){
            return c && c.place && norm(c.place) === srcKey;
          });
          if (cand) {
            if (cand.role !== "onway") {
              // Round NC.X: route through MaxRoleWriter.
              MaxRoleWriter.set(cand.id || cand.place, "onway", { persist: false });
              _wsBridged++;
            }
          } else {
            // Synthesize a wayside candidate so the popup + picker
            // map can find it. Same shape _hydratePickerFromCommittedSrc
            // uses for waysides; we just create it earlier so the
            // bridge has a target.
            _tb.candidates.push({
              id: "c-ws-" + srcKey.replace(/[^a-z0-9]+/g, "-").substring(0, 32) + "-" + Math.random().toString(36).slice(2, 6),
              place: nm,
              country: (_tb.region || ""),
              role: "onway",
              intent: "wayside",
              status: "keep",
              lat: pLat,
              lng: pLng,
              stayRange: "0 nights",
              nights: 0,
              tags: ["picker-wayside", "committed"],
              _roleTouched: true,
              _required: false,
              _requiredFor: []
            });
            _wsSynthesized++;
          }
        });
      });
      // Always log so we can see what happened, even on zero hits.
      console.log("[Max reopenPickerForEdit] waysides: routes=" + _wsRoutesWalked
        + " stops=" + _wsStopsWalked + " bridged=" + _wsBridged + " synthesized=" + _wsSynthesized);
    }
  })();

  // v359.51.10: mark every current overnight destination as
  // _userChoseStay: true on its corresponding requiredPlaces. Without
  // this, the picker's day-trip predictor re-fires on re-entry and
  // re-marks short-stay overnight destinations (Geysir 1-night near
  // Reykjavik, Landmannalaugar, etc.) as predicted day trips — Neal's
  // report: "when i go back to edit destinations, everything becomes
  // day trips". The user committed these as overnight stays via
  // Choreograph; their stay status should survive re-entry.
  //
  // Places that were ABSORBED as day-trip PlanItems aren't in
  // trip.destinations[] anymore, so they don't get _userChoseStay
  // marked — their existing _isDayTrip flag carries through.
  (function _markCommittedStaysSticky(){
    if (!Array.isArray(trip.destinations) || !trip.destinations.length) return;
    var stayPlaces = {};
    var norm = function(s){ return (typeof _normPlaceName === "function") ? _normPlaceName(s||"") : String(s||"").toLowerCase().trim(); };
    trip.destinations.forEach(function(d){
      if (d && d.place) stayPlaces[norm(d.place)] = true;
    });
    var marked = 0;
    _tb.placeActivities.forEach(function(item){
      if (!item || !Array.isArray(item.requiredPlaces)) return;
      item.requiredPlaces.forEach(function(p){
        if (!p || !p.place) return;
        if (stayPlaces[norm(p.place)]) {
          p._userChoseStay = true;
          // Also clear any stale day-trip flag — the user CHOSE stay,
          // so the picker shouldn't render the orange spur for this
          // place even if it had a leftover _isDayTrip from a prior
          // round. (Won't affect day-trip PlanItems on the hub, since
          // those aren't in trip.destinations as stays.)
          p._isDayTrip = false;
          p._dayTripHub = "";
          marked++;
        }
      });
    });
    if (marked) console.log("[Max] reopenPickerForEdit: marked", marked, "requiredPlaces as _userChoseStay (committed overnight)");
  })();

  // Mirror into _mdcItems too — downstream code reads from both depending
  // on the path. Keep them in sync.
  _mdcItems = trip.placeActivities.slice();

  // v360.3 (#124 Turn 4B): extract committed day-trips and waysides from
  // trip.routes[] so the picker can pre-check them under each destination.
  // The picker rebuilds _tb.candidates from scratch in runCandidateSearch
  // (so picker candidate ids reset), so we stash place-name-based sources
  // here and a later helper (_hydratePickerFromCommittedSrc) maps them
  // onto the rebuilt picker candidates by normalized place name.
  // intent:"dayTrip"/"wayside" candidates get re-injected into
  // _tb.candidates with status="keep", and the lookup maps used by
  // _renderCandidateCard's checklist subsections get pre-populated.
  (function _captureCommittedDaytripsAndWaysides(){
    _tb._committedDaytripsSrc = [];
    _tb._committedWaysidesSrc = [];
    if (!Array.isArray(trip.routes) || !trip.routes.length) return;
    var places = trip.places || {};
    var destById = {};
    (trip.destinations || []).forEach(function(d){ if (d && d.id) destById[d.id] = d; });
    trip.routes.forEach(function(r){
      if (!r || !Array.isArray(r.planItems) || !r.planItems.length) return;
      var stops = r.planItems
        .filter(function(pi){ return pi && pi.type === "stop"; })
        .map(function(pi){
          var p = places[pi.placeId] || {};
          return {
            name: p.name || pi.label || "",
            lat: (typeof p.lat === "number") ? p.lat : null,
            lng: (typeof p.lng === "number") ? p.lng : null,
            why: pi.notes || "",
            durationHours: (typeof pi.duration === "number") ? pi.duration
                          : (typeof pi.durationHours === "number") ? pi.durationHours
                          : null,
            iconic: pi.priority === "iconic"
          };
        })
        .filter(function(s){ return s.name; });
      if (!stops.length) return;
      var fromD = destById[r.fromDestId];
      var toD   = destById[r.toDestId];
      if (r.subKind === "dayTrip" || r.kind === "dayTrip") {
        // Day-trip loops: fromDest === toDest is the hub.
        if (!fromD || !fromD.place) return;
        _tb._committedDaytripsSrc.push({
          hubPlace: fromD.place,
          hubPlaceNorm: (typeof _normPlaceName === "function") ? _normPlaceName(fromD.place) : String(fromD.place).toLowerCase(),
          stops: stops
        });
      } else {
        // Transit route — any stops on it are waysides.
        if (!fromD || !toD || !fromD.place || !toD.place) return;
        _tb._committedWaysidesSrc.push({
          fromPlace: fromD.place,
          toPlace:   toD.place,
          fromPlaceNorm: (typeof _normPlaceName === "function") ? _normPlaceName(fromD.place) : String(fromD.place).toLowerCase(),
          toPlaceNorm:   (typeof _normPlaceName === "function") ? _normPlaceName(toD.place)   : String(toD.place).toLowerCase(),
          stops: stops
        });
      }
    });
    // Reset hydration flag so the helper picks the data up on the next
    // candidate-card render pass even if it ran on a prior reopen.
    _tb._committedHydrated = false;
    if (_tb._committedDaytripsSrc.length || _tb._committedWaysidesSrc.length) {
      console.log("[Max] reopenPickerForEdit: captured",
        _tb._committedDaytripsSrc.length, "committed day-trip hubs +",
        _tb._committedWaysidesSrc.length, "committed wayside legs");
    }
  })();

  // Apply the build-time categorization fixes on REOPEN too, so refreshing an
  // existing trip surfaces route-only sights into themes and re-homes orphan
  // self-named categories — without a full rebuild. Both are idempotent
  // (no-op once applied), and they mutate the placeActivities array in place.
  try {
    if (typeof MaxGenPost !== "undefined" && MaxGenPost && Array.isArray(_tb.placeActivities)) {
      // PD.435: run the ONE canonical placement-finalize pipeline (consolidate
      // orphan themes → surface route-only sights → bake provenance + re-project
      // the listed cache → collapse kind conflicts). Centralizing the sequence
      // here means the reopen path can never drift from the others.
      var _fin = (typeof window._finalizeDiscoveryPlacement === "function") ? window._finalizeDiscoveryPlacement({ refreshListedCache: true }) : null;
      if (_fin && _fin.surfaced) console.log("[Max] reopen: surfaced " + _fin.surfaced + " route-only sight(s) into theme sections");
      // PD.430: migrate stay-section items that an older build typed "manual"
      // (which the must-dos grouping mislabeled "Places you added (26)") to the
      // stay type, so an existing trip self-heals on reopen without a rebuild.
      var _isStaySecFn = (typeof window._isStaySection === "function") ? window._isStaySection : null;
      var _retyped = 0;
      _tb.placeActivities.forEach(function(it){
        if (it && it.type === "manual" && it.section && _isStaySecFn && _isStaySecFn(it.section)) {
          it.type = "synthetic-stays"; _retyped++;
        }
      });
      if (_retyped) console.log("[Max PD.430] retyped " + _retyped + " stay section(s) from 'manual' → 'synthetic-stays' (not 'Places you added')");
    }
  } catch (e) { console.warn("[Max] reopen categorization pass failed (non-fatal):", e && e.message); }

  console.log("[Max] reopenPickerForEdit: hydrated", _tb.placeActivities.length, "activities; opening picker");
  // Ensure the trip-brief overlay container is visible.
  var ov = g("trip-brief-overlay");
  if (!ov) {
    console.error("[Max] reopenPickerForEdit: #trip-brief-overlay not found — cannot show picker");
    alert("Can't open research — overlay element missing. Reload the page and try again.");
    return;
  }
  // The overlay lives inside #home-screen by default. When the app shell is
  // mounted (trip view), #home-screen has display:none — which hides ALL
  // descendants, even position:fixed ones. So when re-opening the picker
  // from a built trip, hoist the overlay to be a direct child of <body>
  // so it can render over the app shell. Round BZ — fixes "Edit destinations
  // does nothing" symptom even though the JS was firing correctly.
  if (ov.parentElement && ov.parentElement !== document.body) {
    document.body.appendChild(ov);
  }
  ov.style.display = "block";
  // v359.1: reflect picker mode in the three-pill toggle so when the
  // user comes back to the trip view, the pill state is consistent.
  if (typeof _leftMode !== "undefined") _leftMode = "picker";
  var _pkBtn = g("mode-picker-btn"); if (_pkBtn) _pkBtn.className = "mode-btn on";
  var _trBtn = g("mode-trip-btn"); if (_trBtn) _trBtn.className = "mode-btn";
  var _deBtn = g("mode-dest-btn"); if (_deBtn) _deBtn.className = "mode-btn";
  renderActivityPicker();
}

// Save edits made in the picker's edit mode and return to the trip view.
// Filters _tb.placeActivities to kept items (same shape as
// continuePlaceModeToStep2 produces), updates trip.brief.entry/tbExit,
// and rebuilds the trip. Per-destination user data (notes, bookings) is
// preserved by snapshotting before rebuild and restoring matched by
// place name afterward.
async function saveActivityPickerEdits(){
  // Title-case any user-typed entry/exit before save (catches no-blur path).
  if (_tb.entry) _tb.entry = _titleCaseCity(_tb.entry);
  if (_tb.tbExit) _tb.tbExit = _titleCaseCity(_tb.tbExit);
  // Round DX: preserve REJECTED places in the saved record (with _keep:false)
  // alongside kept ones, so the next edit pass can show them unchecked and
  // let the user re-add them. Previously, unchecking a place silently
  // dropped it from trip.placeActivities and there was no way to bring it back
  // without starting over. Routes still collapse to activity-type if too
  // few endpoints survive — that's a real type change, not a UI toggle.
  //
  // Round DX.1: also preserve activities where ALL places are unchecked.
  // The activity's `checked` flag reflects "any kept place"; when false,
  // expandMustDos / findAttachedEvents skip the activity (so it doesn't
  // affect the trip), but it survives in trip.placeActivities so the next edit
  // pass shows it with its places ready to be re-checked.
  var items = (_tb.placeActivities||[]).map(function(i){
    var allPlaces = (i.requiredPlaces||[]).map(function(p){
      var clean = {place: p.place, country: p.country, _keep: !!p._keep};
      if (typeof p.nights === "number") clean.nights = p.nights;
      if (typeof p.lat === "number") clean.lat = p.lat;
      if (typeof p.lng === "number") clean.lng = p.lng;
      return clean;
    });
    var anyKept = allPlaces.some(function(p){return p._keep;});
    var clone = Object.assign({}, i, { checked: anyKept, requiredPlaces: allPlaces });
    delete clone._keep;
    if (i.type === "route" && Array.isArray(i.endpoints)) {
      var keptKeys = {};
      allPlaces.forEach(function(p){ if (p._keep) keptKeys[(p.place||"").toLowerCase()] = true; });
      clone.endpoints = i.endpoints.filter(function(ep){ return ep && keptKeys[(ep.place||"").toLowerCase()]; });
      if (clone.endpoints.length < 2) {
        // Route collapses to a regular activity when fewer than two
        // endpoints survive. Stash the original endpoint list on
        // _origEndpoints so re-edit can resurrect them as
        // unchecked-but-visible places (that's a future enhancement —
        // for now they're stored in requiredPlaces above).
        clone.type = "activity";
        delete clone.endpoints;
        delete clone.direction;
      }
    }
    return clone;
  });
  // Anything kept anywhere across activities? If absolutely nothing is
  // kept, treat that as "abandon the trip" and confirm with the user.
  var anyKeptAnywhere = items.some(function(i){
    return (i.requiredPlaces||[]).some(function(p){return p._keep;});
  });
  if (!anyKeptAnywhere) {
    if (!confirm("No places are kept. Cancel changes and return to your trip?")) return;
    cancelPickerEdit();
    return;
  }
  // Round DW: snapshot/restore is GONE. _reconcileDestinations preserves
  // surviving destination objects in place, so per-dest user state
  // (bookings, day items, suggestions, etc.) survives automatically by
  // identity. No more "did we remember to add the new field to the
  // snapshot list?" bug class.
  _tb._isRebuild = true;
  _mdcItems = items;
  _tb.region = _tb.placeName || _tb.region || "";
  _tb.anchors = items.map(function(i){return i.name;}).join(", ");
  if (trip && trip.brief) {
    trip.brief.entry = _tb.entry || trip.brief.entry || "";
    trip.brief.tbExit = _tb.tbExit || trip.brief.tbExit || "";
  }
  _tb._editMode = false;
  // PD.309: route through the orchestrator in REBUILD mode. The
  // orchestrator's mint phase is SKIPPED for rebuild — the existing
  // trip id is preserved; publishTrip reconciles destinations
  // against the existing trip object. _tb._isRebuild=true (set above)
  // is still consulted by downstream code (publishTrip's destination
  // identity preservation, the wisp stream preservation) so the
  // legacy flag stays.
  if (typeof MaxBuild !== "undefined" && MaxBuild && typeof MaxBuild.findCandidates === "function") {
    MaxBuild.findCandidates({
      mode:     "rebuild",
      region:   _tb.region,
      sentence: _tb.intent || "",
      anchors:  _tb.anchors || "",
      tripMode: _tb.tripMode || "sentence"
    }).catch(function(err){
      console.warn("[Max] saveActivityPickerEdits: MaxBuild failed:", err && err.message);
    });
  }
}

// Bail out of edit mode without applying changes.
function cancelPickerEdit(){
  _tb._editMode = false;
  delete _tb._editPreservedByPlace;
  var ov = g("trip-brief-overlay");
  if (ov) ov.style.display = "none";
  // PD.198 (architectural): remove body.picker-active BEFORE
  // drawTripMode runs. Without this, PD.83c's defensive guard bails
  // drawTripMode (no-op) and the trip view never stamps
  // _recordScreen("trip"). Result: user cancels the picker, sees
  // trip view visually, closes the trip — but _lastScreen is still
  // "picker" because the stamp never fired. Next reopen routes to
  // Discovery instead of trip view. Same fix as PD.124 for the
  // 'published' handler; cancel path was the missing twin.
  if (document.body) document.body.classList.remove("picker-active");
  // v359.1: keep mode toggle in sync when leaving the picker overlay.
  _leftMode = "trip";
  var _pkBtn = g("mode-picker-btn"); if (_pkBtn) _pkBtn.className = "mode-btn";
  var _trBtn = g("mode-trip-btn"); if (_trBtn) _trBtn.className = "mode-btn on";
  var _deBtn = g("mode-dest-btn"); if (_deBtn) _deBtn.className = "mode-btn";
  if (typeof drawTripMode === "function") drawTripMode();
}

// No more lock-in ceremony: closing the Places overlay IS how you step out.
// If no trip yet but kept candidates exist, build silently (skipping the
// pre-build modal). If a trip already exists, this is just a dismiss.
function closePlacesOverlay(){
  document.body.classList.remove("picker-active");
  if (_ceEditMode) { applyCandidateChanges(); return; }
  // Treat anything not explicitly rejected as kept on close. This matches the
  // "trip is always definite, always fluid" model from STATE.md — closing the
  // Places overlay should silently materialize a trip, not dump the user back
  // to home because they didn't click a bunch of explicit keeps.
  // EXCEPTION: in place mode (Mode 2 picker), the user already curated their
  // exact picks on the activity-place page. The candidate explorer adds
  // discovery suggestions (major cities + thematic) on top — those should
  // stay null unless the user explicitly keeps them. Otherwise the trip's
  // night count balloons past what the picker promised. Only auto-keep
  // candidates that came from the picker (_required=true).
  var cands = _tb.candidates || [];
  var isPlaceMode = (_tb.tripMode === "place");
  cands.forEach(function(c){
    if (c.status === "reject" || c.status === "keep") return;
    if (isPlaceMode && !c._required) return; // discoveries stay null
    c.status = "keep";
  });
  var kept = MaxEnginePicker.keptCandidates(cands);
  g("candidate-explorer-overlay").style.display="none";
  if(_ceMap){_ceMap.remove();_ceMap=null;} _cePolyline=null; if(_edMap){try{_edMap.remove();}catch(e){}_edMap=null;_edMarkers=[];}
  if (!kept.length) {
    // Nothing to build — stay where we are and let the user reconsider.
    return;
  }

  // v359.25: realism check at commit. Pre-publish pass over the kept
  // candidates for rough spots (stacked long hops, fragmentation, pace
  // mismatch, density). If issues are found, modal asks user to
  // proceed-anyway or back-to-picker. If clean, build silently.
  // Reopens the picker overlay on "back" so the user can edit
  // (closePlacesOverlay already hid it above).
  (function _realismGate(){
    if (!window.MaxPickerUI || typeof MaxPickerUI.runRealismCheck !== "function") {
      buildFromCandidates();
      return;
    }
    var ordered;
    try {
      var orderRes = (typeof orderKeptCandidates === "function" || typeof MaxEnginePicker.orderKeptCandidates === "function")
        ? (MaxEnginePicker.orderKeptCandidates || orderKeptCandidates)(kept, _mdcItems || [], _tb.entry || "", _tb.tbExit || "")
        : null;
      ordered = (orderRes && Array.isArray(orderRes.ordered)) ? orderRes.ordered : kept.slice();
    } catch(e) {
      console.warn("[Max] realism-check: ordering failed, using raw kept order:", e);
      ordered = kept.slice();
    }
    var issues;
    try {
      issues = MaxPickerUI.runRealismCheck(ordered, _tb);
    } catch(e) {
      console.warn("[Max] realism-check: evaluator threw:", e);
      issues = [];
    }
    if (!issues || !issues.length) {
      buildFromCandidates();
      return;
    }
    console.log("[Max] realism-check: " + issues.length + " issue(s)", issues);
    MaxPickerUI.showRealismCheckModal(
      issues,
      function onProceed(){ buildFromCandidates(); },
      function onBack(){
        // Re-open the picker overlay so the user can edit.
        var ov = g("candidate-explorer-overlay");
        if (ov) ov.style.display = "block";
        if (typeof renderCandidateCards === "function") {
          renderCandidateCards(_tb && _tb.candidates ? _tb.candidates : []);
        }
      }
    );
  })();
}

// Reconcile the Explorer's kept set against the existing trip.destinations.
// New keeps → append as new destinations at the end. Existing destinations whose
// backing candidate is now rejected → confirm with user (naming any content
// that would be lost), then remove. Unchanged destinations keep all their data.
async function applyCandidateChanges(){
  if (!_ceEditMode || !trip) return;
  var keptNow = MaxEnginePicker.keptCandidates(_tb.candidates);
  if (!keptNow.length) {
    alert("You need at least one kept destination to apply.");
    return;
  }
  var keptNameSet = {};
  keptNow.forEach(function(c){ keptNameSet[(c.place||"").toLowerCase()] = c; });
  var destNameSet = {};
  (trip.destinations||[]).forEach(function(d){ destNameSet[(d.place||"").toLowerCase()] = d; });

  // Destinations to remove (no longer kept)
  var toRemove = (trip.destinations||[]).filter(function(d){
    return !keptNameSet[(d.place||"").toLowerCase()];
  });
  // Candidates to add (kept now, not already a destination)
  var toAdd = keptNow.filter(function(c){
    return !destNameSet[(c.place||"").toLowerCase()];
  });

  if (!toRemove.length && !toAdd.length) {
    // Nothing to reconcile — just close
    cancelEditCandidates();
    _emitTripMutation();
    return;
  }

  // Build a line-item summary with content-loss warnings
  function describeDestContent(d){
    var scheduled = 0;
    (d.days||[]).forEach(function(day){ scheduled += (day.items||[]).length; });
    var bookings = (d.hotelBookings||[]).filter(function(b){return b.status==="booked";}).length
                 + (d.generalBookings||[]).filter(function(b){return b.status==="booked";}).length;
    var parts = [];
    if (scheduled) parts.push(scheduled+" scheduled item"+(scheduled!==1?"s":""));
    if (bookings) parts.push(bookings+" booking"+(bookings!==1?"s":""));
    return parts.length ? " ("+parts.join(", ")+" will be lost)" : "";
  }
  var lines = [];
  if (toRemove.length) {
    lines.push("Remove from trip:");
    toRemove.forEach(function(d){ lines.push("  \u2022 "+d.place+describeDestContent(d)); });
  }
  if (toAdd.length) {
    if (lines.length) lines.push("");
    lines.push("Add to end of trip:");
    toAdd.forEach(function(c){ lines.push("  \u2022 "+c.place+(c.stayRange?" ("+c.stayRange+")":"")); });
  }
  lines.push("");
  lines.push("Apply these changes?");
  if (!confirm(lines.join("\n"))) return;

  // Apply removals — keep other destinations' data intact
  if (toRemove.length) {
    var removeIds = {};
    toRemove.forEach(function(d){ removeIds[d.id] = true; });
    trip.destinations = (trip.destinations||[]).filter(function(d){ return !removeIds[d.id]; });
    if (activeDest && removeIds[activeDest]) activeDest = null;
  }

  // Append new destinations at the end, continuing dates from the last one
  // v359.47: track the first newly-added dest so we can scroll to it
  // post-render.
  var _firstAddedDestId = null;
  if (toAdd.length) {
    var lastDest = trip.destinations[trip.destinations.length-1];
    var cur = lastDest ? new Date(lastDest.dateTo) : new Date(parseStartDateFromBrief(_tb.when||""));
    toAdd.forEach(function(c){
      destCtr++;
      var id="d"+destCtr;
      if (!_firstAddedDestId) _firstAddedDestId = id;
      var nights=parseNightsFromRange(c.stayRange)||3;
      var dateFrom = cur.toISOString().slice(0,10);
      var next = new Date(cur); next.setDate(next.getDate()+nights);
      var dateTo = next.toISOString().slice(0,10);
      var dest = {
        id:id, place:c.place, intent:c.place+(c.whyItFits?" \u2014 "+c.whyItFits.substring(0,60):""),
        dateFrom:dateFrom, dateTo:dateTo, nights:nights,
        // Round FQ.1: propagate lat/lng from the candidate so the
        // geographic-affordance banner can read coords directly off
        // the destination instead of falling back to candidate lookup.
        lat: (typeof c.lat === "number" && isFinite(c.lat)) ? c.lat : null,
        lng: (typeof c.lng === "number" && isFinite(c.lng)) ? c.lng : null,
        days:makeDays(id,c.place,c.place,dateFrom,nights),
        trackerItems:{booked:[],see:[],visited:[]}, trackerCat:"booked", storyState:"idle",
        hotelBookings:[], generalBookings:[], locations:[],
        execMode:false, todayItems:[], discoveredItems:[], suggestions:[],
        attachedEvents: findAttachedEvents(c, _mdcItems||[])
      };
      trip.destinations.push(dest);
      cur = next;
      // PD.325: kick off city data generation through the throttled
      // queue. Was: parallel Promise.resolve().then(generateCityData)
      // for every accepted candidate. Multi-candidate accept could
      // fire 5+ LLM calls in parallel — same bombardment pattern.
      if (typeof MaxEnrich !== "undefined") {
        MaxEnrich.enqueue(id, c.place);
      } else {
        Promise.resolve().then(function(){return generateCityData(c.place, id);}).catch(function(){});
      }
    });
    // Scroll to first newly-added destination after re-render.
    if (_firstAddedDestId) {
      requestAnimationFrame(function(){
        try {
          var el = document.querySelector('.tm-dest[data-id="'+_firstAddedDestId+'"]');
          if (el && typeof el.scrollIntoView === "function") {
            el.scrollIntoView({behavior: "smooth", block: "center"});
          }
        } catch(_){}
      });
    }
  }

  // PD.456: regenerate the trip snapshot through the ONE projection — same
  // function publishTrip uses, so the two birth sites can't carry different
  // field sets (this path used to persist order/manuallyOrdered that publish
  // dropped). Inline fallback only for load-order safety.
  var _MC = (typeof MaxCandidates !== "undefined" && MaxCandidates)
    || (typeof global !== "undefined" && global.MaxCandidates)
    || (typeof window !== "undefined" && window.MaxCandidates) || null;
  if (_MC && typeof _MC.snapshotFrom === "function") {
    trip.candidates = _MC.snapshotFrom(_tb.candidates || []);
  } else {
    trip.candidates = (_tb.candidates||[]).map(function(c){
      return {
        id:c.id, place:c.place, country:c.country||null, role:c.role||null,
        whyItFits:c.whyItFits||"", tags:c.tags||[], tradeoffs:c.tradeoffs||null,
        stayRange:c.stayRange||"", lat:c.lat||null, lng:c.lng||null,
        nights: (typeof c.nights === "number") ? c.nights : undefined,
        status:c.status||null, _required:!!c._required, _requiredFor:(c._requiredFor||[]).slice(),
        overnightCapable: (typeof c.overnightCapable === "boolean") ? c.overnightCapable : null,
        order:(typeof c.order==="number"?c.order:null), manuallyOrdered:!!c.manuallyOrdered,
        _roleTouched: !!c._roleTouched,
        dayTripHub: c.dayTripHub || undefined,
        waysideFromHub: c.waysideFromHub || undefined,
        intent: c.intent || undefined
      };
    });
  }
  trip.placeActivities = (_mdcItems||[]).map(function(m){return {
    id:m.id, name:m.name, type:m.type, checked:m.checked,
    requiredPlaces:m.requiredPlaces, endpoints:m.endpoints, viableLocations:m.viableLocations,
    direction:m.direction, durationHours:m.durationHours,
    modeOptions:m.modeOptions, alternatives:m.alternatives, reservationNotes:m.reservationNotes,
    recovery:m.recovery, frequencyRequirement:m.frequencyRequirement,
    conditionNote:m.conditionNote, description:m.description, chosenMode:m.chosenMode||null
  };});

  autoSave && autoSave();
  localSave && localSave();

  _ceEditMode = false;
  g("candidate-explorer-overlay").style.display="none";
  if(_ceMap){_ceMap.remove();_ceMap=null;} _cePolyline=null; if(_edMap){try{_edMap.remove();}catch(e){}_edMap=null;_edMarkers=[];}
  _emitTripMutation();
}

// PD.183 (architectural): the Candidate Explorer is OBSOLETE as of
// the picker-flow refactor (PD.181 routes around it; PD.182 moved
// the only salvageable piece — the realism check — onto the trip
// view). The picker handles every curation responsibility this
// overlay used to own (keep/reject, day-trip/on-the-way assignment,
// re-edit). Enhance (PD.111) covers the "Max-suggested discoveries"
// role. The overlay's HTML, CSS, and rendering functions remain in
// the codebase for trips built before PD.181, but no supported flow
// should reach this function. Future cleanup PD: delete entirely.
function showCandidateExplorer(cands, editMode){
  _ceEditMode = !!editMode;
  g("trip-brief-overlay").style.display="none";
  var ov=g("candidate-explorer-overlay");
  // The overlay is authored inside #home-screen, which gets display:none after
  // enterApp(). A display:none ancestor hides the subtree even with position:fixed,
  // so re-parent to document.body to guarantee visibility in every mode.
  if (ov.parentElement !== document.body) document.body.appendChild(ov);
  ov.style.display="block"; ov.className="ce-overlay";
  // PD.333 (audit A1): the candidate explorer is the SECOND Discovery
  // surface — and it was invisible to the router. The activity picker
  // stamps #/trip/<id>/discovery (PD.331) but this one never did, so
  // an explorer session ran with the URL still at #/trip/<id>: a hard
  // refresh "landed on trip view" — faithfully rendering a URL that
  // was never told the user was in Discovery. Stamp here (replace —
  // bookkeeping, this render IS the screen). _dispatchRoute's
  // DISCOVERY branch picks this surface back up on boot when the trip
  // has candidates but no placeActivities.
  try {
    if (typeof MaxRoute !== "undefined" && trip && trip.id) {
      var _curCeR = MaxRoute.parse();
      if (!_curCeR || _curCeR.screen !== MaxRoute.SCREENS.DISCOVERY || _curCeR.tripId !== trip.id) {
        MaxRoute.navigate({ screen: MaxRoute.SCREENS.DISCOVERY, tripId: trip.id }, { replace: true });
      }
    }
  } catch(_){}
  // v294.10: header title + subtitle removed. The framing \u2014 what Max
  // gathered, what to keep, etc. \u2014 was already established on the
  // place-mode picker upstream. Repeating it here was redundant and
  // labeled this stage as "Places to think about" when the user is
  // already past picking and is shaping the itinerary. Keep just
  // the buttons (Edit why & where / Edit how you travel) on a slim
  // header so the affordances stay visible.
  ov.innerHTML='<div class="ce-header" style="padding-top:8px;padding-bottom:8px;">'
    // v359.60.34: Home button on the candidate-explorer header too.
    // Picker chrome already has Home; the legacy explorer didn't, so
    // a user mid-research with this overlay open had no way back to
    // the trips list without committing or canceling.
    +'<button style="font-size:11px;padding:5px 11px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:#333;font-weight:600;" onclick="cancelCandidateExplorer&amp;&amp;cancelCandidateExplorer();goHome();">&larr; Home</button>'
    +(_ceEditMode
      ? '<button style="font-size:11px;padding:5px 11px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:#333;font-weight:500;" onclick="cancelEditCandidates()">Cancel</button>'
      : '<button style="font-size:11px;padding:5px 11px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:#333;font-weight:500;margin-right:6px;" onclick="editWhereWhy()" title="Where you\'re going + what\'s drawing you to it">\u2190 Trip brief</button>'+'<button style="font-size:11px;padding:5px 11px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:#333;font-weight:500;margin-right:6px;" onclick="editHowYouTravel()" title="Your travel preferences \u2014 pace, accommodation, mobility">Travel style</button>'+'<button style="font-size:11px;padding:5px 11px;border:1px solid var(--c-border-blue);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:var(--c-primary);font-weight:600;" onclick="if(typeof _reopenPickerAny===&quot;function&quot;)_reopenPickerAny();else if(typeof reopenPickerForEdit===&quot;function&quot;)reopenPickerForEdit();" title="Reopen Discovery to add or curate more places">\ud83e\udded Discovery</button>')
    +'</div>'
    +'<div class="ce-body">'
    +'<div class="ce-left">'
    // Shortlist pills retired — the summary at top of ce-cards carries this info now.
    +'<div class="ce-cards" id="ce-cards">'
    +(cands?'':'<div class="ce-loading" id="ce-loading">'      +'<span class="ce-loading-spin">\u2736</span>'      +'<div class="max-thinking" style="font-size:12px;font-weight:600;color:var(--c-ink-2);margin-bottom:5px;">Building your trip\u2026</div>'      +'<div id="ce-loading-detail" style="font-size:10px;color:var(--c-ink-4);line-height:1.7;">This usually takes 20\u201340 seconds.<br>Max is shaping your picks into a sequenced itinerary.</div>'      +'</div>')
    +'</div></div>'
    +'<div class="ce-right"><div id="ce-map" class="ce-map"></div></div>'
    +'</div>'
    +'<div class="ce-footer">'
    +'<span style="font-size:10px;color:var(--c-ink-3);" id="ce-cnt">0 kept</span>'
    +'<button id="ce-ep-toggle" onclick="_tbToggleEntryPoints()" style="font-size:10px;padding:4px 9px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-bg);cursor:pointer;font-family:inherit;color:#444;margin-left:10px;">Hide entry points</button>'
    // v353.2: only show the commit button after candidates have loaded.
    // Previously it was visible during the "Building your trip\u2026"
    // loading state \u2014 looked tappable but committed nothing useful,
    // since there were no candidates to commit. Now it appears only
    // when there's something to act on.
    +(_ceEditMode
      ? '<button class="ce-build-btn" id="ce-build-btn" disabled onclick="applyCandidateChanges()">Apply changes \u2192</button>'
      : (cands
          ? '<button class="ce-build-btn" id="ce-build-btn" onclick="closePlacesOverlay()">Create a plan \u2192</button>'
          : ''))
    +'</div>';
  setTimeout(function(){
    // Fix flex height collapse before map init
    var ov2=document.getElementById("candidate-explorer-overlay");
    var hdr2=ov2?ov2.querySelector(".ce-header"):null;
    var ftr2=ov2?ov2.querySelector(".ce-footer"):null;
    var bdy2=ov2?ov2.querySelector(".ce-body"):null;
    var lft2=ov2?ov2.querySelector(".ce-left"):null;
    var rgt2=ov2?ov2.querySelector(".ce-right"):null;
    var avail=(window.innerHeight-(hdr2?hdr2.offsetHeight:60)-(ftr2?ftr2.offsetHeight:44));
    if(bdy2){bdy2.style.height=avail+"px";bdy2.style.flex="none";bdy2.style.overflow="hidden";}
    if(lft2){lft2.style.height=avail+"px";lft2.style.overflow="hidden";lft2.style.display="flex";lft2.style.flexDirection="column";}
    if(rgt2){rgt2.style.height=avail+"px";}
    var mapDiv=document.getElementById("ce-map");
    if(mapDiv){mapDiv.style.height=avail+"px";mapDiv.style.width="100%";}
    var cds=document.getElementById("ce-cards");
    if(cds){cds.style.flex="1";cds.style.overflowY="scroll";cds.style.minHeight="0";}
    // Init map
    if(_ceMap){_ceMap.remove();_ceMap=null;} _cePolyline=null; if(_edMap){try{_edMap.remove();}catch(e){}_edMap=null;_edMarkers=[];} _ceMarkers=[];
    // Figure out the best initial view BEFORE the map loads tiles — otherwise
    // the user sees all of Europe for a second before we zoom. Order of truth:
    //  1. Cached coarse geocode for the trip's region
    //  2. Bounds derived from any places already geocoded by the picker (this
    //     gives a perfect Switzerland-shaped view when coming from place mode)
    //  3. First candidate with real coords
    //  4. Fallback: Europe-ish, with a mask covering the flash
    var _regionKey = ((_tb && _tb.region) || "").toLowerCase().trim();
    var _cachedLL = _regionKey && _coarseGeocode[_regionKey] ? _coarseGeocode[_regionKey] : null;
    var _firstCand = (cands||[]).find(function(c){return c && isFinite(c.lat) && isFinite(c.lng);});
    // Pull bounds from any geocoded picker places. _tb.placeActivities (place
    // mode) and _mdcItems (any mode after the picker) carry the candidate
    // place names; _coarseGeocode usually has them by the time we're here
    // because the picker map already kicked off geocodes.
    var _pickerBounds = (function(){
      var pts = [];
      var pushFrom = function(items){
        (items||[]).forEach(function(it){
          (it.requiredPlaces||[]).forEach(function(p){
            if (!p || !p.place) return;
            var ll = _coarseGeocode[(p.place||"").toLowerCase()];
            if (ll && isFinite(ll[0]) && isFinite(ll[1])) pts.push(ll);
          });
        });
      };
      pushFrom(_tb && _tb.placeActivities);
      pushFrom(_mdcItems);
      return pts.length >= 2 ? pts : null;
    })();
    var _initBounds = null, _initCenter = null, _initZoom = null;
    // Round FU.1: when the user has stated a region AND the seed has
    // it, prefer the seed over _pickerBounds. _pickerBounds pulls from
    // any cached place geocodes, which can leak in prior-trip Swiss
    // coords if _tb.placeActivities or _mdcItems carry stale data.
    // The seeded region is the user's actual stated intent — high
    // signal — so it wins. Picker bounds remain the secondary path
    // for unseeded regions where we have no anchor.
    if (_cachedLL) { _initCenter = _cachedLL; _initZoom = 6; }
    else if (_pickerBounds) { _initBounds = _pickerBounds; }
    else if (_firstCand) { _initCenter = [_firstCand.lat, _firstCand.lng]; _initZoom = 6; }
    else { _initCenter = [48,14]; _initZoom = 4; }
    _ceMap = L.map("ce-map", {zoomControl:true, scrollWheelZoom:true});
    if (_initBounds) {
      try { _ceMap.fitBounds(_initBounds, {padding:[28,28], maxZoom:8, animate:false}); }
      catch(_) { _ceMap.setView([48,14], 4); }
    } else {
      _ceMap.setView(_initCenter, _initZoom);
    }

    // If we started with the Europe fallback, drop a neutral loader over the
    // map so the continent flash never hits the user's eye. Removed as soon
    // as Nominatim or a candidate gives us a real center.
    // Mask for the brief window before the map has a real view. Skip when we
    // already have picker bounds, the cached region, or candidates \u2014 those
    // give us an accurate view from frame zero.
    var _mapMask = null;
    if (!_initBounds && !_cachedLL && !_firstCand && _tb && _tb.region) {
      _mapMask = document.createElement("div");
      _mapMask.id = "ce-map-mask";
      _mapMask.style.cssText = "position:absolute;inset:0;z-index:450;background:#f4f6f8;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--c-ink-3);font-size:11px;font-family:inherit;pointer-events:none;";
      _mapMask.innerHTML = '<span style="font-size:18px;animation:spin 1.2s linear infinite;">\u2736</span><span>Locating '+(_tb.region||"your region")+'\u2026</span>';
      var _mapDivEl = document.getElementById("ce-map");
      if (_mapDivEl) { _mapDivEl.style.position = "relative"; _mapDivEl.appendChild(_mapMask); }
    }

    // Recompute size + view once the panel layout has settled. Without this,
    // the map renders at its initial container size, then the cards panel
    // pushes it smaller and the view shifts. invalidateSize + re-fit keeps
    // the framing stable.
    setTimeout(function(){
      if (!_ceMap || !_ceMap.invalidateSize) return;
      try { _ceMap.invalidateSize(); } catch(_){}
      if (_initBounds) {
        try { _ceMap.fitBounds(_initBounds, {padding:[28,28], maxZoom:8, animate:false}); } catch(_){}
      }
    }, 120);

    // Zoom to the stated region right away so the user sees their country/area
    // instead of a continent. fitBounds on candidates (later, when they arrive)
    // will refine further. Also caches the result in _coarseGeocode so future
    // trips to this region skip the lookup entirely. SKIP this when we already
    // have picker bounds or a cached center \u2014 otherwise the map would pan
    // away from the picker view to a less-tight country bounding box.
    if (!_initBounds && !_cachedLL && _tb && _tb.region) {
      (function(r, regionKey){
        fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(r),{headers:{"Accept-Language":"en"}})
          .then(function(res){return res.json();})
          .then(function(data){
            if (data && data.length && data[0].boundingbox && _ceMap) {
              var bb = data[0].boundingbox.map(parseFloat);
              _ceMap.fitBounds([[bb[0],bb[2]],[bb[1],bb[3]]], {padding:[20,20], maxZoom:7});
              if (regionKey && data[0].lat) _coarseGeocode[regionKey] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
            } else if (data && data.length && data[0].lat && _ceMap) {
              var lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
              _ceMap.setView([lat, lon], 6);
              if (regionKey) _coarseGeocode[regionKey] = [lat, lon];
            }
          }).catch(function(){})
          .finally(function(){
            var mm = document.getElementById("ce-map-mask");
            if (mm && mm.parentNode) mm.parentNode.removeChild(mm);
          });
      })(_tb.region, _regionKey);
    } else if (_mapMask) {
      // No region to look up — remove the mask so it doesn't linger.
      if (_mapMask.parentNode) _mapMask.parentNode.removeChild(_mapMask);
    }
    // v353.2: candidate-explorer ("Building your trip…") map now uses
    // satellite imagery to match the rest of the app. Same Esri
    // World_Imagery + Carto light_only_labels stack used by the
    // trip-overview map, larger-map popup, and place-picker map.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{attribution:"© Esri",maxZoom:19}).addTo(_ceMap);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",{opacity:1.0,maxZoom:19}).addTo(_ceMap);
    // Drop entry-point pins on the big map (airports, rail, sea, bus) so users
    // can pick where to arrive/depart once they see the region.
    if (_tb && _tb.region) _ensureEntryPointsForRegion(_tb.region);
    if(cands) {
      renderCandidateCards(cands);
      // Show notice if discovery candidates failed to load
      if(_tb.p2Failed && cands.filter(function(c){return !c._required;}).length === 0) {
        var note = document.createElement("div");
        note.style.cssText = "margin:8px 4px;padding:8px 10px;background:#fff9f0;border:1px solid #f0dcc0;border-radius:6px;font-size:10px;color:var(--c-warn);line-height:1.5;";
        note.innerHTML = "\u26a0 Couldn\u2019t load discovery suggestions. <span style=\"cursor:pointer;text-decoration:underline;\" onclick=\"retryDiscoveryCandidates()\">Try again</span>";
        var el = document.getElementById("ce-cards");
        if(el) el.insertBefore(note, el.firstChild);
      }
    }
  },80);
}

// Geocode any candidates that still have placeholder (0,0) coordinates via Nominatim.
// Required stops especially often come back from p1 without real coords because the
// example JSON shape has lat:0.0,lng:0.0 and models copy it verbatim. Runs in the
// background after cards render; re-renders once coords land so pins appear.
//
// Also: verify candidates that DO have coords but whose coords look suspicious —
// e.g. a lat/lng swap that drops Tirano (Italy) into the Indian Ocean off Africa.
// Any candidate whose country is known and whose coord is more than ~300km from
// the Nominatim result gets corrected.
var _geocodeInFlight = false;
async function geocodeMissingCoords(cands){
  if (_geocodeInFlight) return; // one pass at a time
  if (!cands || !cands.length) return;
  var need = cands.filter(function(c){
    if (c._geocodeFailed || c._geocodeVerified) return false;
    // Always geocode if coords are missing / zero / out-of-range.
    if (!isFinite(c.lat) || !isFinite(c.lng)) return true;
    if (!c.lat || c.lat === 0) return true;
    if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return true;
    if (Math.abs(c.lat) < 1 && Math.abs(c.lng) < 1) return true;
    // Otherwise verify once if we already marked this tried (legacy) but not verified.
    return !c._geocodeTried;
  });
  if (!need.length) return;
  _geocodeInFlight = true;
  var progressed = false;
  try {
    var region = (_tb && _tb.region) ? _tb.region : "";
    for (var i = 0; i < need.length; i++) {
      var c = need[i];
      c._geocodeTried = true;
      // Bias the geocoder toward the trip's region so user-typed manual must-dos
      // ("Apenzell" for a Swiss Alps trip) don't match same-named places elsewhere
      // (Apenzell, Nevada). Country takes precedence when we have it.
      var qParts = [c.place];
      if (c.country) qParts.push(c.country);
      else if (region) qParts.push(region);
      var q = qParts.join(", ");
      try {
        var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
          + encodeURIComponent(q), {headers:{'Accept-Language':'en'}});
        var data = await r.json();
        // If the region-biased query returned nothing, retry with just the place name —
        // better to have bad coords than none.
        if ((!data || !data.length) && !c.country && region) {
          r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='
            + encodeURIComponent(c.place), {headers:{'Accept-Language':'en'}});
          data = await r.json();
        }
        if (data && data.length && data[0].lat && data[0].lon) {
          var nLat = parseFloat(data[0].lat), nLon = parseFloat(data[0].lon);
          var curLat = c.lat, curLon = c.lng;
          var hadCoords = isFinite(curLat) && isFinite(curLon) && (curLat !== 0 || curLon !== 0);
          var offKm = hadCoords ? Math.sqrt(Math.pow(curLat - nLat, 2) + Math.pow(curLon - nLon, 2)) * 111 : Infinity;
          if (!hadCoords || offKm > 300) {
            if (hadCoords) console.warn("[Max] correcting " + c.place + " — LLM coord was " + offKm.toFixed(0) + "km off, using Nominatim");
            c.lat = nLat;
            c.lng = nLon;
            progressed = true;
          }
          c._geocodeVerified = true;
        } else {
          c._geocodeFailed = true;
        }
      } catch(e) {
        c._geocodeFailed = true;
      }
      // Pace requests — Nominatim asks for <1 req/sec; 250ms is safe for small batches
      await new Promise(function(res){ setTimeout(res, 250); });
    }
    if (progressed) {
      if (typeof autoSave === "function") autoSave();
      // Re-render so pins appear on the map
      if (document.getElementById("candidate-explorer-overlay")
          && document.getElementById("candidate-explorer-overlay").style.display !== "none") {
        renderCandidateCards(cands);
      }
    }
  } finally {
    _geocodeInFlight = false;
  }
}

// Module-level state for the inline trip-details strip. Preserves expand/
// collapse across re-renders without forcing the user to reopen it after
// every keep/reject. Starts true — this is where entry/exit cities are
// decided now (moved out of Step 2 per "where to fly into should be after
// you select places").
var _tripDetailsExpanded = true;

// Rebuild the freeform _tb.gettingTo / _tb.gettingOut summary strings from
// the structured inline fields. The rest of the pipeline (LLM prompts, brief
// block) still expects these summary strings, so keep them in sync.
function _rebuildGettingToFromFields(){
  var gtParts = [];
  if (_tb.arrivalNumber) gtParts.push(_tb.arrivalNumber);
  if (_tb.arrivalTime)   gtParts.push("arriving " + _tb.arrivalTime);
  if (_tb.entry)         gtParts.push("into " + _tb.entry);
  if (_tb.when && /\d{4}-\d{2}-\d{2}/.test(_tb.when)) gtParts.push("on " + _tb.when);
  _tb.gettingTo = gtParts.join(", ");
  var goParts = [];
  if (_tb.departureNumber) goParts.push(_tb.departureNumber);
  if (_tb.departureTime)   goParts.push("departing " + _tb.departureTime);
  if (_tb.tbExit)          goParts.push("from " + _tb.tbExit);
  if (_tb.departureDate)   goParts.push("on " + _tb.departureDate);
  _tb.gettingOut = goParts.join(", ");
}
