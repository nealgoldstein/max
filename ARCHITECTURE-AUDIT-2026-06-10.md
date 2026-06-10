# Architecture audit — 2026-06-10

Deep sweep for latent architectural problems, prompted by the recurring pattern
this session: the same flaw class showing up in multiple places. Four parallel
read-only passes (duplicate implementations; render paths & god-functions;
sources of truth & keys; error-handling & lifecycle). Findings deduped and
prioritized. All references are `file:line` at time of writing.

**The meta-pattern.** Nearly everything below is one of three shapes:
1. A **transient/background error destroys persistent state** (no distinction
   between "retry me" — timeout/429/500/529 — and "I'm genuinely broken" — auth).
2. **Two authorities for one decision** (a value rendered or derived two ways
   that can drift).
3. **Identifier keys that disagree** (one writer keys by canonical/alias-aware
   identity, a reader by raw lowercase).

Two correct reference patterns already exist in the code — reuse them:
- **Consecutive-failure counter that resets on success** (`index.html:3333`,
  `_maxProxy401Count`).
- **Backoff window with auto-expiry; don't poison the cache** (weather PD.332,
  `index.html:43325`).

---

## TIER 1 — Transient error destroys persistent state (act first)

The 401-destroys-credential bug we fixed three times (PD.421/424/429) is a
family, and several members are still live — some with a blast radius of **local
trip data**, not just a credential.

- **T1.1 — `signOut()` on a 2nd LLM-proxy 401 wipes ALL local trips.** HIGH.
  `index.html:3337` calls `MaxSync.signOut()` on the 2nd consecutive proxy 401;
  `signOut` → `_wipeLocalTripCache()` (`sync.js:339-355, 415-423`) deletes every
  `max-trip-*` key + `max-trips-index`. So two misclassified/overload-as-401
  responses from the **LLM proxy** destroy local trips, including any not yet
  pushed. Fix: clear the token + prompt re-sign-in, but never wipe local trips
  on an auth blip.

- **T1.2 — Background sync poll still nukes the token on one 401.** HIGH.
  PD.429 set `_bgAuthTolerant` only inside `_bootPull`. The 60s poll +
  visibility-change pull (`_maybePull`, `sync.js:1605-1622`) call
  `pullAll()`/`pullPrefs()` without it, so `request` (`sync.js:186`) still
  `setToken(null)` on a transient 401 → signed out mid-session. No call site
  passes `tolerateAuth:true`. Fix: wrap `_maybePull` in the tolerant window
  (or give `request` a consecutive-401 counter).

- **T1.3 — Explicit sync hard-fails on the FIRST 401** (`sync.js:186-193`) —
  inconsistent with callMax's 2-strikes counter. MED. Port the counter.

