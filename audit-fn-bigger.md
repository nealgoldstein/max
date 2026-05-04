# Bigger-pass audit — `mkItinItem`, `mkExploreSuggestion`, `toggleHotelForm`, `mkItinAddRow`

This is a deep-pass code review of four high-traffic surfaces that
hadn't been audited at byte level. Findings are categorized:

- 🔴 **bug** — likely to misbehave under reasonable input
- 🟡 **gap** — functionality the user would expect but doesn't have
- 🟠 **smell** — works today, fragile under future change
- 🔵 **polish** — small UX or code-clarity nit

Recommendations ordered within each function by severity.

---

## 1. `mkItinItem` (line ~21161)

The day-item renderer in the Itinerary tab. Renders sight, restaurant,
and day-trip items. Carries 9 affordances: priority dot, name, ext
URL link, ext URL edit pencil, story button, done toggle, move
button, book button, delete button, time row, plus the FN.7.5/8.15
day-trip extensions (transport line, Cancel day trip, sight-add chips).

### What's solid
- Type discriminator (`isRest` / `isDayTrip`) is clean.
- Each affordance is in its own IIFE for closure isolation — no
  cross-row leakage.
- The `srow.daytrip` class + purple rail correctly differentiates
  day-trip items.
- Time edit is a proper inline form with min/max constraints.

### Findings

🔴 **`fS(id, did)` bug if id collisions across destinations.** The
priority-dot toggle calls `fS(s.id, destId)` to find the sight, mutate
its `p` field. If two destinations have items with the same `s.id`
(theoretically possible if `sidCtr` was ever reset or two trips
merged), `fS` finds the first match — could mutate the wrong dest.
Low probability but worth defending.

🟡 **No drag/drop between days.** Drag handlers (`_wireDragHandlers`)
exist for the destination card row in trip view but `mkItinItem`
never wires them. Items can only move via the **move** button menu.
For a planner, dragging Saas-Fee from Day 3 to Day 5 should be a
gesture, not a menu walk.

🟡 **Story button doesn't say what it does.** The single word "story"
plus tiny ↗ is opaque. Hover tooltip would help; the FI relabel for
the destination-level Story button to "About {place}" hasn't carried
down to the per-item story.

🟡 **No "add note" affordance.** The `s.note` field shows below the
name (truncated at 120 chars), but there's no UI to set or edit it
once an item exists. Notes only land via the LLM's seeded data or
the manual-add row. User can't say "remember to bring sunscreen"
on a placed sight.

🟠 **Booking sub-strip render is duplicated logic.** `bkStrip`
construction at line ~21295 mirrors what `mkGeneralRecord` /
`mkHotelRecord` do for the same data shape (`s.booking`). Same
fields rendered with slightly different copy. Three places to
keep in sync if the booking schema grows.

🟠 **`toggleSightBookForm` is called from the Book button but lives
elsewhere.** Reading the row code, you can't easily tell what fields
the book form contains. Documentation would help; or co-location.

🔵 **Day-trip sight-chips dedupe by `it.n.toLowerCase()` only.** If
the day-trip city has two sights with the same display name (rare
but possible), the dedup falsely hides one as "already added."
Should dedup by `(name, place)` or by `id`.

