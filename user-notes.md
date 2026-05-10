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
