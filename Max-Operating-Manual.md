# Max: Operating Manual

> *Last updated: v359.60.34 — paired with the [Introduction](Max-An-Introduction.md) which covers the same surfaces conceptually.*

What the people using Max actually see and how each surface works.
This doc tracks the mechanical details (which menu opens what,
which dropdown has which options, where data is stored); the
Introduction tells the story of why each surface exists.

## Sign-in

Magic-link only — no password. Email delivery is **not currently
wired up** (Resend secret was deleted because it was hanging
worker requests). Until real email is set up, the sign-in modal
returns a clickable link directly inside the modal:

1. Tap **⇄ Sync** (home header) or **⇄** (trip view header).
2. Enter email, tap **Get sign-in link**.
3. The modal renders a big blue **Sign in →** button — that's
   the magic link. Tap it.
4. Lands back at the app, signed in.

Same flow on phone and laptop. The link is one-time-use, 15-minute TTL.

## Preferences

Open from **Settings → ⚙ Trip defaults…** in the trip-view menu
bar (or from the activity-place picker chrome's ⚙ button when
you're mid-research). The panel groups around 17 fields. Every
pref syncs across devices when you're signed in (MaxDB.prefs) and
can be overridden per-trip via the brief.

### Pace

| Field | Pref key | Default | Notes |
|---|---|---|---|
| Hours of sightseeing per day | `paceHours` | 6 | number, 2–10 |
| Max big sights per day | `sightsPerDay` | 2 | number, 1–6 (2+ hour anchors) |
| Pace mode | `paceMode` | `enough` | `loose` / `enough` / `notmuch` |
| Max drive time for a day trip | `dayTripHours` | 3 | hours, 1–6 |
| Day-trip radius | `dayTripRadiusKm` | 60 | km, 10–250 |

Numbers, not sliders (sliders were flaky on iOS touch).

### You

| Field | Pref key | Notes |
|---|---|---|
| Mobility | `mobility` | chip: fit / moderate / limited / elderly / other |
| Dietary | `dietary` | free-text |
| Languages | `languages` | free-text |

### Party

| Field | Pref key | Default | Notes |
|---|---|---|---|
| Travelers | `travelersCount` | 2 | number, 1–40 |
| With kids | `withKids` | false | toggles the kid-friendly filter |

### Defaults for new trips

| Field | Pref key | Notes |
|---|---|---|
| Transport | `transport` | free-text — prefills the brief |
| Accommodation | `accommodation` | free-text — prefills the brief |

### Avoidances

`avoidDefaults` is an object of `{altitude, crowds, heat, cold,
longDrives}` booleans; `avoidOtherDefaults` is a free-text
textarea. Soft preferences — Max weighs them but won't refuse to
plan around them.

### Display

| Field | Pref key | Values |
|---|---|---|
| Distance | `distanceUnits` | `metric` (default) / `imperial` |
| Temperature | `temperatureUnits` | `celsius` (default) / `fahrenheit` |
| Date format | `dateFormat` | `us-long` (default — `Mon, Aug 5, 2026`) · `intl-long` (`Mon, 5 Aug 2026`) · `iso` (`2026-08-05`) · `locale` (browser default) |
| Currency | `currency` | three-letter code, used in cost displays |

The `dateFormat` pref drives `fmtD()` which formats every date in
the trip view (per-leg dates, day labels, the trip-overview strip).
Old `us` pref values soft-migrate to `us-long` so existing accounts
keep working.

### API key

`maxApiKey` (localStorage only — never synced). The personal
Anthropic key for the 💬 Ask chat. Most features ride on the shared
server key when you're signed in; the BYOK fallback exists for
unsigned-in use and for chat (which always uses your own key so
cost is per-user, not per-account).

### Where prefs live

- **localStorage** while you're using the app (every read goes
  through `_defaultX()` helpers that hit `MaxDB.prefs.get`).
- **Server** when signed in — pushed via PATCH /user/prefs on
  every change (600ms debounce + exponential backoff, gives up
  after 6 consecutive failures). Pulled on sign-in + page load
  + tab focus.

### Per-trip overrides

Every field in the brief that matches a pref defaults to the
pref's current value. Leave the brief field at the default and
the trip lives-tracks the pref (changing the pref reflows the
trip). Change it per-trip and the override sticks — the trip
ignores future pref changes for that field.

## PWA install (Add Max as an app)

