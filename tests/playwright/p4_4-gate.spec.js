// p4_4-gate.spec.js — the PRE-FLIGHT browser gate for P4.4
// (collapse _tb.candidates / trip.candidates into one array, delete mirror()).
//
// The publish → reopen → reload path is NOT Node-testable (it lives in the
// live app, touches localStorage/MaxDB, and is the only code that can corrupt
// a saved trip). These three specs PIN today's behavior so any regression
// introduced by the four P4.4 slices is caught immediately. They assert
// DURABLE END-STATES (what survives a publish/reopen/reload), not internal
// field plumbing — so they stay valid as the slices delete singleSight /
// tripRole / waysideLeg enrichment and the mirror() primitive.
//
// Run on CURRENT code first (must be green) BEFORE any refactor:
//   ./dev.sh check          (full gate: Node suite + this)
//   cd tests/playwright && npx playwright test p4_4-gate.spec.js   (just this)
//
// Patterns mirror the already-green picker-flow.spec.js / role-authority.spec.js:
// fabricate _tb via MaxEnginePicker.resetState, publish with buildFromCandidates,
// drive decisions through the real write paths (setCS / MaxRoleWriter), and
// reopen via reopenCandidateExplorer — exactly what the live UI calls.

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

// ── shared brief shape (copied from picker-flow.spec.js so every required
//    resetState field is present) ──────────────────────────────────────────
function brief(extra) {
  return Object.assign({
    name: 'P4.4 Gate', region: 'Iceland', when: '2026-08-01',
    duration: '10 days', intent: 'Ring Road', interests: ['waterfalls'],
    drivers: [], tripMode: 'place', placeName: 'Iceland', placeContext: '',
    partyComposition: 'couple', partySize: '2', partyAges: 'adults',
    physicalAbility: 'moderate', avoid: {}, pace: 'enough',
    anchors: '', familiarity: 'first', accommodation: '', compromises: '', hardlimits: '',
    entry: '', tbExit: '', entryMode: 'flight', exitMode: 'flight',
    chips: [], activityChips: [], requiredPlaces: [],
  }, extra || {});
}

// Three overnight bases — a minimal Ring Road. Reykjavik is the gateway.
const BASES = [
  { id: 'c1', place: 'Reykjavik', country: 'Iceland', stayRange: '3 nights', whyItFits: 'gateway + Golden Circle', lat: 64.14, lng: -21.94, status: 'keep', overnightCapable: true, _cityPick: true },
  { id: 'c2', place: 'Vik',       country: 'Iceland', stayRange: '2 nights', whyItFits: 'south coast + black beaches', lat: 63.42, lng: -19.01, status: 'keep', overnightCapable: true },
  { id: 'c3', place: 'Höfn',      country: 'Iceland', stayRange: '2 nights', whyItFits: 'glacier lagoon', lat: 64.25, lng: -15.20, status: 'keep', overnightCapable: true },
  { id: 'c4', place: 'Akureyri',  country: 'Iceland', stayRange: '2 nights', whyItFits: 'north + whale watching', lat: 65.68, lng: -18.10, status: 'keep', overnightCapable: true },
];

// Build a base trip from BASES (+ any extra candidates), leaving the app on
// the trip view with transit routes synthesized.
async function buildBaseTrip(page, extraCandidates) {
  await bootClean(page);
  // resetState takes a single object — the whole brief WITH candidates.
  await page.evaluate((b) => { window.MaxEnginePicker.resetState(b); window._mdcItems = []; },
    brief({ candidates: BASES.concat(extraCandidates || []) }));
  await page.evaluate(async () => { await window.buildFromCandidates(); });
  await page.waitForSelector('.tm-dest', { timeout: 8000 });
}

