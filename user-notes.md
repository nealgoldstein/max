# User-facing implementation notes

What the people using Max actually see and how each surface works.
Updated v353.6.

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

## Preferences (pace + max big sights)

Two server-synced user prefs that follow the account across devices:

- **paceHours** — hours of sightseeing per day
- **sightsPerDay** — max big (2+ hour) sights per day

Set during the first-sign-in welcome modal. Re-edit any time:

- **Home screen header → Welcome** badge → opens the modal
- **⇄ Sync modal → ⚙ Preferences (pace, sights)** at the bottom
  — works from inside a trip view too

Numbers, not sliders (sliders were flaky on iOS touch). Per-trip
override available in the picker brief; if you leave the brief
fields at the pref's default value, the trip lives-tracks the
pref. If you change them per-trip, that override sticks.

## PWA install (Add Max as an app)

Surface: a blue **⊕ Install** pill in the home-screen header
(top right). Hidden once the app is detected running in standalone
mode (i.e. you've already installed and opened it that way).

Click behavior is platform-aware:

- **iPhone Safari** → instructions overlay walks through
  Share → Add to Home Screen → Add.
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
- **📅 Download calendar (.ics)** → builds a standard iCalendar
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