Surface: a blue **⊕ Install** pill in the home-screen header
(top right). Hidden once the app is detected running in standalone
mode (i.e. you've already installed and opened it that way).

**On iPhone, installing is required for notifications.** Apple
only delivers web push to apps that have been added to the home
screen — without the install, pre-trip reminders and during-trip
alerts can't reach the user at all. The install copy on the iOS
overlay calls this out in bold so the value is visible at the
moment the user is deciding whether to do it.

Click behavior is platform-aware:

- **iPhone Safari** → instructions overlay walks through
  Share → Add to Home Screen → Add. Footer flags the iOS-only
  notification requirement.
- **Mac Safari (Sonoma+)** → instructions for File → Add to Dock…
- **Mac/Windows Chrome / Edge** → fires the native install
  prompt directly. If the prompt isn't yet ready (Chrome's
  engagement heuristic hasn't satisfied), shows the address-bar
  install-icon instructions instead.
- **Anything else** → generic "use your browser's Add to Home
  Screen / Install App menu" fallback.

A `max-pwa-installed` localStorage flag is set the first time
standalone mode is detected, so the pill stays hidden in
regular-tab visits afterward. Reset with
`localStorage.removeItem('max-pwa-installed')`.

Updates flow the same as the web version — service worker
fetches the new bundle on next launch; usually current within
1–2 cold starts after a deploy.

## Duplicate a trip

- **Home screen trip card** → small **Copy** button (blue
  outline) between the card body and the ✕ delete.
- **Trip view header** → **Copy** button next to Save.

Click → confirm → deep-clones the trip envelope with a fresh
ID and " (copy)" name. Pushes to server (POST /trips). Original
unchanged.

## Share a trip (read-only link)

- **Trip view header → Share** button.
- Modal generates a public URL like
  `https://travelingwithmax.app/?share=<long-token>`.
- Sender can **Copy** the URL or **Revoke** the link.
- Recipient opens the URL → trip renders **read-only** with a
  yellow banner across the top:
  *"Shared trip — read-only. Sign in and tap Duplicate to copy
  this trip into your own account."*
- All edit affordances are hidden / disabled (drag, +/✕,
  Save, sync, search). Clicks no-op via guards.
- Recipient clicks **Duplicate to my account**:
  - If signed in → instant duplicate, page reloads to the new trip.
  - If signed out → prompted to sign in. Share token is
    stashed in localStorage so the sign-in round-trip
    (which loses the URL) doesn't drop it. After auth, the
    pending duplicate fires automatically.

Multiple active tokens per trip are allowed. Revoke nukes them
all at once.

## Trip-view map ("View larger →")

- **Desktop** → opens in a separate browser window so it can
  live on a second monitor. Auto-closes when trip data changes
  (with a 2-second toast warning).
- **Phone (≤ 700 px)** → opens as a full-screen DOM overlay
  inside the same page with a clear ✕ Close button. iOS Safari
  blocks popup windows in too many cases for the cross-window
  UX to be reliable.

## Picker map ("Show map" / "Open in new window")

Same pattern as the trip-view map:
- **Desktop** → side-by-side panel + popup window.
- **Phone** → list takes full width, floating 🗺 button at
  bottom-right opens a full-screen overlay.

## Export trip (PDF + .ics)

**Trip view header → Export** opens a small modal with three options:

- **📄 Print / Save as PDF** → opens a clean print-formatted view
  in a new window and triggers the print dialog. User picks
  "Save as PDF" in their browser's print dialog to make a file.
  Includes: trip name, date range, brief summary, every destination
  (place + label + lodging + day-by-day items).
- **📅 Download to calendar (.ics)** → builds a standard iCalendar
  file and downloads it. Contains:
  - One all-day event per destination (📍 prefix, location set
    to the city name)
  - One timed event per tracker/booking item with a date
    (✈ prefix, duration falls back to 3h for flights, 1h
    otherwise)
  - One timed event per planned item in the per-day itinerary
    (🎯 sight, 🍽 restaurant, 🚐 daytrip, 🏨 hotel, 📌 fallback).
    Items the user hasn't explicitly timed get a slot-based default
    (morning=09:00, afternoon=14:00, evening=19:00, day=10:00).
    Default duration: 1.5h for restaurants, 4h for day-trips, 1h
    for everything else.
  Drops into Apple Calendar, Google Calendar, Outlook, etc.
  via double-click. **One-shot:** re-export to update events;
  destinations you've since deleted in Max will linger in your
  calendar.
- **🔄 Subscribe in calendar (recommended)** → live link your
  calendar app polls automatically. Edits in Max — adding sights,
  changing dates, removing destinations — flow into your calendar
  on the next poll; deletes too. Re-uses the trip's existing share
  token (mints one if none exists), so the same capability covers
  both the read-only viewer and the calendar feed. Same event
  contents as the .ics download. Server endpoint:
  `https://api.travelingwithmax.app/share/<token>/calendar.ics`.

### Subscription setup, per calendar app

The Subscribe modal surfaces a `webcal://` URL plus a "📅 Subscribe
in calendar app" button that hands the URL to the OS handler.
Different apps need different setup:

- **Apple Calendar (Mac)** — click the Subscribe button → Calendar.app
  opens its subscription dialog → click Subscribe → done. The trip
  appears as a new calendar in the sidebar. By default Apple Calendar
  honors the `X-PUBLISHED-TTL:PT6H` hint Max sends and polls every
  6 hours. **For faster updates**, right-click the subscribed calendar →
  **Subscription Settings…** → **Auto-refresh** → set to **Every 15
  minutes** (or Every 5 minutes for near-real-time during active
  trip planning).
- **Apple Calendar (iPhone/iPad)** — open the modal in Safari on the
  phone, tap the Subscribe button → iOS prompts to add the calendar
  → confirm. Auto-refresh setting lives in Settings → Calendar →
  Accounts → the new subscription → Refresh Calendars.
- **Google Calendar** — `webcal://` doesn't work; use the `https://`
  form. Settings → Add calendar → From URL → paste the link with
  `webcal://` swapped for `https://`. Google polls on its own
  schedule (typically every several hours, sometimes up to 24h).
  No way for the user to speed it up — this is a Google limitation.
- **Outlook (desktop)** — Add calendar → Subscribe from web → paste
  the link. Right-click the calendar → Update Folder for manual
  refresh.

### Manual refresh during testing

`⌘R` in Calendar.app refreshes all subscriptions on the spot. Useful
when you've just made an edit in Max and want to see the change
immediately without waiting for the auto-poll.

Note: the server caches the .ics response at the Cloudflare edge for
60 seconds. So after editing in Max, wait ~2 seconds for auto-save
to land server-side, plus up to 60 seconds for any cached response
to expire, then ⌘R to see the change. For curl-based debugging,
add a `?nocache=$(date +%s)` query param to bypass the edge cache.

The .ics download and the printable PDF work entirely client-side.
The subscription URL hits the server (it has to, so calendar apps
can refetch on their own schedule).

## Weather per destination

Each destination card in the trip view shows a small weather strip
below the dates row (when the dest has lat/lng + dateFrom):

- **Within 16 days from today** → forecast: "🌤️ Forecast 22°/14°C
  · 30% rain" (averages over the dest's date range)
- **Beyond 16 days** → climate normal: "🌤️ Typical 18°/9°C · 35%
  rainy days (climate avg)" — calculated from the same calendar
  month over the past 5 years
- **No coords / no dates / fetch fails** → strip is silently absent

Source: Open-Meteo (free, no API key). Cached locally — forecast
6h TTL, climate 30 days — so re-renders don't re-fetch every time.

In addition to the dest-card strip, **each per-day card** in the
itinerary shows a tiny weather chip inline next to the day number:
icon + high/low (e.g. "🌤️ 18°/9°"), plus a blue "30% rain"
indicator when the precipitation probability is ≥30%. Day chips only
appear inside the 16-day forecast horizon — beyond that the climate
average doesn't vary day-to-day, so per-day chips would just be
noise. Same Open-Meteo cache as the dest strip, so adding day chips
costs zero extra API calls.

The same chip also appears in two more places when a trip is
in-progress (status.phase === 'during'):

- **Today banner** at the top of the trip view ("📍 You're on day X
  of Y · In Reykjavik · May 10 · 🌤️ 18°/9° · 45 days left after
  today"). Inline with the location and day-count, so it's the first
  thing the traveler sees on opening the app each morning.
- **Today widget** (the blue now/next panel that shows up only
  inside the current day's card): "TODAY · 🌤️ 18°/9°" row at the
  top of the panel, alongside the now/next/later breakdown.

## Paste a confirmation (booking parser)

**Trip-view header → 📋 Paste**. Click → big textarea → paste the
booking email or web confirmation (any length) → **Parse →**.

The button lives at the trip level rather than per-destination
because Max routes the booking to the right destination automatically
based on the parsed address + dates. There's no point making the
user click from a specific destination's tab when the parser figures
out where it belongs anyway.

Max calls the LLM with a strict JSON-extraction prompt and pulls
out:

- **Type** — flight, hotel, train, bus, ferry, restaurant, tour, ticket
- Carrier / operator / hotel name
- Dates and times (24h, converted from AM/PM if needed)
- From/to (transport) or address (hotel/restaurant)
- Confirmation number, price, currency, booking URL, notes

The next modal previews every field in editable inputs — the user
can correct anything the LLM got wrong before saving. The **Type**
dropdown is editable too, in case the LLM guessed wrong.

For **transport** (flight/train/bus/ferry), an extra "This trip is
arriving at … / departing from …" radio appears. Default is picked
by date proximity — closer to dest.dateFrom → arrival, closer to
dest.dateTo → departure. The user can override.

Where saved bookings land:

- **Hotel** → `dest.hotelBookings` (shows in Stay tab + Tracker
  Bookings + day-card check-in/out chips)
- **Restaurant / tour / ticket** → `dest.generalBookings` (shows in
  Tracker Activities)
- **Flight / train / bus / ferry** → `leg.bookings` on the chosen
  arrival or departure leg (shows in Routing tab + auto-injected
  arrival/departure chip on the appropriate day card)

All bookings get `source: "paste"` so we can later distinguish
manually-entered vs LLM-extracted records. If the LLM returns
`type: "unknown"` or extracts no useful fields, the user gets a
"couldn't pull useful fields out — try a clearer paste" message
and the textarea stays put so they can edit and retry.

**Destination verification.** The preview modal shows a Destination
dropdown listing every destination on the trip. On extraction, Max
scores each destination by how well the booking's address + dates
match (place-name token overlap and date range overlap), and
pre-selects the best match. Three cases:

- **Best match equals where you clicked Paste** — no warning, the
  dropdown just confirms the implicit choice.
- **Best match is a different destination** — blue banner: "Routed
  to <dest>. The booking matches it better than <where you clicked>."
  Save lands at the new destination.
- **No destination matches at all** (booking's dates and location
  don't fit any dest on this trip) — yellow warning: "Heads up: the
  booking doesn't match any destination on this trip. Double-check
  the destination dropdown before saving."

The user can override the dropdown freely; the warning updates live
as they change it.

**Cancellation policy:** the parser captures the deadline DATE only.
We deliberately don't capture deadline times — property-local vs
user-local time zones, ambiguous AM/PM in raw confirmation text,
and the rarity of cases where minute-precision actually mattered
made the time field more confusing than useful. Same applies to the
manual booking forms (`mkCancelField`). The `cancelDeadlineTime`
field stays in the data shape so already-saved bookings with times
still display correctly, but new entries always set it to null.

## Cross-device sync

- **Trips** sync via POST/PUT /trips on every change (1.5s debounce).
  Pulled on page load + every 60s + on tab focus.
- **Prefs** sync via PATCH /user/prefs on every change (600ms
  debounce + exponential backoff on failure, gives up after 6
  consecutive failures). Pulled on sign-in + page load + tab focus.
- **Per-trip UI state** (banner expanded, research panels
  collapsed) is currently device-local. Migration to follow the
  trip across devices is task #86.

## Things that stay device-local on purpose

- API key (if user pastes their own — preferred path is the
  signed-in proxy)
- Map style choice (satellite vs streets)
- Resize handles (panel widths)
- "max-onboarded" flag (welcome modal is per-device)
- "max-pwa-installed" flag (install state per-device)

## Trip-view menu bar

The trip view's top chrome runs as a Mac-style menu bar with four
top-level entries:

- **← Home** (top-level since v359.60.34, was buried in File before) —
  one-click return to the trips list.
- **File** — Save now · Copy this trip · Export (PDF, calendar…) ·
  📋 Paste booking confirmation · ↗ Share trip · — · ← All trips
  (duplicates the top-level Home for muscle memory).
- **Edit** — ✎ Edit trip inputs… · 📅 Trip dates… (v359.60.30) ·
  🔬 Open research (v359.60.29 — was "Edit destinations") · — ·
  🔍 Search this trip · 💬 Ask Max…
- **Settings** — ⚙ Trip defaults… · — · 🔑 Set API key…

Hovering across menu labels switches focus like macOS; clicking
outside any dropdown dismisses it.

## Open research (from the trip view)

**Edit → 🔬 Open research** routes through `_reopenPickerAny()`,
which picks the right reopener based on what data the trip carries:

- Trip has `mdcItems` (Choreograph picker pipeline) → opens the
  activity-place picker via `reopenPickerForEdit()`.
- Trip has `_tb.placeActivities` already in memory (mid-review from
  a paste/file import) → re-renders the activity-place picker on
  the existing scratch state.
- Trip has `trip.candidates` (legacy candidate-explorer trips) →
  opens that overlay via `reopenCandidateExplorer()`.
- None of the above → friendly alert.

The research overlay reparents to `<body>` so it sits on top of the
trip view without z-index fights.

## Unified stop popover

Click any pin on the trip-overview map (or any role-indicator on a
destination card) — overnight pins, day-trip pins, wayside pins,
and grey "see" pins all open the same dialog. Replaces three older
popovers (`_openTripDestRolePopover`, `_openTripDayTripPopover`,
`_openTripWaysidePopover`) with one entry point: `_openTripStopPopover(ctx)`.

The dialog shows the same five options every time. The current
role is marked *(current)* and visually highlighted:

| Role | What it does on Apply |
|---|---|
| Overnight stay | Promote to a real destination (`_convertSeeToOvernight` if current was See; ungroup helpers if it was day-trip/wayside) |
| Day trip | Splice into a day-trip route from a chosen hub. *New day trip* mints a route via `convertDestToDayTrip`; *Add to* appends to an existing route via `addDestToExistingDayTripRoute` |
| Wayside | Splice into a transit route as a stop. *Natural* route = the prev→next leg of the source destination; other routes are listed too via `convertDestToWaysideOnRoute` |
| See | Drop the role but keep the place on the trip with 0 nights — grey pin |
| Remove from trip | Drop the place entirely (it stays in research / candidates) |

### Day-trip sub-fields

When *Day trip* is the picked role, three nested fields appear:

- **From** — hub dropdown (every overnight destination on the trip).
- **○ New day trip** vs **○ Add to** — radio. *Add to* enables a
  dropdown listing every day-trip route already on the trip
  (with "(from X)" labels). Picking an "Add to" route auto-syncs
  the From dropdown to that route's hub.
- **Insert** — position dropdown. *Smart (closest neighbor)* is the
  default; explicit positions are *At the start*, *After ⟨stopᵢ⟩*
  for each existing stop, and *At the end*.

Both inner radios and the dropdowns auto-check the outer *Day trip*
radio when interacted with, so Apply reads the right transition
even when the user only touches the nested controls.

### Wayside sub-field

When *Wayside* is the picked role, a single dropdown lists every
transit route the place can sit on:

- The synthetic *natural* prev→next route (the result of merging the
  source destination's two neighbouring legs) — selected by default
  when present.
- Every other transit route on the trip, except routes where the
  source destination is itself an endpoint (you can't be "along the
  way" to yourself).

Both options are mapped via `convertDestToWaysideOnRoute(destId,
routeId)`; the natural route falls back to `convertDestToWayside`
which collapses the source's own neighboring legs.

## Multi-stop day trips

A day-trip route's `route.planItems[]` holds an ordered list of
stops. The map renders the loop as one polyline: `hub → stop₁ →
stop₂ → … → hub`. Stops auto-sort by distance from the hub on
new-route creation; subsequent inserts respect either explicit
position or smart placement, never re-sorting the existing order
(that was clobbering manual order pre-v359.60.31).

### Adding a stop to an existing loop

`addDestToExistingDayTripRoute(destId, routeId, opts)` accepts:

- `opts.afterStopId` — `"_start"` / `"_end"` / `<stopId>` /
  null|undefined for smart placement.
- Smart placement runs `_smartInsertIndexInDayTripRoute()` —
  cheapest-insertion: for each gap, compute
  `dist(A, new) + dist(new, B) - dist(A, B)`; insert into the gap
  with the smallest delta. Equivalent to the classic TSP
  cheapest-insertion heuristic.

The hub absorbs the source's nights as the destination is removed
from `trip.destinations`. Dates cascade trip-wide via
`_ftRecomputeTripDates`.

### Tooltip

Single-stop route → *"Diamond Beach · day trip from Skaftafell"*.
Multi-stop → *"Diamond Beach · stop on the Skaftafell loop (with
Fjallsárlón, Jökulsárlón)"*. The "with" list comes from
`dtStops` (the array used for the polyline render, sorted by hub
distance) minus the current stop.

## Trip dates editor

**Edit → 📅 Trip dates…** OR click the dates strip at the top of
the trip view (a small ✎ icon at the right edge of the bold date
range signals the affordance). Opens `_openTripDatesEditor()`.

Modal contents:

- *Start* (date input) — prefilled with `trip.destinations[0].dateFrom`.
- *End* (date input) — prefilled with `trip.destinations[last].dateTo`.
- Live preview line under the inputs:
  - "*N* days · *M* nights"
  - "shifted earlier/later by *X* days" (start changed)
  - "extended/shortened by *Y* nights (scaled across destinations)" (end changed)
  - "no change" when neither moved.
- Apply / Cancel buttons.

### Apply rules

- **Start only changed** → first destination anchored at the new
  date; every subsequent destination cascades via
  `_ftRecomputeTripDates`. Nights per destination unchanged.
- **End only changed** → total nights distributed proportionally
  across destinations with `nights > 0` (0-night "see" destinations
  stay at 0). Uses largest-remainder rounding so the final sum
  equals the new target exactly. Overnight destinations never drop
  below 1 night.
- **Both changed** → anchor at new start, then proportional scale
  to fit the new total.

After the per-destination nights are settled,
`_ftRecomputeTripDates` walks the trip and rewrites every
`dateFrom`/`dateTo`. `_ftResizeDestDays` resizes each destination's
`days[]` array. `trip.brief.startDate` / `duration` / `endDate`
are mirrored so re-edits stay consistent. Fires
`_emitTripMutation({reason:"tripDatesEdit"})`.

## Paste / load an existing list

Routes both entry points (Home → *Paste a list* and Home → *Load
from file*) through `_buildPickerFromPastedList(parseResult, rawText)`:

1. **Parse** — `parsePlacesList(text)` reads the file/textarea.
   Format details in [Max-An-Introduction.md](Max-An-Introduction.md#shortcut-already-have-a-list).
2. **Mint stub trip** — `trip = { destinations: [], brief: {region, when, duration, …} }`,
   pushed to the trips index and persisted.
3. **Normalize the region** — `_tb.region` is set from
   `parseResult.region`, but if that's a multi-word string like
   "Iceland Road Trip" the helper does a token-lookup against
   `_coarseGeocode` and substitutes the matching country
   ("iceland"). This means the picker LLM prompt reads "A traveler
   wants to go to Iceland" instead of the nonsensical raw region.
4. **Seed `_tb.placeContext`** — the user's parsed places get
   formatted into a "MANDATORY PLACE LIST" block prepended to the
   prompt: every listed place MUST appear in the LLM's output as
   a `requiredPlace` under at least one activity.
5. **Open the activity-place picker** — `enterApp()` lands on the
   trip view, then `renderActivityPicker()` shows the picker
   overlay with a loading spinner.
6. **LLM generation** — `generateActivitiesForPlace()` fires the
   same prompt the regular Choreograph flow uses; LLM returns
   themed activity items. `_tb.placeActivities` is populated.
7. **Post-pass: `_applyPastedListNights`** — overrides
   `requiredPlace.nights` with the user-specified value for any
   place the user gave explicit nights for.
8. **Post-pass: `_backstopPastedListPlaces`** — any user-listed
   place the LLM dropped (despite the mandatory clause) gets
   injected as a stub activity under "Other places to consider."
   Matching uses **token-subset**: a user place is covered if its
   normalized tokens are a subset of some covered name's tokens.
   This treats "Snæfellsnes" (user) and "Snæfellsnes Peninsula"
   (LLM) as the same place, so no duplicate stub is created.
9. **User reviews** in the activity-place picker, ticks/unticks
   activities and places, then clicks *Choreograph my trip →* to
   commit destinations.

If the user bails before clicking Choreograph, the stub trip is
already in the trips index — `_reopenPickerAny()` (Edit → Open
research) re-mounts the picker on the same `_tb.placeActivities`
so the work isn't lost.