// ───────────────────────────────────────────────────────────────────────────
// 1. DECISION ROUND-TRIP — check / uncheck / commit a Max base / set a day-trip
//    → publish → reload → every decision survived in the persisted snapshot.
//    Guards P4.4d: the collapsed single array + regenerated snapshot must
//    persist exactly what mirror()+snapshotFrom persist today.
// ───────────────────────────────────────────────────────────────────────────
test.describe('P4.4 gate — decision round-trip (publish → reload)', () => {
  test('reject / commit-stay / day-trip decisions all survive a reload', async ({ page }) => {
    await buildBaseTrip(page);

    // Drive the three decision kinds through the REAL write paths the UI uses.
    await page.evaluate(async () => {
      await window.setCS('c2', 'reject');                       // uncheck/reject a kept base (Vik)
      window.MaxRoleWriter.set('c3', 'stay');                   // commit a base as an overnight Stay (Höfn)
      window.MaxRoleWriter.set('c4', 'daytrip', { hub: 'akureyri' }); // set a day-trip with a hub
    });

    // Re-publish so the persisted snapshot + storage reflect the decisions.
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForFunction(() => window.trip && Array.isArray(window.trip.candidates), { timeout: 8000 });

    const before = await page.evaluate(() => {
      const f = (id) => { const c = (window.trip.candidates || []).find((x) => x && x.id === id) || null; return c && { role: c.role, status: c.status, touched: !!c._roleTouched, hub: c.dayTripHub || '', intent: c.intent || '' }; };
      return { c2: f('c2'), c3: f('c3'), c4: f('c4') };
    });

    // THE SCENARIO: hard reload. The app restores the trip from storage.
    await page.reload();
    await page.waitForFunction(() => window.MaxDB && window.trip && window.trip.id && Array.isArray(window.trip.candidates), { timeout: 10000 });

    const after = await page.evaluate(() => {
      const f = (id) => { const c = (window.trip.candidates || []).find((x) => x && x.id === id) || null; return c && { role: c.role, status: c.status, touched: !!c._roleTouched, hub: c.dayTripHub || '', intent: c.intent || '' }; };
      return { c2: f('c2'), c3: f('c3'), c4: f('c4') };
    });

    // Nothing drifted across the reload.
    expect(after).toEqual(before);

    // And the specific decisions are intact:
    expect(after.c2.status).toBe('reject');           // the uncheck survived
    expect(after.c3.role).toBe('stay');               // committed base stayed a Stay
    expect(after.c3.touched).toBe(true);              // user-commitment flag survived
    expect(after.c4.role).toBe('daytrip');            // day-trip survived
    expect(after.c4.hub).toBeTruthy();                // its hub survived
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. singleSight RENDER — a single-sight place keeps its single-sight identity
//    (NOT promoted to an overnight base) across publish → reopen. Guards
//    P4.4b: when singleSight stops being stored and is derived via
//    isSingleSight(), the place must classify (and therefore render) the same.
// ───────────────────────────────────────────────────────────────────────────
test.describe('P4.4 gate — singleSight renders identically', () => {
  const SIGHT = {
    id: 'cs1', place: 'Seljalandsfoss', country: 'Iceland', stayRange: '0 nights',
    whyItFits: 'iconic waterfall', lat: 63.62, lng: -19.99,
    role: 'see', status: 'keep', singleSight: true, overnightCapable: false,
  };

  test('a single-sight place is not promoted to an overnight base, before and after reopen', async ({ page }) => {
    await buildBaseTrip(page, [SIGHT]);

    const afterBuild = await page.evaluate(() => {
      const c = (window.trip.candidates || []).find((x) => x && x.id === 'cs1') || null;
      const asBase = (window.trip.destinations || []).some((d) =>
        d && /seljalandsfoss/i.test(String(d.place || '')) && (d.nights || 0) >= 1);
      return {
        present: !!c,
        overnightCapable: c ? c.overnightCapable : 'MISSING',
        role: c ? c.role : 'MISSING',
        promotedToBase: asBase,
      };
    });
    expect(afterBuild.present).toBe(true);
    expect(afterBuild.overnightCapable).toBe(false);  // single sight = no lodging
    expect(afterBuild.role).toBe('see');              // a sight, not a stay
    expect(afterBuild.promotedToBase).toBe(false);    // never becomes an overnight base

    // Reopen the candidate explorer (the live "edit discovery" path).
    await page.evaluate(() => { if (typeof window.reopenCandidateExplorer === 'function') window.reopenCandidateExplorer(); });
    await page.waitForFunction(() => window._tb && Array.isArray(window._tb.candidates) && window._tb.candidates.length, { timeout: 8000 });

    const afterReopen = await page.evaluate(() => {
      const c = (window._tb.candidates || []).find((x) => x && x.id === 'cs1') || null;
      return { overnightCapable: c ? c.overnightCapable : 'MISSING', role: c ? c.role : 'MISSING' };
    });
    expect(afterReopen.overnightCapable).toBe(false); // identity preserved through reopen
    expect(afterReopen.role).toBe('see');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. WAYSIDE ROUND-TRIP — place a wayside on a leg → publish → reopen → the
//    leg assignment survived. Guards P4.4c (move waysideLeg into the decision
//    log) and P4.4d: the committed route stop must stay on the right transit
//    leg through a reopen → republish cycle.
// ───────────────────────────────────────────────────────────────────────────
test.describe('P4.4 gate — wayside leg assignment survives publish → reopen', () => {
  // Seljalandsfoss sits on the Reykjavik → Vik leg.
  const WAYSIDE = {
    id: 'cw1', place: 'Seljalandsfoss', country: 'Iceland',
    intent: 'wayside', waysideLeg: { fromPlace: 'Reykjavik', toPlace: 'Vik' },
    lat: 63.62, lng: -19.99, durationHours: 1, whyItFits: 'roadside waterfall',
    tags: ['picker-wayside', 'committed'], nights: 0, status: 'keep',
  };

  // A deterministic TWO-base trip (Reykjavik → Vik) so exactly one transit
  // leg exists and the wayside's target leg is unambiguous — no dependence
  // on ring-order inference. Reykjavik is the gateway (entry + _cityPick).
  async function buildWaysideTrip(page) {
    await bootClean(page);
    const cands = [
      { id: 'b1', place: 'Reykjavik', country: 'Iceland', stayRange: '3 nights', whyItFits: 'gateway', lat: 64.14, lng: -21.94, status: 'keep', overnightCapable: true, _cityPick: true },
      { id: 'b2', place: 'Vik',       country: 'Iceland', stayRange: '2 nights', whyItFits: 'south coast', lat: 63.42, lng: -19.01, status: 'keep', overnightCapable: true },
      WAYSIDE,
    ];
    await page.evaluate((b) => { window.MaxEnginePicker.resetState(b); window._mdcItems = []; },
      brief({ entry: 'Reykjavik', candidates: cands }));
    // P4.4c: record the wayside's leg in the decision log (what the live
    // assignment sites now do), so publish resolves the leg from the decision
    // — not the candidate's legacy waysideLeg field.
    await page.evaluate(() => {
      if (typeof window._recordWaysideLegDecision === 'function') {
        window._recordWaysideLegDecision('Seljalandsfoss', 'Reykjavik', 'Vik');
      }
    });
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 8000 });
  }

  // Find every transit leg carrying a Seljalandsfoss 'stop'. The publish
  // commit mints trip.places[pid] = {name:c.place} and a planItem with
  // {type:'stop', placeId:pid} (no name on the planItem) — so we resolve
  // the name through trip.places. Returns the leg endpoints + a total.
  function waysideLegs(page) {
    return page.evaluate(() => {
      const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
      const dests = window.trip.destinations || [];
      const places = window.trip.places || {};
      const transit = (window.trip.routes || []).filter((r) => {
        const sub = (typeof MaxMigration !== 'undefined' && MaxMigration.routeSubKind)
          ? MaxMigration.routeSubKind(r)
          : (r && (r.subKind || (r.kind && r.kind !== 'route' ? r.kind : null)));
        return sub === 'transit';
      });
      const matches = (p) => p && p.type === 'stop' && (
        /seljalandsfoss/i.test(String(p.placeId || '')) ||
        /seljalandsfoss/i.test(String(p.name || '')) ||
        (p.placeId && places[p.placeId] && /seljalandsfoss/i.test(String(places[p.placeId].name || '')))
      );
      const legsWith = [];
      let total = 0;
      transit.forEach((r) => {
        const n = (r.planItems || []).filter(matches).length;
        if (n > 0) {
          total += n;
          const fD = dests.find((d) => d.id === r.fromDestId);
          const tD = dests.find((d) => d.id === r.toDestId);
          legsWith.push({ from: fD ? norm(fD.place) : ('?' + r.fromDestId), to: tD ? norm(tD.place) : ('?' + r.toDestId) });
        }
      });
      return { transitLegs: transit.length, total, legsWith };
    });
  }

  test('a placed wayside stays on the same transit leg through reopen → republish', async ({ page }) => {
    await buildWaysideTrip(page);

    const built = await waysideLegs(page);
    expect(built.transitLegs, 'at least one transit leg exists').toBeGreaterThanOrEqual(1);
    // EXACTLY one stop — not >=1. P4.4d guard: sharing the candidate reference
    // could let a reopened wayside re-commit and DUPLICATE the route stop (the
    // publish commit mints a fresh planItem with no dedup). A loose >=1 would
    // miss that corruption; pin it to one.
    expect(built.total, 'wayside committed as exactly one stop on a transit leg').toBe(1);
    const placedLeg = built.legsWith[0];               // the leg it landed on
    expect(placedLeg).toBeTruthy();

    // Reopen the explorer, then re-publish — the round-trip that drops OR
    // duplicates the wayside if the candidate-array / route bookkeeping regresses.
    await page.evaluate(() => { if (typeof window.reopenCandidateExplorer === 'function') window.reopenCandidateExplorer(); });
    await page.waitForFunction(() => window._tb && Array.isArray(window._tb.candidates) && window._tb.candidates.length, { timeout: 8000 });
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 8000 });

    const after = await waysideLegs(page);
    // Still EXACTLY one — survived the round-trip without being dropped or duplicated.
    expect(after.total, 'wayside is exactly one stop after reopen → republish (no drop, no dupe)').toBe(1);
    // ...and it's still on the SAME leg (same endpoints), not drifted elsewhere.
    expect(after.legsWith.some((l) => l.from === placedLeg.from && l.to === placedLeg.to),
      'wayside stayed on its original leg').toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. P4.5 — the decision LOG itself persists on the trip and restores on reload.
//    The decision round-trip above covers the candidate SNAPSHOT; this covers
//    the LOG (trip.brief._decisionLog), which is the durable record carrying
//    role + hub + leg — the fields the old _decided-seed dropped on reload.
//    Guards P4.5b (persist/restore wiring).
// ───────────────────────────────────────────────────────────────────────────
test.describe('P4.5 gate — decision log persists to the trip and restores on reload', () => {
  test('role + hub + leg survive reload via the persisted decision log', async ({ page }) => {
    await buildBaseTrip(page);

    // Record decisions that carry hub + leg — fields the candidate snapshot's
    // status/role alone don't fully reconstruct, and that the legacy _decided-
    // seed (kept/rejected/role only) drops on reload. These go INTO the log.
    await page.evaluate(() => {
      window.MaxRoleWriter.set('c3', 'daytrip', { hub: 'akureyri' });   // Höfn → day-trip from Akureyri
      if (typeof window._recordWaysideLegDecision === 'function') {
        window._recordWaysideLegDecision('Seljalandsfoss', 'Reykjavik', 'Vik');
      }
    });

    // Publish, then force a save so serializeTrip definitely runs and stamps
    // trip.brief._decisionLog from the live log (belt-and-suspenders vs relying
    // on the build's own debounced save).
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForFunction(() => window.trip && window.trip.id, { timeout: 8000 });
    await page.evaluate(() => {
      if (typeof window.localSave === 'function') { try { window.localSave(); } catch (_) {} }
      else if (typeof window.serializeTrip === 'function') { try { window.serializeTrip(); } catch (_) {} }
    });

    const stamped = await page.evaluate(() => {
      const log = window.trip && window.trip.brief && window.trip.brief._decisionLog;
      return {
        present: !!log,
        keys: log ? Object.keys(log).length : 0,
        hofn: log ? (log['höfn'] || log['hofn'] || null) : null,
        sel: log ? (log['seljalandsfoss'] || null) : null,
      };
    });
    expect(stamped.present, 'decision log stamped onto trip.brief._decisionLog at save').toBe(true);
    expect(stamped.keys, 'log carries the recorded decisions').toBeGreaterThanOrEqual(1);

    // THE SCENARIO: hard reload, then trigger the restore (reconcile rebuilds
    // _tb._decisions from the persisted log).
    await page.reload();
    await page.waitForFunction(() => window.MaxDB && window.trip && window.trip.id, { timeout: 10000 });

    const restored = await page.evaluate(() => {
      window._tb = window._tb || {};
      if (typeof window._reconcileUserListedKeeps === 'function') {
        try { window._reconcileUserListedKeeps(); } catch (_) {}
      }
      const D = window._tb && window._tb._decisions;
      const get = (p) => (D && typeof D.get === 'function') ? D.get(p) : null;
      const hofn = get('Höfn') || get('Hofn');
      const sel = get('Seljalandsfoss');
      return {
        logRestored: !!D,
        hofnRole: hofn ? hofn.role : null,
        hofnHub: hofn ? hofn.hub : null,
        selLeg: sel ? sel.leg : null,
      };
    });
    expect(restored.logRestored, 'decision log restored into _tb._decisions on reload').toBe(true);
    expect(restored.hofnHub, 'day-trip hub survived reload via the log (the seed dropped hub)').toBe('akureyri');
    expect(restored.hofnRole).toBe('daytrip');
    expect(restored.selLeg, 'wayside leg survived reload via the log (the seed dropped leg)')
      .toEqual({ fromPlace: 'Reykjavik', toPlace: 'Vik' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. #3 — the keep PROJECTION is faithful. For EVERY place (decided + undecided)
//    the stored _keep must equal MaxDecisions.keepOf(factsOf(origin,isStay),
//    decision). _p4ShadowCheck() audits this live. When it is clean, the live
//    derivation can compute _keep at read time instead of storing it, and the
//    ~50 direct _keep writers can be retired. This gate makes that invariant
//    permanent: if a future change smears _keep (a direct write bypassing the
//    decision log), clean goes false and CI fails here.
//    Defensive: if this build harness does not populate _tb.placeActivities the
//    invariant isn't exercised, so we SKIP rather than pass vacuously.
// ───────────────────────────────────────────────────────────────────────────
test.describe('#3 gate — stored _keep equals the keep projection (every place)', () => {
  test('shadow check is clean after a build and after real decisions', async ({ page }) => {
    await buildBaseTrip(page);

    const afterBuild = await page.evaluate(() =>
      (typeof window._p4ShadowCheck === 'function') ? window._p4ShadowCheck() : { ready: false });
    const total = (afterBuild.decided || 0) + (afterBuild.undecided || 0);
    test.skip(!afterBuild.ready || total === 0,
      'harness did not populate _tb.placeActivities — keep invariant not exercised here');

    expect(afterBuild.clean,
      'stored _keep matches keepOf for every place after build: ' + JSON.stringify(afterBuild.disagree || [])).toBe(true);

    // Exercise the DECIDED path (the real trip snapshot had decided:0): drive
    // real decisions through the live write doors, rebuild, and re-audit.
    await page.evaluate(async () => {
      await window.setCS('c2', 'reject');        // reject a base
      window.MaxRoleWriter.set('c3', 'stay');    // commit a base as a stay
      await window.buildFromCandidates();
    });
    await page.waitForFunction(() => window.trip && Array.isArray(window.trip.candidates), { timeout: 8000 });

    const afterDecisions = await page.evaluate(() => window._p4ShadowCheck());
    expect(afterDecisions.clean,
      'stored _keep matches keepOf for every place after decisions: ' + JSON.stringify(afterDecisions.disagree || [])).toBe(true);
  });
});
