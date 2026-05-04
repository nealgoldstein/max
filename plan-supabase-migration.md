# Max Supabase migration — scoped plan

**Goal:** Sync trip data between Neal's laptop and phone so the trip
page stays in sync. Mobile is an *execution* surface, not a planning
surface — a companion for use while traveling, not a place to build
trips. Planning stays on desktop.

**Why Supabase:** Cheapest sane path to "deployed and working."
Auth + Postgres + realtime in one managed service. Free tier covers
early stage. Standard JS client library that drops into Max with
minimal change. Postgres is portable if you ever migrate off.

---

## 1. Product framing

### Desktop (planning, current Max)
- Brief / picker / choreographer
- Edit destinations
- × Remove, Edit dates, Logistics
- All the FN-round work shipped to date

### Mobile (execution, NEW surface)
**What it has:**
- Today/this week dashboard — where you are, what's planned, what's next
- Itinerary tab in current-day focus mode (today expanded, others collapsed)
- Tracker — mark done, log spend, address provider-action items
- Bookings reference (read-only — hotel addresses, conf numbers, URLs)
- Cancellation deadlines (urgent surface — "your hotel cancels by 6pm today")
- Maps with "you are here" + walking distances to next item
- Notes (free-text against a day or destination)
- Day-trip sights inline if a day-trip is placed today

**What it doesn't have:**
- Brief / picker / choreographer
- × Remove destination, Edit dates, Edit destinations
- Add destination, drag-reorder destinations
- Buffer-night decisions, day-trip make/cancel
- Anything that mutates trip *structure*

The mobile UI is mostly **read + small writes** (mark done, add note,
log spend). That's important — it shrinks the sync surface and the
conflict-resolution complexity dramatically.

---

## 2. Database schema

Three tables, plus Supabase Auth (managed):

```sql
-- Supabase auth.users (managed by Supabase, just reference the id)

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text,
  data jsonb not null,          -- whole trip object, current shape
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index trips_user_id_idx on public.trips(user_id);
create index trips_updated_at_idx on public.trips(updated_at);

-- Row-level security: user can only read/write their own trips.
alter table public.trips enable row level security;
create policy "users own their trips"
  on public.trips for all
  using (user_id = auth.uid());
```

That's it for trips. The current `trip` object in Max is a single JS
object — store it as JSONB, no schema migration when fields change.

**Optional table for granular events (logged actions, expenses):**

```sql
create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips on delete cascade not null,
  user_id uuid references auth.users not null,
  type text not null,           -- 'spend', 'mark_done', 'note', etc.
  data jsonb not null,
  created_at timestamptz not null default now()
);
```

Probably not needed in v1 — just store everything in `trips.data`.
Add this if/when you want per-event undo or audit.

---

## 3. Sync model

**Last-write-wins on whole-trip JSON, keyed on `updated_at`.**

- On every `autoSave()`: write to localStorage AND debounced upsert to
  Supabase. localStorage is the offline-safe fallback.
- On app load: if signed in, fetch user's trips from Supabase. If
  Supabase's `updated_at` is newer than localStorage's, use Supabase's
  data and overwrite localStorage. Otherwise use localStorage.
- On window focus / tab visible: re-fetch trips from Supabase. If a
  newer version came in (other device edited), apply it.
- On Supabase realtime subscription: same as focus — apply newer
  versions live.

**Conflict resolution:**

Last-write-wins is fine for a single-user travel planner because
edits are bursty, not collaborative. The pathological case (laptop
saves at 3:00pm, phone saves at 3:00:01pm without seeing the laptop's
change) is rare enough to live with.

**Mitigations to make it less rare:**
- Phone only allows execution writes (mark done, add note, log spend) —
  these mutations are additive within the JSON, not full-doc
  replacements. Conflict surface is small.
- Before any mutation, pull latest from Supabase (sub-second on a
  good connection). Apply the mutation to that fresh state, then push.

**Offline editing:**

- Phone in airplane mode → mutations queue in localStorage as a
  pending-changes list.
- On reconnect → replay the queue against fresh server state.
- If a queued change conflicts with server state (e.g. you marked
  Hotel X done offline; meanwhile laptop deleted that hotel) — drop
  the change with a toast: "Your offline change to {item} couldn't
  apply because the item was deleted. Reload to see latest."

This is the trickiest part. Don't over-engineer in v1. Most offline
edits will succeed because the conflict surface is small.

---

## 4. Code changes in Max

### Phase 1 — Auth (3–4 days)

1. Add Supabase JS client (`@supabase/supabase-js`) via CDN or
   bundled.
2. Initialize client with project URL + anon key (public-safe).
3. Build a sign-in screen — email magic link is cheapest. Google /
   Apple OAuth if you want fewer steps for users.
4. Add session check to home screen — if not signed in, show sign-in;
   if signed in, show home as today.
5. Sign-out button somewhere in settings or footer.

### Phase 2 — Storage migration (1 week)

1. Wrap `localSave()` to ALSO write to Supabase (debounced).
2. Wrap `loadTrips()` (or wherever trips are read) to fetch from
   Supabase on first load if signed in, populate localStorage.
3. Add network-aware retry logic — failed writes queue, retry on
   reconnect.
