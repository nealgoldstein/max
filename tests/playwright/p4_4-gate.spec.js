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
    expect(built.total, 'wayside committed as a stop on a transit leg').toBeGreaterThanOrEqual(1);
    const placedLeg = built.legsWith[0];               // the leg it landed on
    expect(placedLeg).toBeTruthy();

    // Reopen the explorer, then re-publish — the round-trip that drops the
    // wayside if waysideLeg / route bookkeeping regresses.
    await page.evaluate(() => { if (typeof window.reopenCandidateExplorer === 'function') window.reopenCandidateExplorer(); });
    await page.waitForFunction(() => window._tb && Array.isArray(window._tb.candidates) && window._tb.candidates.length, { timeout: 8000 });
    await page.evaluate(async () => { await window.buildFromCandidates(); });
    await page.waitForSelector('.tm-dest', { timeout: 8000 });

    const after = await waysideLegs(page);
    expect(after.total, 'wayside stop survived the reopen → republish cycle').toBeGreaterThanOrEqual(1);
    // ...and it's still on the SAME leg (same endpoints), not drifted elsewhere.
    expect(after.legsWith.some((l) => l.from === placedLeg.from && l.to === placedLeg.to),
      'wayside stayed on its original leg').toBe(true);
  });
});
