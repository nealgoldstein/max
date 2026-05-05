// max-v292.1 — Hotfix on MA.4: I forgot to add the
// `<script src="trip-ui.js">` tag to index.html. Mobile loaded it
// directly; desktop didn't. The inline mkItinItem delegator threw
// `ReferenceError: MaxTripUI is not defined` on every render, which
// the Playwright spec caught immediately. (This is exactly why the
// spec was paired with the lift.)
//
// Fix: one new <script> line. trip-ui.js loads after picker-ui.js,
// before the inline <style>. No other code changes.
//
// max-v292 — Round MA.4: actual lift of mkItinItem + mkDay.
//
// What MA.3 promised but didn't ship — moving the ~370-line
// mkItinItem body out of index.html — happens here. The function
// now lives in trip-ui.js as `renderItinItemFull`. Its 17 cross-
// references to inline globals (fS, autoSave, drawDestMode,
// getDest, _sightExternalUrl, _openSightUrlEditor, sStory, togMov,
// toggleSightBookForm, delS, fmtD, checkTimeConflicts,
// removeDayTripFromDayItem, ungroupDayTrip, _generatedCityData,
// _activeDmSection, sidCtr, highlightSightOnMap) are all prefixed
// `global.X` so they resolve from the IIFE's scope chain.
//
// Inline desktop's mkItinItem and mkDay are now thin delegators —
// 5 lines each — that route through MaxTripUI.renderItinItem and
// MaxTripUI.renderDay. The function NAMES are preserved so the
// dozens of inline call sites (drag-drop replacements, scheduled-
// item rebuilds, onclick handlers in row buttons) keep working.
//
// index.html went from 24,174 → 23,794 lines (-380). Both desktop
// (full mode) and mobile (compact mode) now flow through one body
// in one file, dispatched by `opts.compact`.
//
// New regression spec at tests/playwright/itin-item.spec.js
// exercises every button on every row type to catch any reference-
// prefix typo. In-sandbox smoke (against mobile/index.html with
// stubbed globals) confirmed:
//   * 4 row types render (sight-must, sight-nice, restaurant, daytrip)
//   * Priority dot toggles must ↔ nice
//   * Done toggles s.done
//   * Daytrip "Plan transport" + "Cancel day trip" render
//   * All 33 `global.X` references resolve without throwing
//   * No console / page errors
//
// Path-to-10 Item C: mkItinItem + mkDay both ticked.
//
// max-v291 — Round MA.3: unified itinerary-item entry point.
//
// New surface in trip-ui.js:
//   MaxTripUI.renderItinItem(s, dayId, destId, opts)
//     opts.compact: true  → renderItinItemCompact (mobile path)
//     opts.compact: false → delegate to window.mkItinItem (the
//                           inline 370-line desktop renderer; not yet
//                           moved into trip-ui.js)
//
//   MaxTripUI.renderDay(day, destId, opts)
//     Now picks the item renderer via opts.compact, routing
//     through renderItinItem (which itself dispatches).
//
// Mobile updated to call renderDay({compact: true}) so the routing
// is visible in code instead of mobile reaching directly for the
// compact helper.
//
// HONEST SCOPE NOTE: this round CLAIMS the API surface but does NOT
// move the inline mkItinItem body (~370 lines, 17 cross-references
// to other inline globals: fS, autoSave, drawDestMode, getDest,
// _sightExternalUrl, _openSightUrlEditor, sStory, togMov,
// toggleSightBookForm, delS, fmtD, checkTimeConflicts,
// removeDayTripFromDayItem, ungroupDayTrip, _generatedCityData,
// _activeDmSection, sidCtr). MA.4 does the actual lift, in a round
// dedicated to careful Playwright coverage. After MA.4, both
// surfaces flow through one body in trip-ui.js, gated only by a
// `compact` flag on the buttons/affordances.
//
// Why this matters even without moving code: the two surfaces now
// have one named contract instead of two. Any future caller goes to
// MaxTripUI.renderItinItem instead of guessing whether to call the
// inline or the compact. MA.4's lift becomes mechanical instead of
// API-redesigning.
//
// max-v290.2 — Hotfix #2 on v290's priority dot hit target: even
// !important class style wasn't winning the cursor fight on the
// user's browser. Set cursor:pointer INLINE on the dot button —
// inline beats both class !important and the row's inline grab
// without ambiguity. Also draggable=false on the button so it can't
// participate in drag detection at all.
//
// max-v290.1 — Hotfix on v290's priority dot hit target: cursor
// wasn't switching to pointer on hover. The row's inline
// `cursor:grab` was winning over the .item-dot-wrap class rule on
// some browsers. Added !important on the wrap's cursor + forced
// cursor:pointer on all descendants so the affordance is visible
// regardless of where on the wrap the user hovers.
//
// max-v290 — Symmetric desktop ↔ mobile sync + priority-dot hit
// target + mobile change-flash.
//
// Three small things shipped together:
//
//   1. Desktop storage listener.
//      Mirror of mobile's listener: window 'storage' event triggers
//      a re-load + re-render when another tab writes the active
//      trip's localStorage key. Mirrors mobile's mid-edit guard so
//      an open textarea/input on desktop doesn't get clobbered;
//      shows "Other tab edited this trip — switch focus to refresh"
//      and waits for the next storage event after blur. Closes the
//      mobile → desktop side of the sync that was previously
//      manual-refresh-only.
//
//   2. Mobile flash on changed destination card.
//      mobile/index.html keeps a per-render fingerprint of each
//      destination's itinerary (day → item ids + names + done +
//      priority). After a render, any destination whose fingerprint
//      changed gets a 1.2s yellow flash. Lets the user see at a
//      glance which card just updated when desktop pushed a change.
//
//   3. Priority-dot hit target.
//      The 7px .item-dot-sight on each Itinerary row was too small
//      to click reliably — and on slow clicks the row's draggable
//      ate the event. Now wrapped in a .item-dot-wrap button with
//      transparent ~22px hit area (padding offset by negative
//      margin to keep layout unchanged), cursor:pointer, hover
//      preview, focus-visible outline, stopPropagation so drag
//      detection can't intercept.
//
// max-v289 — Round MA.2: shared trip-view rendering seam.
//
// New file: trip-ui.js. Mobile uses it; desktop will switch in MA.3.
// Path-to-10 Item C ("big DOM blocks still inline in
// renderCandidateCards / drawDestMode") gets its first chip out:
// mkDay/mkItinItem now have a shared peer (renderDay/
// renderItinItemCompact) that mobile consumes.
//
// Why a shared SEAM in this round, not the full lift:
//   The desktop's mkItinItem is ~330 lines — drag handles, time
//   editor, booking forms, day-trip sub-rows w/ transport buttons +
//   suggestion chips. Lifting that whole + adding a `compact` flag
//   was tempting but biggish for one round, and would put the entire
//   destination view at risk if the lift broke. Instead this round
//   ships:
//
//   • trip-ui.js — the new module, IIFE pattern matching picker-ui.js
//   • MaxTripUI.renderItinItemCompact — minimal sight/restaurant/
//     daytrip row: priority dot, name (with tap-to-highlight via the
//     v287 highlightSightOnMap), optional time, done indicator,
//     inline note. No buttons, no drag, no edit — read-mostly.
//   • MaxTripUI.renderDay — same .dayblock/.dayhdr/.slist scaffolding
//     desktop uses, so the visual language matches.
//   • Mobile destination cards now show day-by-day Itinerary inline
//     under the Notes textarea, populated via MaxTripUI.renderDay.
//   • Empty days are skipped; a card with no item-having days shows
//     "No items planned yet — see desktop to add some."
//
// MA.3 will lift the full mkItinItem here with a `compact` flag,
// at which point both surfaces call the same code and differ only
// in which buttons render. After that, the path-to-10 Item C list
// for renderCandidateCards still has _renderMustDoSection,
// renderCard, _renderTripDetailsStrip, time-lens — but the
// destination view's biggest two functions are out.
//
// max-v288 — Differentiate the two "tell us about the trip" fields.
//
// Two textareas in the brief used to overlap heavily — both asking
// "tell us about you / pace / prior experience / what you'd
// compromise on" in slightly different words. Reframed each so they
// answer different questions:
//
//   Field 1 — _tb.placeContext (right after picking the place,
//   on the brief's first step):
//     "Why this place? What's drawing you?"
//     Examples: "always wanted to see the Alps", "my grandmother
//     grew up there", "honeymoon", "scenic-rail trip we've put off
//     for years". Destination framing only — the sentence behind
//     the trip.
//
//   Field 2 — _tb.aboutTrip (later in brief, was "Anything else"):
//     "Who's traveling? How do you travel?"
//     Examples: "Couple in our 60s, slow pace, first time in the
//     region. Would skip a touristy day-trip; wouldn't skip a
//     unique view." Party + pace + experience + compromises.
//
// Both placeholder + label/section-header copy updated. The data
// fields and engine paths are untouched — the LLM still reads both
// as prose; this is purely UX clarity. Two callsites for Field 2
// (regular brief at line ~8988 and place-mode brief at line ~9242).
//
// max-v287.3 — Hotfix #3 on the sight-tap pulse: I wired the click
// onto the wrong renderer. Two row builders existed in this file —
// mkSight (legacy, no longer on the live render path) and
// mkItinItem (what the Itinerary tab actually calls). v287 wired
// mkSight; clicking sight names did nothing because those rows
// were built by mkItinItem. Wired correctly now.
//
// max-v287.2 — Hotfix #2 on the sight-tap pulse: removed the `transform:
// scale(…)` keyframes. CSS animations override inline styles, and
// Leaflet positions markers via inline `transform: translate3d(...)`.
// The animating transform was snapping the marker to the pane origin
// during the pulse, making the icon "blink" off-screen instead of
// pulsing in place. Now box-shadow is the only animated property —
// gold rings ripple outward from a marker that stays put.
//
// max-v287.1 — Hotfix on the sight-tap pulse: filter:drop-shadow gold
// halo wasn't visible in Leaflet's marker pane (filter clipping
// against the parent pane on some browsers). Switched to box-shadow
// rings that ripple outward — same gold, visible everywhere.
//
// max-v287 — Tap a sight name in the destination view's Itinerary
// → its pin highlights on the main map.
//
// Adds: a global _mainMarkerByItemId index built up inside addPin
// (keyed by item.id), reset in clearMainMarkers. Plus a helper
// highlightSightOnMap(sightId) that flies the map to that marker,
// opens its tooltip briefly, and runs a CSS pulse on the pin
// element (gold-glow filter, 1.6s).
//
// mkSight wires the sight-name span's onclick to call the helper.
// The name now has a hover background and pointer cursor so it
// reads as tappable.
//
// No engine API change — this is pure desktop UI plumbing.
//
// max-v286.1 — Hotfix: desktop notes save was failing because v286
// used trip.id (undefined; the inline script keys trips by the
// _currentTripId global) instead of localSave(). Repointed at
// localSave — the proven path everything else uses; underlying
// localStorage.setItem still fires the cross-tab storage event so
// mobile sync remains intact.
//
// max-v286 — Notes from the road on desktop destination view.
//
// Pairs with v285's mobile shell. The mobile shell wrote
// dest.travelerNotes but desktop had no render for it — invisible
// on the surface where the user spends their time. Now visible.
//
// Render: a persistent strip between the destination header and the
// tab bar. Always visible, regardless of active tab (Itinerary /
// Explore / Stay / Routing / On the ground / Tracking). Bordered
// off-white panel, "Notes from the road" small-caps header,
// textarea pre-filled with dest.travelerNotes, italic placeholder
// when empty.
//
// Save: on blur. Goes through MaxDB.trip.writeRaw (same path the
// inline serializer + saver uses), so cross-tab storage events
// propagate to any open mobile tabs and they re-render. The save
// path bypasses Phase 2 mutators because nothing structural is
// changing — just a free-text field.
//
// Status indicator: small "saved" / "save failed" cue in the
// header strip's right edge. Fades after 1.8s on success.
//
// max-v285 — Round MA.1: mobile shell (read-only trip view + notes).
//
// First proof-of-life for the engine extraction's whole reason to
// exist. New file: `mobile/index.html`. Loads `db.js` and
// `engine-trip.js` — zero imports from `index.html` or
// `picker-ui.js`. The mobile bundle is the entire mobile bundle.
//
// What it does:
//   • Lists trips from MaxDB.index.list()
//   • Opens one trip from MaxDB.trip.read(id)
//   • Renders destinations as a phone-first card list — place,
//     date range, nights, an editable notes textarea
//   • Notes save via MaxDB.trip.write on debounced input + blur
//   • Cross-tab sync: window 'storage' event listener re-renders
//     when desktop writes the same trip key. Status pill in the
//     header shows "saved" / "updated" / "pending" as appropriate.
//   • Hash-based routing (#/trip/{id}) so individual trips are
//     bookmarkable / "Add to Home Screen"-able as deep links.
//
// What it deliberately does NOT do:
//   • The picker. Decision (per architecture-engine-ui-split.md):
//     planning stays on desktop, mobile is execution-only.
//   • Mutations beyond notes. Anything that calls a Phase 2
//     mutator (date edits, day-trip moves, buffer night adds)
//     still goes through the inline drawTripMode path — those
//     call sites would 404 from mobile. Item A's mutator
//     conversions unblock additional mutations.
//   • Cross-device sync. Same-origin storage events sync across
//     tabs of the same browser only. True device-to-device sync
//     is gated on the Supabase migration (plan-supabase-migration.md).
//
// New schema field: `destination.travelerNotes` — free-form string,
// saved on the trip envelope. Independent of the existing `note`
// field (which carries arrival/departure tags). No engine API
// added — the field is just data the renderer reads.
//
// Path-to-10 progress: MA.1 ✓ (Item B's first concrete round).
// Items A, C, D, E remain.
//
// max-v284 — Patch (post-HX.10): "Show me the best" dead-code removal.
//
// The "Show me the best" / "Show all" header toggle had been removed
// from the visible UI in an earlier round, but the supporting code
// stayed:
//   • bestBtn render block in renderCandidateCards
//   • _ceBestMode global flag (read in 6 places)
//   • shouldShowAllInSection engine API + 4 tests (HX.10 added it
//     specifically to centralize the rule)
//   • "+ N more places for {name}" / "Collapse back to top pick"
//     button pair in _renderMustDoSection
//   • Grayed-pin fallback in _addCandidateMarker (and the "click
//     grayed pin to flip out of best mode" handler)
//   • Best-mode branch of the discoveries section
//
// All gone in v284. The renderer is shorter and cleaner: every
// section always renders all its cards, no second-tier pin treatment,
// no _ceBestMode flag in scope. bestPickFirstSort still earns its
// keep — depth discovery ("+ more like this") relies on it to slot
// new arrivals in the right order after kept items.
//
// Test count: 140 → 136 (removed shouldShowAllInSection's 4 tests).
//
// max-v283 — Patch (post-HX.10): typed entry/exit city refreshes
// the picker map.
//
// Bug: typing a new arrival or departure city in the picker's
// trip-details strip updated _tb.entry / _tb.tbExit and re-rendered
// the candidate cards, but the map didn't visibly respond — neither
// the entry-point overlay (airports / stations / ports) nor the
// viewport. The pin-popup flow (_tbUseEntryPoint) handled this via
// the popup close + re-render path; typing in the text input
// skipped it.
//
// Fix: in the td-entry / td-exit blur handler, after _tb is updated:
//   1. Re-render the entry-point overlay so any state-dependent
//      visuals re-evaluate.
//   2. Look up coords for the typed city in _epCache (airports etc.
//      for the region) and _tb.candidates (destination candidates),
//      diacritic-tolerantly via _normPlaceName, with substring
//      match in either direction so "Reykjavik" finds the local
//      "Keflavík International Airport (KEF) — Reykjavik".
//   3. flyTo the matched coords with a sensible zoom, falling back
//      to setView if flyTo throws (older Leaflet, etc.).
//
// Pure addition: one new helper (_findCityCoordsForMap) and a small
// patch to the existing blur handler. No engine API churn, no test
// changes. Future round can add highlighting of the matched
// entry-point pin (would need _renderEntryPointsOnCeMap to take an
// optional selectedName arg).
//
// max-v282 — Round HX.10: section show-all policy + section title.
//
// Two engine APIs:
//
//   MaxEnginePicker.shouldShowAllInSection(bestMode, sectionOpen, isRoute)
//     The "Show me the best" toggle caps each section to 1 card.
//     Three escape hatches: best mode off, section expanded, or
//     section is a route (route endpoints are not competing
//     options). Centralizes the rule so the renderer just asks.
//
//   MaxEnginePicker.mustDoSectionTitle(mdName, mdItem)
//     Section header copy. Routes get "Bernina · scenic travel"
//     (friendlier than calling them an "activity"); other typed
//     items get "Name · type"; untyped items get just the name.
//     Returns plain text ready for textContent.
//
// 8 new engine tests bringing the total to 140:
//   * shouldShowAllInSection: every (bestMode × sectionOpen × isRoute)
//     decision pinned.
//   * mustDoSectionTitle: route suffix, raw-type pass-through, no-
//     item fallback, null-name fallback.
//
// HX cumulative: 11 rounds, 21 new engine APIs + 8 picker-ui APIs +
// 101 new engine tests, ~370 lines of pure logic / DOM out of the
// monolith.
//
// max-v281 — Round HX.9: section-render policy + route-arrow lookup
// + must-dos summary UI move.
//
// Two engine APIs and one picker-ui move:
//
//   MaxEnginePicker.mustDoSectionRenderable(sectionType, hasGroup)
//     Centralizes the activity-lens decision about whether to draw
//     a section even when there are no candidates. Routes and
//     activities always render (so the user sees their train route
//     name and description before the LLM returns endpoints);
//     conditions and manual only render when there's something
//     concrete in the group. Replaces TWO inline copies of the same
//     `(t === "route" || t === "activity")` check.
//
//   MaxEnginePicker.routeArrow(direction)
//     Direction → unicode arrow lookup. forward (default) → " → ",
//     reverse → " ← ", either → " ↔ ". Replaces TWO inline copies
//     of the same ternary. Three-character strings with surrounding
//     spaces are ready for `eps.map(p => p.place).join(arrow)`.
//
//   MaxPickerUI.renderMustDosSummary(allMustDos)
//     The activity-lens "Your trip includes" header summary —
//     ~70 lines of inline DOM (header, badge labels, route-arrow
//     concatenation, toggle button per row, click wiring against
//     _toggleMustDoFromSummary). Lifted whole into picker-ui;
//     consumes the new MaxEnginePicker.routeArrow internally so
//     the engine helper has both call sites covered. Wraps the
//     filtered allMustDos input the inline caller still computes
//     (allows the renderer to keep shrinking without tying the
//     summary to an _mdcItems global).
//
// 9 new engine tests bringing the total to 132:
//   * mustDoSectionRenderable: route+activity always, condition/
//     manual conditional, unknown type defaults to conditional.
//   * routeArrow: forward (incl. null/undefined defaults), reverse,
//     either, unknown direction falls back to forward.
//
// HX cumulative: 10 rounds, 19 new engine APIs + 8 picker-ui APIs +
// 93 new engine tests, ~360 lines of pure logic / DOM out of the
// monolith. The activity lens's biggest standalone DOM block (the
// summary header) is now a one-line picker-ui call. Two more inline
// copies of common patterns (alwaysRender boolean, route-arrow
// ternary) are gone — the engine owns the rule, every caller
// agrees on its behavior.
//
// max-v280 — Round HX.8: per-lens secondary sort + commitment split
// + Maybe-later UI move.
//
// Two engine APIs and one picker-ui move:
//
//   MaxEnginePicker.regionWithinCountrySort(group)
//     The region-lens within-country sort. Sister to
//     bestPickFirstSort, but the secondary sort is alphabetical-by-
//     place rather than required-first — region view emphasizes
//     geographic relationships, not commitment status.
//
//   MaxEnginePicker.partitionActiveByCommitment(activeCands)
//     The commitment-lens partition. Splits an already-active
//     candidate list (post-partitionByStatus) into kept vs unset.
//     Rejected leakers are silently dropped — contract is "active
//     only".
//
//   MaxPickerUI.renderRejectedSection(rejectedCands)
//     The "Maybe later" collapsible bullet-list at the foot of the
//     picker. ~40 lines of inline DOM (toggle, label, restore
//     buttons) lifted into picker-ui. Reads _ceRejectedExpanded
//     toggle state, calls window.setCS for restore.
//
// 10 new engine tests bringing the total to 123:
//   * regionWithinCountrySort: keep/non-keep tiering, locale-aware
//     alphabetical secondary, fresh-array contract, null inputs,
//     missing-place fallback.
//   * partitionActiveByCommitment: keep/unset split, defensive
//     drop-rejected behavior, null inputs, null entries.
//
// HX cumulative: 9 rounds, 17 new engine APIs + 7 picker-ui APIs +
// 84 new engine tests, ~285 lines of pure logic out of the monolith.
//
// max-v279 — Round HX.7: lens groupings + lens-bar UI move.
//
// Two engine APIs and one picker-ui move:
//
//   MaxEnginePicker.groupByCountry(activeCands)
//     Region-lens primary grouping. Buckets candidates by country
//     (with "Unknown" fallback) and returns countries sorted by
//     bucket size descending, ties broken alphabetically. Replaces
//     the inline grouping-and-sort at the top of the region lens.
//
//   MaxEnginePicker.partitionMustDosByType(mustDoOrder, mdcItems)
//     Activity-lens umbrella partition. Walks the user-sentence-
//     ordered mustDoOrder and groups by type — route / activity /
//     condition / manual — preserving in-type order. Default for an
//     unknown or missing type is "activity" (matches the inline
//     behavior — a custom chip without an explicit type lands in
//     Activities). Returns its own typeOrder so callers don't keep
//     a duplicate constant in sync.
//
//   MaxPickerUI.renderCELensBar()
//     Builds the "Organize by:" chip row (Activity / Region /
//     Status). Click handlers flip _ceLens and re-render the cards.
//     The inline construction (one container, one label, three
//     buttons with click wiring) was about 15 lines of DOM —
//     trivial to lift, and lets future picker-ui rounds own the
//     header surface. Aliased on window for back-compat.
//
// 11 new engine tests bringing the total to 113:
//   * groupByCountry: count-desc sort, alphabetical tiebreaker,
//     "Unknown" fallback, null inputs, null entries.
//   * partitionMustDosByType: in-type ordering, default-to-activity,
//     canonical typeOrder, fresh-array contract, empty inputs.
//
// HX cumulative: 8 rounds, 15 new engine APIs + 6 picker-ui APIs +
// 74 new engine tests, ~245 lines of pure logic out of the monolith.
//
// max-v278 — Round HX.6: bestPickFirstSort + mustDoOrder fix.
//
// Two engine APIs, plus a latent-bug fix as a side benefit:
//
//   MaxEnginePicker.bestPickFirstSort(group)
//     Promotes the inline `bestPickFirst` from renderCandidateCards.
//     Pure sort: keeps lead, then _required within ties. The "Show
//     me the best" toggle slices `bestPickFirstSort(group)[0..1]`,
//     so this function decides which one card represents a section
//     when the picker is showing only highlights.
//
//   MaxEnginePicker.groupCandidatesByMustDo — return shape extended
//     to include `mustDoOrder` (the active must-do names in user-
//     sentence order). Already computed inside the function; HX.6
//     just exposes it. Fixes the bug where HX dropped the inline
//     renderer's duplicate `var mustDoOrder = …` declaration but
//     didn't surface the value back out, leaving an undeclared
//     reference at line ~11296 — which crashed the activity lens
//     (the default) the moment any user opened the Places overlay.
//     The renderer now reads `_hxGrouped.mustDoOrder`.
//
// 8 new engine tests:
//   * mustDoOrder ordering + skip-unchecked-and-__manual__ contract
//   * mustDoOrder = [] when mdcItems is null/empty
//   * bestPickFirstSort: keeps-first, _required within ties (in keeps
//     and non-keeps), returns new array, null/empty input, null
//     entries inside the array.
//
// HX cumulative: 7 rounds, 13 new engine APIs + 5 picker-ui APIs +
// 63 new engine tests, ~210 lines of pure logic out of the monolith.
//
// max-v277 — Round HX.5: kept-list filter + stay-total summary
// computation; renderCEStayTotal moves to picker-ui.
//
// Two engine APIs, one picker-ui move:
//
//   MaxEnginePicker.keptCandidates(cands)
//     The picker's most-repeated one-liner. 11 inline call sites
//     ranged over variants of `(_tb.candidates||[]).filter(c =>
//     c.status === "keep")` — sometimes against _tb.candidates,
//     sometimes against `cands` / `activeCands` / `all`. All 11 now
//     call the engine helper directly. No back-compat shim needed
//     (no old name to alias).
//
//   MaxEnginePicker.computeStayTotalSummary(kept, durationStr)
//     Pure logic behind the picker summary's "your picks: N nights ·
//     trip: M days" line. Composes on parseNightRange +
//     parseTripDuration (HX.4) and returns
//     `{rangeStr, tripStr|null, status}` where status ∈ {empty,
//     unknown, fit, over, under}. Renderer maps status → color and
//     writes the HTML.
//
//   MaxPickerUI.renderCEStayTotal(kept) — picker-ui DOM wrapper.
//     The inline 28-line renderCEStayTotal is now a 5-line picker-ui
//     function: read summary from engine, branch on status, write
//     innerHTML. The inline-script declaration is a thin delegator
//     so existing in-script call sites (updateCEShortlist) keep
//     working unchanged. Color cues unchanged from the original
//     ("subtle hint, no shaming" — over → #c05020, under → #2a7a4e,
//     fit → #555).
//
// 14 new engine tests bringing the total to 94:
//   * keptCandidates: status-equality contract (exact "keep", not
//     "kept"/"KEEP"), null/empty input, null entries-in-array.
//   * computeStayTotalSummary: empty/unknown/fit/over/under, with
//     and without parseable trip duration, single-value vs range
//     formatting.
//
// HX cumulative: 6 rounds, 11 new engine APIs + 5 picker-ui APIs +
// 55 new engine tests, ~190 lines of pure logic out of the monolith.
//
// max-v276 — Round HX.4: parsers + composed day-range summary.
//
// Two pure parsers move to the engine + one composed helper:
//
//   MaxEnginePicker.parseNightRange("2-3 nights" → {min:2,max:3})
//   MaxEnginePicker.parseTripDuration("2 weeks" → {min:14,max:14})
//   MaxEnginePicker.keptDaysRangeText(kept) → "5 days" / "5–7 days" / ""
//
// parseNightRange and parseTripDuration were inline tail-end of the
// inline script (lines ~12063 / ~12074), called by 3+ inline sites
// (renderCEStayTotal, the picker header, the brief-side estimate).
// They're stateless regex parsers — exactly what the engine should
// own — and tests over them lock the regex behavior including the
// dash variants the LLM occasionally returns (en-dash, em-dash).
//
// keptDaysRangeText is the composed helper renderCandidateCards used
// inline. The renderer's `_dayRangeStr = ...` block was 9 lines of
// loop + format; now it's one engine call. The test pins the "any
// unparseable → return empty" contract — we'd rather omit the time
// clause than show the user a partial total that excludes a few of
// their kept places without explanation.
//
// Inline script keeps thin _parseNightRange / _parseTripDuration
// delegators because the underscore names are referenced from
// multiple inline call sites; converting to MaxEnginePicker.* by
// name is a clean future round once the picker UI extraction
// finishes.
//
// 11 new engine tests (3 + 3 + 4 + 1 setup), bringing the total to
// 81. Each parser regex variant pinned, the composed helper's
// "partial totals never escape" contract pinned, edge cases pinned.
//
// max-v275 — Round HX.3: alsoHereText + makeCandidateIcon.
//
// Engine pull: MaxEnginePicker.alsoHereText(cand, primary, mdcItems)
// — what to show under "Also here:" on a candidate card. Reads
// cand.otherAttractions, falls back to the primary must-do's
// endpointHighlights[c.place] for route endpoints. The fallback is
// what makes Chur and Tirano read as more than train stations on
// the Bernina Express; pinning that contract in a test means we
// won't lose the behavior in a future tweak.
//
// picker-ui pull: MaxPickerUI.makeCandidateIcon(cand, grayed,
// selected) — Leaflet div-icon factory for candidate pins. Three
// size+style variants (normal/grayed/selected). Pure factory, no
// state mutation, no engine reads. Continues the "narrow helpers"
// thread alongside the bigger engine extraction — both files grow
// each round.
//
// 4 new engine tests for alsoHereText (otherAttractions wins,
// endpointHighlights fallback for route endpoints, miss returns
// '', null cand safety). Total engine tests now 70.
//
// Renderer body shrinks again — the inline `_mdForPrimary` lookup
// closure and the iconHTML string-builder are both gone.
//
// max-v274 — Round HX.2: per-card classifier + region seed coord.
//
//   MaxEnginePicker.classifyCandidateBadge(cand, primary, mdcItems)
//     The three-way badge decision tree from inside renderCard.
//     Returns { kind, refs, isRoute } where kind ∈ {manual, also,
//     required, none}. The renderer formats HTML for the variant;
//     the engine decides the variant + collects the must-do refs to
//     display + flags whether any ref is a route (for "Stop on" vs
//     "Required for" wording — travelers think of routes as transit
//     between stops, not activities themselves).
//
//   MaxEnginePicker.regionSeedCoord(region, geocodeMap)
//     Pure helper — looks up a region's seed coord from a passed-in
//     geocode map. Returns [lat, lng] or null. Tests can supply a
//     fixture map without touching window state.
//
// 11 new engine tests — 7 for classify (each variant + route-flag
// flip + null safety + in-section-no-extras edge case), 4 for
// regionSeedCoord (case/whitespace, miss, null inputs, non-finite
// coords in the map).
//
// Renderer body shrinks more: the inline isManual/allRefs/otherRefs
// derivation is gone, the `.some(...).find()` route-detect closure
// is gone, the seed lookup is one line. Each piece pulled from the
// monolith leaves cleaner glue code behind.
//
// max-v273 — Round HX.1: more pure derivations out of the monolith.
//
// Two more pieces lifted from renderCandidateCards:
//
//   MaxEnginePicker.applyRequiredAndAutoKeep(cands, requiredPlaces)
//     The pre-render pass that (a) re-checks _required for cands
//     where the brief's required-places list changed since
//     candidate generation, and (b) auto-keeps newly-required
//     cands ONCE — the _autoKeepApplied flag prevents Neal's
//     "edit the brief and watch rejected places retroactively
//     flip back to keep" surprise. Returns
//     { newlyFlagged, newlyKept } for diagnostics + future toasts.
//
//   MaxEnginePicker.partitionByStatus(cands)
//     Splits cands into { active, rejected }. Trivial in
//     isolation, but the test pins the exhaustive-partition
//     contract — every cand lands in exactly one bucket — so a
//     future tweak (third status, etc.) can't silently drop
//     cards from the render.
//
// 7 new engine tests:
//   * apply: flags newly-required, auto-keeps once, doesn't flip
//     a rejected cand back to keep, doesn't re-trigger on second
//     pass (the original Neal complaint), null-input safety.
//   * partition: exhaustive split, null-input safety.
//
// Renderer body shrinks by another ~30 lines. The pattern continues
// to land: pull pure derivation, write tests, leave rendering. The
// monolith is starting to look like glue around engine APIs.
//
// max-v272 — Round HX: extract pure derivations from renderCandidateCards.
//
// First slice of the data-extraction approach to attacking the
// monolithic renderer (renderCandidateCards is ~870 lines, the
// biggest function in the picker UI). Rather than lift-and-shift
// it whole — the same approach that gave us late-bound shim bugs
// in HM — we identify pure data derivation inside the renderer,
// extract those into the engine, and let the renderer become
// "take this data, paint DOM."
//
// Two pieces lifted in HX:
//
//   MaxEnginePicker.groupCandidatesByMustDo(activeCands, mdcItems)
//     The must-do grouping algorithm. Returns
//     { candByPrimary, primaryByCandId, discoveryCands }. Each
//     candidate ends up in exactly one section — its FIRST checked
//     must-do in mdcItems order, falling back to its first real
//     _requiredFor ref if no match, falling back to discoveryCands
//     if no real refs. ~18 lines of pure logic, now testable
//     without spinning up the picker UI.
//
//   MaxEnginePicker.coordSane(seed, lat, lng)
//     Hallucination-distance check (Round FU.2 logic). Returns
//     false for points >2500km from the seed center. Pure helper
//     called per candidate during render.
//
// Both have unit tests in tests/engine-tests.js. The renderer body
// shrinks by ~25 lines net; the engine API grows. Trade is in our
// favor: tests now cover what was previously dead code from the
// engine-test perspective.
//
// Don't lose sight of narrow helpers either — the small _fuCoordSane
// closure that wrapped the seed got pulled in alongside the bigger
// grouping algorithm. Each round both attacks the monolith and
// plucks any small clean helpers it passes by.
//
// Architectural target stays unchanged: each round shrinks the
// inline body and grows the testable engine surface. Eventually the
// renderer is mostly DOM-painting against engine-derived data.
//
// max-v271 — Round HW.1: picker map-pin renderers move to picker-ui.js.
//
// Two helpers, both picker-Leaflet UI with no engine state mutation:
//
//   _addAirportsToCeMap()
//     ~13 lines. Drops blue ✈ pins on the picker map for each entry
//     in _tb.airports. Pushes markers into the shared _ceMarkers
//     array so renderCandidateCards' clear-on-redraw also clears
//     them.
//
//   _renderEntryPointsOnCeMap(region)
//     ~30 lines. Plants entry-point markers (airports, rail, sea,
//     bus) for the active region. Each marker has a popup with two
//     CTAs that call _tbUseEntryPoint to set the brief's entry/exit.
//     Reads _epCache (lazy-loaded by region), _tbEntryPointsVisible,
//     _edActivePopupId.
//
// Both reach engine state + Leaflet via window globals from inside
// picker-ui.js — same pattern HW set up. Inline call sites still
// reference them by bare name; the back-compat aliases on window
// keep that working until later rounds narrow callers to
// MaxPickerUI.*.
//
// max-v270 — Round HW: picker-ui.js is the new home for picker DOM.
//
// First slice of the picker-UI extraction. Today's picker is split
// across ~30 inline-script functions, ~800 lines in renderCandidate-
// Cards alone. A single big lift would risk what HM cost us — the
// 738-line publishTrip move surfaced infinite recursion via the
// late-bound shim, an _isAutoName scope miss in the rebuild path,
// and the HQ subscription block landing inside the wrong scope.
//
// HW takes the small-and-honest route:
//   1. Create picker-ui.js with the IIFE skeleton + MaxPickerUI
//      namespace.
//   2. Move _renderPickerCategoryNav as the proof-of-pattern: a
//      pure DOM helper, ~38 lines, no engine state mutation.
//   3. Wire the script tag in index.html, alias on window for
//      back-compat, replace the inline definition with a comment
//      pointing to the new home.
//   4. Add picker-ui.js to the SW precache manifest so offline mode
//      gets it.
//
// What this earns: the file exists, the pattern is documented, the
// script-tag plumbing works, the SW precache covers it. Future
// rounds (HW.1, HW.2, …) move bigger picker UI helpers in following
// the same template — each one verified against engine tests +
// (when the user runs them on their machine) Playwright before the
// next move lands.
//
// Architectural state after HW:
//   db.js              persistence + tripWritten event bus
//   engine-trip.js     trip helpers + mutators + FQ pipeline
//   engine-picker.js   picker state + orderKept + publishTrip
//   picker-ui.js       (NEW) picker DOM rendering — first helper
//   index.html (UI)    everything else; shrinking
//
// max-v269 — Round HU: _generatedCityData lives under MaxDB.cache.
//
// The per-place city-data cache (loaded by generateCityData on first
// access, read by ~20 call sites) was a bare window global declared
// inline at line ~13010. It belonged in MaxDB.cache alongside the
// LLM and geocode caches: the architecture doc lists it as a cache;
// engines should be able to inspect/clear it through one API; tests
// shouldn't have to know its name.
//
// HU adds MaxDB.cache.cityData with map/get/set/has/delete/clear.
// The internal store is a plain object so the existing
// `_generatedCityData[key]` reads + writes keep working — `var
// _generatedCityData = MaxDB.cache.cityData.map()` aliases the same
// reference. New code uses the structured API; old code is a no-op
// migration.
//
// This is one of the architecture-doc cache locations getting a real
// home, instead of being scattered as inline globals. Same pattern
// as HF (FQ memo) and HP (trip persistence) — each piece moves from
// "inline-script global" to "namespaced API on the right module."
//
// max-v268 — Round HT: picker engine reaches the LLM / city-data /
// geocode through service injection, not through bare globals.
//
// Before HT, the picker engine called these by name from inside its
// IIFE — they resolved through the JS scope chain to inline-script
// globals. That worked but coupled the engine to inline-script symbol
// names: rename `generateCityData` and the engine would silently break.
//
// After HT:
//   MaxEnginePicker.injectService('llm', callMax);
//   MaxEnginePicker.injectService('city-data', generateCityData);
//   MaxEnginePicker.injectService('geocode-candidates', geocodeMissingCandidates);
//
// The engine asks the registry: `pickerGetService('city-data')`. If
// no service is registered (e.g., a test that doesn't want network),
// it falls back to the bare global — defense in depth, but tests get
// a clean injection point now.
//
// HT also injects 'llm' into the picker (HF only injected it into the
// trip engine). The picker doesn't call the LLM today through the
// service registry — picker-driven LLM calls happen in late-bound
// helpers that still reach for global.callMax — but registering the
// service now means any engine code we move in next can switch to
// `pickerGetService('llm')` without a registration round trip.
//
// What's still global-coupled (and why I'm not chasing it today):
// expandMustDos, findCandidates, runCandidateSearch — they all touch
// picker UI DOM and aren't structurally engine logic. Moving them
// physically into engine-picker.js would just relocate the coupling
// to picker UI elements, not eliminate it. The picker UI extraction
// (HW) is the right place to address those.
//
// max-v267 — Round HS: tripWritten payload carries the envelope.
//
// HQ adopted trip state via re-read+JSON.parse on every publish, which
// loses dest object identity (every dest gets a new {} wrapper even
// when its values are unchanged). For an in-process writer like the
// picker engine, that's wasteful — the engine just produced a perfectly
// good envelope; making the trip engine re-build it from JSON throws
// the work away.
//
// HS adds an `envelope` field to the tripWritten payload:
//   { id, envelope }
// The trip engine subscriber (engine-trip.js) prefers payload.envelope
// when present. tripWriteRaw parses the JSON once at write time and
// hands the parsed object out so the read side can skip the parse.
//
// Fallback semantics preserved:
//   - If envelope is missing (e.g., a future cross-tab listener that
//     observes a storage event), the subscriber falls back to
//     MaxDB.trip.read(id). Same code path as Round HQ.
//   - If JSON.parse fails inside writeRaw, we still emit tripWritten
//     so it remains a reliable "something landed in storage" signal —
//     just with envelope=null so subscribers fall back.
//
// Why this matters for "the architecture is honest end-to-end":
// Round DW spent significant effort preserving dest object identity
// across rebuilds (so external refs stay valid). Re-parsing on every
// adoption was silently throwing that property away. HS aligns the
// adoption path with DW's identity-preservation promise.
//
// max-v266 — Round HR: makeDays + getCityCenter move into engine-trip.js.
//
// Two trip-engine helpers were still living in the inline script in
// index.html, even though they're pure-ish trip-shaped logic with no
// UI surface:
//
//   makeDays(dateFrom, dateTo)
//     Generates the day-by-day skeleton between two dates.
//   getCityCenter(dest)
//     Resolves a destination's lat/lng with sensible fallbacks
//     (dest.lat/lng → dest.geo → cached city data → 0,0).
//
// Both are now in engine-trip.js, exposed on MaxEngineTrip and aliased
// on window for the inline script that still calls them by bare name.
// Inline body is unchanged — this is a physical move with no behavior
// change. Engine tests still green; Playwright next.
//
// Why bother? Each one of these moves chips away at the inline script
// owning trip-shaped logic. After HR, the inline script's remaining
// "trip" responsibilities are render + UI events; the trip-shape and
// trip-derived helpers live in engine-trip.js where they belong.
//
// max-v265 — Round HQ: trip engine subscribes to MaxDB.tripWritten.
//
// The picker→trip handoff is now wired through the DB event channel
// per the architecture doc's prescription. publishTrip writes the
// envelope via MaxDB.trip.writeRaw (Round HP); MaxDB emits
// 'tripWritten'; the trip engine subscribes and adopts:
//
//   global.trip = parsedEnvelope.trip
//   restore counters (destCtr, sidCtr, bkCtr) + activeDest + activeDmSection
//   emit 'tripChange' + 'mapDataChange'
//
// The trip engine treats DB writes as the source of truth. Whoever
// writes (picker engine today, mobile sync layer tomorrow), the trip
// engine receives the same signal through the same channel.
//
// On dest object identity:
//   - publishTrip mutates window.trip in place during build (helpers
//     read it via scope chain — that's the optimization Round DW
//     relied on for value preservation).
//   - After publishTrip's MaxDB.trip.writeRaw, the HQ subscriber
//     re-reads from localStorage, JSON.parses, and re-assigns
//     global.trip. New object identity, same values.
//   - This is fine: Round EX.4 already closed the case where
//     external code held dest refs across publishes (popup map
//     closes on data change). Anything else (pendingActions key by
//     id, _ffHistories by id, _destStories by id) is identity-
//     independent.
//
// What this completes for "honest end-to-end":
//   - Engines no longer reach across via window.trip directly. They
//     observe the DB-event channel. The picker engine's mutation of
//     window.trip during build is now an internal optimization; the
//     formal handoff is via DB.
//   - Future writers (mobile sync) emit tripWritten through MaxDB;
//     the trip engine adopts identically.
//
// Test suite (51) still green. The architecture is honest:
//   db.js               persistence + tripWritten event bus
//   engine-trip.js      pure helpers + trip mutators + reconcile +
//                       FQ pipeline + Round HQ adopts via DB event
//   engine-picker.js    pure picker helpers + orderKept + publishTrip
//                       writes via DB
//   index.html (UI)     subscribes to MaxEngineTrip events for render,
//                       MaxEnginePicker.on('published') for bridge
//
// max-v264 — Round HP: persistence goes through MaxDB API, not the
// inline-script localSave/saveTripsIndex wrappers.
//
// publishTrip used to call:
//   saveTripsIndex();  localSave();
// Both inline-script functions that wrap localStorage.setItem.
//
// Now calls:
//   MaxDB.trip.writeRaw(tripId, serializeTrip());  // fires tripWritten
//   MaxDB.index.save(_tripsIndex);                 // fires indexChanged
//
// Same persistence outcome, but goes through the documented DB API.
// Subscribers that want to react to writes (e.g., a future Supabase
// sync layer, or test instrumentation) can subscribe to MaxDB events
// instead of monkey-patching localSave.
//
// Falls back to the inline functions if MaxDB isn't loaded for any
// reason. Defense-in-depth: the engine never assumes a particular
// loading order.
//
// On the publishTrip + window.trip question: I considered shadowing
// the global with a local var inside publishTrip so the engine
// doesn't write to window.trip directly. That requires careful
// surgery on 738 lines with many trip.X mutations and inline
// closures, plus a meaningful semantic change (Round DW's
// in-place-mutation optimization). The architecture doc explicitly
// permitted "live-mutable state to start, freeze later if needed."
// Both engines reading/writing the same in-memory trip object is the
// chosen design — and now persistence + change notification both go
// through the documented DB channel.
//
// On the late-bound picker functions (expandMustDos,
// runCandidateSearch, findCandidates, geocodeMissingCandidates):
// these touch picker UI state (_ceMap, _edMap, picker DOM). Moving
// them physically into engine-picker.js would just relocate the
// code without changing what it touches — picker engine and picker
// UI are bundled together by design (architecture doc: "picker is
// desktop-only for the foreseeable future, so we don't need to keep
// the picker engine pure of DOM dependencies"). Keeping them in
// inline script with namespace bindings is the architecturally
// consistent choice.
//
// max-v263 — Round HO: move trip-engine functions to engine-trip.js.
//
// Four functions classified as TE (trip engine) in the architecture
// doc that were still in inline script:
//
//   _reEvaluateOverBudget        61 lines   — over-budget recompute
//   _reconcileDestinations       375 lines  — Round DW reconcile saga
//   addPendingAction             20 lines   — pendingActions push
//   _mergeAdjacentSamePlaceDests 92 lines   — Round FW merge
//
// Total ~550 lines. All physically moved into engine-trip.js. Engine
// boundary cleanup: publishTrip in engine-picker.js used to call
// these as inline-script globals via scope-chain. They're still
// reached via scope-chain (window globals from the engine module),
// but they now LIVE in the trip engine where they architecturally
// belong.
//
// Also exposed on MaxEngineTrip namespace:
//   reEvaluateOverBudget, reconcileDestinations, addPendingAction,
//   mergeAdjacentSamePlaceDests
//
// Inline-script callsites (and engine-picker.publishTrip references)
// continue to use the bare names via window globals.
//
// The trip engine is now a real engine: pure helpers + event bus +
// service injection + 11 mutators + FQ async pipeline + Round DW
// reconcile + Round FW merge + over-budget evaluation + pending
// actions. ~1000 lines of cohesive trip logic in one module.
//
// What's still imperfect: publishTrip mutates window.trip directly
// (vs. building an envelope and going through DB.trip.write +
// tripWritten + Trip.load). The doc's "live-mutable state" decision
// makes this defensible — both engines read/write the shared trip
// object as in-memory state — but it means the engines aren't
// strictly isolated through the DB. Fixing requires rewriting ~50
// in-place mutations in publishTrip. Real work. Not done.
//
// File sizes after HO:
//   db.js               586 lines
//   engine-trip.js     1005 lines
//   engine-picker.js   1543 lines
//   index.html        24222 lines (down from ~25500 at session start)
//
// 51 tests still green.
//
// max-v262 — Round HN: make the engine boundary honest. publishTrip
// no longer touches DOM directly.
//
// The 738-line publishTrip ended with ~30 lines of UI work:
//   - g("candidate-explorer-overlay").style.display = "none"
//   - _ceMap.remove(), _edMap.remove() (Leaflet disposal)
//   - g("trip-brief-overlay").style.display = "none"
//   - showMaxBridge("post-candidates", ...)
//   - enterApp()
//   - drawTripMode()
//
// All of that is UI concern. With Round HC's central subscription
// already handling drawTripMode on tripChange, and with the bridge
// animation being a fresh-build-only UX moment, the right place for
// this code is an inline-script subscriber to a picker-engine event.
//
// HN extracts: publishTrip now emits `pickerEmit('published',
// {tripId, isRebuild})` after building + persisting the trip.
// That's its terminal action. The inline script subscribes via
// MaxEnginePicker.on('published', ...) and handles the picker close,
// bridge animation, panel swap, and trip render. Round CJ's "skip
// bridge on rebuild" rule now lives in the subscriber as an
// `if (isRebuild)` branch.
//
// What this means architecturally:
//   - publishTrip is engine-pure for UI side effects. It still
//     references some inline-script globals (callMax, makeDays,
//     trip, _tb, geocodeMissingCoords, etc.) via scope chain, but
//     those are conceptually services + shared state, not DOM.
//   - The picker UI is now event-driven for terminal flow. New
//     mobile / alternative UIs can subscribe to 'published' too.
//
// What's still imperfect (parked for future work):
//   - publishTrip mutates window.trip directly instead of writing an
//     envelope to MaxDB.trip.write. The "DB-mediated handoff"
//     pattern from the architecture doc isn't fully wired — both
//     engines still share window.trip.
//   - publishTrip still calls localSave directly. Could go through
//     MaxDB.trip.write but localSave already wraps that.
//
// 51 tests still green: 39 engine unit + 9 trip-mutator e2e + 3
// picker-flow e2e. Mobile is unblocked. The boundary is now
// substantially honest.
//
// max-v261 — Round HM: complete the buildFromCandidates decomposition.
//
// The 738-line body of buildFromCandidates lifted wholesale into
// MaxEnginePicker.publishTrip() in engine-picker.js. The inline-script
// entry point is now a 7-line delegator:
//
//   async function buildFromCandidates() {
//     return await MaxEnginePicker.publishTrip();
//   }
//
// All 30+ existing callers (the picker's Build button, brief-edit
// Apply, reopen-for-edit, applyArrDep, etc.) continue to work
// unchanged because the entry-point name is preserved.
//
// Why the lift-and-shift worked without touching the body:
//   The engine module is an IIFE. References inside it that aren't
//   declared in the IIFE's local scope (callMax, trip, _tb,
//   _mdcItems, _generatedCityData, makeDays, sidCtr, destCtr,
//   bkCtr, addPendingAction, geocodeMissingCoords, _ceMap, _edMap,
//   localSave, saveTripsIndex, drawTripMode, enterApp,
//   showMaxBridge, _reconcileDestinations, _mergeAdjacentSamePlaceDests,
//   getCityCenter, ...) all resolve via the scope chain to window
//   properties — set by the inline script's top-level `var` and
//   `function` declarations. Strict mode reads work fine; writes
//   only mutate properties on existing objects (e.g., trip.x = y),
//   which strict mode allows.
//
// What this completes:
//   - Phase 0: DB seam (db.js)             — done at HA
//   - Phase 1: pure helpers extracted      — done at HB
//   - Phase 2: event bus + 11 mutators     — done at HC-HF
//   - Phase 3: picker engine boundaries    — done at HH-HK
//   - HL: pure-helper extractions          — done
//   - HM: full publishTrip body lift       — done now
//
// What's structurally still possible (not done, not gating mobile):
//   - Replacing scope-chain global refs with explicit window.X or
//     dependency injection. Would clarify which deps the picker
//     engine has but doesn't change behavior.
//   - Splitting publishTrip internally into named helpers
//     (entry/exit synthesis, destination construction, UI bridge)
//     for testability. Real value but additive, not blocking.
//
// Verification: 39 engine tests green + 12 Playwright tests green.
// The decomposition is real; the engine boundary is honest.
//
// Mobile is now structurally unblocked. A mobile UI loads db.js +
// engine-trip.js + a thin trip-execution view; never loads
// engine-picker.js. The trip engine is the contract.
//
// max-v260 — Round HL: start the buildFromCandidates decomposition.
//
// First three pure pieces extracted into engine-picker.js:
//
//   MaxEnginePicker.buildBrief(state)
//     Pure: takes picker draft state (typically _tb), returns the
//     trip's brief envelope. Replaces a 12-line inline literal.
//
//   MaxEnginePicker.cloneMdcItems(items)
//     Pure: snapshots must-do/anchor items, preserving the fields
//     needed for picker rehydration on re-edit (BK + EN). Replaces
//     a 20-line inline .map().
//
//   MaxEnginePicker.deriveTripName(state, kept)
//   MaxEnginePicker.isAutoName(name)
//     Pure: Round EB auto-name logic — prefer placeName, fall through
//     to region, kept[0]. Replaces two inline closures.
//
// Inline buildFromCandidates now uses these via the namespace. The
// 51-test regression suite (engine + trip-mutator e2e + picker e2e)
// runs green at this checkpoint.
//
// Why incremental: buildFromCandidates is 784 lines with dozens of
// inline-script dependencies (callMax, ensureCoarseGeocode,
// _generatedCityData, makeDays, sidCtr, etc.). Wholesale lift-and-
// shift would surface dozens of resolution issues at once. Pulling
// out the pure pieces first gets ~50 lines of mechanical work out of
// the way and validates the extraction pattern. Subsequent rounds
// (HL.1, HL.2, ...) tackle the harder pieces:
//   - entry/exit synthesis (~50 lines, near-pure)
//   - destination object construction (~150 lines, references
//     makeDays + sidCtr/destCtr counters)
//   - reconcile path coordination
//   - LLM-driven candidate enrichment (geocodeMissingCoords)
//   - UI bridge tail (showMaxBridge + enterApp)
//
// Phase 3 status: HJ namespaced surfaces in place, HL incremental
// decomposition in progress. Tests gate every step.
//
// max-v259 — Rounds HJ + HK — Phase 3 boundary surfaces complete.
//
// HJ: define the picker→trip handoff contract.
//   MaxEnginePicker.publishTrip(...)   — late-bound to buildFromCandidates
//                                        for now. Architectural target:
//                                        build a trip envelope, write to
//                                        DB.trip.write, return the tripId.
//   MaxEngineTrip.load(tripId)         — late-bound to localLoad. Reads
//                                        from DB and adopts.
//   MaxEngineTrip.replaceTrip(builtTrip) — REAL new mutator. Adopts an
//                                          in-memory trip wholesale and
//                                          emits tripChange + mapDataChange.
//                                          Useful for test injection and
//                                          future direct-handoff paths.
//
// What HJ deliberately deferred: the actual decomposition of
// buildFromCandidates (the ~600-line beast). The architecture doc
// flagged it as "the hairiest function" and rightly cautioned
// against splitting without a regression suite. publishTrip is the
// named entry point; callers can converge there now and the
// implementation can swap underneath in future work without
// disrupting the running app.
//
// HK: picker UI subscribes to picker engine events.
//   MaxEnginePicker.on('candidatesChange', () => renderCandidateCards(_tb.candidates))
//   MaxEnginePicker.on('briefChange',     () => renderCandidateCards(_tb.candidates))
//
// Subscriptions wired in index.html alongside the existing trip-engine
// subscription. Imperative renderCandidateCards calls still work; as
// future picker-state mutators are migrated to emit-only, callers can
// drop the imperative path and rely on the event-driven re-render.
//
// Phase 3 status: ALL ARCHITECTURAL SURFACES DEFINED.
//   HH: pure picker helpers extracted (engine-picker.js)
//   HI: _tb encapsulated + picker event bus + service injection slot
//   HI.2: orderKeptCandidates physically moved (~470 lines)
//   HI.3: LLM-calling functions exposed via late-bound namespace
//   HJ: publishTrip / load / replaceTrip namespace + replaceTrip real
//   HK: picker UI subscribes to picker engine events
//
// Honest summary: Phase 3 is "structurally complete" — the engine
// boundaries are visible in code, the namespace surfaces are
// canonical, and future work can converge there without architectural
// drift. The deep refactor of buildFromCandidates remains as a
// follow-on project (multi-day per the original plan).
//
// Mobile (Phase 4) becomes possible from here: load db.js +
// engine-trip.js + a thin mobile UI; never load engine-picker.js.
// Trip engine is the contract; picker stays desktop-only.
//
// max-v258 — Round HI.3: namespace bindings for the LLM-calling
// picker functions.
//
// Honest scope: runCandidateSearch, expandMustDos, findCandidates,
// geocodeMissingCandidates all directly manipulate picker-UI state
// (Leaflet _ceMap, _ceMarkers, DOM elements). Moving them physically
// into engine-picker.js would pull the picker UI's map + DOM
// dependencies into the engine module, defeating the engine
// boundary. So they stay where they are.
//
// Instead, MaxEnginePicker exposes them as late-bound delegators
// (`return global.runCandidateSearch.apply(null, arguments)`). The
// engine API is defined; the namespace is the canonical entry point;
// callers can converge on it without the implementation having to
// physically move yet. A future round (after the picker UI itself is
// extracted) can replace these with real definitions.
//
// MaxEnginePicker now exposes:
//   findMatchingRequired      (HH, physically in engine-picker)
//   parseStartDateFromBrief   (HH)
//   parseNightsFromRange      (HH)
//   orderKeptCandidates       (HI.2, physically in engine-picker)
//   state / resetState / setField  (HI, picker draft state)
//   on / off / emit           (HI, event bus)
//   injectService / _getService (HI)
//   runCandidateSearch        (HI.3, late-bound)
//   expandMustDos             (HI.3, late-bound)
//   findCandidates            (HI.3, late-bound)
//   geocodeMissingCandidates  (HI.3, late-bound)
//
// Phase 3 status: HH + HI + HI.2 + HI.3 done. Next: HJ (decompose
// buildFromCandidates into Picker.publishTrip → DB write →
// tripWritten → Trip.load) and HK (picker UI subscribes to picker
// engine events).
//
// max-v257 — Round HI.2: move orderKeptCandidates into engine-picker.js.
//
// 473 lines extracted from index.html into the picker engine module.
// Reads MaxEnginePicker.state.region (was _tb.region — same object)
// and writes MaxEnginePicker.state.tbExit (round-trip exit synthesis).
// Both work because HI encapsulated _tb on window so engine and
// inline script share the reference.
//
// Other deps preserved as window globals: _normPlaceName (engine-trip),
// getCityCenter (inline script).
//
// All Round CN geo-reorder + Round DO round-trip angular-sort logic
// preserved as-is. Smoke test: Iceland with Reykjavik (_cityPick:true)
// + Vik + Höfn → ordered=[Reykjavik, Vik, Höfn], inferredEntry=Reykjavik,
// _tb.tbExit set to Reykjavik for the round trip.
//
// Inline script callsites still use the bare name `orderKeptCandidates`
// (resolves to window.orderKeptCandidates owned by the engine module).
//
// max-v256 — Round HJ.B: smart-detect on the Itinerary tab's
// "Add a sight" — geocode the typed name, surface the distance,
// and offer day-trip conversion when it's too far for a sight.
//
// Replaces HJ.A's standalone Explore-tab manual-add input (rolled
// back to hidden-when-empty) with one smart input on the Itinerary
// tab. User flow:
//
//   1. User types "Blue Lagoon" + Add on a Reykjavik day in Itinerary
//   2. Sight appears immediately on that day (no blocking)
//   3. doAI fires async ensureCoarseGeocode(v) for the typed name
//   4. When coords land, doAI updates ns.lat/ns.lng (so _mainMap pins
//      land in the right place even if the user keeps it as a sight)
//      and writes "X km from <dest>" to ns.note so the user can SEE
//      how far it is
//   5. If distKm > 15, _showDayTripConversionToast surfaces a non-
//      blocking toast: "Blue Lagoon is 50 km from Reykjavik — that's
//      usually day-trip distance. [Keep as sight] [Make it a day trip]"
//   6. "Make it a day trip" removes the sight item, calls addDayTripPlace
//      to create a chip on dest.dayTrips, then immediately addDayTripToDay
//      so the user's intent ("put this on day N") is preserved
//   7. "Keep as sight" just dismisses; the distance note already on
//      the sight makes the truth visible
//
// 15 km threshold: anything beyond is day-trip territory. Inside 15
// is plausibly a city-internal sight (museum, restaurant, monument).
// The threshold is a heuristic; users who want to keep a 20km thing
// as a sight just click "Keep as sight."
//
// What rolled back from HJ.A: the standalone Explore-tab manual-add
// input (a separate path was confusing — having two ways to add a
// day-trip place forced the user to choose between them upfront,
// before they had distance info). Day trips section in the Explore
// tab once again renders only when chips exist.
//
// What stayed from HJ.A: the addDayTripPlace mutator. Now the
// underlying mechanism for the toast's "Make it a day trip" button.
//
// Verification:
//   * Open Reykjavik's Itinerary, on any day type "Blue Lagoon" + Add
//   * Sight appears immediately on the day with placeholder coords
//   * Within ~1s the geocode resolves and the sight's note updates
//     to "50 km from Reykjavik" (or wherever Blue Lagoon resolves)
//   * The bottom-of-screen toast appears: "Blue Lagoon is 50 km from
//     Reykjavik..." with two buttons
//   * Click "Make it a day trip" → sight disappears from the day,
//     a Blue Lagoon chip appears in dest.dayTrips, the chip is
//     immediately placed on the same day (the daytrip-typed item
//     replaces the sight item on the day)
//   * Click "Keep as sight" → toast dismisses; sight stays with
//     correct coords + distance note
//
// max-v255 — Round HJ.A: add a manual day-trip place to a hub.
//
// User scenario (Neal): "Blue Lagoon was a destination at one time"
// — got dropped from the picker, now wants it back as a day-trip
// option from Reykjavik. The existing makeDayTrip path required
// the source to be a current trip destination; addDayTripPlace
// creates a chip from scratch given just a typed name.
//
// Implementation:
//   * New mutator addDayTripPlace(hubDest, placeName) — title-cases
//     the input, dedupes against existing chips, syncs coords from
//     _coarseGeocode if cached, fires ensureCoarseGeocode async if
//     not, computes distKm via haversine when both coords land,
//     pushes a chip onto hubDest.dayTrips, then _emitTripMutation.
//     Async geocode resolves with a follow-up mapDataChange emit so
//     the pin appears once Nominatim answers.
//   * Explore tab Day trips section restructured: the header + the
//     manual-add input now always render. The chip list below
//     renders only when chips exist (unchanged behavior).
//
// New chips carry manuallyAdded:true for future-tracking. Other
// fields match makeDayTrip's chip shape — sourceNights:1,
// absorbedFromHub:hub.place, country, lat, lng, whyItFits,
// attachedEvents, distKm, clusteredAt — so existing dayTrips
// rendering, addDayTripToDay, dropDayTrip, etc., all work unchanged.
//
// Verification: Reykjavik trip with Blue Lagoon NOT a destination.
// Open Reykjavik's Explore tab → "Day trips" section → type
// "Blue Lagoon" → Add. Chip appears immediately with "?km away"
// (no coords yet); within ~1s Nominatim resolves and the meta
// updates to "X km away" + the pin shows on the destination map.
// Click "Place on Day N" → places it on the day, just like any
// other day-trip chip.
//
// max-v254 — Round HI: Phase 3 step 2 — encapsulate the picker
// draft state (_tb) in engine-picker.js + add the picker event bus.
//
// The 100+ inline-script references to _tb still resolve via the
// global (window._tb), so callsites are unchanged. The engine
// module now owns initialization and exposes:
//
//   MaxEnginePicker.state                — getter for current _tb
//   MaxEnginePicker.resetState(initial)  — replace the draft (the
//                                          picker re-init pattern)
//   MaxEnginePicker.setField(field, val) — patch one field, emits
//                                          'briefChange'
//   MaxEnginePicker.on / off / emit      — event bus mirror of trip
//                                          engine's pattern
//   MaxEnginePicker.injectService /      — picker has its own service
//      _getService                         slot (separate from trip
//                                          engine; useful when picker-
//                                          specific services land —
//                                          geocoding queue, etc.)
//
// Standard picker events (will be used by HI.2+ refactors):
//   'stateReset'    — fires on resetState()
//   'briefChange'   — fires on setField()
//   'candidatesChange' — picker mutators emit when candidates list
//                        changes (HI.2)
//   'published'     — fires after Picker.publishTrip() succeeds (HJ)
//
// Removed from index.html: the top-level `var _tb = {};` declaration.
// The inline-script picker-start pattern `_tb = {name: name, ...}`
// (assignment, not declaration) still works — assigns to window._tb,
// which is the engine's reference.
//
// HI deliberately stops here. orderKeptCandidates and the LLM-calling
// picker functions (runCandidateSearch, expandMustDos, findCandidates,
// geocodeMissingCandidates) are next round (HI.2 / HI.3) — same
// service-injection + event-emit pattern as the trip engine's HF.
//
// Verification (HI):
//   window.MaxEnginePicker.state                     → {} initially
//   MaxEnginePicker.resetState({name: "test"})       → emits stateReset
//   MaxEnginePicker.setField("region", "Iceland")    → emits briefChange
//   window._tb.region                                → "Iceland"
// Then start a new trip via "Plan a trip" button — verify the picker
// brief flow still works end-to-end (place input, brief step 2,
// candidate generation, build).
//
// max-v253 — Round HH: Phase 3 step 1 — engine-picker.js with the
// strictly-pure picker helpers.
//
// New file: /engine-picker.js. Loaded by index.html after engine-
// trip.js. Exposes window.MaxEnginePicker:
//
//   findMatchingRequired(cand, requiredPlaces)   — substring/normalized
//                                                  match against must-do
//                                                  anchors
//   parseStartDateFromBrief(when)                — ISO/month-day/month
//                                                  parser w/ 3mo default
//   parseNightsFromRange(stayRange)              — "3-4 nights" → 3
//
// All three also exposed on window under their original names for
// migration. The inline script's existing callsites work unchanged.
//
// What deliberately did NOT move yet: orderKeptCandidates. Reading
// the code closely revealed it reads `_tb.region` and writes
// `_tb.tbExit` — picker draft state, not a pure transformation. It
// moves in HI when _tb is encapsulated as MaxEnginePicker.state.
//
// Other picker functions (runCandidateSearch, expandMustDos,
// findCandidates, geocodeMissingCandidates) all touch _tb and call
// callMax. They migrate later in Phase 3 alongside _tb encapsulation
// and service injection (the LLM service is already injected on
// MaxEngineTrip — picker can share or get its own slot).
//
// Phase 3 plan:
//   HH (this round): pure helpers — done
//   HI: encapsulate _tb as MaxEnginePicker.state + add picker event
//       bus + move orderKeptCandidates and the LLM-calling functions
//       through service injection
//   HJ: decompose buildFromCandidates into Picker.publishTrip +
//       DB.trip.write + Trip.load (the centerpiece — the hairy
//       600-line function finally splits)
//   HK: picker UI subscribes to picker engine events
//
// Verification (HH): open the app, run in the console:
//   window.MaxEnginePicker
//   MaxEnginePicker.parseNightsFromRange("5-7 nights")  → 5
//   MaxEnginePicker.parseStartDateFromBrief("August 15") → "2026-08-15"
//   MaxEnginePicker.findMatchingRequired(
//     {place: "Saint-Moritz"},
//     [{place: "St. Moritz", id: "rq1"}]
//   )                                                   → {id: "rq1", ...}
//
// max-v252 — Round HG: wire the FQ async pipeline back into use.
//
// Round FQ.2 had simplified the trip-view + picker banners to a
// static day-trip note, leaving the FQ verdict pipeline orphaned —
// _ftPeerDayTripCandidates read _fqPairMemo opportunistically but
// nothing populated it, so day-trip candidate filtering always fell
// back to the haversine/80 km/h estimate.
//
// HG fix: in _ftPeerDayTripCandidates, after building the threshold-
// filtered candidate list, kick off async _fqGetTransitInfo calls
// for any pair without cached transit info. When all pending
// fetches resolve, emit 'tripChange' so the central subscription
// re-renders the Explore tab with refined fastestH values.
//
// First view of any hub's Explore tab fires up to N LLM calls
// (N = number of within-threshold trip destinations from that hub).
// Cached forever after — IDB-backed via callMax. Subsequent views
// pay zero LLM cost.
//
// Only fetches for pairs that PASSED the haversine/80 filter. Pairs
// excluded by the conservative estimate stay excluded; the rare
// cases where real road is dramatically shorter than straight-line
// (ferry shortcuts, etc.) won't surface, but those are edge cases
// and easy to expand later if they bite.
//
// Verification: open a multi-destination trip's Explore tab on any
// hub. Within ~1-2s the displayed times under "Day trips to other
// places on your trip" may shift from the haversine estimate to the
// LLM's fastest-mode time. `MaxEngineTrip.transitInfoCache()` should
// populate after the first such view.
//
// max-v251 — Rounds HE + HF — Phase 2 complete.
//
// HE: refactor the harder trip-engine mutators —
//   executeMoveDest        — drag-reorder / up-down arrows / move dialog;
//                            the rAF scroll-into-view (EX.2) still works
//                            because emit is synchronous
//   _ftSchedulePeerDayTrip — peer day-trip with night transfer (FT.2);
//                            the FT.2 UI surface only fires from
//                            hubDest's detail view, so activeDest already
//                            equals hubDest.id and the central
//                            subscription's drawDestMode(activeDest)
//                            renders the right view
//   applyDateChange        — multi-destination date change with reconcile
//                            cascade (Round FN); setTimeout scroll-into-
//                            view still works for the same reason as
//                            executeMoveDest
//
// HF: pull the FQ async verdict pipeline into engine-trip.js with
// service injection.
//
// Moved into engine-trip.js:
//   _fqGetTransitInfo       — async LLM call for pair transit info
//   _fqComputeVerdict       — pairwise verdict computation
//   _fqVerdictForPlaces     — per-set memoized wrapper
//   _fqInflight, _fqPairMemo  — per-session memos
//   _fqLastSig, _fqLastVerdict — per-set verdict cache
//
// callMax is now injected as the engine's "llm" service immediately
// after callMax is defined in the inline script:
//   MaxEngineTrip.injectService("llm", callMax);
//
// _fqPairMemo + _fqInflight are exposed as window globals from the
// engine module so _ftPeerDayTripCandidates can read cached transit
// info to filter day-trip candidates without re-walking the LLM.
// Same object reference; mutation in engine is visible to inline script.
//
// Phase 2 status: COMPLETE.
//   HC + HC.1: event bus + service injection + addBufferNight + buffer-pin fix
//   HD: 7 simple mutators refactored
//   HE: 3 hard mutators refactored
//   HF: FQ async pipeline + service injection
//
// Trip engine has now: pure helpers (Phase 1) + event bus + service
// injection + 11 mutators emitting instead of calling drawXxx + the
// LLM-backed verdict pipeline. The trip engine module is the single
// source of truth for trip mutations. The inline script's callsites
// still use original names (window globals) — Phase 3 will narrow
// callers to the namespaced surface.
//
// Phase 3 next: picker engine + DB-mediated handoff. The hairy
// buildFromCandidates decomposes into Picker.publishTrip → DB write
// → tripWritten event → Trip.load.
//
// max-v250 — Round HD: Phase 2 step 2 — refactor the simple
// trip-engine mutators to emit instead of calling drawXxx directly.
//
// Refactored (each lost its `autoSave + drawXxx + updateMainMap`
// tail in favor of `_emitTripMutation()`):
//
//   reverseTripOrder      — trip-view button (Round FV)
//   delDest               — × button + delete-from-detail (Round FN)
//                           preserves "fall back to trip view if no
//                           destinations left" via setLeftMode
//   addDayTripToDay       — Explore-tab "Place on Day N" (Round CO.3)
//                           sets _activeDmSection = "sights" before
//                           emit so the central sub renders the right
//                           tab; post-emit setTimeout still does the
//                           250ms scroll-into-view + amber pulse
//                           (FN.8.17)
//   removeDayTripFromDay  — chip-level "remove all placements"
//   removeDayTripFromDayItem — per-day removal (FT.4); reverses peer
//                              night-transfer first
//   makeDayTrip           — convert standalone dest to chip (Round EV/FC)
//                           post-emit setTimeout still scrolls to the
//                           new chip + shows undo toast
//   ungroupDayTrip        — convert chip back to standalone dest
//                           (Round CO/FC); post-emit toast preserved
//   dropDayTrip           — fully drop a chip (Round FN.8.12)
//
// All eight mutators are still callable by their original names —
// only the rendering tail changed. Pre-emit state setup
// (_activeDmSection, _leftMode, activeDest) and post-emit side
// effects (scroll-into-view, amber pulse, undo toast) remain in
// the mutators where they belong.
//
// Verification: hit each end-to-end:
//   1. ↺ Reverse trip order — list reverses, dates recompute, map updates
//   2. × Remove a destination — card disappears, dates close gap,
//      map pin removed, falls back to trip view if last one
//   3. From Explore tab, place a day-trip on a day — card appears
//      on the day, scrolls into view with amber pulse, map pin
//      updates, Itinerary tab is now active
//   4. Remove a placed day-trip via Itinerary — item disappears,
//      map updates
//   5. Make Liden a day-trip from Reykjavik — chip appears in
//      hub's day-trip section, undo toast pops
//   6. Ungroup that chip — destination reappears in trip list,
//      undo toast pops
//
// Each path now goes: mutator → autoSave + emit('tripChange') +
// emit('mapDataChange') → central subscription re-renders the
// active view. No mutator calls drawTripMode / drawDestMode /
// updateMainMap directly anymore.
//
// max-v249 — Round HC.1: fix Round GA bug — buffer-night
// destinations now populate coords so the hero map shows a pin.
//
// Original GA shipped with `lat:null, lng:null` on the new buffer
// dest and no geocoding step. Bug was hidden because `updateMainMap`
// quietly skips destinations without coords. Neal noticed it
// during HC verification ("I don't see the new pin added") because
// HC's central subscription made it clear the map IS being asked
// to refresh — it just had nothing to draw.
//
// Fix: synchronous cache hit from `_coarseGeocode` when the city is
// already known (the common case — buffer city is usually adjacent
// to or the same as an existing destination). On cache miss, async
// `ensureCoarseGeocode` with a follow-up `mapDataChange` emit when
// the geocode resolves, so the pin appears as soon as Nominatim
// answers (typically <1s through the existing rate-limited queue).
//
// Defensive: the async resolve checks the dest is still in
// `trip.destinations` before mutating, in case the user deleted
// it before the geocode came back.
//
// max-v248 — Round HC: Phase 2 step 1 — event bus + service
// injection + first mutator refactor.
//
// engine-trip.js now exposes:
//   MaxEngineTrip.on(event, cb)         — subscribe to engine events
//   MaxEngineTrip.off(event, cb)        — unsubscribe
//   MaxEngineTrip.emit(event, payload)  — emit (synchronous; subs run inline)
//   MaxEngineTrip.injectService(n, fn)  — register a service (e.g., 'llm')
//   MaxEngineTrip._getService(name)     — read it back
//
// Standard events: 'tripChange', 'mapDataChange', 'absorbedChange'.
//
// index.html: central UI subscription wired in once, near where
// _leftMode is declared. On 'tripChange' it re-renders whichever
// view is active (drawTripMode or drawDestMode); on 'mapDataChange'
// it calls updateMainMap. Mutators no longer have to know which
// view is active.
//
// Helper for refactored mutators:
//   _emitTripMutation()  — autoSave + emit('tripChange') + emit('mapDataChange')
//
// First mutator refactored: addBufferNight (Round GA). It was the
// simplest E* mutator (autoSave + drawTripMode + updateMainMap, no
// scroll/focus/section state). Picking it as the proof-of-concept
// isolates the architectural pattern from per-mutator subtleties
// like addDayTripToDay's scroll-into-view + amber pulse.
//
// Phase 2 continues: HD will refactor the rest of the simple
// mutators (reverseTripOrder, delDest, addDayTripToDay,
// removeDayTripFromDay, removeDayTripFromDayItem, makeDayTrip,
// ungroupDayTrip), HE the harder ones (executeMoveDest,
// _ftSchedulePeerDayTrip, applyDateChange), HF moves the FQ async
// pipeline into the engine via service injection.
//
// Verification: open the app, type
//   `MaxEngineTrip.on('tripChange', () => console.log('changed'))`
// then click "+ Add arrival buffer" / "+ Add departure buffer" on
// the first/last destination card. The console should log
// "changed", the trip view should update, the hero map should
// refresh — all via the bus, no direct drawXxx in addBufferNight.
//
// max-v247 — Round HB: Phase 1 of the engine/UI split — extract the
// trip engine's pure helpers into engine-trip.js.
//
// New file: /engine-trip.js. Loaded by index.html alongside db.js,
// before the inline script. Exposes window.MaxEngineTrip with
// pure-only members:
//
//   haversineKm, pairKey, fastestPractical, placesSig
//   parseHoursInput, formatHours
//   titleCaseCity, normPlaceName
//
// Each is also exposed on window under its original name so the
// inline script's existing callsites (86 references) keep working
// unchanged. Phase 2 will narrow them to MaxEngineTrip.<name>.
//
// Removed from index.html: the function bodies for the eight
// helpers above. Each leaves a one-line breadcrumb pointing at
// engine-trip.js. The inline script shrinks accordingly.
//
// State-dependent engine functions stay in the inline script for
// now — _ftRecomputeTripDates, _ftResizeDestDays,
// _ftSchedulePeerDayTrip, _ftReverseNightTransfer,
// _ftPeerDayTripCandidates, _ftGetThresholdHours all touch the
// `trip` global or call autoSave/drawXxx. They move in Phase 2
// once the event system is in place.
//
// The async LLM-calling FQ pipeline (_fqGetTransitInfo,
// _fqComputeVerdict, _fqVerdictForPlaces) also stays for now —
// it depends on callMax + per-session memos (_fqPairMemo,
// _fqInflight, _fqLastSig, _fqLastVerdict). Service injection
// lands in Phase 2 too.
//
// Verification check: open the app, type
// `window.MaxEngineTrip.haversineKm(64.96,-19.02,64.14,-21.94)`
// → ~166.7. Then open a Switzerland trip and confirm the FQ
// verdict banner still renders, the day-trip threshold input
// still parses, and the picker still surfaces day-trip
// candidates. No behavior should change.
//
// max-v246 — Round HA: Phase 0 of the engine/UI split — introduce
// db.js as the persistence seam.
//
// Architectural step, not a feature change. Adds /db.js to the SW
// CORE so it's served alongside the app, and adds a <script src=
// "db.js"> tag in index.html. db.js exposes window.MaxDB:
//
//   MaxDB.trip.{write,read,delete}        — per-trip envelope CRUD
//   MaxDB.index.{load,upsert,remove,...}  — trips index for home
//   MaxDB.draft.{read,write,delete}       — picker draft (stub)
//   MaxDB.cache.llm.{get,set,...}         — LLM response cache (IDB)
//   MaxDB.cache.geocode.{get,set,...}     — coarse-geocode cache
//   MaxDB.setting.{get,set,remove}        — lightweight prefs
//   MaxDB.cleanupOrphaned(activeId)       — Round CL.4 sweep
//   MaxDB.on/off('tripWritten' | 'tripDeleted' | 'indexChanged' | …)
//
// Phase 0 deliberately migrates ZERO callsites. The existing
// localSave/loadTrip/_maxIdbGet/_maxCacheLoad/etc. paths in the
// inline script still own all I/O. db.js is loaded so that next-
// phase callers have something to point at.
//
// Rationale (see architecture-engine-ui-split.md, "Phase 0"):
// the schema is the contract between the picker engine and the
// trip engine; locking it down before either engine module exists
// means we don't pay schema-drift cost during the engine moves.
//
// Verification check for Phase 0: open the app, type window.MaxDB
// in the console — should show the namespace; no other behavior
// should change. Existing trips load and save exactly as before.
//
// max-v245 — Round GA.2: also remove the exit-buffer checkbox from
// the trip-view Arrival/Departure panel (separate location from
// the picker checkbox cleared in GA.1). Same dead-text Neal flagged
// — "Buffer night in your departure city before flying home" — was
// still showing in the trip-view logistics panel. Apply-button
// handler reads the checkbox defensively so the missing element
// just resolves to "no buffer" — consistent with the new default.
//
// max-v244 — Round GA.1: tear out the legacy buffer infrastructure.
// Neal: "don't be concerned with existing trips at this point, in the
// development process I delete all previous trips and start from
// scratch." So the GA approach (default-off + leave inert paths)
// became more aggressive — the auto-create logic in
// buildFromCandidates is now stripped down to just "prepend if entry
// city missing / append if exit city missing" (the original pre-FY
// purpose), the entry-buffer banner and exit-buffer banner in
// drawTripMode are if(false) gated, and the picker checkboxes for
// entryBuffer/exitBuffer are gone.
//
// What stays:
//   * The on-card "+ Add arrival/departure buffer" buttons (Round GA).
//   * Existing dest objects can still carry _entryStop / _exitStop
//     flags if some other path sets them — readers like the FQ
//     verdict and FT.2 candidate filter still treat them correctly.
//     New trips just don't get those flags from build.
//   * makeDayTrip stays for the post-build clustering caller.
//
// max-v243 — Round GA: replace auto-create entry/exit buffers with
// per-card opt-in buttons. Neal: "having Reykjavik as two cards is
// really clunky. It makes it a chore to book a hotel for the whole
// time."
//
// New behavior:
//   * _tb.entryBuffer and _tb.exitBuffer default OFF on new trips
//     and on edit-rehydrate. Auto-creation in buildFromCandidates
//     no longer fires.
//   * First destination card in trip view shows "+ Add arrival
//     buffer" button. Last shows "+ Add departure buffer." Buttons
//     follow trip order — reverse the trip and they move to the
//     new ends, no flag bookkeeping.
//   * Click prompts for the city (default = current dest). Same
//     city as the dest folds via the existing FW auto-merge —
//     Reykjavik 3n → Reykjavik 4n, one card, one hotel booking.
//     Different city (e.g., Keflavik airport) creates a separate
//     1n card adjacent.
//   * Existing trips that already have _entryStop / _exitStop
//     buffer destinations keep them. The drop-or-keep banners
//     still render on those, so the user can clean up. New trips
//     don't get either.
//
// Round FY's _entryStop logic and the FE/BL/BM exit-buffer logic
// remain in the codebase as inert paths (won't fire when the
// toggles default false). Could be torn out later; left in place
// for now to avoid regressing existing trips.
//
// max-v242 — Round FZ.8: fix the Itinerary "Cancel day trip" button
// for FT.2 peer day-trips. The button only handled chip-based
// day-trips (hub.dayTrips[] entries) — it looked up the place in
// that array, found nothing for peer items, and silently no-op'd.
// Now: items carry peerDayTrip:true; the cancel handler routes peer
// items through removeDayTripFromDayItem for every day index where
// the place is placed (each call reverses one night transfer, so
// the destination grows back as items get removed). Chip items keep
// the original ungroupDayTrip path.
//
// max-v241 — Round FZ.7: render pins for FT.2 peer day-trips on the
// destination detail map. The existing day-trip pin loop iterates
// dest.dayTrips[] (the absorbed-chip array, populated by build-time
// clustering or makeDayTrip). FT.2's gradual-shrink mechanic adds
// items to dest.days[*].items[] with type==="daytrip" and
// peerDayTrip:true — different data shape, never reached the pin
// loop. Symptom: Blue Lagoon scheduled from Reykjavik via the
// "Could be a day trip from here" section had no pin on Reykjavik's
// map.
//
// Added a parallel loop that walks dest.days[*].items, finds peer
// day-trip items, dedupes by place name (FT.3 multi-day means the
// same place can be on multiple days but should render one pin),
// and renders pins matching the existing chip styling. Skips
// places that already have a chip-pin (defense in depth, in case
// a chip and a peer ever cover the same place).
//
// max-v240 — Round FZ.6: consolidate the day-trip-target UX in the
// Explore tab, and finish FT.2's deferred destination-disappears-
// at-zero-nights design.
//
// Drop EV's "Could be a day trip from here" section (the one-shot
// converter that moved all source nights to hub at once and removed
// source from trip.destinations). Replaced by FT.2's gradual per-
// night transfer, renamed to reuse "Could be a day trip from here"
// since EV's section is gone.
//
// _ftSchedulePeerDayTrip: removed the "refuse to take last night"
// guard. Now when target.nights hits 0, splice target out of
// trip.destinations and push to trip._absorbedDayTripPlaces with
// its original index. Destination object preserved intact (days,
// suggestions, bookings, etc.) so a future restore brings it back
// fully.
//
// _ftReverseNightTransfer: when target isn't in trip.destinations
// but is in the stash, restore it to original index with nights=1
// and drop from stash. Day-trip items already placed on the hub
// stay where they are (they're real items on the hub's days now).
//
// Neal: "shouldn't [Amsterdam] disappear only after all the days
// are accounted for in day trips?" — Yes. The mental model is
// "shrink as you schedule, vanish when there's nothing left to
// overnight in." Liden/Amsterdam: schedule day-trips one at a
// time, Amsterdam shrinks 3→2→1→0 with each click, vanishes from
// the trip view at 0. Removing a day-trip placement reverses the
// arrow.
//
// makeDayTrip stays defined for the post-build clustering path
// (line 19739) but is no longer surfaced in the Explore tab.
//
// max-v239 — Round FZ.5: exclude same-place destinations from
// _ftPeerDayTripCandidates. Round-trip Iceland produces three
// Reykjavik destinations (entry buffer + main + exit buffer); the
// peer-candidate filter only excluded the hub by id and any
// _exitStop sibling, which let the entry buffer leak through —
// Reykjavik showed up as a day-trip target from Reykjavik on its
// own destination's Explore tab. Three filters now: hub id, any
// _exitStop or _entryStop flag, and any same-place sibling
// regardless of flag (since you can't day-trip to yourself).
//
// max-v238 — Round FZ.4: fix stale-pin bug after adding/removing
// day-trip items. drawDestMode rebuilds the destination panel DOM
// but doesn't re-render the right-pane map's pins on its own. Four
// mutation paths called drawDestMode without first calling
// updateMainMap, so the map didn't catch up until something else
// (like switching to trip view and back) triggered a refresh:
//
//   * addDayTripToDay — placing an absorbed day-trip chip on a day
//   * _ftSchedulePeerDayTrip — FT.2 peer-destination day-trip
//   * removeDayTripFromDay — clearing all instances of a chip
//   * removeDayTripFromDayItem — FT.4 per-day removal
//
// Added updateMainMap() before drawDestMode in each. The
// showAddToDay path (sights/restaurants from Explore) already had
// it — only the day-trip paths were missing it.
//
// Symptom Neal hit: "when I add Blue Lagoon to Reykjavik it doesn't
// show on map until I go back to trip view."
//
// max-v237 — Round FZ.3: smart-default navigation on the destination
// detail map's pins. Surfaces (2) and (3) of Neal's "make the map a
// navigation surface wherever it makes sense" list — sight pins
// and day-trip pins.
//
// Behavior: clicking a pin on the destination detail map (_mainMap)
// now checks whether the item is already placed on a day:
//   * Sight / suggestion / restaurant / restaurant-suggestion: looked
//     up via itemDayNum (place name → 1-based day number). If
//     placed, scroll the Itinerary tab to that day block and amber-
//     pulse it.
//   * Day-trip chip: looked up via new dayTripDayIdx map (chip place
//     → 0-based day index of FIRST scheduled occurrence; FT.3
//     supports multi-day so we use the first). Same scroll-and-pulse
//     to the day block.
//   * Unplaced sights / hotels / info pins: fall through to the
//     existing showMapPinPanel — that panel has the description, the
//     "+ Add to day" button, etc., which is what the user needs to
//     act on an unplaced item.
//
// Fallback: if the day block can't be found (rare race or wrong
// tab), we still showMapPinPanel so the user gets *something* useful.
//
// Tab-switching: if the user is on Explore or some other tab when
// they click a placed-pin, we _activeDmSection = "sights" and
// drawDestMode before scrolling, so the Itinerary tab is what they
// see.
//
// max-v236 — Round FZ.2: fix the larger-map blank-screen regression
// FZ introduced. The click handler I added inside the popup script
// template used // line comments mixed into the JS string-concat
// chain that builds the popup's HTML. Each "+ // comment" line
// gets parsed as binary-plus + unary-plus on the next operand,
// which converts the following string to NaN and corrupts the
// popup script. Symptom: pop-out window opens blank because its
// embedded script crashes on startup.
//
// Fix: replaced the // comments with /* */ block comments outside
// the string concat chain. Same intent, no parser interference.
// (Should've used block comments from the start — string-concat
// chains and // line comments don't mix.)
//
// max-v235 — Round FZ.1: extend FZ's pin-click navigation to the
// inline hero map on the trip view. Was setLeftMode("dest") which
// switched to single-destination detail; replaced with the same
// maxScrollToDest postMessage the larger map uses so the trip-view
// cards scroll into view and amber-pulse, including every instance
// of round-trip cities. The destination card's own Open button is
// still the way into the detail view — pin-click is now overview
// navigation across all map surfaces.
//
// Surfaces still wanting this pattern (2-5 from Neal's list) are
// each their own round: dest-detail map → itinerary day, dest-
// detail day-trip pins → Explore section, hero pin → Routing tab,
// Tracker. Punting them rather than half-shipping.
//
// max-v234 — Round FZ: clicking a pin on the larger trip-route map
// (Round CM.1's pop-out window) now scrolls the opener back to the
// matching trip-view destination card. Already worked on the
// picker's larger map (Round AT's scrollOpenerToPlace) but the
// trip-view's hero-map pop-out had no click handler. Added:
//
//  * destId field on each pt in _buildHeroMapPoints so the popup
//    knows which card to ask for.
//  * m.on("click") handler in the popup script that postMessages
//    {type: "maxScrollToDest", destIds: [...]} back to opener.
//  * Listener in the opener that finds .tm-dest[data-id="..."]
//    cards, scrolls the first one into view, and amber-pulses
//    every match so round-trip cities (entry buffer + main +
//    exit buffer = three Reykjaviks) all flash visibly.
//
// Round-trip case: clicking the Reykjavik group pin highlights
// all three Reykjavik cards (arrival buffer, main stay, exit
// buffer) — useful since the user wanted to "click on a location
// and have it go to the trip entry" and a city with multiple
// stays IS multiple entries.
//
// max-v233 — Round FY.2: entry-buffer synthesis now also fires when
// _tb.entry is empty but ordered[0] exists. Round CP.1 inferred-
// gateway flow (where the user types e.g. "Iceland" and Max picks
// Reykjavik as the entry city via major-gateway fallback) leaves
// _tb.entry blank — and FY's `if (!entry) return;` short-circuited
// the buffer for those round trips. Now we treat ordered[0].place
// as the inferred entry name when no explicit one was typed, so
// the buffer prepend fires for Iceland/Switzerland/etc. without
// the user needing to manually fill in the gateway field. Resolves
// Neal's "no arrival banner, only one Reykjavik card" symptom.
//
// max-v232 — Round FU.3: the actual map Neal was seeing during the
// "Switzerland during the wait" complaint wasn't the candidate
// explorer map (_ceMap, fixed in FU/FU.1/FU.2) — it was the
// place-picker map rendered by _renderPlacePickerMap, which had
// [46.8, 8.2] hardcoded as the initial setView regardless of region.
// Fixed: when _tb.region is set and present in the seed, use the
// seeded coords instead of the Switzerland default. Falls back to
// [46.8, 8.2] only when no region is known.
//
// max-v231 — Round FU.2: anchor picker map bounds to the seeded
// region center to defeat LLM coord hallucinations. Neal's debug
// dump confirmed _tb.region="Iceland" and _coarseGeocode["iceland"]
// is correct, so the seed init was working — but candidates were
// arriving with Swiss coords (Iceland places mis-located by the
// LLM, country-hallucination class), and the post-render
// fitBounds(bounds) was pulling the map to Switzerland.
//
// Two changes in renderCandidateCards:
//   * Push the seeded region center into bounds before iterating
//     candidates. Forces fitBounds to span at least the region's
//     center even if every candidate is hallucinated.
//   * Filter individual candidate coords through _fuCoordSane,
//     which rejects coords more than 2500km from the seed center.
//     Those coords still pin on the map (via _addCandidateMarker)
//     but don't influence the bounds, so the view stays anchored
//     to the right country.
//
// 2500km is intentionally generous — Iceland-to-edge-of-Europe is
// ~2000km, US East-to-West is ~4500km, so the bounding box fits
// most country-scale trips while rejecting cross-continent
// hallucinations.
//
// max-v230 — Round FY.1: two follow-on fixes after FY shipped.
//
// (1) Reconcile path was dropping the _entryStop flag on dest objects
// (it propagated _exitStop but had no equivalent for _entryStop), so
// after _reconcileDestinations ran, the entry buffer destination
// looked unflagged to the auto-merge — which then folded the buffer
// and the kept main-stay into a single destination. Symptom: only
// one Reykjavik card at the start instead of buffer + main. Fix:
// propagate _entryStop in both reconcile branches (claim-existing
// and fresh-create), mirroring _exitStop.
//
// (2) Trip-view didn't have a banner for the entry buffer — only
// for exit. Added a parallel banner that detects via _entryStop,
// reads "Buffer night in <city>. Max added one night here right
// after you arrive, so jet lag and a late flight don't push you
// straight into sightseeing. Your main <city> stay is a separate
// destination — drag it wherever fits the trip." Same Drop / Keep
// pattern as the exit-buffer banner. Dismissable; persists on
// trip.entryBufferNotice.
//
// Map issue (Switzerland coords showing for Iceland trip) is still
// being chased — needs Neal's _tb.region console value to identify
// the source.
//
// max-v229 — Round FY: symmetric arrival buffer. Now both ends of
// the trip get an anchored 1n buffer destination — entry side gets
// _entryStop:true, exit side gets the existing _exitStop:true. The
// user's main stay at the gateway city becomes a separate movable
// destination, defaulting to right after the arrival buffer but
// drag-and-droppable to wherever fits the trip.
//
// New _tb.entryBuffer field, default true, mirrors _tb.exitBuffer.
// Picker / Parameters checkbox: "Buffer night in your arrival city
// to recover from your flight." Persists on trip.brief.entryBuffer.
//
// Build-time logic in buildFromCandidates: the existing entry-stop
// synthesis (which prepended a 1n stop only when entry city wasn't
// at head) now ALSO prepends when the entry city IS at head,
// provided entryBuffer is on. Uses canonical entry-city spelling
// + lat/lng so the synthesized buffer points at the same place as
// the kept main stay. _entryStop:true flag added to the buffer
// destination.
//
// _mergeAdjacentSamePlaceDests updated to skip when either adjacent
// destination has _entryStop or _exitStop — buffers are anchors,
// they never absorb into a same-place neighbor. So the default
// shape "Reykjavik 1n buffer + Reykjavik 3n main stay" stays as
// two distinct cards instead of merging back to Reykjavik 4n.
//
// Works for any trip, loop or path. For Switzerland Zürich → Geneva
// you'd get Zürich 1n entry buffer + Zürich 3n main + ... + Geneva
// 1n exit buffer.
//
// Neal's framing: "the user can move the main stay in a city from
// beginning to end."
//
// Default position of the main stay is right after the arrival
// buffer (60-40 preference per Neal). User reorders via drag/drop,
// up/down arrows, or the FV ↺ Reverse button.
//
// max-v228 — Round FX: root-cause fix for the duplicate Reykjavik
// build-time bug. orderKeptCandidates' route-block placement was
// pushing the same candidate twice when a route's two endpoints
// resolved to the SAME kept candidate object — Iceland's case: a
// route like "Iceland Ring Road" with endpoints Reykjavik →
// Reykjavik (for the round trip) produced
// matching=[reykCand, reykCand], pickDirection returned the pair
// unchanged, and the foreach pushed Reykjavik into `ordered` twice.
// Reconcile then emitted two destinations for the same place,
// adjacent at the start of the trip.
//
// Fix: track seen ids in `ordered` and skip pushing a candidate
// already in the list. Applied in two places — the route-block
// loop (where the bug was) and the remaining-candidates append
// (defense in depth so no upstream pass can sneak a duplicate in).
//
// Symptom now resolves at the source — picker says Reykjavik 3n,
// build emits one Reykjavik 3n + one Reykjavik 1n buffer, total
// trip nights match picker + 1 buffer. The FW.1 safety-net merge
// stays in place as a backstop for any other future emit-twice
// edge case but won't be needed in normal builds.
//
// max-v227 — Round FW.1: safety-net merge for adjacent same-place
// destinations at the end of buildFromCandidates. Round DZ.1
// dedupes destinations by id during reconcile, but not by place
// name. Iceland symptom: Reykjavik 3n + Reykjavik 3n adjacent at
// the start of trip.destinations, with a separate Reykjavik 1n
// (proper _exitStop buffer) at the end. The picker only had one
// Reykjavik (3n), but the build emitted two — likely a legacy
// corruption from a prior build that DZ.1's by-id dedupe couldn't
// catch, or a live edge case in orderKeptCandidates' route-block
// handling.
//
// Fix: call _mergeAdjacentSamePlaceDests (FW) right after the
// reconcile pass. It sums nights, concatenates day blocks /
// bookings / locations / items, dedupes suggestions /
// attachedEvents / dayTrips, preserves _exitStop, and recomputes
// trip dates. Same function that fires after moves and reverse —
// applied at build time as a safety net so duplicate-emit doesn't
// reach the trip view in the first place.
//
// max-v226 — Round FU.1: prefer seeded region coords over
// _pickerBounds for the picker map's initial view. Was the other
// way round, which let stale place-geocode entries from prior
// sessions (Switzerland coords lingering in _coarseGeocode) leak
// into _pickerBounds and override Iceland's seed. Now the seed
// wins when the user has stated a region we know — the seed is
// the user's actual stated intent (highest signal). Picker bounds
// remains the secondary path for unseeded regions where we have
// no other anchor.
//
// max-v225 — Round FW: auto-merge adjacent same-place destinations
// after moves and reverse, plus simplify reverseTripOrder to drop
// the round-trip-vs-path special-case.
//
// The bug: on a round-trip with a buffer night (Iceland: Reykjavik
// (entry) → Blue Lagoon → Reykjavik (returning) → ...), moving Blue
// Lagoon out of position [1] left the two Reykjavik stays adjacent
// at [0] and [1]. Visually: two identical destination cards in a
// row. Nothing in executeMoveDest detected or fixed this.
//
// _mergeAdjacentSamePlaceDests walks trip.destinations and folds
// any pair sharing a normalized place name into one: sums nights,
// concatenates day blocks (cap 7, overflow items folded into the
// last kept day so nothing is silently dropped), concatenates
// hotelBookings, generalBookings, locations, todayItems,
// discoveredItems, dedupes suggestions/attachedEvents/dayTrips,
// preserves _exitStop. Then recomputes dates trip-wide. Called
// from both executeMoveDest and reverseTripOrder; chosen
// auto-merge over warn-and-ask because the destinations carry
// rich state and re-asking the user is more friction than the
// merge itself.
//
// Reverse simplification: removed the round-trip detection
// (firstKey === lastKey → reverse middle only). For round trips
// the result is identical to a full reverse, since the same
// place is at both ends either way. Special-case code was
// extra logic for no payoff. Always full reverse now; FW's
// auto-merge handles any duplicates that emerge.
//
// Neal: "a circle is a circle, a loop a loop."
//
// max-v224 — Round FV: ↺ Reverse-order button in the trip-view
// destination list header. Flips trip.destinations and recomputes
// dates by walking forward from the first destination's start date.
//
// For round trips (first.place === last.place by normalized name)
// only the middle destinations reverse — entry and exit stay
// anchored. Iceland's ring road clockwise → counter-clockwise just
// flips Vík/Höfn/Egilsstaðir/Akureyri, leaves Reykjavík at start
// and end. For paths (Switzerland-style with different entry and
// exit), the whole list reverses including the endpoints — also a
// real case (the user might want Geneva→Zürich instead of
// Zürich→Geneva).
//
// Only shown for trips with 3+ destinations. No dialog, no
// confirmation — clicking again reverses back. Same "Max suggests,
// you decide" pattern as the rest of the trip view.
//
// Deliberately did NOT add Max-explanation of the original direction
// (which Neal asked about). The choice came from angular sort
// (Round DO) for round trips and nearest-neighbor (Round CN) for
// paths — geometry, not narrative. Anything Max could say about
// "why this direction" would be guessing. Reverse-without-defense
// is the cleaner pattern.
//
// max-v223 — Round FU: seed common regions in _coarseGeocode so the
// picker map zooms correctly from frame zero. Was empty by default,
// which meant the Iceland trip (and any non-Europe destination) saw
// a ~1.5s flash of the Europe fallback ([48, 14] zoom 4) before
// Nominatim's async lookup snapped the map to the right place.
// Seeded ~35 common travel regions; anything not in the seed still
// hits Nominatim and lands in the cache for next time. Same lookup
// path as before, just with a non-empty starting cache.
//
// max-v222 — Round FQ.2: collapse the FQ verdict banner to a single
// static day-trip note. The dense/spread/mixed labels + pair callouts
// pattern shipped first read as judgmental ("Mixed geography" with a
// list of friction-pair callouts) and presumed too much about how the
// user would plan their trip. Replaced with one message in Neal's
// voice that frames day-trips as an option in either direction:
//
//   "As you explore the various destinations you may find
//    opportunities for day trips. You might want to stay in a
//    larger city and take day trips from there to smaller cities.
//    But sometimes, staying in a smaller city and taking day trips
//    to the larger one may suit you better. Hotels may be cheaper,
//    and the smaller city's pace may be more to your liking."
//
// Same content for picker and trip view. No LLM fetch on render —
// the banner is static and shows immediately. Pair-time computation
// (and the LLM brief block's geographic-context line, also dropped)
// were both downstream of the verdict and went with it. The Explore
// tab's per-destination day-trip section keeps the FT mechanism (Neal's
// Liden→Amsterdam multi-day pattern) and uses haversine fallback for
// distance estimates when no LLM transit info is cached.
//
// FQ engine functions (_fqHaversineKm, _fqGetTransitInfo, etc.) stay
// in the file for now — left as dormant code in case we want richer
// transit info in the Explore tab later.
//
// max-v221 — Round FS + FT bundle: drop the legacy shortlist banner,
// soften the FQ verdict copy, and add a multi-destination day-trip
// mechanism with night transfer + user-adjustable threshold.
//
// FS — Removed showShortlistBanner (was "✓ N places — draft schedule
// below"). Redundant with the trip view itself + FQ verdict + the
// always-visible Parameters button. Same logic as FR's home-screen
// dedupe — one CTA per action, one banner per insight.
//
// FT.1 — Verdict summary lines rewritten to inform rather than
// prescribe. Was "...you could base in one place and day-trip out
// if you wanted." Now "As you explore these places, you'll find
// opportunities for day trips between them." Doesn't presume the
// user will base in the bigger city — Liden as a base with day-trips
// to Amsterdam is just as valid as the other way round.
//
// FT.2 — Multi-destination day-trip mechanism. The user can now
// schedule a day-trip from any trip destination to any OTHER trip
// destination within an adjustable threshold. Each schedule
// transfers a night: hub +1, target -1. Same target can be
// scheduled on multiple days (Liden→Amsterdam Day 2 AND Day 4).
// Items carry peerDayTrip:true + peerTargetId so reversal can
// undo the transfer.
//
// Implementation: new helpers in the FT block at top of script —
// _ftParseHoursInput (free-form duration parser), _ftFormatHours,
// _ftGetThresholdHours, _ftRecomputeTripDates, _ftResizeDestDays
// (grow/shrink days array preserving items), _ftSchedulePeerDayTrip,
// _ftReverseNightTransfer, _ftPeerDayTripCandidates (returns
// destinations within threshold using FQ pairwise transit data
// or haversine fallback). Refuses to take target's last night —
// the destination-disappearance-at-zero-nights design (Neal's full
// Liden/Amsterdam pattern) touches the reconcile path and is
// staged for a follow-up round.
//
// FT.3 — Day-trip targets stay visible after scheduling. Existing
// absorbed-chip section rewritten so the day picker shows ✓ marks
// on placed days and stays visible — clicking ✓ removes that day's
// placement, clicking unmarked adds it. New peer day-trip section
// uses the same pattern. addDayTripToDay no longer enforces
// one-place-one-day; the new removeDayTripFromDayItem function
// removes from a single day rather than all days.
//
// FT.4 — Reversal. removeDayTripFromDayItem detects peer-day-trip
// items by their peerDayTrip flag and calls _ftReverseNightTransfer
// to add the night back to the target and remove from the hub.
// Hub never shrinks below 1 night.
//
// FT.5 — Threshold control. Free-form text input on each Explore
// tab's "Day trips to other places" section. Accepts "3", "3.5",
// "3:30", "3h", "3h 30m". Default 3h. Persists trip-wide on
// trip.dayTripThreshold. Setting changes apply to every Explore
// tab on the trip.
//
// What's deferred to a future round (FT.6 or later):
//   * Destination-disappearance-at-0-nights with resurrection on
//     reversal. The math is clean (zero-sum nights), but the
//     reconcile/rebuild path that handles destination identity is
//     fragile and adding "remove and re-create on reversal" needs
//     careful test coverage.
//   * Map-initiated day-trip scheduling (clicking a destination
//     pin). Neal clarified the map is for visualization, not
//     a separate UI affordance.
//
// max-v220 — Round FQ.1: fix the trip-view banner not rendering on
// real trips, and rewrite the verdict summaries in Neal's voice.
//
// Bug: trip.destinations objects don't carry lat/lng — the three
// build paths (incremental at line 9943, full reconcile fresh-create
// at 12489, manual-add at 15158) all create dest objects without
// lat/lng fields. Only trip.candidates carries them. So the trip-
// view banner's filter
//     typeof d.lat === "number" && isFinite(d.lat)
// rejected every destination and the IIFE returned early with
// "places.length < 2", silently. The picker banner worked because
// it reads c.lat/c.lng directly off candidates.
//
// Fix: build a place-name → lat/lng map from trip.candidates inside
// the trip-view IIFE, and resolve each destination through it
// (preferring d.lat/d.lng if present, falling back to the candidate
// lookup). Uses _normPlaceName for diacritic normalization so
// "Zürich" and "Zurich" map to the same coords.
//
// Also rewrote the verdict summary copy in Neal's voice:
//   * dense  → "These places are close together. There are a lot of
//              opportunities to base yourself in one and take day-
//              trips to the others."
//   * spread → "These places are spread out. Expect real travel time
//              between stops, and plan time to resettle when you
//              arrive."
//   * mixed  → "Mixed geography. Some hops are short; others are
//              longer hauls. Sequence will matter."
// The previous "you could…" framing was directive; the new framing
// is informational, in keeping with "Max suggests, you decide."
//
// Future hygiene to do later: propagate lat/lng onto fresh dest
// objects in all three build paths so the candidate-lookup fallback
// becomes redundant. Not urgent — the fallback works for both new
// and existing trips.
//
// max-v219 — Round FR: drop the redundant "Start your first trip"
// button in the home-screen empty state. The "+ Start a new trip"
// button in hs-actions just below is always visible and does the
// same thing — having two CTAs for the same action stacked on one
// screen was clutter. The "No trips yet. Start one — or just look
// around." line is enough direction.
//
// max-v218 — Round FQ: geographic-affordance pass replaces Round FO's
// between-mode pill. Max now informs the user about the geometry of
// the destinations they've picked, instead of asking them to declare
// a transport mode up front.
//
// What gets computed:
//   * Pairwise haversine distances client-side over the picked
//     destinations (trip.destinations or _tb.candidates with
//     status==="keep", filtered to those with lat/lng).
//   * Per-pair transit info via callMax — drive hours, train hours,
//     flight availability, primary mode, short note. Cached
//     automatically by callMax's IDB cache (sorted-pair signature
//     ensures (A,B) and (B,A) hit the same cache entry).
//   * Aggregate verdict: "dense" (≥60% of pairs reachable in <2h
//     door-to-door), "spread" (≥50% of pairs taking >4h), else
//     "mixed". Plus 2-3 representative pair callouts (shortest +
//     longest, with the middle on bigger trips) for the banner.
//
// Where it's surfaced:
//   * Picker right pane: a verdict banner at the top of the candidate
//     list. Updates live as the user toggles candidates because
//     renderCandidateCards is the toggle hook. Skeleton shows while
//     LLM info loads; cached pairs render instantly.
//   * Trip view: a verdict banner near the top, mimicking the
//     buffer-night banner pattern (Round FE). Persists on
//     trip.geoAffordance keyed by a place-name signature so reload
//     is instant. Dismissable; re-shows when destinations change
//     (signature mismatch ⇒ recompute).
//
// Design philosophy (Neal): "I don't think Max should tell you what
// to do. It can, however, point out that certain trips can take
// advantage of being able to spend more time in a place, but let the
// user decide." The verdict is informational. The user decides
// whether to consolidate, base-and-orbit, sequence-and-move, etc.
//
// The case for testing on Switzerland first: Switzerland's geography
// enables a choice — dense, transit-rich, you could base in one place
// or sequence through five. The verdict's information actually
// changes what the user might decide. Iceland's geography demands
// the answer (spread out, drive-heavy ring road), so the verdict
// just confirms what the user already knows. If the design works at
// the Switzerland pole, it works.
//
// What was dropped:
//   * _tb.betweenMode field and the popover trio in
//     _tbToggleStep2ModePopover (back to entry/exit pair only).
//   * The "How you're getting around between stops" pill row in
//     _tbEntryExitModesOnlyHtml.
//   * betweenMode persistence on _tb snapshots (Step 2 capture
//     and edit-mode capture) and on trip.brief at build time.
//   * The "Between destinations: <mode>" line from both the pre-
//     candidates and post-candidates LLM brief blocks. The post-
//     candidates block now threads the verdict's summary string in
//     its place ("Geographic context: ..."); pre-candidates omits
//     a sequencing hint entirely (no destinations to read yet).
//
// Validation (still to run): both the Switzerland scenario
// (Zürich → Lucerne → Interlaken → Zermatt → Lausanne, expected
// "dense") and the Iceland scenario (Reykjavik → Vík → Höfn →
// Egilsstaðir → Akureyri, expected "spread"). Tuning thresholds if
// either misclassifies.
//
// max-v217 — Round FP: seed road-trip phrasing in the place-mode
// context placeholder so users planning a road trip have a model
// for what to type. Was: "e.g. first time there, traveling with
// parents, want to avoid the obvious tourist stuff". Now leads
// with "self-drive road trip" so Iceland-style trips have an
// obvious shape to copy.
//
// Deliberately small: didn't remove the Round FO between-mode
// pill. Iceland will tell us whether the structured pill earned
// its keep or whether free text + this hint is enough on its own.
// Decision after dogfood, not before. Also bumped CACHE from
// max-v177 to max-v217 to align the cache constant with the
// header round counter — they had drifted (header tracked round,
// CACHE constant got skipped on several rounds).
//
// max-v216 — Round FO: between-destinations transport mode in the
// brief. Was an implicit gap — entry and exit modes were captured
// but not how the user moves between stops. For Iceland (self-drive
// Ring Road), Switzerland (Swiss Travel Pass / train), or a US
// road trip, the dominant between-mode meaningfully changes how
// Max should sequence the trip and what the Routing tab should
// surface.
//
// Implementation:
//   * New _tb.betweenMode field, persisted on trip.brief.betweenMode.
//   * New "How you're getting around between stops" pill row in the
//     Step 2 brief, between the Arrival and Departure pill rows.
//   * Same _tbModePillsHtml + _tbPickMode plumbing as entry/exit, so
//     all three popovers behave identically. _tbToggleStep2ModePopover
//     now dismisses every other popover, not just the one peer
//     (was hardcoded entry↔exit).
//   * Threaded into both LLM prompt summaries (the choreographer
//     brief block and the picker preview block) with a hint to
//     sequence accordingly: "if drive, prioritize geographic
//     proximity and a continuous loop or linear path; if train,
//     sequence by rail-network connections." Skips emitting the
//     line when betweenMode is empty / unsure / none.
//
// Iceland use case: user picks Fly entry, Drive between, Fly exit.
// LLM gets a self-drive sequencing hint; Routing tab can surface
// rental car options and gas pricing rather than train schedules.
//
// Defaults: betweenMode is empty by default — user has to pick. The
// LLM guidance triggers only when explicitly set, so existing trips
// that don't have it set behave as before.
//
// max-v215 — Round FN.10: drag-and-drop between days for itinerary
// items. mkItinItem rows now `draggable=true` with dragstart/dragend
// handlers that stash the source coords (item id, day id, slot,
// type) on dataTransfer. Each `.slist` (day slot, evening slot) is
// wired by `_wireItinDropTarget` with dragover/dragleave/drop —
// drop pulls the source item out of its day's items array, sets
// .slot to the target slot, pushes onto the target day's items,
// autoSaves, redraws.
//
// Visual feedback: while dragging, all eligible drop targets get a
// soft dashed outline (body.itin-dragging .slist). The hover target
// gets an amber tint (.slist.drop-target). dragend cleans both up.
//
// Constraints:
//   * Cross-destination drag is rejected (stays within one dest).
//   * Day-trip items can't be dragged to evening slot or to a
//     different day — those moves must go through the inline
//     day picker / chip menu so the chip's placement metadata
//     stays consistent.
//
// Neal: "I do sorry to interrupt, give me a test case though" —
// after asking what drag/drop between days meant. Built the feature
// in the same round.
//
// max-v214 — Round FN.9: clear out the bigger-pass audit findings
// from audit-fn-bigger.md. The "duplicate function" finding turned
// out to be a misread — only one definition exists.
//
//   mkItinItem:
//     * Story button gets a tooltip ("Story about {name}") so the
//       bare "story" label isn't opaque about what it does.
//     * fS(id, did) defense was checked and isn't needed — fS
//       already scopes to a single destination via getDest(destId).
//
//   mkExploreSuggestion:
//     * Row click now muted (cursor:default + tooltip) when the
//       item has no lat/lng, so clicking the row no longer silently
//       does nothing.
//     * Map pan-to-pin now clamps zoom: only zooms in if current
//       zoom < 13, otherwise pans without changing zoom. Was: yanked
//       the user from any wide view down to street level.
//
//   toggleHotelForm:
//     * Validates check-out > check-in (alert + return on backwards
//       dates).
//     * Defends against opts.destId resolving to null (dest removed
//       while form was open) — alert + return instead of throwing.
//     * Validates price >= 0 (rejects negatives that would corrupt
//       spend totals).
//     * Confirmation # gets a placeholder ("e.g. ABC123") matching
//       the style of other inputs.
//
//   mkCurrSel: extended currency list from 6 to 15. Common-first
//   ordering: EUR/USD/GBP/CHF, then CZK/HUF (held over), then ISK/
//   JPY/NOK/SEK/DKK/AUD/CAD/NZD/MXN. Covers the destinations Max
//   already models without forcing a code change for each new trip.
//
//   mkItinAddRow:
//     * Contextual placeholder uses the dest's place name —
//       "Sight or activity in Lucerne…" / "Restaurant or evening
//       activity in Lucerne…" instead of generic "Sight or
//       activity…".
//     * Tooltip on the Add button toggles between "Type a name
//       first" (disabled) and "Add to {slot} slot" (ready).
//
// Deferred (audit flagged but better surfaced via Iceland dogfood):
// drag/drop between days, LLM-enrich manual sight adds, autocomplete
// against existing suggestions, withUndo helper extraction.
//
// max-v213 — Round FN.8.20: four polish items (I + J + K + L).
//
//   I. Undo toast on × Delete for hotel / transport / general
//      bookings. Snapshots dest.hotelBookings or leg.bookings or
//      dest.generalBookings + trip.pendingActions before mutation;
//      undo restores both and redraws. Symmetric with FN.8.18's
//      × Remove undo on the destination card.
//   J. Stay tab cancelled-record disclosure. When a hotel has 2+
//      cancelled records, they collapse under a "▾ Show N
//      cancelled" toggle. Single cancelled records still inline
//      since the cost is low. Reduces visual clutter when a hotel
//      has been cancelled and re-booked-and-cancelled multiple
//      times.
//   K. Chip box header at the top of dest detail loses the 📍 pin
//      and the all-caps treatment; reads "Day trips from {hub} ·
//      not yet scheduled" in sentence case to match the new "Day
//      trips" header in the Explore tab (FN.8.19).
//   L. Trip diary section gains a one-line intro: "Sights,
//      restaurants, and notes from each day land here once you
//      mark them done. Anything else you want to remember about
//      being here, log below." Mirrors the Want-to-see hint
//      added in FN.8.18.
//
// max-v212 — Round FN.8.19: three more polish items (E left as-is).
//
//   F. Drop the redundant "↩ Stay overnight" button from the
//      unscheduled Explore DAY TRIPS section. The user just clicked
//      Make day trip — offering "no really, make it overnight"
//      right next to the day picker created choice paralysis. The
//      Cancel-day-trip button on the Itinerary item handles the
//      change-of-mind case after scheduling (it restores the place
//      as a destination, same flow ungroupDayTrip ran).
//   G. "DAY TRIPS" → "Day trips". All-caps banner read louder than
//      the surrounding section headers ("Sights", "Restaurants").
//      Sentence case + slightly larger font matches the rest.
//      Letter-spacing dropped (was tracking the all-caps look).
//   H. Save-status "✓ Saved" flash on every autoSave. Uses the
//      existing showSaveStatus + #save-status surface (already used
//      for file-load errors) — no new chrome. Wrapped in try/catch
//      so it can't break a save if the status element isn't in the
//      DOM. The 1.5s timer auto-resets on rapid saves, so heavy
//      input doesn't spam — the flash only fades after ~1.5s of
//      no input.
//
// max-v211 — Round FN.8.18: clear out four small parked items.
//
//   A. × Remove → undo-toast (was queued as FL.1). New
//      delDestWithUndo wraps delDest with an optimistic delete +
//      6-second undo toast. Snapshots trip.destinations,
//      trip.pendingActions, per-dest aux state (ffHistory / story /
//      notes), and trip.overBudgetNotice before delete; restores all
//      on undo. Replaces the confirm() prompt at the destination
//      card's × Remove button.
//   B. Tracker "Want to see" UX. Neal: "how do things get there?"
//      Added a one-line hint under the section heading explaining
//      what to add ("anything you've heard about and might want to
//      look up later"), and rewrote the placeholder ("e.g. that
//      bakery a friend mentioned, the river walk…") so the input
//      reads as freeform and inviting.
//   C. Dead-code cleanup in the DAY TRIPS section. After FN.8.16
//      gated the assignRow build on `placedOnDay < 0`, the inner
//      `if (placedOnDay >= 0)` block (Change day toggle, Cancel
//      button) and the placed-vs-unplaced if/else for the dayCapsules
//      label became unreachable. Deleted both. Management for placed
//      chips lives on the Itinerary day-trip item now.
//   D. Test 2.5 dialog investigation: showDateChangeDialog already
//      fires for any dest with a booked hotel, and Neal's report
//      ("✓ Confirming generates a Provider action needed entry")
//      confirms the dialog path was taken — he confirmed it. The
//      dialog text could call out "outside stay window" more
//      explicitly; logged as a copy-pass for later but not a logic
//      bug. No code change here.
//
// max-v210 — Round FN.8.17: two follow-ups for day-trip flow.
//
//   * Scroll-to-day after picking a date in the Explore picker now
//     actually works. Bumped the post-redraw setTimeout from 80→
//     250ms and switched scrollIntoView to behavior:'instant' +
//     block:'center'. The 80ms wasn't always landing after
//     drawDestMode's double-rAF preserve, especially on slower
//     frames; the smooth-scroll could also lose to the preserve.
//     Now the scroll wins reliably.
//   * "+ Add to {Day}" button on each sight in the Explore DAY TRIPS
//     section. Mirrors the FN.8.15 chips on the Itinerary day-trip
//     item — same data flow, just rendered alongside the planning
//     surface in Explore. When the chip is unscheduled, the button
//     greys out with a tooltip pointing to the "Place on:" picker
//     above. Once placed, the button reads "+ Add to {Day label}"
//     and adds the sight as a sight item on that day; the row drops
//     out (deduped against the day's items by name) so progress is
//     visible.
//
// Neal: "The scroller doesn't scroll to the new day trip entry. I
// think the add sight is good in iterary, but really should have
// that option in explore as well."
//
// max-v209 — Round FN.8.16: bring back the date picker to the
// DAY TRIPS section in Explore, but ONLY for unscheduled chips.
// Neal: "when you select a day trip the ability to schedule it
// has gone way, with the ability to schedule it in a banner
// under explore."
//
// Logic split:
//   * Unscheduled chip → "Place on:" capsule row + ↩ Stay overnight,
//     wrapped in an amber-tinted banner so it reads as a "schedule
//     this" prompt right where the user just made the day trip.
//   * Placed chip → no management UI in Explore; just header +
//     scheduling status + sights. Move/Cancel/Stay overnight all
//     live on the Itinerary day-trip item (FN.8.14).
//
// Net flow: Make day trip → see the schedule prompt right under
// the section header → pick a day → page jumps to Itinerary where
// management lives.
//
// max-v208 — Round FN.8.15: surface day-trip city sights as
// first-class quick-add chips under the day-trip item in the
// Itinerary, but only on the day the day-trip is placed. Neal:
// "You can add to the day trip to add the sights from the
// itinerary. They are now first class choices, but only for the
// day trip day."
//
// Why this is needed: once a place becomes a day-trip chip, it's
// no longer in trip.destinations — so its sights aren't reachable
// from anywhere in the Itinerary's normal add-flow. Now under the
// day-trip item's transport sub-line, we render up to 8 iconic
// sights from _generatedCityData[place] as small "+ Sight" chips.
// Click a chip → adds the sight as a regular sight item on the
// same day with the same model as any other sight (story button,
// move, book, delete, time, etc.). Chip drops out of the row once
// added (filtered against the day's existing items by name).
//
// Only renders for the day the day-trip is placed on, since the
// item only appears on that one day. Works alongside the read-only
// DAY TRIPS section in Explore (FN.8.14) which shows the full
// sight list as a planning surface.
//
// max-v207 — Round FN.8.14: simplify the Explore tab's DAY TRIPS
// section + move all management actions to the Itinerary item.
// Neal: "Why is there even a section of day trips in the explorers,
// it is already in the itinerary. ... still need a day trip section
// because of sights there, but without all those buttons."
//
//   * DAY TRIPS section in Explore: keeps the category banner +
//     per-chip header + the day-trip place's sights inline (the
//     planning surface — what to DO at the day-trip city). All
//     management UI (day picker, Change day, Cancel, Stay overnight)
//     suppressed via `if (false)` around the assignRow build.
//   * Itinerary day-trip item: gains a "Cancel day trip" button next
//     to "→ Plan transport" on the transport sub-line. Cancel calls
//     ungroupDayTrip with silent option, so the place is restored as
//     a destination in trip.destinations. It then re-appears in
//     "Could be a day trip from here" candidate list. Confirms first
//     since trip dates shift.
//
// Net result: management lives on the Itinerary item (where the
// scheduled day trip already is); planning/discovery lives in the
// Explore section (sights). Each surface has one job.
//
// max-v206 — Round FN.8.13: button label "Drop day trip" → "Cancel
// day trip." Same behavior, more natural verb that matches the
// app's existing cancel-a-booking mental model. Confirm dialog
// updated to read "Cancel the day trip to {place}?"
//
// max-v205 — Round FN.8.12: repurpose "Remove from itinerary" as
// "Drop day trip" — a full removal that:
//   1. Removes the chip from hub.dayTrips
//   2. Subtracts the absorbed sourceNights from the hub
//      (so the hub doesn't keep nights it was only expanded to
//      hold a day trip the user no longer wants)
//   3. Removes any placed daytrip items from hub.days
//   4. Regenerates hub.days for the new night count, preserving
//      items by old index
//   5. Recomputes trip dates and re-evaluates over-budget
//
// Distinct from ↩ Stay overnight, which restores the source as a
// separate destination. "Drop day trip" leaves no trace — the place
// is gone from the trip entirely, and the trip duration shrinks by
// the absorbed nights.
//
// Confirms before applying since the hub's nights shrink as a side
// effect, and the dialog routes the user to "↩ Stay overnight" if
// they wanted to keep the nights.
//
// Neal: "what is the point of remove from itinerary" → narrow
// use case, simpler to fully drop and route the keep-the-nights
// case to Stay overnight.
//
// max-v204 — Round FN.8.11: wrap day-trip chip sections under a
// single "DAY TRIPS" category header in the Explore tab. Without
// the category banner, each chip rendered as its own top-level
// section with a "📍 {place} — day trip from {hub}" header that
// blended into the sights/restaurants flow above. Now:
//
//   * Purple "DAY TRIPS" banner once, before all chip sections.
//   * Each per-chip title is just the place name ("Lausanne") — no
//     pin, no "day trip from X" qualifier (the category header has
//     that framing).
//   * Meta line under each title still carries scheduling status
//     and distance, unchanged.
//
// Neal: "I don't think 📍Lausanne — day trip from Geneva does enough
// to distinguish this as a new category, maybe create a section
// 'Day Trips' and have that under it, without the pin."
//
// max-v203 — Round FN.8.10: hide the date capsule row when the day
// trip is already scheduled. Once you've picked a day, the row of
// Jul 11 / Jul 12 / Jul 13 / Jul 14 capsules is just noise — the
// header already says "scheduled for Mon, Jul 11." Now: capsules
// are hidden by default after placement, surfaced behind a small
// "Change day ▾" toggle when the user wants to move the trip. The
// "Remove from itinerary" and "↩ Stay overnight" buttons stay
// inline (they're the other actions a placed trip needs). Unplaced
// state is unchanged — capsules show immediately under "Place on:".
//
// max-v202 — Round FN.8.9: redo the day-trip section header. The
// single-line "Saas-Fee day trip · on Mon, Jul 11 (17km away)" was
// trying to do three jobs in one bar — name the place, declare the
// status, hint at distance — and nothing read as the focal point.
//
// Now a two-line header:
//   Line 1 (bold): "📍 Saas-Fee — day trip from Zermatt"
//   Line 2 (meta): "✓ scheduled for Mon, Jul 11 · 17km away · sights
//                   and transport below"
//
// Line 1 makes the place the anchor; line 2 conveys schedule status
// (✓ scheduled or ⚠ not yet scheduled), the distance, and a hint
// that the section continues with sights + transport. The "sights
// and transport below" tail addresses Neal's request that the header
// should "let the user know what follows is in the day trip."
//
// max-v201 — Round FN.8.8: day-trip section header now conveys the
// scheduling status, and the post-Make-day-trip scroll lands more
// reliably on the inline day-picker.
//
//   * Header: was "📍 Day trip · Saas-Fee (17km away)" before AND
//     after placement, leaving the user uncertain whether they'd
//     scheduled the trip yet. Now reads:
//       Unplaced: "📍 Saas-Fee day trip · not yet scheduled (17km)"
//       Placed:   "📍 Saas-Fee day trip · on Mon, Jul 11 (17km)"
//     The status pill in the section header complements the chip
//     box at the top (which only lists unplaced chips per FN.7.3).
//   * Scroll fix: makeDayTrip used requestAnimationFrame +
//     scrollIntoView block:'start', which collided with drawDestMode's
//     double-rAF scroll-preserve and could land below the inline
//     day-picker. Switched to setTimeout(80ms) + block:'center' so
//     the day-picker reliably falls in view.
//
// Neal: "When you make something a day trip, the window scrolls so
// you can no longer see it and pick a day. ... but you should do a
// different header."
//
// max-v200 — Round FN.8.7: time input now accepts both 12-hour
// (with AM/PM) and 24-hour entry, normalizes to HH:MM 24h
// internally. Neal: "what if user wants am and pm (like most
// americans)."
//
// Accepted entry styles:
//   * "11:45 PM" / "11:45pm" → "23:45"
//   * "8 AM"                 → "08:00"
//   * "23:45"                → "23:45"
//   * "2345"                 → "23:45"
//   * "9:30"                 → "09:30"
//
// On blur, the displayed value is reformatted to 12-hour with AM/PM
// (using _fmtTime12h) for friendliness, regardless of how the user
// typed it. Storage is always 24-hour HH:MM so existing display
// surfaces don't need to change. Initial render also uses
// _fmtTime12h on the existing time so reload looks consistent.
//
// Placeholder is "e.g. 11:45 PM or 23:45" — both formats explicit.
//
// max-v199 — Round FN.8.6: replace <input type="time"> with a plain
// text input on the arrival/departure logistics form. macOS Chrome's
// time input parses digits segment-by-segment in a 12-hour picker
// (hours / minutes / AM-PM) — typing "2345" lands as "02:35" or
// similar, not "23:45." Neal's exact bug: entered 23:45, persisted
// as 04:57. Fix:
//   * Plain text input with maxlength=5, placeholder "e.g. 23:45,"
//     and a "(24h)" hint next to the label.
//   * New helper `_normalizeTimeField` accepts:
//       - "2345" → auto-formats to "23:45"
//       - "23:45" → kept as-is
//       - "9:30"  → padded to "09:30"
//       - anything invalid/partial → not saved (preserves raw text
//         so the user can keep typing without the cursor fighting).
//   * Saves through the existing _saveLogisticsField routing.
//
// max-v198 — Round FN.8.5: defensive filter on the "Could be a day
// trip from here" candidate list. makeDayTrip removes the source
// from trip.destinations, so it should naturally drop out — but
// Neal reported it staying in some case. Now also exclude any place
// that's already a day-trip chip on ANY hub, preventing double-
// listing if the underlying remove ever fails or races.
//
// Logged for later investigation: Test 3.5 — user entered "23:45"
// in the departure time input but `trip.brief.exitDetails.time`
// stored as "04:57". Roughly +5 hours suggests a timezone mangling
// somewhere, but the data is at least persisting. Marginal priority.
//
// max-v197 — Round FN.8.4: arrival/departure logistics layout fix.
// The two-column form used a rigid `grid-template-columns: 1fr 1fr`
// which on the trip-view's left panel forced each column too narrow,
// truncating the inputs. Switched to `repeat(auto-fit, minmax(220px,
// 1fr))` so the columns stack vertically when there isn't room
// side-by-side. Also added `min-width:0` to each column so grid
// items can shrink below their intrinsic content size, plus
// `width:100%; box-sizing:border-box` on each input so they fill
// their label width without contributing to overflow. Neal: "left
// panel for logistics is truncated with no way to expand it."
//
// max-v196 — Round FN.8.3: pre-select the Fly mode pill when no mode
// has been picked yet. _modeLabels already falls back to fly behavior
// (icon, verb, noun) when mode is empty, and FN.8.2 made "Flight
// number" the default field label. Only the pill highlight was
// out of sync — none lit up until the user clicked. Now Fly is
// visually selected by default; user clicks a different pill to
// override. Backed by `modeForPill = curMode || "fly"` for highlight
// only — entryMode stays empty in the data until the user actually
// clicks, so we don't silently auto-save state.
//
// max-v195 — Round FN.8.2: default Number label to "Flight number"
// instead of generic "Number." FN.4 made the label adapt to the
// mode pill (fly→Flight number, train→Train number, etc.) but kept
// "Number" as the fallback when no mode was selected. Most users
// fly, and the airline number is what they'd be hunting for in their
// inbox anyway. Now Flight number is the default; non-fly modes
// override.
//
// max-v194 — Round FN.8.1: pre-fill the arrival/departure date with
// the destination's bookend day so the user sees what's implied
// without having to remember it. Editable — change it if you fly in
// a day early or stay an extra night past the last city. The pre-
// fill is purely visual; details.date stays empty in the data until
// the user actually changes it (so an unedited form doesn't silently
// over-write the implied bookend day, and the trip-view rendering
// of the date stays sparse).
//
// Neal: "Actually, fill in the date but make it editable."
//
// max-v193 — Round FN.8: optional date field on arrival/departure
// logistics. Previously the form captured time only, with date
// implied to be the first/last destination's bookend day. Real-world
// case: user flies in a day early but doesn't want to add a no-night
// destination just to hold the flight info; same on the back end if
// they stay an extra night past the last city.
//
//   * Date input added next to the time input in _renderLogisticsCol,
//     shown side-by-side via flex layout. Label is "Arrives on" /
//     "Departs on" matching the time labels above. Auto-saves to
//     entryDetails.date / exitDetails.date through the existing
//     _saveLogisticsField inline handler — no new wiring needed.
//   * Display surfaces (trip-view card logistics line + dest detail
//     header logistics box) now include the date when set: e.g.
//     "Lands at 12:00 on Jul 1." Falls back to time-only when no
//     date is set, preserving existing behavior.
//
// Neal: "I think you need to be able to specify the date if you want
// to. You may fly in a day early but not care to put the information
// in the trip."
//
// max-v192 — Round FN.7.6: two day-trip plumbing fixes from Neal.
//
//   * Scroll-to-day still didn't work after assigning a day trip.
//     Root cause: the day blocks in the destination DETAIL view were
//     not getting an id ("dy-{day.id}"). Only the trip-view destination
//     card render path tagged its day blocks. addDayTripToDay's
//     scrollIntoView was looking for "dy-{day.id}" and finding
//     nothing. Now drawDestMode tags them.
//   * Routing tab had no way to enter a day trip's transport. The tab
//     only built sections for the prev→this and this→next legs. Day
//     trips are round-trips out of a hub and weren't represented.
//     Now each day-trip chip on the hub gets its own routing section
//     ("Day trip · {hub} ↔ {place} (round trip)") rendered after the
//     depart-to-next section. Uses a synthetic leg id "dt-{slug}" so
//     getLeg/transportForm can store bookings against it. Visual
//     treatment matches the day-trip color (purple left rail + tint
//     background) to group with the Itinerary item.
//
// Neal: "still doesn't scroll to the date. also for routing there is
// no way to enter the day trip."
//
// max-v191 — Round FN.7.5: "→ Plan transport" button on day-trip
// items in the Itinerary. The transport sub-line told the user to
// "book transport in Routing tab" but didn't take them there. Now
// the line has an inline button that switches the active tab to
// Routing on the hub, where the user can book the in/out leg
// without hunting for the tab. Click handler sets _activeDmSection
// and re-renders the dest detail. Neal: "Maybe need a button in
// Day Trip that sends you to the router."
//
// max-v190 — Round FN.7.4: visually distinguish day-trip items in
// the Itinerary so the user sees they're side trips that need
// transport, not on-hub sights.
//
//   * .srow.daytrip class on the row: soft purple background, 3px
//     purple left-rail in the same color as the chip box. Reads as
//     "this is a different beat" without being loud.
//   * Distinct purple 📍 dot instead of the standard sight dot, with
//     hover tooltip "Day trip — leaves the hub, return same day."
//   * Transport sub-line under the name: "↔ Round trip from {hub} ·
//     ~{2x km} round trip — book transport in Routing tab." Estimates
//     round-trip distance from the distance note already baked into
//     the day-trip item by addDayTripToDay/makeDayTrip.
//
// Neal: "you need to indicate it is a day trip meaning you need
// transportation as well."
//
// max-v189 — Round FN.7.3: two follow-on fixes for the day-trip flow
// that Neal flagged after FN.7.2 didn't fully land.
//
//   * Placed day-trip chips now drop out of the chip box at the top
//     of the dest detail (header section). Once a chip has been
//     assigned to a day, it lives in the Itinerary — leaving it in
//     the chip box duplicated the same info on screen and made the
//     box read like "things still to schedule" even when everything
//     was scheduled. The box is now labeled "Day trips from X · not
//     yet scheduled" and only renders unplaced chips. The Explore
//     tab's "Day trip · X" section keeps the inline day-picker so
//     placed day-trips can still be moved to a different day.
//   * Scroll to the placed day's block now actually works. FN.7.2
//     used requestAnimationFrame, which fires before drawDestMode's
//     double-rAF scroll-preserve logic finishes. Switched to
//     setTimeout(80ms) so our scrollIntoView runs after the preserve
//     and wins. Symptom was: scroll switched to Itinerary tab but
//     stayed at the top, not the placed day.
//
// max-v188 — Round FN.7.2: day-trip placement post-action.
//
// After placing a day trip on a day, two things now happen so the
// user can see where it landed:
//   * Active tab switches to Itinerary (was: stayed on Explore tab,
//     so the user couldn't see the placement without manually clicking
//     over to Itinerary).
//   * The placed day's block scrolls into view with a brief amber
//     pulse so the user sees exactly where the day trip landed.
// Plus the chip in the destination header shows the date label
// ("on Mon, Jul 17") instead of "on Day 1." Same fix as FN.7.1 for
// the inline picker buttons, applied to the chip box too.
//
// Source-destination already drops out of the "Could be a day trip
// from here" candidate list automatically — that list iterates
// trip.destinations and the source is removed by makeDayTrip.
//
// max-v187 — Round FN.7.1: day-trip "Place on" buttons now show the
// date label ("Mon, Jul 17") instead of generic "Day 1 / Day 2".
// Tooltip preserves the index ("Day 1 · Mon, Jul 17") for users who
// care about the position rather than the calendar date.
//
// max-v186 — Round FN.7: day-trip flow follow-up. Neal: "you make it
// a day trip and then you have to scroll back up to select it and
// assign it to a day."
//
// Two complementary fixes:
//   * Inline "Place on Day N" picker on every chip section in the
//     Explore tab. The dest detail header has a chip-box where clicking
//     a chip pops openDayTripMenu, but the user is mid-Explore when
//     they click Make day trip — having to scroll up to the chip box,
//     click, and pick a day from a floating menu is too many steps.
//     Now each "Day trip · {place}" section has its own inline row of
//     Day buttons, plus Remove-from-itinerary and Stay-overnight
//     options. Same operations, no scroll required.
//   * After makeDayTrip, scroll the new chip section into view with a
//     brief background pulse so the user sees where the next action
//     is. Replaces FN.6's "preserve prior scroll" — preserving scroll
//     was the wrong call when the natural next action lives in a
//     different section than the trigger.
//
// max-v185 — Round FN.6: two improvements Neal flagged after his
// Section 3+4 pass.
//
//   * Cancellation deadline → Cancel booking link. The deadlines list
//     in Tracking → Coming up showed "Sun, Jul 26 / Gasthof Bären /
//     Emmental · Hotel" but no way to act on it directly — user had
//     to navigate to Bookings → Hotels → matching record → Cancel
//     booking. Each row now has a Cancel booking action that mirrors
//     the existing cancel flow (sets status='cancelled', generates a
//     Provider action needed entry, autoSaves, redraws). Routes by
//     booking type — Hotel/Activity/Transport — so it works for all
//     three deadline sources. collectDeadlines extended to include
//     destId (and fromId/toId for transport legs) so the cancel
//     handler can find the right record without re-walking the trip.
//   * Day-trip flow polish.
//     1. makeDayTrip's drawDestMode call reset scrollTop=0, which
//        yanked the user from the "Could be a day trip" section in
//        Explore back to the top of the hub's detail. Now captures
//        scroll position before the redraw and restores on
//        requestAnimationFrame, same pattern as Round CK.9 / CL.2.
//     2. Day-trip chip tooltip was just "place · 23km from hub" —
//        didn't explain it WAS a day trip, or that clicking flips it
//        to overnight. Now: "Day trip from {hub} · {distKm}km away ·
//        Click to make this an overnight stay instead." The hover-
//        revealed "↩ stay overnight" inline action remains.
//
// max-v184 — Round FN.5: two more bugs from Neal's Section 1+2 pass.
//
//   * Edit dates silently failed on a 1-night destination. Trying to
//     shrink Emmental from 1 night to 0 set newTo === newFrom, which
//     hit the `if(newTo<=newFrom)return;` guard and exited without
//     feedback. Now alerts: "A destination needs at least one night.
//     If you want a zero-night stop, use × Remove on the destination
//     card to drop it from the trip."
//   * Closing destination detail back to trip view scrolled to the
//     top of the destination list. setLeftMode unconditionally reset
//     scrollTop to 0. Now when the user transitions dest→trip (and
//     activeDest is set, which it always is in that path), scrolls
//     the matching .tm-dest card into view (block:'center'). Other
//     transitions (initial load, etc.) keep the old top-reset
//     behaviour.
//
// max-v183 — Round FN.4: mode-aware "Number" label on arrival/departure
// logistics. Generic "Number" (placeholder "e.g. LH 730, IC 524, route")
// asked the user to mentally translate the form to their mode. Now the
// label adapts: Flight number / Train number / Route or bus # / Vessel
// or route / Vehicle or plate. Placeholder examples narrow accordingly.
// Falls back to plain "Number" before a mode pill is selected. The
// form already re-renders on mode change so the label updates live.
//
// max-v182 — Round FN.3: visible attention signal on the Tracking tab
// when there are open provider-action items. The JS to render a count
// badge on the Tracking tab existed since the tracker was built (Round
// CY area), but the CSS for .dm-tab-badge was never added — so the
// count rendered as plain text tacked onto the tab label, indistinct
// from the rest of the tab text. Now: a small red pill in the tab,
// plus the tab label itself goes red (.has-attention class), so the
// signal carries even when the user is on a different tab. Click
// handler preserves has-attention across tab switches (was being
// clobbered by className reassignment). Surfaced by Neal — "if there
// is a pending action that needs to be taken Track tab should be red
// or something."
//
// max-v181 — Round FN.2: two follow-on fixes from Neal's testing pass.
//
//   * `_actionCtr is not defined` on every cascade. newActionId() did
//     `++_actionCtr` but the global was never declared, so the very
//     first attempt threw "Cannot read properties of undefined". This
//     broke × Remove and Edit dates on any destination with bookings,
//     since both paths call addPendingAction. Other counters (bkCtr,
//     destCtr, sidCtr) were declared properly; _actionCtr was just
//     missed when the pending-action system was added. Now declared
//     `var _actionCtr = 0;` alongside the other counters and reset
//     in the new-trip / load-trip init paths.
//   * Edit dates didn't cascade. Shrinking destination C from 2 to 1
//     night left a gap between C's new dateTo and D's dateFrom; the
//     trip total night count and dates strip didn't move because
//     subsequent destinations still anchored to their old dateFrom.
//     applyDateChange now walks forward from the edited destination,
//     setting each subsequent dest's dateFrom = previous's dateTo
//     (preserving each kept dest's own nights count). Same pattern
//     as the delDest cascade in FN. Also calls _reEvaluateOverBudget
//     so the banner refreshes when the trip end-date moves.
//
// max-v180 — Round FN.1: Edit affordance on transport records.
// Hotel records had Edit (added DE/EH), but mkTransportRecord only
// had Cancel + Delete. So once you booked a train without entering
// time or URL — or wanted to correct a typo'd confirmation number —
// the only path was Delete + re-create, which loses history. Now
// has the same Edit flow as hotels: opens an inline form pre-filled
// with current values, including operator, date/time, conf, price,
// URL, and cancellation policy. Save replaces the record in place
// without redrawing the whole tab.
//
// max-v179 — Round FN: destination card mutation backlog from Neal's
// first morning testing pass. Five separate fixes bundled into one
// round because they all touch the booking/destination cascade and
// were uncovered by Section 1 of the test plan.
//
//   * delDest didn't redraw the trip view. When the user clicked
//     × Remove from the trip-view destination card, delDest only
//     called drawDestMode(activeDest), which is a no-op for the
//     trip view. Result: data updated, screen stale, "nothing
//     happened" from the user's perspective. Now branches on
//     _leftMode and calls drawTripMode() when in trip mode.
//   * delDest didn't recompute dates. Removing a middle destination
//     left the surviving destinations with their original dateFrom/
//     dateTo, so the calendar developed a gap. Now mirrors the picker
//     rebuild's date-recompute pass — re-anchors curDate at the trip
//     start and walks forward by each surviving dest's nights, also
//     shifts each day's date inside d.days when the array is intact.
//   * delDest didn't re-evaluate over-budget. trip.overBudgetNotice
//     can become stale once nights drop. Same pattern as FE.2 —
//     call _reEvaluateOverBudget() before redraw.
//   * Hotel name was missing from the Tracker hotel record. The
//     record's main line said only "✓ Booked · Jul 1 – Jul 4" with
//     no indication of which hotel. Visible on the Stay tab only
//     because the name sat in a separate banner. Now the name is
//     prepended on the main line.
//   * Cancelled hotel couldn't be rebooked. The Stay tab gated the
//     "Book" button on `!isBooked && !hasCancelled`, so once you'd
//     cancelled a property and changed your mind, the affordance
//     was gone. Dropped the !hasCancelled gate — cancelled records
//     stay below as history, but rebooking is allowed.
//   * Edit hotel form didn't include cancellation policy. Once you
//     set "cancel by Jul 12" on Book, you couldn't change it via
//     Edit. Added mkCancelField to the edit form, pre-selected to
//     the current policy.
//   * Cancellation deadline didn't capture time. Hotels often spell
//     deadlines as date + local time ("free cancellation until Jul
//     12 at 18:00"). Added a time input alongside the date in
//     mkCancelField; persisted as cancelDeadlineTime on bookings;
//     rendered in all four "Cancel by:" surfaces (hotel record,
//     transport record, day-item booking strip, cancellation
//     deadlines section).
//
// max-v178 — Round FM: fix "Add to day" on restaurant suggestions
// (Explore tab). mkExploreSuggestion's signature is (s, dest, type),
// but two callers — the inline restaurant render in buildExplorePane
// and buildRestaurantSection (used by refreshRestaurantSuggestions) —
// passed (s, "restaurant", dest), so dest ended up as the string
// "restaurant" inside the function. Click "Add to day →" → showAddToDay
// tries dest.days.forEach → TypeError "Cannot read properties of
// undefined (reading 'forEach')". Both call sites swapped to the
// correct (s, dest, "restaurant") order. Same swap was already
// correct on the sights call site (line 20264). Also dropped a stale
// "Restaurants live under Stay & Eat, not Explore" comment that
// predated FD. Surfaced first thing in test-plan-fl.md execution.
//
// max-v177 — Round FL: booking URL now displays on the trip-view
// destination card's logistics line, not just on the Itinerary
// tab's auto-injected chip. Captured at entryDetails.url /
// exitDetails.url by the logistics form (Round CK); the
// destination card's logistics renderer was showing carrier +
// time + confirmation + notes but ignoring the URL. Same "↗
// booking" treatment as the Itinerary chip — single-line, blue,
// stopPropagation on click so the card-click doesn't fire.
// Surfaced by the FK audit (item C / Logistics form code walk).
//
// max-v176 — Round FK: small On-the-ground tab cleanup.
//   * Section headers: previously the three sub-blocks (currency/
//     tipping/emergency grid → execution-mode rideshare panel →
//     local services like ATMs/banks) sat stacked with gray
//     separator rules but no labels. Added uppercase headers —
//     "Quick reference," "Getting around," "Local services" — so
//     the structure reads at a glance.
//   * Dead idle hint removed. The "On-the-ground info will load
//     when you open this tab." placeholder lived inside the
//     execution-mode container; the tab's click handler triggers
//     _renderExecutionGroups synchronously, so the placeholder
//     flashed for ~1 frame in practice. Empty container is fine.
//   * "Practical" → "Local services" — distinguishes from "Quick
//     reference" (also practical-tier data) and frames the list as
//     places-to-find rather than a generic catch-all.
// Note: the Itinerary chip → Routing tab navigation was already in
// place (chip.onclick at buildTransportChip line ~20793 sets
// _activeDmSection="routing"; cursor:pointer + :hover styling
// signals it's clickable). No code change needed there.
//
// max-v175 — Round FJ.1: tab label "Tracking" → "Tracking…" — the
// ellipsis reinforces the ongoing/in-progress quality, matching
// the temporal split the tab now organizes around (Coming up +
// Trip diary).
//
// max-v174 — Round FJ: restructure the destination "Tracker" tab
// around a temporal split (forward vs back in time, per Neal's
// framing). Tab renamed to "Tracking" since it's ongoing, not a
// static checklist. The old Booked / Want to see / Visited sub-
// tab nav is gone; everything is inline under two major headers:
//
//   COMING UP (forward-facing)
//     - To-dos: pending actions + cancellation deadlines
//     - Bookings: Hotels / Transport / Activities subsections
//     - Want to see: aspirational list with own add input
//
//   TRIP DIARY (history)
//     - Visited: what you did, with own add input
//     - Spend total (cumulative)
//
// Sub-tabs were a "view filter" pattern hiding unrelated content
// behind clicks; the temporal split makes everything visible at
// once. Hotels/Transport sections inside Bookings are still the
// management view (status + cancel/modify), which is distinct
// from the shopping view in Stay/Routing — they're not redundant.
// Per-list add inputs replace the shared "Add to current list"
// input that depended on the dest.trackerCat global; new
// _doTIInline helper takes the category explicitly.
//
// max-v173 — Round FI: relabel the "Story" button on each
// destination detail page for discoverability.
//   Old: "story: Zurich ↗"  — colon-prefixed key/value pattern that
//        didn't read as an action; ↗ implied "external link" but
//        the narrative actually opens inline.
//   New: "About Zurich →"   — verb-fronted phrase, → glyph
//        correctly signals "expand inline." Tooltip ("Max-voiced
//        narrative — character, history, travel-relevant context.")
//        previews what clicking will produce so a first-time user
//        doesn't have to guess. Done check (✓) syntax stays.
// Updated all 4 textContent sites: idle, asked-from-cache, asked-
// after-fetch, hide-and-keep-cache. Compare-tiles button alongside
// is on the chopping block long-term, so didn't try to align
// styling against it.
//
// max-v172 — Round FH: symmetrize action toasts. _showDayTripToast
// (Round FC) already dismissed any active reorder toast before
// showing, but _showReorderToast (Round H) didn't dismiss day-trip
// toasts — so a "Made X a day trip from Y" toast followed by a
// reorder would stack two toasts in the same slot. Added the
// inverse cross-dismiss. Both toasts now share the same
// .reorder-toast styling, the same 6s auto-dismiss + 450ms fade,
// the same Undo button — only the state slots stay independent so
// the right one gets cleared on Undo.
//
// max-v171 — Round FG: revert FF/FF.1. Surfacing the geo-reorder as
// a "Max chose this; want to undo?" decision was inventing a false
// alternative — the picker groups destinations by category, not by
// sequence, so the user never expressed an order preference to
// honor. The "picker order" the banner offered to restore wasn't a
// real thing. If the user doesn't like Max's sequence, the up/down
// arrows + drag-and-drop are right there. Removed: the trip-view
// banner IIFE; the trip.reorderNotice stash in buildFromCandidates
// (legacy notices auto-cleaned on next build); the preGeoReorderKeys
// snapshot + geoReorderApplied detection in orderKeptCandidates.
// Architecture.md updated with the lesson: not every build-time
// choice is a silent decision worth surfacing — only the ones with
// a competing user preference (like the buffer-night, where Max
// adds an extra destination the user didn't pick).
//
// max-v170 — Round FF.1: make the geographic-reorder decision a
// toggle, not a one-way switch. Original FF stored only
// preReorderKeys, so once you clicked "Restore picker order" the
// geo sequence was gone — no way back without rebuilding. Now the
// notice stores BOTH preReorderKeys (picker / pre-geo) and
// postReorderKeys (geo) plus currentMode. Banner content swaps
// based on currentMode: in geo mode it offers "Restore picker
// order"; in picker mode it offers "Re-apply geographic order."
// Either click toggles trip.destinations through bucket-shift on
// place name — same algorithm both directions, so round-trip
// cities and trailing buffer-night _exitStops are preserved.
// "Keep this order" / "Keep picker order" still dismisses.
//
// max-v169 — Round FF: surface the geographic-reorder decision —
// last remaining silent decision per architecture.md. Round CN/DO
// reorders kept candidates geographically before building (NN for
// linear trips, angular sort for round trips). User picked places,
// build silently sequenced them. Now: orderKeptCandidates
// snapshots normalized place keys before the geo-reorder pass and
// returns geoReorderApplied + preReorderKeys when the pass changed
// anything; build path stashes trip.reorderNotice; trip view shows
// a blue banner — "Reordered geographically. Max arranged the
// middle of your trip to flow geographically — fewer long
// backtracks. [Restore picker order] [Keep this order]." Restore
// reorders trip.destinations to follow preReorderKeys (bucket-
// shift by name so round-trip cities work; leftovers appended so
// nothing is dropped). Closes out the silent-decisions sweep —
// architecture.md updated.
//
// max-v168 — Round FE.2: dropping the buffer now also re-evaluates
// the over-budget notice. trip.destinations was correctly updated
// (28 → 27 nights, 15 → 14 destinations), but the orange over-
// budget banner had been stashed at build time with "29 days, 1
// over budget" and never re-checked. Symptom Neal hit: dropped the
// buffer, day count looked the same — because the stale over-
// budget banner was still showing the old picker total. Calling
// _reEvaluateOverBudget() before the redraw clears or updates the
// notice based on the new trip state.
//
// max-v167 — Round FE.1: propagate the _exitStop flag through
// _reconcileDestinations so the buffer-night banner from FE has
// something to detect. The buffer-night logic at line ~12547 sets
// _exitStop:true on the appended candidate, but the reconcile pass
// (line ~11982) was building the destination object from scratch
// and not copying the flag — so by the time FE's IIFE looked at
// trip.destinations, no destination had the flag and the banner
// never appeared. Symptom Neal hit: round-trip Zurich/Zurich, last
// dest was Zurich, no banner. Fix: both branches of reconcile
// (claim-existing and fresh-create) now set _exitStop = !!c._exitStop.
//
// max-v166 — Round FE: surface the buffer-night decision in the trip
// view. Round BL/BM added the "buffer night before flying home"
// feature with a Parameters toggle (default ON), but the build
// applied it silently — the user saw an unexplained extra
// destination at the end of their trip. Per architecture.md's "Max
// suggests, user decides" principle, the trip view now shows a
// blue informational banner when an _exitStop destination is
// present: "Buffer night in {city}. Max added one night here
// before your flight, so a late arrival from your last stop
// doesn't push you onto same-day flying. [Drop the buffer] [Keep
// it]." Drop the buffer: removes the destination, sets
// trip.brief.exitBuffer = false, recomputes dates. Keep it:
// dismisses the banner via trip.bufferNightNotice.dismissed (so
// it doesn't keep nagging on every visit). One of two remaining
// silent decisions called out in architecture.md; the other
// (geographic reorder) is queued.
//
// max-v165 — Round FD: destination detail tab cleanup.
//   * Reordered tabs so they match user mental flow:
//       OLD: Itinerary, Explore, Stay & Eat, On the ground, Routing, Tracker
//       NEW: Itinerary, Explore, Stay,        Routing,        On the ground, Tracker
//     Routing now sits before "On the ground" because Routing is
//     about getting to/from the destination (calendar-anchored)
//     while On the ground is about being there (presence-anchored).
//   * Restaurants moved from the "Stay & Eat" tab into "Explore"
//     (where sights live). Restaurants are discovery content —
//     same conceptual category as sights — and grouping them under
//     "Stay & Eat" forced a nested Stay/Eat sub-tab structure
//     (tabs inside tabs = bad). Now Explore has a Restaurants
//     section right after Sights.
//   * "Stay & Eat" → "Stay" (just hotels). The Stay/Eat sub-tab
//     scaffold is gone; the stay pane appends hotel content
//     directly.
//   * "Info" tab kept as-is. Audited and concluded it's NOT a
//     dumping ground — the three sections (currency/tipping/
//     emergency, execution-mode rideshare/transit, local
//     essentials like ATMs/banks) all coherently fit "stuff you
//     need on the ground."
//
// max-v164 — Round FC.1: two copy tweaks following user testing.
//   * Explore hint: "...its nights roll in here and its sights
//     appear below." → "...its nights will be added here and its
//     sights will appear below." More direct future tense.
//   * makeDayTrip toast: "Made {place} a day trip from {hub}" →
//     "{place} is now a day trip from {hub}" — matches the rhythm
//     of the inverse toast ("{place} is now its own destination").
//
// max-v163 — Round FC: hub/day-trip UX, items 5+6 of the audit.
//   * #5: dropped the JS confirm() on both makeDayTrip and
//     ungroupDayTrip. Both now do the work optimistically and
//     surface an undo toast (same .reorder-toast styling, separate
//     state slot). Toast button reverses the conversion via the
//     other function with {silent:true} so we don't loop. Chip /
//     dest references captured by closure so undo finds the right
//     thing even after subsequent reorders.
//   * #6: visible inverse on hover. Day-trip chips on the trip-
//     list card now use a .tm-day-trip-chip class with a hover-
//     revealed "↩ stay overnight" span. The forward verb shows in
//     the Explore "Make day trip →" button; the reverse verb shows
//     on chip hover. Both reads the same way.
//
// max-v162 — Round FB: hub/day-trip language pass. The conversion
// path between standalone destination and day-trip chip used three
// different verbs/labels for the same concept and one technical
// jargon term in the breakdown. Cleanup:
//
//   * Forward verb: "Make day trip" (already used — no change).
//   * Reverse verb: "Restore as own destination" → "Stay overnight
//     here" — semantic mirror of the forward verb (both describe
//     what kind of visit the place is). Code function name
//     ungroupDayTrip stays the same; only the user-facing label
//     changed.
//   * Trip-list chip tooltip: "click to ungroup" → "click to stay
//     overnight here" — same verb pair shows up in the affordance.
//   * Breakdown label: "(4 nights · 3 base + 1 day trip)" → "(4
//     nights · +1 from day trip)". "Base" was internal jargon the
//     user never picked. The "+N" framing makes the additive
//     mechanic explicit.
//   * Explore hint: "Nearby destinations on your trip. Make any one
//     a day trip from X — its nights roll into X and you'll see its
//     sights here too." → "Nearby destinations. Make any one a day
//     trip from X — its nights roll in here and its sights appear
//     below." Drops the bury-the-lede phrasing.
//
// max-v161 — Round FA.2: stale-toast grace window 2s → 5s. Two
// seconds was too brisk to read the message and register why the
// window was about to close.
//
// max-v160 — Round FA.1: fix popup-blank regression introduced in
// FA. The stale-toast message-handler block had `+ //` lines for
// inline JS comments inside the popup-html string concat:
//
//   + 'if (coords.length >= 2) map.fitBounds(...);'
//   + // Round FA: stale-data toast + auto-close. ...
//   + // toast for 2s, then closes itself. ...
//   + 'window.addEventListener("message", function(e){'
//
// JS parsed each leading `+` on a comment-only line as a *unary*
// plus operator on the next operand, turning the next string into
// NaN — the html ended with "...maxZoom: 10});NaN" instead of the
// real listener body, so the script threw a SyntaxError on parse
// and nothing rendered. Symptom: "open larger map does not open,
// just a blank screen." Fix: drop the inline comment lines (they
// were narrative, not load-bearing). Plain `// comment` lines
// *between* `+ '...'` lines are fine — only `+ //` lines that
// start with `+` followed by a comment break the chain.
//
// max-v159 — Round FA: hero-map polish.
//   * Pin legend below the small map. The merged-pin notation
//     ("1·9" for round-trip) was elegant once you knew it; now
//     there's a small caption when the trip actually has a multi-
//     visit pin: "Pin notation: 1·9 = same place visited as stop 1
//     and stop 9 · split blue/orange ring marks the round-trip
//     start + end" (the round-trip half only when applicable).
//     Single-leg trips stay legend-free.
//   * "View larger" popup now warns before closing. Previously the
//     popup vanished silently the instant trip data changed — the
//     user couldn't tell whether they'd hit something or whether
//     the app crashed. Now the opener postMessages {type:
//     "maxTripStale"} on detected drift; the popup shows a
//     centered "Trip changed — closing this window. Re-open for
//     fresh data." toast for 2 seconds and then closes itself.
//
// max-v158 — Round EZ.1: ✎ rename pencil now visible at rest (faint
// gray, opacity 0.45). Original EZ kept it hover-only to match the
// old "rename" text button's behavior, but with a smaller glyph the
// hover-only rule made it effectively invisible — Neal asked "where
// is the pencil icon." Always-visible hint solves discoverability;
// card-hover brightens it; button-hover turns it blue.
//
// max-v157 — Round EZ: trim destination-card controls. Each card had
// up/down arrows + rename + move (dialog) + drag — four reorder/edit
// affordances stacked on the same row. Drag-and-drop and the up/down
// arrows now both work reliably (after EX series), so the move
// dialog is the legacy third path. Dropped the "move" button from
// the card. Demoted "rename" from a 9px text label to a small ✎
// pencil icon — matches the ✎ convention used for booking and sight
// URL editing elsewhere in the app. The rename behavior is
// unchanged; click the pencil, edit inline, blur to save. The
// showMoveDestDialog function stays defined for any residual
// callers; it's just no longer surfaced from the card.
//
// max-v156 — Round EY.2: delete the cluster-notice renderer. Round EV
// disabled auto-clustering ("the user decides"), so the populator
// stopped writing trip.clusterNotice on any new trip. The big purple
// banner in the trip view was reachable only on legacy trips built
// before EV. Removing the renderer simplifies the header stack to
// max 3 panels (dates, map, over-budget action notice). Stale
// clusterNotice data on legacy trip objects is now inert — nothing
// reads it.
//
// max-v155 — Round EY.1: copy fix in over-budget notice — "The
// banner re-evaluates automatically" → "This banner re-evaluates
// automatically." (You're standing in front of it; "this" reads
// more naturally than "the.")
//
// max-v154 — Round EY: collapse the trip-view header stack. The top of
// the trip view had up to 6 stacked panels — dates strip, hero map,
// duration banner (over/under), cluster notice, over-budget action
// notice, and a same-budget date-strip fallback. The date range
// appeared in three places, the day count in two, and the over-
// budget condition fired both the duration banner and the action
// notice. Cleanup:
//   * Drop the duration banner entirely. Over case is fully handled
//     by the over-budget action notice (it has the same info plus
//     fix-it buttons). Under case is now an inline annotation on the
//     dates strip ("· 4 days under your 24-day budget").
//   * Drop the same-budget date-strip fallback. It existed because
//     the duration banner was once the visible home for the date
//     range; the dedicated dates strip at the top now covers every
//     budget state as the single source.
// Net: 6 possible panels → max 4 (dates, map, cluster notice, over-
// budget notice), typical 2 (dates + map). Step 1 of the trip-view
// header simplification; step 2 (collapse cluster notice into a
// chip) is queued.
//
// max-v153 — Round EX.4 (rev 3): same close-on-change behavior, but
// the _pushHeroMapUpdate call is now at the top of drawTripMode
// instead of inside the hero-map IIFE's rAF callback. The IIFE has
// early-returns (short trips, missing coords, Leaflet not loaded)
// that would skip the close. Lifting it out guarantees the popup
// gets evaluated for stale data on every drawTripMode pass,
// regardless of whether the small map ends up rendering.
//
// max-v152 — Round EX.4 (rev 2): close the larger map window when the
// trip data changes, instead of trying to update it in place. v151
// rebuilt the popup script with a re-callable render(pts) and a
// postMessage listener so reorders flowed through live; that refactor
// left the popup blank on open. Reverted the popup to the original
// baked-snapshot script and now: _pushHeroMapUpdate hashes
// (place|dateFrom|dateTo|nights) per destination on every drawTripMode
// run; if the hash changed since the popup was opened, it closes the
// popup. Re-opening pulls a fresh snapshot. Hash-based check avoids
// closing on no-op redraws (tab switches, focus events). This was the
// option Neal originally floated as the simpler alternative; the
// update-in-place attempt was the more ambitious path that didn't pan
// out.
//
// max-v150 — Round EX.3: auto-scroll the trip panel during drag. HTML5
// drag-and-drop has no native auto-scroll, so when the user dragged a
// destination toward a target that was off-screen, the list just sat
// there. Symptom Neal reported: "the problem is when you have to scroll
// out of the visible area in the list and the list has to scroll."
// Fix: a single document-level dragover listener watches the cursor
// against #lp-content's bounds. Within an 80px edge zone near top or
// bottom, an rAF loop scrolls the panel; speed scales with depth into
// the zone (gentle at the edge of the zone, fast right at the edge of
// the panel). Stops when the cursor leaves the zone or the drag ends.
//
// max-v149 — Round EX.2: after a reorder, scroll the moved card into
// view (smooth, mid-viewport). Up/down arrows used to bounce the user
// back to the top of the list because drawTripMode resets scroll for
// the dates strip. Now they land exactly where their card ended up.
//
// max-v148 — Round EX.1: drag-to-reorder earlier in the list silently
// failed. The mouse-half rule (drop-above when cursor in upper half,
// drop-below otherwise) put the cursor in the LOWER half of the card
// right above the source whenever the user dragged earlier — so the
// indicator showed "drop-below" → insertIdx = fromIdx → _executeReorder's
// same-spot guard returned. Symptom: "you can't drag a destination
// earlier in the trip list." Fix: pick drop side from drag DIRECTION.
// If the target card is above the source, drop above it; if below,
// drop below it. Matches user intent (dragged past these cards →
// lands on the far side) and removes the dead zone. Also added a
// dragenter handler that calls preventDefault, so Safari/Firefox
// reliably allow the drop (Chrome was lenient with dragover-only).
//
// max-v147 — Round EX: fix the destination-reorder no-op. Down-arrow
// was passing fromIdx+1 to executeMoveDest, which then applied a
// "toIdx > fromIdx ? toIdx-1 : toIdx" adjustment, producing fromIdx —
// i.e. splicing the element back into the slot it just left. The
// hero map (and everything else) re-rendered correctly, but the
// array hadn't changed, so the user saw nothing move. Same off-by-
// one broke drag-down (one slot too high) and the move dialog's
// "After X" branch (one slot too low). Fix: executeMoveDest now
// treats toIdx as the final desired array position; callers no
// longer need the adjustment. Dialog updated to pass plain `i`
// for both Before/After branches. Symptom Neal reported:
// "changing trip order does not update hero map on trip."
//
// max-v146 — Round EW.2: changing duration in Parameters now mirrors
// onto trip.brief.duration AND re-evaluates the over-budget notice.
// Symptom Neal hit: clicked Parameters, bumped duration manually,
// nothing on the trip view changed. Cause: applyConstraintChanges
// was mirroring entry/tbExit/transport/etc. but had skipped
// duration. New helper _reEvaluateOverBudget recomputes the banner
// from current trip.destinations + brief.duration so any path that
// changes either re-runs the math without going through a full
// buildFromCandidates rebuild. Same helper handles when/startDate/
// endDate/intent/pace/accommodation mirroring too — those were
// also missing.
//
// max-v145 — Round EW.1: over-budget banner options become real
// action buttons instead of bullet text. "Extend the trip → N days"
// updates trip.brief.duration to the picker total and re-renders.
// "Apply Max's proposed trim" mutates destinations to the proposal.
// "Keep my picks (over budget)" dismisses. The "do it yourself"
// hint stays as a pointer for the manual paths (Make day trip / ×
// Remove). Neal's catch: the previous banner had bullet text
// promising "bump duration in Parameters" but no actual button.
//
// max-v144 — Round EW: night-clamp converted from "auto-trim, then
// disclose" (Round CH + EQ) to "detect, propose, ask" — same
// "Max suggests, user decides" pattern as Round EV. Build doesn't
// silently mutate any destination's nights anymore. Instead, when
// picker total exceeds the budget, the trip view shows a banner
// listing four options: extend the trip, make a short stay a day
// trip, drop a destination, or accept Max's proposed trim. The
// proposed-trim option includes an "Apply Max's trim" button that
// mutates destinations to the proposal. The "Keep my picks (over
// budget)" button dismisses the banner and lets the trip stay
// over-budget — that's the user's prerogative. Picker → trip is
// now lossless: the user's nights are exactly what they picked
// unless they explicitly ask Max to change them.
//
// max-v143 — Round EV: day-trip clustering becomes a USER decision.
// Auto-clustering (Round CO) is fully disabled — the algorithm no
// longer reclassifies short stays as day trips. Instead, the
// destination's Explore tab now shows a "Could be a day trip from
// here" section listing nearby destinations on the trip (≤60km),
// each with a "Make day trip →" button. Click → makeDayTrip()
// removes that dest from trip.destinations, adds it as a chip on
// THIS dest's dayTrips, rolls its nights into this dest. When a
// destination has chips, Explore also shows a "Day trip · <place>"
// section with that place's sights (pulled from the LLM cache or
// triggered if missing) so the user can plan day-trip activities
// without leaving the hub. Reverse via "Restore as own
// destination" still works. Neal's design call: "I don't think it
// is a good idea that you decide on the day trips. That should be
// up to the user."
//
// max-v142 — Round EU: day-trip chips render as purple pins on the
// destination map. Each chip's lat/lng + place gets a purple
// teardrop marker matching the chip styling on the dest card.
// Tooltip shows "<place> · <distKm>km from <hub> · <Nn> day trip."
// Click opens the standard map-pin panel. ungroupDayTrip already
// removes chips from hub.dayTrips on Restore-as-own-destination, so
// pins automatically disappear from the map when a chip is
// converted back to a standalone destination.
//
// max-v141 — Round ET: ensureSuggestions always calls
// generateCityData when its dest's suggestions are empty, even if
// _generatedCityData[key] already has cached data. The previous
// gate skipped that call entirely, so EM's cache-hit branch (which
// is supposed to copy sights from the cache into this dest and run
// auto-seed for it) never fired. Symptom: round-trip arrival
// Zurich's Itinerary stayed empty after the departure Zurich was
// generated. Now opening any same-place dest triggers EM, populates
// the dest, seeds the days.
//
// max-v140 — Round ES: chip nights roll back into the hub (Round DA
// semantics restored). Neal's reasoning: a day trip to Schaffhausen
// from Zurich takes the same total time as overnighting in
// Schaffhausen — the traveler's still riding out, spending the day,
// riding back. The night belongs to the hub. Now Zurich (3 picker +
// 1 Schaffhausen chip) shows as 4 nights, with the destination card
// labeling it "(4 nights · 3 base + 1 day trip)" so the math is
// transparent. Trip total = picker total. EQ + ER banners disclose
// every clamp + cluster decision so nothing is hidden anymore. Both
// ungroup and the chip-cleanup pass restore the subtract-on-drop
// behavior so removing a chip gives nights back.
//
// max-v139 — Round ER: full-disclosure banner for day-trip clustering.
// _autoClusterDayTrips records each absorption (which short-stay
// place became a chip on which hub, source nights, distance) onto
// trip.clusterNotice. The trip view renders a dismissable banner:
// "Day-trip clustering reclassified 3 places. Short stays close to
// a longer-stay hub became day-trip chips: Schaffhausen → day trip
// from Zurich (1n, 48km away)... 4 nights from your picks didn't
// get a calendar slot — they're now day visits during the hub's
// stay. To undo, click a chip and choose Restore as own destination."
// Pairs with EQ's clamp banner — both surface invisible build
// decisions that previously only logged to console.
//
// max-v138 — Round EQ: surface the night-clamp decisions to the user
// instead of hiding them in console. Round CH's clampNightsToDuration
// silently trims the longest stays when picker total exceeds the
// duration budget — Neal's "Zurich went from 3 to 2 nights and I
// didn't change anything" symptom. Now buildFromCandidates records a
// per-destination delta in trip.clampNotice and the trip view shows
// a banner: "Trimmed to fit your 28-day budget. Your picks totaled
// 30 days, so Max shortened the longest stays: Zurich 3n → 2n,
// Bern 4n → 3n. Bump the dates in Parameters or drop a destination
// to recover." Dismissable.
//
// max-v137 — Round EP: rebalance items across new day grid by
// duration budget on shrink instead of clamping each old day onto
// the new day with the same index. Symptom: Neal's Zurich shrunk
// from 3 nights to 2 and all the sights ended up on the departure
// day. Cause: clamp-to-last logic dumped items from dropped day-3
// onto the new last day without redistributing. Fix: collect all
// preserved items into one pool, then place each onto the first new
// day with capacity (4h budget for arrival/departure days, 6h for
// middle, matching auto-seed's heuristic). Items spread across the
// shorter stay instead of piling up.
//
// max-v136 — Round EO: revert EJ. hub.nights stays at picker pick.
// Day-trip chips are visual only — no nights rolled into the hub
// (Round DA undone). Trade-off: trip total = sum of hub picks; chip
// places contribute 0 to the calendar. Picker total may be higher
// than calendar total when day-trip clustering absorbed places —
// the night-diff diagnostic flags this; it's expected. Same fix
// applied to ungroupDayTrip (no nights subtracted on restore) and
// the cleanup pass (no regen on chip drop). Neal's symptom: picker
// said Zurich=3, EJ showed Zurich=4 to keep total math, EO shows
// Zurich=3 directly.
//
// max-v135 — Round EN: preserve the LLM-supplied `category` field on
// _mdcItems through the trip.mdcItems snapshot and back out via
// reopenPickerForEdit. Symptom: Neal opened the picker for edit and
// only 3 of 6 category chips showed in the nav (Outdoors, Scenery,
// Culture). Cause: buildFromCandidates' mdcItems mapping copied a
// long list of fields but not `category`. On reopen, items had no
// category, _sectionCategory fell back to a name-pattern guess that
// missed sections in food/connect/wellness, and the nav skipped
// those chips. Now category survives the round-trip, plus a
// _categoryFromSection fallback for legacy data.
//
// max-v134 — Round EM: when generateCityData hits its cache guard
// for a place that's been seen before, populate the destRef from the
// cached data instead of just early-returning. Symptom: round-trip
// itineraries with two same-city destinations (arrival + departure
// Zurich) only populated whichever called generateCityData first.
// The second early-returned and stayed empty. Now both Zurichs get
// their suggestions copied from the cached data and auto-seed runs
// for each.
//
// max-v133 — Round EL: instrument _autoSeedIconicSightsToDays with
// console.log so we can see why a destination's Itinerary stays
// empty. Logs the entry conditions (suggestions count, days count,
// iconic count) plus the final placement count. Diagnostic-only,
// no behavior change.
//
// max-v132 — Round EK: _autoSeedIconicSightsToDays falls back to the
// first 4 suggestions when no sights have `iconic:true`. Some
// destinations (older cached LLM responses, or prompts where the
// model just didn't tag anything) leave Itinerary empty even when
// Explore is populated. Now the user lands on a starting plan they
// can trim, not a blank grid.
//
// max-v131 — Round EJ: revert EH. Bring back Round DA's "roll
// absorbed nights into hub" so trip total matches picker total.
// Symptom: Neal's picker said 29 days, trip showed 17 — losing 12
// nights from short-stay places that got chip-clustered. Without
// the roll-up those nights had no calendar slot. Trade-off: a hub
// with a 1-night day-trip chip displays as 4 nights (3 picker base
// + 1 chip). To make this transparent, the destination card now
// annotates the breakdown when chips are present.
//
// max-v130 — Round EI: idempotent _tripsIndex update on rebuild.
// Symptom: Neal had 2 trips on the home screen; deleting one wiped
// both. Cause: buildFromCandidates was unconditionally pushing a
// new index entry on every call — so a trip iterated 5 times got
// 5 duplicate index entries with the same tripId. The home-screen
// delete filters by `t.id !== id` and removes them all. If the
// duplicates somehow ended up sharing an id with another trip
// (rebuild race, _currentTripId carryover, etc.), deleting one
// would wipe the other too. Now buildFromCandidates updates the
// existing entry in place when present and ALSO dedupes any
// already-accumulated dupes — self-healing for affected indexes.
//
// Round EH (extended): also sweep auto-seed in restoreTripUI so an
// existing trip whose itinerary is empty self-heals on the next page
// load — no need to do a picker edit to trigger it.
//
// max-v129 — Round EH: hub.nights = user's picker pick, full stop.
// Day-trip chips are PURELY visual annotations and do NOT add
// calendar nights to the hub. Reverts Round DA's "roll absorbed
// nights into hub" semantics, which were inflating hub counts beyond
// what the user picked. Symptom this fixes: Neal picks Zurich for 3
// nights, the trip view shows Zurich at 4 because clustering rolled
// a Schaffhausen chip's 1 night onto the hub. Now picker says 3 →
// trip shows 3, regardless of how many chips. Trade-off: total trip
// nights = sum of hub picker picks; chip places contribute 0 to the
// calendar total. The night-diff diagnostic will warn when picker
// total ≠ calendar total — that's expected under EH and informational
// only. ungroupDayTrip no longer subtracts nights from the hub on
// "Restore as own destination" (since they were never added).
//
// max-v128 — Round EG: re-run iconic auto-seed across every
// destination after reconcile. Symptom: Neal opened Zurich, Explore
// was populated, Itinerary was empty. Cause: auto-seeding lives
// inside generateCityData's success callback. For destinations
// preserved by reconcile whose data is already cached,
// generateCityData early-returns at the cache guard and auto-seed
// never fires. Now buildFromCandidates always sweeps surviving
// destinations through _autoSeedIconicSightsToDays after reconcile;
// the function's existing-names guard makes it idempotent — already
// populated days don't get duplicates. Self-heals trips where the
// initial auto-seed was interrupted.
//
// max-v127 — Round EF.1: when reconcile encounters a kept candidate
// whose place is already a chip on a surviving hub, skip creating a
// fresh standalone destination for it. Without this guard, Lucerne
// (kept by user + previously a chip on Zurich) was getting promoted
// to its own destination AND the cleanup pass was dropping the chip
// from Zurich, splitting the trip and shrinking Zurich while the
// total skyrocketed. Now the chip continues to represent the place
// — its nights stay in Zurich's effective total, no fresh dest is
// pushed to newArr, and `cur` doesn't advance for the chip
// candidate (its nights are already accounted for in the hub).
//
// max-v126 — Round EF: clustering is now a one-time setup at first
// build, not a continuous re-evaluation on every rebuild. Symptom
// this fixes: Neal unchecked Appenzell + Emmental, and Lucerne
// (which had previously been its own destination) suddenly appeared
// as a day-trip chip on Zurich because the algorithm re-ran and
// re-decided the closest hub. Now reconcile preserves existing
// dayTrips, _autoClusterDayTrips early-returns on rebuild, hub
// nights add the preserved chip nights on top of the candidate
// base, and a chip-cleanup pass drops chips whose underlying place
// the user has unchecked (subtracting their nights from the hub).
// User can still ungroup chips via "Restore as own destination" or
// re-cluster places via the picker prediction at build time.
//
// max-v125 — Round EE: always-on rebuild diagnostic. After every
// trip rebuild, console.group "[Max rebuild]" prints a table of every
// destination with picker nights, candidate nights, dest nights,
// dates, and absorbed chips. Plus a kept-candidates table and the
// pickedNightsByPlace map. When something looks off (e.g. nights
// showing up at Zurich after unchecking other destinations), the
// trace pinpoints which layer is responsible — picker UI, candidate
// generation, reconcile, or clustering.
//
// max-v124 — Round ED: two trip-view + dest-view fixes.
// (1) Selecting a destination from the trip view now reliably zooms
// the map to that destination + its sights. updateMainMap clears
// the cached _maxDestId whenever the trip-view branch runs, so a
// trip → dest A → trip → dest A round trip refits each time. The
// hasRealCoords gate also now considers sights placed on
// dest.days[].items[] (not just dest.suggestions, which empties as
// the user assigns sights to days). (2) drawDestMode preserves
// scroll position on re-renders within the same dest (e.g. adding a
// sight from Explore, ungrouping a day trip) so the user doesn't
// get yanked back to the top mid-task. Fresh arrivals from trip
// view or another destination still reset to top.
//
// max-v123 — Round EC: unchecked picker entries no longer leak nights
// into the trip. The pickedNightsByPlace + placesUsedByActivity
// maps in runCandidateSearch were built from every place in
// _mdcItems regardless of _keep — so an unchecked instance of a
// place would still drive its max-nights value (a 3-night Zurich
// from one activity would override a kept 2-night Zurich from
// another), and unchecked places would count as "used by activity"
// for auto-keep. Now both maps filter by activity.checked and
// place._keep, matching the picker UI's own totals. Existing trips
// rebuild correctly on the next picker save.
//
// max-v122 — Round EB: trip name defaults to the destination, not
// "Untitled — May 1, 2026". Round DJ killed the explicit naming
// step, but the auto-fallback was a date string — useless for
// distinguishing trips on the home screen and obscure to anyone who
// stumbled on it. Now the default is the place the user typed on
// Step 1 (`_tb.placeName`, e.g. "Switzerland", "Iceland") with
// fallbacks to region, then first kept destination, then "New
// trip". Existing trips with Untitled-style names self-upgrade on
// the next rebuild; renames the user did via click-to-edit are
// preserved (only auto-pattern names get replaced).
//
// max-v121 — Round EA: idempotent day-trip clustering on rebuild.
// Symptom: after editing, Zurich went from 3 nights → 6 nights with
// dayTrips=[Schaffhausen, Schaffhausen, Lucerne]. Cause: clustering
// pre-existing chips from a prior build were preserved by reconcile,
// then clustering re-discovered absorbtions on rebuild and pushed
// duplicate chips + rolled the same source's nights into the hub a
// second (or third) time. Fix: dayTrips is derived state; reconcile
// now clears it on each existing dest and lets clustering rebuild
// from scratch. Reconcile already resets existing.nights to
// candidate.nights (the user's picker pick), so a clean re-roll
// produces the same result as build #1. Already-corrupted trips
// (multiple chips, inflated nights) self-heal on the next edit.
// Defense in depth: clustering also dedupes by place name when
// adding chips, so even if dayTrips re-acquires duplicates somehow,
// the second push is a no-op.
//
// max-v120 — Round DZ.1: self-heal corrupted trips. Trips already
// built under the Round DW bug have the SAME object reference at
// multiple positions in trip.destinations. The DZ fix correctly
// handled fresh round trips but didn't recover already-corrupted
// ones — both bucket entries pointed at the same ref so shift()
// handed it out twice. Now byKey dedupes by destination id while
// being built; the duplicate is dropped, the second iteration falls
// through to fresh-creation, and the corrupted trip self-heals on
// the next edit. Neal's screenshot showed the symptom: an "Arrival
// into Zürich" card with a "Dates overlap with: Zürich (same
// dates)" warning — two cards rendering the same JS object.
//
// max-v119 — Round DZ: fix Round DW reconcile collapsing round-trip
// entry+exit into one destination. The old byKey map stored one
// existing dest per place name — so when both the entry-Zurich and
// exit-Zurich iterations looked up Zurich they got the same object,
// stomped on each other's dates, and the SAME ref ended up at both
// ends of trip.destinations. The date-recompute pass then wrote
// repeatedly onto the shared object, producing the "Jul 24 — Jul 25,
// 25 days" banner mismatch Neal saw on Switzerland edits. Now byKey
// holds an ARRAY per place name and each ordered iteration shifts
// one off, so a round trip cleanly preserves two distinct calendar
// entries for the same city. "removed" detection now uses claim by
// id rather than name so dropping one of two same-city entries is
// recognized as removal.
const CACHE = 'max-v292.1';
const CORE = ['/', '/manifest.json', '/icon-192.svg', '/icon-512.svg', '/db.js', '/engine-trip.js', '/engine-picker.js', '/picker-ui.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first: try the network, update the cache on success, fall back
  // to cache only if the network is unavailable.
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