- **T1.4 — OSRM failure persists a permanent `"failed"` sentinel.** HIGH.
  `index.html:47009/47027` stamps `trip._osrmSegments[key]="failed"` on any OSRM
  error and `_ensureTripRoutesCached` then `localSave()`s it (`:47035`). The
  endpoint is the **free public OSRM demo server** (429s under load). One rate
  burst permanently degrades that trip's routes to straight-lines-across-water,
  surviving reloads, never retried. Fix: store transient failures with a
  TTL/attempt-count (or don't persist), mirroring the weather 30-min pattern.

- **T1.5 — Pull-vs-autosave race, no shared mutex.** HIGH.
  `_saveInFlight` guards save-vs-save only; `pullAll`→`writeRaw` (`sync.js:1018`)
  never checks it and `_doSave` never checks a pull flag. During the 1.5s debounce
  + in-flight PUT, a poll can `writeRaw` the server body over `global.trip`
  mid-edit. The PD.334 rev check mitigates but doesn't eliminate it. Fix: one sync
  lock — defer adopting a pulled body for the current trip while a save is in
  flight.

- **T1.6 — `callMax` has no 429/529/overload backoff.** MED.
  `index.html:3306/3375` throws overload (`429`/`529`/`overloaded_error`)
  immediately, same as a permanent error; the downstream generation loop tags
  network errors and explicitly *doesn't* retry them (`:17435`), trusting a
  callMax retry that doesn't exist. Fix: bounded exponential backoff for
  overload, distinct from the 401 path.

- **T1.7 — Nominatim circuit breaker latches permanently on first error.** MED.
  `index.html:42725` sets `_nominatimBlocked=true` on the first 429/CORS/network
  error and never resets for the session — one burst disables all geocoding. Fix:
  backoff-with-expiry, not a sticky boolean.

- **T1.8 — `publishTrip` ignores its write return.** MED.
  `engine-picker.js:4342` doesn't check `MaxDB.trip.writeRaw`'s boolean;
  `localSave` does and alerts on failure. The most valuable write in the app can
  fail silently and lose the just-built trip. Fix: check + surface like localSave.

---

## TIER 2 — Active drift (same thing decided/painted two ways)

- **T2.1 — Second role-COLOR authority, already disagreeing.** HIGH.
  `pinColorForRole` (`engine-picker.js:148`, used live by the picker hero map at
  `picker-ui.js:369`) paints **daytrip `#7c3aed`, onway teal `#0891b2`, see gray
  `#9ca3af`** — different from `MaxMapPin.style` (daytrip light-purple, onway
  light-purple, see green). Same role, different colors on picker vs trip map.
  Plus a 4th literal at `trip-ui.js:3802` (badge). Fix: derive fill from
  `MaxMapPin.style(role).fill`; delete `pinColorForRole`.

- **T2.2 — Two distance formulas feed the SAME day-trip decision.** HIGH.
  True haversine (`MaxEngineTrip.haversineKm`) vs `*111` equirectangular copies
  (`engine-picker.js:2856/4628`, `index.html:19800/26829`). The two near-identical
  day-trip clustering passes (`19800`, `26829`) gate on the 60km threshold with a
  metric that disagrees with the canonical one. Fix: route all through
  `haversineKm`.

- **T2.3 — `MaxPlaceKey.normalize` is alias-BLIND while every writer is
  alias-aware.** HIGH. `index.html:26791` → `_normPlaceName` (no alias resolve),
  but `_pmKey`/`_pmMetaKey`/`max-data._normKey` all resolve learned aliases.
  `_pmDeriveRole` looks up candidates via `MaxPlaceKey.normalize`
  (`:27884-27892`) → after a learned rename the role cascade can't find the
  candidate the writer stored → role reverts to default. Fix: make
  `MaxPlaceKey.normalize` delegate to `_pmKey` (one line) — highest-leverage.

- **T2.4 — `_pmCoord` raw-key geocode (twin of the PD.401S bug).** MED-HIGH.
  `index.html:30582` reads `_coarseGeocode` by raw `toLowerCase()` only; the pin
  render uses canonical `_pmKey` with a raw fallback + mirror (PD.401S). Accented
  names get wrong/no coords on spur/day-trip passes that use `_pmCoord`. Fix: key
  by `_pmKey` with the same fallback.

- **T2.5 — `pinByKey` (`_normPlaceName`, alias-blind) vs `_pinSeen` (`_pmKey`,
  alias-aware) in ONE render.** MED. `index.html:47168` vs `48114/48122/48153`.
  After a learned alias, a committed/considered sight can fail to dedupe against
  its own destination pin. Fix: key both by `_pmKey`.

- **T2.6 — "View larger" overlay numbered dest pins hand-roll color.** MED.
  `index.html:29885` (`isActive?"#c44":(_isZeroNight?"#888":"#1a5fa8")`) — the
  only pins whose color isn't owned by `MaxMapPin`; documented "the larger trip
  map does not agree with the smaller" (`:29661`). This is task #20. Fix: route
  the overlay dest loop through `MaxMapPin.draw` (same document, trivial).

- **T2.7 — Third notes store survives.** MED. Per-sight `s.research`
  (`trip-ui.js:50/95`, the 📚 panel) was NOT migrated into the unified
  `placeMeta.notes` (PD.416). Same place, two notes, neither aware. Fix: point
  `_buildSightResearchPanel` at `_pmGet/SetPlaceNotes` with a one-time seed.

- **T2.8 — `_grpIsStay` override discards the computed role.** MED.
  `index.html:47393` computes `_pmDeriveRole` then `:47402` overrides with a
  separate `_pmIsStayCandidate||nights>0` (PD.420 over PD.419). Two authorities
  can still disagree for a listed overnight with nights:0. Fix: put the
  section-beats-nights rule inside the cascade; use the returned role.

- **T2.9 — `toggleDestKeep` keep-scan uses raw `toLowerCase()`.**
  `index.html:24980/25021/25034` — mis-detects "anyKept" for accented/suffixed
  names, then writes the wrong role. Fix: `_pmKey`.

- **T2.10 — `getRejectedSights` reads a different store than considered/kept.**
  `max-data.js:398` reads legacy `dest.suggestions[]._rejected` while
  considered/committed derive from `requiredPlaces`. Post-refactor rejections can
  be invisible. Fix: derive from `placeActivities` like `consideredPlaceKeys`.

---

## TIER 3 — Structural debt (keeps generating bugs)

- **T3.1 — Double-render on every mutation.** HIGH-value, cheap.
  `_emitTripMutation` (`index.html:45691`) emits BOTH `tripChange` and
  `mapDataChange`; both subscribers call the 1245-line `updateMainMap`
  (`:45546`, `:45549`). So it runs **twice** per mutation. Fix: let only
  `mapDataChange` own the map; ensure nights-flip mutations emit it.

- **T3.2 — 125 direct `drawTripMode/drawDestMode/updateMainMap` calls** bypass
  the event bus (52/35/38). The bus (PD.333) is advisory, not authoritative; the
  defensive `if(typeof draw...==="function")` sprinkles are a symptom. Fix: funnel
  through one `requestTripRepaint()`; add a contract-check rule banning direct
  calls outside the navigation chokepoints.

- **T3.3 — Dead schema migrator + two version systems on one field.** HIGH.
  `migration.js` `migrateTripShape`/`needsMigration` (schema v4, the real
  route-segment migration) is **never called** — a comment claims db.js calls it
  (`index.html:402`) but `MaxDB.tripRead` just JSON.parses. Meanwhile
  `tripstore.js:367` runs its own v0→v1 `_migrate` and stamps the same
  `trip._schemaVersion`. The `route.kind→subKind` migration never runs — that's
  why ~6 readers still need dual-shape ORs (`index.html:36407/36534/36672/47131`).
  Landmine if migration.js is ever wired in against tripstore-stamped data. Fix:
  pick ONE migrator.

- **T3.4 — `max-trip-*` / `max-trips-index` written raw by 4+ modules**, bypassing
  the one `id==key` assert (`db.js:243`): `tripstore.js:131`, `sync.js:1024/1114`,
  `index.html:4098/5798/10841/10907/41677/41801/5671/41685/41811`. The June-6
  audit's CRITICAL #1 (key disagrees with trip.id) — assert added only at the
  db.js door, others left open. Fix: route all through `MaxDB.trip.writeRaw` / one
  index-writer.

- **T3.5 — placeMeta/tripMeta two-store with "_tb wins" stale hydrate.** MED.
  `_pmEnsureResearchMeta` (`index.html:27057`) copies a key only if `_tb` lacks
  it; `_pmPersistResearchToTrip` deep-copies `_tb` over `trip.brief`. A fresh
  `trip.brief.placeMeta[k]` can be clobbered by a stale `_tb` copy. Fix: give it
  the routed-accessor treatment placeActivities got, or prefer-newer.

- **T3.6 — God-functions** crammed with multiple responsibilities: `publishTrip`
  (~2434 lines, `engine-picker.js:1938`, also navigates), `_renderPlaceActivityItems`
  (2501, `index.html:19603`), `updateMainMap` (1245), `_openTripStopPopover`
  (812). Extracting an item-renderer from `_renderPlaceActivityItems` (mirroring
  the dest-card extraction) lets repaints touch one row instead of all.

- **T3.7 — Dead code.** `MaxMobile` is **referenced but never defined**
  (`sync.js:1516`) — the mobile home-refresh branch after a server pull is dead.
  `_renderCandidateCard` (`picker-ui.js:1062`) dead per its own comment.
  `_renderTripMore` (`trip-ui.js:8916`) is `return;` + ~120 unreachable lines.

- **T3.8 — `mdcItems` zombie field** still emitted by publish
  (`engine-picker.js:2253`), deleted by tripstore on save, with a max-data
  fallback — three layers half-aware of a retired field.

---

## TIER 4 — Cleanup (low risk, real correctness on T4.1)

- **T4.1 — `esc`/`_esc` defined ~10 times with DIFFERENT escape sets.**
  `index.html:14620` escapes only `"`; others `&<>`; the popout `&<>"`. A caller
  picking the `"`-only one is a markup-break/XSS risk. Consolidate to one
  `MaxUtil.esc`.
- **T4.2 — `86400000`/`msDay` redefined ~12 places**; nights-between inlined twice
  (`index.html:43192/44289`). Add `MaxEngineTrip.nightsBetween` + one `MS_DAY`.
- **T4.3 — `_isStaySection` (`index.html:8896`) duplicates `SectionKind.isStay`**
  with a divergent inline fallback.

---

## Suggested order

1. **T1.1, T1.4, T1.5** — live data/credential loss (trip-wipe, OSRM poison,
   pull race).
2. **T1.2, T1.3, T1.6, T1.7, T1.8** — finish the transient-error family with the
   two reference patterns.
3. **T2.3** (one line, fixes a whole role-lookup family), **T2.1, T2.2** (drift
   that's already wrong on screen).
4. **T3.1** (cheap double-render kill), **T3.3 / T3.4** (storage/migration
   landmines).
5. **T2.4–T2.10, T3.5–T3.8, Tier 4** as cleanup, ideally each behind a new
   contract-check so it can't regrow.
