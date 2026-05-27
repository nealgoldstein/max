# Max: An Introduction

> *Last updated: v359.60.34 — paired with the [Operating Manual](Max-Operating-Manual.md) which covers the same surfaces in mechanical detail.*

Max is a travel-planning app for people who do their own research and
want a working canvas to push back against — not a plug-and-play
itinerary handed down from on high.

**A trip doesn't begin whole — it begins as a wisp.** A half-formed
idea picked up from a book, a conversation, a piece of music, a
photograph, a place you read about years ago. The wisp lives with us:
we layer detail onto it, change our minds, look at maps, talk to
friends, drop new wisps as they arrive. Through that living, the trip
slowly takes shape. Then we travel — and only afterward, when we've
walked the streets, eaten the meals, watched the light change on
unfamiliar landscapes, does the trip become real. Not as a plan
executed, but as something we now know.

Max is the place where the wisp lives between conception and arrival.
It holds the half-formed idea, helps it grow without pinning it down
too early, and stays useful through the travel itself.

The core idea: **a trip is a scaffold, not a script.** Max gives you
something concrete enough to react to (destinations, durations,
candidate sights, day-by-day plans) and you adjust as you learn.
You're never locked into Max's first take. Every part of the plan is
yours to drag, edit, ignore, or replace.

It's AI-assisted where the AI is genuinely useful (initial
brainstorming, extracting structured data from messy emails, weather
forecasts, in-app Q&A) and stays out of the way everywhere else.

![Hero shot — the trip overview with today banner, destinations stacked, weather chips visible](images/01-trip-overview.png)

> *Capture: trip view of any in-progress trip. Frame should include the
> "You're on day X" banner at top, the dates strip, two or three
> destinations beneath it, and at least one weather chip on a day card.
> Crop to ~1200×800.*

---

## How Max thinks about travel — late binding

A trip in Max is something you *progressively shape*, not something
you fully define in advance. The world contains more information
than you can process beforehand. Arrival, conversation, weather, a
recommendation from someone you meet at breakfast — these will shape
what actually happens more than any pre-departure checklist can. The
map is not the territory.

### Max is for the wisp, not the blank slate

Trips don't start in Max with "where should I go?" — they start
somewhere outside the app, in a book, a conversation, a half-read
article, a piece of music, a memory. You arrive at Max already
pointing at a region: Iceland in October, the Alps next summer, the
Dordogne sometime. Max's job begins from that wisp.

### Three activities, not one

Max separates three activities that planners usually mash together,
and lets each one breathe in its own register:

- **Spark** is introducing a wisp. The first wisp is what brought
  you to Max. New sparks fire continuously throughout planning —
  when reading about a place, when talking to someone, when looking
  at the map and noticing something you hadn't considered. Each
  spark is a possibility-in-waiting.

- **Shape** is giving wisps form. Turning "Iceland" into a sequence
  of destinations with dates; turning "puffins" into a specific
  stop on a specific day. Shape receives wisps from Spark and
  surfaces new wisps back — discovering one place makes adjacent
  ones visible. Spark and Shape run as a tightly coupled recursive
  loop, and the act of running the loop *generates experience* —
  what you like, what you'd skip, what feels right.

- **Operate** is about coordination, timing, and commitment. Which
  hotel will you actually book? What day will you visit a sight?
  Which deadlines matter now, and which can wait? Operate
  *narrows* the trip rather than expanding it, and it only fires
  when reality requires it.

The expansive Spark↔Shape loop and the narrowing Operate activity
share data but they don't share a mindset. Max keeps them visually
distinct so the shaping mind isn't pulled prematurely into
operational anxiety, and the operational mind doesn't have to wade
through possibility to make a deadline.

### A trip is a river

A trip is like a river. There are currents pulling you forward, eddies
where you linger, whirlpools that catch you off guard. The river has
its own logic — the slope of the land, the shape of the banks, what
fell into it upstream. You can read it, you can paddle it, you can
sometimes steer it — but you don't author it.

And on a trip, just as in our lives, **we are one flicker of light on
the surface.** Brief, particular, present for the part of the river
we happen to traverse. The current keeps moving after we've moved on.

Rivers are notoriously chaotic systems, and in a chaotic system you
can't predict the future from a starting state — small inputs amplify
in unknowable ways. The right response to a chaotic system isn't to
plan harder; it's to be *prepared* — to have the capacity, the
context, and the openness to respond to what the river actually does.

> *"Plans are useless, but planning is everything."*
> — Dwight D. Eisenhower

