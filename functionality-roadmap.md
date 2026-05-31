# Functionality roadmap

> Captured at v353.1, May 7 2026. Living document — update as features land
> or new gaps appear.
>
> **Reconciled May 31 2026 at v360.4.** Items 2, 3, 4, 5, and 8 ship.
> "What Max already has" updated. Genuinely open: 1, 6, 7, 9, 10, 11,
> 12, 13. See per-item annotations below.

## What Max already has

- Trip planning: picker, candidate explorer, brief→trip handoff
- Per-destination drill-in with tabs: Itinerary / Explore / Stay /
  Routing / On the ground / Tracking
- Itinerary items (sights, restaurants, day trips) with done / move /
  book / ✕→Later / time / external-link / story
- Bookings with cancel-policy tracking and pending-cancellations
  surfacing
- Traveler notes per destination
- Day-trip system with peer-day-trip support
- Pre-arrival banner, Today banner, Decisions-deferred panel
- LLM-proxy for AI suggestions, stories, AI-generated content
- Magic-link auth, cross-device sync, offline-read via service worker
- Map (Leaflet) with route + destination pins, "View larger map" popup
- File-based save/load, drag-drop reorder (now on touch via polyfill)
- Trip export: printable PDF (`window.print` at index.html:12349) and
  iCalendar `.ics` download (v353.6) with a server-side subscription
  URL (`share/:token/calendar.ics`, `server/src/lib/ics.ts`)
- Trip duplication via "Copy this trip" menu (`duplicateTrip` at
  index.html:8578)
- Discovery picker rebuild (post-v353): by-Activity / by-Place view
  toggle, geography model (sight-in-destination, parentDestination),
  six-role popup (Stay / See / Day trip from X / On the way from X /
  Maybe / Reject), Story + Things-to-do modals

## Functionality gaps that matter on the trip

Ordered by ROI for the on-the-ground use case.

### High-priority gaps

1. **Offline map tiles.** SW caches the app shell, but Leaflet tile
   fetches go to the CDN. With no signal, the map renders blank. A
   pre-cache of tiles at the destination's bounding box (zoom levels
   ~12–17) makes the map actually offline-usable. **Hardest of the
   gaps but the single biggest "phone-actually-works-offline"
   upgrade.** A few hundred lines, plus thinking about cache size
   and per-destination scoping.

2. **Open this place in maps.** Tap a sight → directions in Apple
   Maps / Google Maps. Currently tapping a name highlights the pin
   on Max's own map; there's no handoff to the user's preferred maps
   app for actual walking directions. Trivial — `<a href="...">` per
   item, ~30 lines. **[v353.2 done]**

3. **Calendar export of bookings.** Bookings live on
   `trip.brief.entryDetails`, `dest.stay.booking`, `s.booking`. No
   path to the user's iOS/Google calendar. ICS export would let
   bookings appear alongside everything else they have scheduled.
   ~150 lines plus a download/share UI. **[v353.6 done — download
   at index.html:11795, server subscription URL at
   server/src/lib/ics.ts]**

4. **Search across the trip.** "Where did I plan that pastry place?"
   After 30 sights across 5 destinations, finding one means
   scrolling. A simple input that filters/highlights across
   destinations + days + items + notes. ~50 lines. **[v353.2 done]**

5. **Voice input for notes.** Web Speech API. Tap mic, speak, text
   appears in the textarea. Trivial — ~30 lines, big real-world
   impact for in-the-moment capture. **[v353.2 done]**

6. **Photo attachment per item or note.** Most-asked travel-app
   feature. Even just storing photos in IndexedDB locally (no
   server upload) unlocks a real "trip memory" use case. Bigger
   lift but high traveler value. Requires: photo capture/upload
   UI, IndexedDB storage layer, photo-thumbnail rendering in the
   item rows.

7. **Translation helper.** LLM proxy is already there. "How do I
   say 'where's the bathroom' in Portuguese" is one LLM call. Could
   be an always-present "Ask Max" button in dest-mode that doesn't
   require typing in the per-day text box. ~20 lines if proxy is
   already exposed.

### Medium-priority gaps

8. **Trip duplication.** "Copy this trip and modify dates." Useful
   for recurring travelers. **[done — `duplicateTrip` at
   index.html:8578, "Copy this trip" menu item]**

9. **Time-zone handling on flight times.** A 9pm Lisbon-to-Paris
   flight is currently just "9pm" — origin or destination time?
   Subtle but real for traveler clarity. Requires: TZ data per
   airport / city, a TZ display convention in the UI.

10. **Weather forecast per destination per day.** Useful for
    packing and day-of decisions. Free APIs exist; needs a small
    fetch+cache layer.

11. **Packing list.** Many travel apps have this. Simple but adds
    another section to maintain.

12. **Trip history / "places I've been".** Retrospective view
    across all past trips. Sentimental but real.

13. **Per-day budget tracking / spending.** "Halfway through the
    trip and 60% of budget spent." Requires logging spending
    (its own feature).

### Defensibly NOT in scope

- **Group / shared trips.** Single-user is fine. Multi-user is a
  10x complexity jump (permissions, real-time conflict resolution,
  invitation flows). Don't do this unless it's the core product
  pivot.
- **Direct Booking.com / Expedia integration.** Manual entry is
  the right move for a personal trip-planning app. Real
  integrations are vendor lock-ins.
- **Receipt OCR.** Heavy feature, doubtful traveler ROI.
- **Real-time flight-delay notifications.** Real value but
  requires push infrastructure that's a whole new architecture
  chunk.

## Recommendations

The original four cheapest-to-build / highest-impact items have
all shipped (1 open-in-maps, 2 voice, 3 search at v353.2; 4 ICS
at v353.6). Updated recommendation as of May 31 2026:

**Top picks among what's still open:**

1. **Translation helper** (#7) — ~20 lines using the existing
   LLM proxy. Trivial cost, real on-trip value.
2. **Time-zone handling on flight times** (#9) — Subtle but real.
   No code today; would need a TZ data source per airport/city
   and a display convention.
3. **Weather forecast per destination per day** (#10) — Free APIs
   exist; small fetch+cache layer. Good "feels like a real travel
   app" addition.
4. **Photo attachment per item or note** (#6) — Bigger lift but
   the most-asked travel-app feature. IndexedDB scaffolding already
   exists (cache layer uses it at index.html:2633+); the photo
   store can ride on top.

**One big "this is a real travel app" feature: offline map tiles**
(#1). Still the answer. Hardest of the bunch but turns Max from
"useful when I have signal" to "useful in a foreign city basement
with no signal."

## Notes on prioritization

- Don't try to do everything. Ship 2-3 small features, then live
  with them on a real trip before deciding what's next.
- High-priority items aren't ordered by user value alone — they're
  ordered by *value × ease of build*. Offline map tiles is the
  highest-value gap but the hardest; it's listed first because
  it's the single feature that fundamentally changes what Max can
  do.
- Calendar export is uniquely valuable because it bridges Max with
  the rest of the user's tooling (iOS Calendar, Google Calendar).
  Most travel apps don't do this; the ones that do feel
  immediately more grown-up.