🔵 **The `extEdit` pencil is 10px and the same color as `extLink`
(#1a5fa8 vs #999).** Tiny click target; users may miss the pencil
exists. Possibly fine; flag for testing.

### Recommended fixes (priority order)
1. Add tooltip to the story button: "Story about {item name}"
2. Defend `fS(id, did)`: tighten match to `it.id === id && parent
   dest.id === did` instead of just id.
3. Eventually: drag/drop. Bigger lift; not urgent.
4. Eventually: per-item notes editor.

---

## 2. `mkExploreSuggestion` (line ~20457 / dup at 21201)

The Explore tab's suggestion-row renderer. Both the sight section
and the restaurant section call this; renders icon + name + note +
story button + Add-to-day button + map pin click handler.

⚠ **Two different definitions exist** — line 20457 in the original
buildExplorePane and line 21201 as a duplicate. They look identical
but I haven't byte-diffed them. **Risk: if a fix is applied to one,
the other silently keeps the old behavior.** This is a real
maintenance hazard.

### What's solid
- The Add-to-day flow goes through `showAddToDay`, which is the
  shared day-picker (FM fix from earlier).
- Click-row-to-pan-map is a nice integration with the main map.
- The icon switch (🍽 / ●) is clear.

### Findings

🔴 **Duplicate definitions of the function.** Whichever appears later
in the file wins (JS function declarations are hoisted but later
ones overwrite). Need to dedupe — leave the one with the most
recent fixes (FM swap), delete the other.

🟡 **`row.onclick` requires `lat` and `lng` to do anything.** If
the LLM didn't supply coordinates (or the geo-fallback failed),
clicking the row is silently ignored. No "no map data" feedback.

🟡 **No `+ Add to day picker` for unassigned hub itinerary days
when the dest has 0 days populated yet.** `dest.days` may be empty
during loading. `showAddToDay` would render nothing — silent
failure (user clicks Add, picker shows but is empty).

🟠 **Map pan-to-pin uses `setView([lat,lng], 15)` regardless of
current zoom.** If user is zoomed out and clicks a pin, they're
suddenly in street-level zoom. Could be jarring; could clamp to
current zoom or use `flyTo`.

🔵 **Sight icon is an unstyled `●` while restaurant is `🍽`.**
Inconsistent visual weight — the bullet is generic, the emoji is
specific. Could either both be emoji (📍 for sights) or both be
shape-only.

### Recommended fixes
1. Dedupe the function declarations. **Action item.**
2. Tooltip / muted state on row when `lat`/`lng` missing.
3. Eventually: clamp zoom on pin pan.

---

## 3. `toggleHotelForm` (line ~16206)

The hotel booking form. Used from the Stay tab (per-hotel "Book"
button) and from the manual-add path ("Book any hotel"). Captures
13 fields.

### What's solid
- All fields auto-saved on Save; no half-state risk.
- mkCancelField properly returns deadline + time (FN fix).
- Hotel coords are looked up from `getDistricts` and stored on
  the booking — useful for map rendering downstream.
- Edit form (separate path inside `mkHotelRecord`) was added
  cancellation field in FN; date and URL in FN.

### Findings

🔴 **Save doesn't validate dates.** If user enters check-in `Jul 5`
and check-out `Jul 3`, the booking persists with backwards dates.
The Tracker render and pricing math will misbehave. Should reject
or warn.

🔴 **`opts.destId` not validated.** If `getDest(opts.destId)` returns
null (rare but possible after a × Remove of the dest while form is
open), `dest.hotelBookings.push(bk)` throws. Form was opened from
that dest, so by the time save runs, the dest could be gone.

🟡 **No price validation.** User can enter `-100` for total paid;
booking persists. Spend totals would go negative.

🟡 **No "save and book another" affordance.** Common pattern when
logging multiple hotels for a longer stay (e.g. one hotel for nights
1-3, a different one for 4-5). Currently form closes on save; user
has to click Book on the next hotel suggestion separately.

🟡 **No edit URL affordance until after save.** Reservation URL is
on the form, but if the user mistyped it, they'd find out only
after saving and going to the Tracker, then clicking Edit on the
record. Could validate URL-shape on input (it IS `type="url"`
which the browser validates on form submit, but there's no form
submit here — only an onclick).

🟠 **`hotelCoords` lookup walks ALL districts to find a hotel by
name.** O(districts × hotels) every time. Fine in practice (a
city has ~10 districts × ~5 hotels = 50), but if district data
ever grows (long lists for major cities), worth caching.

🟠 **The form is rendered inside `container` (the hotel row), so
its width and the date picker layout are constrained by the
container's width.** If the Stay tab is narrow (mobile, sidebar
trip view), the form fields can wrap awkwardly. The fix in FN.8.4
for the trip-view banner used `min-width:0` and grid auto-fit;
this form doesn't have that.

🔵 **Confirmation # field has no placeholder.** Other inputs do.
Inconsistent.