4. Realtime subscription on `trips` table — apply incoming updates
   if `updated_at` > local.

### Phase 3 — Mobile responsive layout (1 week)

1. Detect viewport width; below 700px treat as mobile.
2. Mobile shell: bottom nav with 4–5 tabs (Today / Map / Bookings /
   Notes / Settings).
3. **Today** = current-day Itinerary expanded, rest collapsed.
   Auto-detects current date against trip's calendar; falls back to
   first day if before trip starts.
4. **Map** = full-screen leaflet, current-day pins highlighted, "you
   are here" via geolocation.
5. **Bookings** = grouped list (hotels / transport / activities) for
   the current dest, read-only with conf #s and URLs surfaced.
6. **Notes** = simple list with date-stamped free-text entries.
7. **Settings** = sign in/out, sync status, trip switcher.

Strip out (or hide on mobile) all the planning chrome: × Remove,
Edit destinations, the picker, etc.

### Phase 4 — Execution mode polish (1 week)

1. Mark-done on day items via swipe (mobile gesture).
2. Long-press a sight → quick add a note.
3. Floating "log expense" button if `trackSpending` is on.
4. Provider-action checklist surfaced as a tappable list.
5. Cancellation-deadline urgency banner ("Cancel by 6pm today").

### Phase 5 — Real-device testing + PWA wrap (2–3 days)

1. Add `manifest.json` (already partially exists) — name, icons,
   theme colors, start_url.
2. Service worker (already exists, max-vXXX) update — handle the
   sync-state caching properly.
3. iOS Safari + Android Chrome install testing.
4. Offline edit + reconnect testing.

### Phase 6 — LLM proxy decision (parallel to Phase 1–2)

Currently Max calls Anthropic API directly with a user-provided key.
If you want non-technical users (likely, for a real product), the
key has to live server-side, not in the browser.

**Cheapest option:** Supabase Edge Function as an LLM proxy.

```
client → POST /functions/v1/llm
       → Edge Function holds Anthropic key
       → forwards to api.anthropic.com
       → streams response back to client
```

Adds maybe a day of work. Required for any non-Neal user.

**Total estimated effort:** 4–5 weeks of focused work. Less if you cut
phase 4 polish; more if mobile responsive design needs more iteration.

---

## 5. What to do BEFORE migrating

These are cheap and they reduce the migration's risk:

1. **Iceland dogfood first.** Use Max for a real trip you're planning,
   on the current localStorage version. Find what actually matters
   on the trail vs at the desk.
2. **Static-deploy to Netlify for early testers.** No backend, no
   accounts, but they can hit a URL and use it. Each tester brings
   their own Anthropic key. ~30 minutes of setup.
3. **Inventory the trip object's shape.** Look at what's in `trip`
   today — dest objects, days, items, bookings, pendingActions,
   trackerItems, etc. Anything that's per-device only (UI state,
   _activeDmSection) shouldn't sync. Audit before migrating so the
   sync layer doesn't accidentally clobber UI state across devices.
4. **Decide auth UX:** magic link only, Google only, or both. Magic
   link is simpler to build; Google is faster for users.

---

## 6. What to defer past v1

- Multi-user trips (sharing with travel companions) — adds an `acl`
  table and changes the sync model.
- Real-time co-edit (you and your partner editing simultaneously) —
  adds CRDT or operational transform. Big lift. Don't.
- Granular event sync (per-mutation rather than whole-doc). Maybe
  if conflict surface grows.
- Native iOS/Android — PWA is enough for a long time.

---

## 7. Cost projection

**Supabase free tier:**
- 500 MB database — fits ~5,000 trips easily
- 2 GB egress/month — fits ~50k trip loads
- 50k monthly active users on auth
- Real-time: 2 concurrent connections (low for prod)

**When you'd need to pay ($25/mo Pro):**
- Real-time with > 2 concurrent connections
- More storage if trips get big
- Better support
- Branching for staging environments

**Anthropic API costs (LLM proxy):**
- Sonnet at ~$3/M input + $15/M output tokens
- Average trip build = ~50k tokens = ~$0.30 per trip
- 100 trips/month = ~$30
- This is the real cost you'd watch.

**Domain + email:**
- Custom domain for the app: ~$15/yr
- Transactional email (magic links): Supabase handles via Resend or
  SendGrid integration; free tier covers early stage.

---

## 8. Recommended sequencing

1. Iceland dogfood (this month) — current localStorage version.
2. Static deploy to Netlify (1 hr) — for any beta testers, no auth.
3. Decide whether to migrate based on dogfood findings.
4. If yes: Phase 1 (auth) → Phase 2 (storage migration) → run with
   it personally for a couple weeks → Phase 3 (mobile UI) → Phase 4
   (polish) → Phase 5 (PWA / device testing).
5. Phase 6 (LLM proxy) anytime after Phase 1 — needed before any
   non-Neal user.

The most important thing: **don't build the backend before you've
felt the trip page on a phone for a real trip.** What you'd build
today is informed by guesses. What you'd build after Iceland is
informed by friction. The architecture choice (whole-doc sync vs
event-stream sync, magic-link vs OAuth, etc.) all gets clearer with
that experience.
