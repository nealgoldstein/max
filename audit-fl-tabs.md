# Per-tab content audit (Itinerary, Stay, Explore)

Continuation of the FK detail-page review. The Tracking… tab got a deep
restructure in FJ; this doc covers the three tabs with content that
hadn't been audited at the same level.

Status of each tab as of `max-v177`:

- **Itinerary** — day-by-day calendar. Audited below.
- **Explore** — sights / restaurants / day-trips. Cleaned in FD.
- **Stay** — hotels (post-FD, restaurants moved to Explore).
- Routing — confirmed structurally minimal but not redundant (per Neal).
- On the ground — section headers added in FK.
- Tracking… — restructured in FJ, label finalized in FJ.1.

---

## Itinerary tab

### Structure

For each day in `dest.days`:

1. **Day header** — label (e.g. "Mon, Aug 18") + optional note ("arrival").
2. **Auto-injected chips on day 1:**
   - Arrival transport (if previous destination exists) via `buildTransportChip`
   - First-destination arrival (if `entryDetails` set) — flight/train info chip
   - Hotel check-in chip (if hotel booked)
3. **Auto-injected chips on last day:**
   - Hotel check-out chip
   - Departure transport (to next destination) — *unless* this is a 1-night
     intermediate stop, where departure inherits to the next destination's
     arrival chip
4. **Day slot** — header "Day" + general bookings (tours/tickets/restaurants
   for this date) + sight items + add-row
5. **Evening slot** — header "Evening" + evening-slot items + add-row +
   "🍽 Suggest restaurants" button
6. **Synthetic flight-home day** (last destination only, post-CK.3) — its
   own card after the day loop

### Things that look fine

- Chip rendering is mode-aware (`_modeLabels` swaps verbs for fly/train/drive/bus/boat)
- Auto-skip departure on 1-night intermediate stops is the right call (avoids visual duplication)
- Day-by-day structure is the primary surface; this is the user's main
  working view during planning
- Items use `mkItinItem` which is a separate helper — would need its own
  audit pass for drag/drop, story popover, etc.
- Map updates fire on tab switches (`updateMainMap`)
- Story cache (`_sightStories`) preserves stories across re-renders

### Things to verify in functional testing

1. **Drag-and-drop within days** — sights can be reordered within a slot,
   moved between Day/Evening slots, moved between days. Haven't verified
   the drag handlers work cleanly — would need to:
   - Drag a sight from Day to Evening on the same day → expected: slot field
     updates, item moves
   - Drag a sight from Day 1 to Day 3 → expected: parent day changes
   - Drag a sight from one slot to "Later" or "Maybe" buckets at the bottom
     of the Itinerary

2. **"Suggest restaurants" button** — behavior on first click (no cached
   suggestions), repeat clicks, error states (LLM unavailable).

3. **Booked general bookings** appear as chips on the matching day — needs
   verification that the date-matching logic (`b.date===dayStr`) handles
   timezone edge cases.

4. **Hotel chip behavior** — check-in chip on day 1, check-out on last day.
   What happens if hotelBookings has multiple booked hotels (e.g., user
   logged a placeholder then a real one)?

5. **Flight-home day on last destination** — the post-CK.3 synthetic day
   card. Verify it shows correctly with `exitDetails` data.

### Potential issues

1. **Item drag between destinations** — the existing drag handlers I saw
   earlier are scoped to within a destination. Cross-destination drag
   (move a Zermatt sight to a Lucerne day) is not supported. May or may
   not be intentional.

2. **Add-row affordance** (`mkItinAddRow`) at the bottom of each slot — I
   haven't read this code, but it's likely an inline input + Ask Max
   that takes free-text input and either adds as a manual item or
   triggers a search. Should verify it doesn't conflict with the
   per-tab Ask Max input on Tracking….

3. **Day items have a story popover** (`_sightStories[s.id]` rendering
   `mkCachedStoryBox`) — same patterns as the destination's About button
   (FI relabel). Might need similar treatment if user testing surfaces
   discoverability issues.

---

## Stay tab (post-FD)

### Structure

After FD, the tab renders **hotels only** (no sub-tabs, no restaurants):

1. Booked hotel summary banner at top (if any hotels booked)
2. District list (`getDistricts(dest.place, dest.intent, dest)`):
   - Each district: name + good/bad attributes
   - Per district: hotel rows with name/desc/price + "Book" button
   - Booked hotels styled with reduced opacity (visual "already booked")
3. Manual booking option at bottom: "Book any hotel" button

### Things that look fine

- The district-grouped layout is informative — gives the user neighborhood
  context, not just a flat list