🔵 **Currency selector lists `["EUR","USD","CHF","GBP","CZK","HUF"]`
hardcoded.** Adding more currencies (JPY for Japan trips, NOK for
Norway) requires a code change.

### Recommended fixes
1. Validate dates: `if (newCheckOut <= newCheckIn) alert(...)`.
2. Defend against missing destId.
3. Validate price > 0.
4. Apply the FN.8.4 grid + min-width fix to the hotel form.
5. Eventually: extend currency list (LLM-suggest based on region?).

---

## 4. `mkItinAddRow` (line ~21879)

The manual-add row at the bottom of each day's slot. Two-button
layout: type toggle (sight/restaurant) + free-text input + Add.

### What's solid
- Type-toggle is a one-tap binary; no menu nesting.
- Default by slot (evening → restaurant) is sensible.
- Enter-to-submit is wired.

### Findings

🟡 **Manual sight-add doesn't get LLM enrichment.** When user types
"Marché Lausanne" and clicks Add, it lands as a plain item with no
description, no lat/lng, no story. Compared with auto-seeded
sights (which have all of the above), manually-added items feel
second-class. Could trigger a follow-up `callMax` to enrich.

🟡 **No autocomplete / suggestions while typing.** The user types
free-text — no matching against `dest.suggestions`. If user types
"matterhorn" and Matterhorn is already in suggestions, they'd
double-add it. Some basic match-and-suggest dropdown would prevent
duplicates.

🟡 **No URL field at all.** A user adding a manual sight ("the
specific bakery on the corner") has no place to paste the link
they found. They'd need to add the item, then click pencil (extEdit
in mkItinItem) to set URL. Two-step.

🟠 **Type toggle uses inline state via array `currentType[0]`.**
Works but it's a workaround for not capturing `let`-scoped state
in pre-ES6. The whole codebase uses `var` so this is consistent
but flag-worthy if a future modernization.

🔵 **Placeholder copy is generic.** "Sight or activity…" / "Restaurant
or evening activity…" — could be context-aware: "Sight at Lucerne…"
when this row is on a Lucerne day. Minor.

🔵 **The Add button starts disabled (.itin-add-btn) and enables on
2+ chars (.itin-add-btn.on).** Works, but clicking the disabled
button does nothing without feedback. Could add tooltip "Type
something first" or similar.

### Recommended fixes
1. Eventually: autocomplete against dest.suggestions to prevent
   duplicate adds.
2. Eventually: LLM-enrich manual adds in the background so
   description/lat/lng land async.
3. Polish: contextual placeholder.

---

## Cross-cutting observations

**Pattern: snapshot-then-mutate-then-toast undo.** Three places now
use this (FL.1 day-trip, FN.8.18 destination remove, FN.8.20 booking
deletes). Could be extracted into a helper `withUndo(snapshotFn,
mutateFn, msg, restoreFn)` for consistency. Not urgent.

**Pattern: dedup by lowercase name.** Multiple call sites
(`existingNamesOnDay`, `existingChipPlaces`, day-trip sight chip
dedup, manual-add suggestion exclusion). Each is a one-liner but
they could disagree on canonicalization (e.g. trim, NFKC normalize).
A shared `_canonName(s)` helper would prevent drift.

**Pattern: imperative inline render.** Almost all rendering is
`document.createElement(...).appendChild(...)` chains. Works fine
at this scale; if the app grows, a tiny render helper that takes
declarative trees would cut a lot of boilerplate. Not now.

---

## Priority ranking across all four

If prioritizing fixes from this audit by impact × effort:

1. **`mkExploreSuggestion` duplicate definitions.** Real maintenance
   risk. Dedupe.
2. **`toggleHotelForm` date validation.** Real bug — backwards
   dates can persist.
3. **`toggleHotelForm` defend against missing destId.** Edge case
   but easy to add.
4. **`mkItinItem` story button tooltip.** 1-line UX polish.
5. **`toggleHotelForm` price validation.** 1-line.
6. **`mkExploreSuggestion` muted state when no coords.** Small UX.
7. Everything else: polish or larger features.

The first three are the bugs. The rest is the kind of thing that
emerges from real dogfooding — Iceland trip would surface these
faster than another synthetic test pass.
