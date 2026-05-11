# Picker hero map: redesign plan

The picker becomes a map-led surface. The Leaflet map that already sits
to the right of the candidate cards is promoted to the primary canvas,
and the cards collapse into an ordered sidebar list that mirrors the
map's state. Sequence is a first-class picker concern — destinations
are numbered, connected by a route polyline, and reorderable — so the
trip's spatial and temporal shape is visible at the moment the user
is reacting to Max's suggestions, not as a downstream consequence of
clicking Build.

The design reference is Minard's map of Napoleon's invasion of Russia:
one artifact that compresses space and time into a single readable
image, where the *encoding does the argument*. The substitution Max
makes is ordinal sequence in place of dates — at picker stage the
trip doesn't have dates committed, but it does have order, and order
is more stable across edits than dates would be. Drag a stop, the
route rearranges; the map's language survives the edit.

The journey-as-first-class work — dotted-vs-solid edges, the
origin/route/arrival decomposition for journey-class segments like
the Glacier Express, per-edge transport mode pickers — is parked for
a follow-up. v1 edges are uniform solid lines; v1 dots vary by
acceptance state.

---

## Three-state candidate model

The LLM, at candidate-generation time, returns each candidate with an
explicit `accepted` boolean. Pre-accepted means the LLM considers it
a core stop for this brief; unchecked means it's an alternative
worth surfacing but not core. The user has three actions on any
candidate: leave it alone, flip its check state, or reject it
outright. Rejection is reversible — un-reject lands the candidate
back in the unchecked state, not auto-accepted.

Required candidates (must-do anchors propagating `_required:true`)
are force-accepted: their checkbox doesn't toggle, and rejection
requires un-rooting the underlying must-do first. This preserves the
existing must-do invariant.

**Accepted (✓)** renders as a green numbered dot, sits in the route,
and becomes a destination at "Create a plan" time. **Unchecked**
renders as a distinct third-color numbered dot, also sits in the
route, but at publish time persists on the trip as a "considered,
not added" candidate rather than becoming a destination. **Rejected**
renders gray, is excluded from the route, and is dropped from the
destination list at publish — though the rejection itself is
persisted so a reopen of the picker still shows the user's decision
history.

The unchecked state is the philosophical hinge. The user is *reacting
to a proposed itinerary, not opting into it stop-by-stop*. Anything
they don't endorse falls into "considered" and surfaces in the trip
view as a follow-up list. The result: Max's contribution stays
visible and accessible after the user has committed to a shape, and
the user can come back days later to incorporate a stop they were
on the fence about.

---

## LLM prompt change

The candidate-generation prompt at `index.html:12266` (and the
matching initial-build prompt) gets one new field:

```
{
  "place": "City",
  "country": "Country",
  ...existing fields...
  "accepted": true,           // NEW — LLM's call: core stop?
  "widelyRecommended": false  // existing — separate signal
}
```

Prompt instruction added:

> Mark `accepted: true` for places a reasonable traveler with this
> brief would almost certainly include — the trip's core. Mark
> `accepted: false` for alternatives worth surfacing but that the
> traveler might reasonably skip. Aim for roughly 60–70% accepted on
> average; vary by trip ambition.

Backward compat: if `accepted` is missing on an in-flight draft,
default to `true` (treats legacy candidates as the LLM's confident
picks, which is what they effectively were under the old single-state
model).

---

## Visual encoding

The encoding hierarchy reads at a glance:

- **Accepted**: green fill, ordinal number, full-weight white border.
  Drives the visual.
- **Unchecked**: a third color (current `#1a5fa8` blue is a reasonable
  starting point; tune for contrast with green and gray once the
  layout is up), ordinal number, slightly lighter border so the
  hierarchy still reads.
- **Rejected**: gray, no number, not in the route.
- **Entry points** (airports, rail, sea, bus): unchanged — small
  icons placed by `_renderEntryPointsOnCeMap`. Their role expands
  when the journey-as-first-class work lands; for now they remain
  informational background.

The route polyline is one consistent solid line connecting accepted +
unchecked dots in `order` ascending. Line color is a desaturated
green so the dots dominate visually. No mode-specific edge styling
in v1.

---

## Sidebar list (replaces candidate cards)

The `.ce-left` panel becomes an ordered list of accepted + unchecked
candidates in sequence order. Each row:

- Drag handle (using the existing `vendor/mobile-drag-drop`)
- Ordinal badge matching the map's dot number
- Place name + country
- Checkbox (✓ = accepted, unchecked = unchecked); toggling
  re-styles the dot but doesn't move the row
- ✕ → rejected; the row moves to a collapsed "Set aside" section
  at the bottom of the sidebar
- Tap or hover reveals the candidate's `whyItFits` and `tradeoffs`
  in a small popover — replaces the old in-card expansion