Eisenhower's distinction is exactly the one Max is built around. The
specific plan you arrive with — the day-by-day, the bookings you
made in March, the must-see list — has limited shelf life once
travel starts. But the *planning* — the wisp-living, the maps you
poured over, the conversations, the trade-offs you weighed — gives
you everything you need to read the river in the moment. The plan
gets thrown out; the planning carries you through.

### Late binding

The software-engineering term for this kind of preparation-without-
premature-commitment is **late binding** — *deferring decisions
until you have to make them*. Sights, hotels, day-by-day plans: none
of them lock in until reality requires it (a cancellation deadline,
a flight with assigned dates, a hotel that won't have rooms in two
weeks). Everything else stays in play.

This is why **discovery isn't a phase that ends**. Sights aren't
items on a pre-existing checklist; they emerge through the
Spark↔Shape loop. The loop runs through the entire trip, including
while you're on it.

A rigid traveler asks "What will I do there?"
A late-binding traveler asks "What becomes possible once I arrive?"

Leave room for the world to surprise you.

### The arc: wisp → living → travel → real → lineage

There's a longer arc that the three activities sit inside. A trip
moves through five states, in order, and each one earns the next:

- **Wisp** — an idea barely formed. "Iceland." "Trains." "Somewhere
  quiet." Not a plan, not even a destination yet. Just a pull. Max's
  Spark intake exists for exactly this — somewhere to drop the wisp
  the moment it arrives so you don't lose it.