- Booked hotel records are surfaced both in the booked banner AND inline
  within the district where they appear
- Cancelled bookings render under the hotel they were for
- Manual booking covers hotels not in the district list

### Things to verify

1. **`toggleHotelForm`** — opens an inline booking form. Verify all fields
   (check-in/check-out, confirmation, price, currency) save correctly and
   round-trip through reload.

2. **Booking → Tracking flow** — after booking a hotel here, does it
   appear in the Tracking… tab's "Bookings → Hotels" subsection? Should be
   the same data.

3. **What if `getDistricts` returns empty?** — there's a fallback message
   "Hotel suggestions loading… You can log a booking manually." Verify
   the manual booking path works without the district list.

4. **Cancel a hotel booking** — what's the unwind flow? Does the booking
   move to a "cancelled" state, generate a pending action, or get deleted?
   The code shows cancelled records render under the hotel — so
   cancellation is preserved as history. Verify behavior.

### Potential issues

1. **Hotel form complexity** — multiple currency inputs, dates that need
   to align with the destination's stay window. Easy place for a stale
   form-id bug after destination edits.

2. **District quality varies** — `getDistricts` is largely hardcoded data.
   For lesser-known destinations, the list might be sparse or missing.
   The fallback ("Hotel suggestions loading…") suggests an LLM call but
   the actual flow isn't clear.

---

## Explore tab (post-FD)

### Structure (from `buildExplorePane`, line ~19997)

1. **Sights section** — `dest.suggestions` filtered to type="sight"
   - Header with Refresh button
   - "Already on your days" list (auto-seeded sights, post-DB)
   - Optional sights below
   - Empty state with retry/generate button
2. **Restaurants section** (post-FD) — `dest.restaurantSuggestions`
3. **"Could be a day trip from here"** — within-60km destinations the user
   could convert to chips
4. **Day-trip chip sights** — for each chip on this hub, the chip's
   sights inline so user can plan from one place

### Things that look fine

- Section ordering matches user mental flow: what is here → what to eat →
  what to make a day trip → details on day trips
- Refresh button is contextual ("generating…" disabled state)
- Auto-seeded iconic sights surfaced separately from optional extras
- Retry button on empty/failed states is a safety net
- Round FB tightened the day-trip hint copy

### Things to verify

1. **"+ more like this" affordance** (Round CA) — per-section button to
   ask Max for more suggestions. Verify it appends rather than replaces,
   and that the loading state is visible.

2. **Restaurant suggestions** post-FD — does the same `mkExploreSuggestion`
   render that's used for sights? Should be — the Eat sub-tab used it.

3. **Adding a sight to a day** — clicking a sight should add it to
   `dest.days[N].items` for the user's chosen day. Verify the affordance
   is discoverable and the placement is sensible.

4. **Make day trip → flow** — Round FC made this an undo-toast pattern.
   Verify it works after FB/FC rounds; tested manually back then but worth
   re-checking after FD reorganized restaurants.

### Potential issues

1. **`mkExploreSuggestion`** wasn't audited at byte level — it's the
   shared item renderer. Drag-to-day, day-picker affordance, sight URL
   editor (Round DG) all live here.

2. **Day-trip chip sights** are rendered inline below the "Could be a
   day trip from here" section — visually busy when there are 3+ chips
   each with their own sights.

---

## Cross-tab observations

- **Restaurants moved from Stay to Explore** in FD — verify nothing on
  the home dashboard or other surfaces still expects them in Stay.
- **`updateMainMap()` fires on tab switch** for sights/tracker/stay/explore
  but NOT for routing/info. Probably correct — routing doesn't need pin
  refresh and info has the practical-essentials embedded clicks. Worth
  noting.
- **Stay tab** has `setTimeout` to scrollIntoView the booking-log button
  on activation. That's a nice touch but might surprise users who land
  on the tab and have it auto-scroll.

---

## Recommended next-pass priorities

After Neal's manual test of items 1+2+3 reveals what's broken on the
destination card itself, the next-tier audit should target:

1. **`mkItinItem`** — the day-item renderer with drag/drop, story popover,
   sight URL editor. Most-used surface during planning.
2. **`mkExploreSuggestion`** — the Explore-tab item renderer (sights,
   restaurants). Add-to-day, drag, URL editor.
3. **Hotel booking form** (`toggleHotelForm`) — has the most fields and
   potential for stale-state bugs.
4. **Transport booking form** in the Routing tab.
5. **Manual sight add** flow (`mkItinAddRow`) and Ask-Max bottom input.

These are the layers below the trip-view chrome that haven't been touched
in this sweep.