A search input at the top of the sidebar lets the user add a
destination not in Max's list: type "Geneva", hit enter, Nominatim
geocodes, an entry appears in the sidebar at its smart-inserted
position with "(generating rationale…)" as a placeholder, an LLM
call fills `whyItFits` and `tags` shortly after. User-added stops
default to accepted ✓ (the user already showed intent by typing
the name).

Cards disappear entirely. Comparison and "compare tiles" affordances
move post-build (they exist in the destination view already).

---

## Smart-insert ordering

On every status change — accept ↔ unchecked, accept/unchecked →
reject, reject → unchecked, sidebar add — `orderKeptCandidates`
(`engine-picker.js:686`) runs against
`candidates.filter(c => c.status !== "reject")`. The result populates
`candidate.order` for every non-rejected candidate; rejected stays
`order: null`.

Manual reordering via drag commits a user-pinned order on the
affected range and sets `manuallyOrdered: true` on dragged items so
subsequent recomputes don't move them. A small "Reset to suggested
order" link in the sidebar header undoes the pins.

---

## Build steps (in dependency order)

1. **Live ordering.** Wire `orderKeptCandidates` into the picker
   UI's status-toggle path. Add `order` and `manuallyOrdered` fields
   on candidates. No visible change yet — state plumbing first.

2. **Numbered dots + route polyline.** Render `order` on the
   `divIcon` (replace place-initials with ordinal for non-rejected
   dots); draw `L.polyline` between them in order. Re-render on
   every change with a 300-400ms animation so the user sees the
   recompute.

3. **Three-color encoding.** Update the candidate-marker color
   logic at `index.html:12343`: accepted → green, unchecked → blue
   (or tuned third color), rejected → gray. Verify contrast against
   the Esri satellite tiles.

4. **Sidebar list.** New render function replacing
   `renderCandidateCards`. Drag-reorder via `vendor/mobile-drag-drop`.
   Checkbox and ✕ actions wired to status changes. Rationale popovers.

5. **Add-by-name search.** Sidebar input + Nominatim geocode (re-use
   the pattern in `geocodeMissingCoords` at `index.html:13011`) +
   small LLM rationale call (~200 tokens) + state insert + trigger
   smart-reorder.

6. **LLM prompt update.** Add `accepted` field and instruction at
   `index.html:12266` and the matching initial-build prompt. Update
   the parse + hydration paths to default missing `accepted` to true.

7. **publishTrip changes.** `engine-picker.js:1271` — accepted
   candidates become destinations as today. Unchecked candidates
   persist on the trip via the existing `trip.candidates` array
   (already rehydrated by `reopenCandidateExplorer` at
   `index.html:12386`). Rejected dropped from destinations but
   persisted in `trip.candidates` so re-opens still show history.

8. **Trip-view "candidates considered" surface.** A button in the
   trip header opens a panel listing unchecked candidates from the
   picker; each has a one-click "Add to trip" that promotes the
   candidate to a destination at a geographically-sensible position
   (re-use `orderKeptCandidates`). Without this, the carry-forward
   promise is silently broken. Minimum viable rendering is fine.

9. **Comment cleanup.** Replace the comment at `index.html:12236`
   ("ordering places before entry is known just hallucinates") with
   the new model: order *is* the entry/exit story, and the first/
   last accepted-or-unchecked dot in sequence implicitly defines
   them.

---

## Risks

**Smart-insert jumpiness.** Recomputing order on every toggle moves
dots around. Mitigation: animate the polyline and ordinal
renumbering. If it still feels jumpy after step 2, debounce
recompute to 250ms after the last status change.

**Drag vs. smart-insert conflict.** A user-pinned drag must suppress
smart-insert on that item. The `manuallyOrdered` flag handles this
provided the order-runner respects it. Test coverage needed.

**Trip overload from default-accept.** If the LLM marks 70% of an
8-candidate batch as accepted and the user accepts them reflexively,
the built trip can overflow the pace budget for shorter durations.
The trip-engine's pace-aware logic should already catch this and
surface a warning rather than silently building an over-dense
itinerary — verify before shipping.

**Reopened picker hydration.** `reopenCandidateExplorer` needs to
read the new `accepted` field plus the three-state `status` from
`trip.candidates`. Add to the hydration loop and write a regression
test using one of the iceland fixture trips.

**Drag-reorder library.** Verify `vendor/mobile-drag-drop` is
already wired up in the trip view (for day-card reorder) so the
picker can re-use the helper without a fresh integration. If not,
budget a small adapter.

---

## Out of scope (deferred)

- Journey-class edges (dotted vs. solid, origin/route/arrival
  decomposition).
- Per-edge transport mode picker (Glacier Express vs. drive vs. fly).
- Click-to-add on the map (vs. search-to-add).
- Nights allocation rendered on dots (stays in trip view).
- Inline rendering of unchecked candidates within the destination
  stack — a richer "considered" experience than a separate panel.
- Renaming `widelyRecommended` to something less ambiguous.
- Mobile picker (architecturally desktop-only; unchanged).