- **Living with it** — the wisp incubates. You read about Iceland,
  see a friend's photos of the Westfjords, watch a documentary, drop
  more wisps as they arrive ("hot springs," "puffins," "the ring
  road"). Max's Spark↔Shape loop is built for this stretch — the
  longest stretch in most trips. The trip changes shape multiple
  times here, and that's not indecision; it's *the work*. A trip
  shaped without living with it tends to be the trip someone else
  would have taken.

- **Travel** — the trip leaves the page. You go. Operate kicks in.
  Things change. The wisp meets the world.

- **Real** — after you return. The trip has become something you
  know, not something you planned. The hotel that looked perfect on
  Booking might be remembered for the conversation you had at
  breakfast. The detour you took because the road was closed might
  be the day you talk about most. The wisp has fully bound itself to
  experience.

- **Lineage** — the trip is over, but its consequences carry forward.

  > *"The past is never dead. It's not even past."*
  > — William Faulkner, *Requiem for a Nun* (1951)

  Faulkner was writing about something larger than travel, but the
  line lands here too. What you learned on Iceland — that you love
  raw thundering waterfalls more than picturesque ones, that you'd
  happily spend a whole day driving without arriving, that a hot
  spring at sunrise is worth waking up for — quietly seeds the next
  wisp on the next trip. The trip is gone but it's not gone. **As we
  travel and learn and discover more, the original idea may fade,
  but that does not eliminate the history, ideas, and learning we
  accumulated from pursuing it.**

Each state is necessary. A wisp that never gets lived with stays
abstract. Living that never becomes travel stays daydream. Travel
that isn't re-examined doesn't yet become real. And a "real" trip
that doesn't feed forward into lineage is a kind of forgetting —
the next trip starts from scratch when it didn't have to.

Max is built to hold the trip through all five. The Spark intake
catches wisps as they arrive. Discovery + Structure let the wisp
live with you and reshape. The trip view goes with you on the road.
The captured-ideas history preserves the wisps even after the trip
is over. And **trip lineage** (a planned future feature) carries the
real of one trip forward as raw material the next trip can recognize
itself from.

#### A wisp's lineage outlives the wisp

The first wisp — the original "why" that brought you to Max — is
seed, not contract. The wisp can be deleted; what it generated
(destinations, decisions, bookings, the other wisps it sparked,
even the learning) stays. The tree outlives the seed.

So delete affordances on wisps are generous: any wisp can go,
including the original primary. What it produced is unaffected.
The trip endures past any specific thought that contributed to it.

If you want to truly start over — to reshape a trip from a new
"why" — the right action is **create a new trip**, not delete the
original wisp. A new trip can selectively inherit wisps and learning
from prior trips. The lineage flows forward; nothing has to be
destroyed to make room.

---

## The four phases

Max revolves around four phases that overlap and feed each other.
They're not a linear wizard — you move between them as you learn
more, and editing in one is reflected in the others.

**1 · Profile.** Where you want to go, roughly when, how long, and
the *intent* — what kind of trip this is. Active outdoors, museums
and food, hot springs and remote drives, 2-week family with
grade-schoolers. Plus the personal context that shapes what Max
suggests: how you travel, who's coming, what you'd skip, what you
won't miss, the pace you can sustain. The Profile is the trip's
gravity — what gives every other phase its weight.

**2 · Discovery.** What's actually *in* the place you're going.
Sights, walks, food, scenery, places to stay overnight, places to
stop on the way. Grouped into activity themes ("Hike to
waterfalls," "Walk in volcanic landscapes," "Soak in thermal
baths"), each with a few specific places. Max suggests a starting
set; you accept, reject, add, and curate.

![Discovery view with grouped activity themes and a map](images/02-picker-candidates.png)
> *Capture: discovery view showing 4–8 activity sections each with
> multiple places under it, thumbnails visible, map on the right.*

**3 · Structure.** Which places make the cut, in what order, for
how many nights each. The scope of the trip in geographic and
temporal terms: a sequence of destinations with dates, a route on
the map, day trips that loop out from a hub, waysides that sit on
a transit leg, places kept on the trip with no overnight ("see").
This is where Discovery's "could go" becomes the trip's "will
go."

**4 · Plan.** What you actually do at each destination — which
sights are scheduled for which day, when arrivals and check-ins
happen, what restaurants you're considering, what bookings are
confirmed. Per-destination, day by day. Much more fluid than the
other three because it gets shaped by what you discover when you
arrive.

### Specificity rewards you — especially in the Profile

The more specific your Profile, the better the trip Max gives you
back. Compare these two sentences:

> *"To drive the complete ring road and see the northern lights."*

with:

> *"To drive the complete ring road counterclockwise end to end and
> see the northern lights."*

The second locks in a direction, a completeness commitment, and a
sequencing order. Max can plan around it: route the southern
overnights up front, save the aurora-viable dark-sky nights for
the eastern and northern stops, set the pace so you actually make
the full loop instead of doubling back. The first sentence leaves
all of that open — Max guesses, and you may not like the guess.

You can fix this later. Marking destinations, reordering nights,
rejecting candidates, re-running Discovery — all of it works,
and Max won't punish you for changing your mind. But it's easier
to set the constraint up front than to argue with a built trip.
If you know what you want, say so in the sentence. Every
modifier you add — *counterclockwise, end to end, by train,
without backtracking, with at least three dark-sky nights* —
gives Max one less thing to guess about.

The same goes for Constraints: a return date is more specific
than a season; a flight number is more specific than "fly in";
"limited walking" is more specific than "moderate pace." Specific
inputs produce specific outputs. Vague inputs produce trips you
have to renegotiate.

### Why phases, not steps

In practice you cycle through them, not march through them:

- You set up a **Profile** with two weeks for Iceland → land in
  **Discovery** → realize the things you want span more than two
  weeks → back to **Profile** to bump it to three weeks.
- You **Structure** the trip across six destinations → spot a
  ring-road town you missed in **Discovery** → add it, re-Structure.
- You're **Planning** day 5 in Vík → notice a sight on the map you
  hadn't added in **Discovery** → add it, see if it changes the
  **Structure** of nights.
- A booking confirmation comes in → updates Plan AND Structure
  (dates locked in) AND Discovery (the place is committed now).

Each phase keeps the others up to date. You can change your mind
freely; nothing locks until you book — and even then, you can
edit, cancel, and rebook.

### After the planning phases

The trip itself isn't a phase in Max's model — it's the payoff.
But the app still has a role while you're traveling:

- **Today banner** during active trips: "You're on day 5 of 12 ·
  In Reykjavík · 7°/3° · 7 days left." Tap to scroll to today's
  day card.
- **Booking confirmations** still come in mid-trip; paste them
  and they land in the right Plan.
- **Notes from the road** on each destination — what you actually
  did, what was worth it, what you'd skip. Becomes diary later.

### Shortcut: already have a list?

If you've already done your own research and have a list of places
written down — your own notes, a friend's email, a ChatGPT
conversation — you can paste or upload it and Max will seed
Discovery with those places. You skip a fresh Profile build
(mostly); Max still runs the LLM, but anchored on *your* list
rather than starting from scratch. Two entry points:

- **Home screen → Paste a list.** Sits next to *Start a new trip*.
  Opens a paste box. On Open, Max parses the text, runs each
  place through the LLM to group them into activity themes, and
  lands you in Discovery with everything populated.
- **Home screen → Load from file.** Same flow for `.txt` / `.md`
  files. Pick the file, Max parses it, lands you in Discovery.
  (`.json` files still work too — those are full Max trip exports
  and restore the entire trip as-saved, skipping the Discovery
  phase.)

Whichever entry point you use, every place from your list is
guaranteed to land in Discovery — if the LLM drops one while
organizing themes, a backstop catches it and adds it to an
"Other places to consider" section. Token-aware matching means
Max won't duplicate a place just because the LLM phrased it
differently ("Snæfellsnes" vs "Snæfellsnes Peninsula" count as
the same place; "Ásbyrgi" vs "Ásbyrgi Canyon" likewise).

#### Format

The first line is the **trip name** plus an optional **region** in
parentheses. The region is what Max hands the candidate-generation
LLM as its geographic scope — get it right and out-of-region
suggestions get rejected automatically.

Optional frontmatter lines can sit between the trip name and the
first section. The **easiest** form is a single natural-language
line — Max pulls the date and the duration out of it:

```
September 17, 17 nights
Aug 1 for 2 weeks
2026-08-01, 14 days
```

A bare month + day (no year) inherits the year from the trip
name ("Iceland Road Trip 2026" → 2026), otherwise the current
year.

If you'd rather be explicit, the same fields are available as
`Key: value` lines. Use **one** of `Start` / `When` / `Dates`
(whichever matches what you know), plus an optional `Duration`:

- **`Start: YYYY-MM-DD`** — exact start date. Drives the date
  cascade for every destination. If you set this, you don't need
  `When:` too — Max auto-derives the rough month/year for the
  LLM's context ("2026-08-01" → "August 2026").
- **`When: <free text>`** — rough timing ("August 2026", "second
  week of July") when you don't know the exact date yet.
  Populates `trip.brief.when` but doesn't drive the cascade
  (Max falls back to today's date when committing destinations).
- **`Dates: <free text>`** — combined form. If an ISO date is
  present anywhere in the value, it's pulled into `Start`; the
  whole string also goes to `When` for context.
- **`Duration: <free text>`** — "14 days", "2 weeks". Populates
  `trip.brief.duration`. If you put night counts on every stay
  (e.g. `* Reykjavík 3`), Max auto-derives this from the total —
  you only need `Duration:` when you don't have a full list yet
  and want to tell the LLM the rough budget.

```
Iceland Road Trip 2026 (Iceland)
Start: 2026-08-01
Duration: 14 days

1. Overnight hubs
* Reykjavík (Arrival/Departure point)
* Vík 2
* Höfn

2. Sights, Waterfalls, Points of Interest
Golden Circle Area:
* Þingvellir (Thingvellir National Park)
* Geysir
* Gullfoss
South Coast:
* Seljalandsfoss
* Skógafoss
* Diamond Beach
```

What the parser understands:

- **First line — trip name (and region).** Non-bullet, non-header
  line at the top. If it ends with `(Country)`, that becomes
  `trip.brief.region` exactly; otherwise the whole line is used
  as the region (with a trailing year stripped). If the first line
  is missing, Max falls back to "Imported — date" and no region —
  candidate generation will be unscoped, so this is worth doing.
- **Frontmatter block** — `Key: value` lines after the trip name
  but before any section header / bullet (see above). All
  optional; case-insensitive keys; unknown keys end the block.
- **One place per line.** Bullets (`*`, `-`, `•`) are optional and
  stripped.
- **Section headers** like `1. Overnight hubs` or `2. Sights &
  landmarks` flip the mode for everything beneath:
  `overnight|hub|stay|base|lodging` → stay (1 night each by
  default); `landmark|sight|see|stop|waterfall|point` → see
  (0 nights, grey pin on the map).
- **Sub-headers** (lines ending with `:`, no bullet) — used to
  group ("Golden Circle Area:", "East Fjords:") and ignored.
- **Parentheticals** become each destination's `intent`:
  `Fjallsárlón (Glacier lagoon)` → place `Fjallsárlón`, intent
  "Glacier lagoon". The special parenthetical `(Arrival/Departure
  point)` auto-wires the trip's entry/exit cities — useful for
  round-trips like Reykjavík ↔ Reykjavík.
- **Trailing numbers** set nights for that entry: `Akureyri 3`,
  `Reykjavík 2 nights`.
- **Trailing `stay` or `see`** overrides the section's default for
  one line.
- **Aliases with `/`** — the shorter half wins (`Lake Mývatn /
  Mývatn` → `Mývatn`).
- Lines starting with `#` and blank lines are skipped.

Once the destinations land you adjust like normal: bump nights
with the +/− spinner, change a stay to a see (or to a day-trip
stop, or to a wayside along a transit leg, or remove it) via
the unified stop popover on each destination, drag the order,
etc. See *The unified stop popover* below for the full set of
role transitions.

---

## The major surfaces

### The home screen

Lists every trip you have. Cards show name, dates, destination
count, and indicators for trips that are upcoming, in-progress, or
in the past. Tap any trip to open it. The header has Sync
(cross-device account), Welcome (preferences), and the current
trip-creation wizard ("Create a plan").

![Home screen with trip cards](images/03-home-screen.png)
> *Capture: home screen. Multiple trip cards visible (mix of past +
> upcoming if possible). Header with Sync/Welcome/Install pill at
> top right.*

### The trip view

The trip-overview canvas. Top of the page shows the trip name,
date range, and a today banner during active trips ("You're on day
5 of 12 · In Reykjavik · 7°/3° · 7 days left"). Below it,
destinations stacked top-to-bottom — drag to reorder.

Each destination card shows place, dates, weather forecast, and
a strip of inline action chips (sights to consider, "Compare
tiles", a 📍 map pin that opens the larger map focused on that
city). Click into any destination for the full per-destination
view.

![Today banner up close — "You're on day 1 of 46 · In Reykjavik · 🌤️ 7°/6° · 100% rain"](images/04-today-banner.png)
> *Capture: just the today banner area, cropped tight. Should be
> visible only during an active "during" phase trip.*

### The destination view

Six tabs per destination:

- **Itinerary** — the day-by-day plan
- **Explore** — candidate sights to add
- **Stay** — lodging (suggested + booked)
- **Routing** — transport between destinations
- **On the ground** — practical info (currency, plugs, language)
- **Tracking** — bookings + deadlines + history

![Destination detail with the six-tab strip](images/05-destination-tabs.png)
> *Capture: destination view with tab strip visible at top, content
> for the active tab below. Itinerary tab is the most representative.*

### The itinerary

The day-by-day plan. Each day shows its date, a weather chip,
what's scheduled (sights, restaurants, day-trips, bookings),
arrival/departure transport chips, hotel check-in/out chips, and an
"Add" row to drop in new items. Drag items between days; tap an
item to reveal actions (story, done, move, book, delete).

![Itinerary day cards with weather chips, sights, and a hotel chip](images/06-itinerary-days.png)
> *Capture: itinerary tab showing 2-3 day cards in a row. Make sure
> at least one shows the per-day weather chip (🌤️ N°/N°), one
> shows a hotel check-in or check-out chip, one shows a few
> planned items.*

### The unified stop popover

Click any pin on the trip map (overnight blue, day-trip purple,
wayside small purple, see grey) and one dialog opens with the
same five options every time:

- **Overnight stay** — a real base with at least one night to
  sleep. The destination shows on the map as a numbered blue pin
  and gets its own slot in the itinerary.
- **Day trip** — visited from one of your overnight hubs and
  returned the same day. Choose the hub in the *From* dropdown.
  Pick *New day trip* to mint a fresh route, or *Add to* to join
  an existing one (Golden Circle pattern — see "Multi-stop day
  trips" below).
- **Wayside** — a stop on the way between two hubs, no overnight.
  Pick which transit leg it sits on; the leg's polyline bends
  through the wayside automatically.
- **See** — kept on the trip as a potential stop but with no
  nights, no day-trip role, no wayside role. Renders as a grey
  pin. Useful while you're still deciding.
- **Remove from trip** — drops the place entirely. (It stays in
  the research view, so you can re-add it later.)

The current role is marked *(current)* and highlighted. Apply
commits the change and re-cascades dates / nights / map.

### Multi-stop day trips

A day trip can hold more than one stop. The Golden Circle pattern
is the classic example: Reykjavík → Þingvellir → Geysir →
Gullfoss → Reykjavík, three stops on one route, one day. Build
one in either order:

- Convert each place to a day trip individually, all from the
  same hub. Max merges them into one route automatically when
  you choose *Add to* an existing day trip from the popover.
- Or start with one day trip from the hub, then for each
  additional place open the popover and pick *Day trip → Add to
  → [the existing route]*.

By default new stops slot into the geographically sensible
position — Max computes the cheapest insertion (the gap that
adds the least extra driving). Override via the *Insert after*
dropdown if you want a specific order ("Insert after Þingvellir"
puts the new stop between Þingvellir and Geysir, regardless of
geometry).

On the map, multi-stop day trips render as a single purple loop
hub → stop₁ → stop₂ → … → hub.

### Trip dates editor

Click the dates strip at the top of the trip view (the bold
"Mon, Sep 15, 2026 – Mon, Oct 2, 2026" line with the small ✎
icon) — or use *Edit → Trip dates…* — to open a modal with Start
and End inputs. Two rules:

- **Change Start only:** the whole trip shifts by the delta.
  Nights per destination stay the same.
- **Change End only:** Max scales destinations proportionally
  to fit the new total. A 14→16 day trip stretches the longer
  stays first; a 14→12 day trip trims them, never below one
  night per overnight.

A live preview at the bottom of the modal says exactly what
will happen ("17 days · 16 nights · shifted later by 3 days,
extended by 2 nights") so there are no surprises.

### Maps

Interactive maps everywhere. Trip-overview map shows all
destinations and the route between them. Per-destination map
shows sights, hotels, restaurants, and any custom locations you've
added. Toggle between satellite and street. Tap any pin for a
panel with details and "Open in Maps" to launch your phone's
maps app for navigation.

The "View larger" button opens the map full-screen for closer
inspection. On phones, it opens as a full-page overlay; on
desktop, it pops out into a separate window so you can park it
on a second monitor.

#### Pin shapes

Each role on the trip map renders with both a distinct color and a
distinct shape, so the encoding is decodable without color
(important for colorblind users, and useful for everyone scanning
a busy map):

- **Numbered circle (blue)** — overnight destination. The number
  is its position in the trip sequence.
- **Rounded square (purple)** — day-trip stop, with the place's
  initials inside. Connected to its hub overnight by a purple loop.
- **Hollow octagon (purple outline)** — wayside, a brief stop on
  the drive between two hubs. The "stop sign" shape says "pause
  here." The hollow look keeps the map visible underneath.
- **Dashed grey circle** — considered/set-aside, a place from
  discovery that isn't on the trip yet. Tap to add.

The shapes also serve as a built-in legend: a pin's silhouette
tells you what it is even before you read the color.

![Map in satellite mode with sight pins clustered around a destination](images/07-map.png)
> *Capture: per-destination map in satellite mode, zoomed enough to
> see 6-12 pins (sights, hotels, restaurants) clearly. The map's
> red current-dest pin should be visible.*

### Weather

Each destination shows the typical weather for the dates you'll
be there.

- Within 16 days from today → an actual **forecast** (averages
  for the date range): "🌤️ Forecast 18°/9°C · 30% rain"
- Beyond 16 days → **climate normals** computed from the same
  calendar month over the past 5 years: "🌤️ Typical 22°/14°C ·
  35% rainy days (climate avg)"

Each day-card in the itinerary also gets its own tiny chip showing
that specific day's high/low and rain probability. The same chip
shows up in the Today banner during an active trip — so the first
thing you see when you open Max each morning is what you're about
to walk into.

![Per-day weather chips inline on day cards](images/08-day-weather-chips.png)
> *Capture: close-up of a couple of itinerary day-card headers
> showing the inline 🌤️ N°/N° chips. Crop tight so the chip is
> the visual focus.*

### Booking-confirmation parser

Click **📋 Paste** in the trip header. Paste any flight, hotel,
train, restaurant, or tour confirmation email — the full body
works best. Click **Parse →**.

Max extracts the type, dates and times, carrier, hotel name,
address, confirmation number, price, currency, booking management
URL, and cancellation policy — all in seconds. The next modal
previews every field as editable inputs (with the detected type at
the top to override if needed) and a **Destination** dropdown that
auto-selects the right destination based on the booking's address
+ dates.

![Booking parser preview modal with all fields populated](images/09-paste-preview.png)
> *Capture: after pasting a real confirmation and clicking Parse,
> the preview modal with type=hotel, dates, address, price, currency,
> URL, cancellation policy all filled in. Crop to show the whole
> form including Save button at bottom.*

### Trip export

**Export** in the trip header offers four options:

- **📄 Print / Save as PDF** — opens a clean printable view in a
  new window. Includes the trip overview, every destination, every
  day's plan. Leads with a **paste-back-compatible shareable list**
  block (see next bullet) so the PDF itself round-trips: anyone with
  the printout can recreate the destination skeleton in their own
  Max by copying the top section.

- **📋 Copy as shareable list** — plain-text destination list in
  the same format Max's "Paste a list" (home screen) and "🪄 Make
  destinations from this list" (Research notes) accept. Numbered
  sections for overnight hubs vs sights, trailing nights per stay,
  `(Arrival/Departure point)` annotation for round-trips. Copies
  to clipboard, or downloads as `.txt`. Useful for sharing via
  email/Slack, or seeding a second trip from a first.

- **📅 Download to calendar (.ics)** — one-shot iCal file with every
  destination as an all-day event (📍 prefix), every booked
  transport item as a timed event (✈ prefix), and every planned
  sight/restaurant/day-trip as a timed event with a slot-aware
  default time. Drops into Apple Calendar, Google Calendar, Outlook.

- **🔄 Subscribe in calendar (recommended)** — live URL your
  calendar app refreshes on its own schedule. Edits in Max — date
  changes, added sights, removed bookings — propagate into your
  calendar automatically.

![Export modal with three options](images/10-export-modal.png)
> *Capture: the Export modal showing all three options stacked.
> Subscribe option highlighted as recommended.*

![Apple Calendar showing the subscribed trip events](images/11-apple-calendar.png)
> *Capture: Apple Calendar (or Google Calendar) showing your trip's
> events laid out across days. Optional but powerful — proves the
> integration actually works.*

### Trip share

**Share** in the trip header generates a public read-only URL.
Anyone with the link can view the trip but can't edit it. The
modal shows the URL (with copy button), a **QR code** of the same
URL — point your phone camera at it to open the trip on your phone
— and a **Revoke** button that nukes the link if you want to take
it offline.

Recipients can click "Duplicate to my account" to copy the trip
into their own Max account.

![Share modal with URL field and QR code](images/12-share-qr.png)
> *Capture: the Share modal with an active link, the URL row visible,
> and the QR code panel below it.*

### 💬 Ask — in-app AI chat

The AI assistant lives in the trip-view header. Click **💬 Ask**
and you get a chat panel that already knows your trip — every
destination, every date, every planned item, your lodging, the
weather. Ask anything trip-related:

- "What's a good breakfast spot near where I'm staying in Reykjavik?"
- "Will I be cold in May? What should I pack?"
- "What's the typical service charge in Iceland?"
- "Translate 'where's the bathroom' into Icelandic."
- "Compare Vík and Mývatn for a 2-day stay."

Conversations persist per trip, sync across devices, and stay
right next to the plan — no tab-switching or copy-pasting context
between Claude/ChatGPT and Max.

![Chat in action — context-aware exchange about the current destination](images/13-chat.png)
> *Capture: the chat modal mid-conversation. Should show 2-3
> exchanges: a user question and Claude's reply, ideally with
> Claude referencing something specific from your trip
> (a destination, a date, a planned item). Footer with "Powered by
> your Anthropic key" link visible.*

The chat runs on **your own Anthropic API key** (you paste it
once during chat onboarding; key stays in your browser only). All
other Max features ride on a shared key. The first time you click
Ask, Max walks you through getting an API key from
console.anthropic.com.

![Chat onboarding modal with rationale + value-prop block](images/14-chat-onboarding.png)
> *Capture: the chat-key onboarding modal in intro mode (paste field
> empty). Should show the header, the rationale paragraph, the
> blue "Why use Claude inside Max?" callout, and the "How to get a
> key" steps. May need to scroll the modal up to capture the top.*

### Preferences

Preferences shape every trip Max builds for you, and they sync
across devices when you're signed in. Open the panel from
*Settings → ⚙* in the trip-view menu bar.

**Pace** (how dense each day feels):

- *Hours of sightseeing per day* (default 6)
- *Max big sights per day* — 2+ hour anchors (default 2)
- *Pace mode* — Relaxed / Balanced / Intense
- *Max drive time for a day trip* — Max won't propose a day trip
  more than this many hours from a hub (default 3h)
- *Day-trip radius* — same idea but in kilometres for places without
  good driving data (default 60 km)

**You** (signals Max uses for filtering):

- *Mobility* — fit / moderate / limited / elderly / other
- *Dietary* — free-text
- *Languages spoken* — free-text

**Party** (used to seed every new brief):

- *Travelers* — default headcount
- *With kids* — toggles the kid-friendly filter

**Defaults for transport + stays** — free-text fields that
prefill every new brief.

**Avoidances** — chips for high altitude / crowds / extreme heat
/ extreme cold / long drives, plus an "other" textarea. Soft —
Max weighs but doesn't refuse.

**Display:**

- *Distance* — metric / imperial
- *Temperature* — Celsius / Fahrenheit
- *Date format* — *Mon, Aug 5, 2026* (default) · *Mon, 5 Aug 2026*
  · *ISO (2026-08-05)* · *Locale (browser default)*
- *Currency* — three-letter code for cost displays

**API key** (advanced) — a personal Anthropic key for the 💬 Ask
chat. Most features ride on a shared server key once you're signed in.

Any field can be overridden per-trip in the brief; the override
sticks for that trip only.

### Cross-device sync + PWA

Sign in with email (magic link). Trips, preferences, AI chat
history, and trip share state sync across devices via the server.

Add Max to your home screen — the **⊕ Install** pill in the home
header walks you through it on whatever browser/OS you're on.
Once installed, Max runs as a standalone app with offline-first
caching of the static shell.

![Max installed as a PWA on iPhone home screen](images/15-pwa-install.png)
> *Capture: iPhone home screen with the Max app icon visible
> alongside other apps. Demonstrates "this is a real app, not just
> a bookmark."*

---

## What Max doesn't do (yet)

- **Real prices.** Max gives you starting points to research.
  Hotel prices, flight prices, restaurant prices — go to the
  actual provider.
- **Live bookings.** You book through the carrier or
  Booking.com; Max stores your confirmations.
- **Real-time collaboration.** Sharing is read-only today. Live
  collaborative editing is a future feature.
- **Photo upload.** Trip diary is text-only for now.

---

## Where the AI is + isn't

Max uses an LLM in four places, by design:

1. **Initial destination brainstorm** from your brief.
2. **Per-destination sight + restaurant generation** — candidate
   pools, not commitments.
3. **Booking-confirmation parsing** — turning a pasted email into
   structured fields.
4. **The 💬 Ask chat** — open-ended Q&A you initiate.

Everywhere else — the maps, the day-by-day arithmetic, drag-and-
drop, the calendar export, the booking storage, the cross-device
sync — is deterministic. Hit refresh and you get the same thing
back. The AI is for ideas; the structure is for you.

A reminder banner shows the first time you generate or browse an
AI-assisted plan: AI is fast and broad but can be wrong about
specifics (current opening hours, real walking distances, prices,
seasonal closures). Max generates the scaffold; you verify the
parts that matter to you.

---

## Getting started in 60 seconds

1. Open Max → **Create a plan**
2. Type a brief: "Two weeks in Iceland, late May, late spring,
   active outdoors, 4 adults"
3. Pick destinations from the candidates Max suggests, allocate
   nights, hit **Build the plan**
4. Browse the result. Drag, edit, swap. Add hotels you've already
   booked via 📋 Paste.
5. Use 💬 Ask whenever you'd otherwise be opening claude.ai in a
   new tab.
6. When you're happy, **Subscribe in calendar** so your phone is
   always in sync, and **Share** the read-only link with anyone
   you're traveling with.

That's the whole loop.

---

## Screenshot capture checklist

For each `images/NN-name.png` referenced above, capture once and
drop the file into `images/` next to this doc. The capture notes
under each image are guidance — adjust the framing to make it
look good.

| # | Filename | What to capture |
|---|---|---|
| 01 | `images/01-trip-overview.png` | Hero shot — trip view with today banner + destinations + weather |
| 02 | `images/02-picker-candidates.png` | Picker showing candidate destinations + brief at top |
| 03 | `images/03-home-screen.png` | Home screen with multiple trip cards |
| 04 | `images/04-today-banner.png` | Today banner cropped tight |
| 05 | `images/05-destination-tabs.png` | Destination view with tab strip + tab content |
| 06 | `images/06-itinerary-days.png` | Itinerary with 2-3 day cards including weather, hotel, sights |
| 07 | `images/07-map.png` | Per-dest map in satellite with sight + hotel pins |
| 08 | `images/08-day-weather-chips.png` | Close-up of weather chips on day headers |
| 09 | `images/09-paste-preview.png` | Booking parser preview modal with fields filled |
| 10 | `images/10-export-modal.png` | Export modal showing all three options |
| 11 | `images/11-apple-calendar.png` | Calendar app showing the subscribed trip events |
| 12 | `images/12-share-qr.png` | Share modal with URL + QR code |
| 13 | `images/13-chat.png` | Chat mid-conversation with context-aware reply |
| 14 | `images/14-chat-onboarding.png` | Chat-key onboarding modal at top |
| 15 | `images/15-pwa-install.png` | iPhone home screen with Max app icon |

Recommended capture flow on Mac: `⌘⇧4` then space + click on the
window/element you want, or `⌘⇧5` for the screen-recording panel
which also does still captures with options. Drop the resulting
PNGs into `~/Desktop/max/images/` with the filenames above.
