# Trip view redesign — a one-pager to argue with

## The diagnosis

The current trip view leads with **capability**, not with **narrative**. A user opening any trip sees this stack before they reach a single destination card:

1. Top nav (Home / File / Edit / Settings)
2. Trip name + pencil
3. Arrival / Departure form
4. Trip Bookings card (always rendered, even when empty)
5. Add Waysides banner
6. Destinations heading
7. Three top-row buttons: **Tidy trip** · **Keep in mind for your trip** · **+ Destination**
8. Stats line (24 days · 23 nights · 16 destinations)
9. Three more buttons: **Reverse order** · **Considered (5)** · **Open Discovery**
10. Trip preferences box (stay, avoid)
11. ARRIVAL header

Roughly fifteen controls before the trip's body. None of them indicate which is "what to do next." A first-time user freezes. A veteran has memorized the two or three buttons they use and tunes the rest out — but that's a cost paid by every user, every session.

The fix isn't "fewer features." It's the opposite: **make the data the interface**, and put the controls *inside* the things they operate on.

---

## Core principle — late binding

The fundamental observation: **the world contains more information than you can process beforehand.** No amount of pre-departure optimization substitutes for contact with reality. So instead of treating a trip as something you fully define in advance, Max treats it as something you *progressively shape*, leaving room for the world to surprise you. Commitment happens when reality justifies it — or when the universe requires it (deadlines, flights, scarcity).

**Max is for the wisp, not the blank slate.** Trips don't start in Max with "where should I go?" — they start somewhere outside the app, in a book, a conversation, a memory, a song. The user arrives at Max already pointing at a region. Max's job begins from that wisp.

### Three activities, not one

Two cognitively distinct activities live inside what is today one "trip view," with a recursive coupling between them:

- **Spark** — introducing a wisp. The first wisp is what brings the user to Max ("Iceland in October"). Subsequent sparks fire continuously: during shaping ("the West Fjords too?"), during travel ("the guy at breakfast said…"), even after a trip ("that vineyard region I never made it to"). Each spark is a possibility-in-waiting.
- **Shape** — giving wisps form. Turning "Iceland" into destinations with sequence and dates; turning a vague "puffins" into a specific stop. Shape receives wisps from Spark and prompts new Sparks back ("now that you've added Reykjavík, what about Reykjanes on the way out?").

Spark and Shape run as a **tightly coupled recursive loop**. Each pass through the loop generates *experience* — knowledge the user accumulates: what they like, what they skipped, what they wished they'd seen, the pace that worked, the kind of place they're drawn to.

