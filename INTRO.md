# Max — The Existential Traveler

Max is a travel-planning app for people who do their own research and
want a working canvas to push back against — not a plug-and-play
itinerary handed down from on high.

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

## How a trip flows through Max

1. **You give Max a brief.** Where you'd like to go, roughly when,
   how long, and the *intent* (active outdoors, museums and food,
   hot springs and remote drives, 2-week family with grade-schoolers).
   The brief is open-ended; Max reads it the way a knowledgeable
   friend would.

2. **Max suggests candidate destinations.** Cities, towns, and
   regions that fit the brief, with a one-line rationale each.
   Pick a subset. Drop them in any order. Allocate nights.

   ![Destination picker with candidate cards](images/02-picker-candidates.png)
   > *Capture: picker view showing 4–8 candidate destination cards
   > with their rationale lines visible. Include the brief at the
   > top so the reader sees the cause-and-effect.*

3. **Max builds a starting itinerary.** Per-destination day-by-day
   plans with iconic sights pre-seeded across days, balanced
   against your pace preference (hours of sightseeing per day, max
   big sights per day).

4. **You adjust.** Drag items between days, add things you've
   researched, cross out things that don't appeal, tweak dates,
   add/remove destinations. Max recomputes the dates, refits the
   plan, surfaces conflicts.

5. **You book.** Paste your hotel/flight/restaurant/tour
   confirmations into the Tracker — Max extracts the details and
   files them under the right destination automatically.

6. **You arrive.** During the trip, the home screen shows where you
   are right now, what's planned for today, and the day-by-day
   weather. The map highlights your current destination in red.
   Calendar subscription keeps your phone calendar in sync with
   the trip.

7. **Trip ends.** Each destination has a "Notes from the road"
   section for what you actually did, what was worth it, what
   you'd skip.

### Shortcut: already have a list?

If you've already done your research and have a list of places
written down somewhere — your own notes, a friend's email, a
ChatGPT conversation — you can paste it in and skip the brief +
candidate-picking steps. Two entry points:

- **Home screen → Paste a list.** Sits next to *Start a new trip*.
  Opens a paste box. On Build, Max mints a stub trip, drops the
  pasted text into the trip's Research notes, and opens that modal.
  You review the list inline, then click **🪄 Make destinations
  from this list** to commit. The intermediate step gives you an
  editing pass before destinations actually land.
- **Home screen → Load from file.** Same flow, but the source is
  a `.txt` or `.md` file you have on disk. The file's content
  becomes the Research notes textarea; Max routes through the
  same review → commit path.
- **Research notes → 🪄 Make destinations from this list.** Inside
  any trip's Research notes modal, parses the current notes text
  and appends the destinations to the trip you already have open.
  Your notes stay put.

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
with the +/- spinner, change a stay to a see (or remove it) via
the role popover on each destination, drag the order, etc.

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

Two cross-device prefs Max uses to shape your trips:

- **Pace** — hours of sightseeing per day (default 4)
- **Max big sights per day** — how many 2+ hour sights you can
  stomach in a single day (default 3)

Set during the welcome flow. Re-edit anytime via the Welcome
button (home screen) or the ⚙ Preferences link in the Sync modal.
Per-trip override available in the brief.

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