**Experience persists across trips, not just within one.** What the user learns shaping their Iceland trip should be available when they start shaping the Alps trip — surfaced back to them as defaults, considerations, and spent sparks that might re-fire in a new context. This implies a user-level experience model that lives outside any single trip. The user should be able to see and edit what Max thinks it knows about them; experience seeds the loop, it never bypasses it. (Build deferred — see "Deferred / future direction" below — but the first redesign shouldn't box this out.)

Then a third activity, separable from Spark↔Shape:

- **Operate** — coordination, timing, commitment. Which hotel to book, which date to lock in, which deadline is closing. This narrows the trip rather than expanding it, and it only fires when reality requires it.

The two activities don't share a mindset. Spark↔Shape is expansive, recursive, generative. Operate is dense, factual, deadline-driven. Forcing both into one surface makes both lukewarm.

### Two surfaces

- **Shaping surface** (the re-scoped trip view): home of the Spark↔Shape loop. Celebrates possibility, never nags, never closes off until the user wants it to.
- **Operational surface** (working name: *"What needs you"*): sparse by default, populates only when the world is pressing on something.

Peek chips bridge them — quiet links from the shaping surface to the operational surface, never the reverse. See "Two surfaces" section below.

### Corollaries

- **Trip view ≠ destination view.** Trip view is structural and exploratory (Spark↔Shape lives here). Destination view is for guiding *the day* (what to see, where to eat, where to stay). They're separate jobs.
- **Loose by default.** A trip with everything "tentative" is a valid, useful trip. The interface should make firming up *cheap* when the user is ready, and reverting *cheap* if they change their mind on the ground.
- **Discovery is the visible face of the Spark↔Shape loop.** Sights aren't items on a pre-existing checklist; they emerge through the loop. Discovery has to live *inside* the shaping surface as a continuous thread, not behind a separate "Open Discovery" button.
- **The Spark intake is always-available.** The shaping surface needs a persistent affordance for introducing new wisps — an "always-on" input the user can fire any time. Friction here should be near zero.
- **Considered places are spark history.** Wisps that didn't make this cut stay visible (the Considered tray). They might re-spark later in this trip, or feed a future trip.

### The trip has chapters

The same trip looks different at different points in its life. The chapters describe where the trip's *center of gravity* sits, not which activities are available. Spark↔Shape and Operate both keep running throughout; the chapters just shift which is dominant.

1. **Spark** — the trip exists as a wisp + name, possibilities are being generated, nothing has shape yet. Very brief.
2. **Shape** — the long chapter. Wisps become destinations, possibilities accumulate, the trip takes structure. Spark continues to fire throughout.
3. **Firm up** — within a few weeks of departure. Operational surface starts populating. Spark↔Shape continues but its mood shifts from "wide open" to "tighten what's loose."
4. **Imminent** — days from departure. Operational dominant. Spark↔Shape recedes.
5. **In progress** — mid-trip. Today's destination is the center. Late binding flips to "what's possible *now that I'm here*."
6. **Past** *(deferred — TBD whether it gets dedicated treatment or just becomes "archived state")*.

The shaping and operational surfaces should be *responsive to the chapter*, not static. In Spark, the shaping surface is almost empty and inviting. In Shape, it fills. In Firm up, the operational chip becomes more prominent. In In progress, today expands and future cards stay quieter.

---

## Design principles

1. **Show, don't button.** Every piece of trip data is its own visual element. Editing is "click the thing." Modals are reserved for multi-field forms or destructive actions.
2. **Inline beats menu.** Nothing important hides behind File / Edit / Settings. A `⋯` in the top right of the trip handles rare actions: share, export, duplicate, delete.
3. **Conditional surfaces.** Banners (Decisions still open, Add waysides) appear only when there is something to do. When everything's tidy, the banners disappear.
4. **Primary action at the end of the list.** "+ Add destination" lives at the bottom of the destination sequence — where you'd add the next one — not at the top.
5. **Surface possibilities, not just commitments.** Destination cards keep their suggestion chips. Considered places stay visible. The trip view is a place to *spin down* options gradually, not a form to *fill out*.
6. **Cheap movement along the commitment spectrum.** Demoting a "kept" sight back to "tentative" should be as easy as keeping it was. Swapping a hotel should not require drilling into the destination view.
7. **No color-only signals.** Every visual distinction (commitment level, role, status, kind of pin) must carry a redundant non-color cue: shape, weight, icon, typography, position, pattern, or label. Color is reinforcement, never the sole channel. About 8% of men have some form of color vision deficiency; the interface can't assume anyone sees the difference between purple and blue.

---

## Commitment levels

The data model already supports five distinct states; the UI doesn't currently surface them clearly. This is the spectrum, possibility → done:

Each level must be distinguishable WITHOUT relying on color — shape, weight, icon, or label does the primary work; color is reinforcement only.

| Level | Meaning | Where it lives | Visual treatment (proposed) |
| --- | --- | --- | --- |
| **Possibility** | A place the user considered but didn't put on the itinerary. | `trip.mdcItems[]` / "Considered" tray | **Dashed outline**, smaller chip footprint, lives in the Considered tray (positional cue). Label may be in italics. |
| **Tentative** | Max added it; the user hasn't engaged. ("Drive the Ring Road stop") | `dest.days[].items[]` with `tentative:true` | **Dotted outline + sparkle (✨) prefix**, italic label. Sits within a day card but visually de-emphasized via the border style, not color. |
| **Kept** | User has explicitly kept it (clicked Keep, dragged it, edited it). The default for items the user added themselves. | `dest.days[].items[]` (no `tentative`) | **Solid outline, normal weight**. Default state — no extra glyph. |
| **Booked** | A booking record is attached (reservation, ticket, confirmation). | `dest.hotelBookings[]` / `dest.generalBookings[]` / `trip.tripBookings[]` linked from the item | **Solid outline + bold weight + lock or ticket glyph (🔒 / 🎟)**. Confirmation number visible on hover. |
| **Done** | Already happened (date < today). | Item with `done:true`, or computed from date | **Strikethrough text + check glyph (✓)**. Lower opacity is OK as a secondary cue, but the strikethrough is the load-bearing signal. |

**What moving along the spectrum looks like:**

- **Possibility → tentative**: the user drags a considered place onto a day, or clicks "add to day X" from the Considered tray.
- **Tentative → kept**: the user clicks Keep, drags it, edits it, or sets a time.
- **Kept → booked**: the user attaches a booking from the Stay/Eat/Bookings forms, or an email-forwarded booking attaches automatically.
- **Booked → kept**: the user removes the booking (e.g., cancellation) but wants to keep the intent. ("I still want to eat there, just not at this booking.")
- **Anything → possibility**: the user demotes it back to "considering." Useful if they're spinning a day looser as they get closer to it.
- **Anything → done**: time passes. The interface treats `done` as "execution mode" — no nagging, no editing pressure.

Every level should have a one-click move to the adjacent levels and a confirmable move to non-adjacent ones (deleting a "booked" item should warn).

**We can refine this list later** if five levels turn out to be too many. The first cut: keep all five, see if "possibility" and "tentative" feel meaningfully distinct in practice, collapse them if not.

---

## Two surfaces, not one

This redesign therefore splits the current trip view into two:

### Trip view → SHAPING surface

The aesthetic is generous, exploratory, almost a *commonplace book* for the trip. Books, music, half-remembered conversations, a place a friend mentioned — they all belong here as legitimate inputs. Destinations are choices that could shift. Sights are possibilities, emerging continuously through discovery rather than picked off a fixed list. Suggestion chips on destination cards are first-class — they're the visible surface of the possibility space.

What lives on the shaping surface:

- Destinations (with suggestion chips intact)
- Considered places (visible, draggable)
- Continuous discovery — generative "what else might matter here" threads alongside each destination, not a separate page behind a button
- Discovery scratchpad / notes / inspiration
- Wayside generation (it's about shaping the route's experience)
- Trip-level identity: name, dates, prefs, intent

What does NOT live here:

- Cancellation deadlines (operational)
- "Decisions still open" / "Tidy trip" (operational)
- The trip-wide bookings list as an always-visible chunk (a quiet collapsed row is fine, but the operational surface owns the booking conversation)

### NEW: Operational surface — working name "What needs you"

Sparse by default. Populates only when reality is pressing on something:

- Cancellation deadlines approaching
- Booking confirmations to verify
- Departure within the cancellation window for refundable items
- Hotels in regions with thin inventory that may not last another week
- Items the user explicitly marked as "decide by ___"

Empty state is honest: *"Nothing the world is requiring right now — return to shaping."* The point is that the absence of items here is good news.

The two surfaces link to each other via small **peek chips** at two scopes:

- **Trip-level chip** at the top of the shaping view ("3 things need you →"). Counts all operational items across the trip. Appears only when the count > 0. Tap → operational surface opens to the full list.
- **Destination-level chip** on each destination card (e.g. `◇ 1 →` in a corner). Shown only when THAT destination has operational items local to it. Tap → operational surface opens scrolled/filtered to that destination.
- **Back from operational** is just `← back to shaping` (or a swipe-down dismiss on mobile, when operational is rendered as a bottom-sheet).

The chip pattern is deliberately quiet — small text, no banner weight, no color shouting for attention. The shaping view stays generous; the chips are present without dominating. When nothing's pressing, no chips appear anywhere, and the shaping view is pure possibility space.

The two-scope chip means an operational item is visible **where the user is already thinking about it** (next to its destination), not just summarized at the top of the page. A user editing Akureyri sees the chip on its card; a user scrolling through the whole trip sees the trip-level chip. Same data, surfaced at whichever scope is relevant to the current attention.

What counts as "operational" at either scope: a cancellation window closing, a booking deadline approaching, a hotel that needs to be locked because rooms are scarce, a "decide by" the user set themselves. *Not* "this destination has tentative items" — tentative is shaping, by definition. Operational = the world is pressing on a decision.

---

## Proposed layout (top to bottom) — SHAPING surface

```
┌───────────────────────────────────────────────────────────┐
│ ←  Real Iceland Road Trip 2026                       ⋯    │   ← ⋯ = share, export, duplicate, delete
├───────────────────────────────────────────────────────────┤

  Real Iceland Road Trip 2026                                ← click to rename
  Mon Oct 5 – Wed Oct 28 · 24 days · 16 destinations         ← click any field to edit

  ✈ Arriving Reykjavík (UA 100, 8:30am)                      ← inline expand-on-click for full details
  ✈ Departing Reykjavík (UA 101, 4:45pm)

  Small-family-run hotels · Avoiding crowds                  ← prefs as inline text, click to edit

┌───────────────────────────────────────────────────────────┐
│ ◇ 3 things need you →                                     │   ← appears only when the operational surface has items; tap to switch surfaces
└───────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────┐
│ ✨  Add waysides on 5 routes                              │   ← only when there are routes without waysides
└───────────────────────────────────────────────────────────┘

   ─── Bookings that span the trip (2) ──────────────────    ← collapsible header; click chevron to expand

   🚗 Hertz · Keflavík · Sep 20 – Oct 6 · USD 1,632
   ✈ United BP8P5W · Oct 5 · UA 100 / UA 101
   + add booking

   ─── Considered (5) ───────────────────────────────────    ← collapsible header; expands to a horizontal row of dashed-outline cards

   ─── Destinations ─────────────────────────────────────    ← the trip's actual body, where it belongs

   [Reykjavík card] · 1 night · arrival
   [Vík card]        · 2 nights
   [Höfn card]       · 1 night
   …
   [Reykjavík card] · 1 night · departure

   + add destination                                          ← primary action at bottom of list

┌───────────────────────────────────────────────────────────┐
│  More                                              ⌄      │   ← collapsed by default
│  – Reverse trip order                                      │
│  – Keep in mind notes (3)                                  │
│  – Trip discovery scratchpad                               │
└───────────────────────────────────────────────────────────┘
```

---

## What dies

| Today | Replaced by |
| --- | --- |
| **Tidy trip** button (always visible) | Merged into the "Decisions still open" surface when an actual issue exists. No issue → no button. |
| **Keep in mind for your trip** button (opens modal) | Becomes a single text field inside the "More" panel. Notes auto-save, no modal. |
| **Considered (5)** button (opens a separate surface) | Becomes a collapsible section *on the trip view itself*, between Bookings and Destinations. Drag-to-destination still works. |
| **Open Discovery** button | Becomes a "Trip discovery scratchpad" row in the More panel — or merged with Considered. |
| **Trip preferences box** (always-visible panel) | Becomes a single inline line in trip identity ("small-family-run hotels · avoiding crowds"), with an inline editor on click. |
| **Reverse order** button (always visible) | Becomes a row in the "More" panel — it's a once-per-trip action. |
| **Top-nav File / Edit / Settings** | Replaced by `⋯` in the top right of each trip; contains share, export, duplicate, delete. App-level Settings stays accessible from Home. |
| **Trip Bookings card** always expanded | Becomes a collapsed section header by default (`▶ Bookings that span the trip (2)`). Expands on click. `+ add booking` inline. |
| **Arrival/Departure form** always expanded | Collapses to a one-line summary by default. Expands on click for the full form. |
| **Trip name pencil** | Click the title to edit, same as everywhere else. The pencil disappears. |

---

## What stays exactly as it is (and why)

- **Destination cards as the trip's body** — including the suggestion chips. Those chips are possibility-surfacing, which is core to the planning view's job. Clicking a card switches to the destination detail view, because that's a different job.
- **The wayside generation banner.** Conditional, clear, primary when present.
- **The "Decisions still open" banner** (formerly "Action needed"). Same logic, softer copy.
- **Inline date editing** (click → date picker). This is the editing model the rest of the page should adopt.

---

## Open questions for you to argue with

1. **Two surfaces vs. two modes of one surface?** A toggle ("Shape | Operate") keeps everything in one place but risks mode-confusion. Two distinct surfaces makes the cognitive separation literal. I drew it as two surfaces; you've thought about this longer.

2. **What's the canonical name for the operational surface?** I used **"What needs you"** above. "Status" is fine but flat. "Now" is too time-locked. "Commitments" is heavy. "Decisions" implies the user *should* be deciding when the philosophy says they shouldn't have to. Open to renaming.

3. **What does the operational surface contain when there's nothing pressing?** A genuine empty state ("Nothing the world is requiring right now — return to shaping")? Or a quiet historical view of what's been decided so far? I lean toward the honest empty state.

4. **Where do hotels and bookings live?** Today they're trip-wide and per-destination both. In the late-binding model, a "booked" hotel is operational; an "undecided hotel" is shaping. Maybe the data is the same and the surface just renders it differently — shaping view shows "considering hotels in Akureyri (3 options)"; operational view shows the confirmation when booked.

5. **"More" as a single expand** vs. a sidebar drawer vs. three separate disclosures on the shaping view? Drawer would let tertiary items stay visible while editing destinations — better for power users, more noise for first-timers.

6. **Trip-wide bookings on the shaping view as a collapsed row, vs. only on the operational surface?** A booked flight is operational; the *fact* that there's a flight at all is structural shaping context. Maybe the shaping view shows them as a quiet "✈ United · 🚗 Hertz" line and the operational surface is where you click through to actually act on them.

7. **Commitment-level glyphs — bake in now or defer?** The five-level spectrum is in the data model. The shaping surface deliberately downplays them (everything reads as "in play"); the operational surface needs them vivid. Should the first redesign pass include the glyph work, or ship structural first and add the level work as a follow-up?

8. **Today-during-trip nuance.** When the user is mid-trip, should today's destination card grow / pin to the top of the shaping view automatically? The principle says "no mode switch," but pinning today is a small affordance that respects where the user is.

---

## What this doesn't redo

- The destination detail view (See and Do, Stay and Eat, etc.) — that's a separate audit.
- The home screen / trip list — already fine.
- The picker / discovery flows.
- The map. Map work is its own design problem — though the **color-blindness principle above flags that the existing pin system needs review**: today's blue numbered = destination, purple dot = wayside, purple-with-spur = day-trip stop relies on color to distinguish kinds. Different shapes (circle, diamond, square) or differing label patterns would carry the distinction without color. Tracked separately.

## Deferred / future direction

These belong to the same product vision but explicitly aren't part of the first redesign:

- **Past chapter.** The trip after it ends. What happens to a trip when it stops being current? Recent (recall + notes) vs. archived (memory) — TBD whether they get distinct treatments. Open question.
- **Cross-trip experience model.** The user-level store that captures what the user has learned shaping (and taking) their trips. Read paths into Spark↔Shape so future trips benefit from past ones. Write paths from explicit user-captured notes and from inferred patterns across actual trips. The first redesign should make sure the shaping surface doesn't *block* this future addition — e.g., per-destination considerations should be data-modeled as user-owned, not trip-owned, so they can be lifted into cross-trip later.
- **Spent sparks as cross-trip material.** Wisps the user considered and didn't take in this trip become candidates to surface in future trips (especially same-region trips). Same architectural ask as above — the considered-tray data shouldn't be locked to the trip that originated it.
- **Chapter-responsive rendering.** The shaping and operational surfaces should shift visual emphasis based on which chapter the trip is in (Spark → Shape → Firm up → Imminent → In progress). The first redesign ships the surfaces in a static "Shape chapter" mood; the chapter-responsiveness comes after the structural redesign lands.

If we ship this, scope is roughly: edit the trip-mode renderer in `index.html` + the trip-ui helpers in `trip-ui.js`. No data model changes; no engine changes (the commitment state machine is already there). A focused front-end refactor.

---

## Next step

Mark this up. Cross out what you hate, circle what's right, scribble in the margins. Then we pick one section, redesign that surface, and ship it as a contained PR.

My pick for the first section: **the top of the trip view** (everything above the Destinations header). That's where the wall-of-controls problem is worst, and the rest of the page is comparatively fine once that's calmed down. The commitment-level work can be a follow-up pass once the structural surfaces are in place.
