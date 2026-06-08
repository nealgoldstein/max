// tests/playwright/build-harness.spec.js — PD.368: the mock-LLM
// regression harness.
//
// Drives the REAL paste→construct→mint→generate→merge→publish
// pipeline with canned LLM responses, then walks the exact loop the
// user walks by hand: create → trip → return to Discovery → check
// the CTA, the banner, and the count math. Every regression he has
// caught manually in the last week is an assertion here.
//
// LLM seam: window.callMax is stubbed. The main activity-generation
// prompt (marker: "OVERNIGHT FLAG") returns CANNED_ITEMS; the
// completeness check (marker: "A traveler is planning a trip")
// returns []; every other call rejects — the pipeline treats those
// paths as non-fatal and falls back to heuristics, which is exactly
// what a flaky network produces in production.

const { test, expect } = require('@playwright/test');
const { bootClean } = require('./helpers/load-app');

// The traveler's pasted list: 3 stays + 5 sights. "Skogafoss" and
// "Blue Lagoon" ALSO appear in the canned LLM output (identity /
// dedupe exercise); "Harpa Concert Hall" and "Hofn" never come back
// from the LLM (construct-then-decorate keeps them anyway).
const USER_LIST = [
  { place: 'Reykjavik',          country: 'Iceland', isStay: true,  nights: 2 },
  { place: 'Vik',                country: 'Iceland', isStay: true,  nights: 1 },
  { place: 'Hofn',               country: 'Iceland', isStay: true,  nights: 1 },
  { place: 'Blue Lagoon',        country: 'Iceland', isStay: false },
  { place: 'Gullfoss',           country: 'Iceland', isStay: false },
  { place: 'Skogafoss',          country: 'Iceland', isStay: false },
  { place: 'Jokulsarlon',        country: 'Iceland', isStay: false },
  { place: 'Harpa Concert Hall', country: 'Iceland', isStay: false },
  // PD.378: Kirkjufell's classifier verdict names a parent town NOT on
  // the list → the engine auto-creates Grundarfjörður as a hub, which
  // must arrive in "Recommended overnight stays" UNCHECKED.
  { place: 'Kirkjufell',         country: 'Iceland', isStay: false },
  // PD.384: Hverir is a fumarole the user listed as a SIGHT. An LLM
  // item below stamps it overnight:true (the promotion that dragged it
  // into Overnight stays). The user's role must win — it stays a sight.
  { place: 'Hverir',             country: 'Iceland', isStay: false },
];

const CANNED_ITEMS = [
  { name: 'Chase waterfalls', type: 'activity', category: 'scenery-nature',
    section: 'Chase waterfalls', description: 'Iceland’s south coast cascades.',
    iconic: true, durationHours: 4,
    requiredPlaces: [
      { place: 'Seljalandsfoss', country: 'Iceland', nights: 0, lat: 63.6156, lng: -19.9886, overnight: false },
      { place: 'Skogafoss',      country: 'Iceland', nights: 0, lat: 63.5321, lng: -19.5114, overnight: false },
    ] },
  { name: 'Soak in geothermal water', type: 'activity', category: 'scenery-nature',
    section: 'Relax in hot springs', description: 'Milky-blue lagoons.',
    iconic: true, durationHours: 3,
    requiredPlaces: [
      { place: 'Blue Lagoon', country: 'Iceland', nights: 0, lat: 63.8804, lng: -22.4495, overnight: false },
      { place: 'Sky Lagoon',  country: 'Iceland', nights: 0, lat: 64.1265, lng: -21.9442, overnight: false },
    ] },
  { name: 'Walk the capital', type: 'activity', category: 'culture-history',
    section: 'Explore Reykjavik', description: 'Streets, harbor, museums.',
    iconic: false, durationHours: 5,
    requiredPlaces: [
      { place: 'Reykjavik', country: 'Iceland', nights: 2, lat: 64.1466, lng: -21.9426, overnight: true },
    ] },
  // PD.384: the LLM wrongly stamps the user's SIGHT (Hverir) overnight:true.
  { name: 'Explore volcanic terrain', type: 'activity', category: 'scenery-nature',
    section: 'Explore volcanic terrain', description: 'Fumaroles and mud pots.',
    iconic: false, durationHours: 2,
    requiredPlaces: [
      { place: 'Hverir', country: 'Iceland', nights: 1, lat: 65.64, lng: -16.81, overnight: true },
    ] },
];

async function runPipeline(page) {
  await page.evaluate(({ userList, canned }) => {
    window.MaxEnginePicker.resetState({
      tripMode: 'place', placeName: 'Iceland', region: 'Iceland',
      candidates: [], chips: [], activityChips: [], requiredPlaces: [],
      // PD.383: a stated interest so the headliner (iconic AND
      // matches-intent) path is exercised. "waterfalls" matches the
      // iconic "Chase waterfalls" item but NOT "Soak in geothermal
      // water" — so the marker stays RARE, not on every iconic item.
      interests: ['waterfalls'], drivers: [], avoid: {},
    });
    window._harnessCalls = [];
    window._buildDone = false;
    if (window.MaxBuild && window.MaxBuild.on) {
      window.MaxBuild.on('build:done', () => { window._buildDone = true; });
      window.MaxBuild.on('build:error', () => { window._buildDone = true; });
    }
    window.callMax = async function (messages) {
      const prompt = (messages && messages[0] && messages[0].content) || '';
      if (prompt.indexOf('Classify each entry on this travel wish-list') !== -1) {
        // Canned classifier verdicts, in user-list order (1-indexed):
        // 3 cities (the stays), then 5 POIs.
        window._harnessCalls.push('classifier');
        // Realistic verdicts: a POI gets a PARENT CITY (as a real LLM
        // returns) so the classifier treats it as a sight, not a
        // promoted standalone stay. Harpa is IN Reykjavik; the plain
        // sights are reached FROM a listed stay; Kirkjufell's parent
        // (Grundarfjordur) is NOT on the list → engine auto-creates it
        // as a hub.
        var _parent = {
          'Blue Lagoon': 'Reykjavik', 'Gullfoss': 'Reykjavik',
          'Skogafoss': 'Vik', 'Jokulsarlon': 'Hofn',
          'Harpa Concert Hall': 'Reykjavik', 'Kirkjufell': 'Grundarfjordur',
          'Hverir': 'Reykjavik',
        };
        return JSON.stringify(userList.map((u, i) => ({
          i: i + 1,
          classification: u.isStay ? 'city' : 'poi',
          parentCity: u.isStay ? null : (_parent[u.place] || 'Reykjavik'),
          parentRelation: u.isStay ? null
            : (u.place === 'Harpa Concert Hall' ? 'within' : 'from'),
        })));
      }
      if (prompt.indexOf('OVERNIGHT FLAG') !== -1) {
        window._harnessCalls.push('generation');
        return JSON.stringify(canned);
      }
      if (prompt.indexOf('A traveler is planning a trip') !== -1) {
        window._harnessCalls.push('completeness');
        return '[]';
      }
      window._harnessCalls.push('rejected');
      throw new Error('harness: no canned response for this call');
    };
    return window._buildPickerFromPastedList(
      { destinations: userList, tripName: 'Harness Iceland', region: 'Iceland' },
      userList.map(p => p.place).join('\n'), {});
  }, { userList: USER_LIST, canned: CANNED_ITEMS });

  // Build settles: the orchestrator's own done/error event — the
  // paste flow starts MaxBuild on a setTimeout, so "not building yet"
  // and "finished" are indistinguishable by polling isBuilding().
  await page.waitForFunction(() => window._buildDone === true, { timeout: 30000 });
  await page.waitForFunction(() => window._tb
    && Array.isArray(window._tb.placeActivities)
    && window._tb.placeActivities.length > 0, { timeout: 5000 });
}

function snapshot(page) {
  return page.evaluate(() => {
    const nrm = (s) => (window.PlaceKey ? window.PlaceKey.resolve(s) : String(s || '').toLowerCase().trim());
    const byKey = {};
    (window._tb.placeActivities || []).forEach((it) => {
      if (!it) return;
      (it.requiredPlaces || []).forEach((p) => {
        if (!p || !p.place) return;
        const k = nrm(p.place);
        byKey[k] = byKey[k] || [];
        byKey[k].push({ section: it.section, keep: p._keep !== false, item: it.name });
      });
    });
    const cta = (document.querySelector('.tb-footer') || document.body).innerText || '';
    return {
      byKey,
      minted: !!window._currentTripId,
      tripId: window._currentTripId || null,
      bannerUp: !!document.getElementById('pm-build-phase-banner'),
      building: !!(window.MaxBuild && window.MaxBuild.isBuilding()),
      ctaText: cta,
      calls: window._harnessCalls,
      storePA: (window.TripStore && window.TripStore.isLoaded() && window.TripStore.trip)
        ? window.TripStore.trip.placeActivities.length : -1,
      tbPA: (window._tb.placeActivities || []).length,
      mdcPA: (window._mdcItems || []).length,
    };
  });
}

test.describe('Build harness — canned-LLM end-to-end', () => {

  test('paste list → build: contract, identity, mint, banner', async ({ page }) => {
    await bootClean(page);
    await runPipeline(page);
    const s = await snapshot(page);

    // The generation stub was actually exercised.
    expect(s.calls).toContain('generation');

    // THE CONTRACT: every user-listed place is present and CHECKED.
    for (const u of USER_LIST) {
      const k = u.place.toLowerCase();
      const hits = Object.keys(s.byKey).filter((key) => key === k || key.indexOf(k) === 0);
      expect(hits.length, u.place + ' must be in the picker data').toBeGreaterThan(0);
      const kept = hits.some((key) => s.byKey[key].some((e) => e.keep));
      expect(kept, u.place + ' must be CHECKED (user-listed is a contract)').toBe(true);
    }

    // Identity: a user-listed SIGHT may occupy at most one NON-STAY
    // slot (the canonical place-set invariant). A stay slot may
    // legitimately coexist with a theme slot (stay in Reykjavik AND
    // explore Reykjavik), so stays are excluded from the count.
    for (const key of ['skogafoss', 'blue lagoon', 'gullfoss', 'jokulsarlon']) {
      if (!s.byKey[key]) continue;
      const sightSlots = s.byKey[key].filter((e) =>
        e.section !== 'Recommended overnight stays' && e.section !== 'Overnight stays to consider');
      expect(sightSlots.length, key + ' must hold exactly one sight slot, got: '
        + JSON.stringify(s.byKey[key])).toBeLessThanOrEqual(1);
    }

    // PD.372: the audit must reconcile — zero missing listed places,
    // and slots-vs-unique arithmetic must be internally consistent.
    const audit = await page.evaluate(() => window.MaxAudit.data());
    expect(audit.missing, 'no listed place may go missing').toEqual([]);
    const slotSum = audit.sections.reduce((a, x) => a + x.places, 0);
    expect(slotSum).toBe(audit.slots);
    expect(audit.slots).toBeGreaterThanOrEqual(audit.unique);
    expect(audit.slots - audit.unique,
      'every extra slot must be a named multi-section place')
      .toBe(audit.multi.reduce((a, m) => a + (m.sections.length - 1), 0));

    // PD.384: a user-listed SIGHT is NEVER a stay, even when the LLM
    // stamped it overnight:true. Role is the contract.
    const hv = s.byKey['hverir'];
    expect(hv, 'Hverir must be present').toBeTruthy();
    expect(hv.every((e) => e.section !== 'Overnight stays' && e.section !== 'Recommended overnight stays'),
      'Hverir is a listed SIGHT — it must NOT be in any stay section, got: ' + JSON.stringify(hv)).toBe(true);

    // PD.384/389: section ORDER — "Overnight stays" first, "Recommended
    // overnight stays" immediately after, always. Assert BOTH the
    // placeActivities array order AND the RENDERED TOC order (the TOC
    // is sorted by a separate pass — the exact place the rename left
    // "Overnight stays" un-pinned).
    const order = await page.evaluate(() => (window._tb.placeActivities || []).map((it) => it.section));
    const iUser = order.indexOf('Overnight stays');
    const iRec = order.indexOf('Recommended overnight stays');
    expect(iUser, 'Overnight stays must exist').toBeGreaterThanOrEqual(0);
    expect(iUser, 'Overnight stays must be first in the array').toBe(0);
    if (iRec >= 0) expect(iRec, 'Recommended stays right after yours').toBe(iUser + 1);

    // Rendered TOC order (the section anchors in the picker).
    await page.evaluate(() => window.renderActivityPicker && window.renderActivityPicker());
    const tocOrder = await page.evaluate(() => {
      const slug = (s) => 'tb-sec-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const ids = Array.from(document.querySelectorAll('[id^="tb-sec-"]')).map((e) => e.id);
      return { ids, userSlug: slug('Overnight stays'), recSlug: slug('Recommended overnight stays') };
    });
    if (tocOrder.ids.length) {
      const iu = tocOrder.ids.indexOf(tocOrder.userSlug);
      const ir = tocOrder.ids.indexOf(tocOrder.recSlug);
      expect(iu, 'Overnight stays must render FIRST in the TOC, got: ' + JSON.stringify(tocOrder.ids)).toBe(0);
      if (ir >= 0) expect(ir, 'Recommended stays must render right after yours in the TOC').toBe(1);
    }

    // PD.380: TWO stay sections, split by provenance.
    //  • Your listed stays live in "Overnight stays" — CHECKED.
    //  • Max's hubs live in "Recommended overnight stays" — UNCHECKED.
    const reyk = s.byKey['reykjavik'];
    expect(reyk.some((e) => e.section === 'Overnight stays' && e.keep),
      'a listed stay must be in "Overnight stays", checked').toBe(true);
    expect(reyk.every((e) => e.section !== 'Recommended overnight stays'),
      'a listed stay must NOT be in the Recommended (Max) section').toBe(true);

    const hub = s.byKey['grundarfjordur'];
    expect(hub, 'auto-created hub must exist in the picker').toBeTruthy();
    expect(hub.every((e) => e.section === 'Recommended overnight stays'),
      'hub must sit ONLY in Recommended overnight stays').toBe(true);
    expect(hub.every((e) => !e.keep),
      'hub must arrive UNCHECKED (Max never checks)').toBe(true);

    // NOTHING Max-originated may arrive checked. Every checked place
    // must be one the user listed.
    const listedKeys = new Set(USER_LIST.map((u) => u.place.toLowerCase()));
    for (const [key, slots] of Object.entries(s.byKey)) {
      const checkedSomewhere = slots.some((e) => e.keep);
      if (checkedSomewhere) {
        const isListed = [...listedKeys].some((lk) => key === lk || key.indexOf(lk) === 0 || lk.indexOf(key) === 0);
        expect(isListed, key + ' is checked but was not on the user list (Max checked it)').toBe(true);
      }
    }

    // PD.383: HEADLINER marker — iconic AND matches-intent, rare, never checked.
    const head = await page.evaluate(() => {
      const items = (window._tb.placeActivities || []);
      const headItems = items.filter((it) => it._headliner);
      // A headliner place that is MAX's (not user-listed) must be
      // UNCHECKED — the marker highlights, it never checks. A place
      // that is BOTH a headliner and the user's own listed place is
      // checked because it's the user's (the contract), and that's
      // correct — the marker doesn't override provenance.
      let anyMaxHeadlinerChecked = false;
      headItems.forEach((it) => (it.requiredPlaces || []).forEach((p) => {
        if (p && window._placeOrigin(p) !== 'user' && p._keep !== false) anyMaxHeadlinerChecked = true;
      }));
      return {
        headlinerItemNames: headItems.map((it) => it.name),
        iconicItemNames: items.filter((it) => it.iconic).map((it) => it.name),
        anyMaxHeadlinerChecked,
      };
    });
    // The waterfalls item is iconic AND matches intent → headliner.
    expect(head.headlinerItemNames).toContain('Chase waterfalls');
    // The geothermal item is iconic but does NOT match intent → NOT a
    // headliner. This is the whole point: rarer than the iconic set.
    expect(head.headlinerItemNames).not.toContain('Soak in geothermal water');
    expect(head.headlinerItemNames.length).toBeLessThan(head.iconicItemNames.length);
    // A headliner that is Max's own suggestion is highlighted, never checked.
    expect(head.anyMaxHeadlinerChecked).toBe(false);

    // PD.391: the receipt's "N unchecked sights" headline must equal
    // the SINGLE considered derivation — no second computation, no
    // "104 wrong number" drift. Read it from the rendered footer.
    const recBundle = await page.evaluate(() => {
      const considered = window.MaxData.consideredPlaceKeys(window.TripStore.trip || {});
      const el = document.querySelector('.tb-footer');
      const m = el && el.innerText.match(/(\d+) unchecked sight/);
      return { setSize: Object.keys(considered).length, receipt: m ? parseInt(m[1], 10) : null };
    });
    if (recBundle.receipt !== null) {
      expect(recBundle.receipt, 'receipt headline must equal the considered set size')
        .toBe(recBundle.setSize);
    }

    // PD.391: DEDUP INVARIANT — no place may appear in two non-stay
    // sections (the cross-section duplication that inflated the count).
    const dupCheck = await page.evaluate(() => {
      const seen = {}; const dups = [];
      (window._tb.placeActivities || []).forEach((it) => {
        if (!it || it.type === 'route' || (window._isStaySection && window._isStaySection(it.section))) return;
        (it.requiredPlaces || []).forEach((pp) => {
          if (!pp || !pp.place) return;
          const k = window.PlaceKey ? window.PlaceKey.resolve(pp.place) : pp.place.toLowerCase();
          if (seen[k] && seen[k] !== it.section) dups.push(pp.place + ' [' + seen[k] + ' & ' + it.section + ']');
          else seen[k] = it.section;
        });
      });
      return dups;
    });
    expect(dupCheck, 'no place may sit in two sections: ' + JSON.stringify(dupCheck)).toEqual([]);

    // PD.393: the stay split is PROVENANCE-driven, not hydration-
    // driven. Even with _userListedNames WIPED (legacy trip / return
    // hydration miss), your stays stay in "Overnight stays" and never
    // leak into "Recommended overnight stays" — the exact "Recommended
    // (29)" bug where listed stays merged with Max's.
    const splitAfterWipe = await page.evaluate(() => {
      window._tb._userListedNames = {};
      if (typeof window._reconcileUserListedKeeps === 'function') window._reconcileUserListedKeeps();
      const byKey = {};
      (window._tb.placeActivities || []).forEach((it) => {
        if (!window._isStaySection(it.section)) return;
        (it.requiredPlaces || []).forEach((p) => {
          if (p && p.place) byKey[p.place.toLowerCase()] = it.section;
        });
      });
      return byKey;
    });
    expect(splitAfterWipe['reykjavik'], 'a listed stay must stay in Overnight stays after hydration miss')
      .toBe('Overnight stays');
    expect(splitAfterWipe['grundarfjordur'], 'the hub stays in Recommended overnight stays')
      .toBe('Recommended overnight stays');

    const audit2 = await page.evaluate(() => window.MaxAudit.data());
    expect(audit2.hubs.map((h) => h.place.toLowerCase())).toContain('grundarfjordur');
    expect(audit2.hubs.every((h) => !h.checked)).toBe(true);
    expect(audit2.maxChecked, 'Max must have checked nothing').toBe(0);


    // PD.382: provenance is a STORED field. Every place carries an
    // _origin set at creation, and it must agree with where the place
    // landed: user→checked & in your sections; max-hub→the Recommended
    // stays section, unchecked; max→a suggestion, unchecked.
    const origins = await page.evaluate(() => {
      const out = {};
      (window._tb.placeActivities || []).forEach((it) => {
        (it.requiredPlaces || []).forEach((p) => {
          if (!p || !p.place) return;
          const k = window.PlaceKey ? window.PlaceKey.resolve(p.place) : p.place.toLowerCase();
          out[k] = out[k] || [];
          out[k].push({ origin: window._placeOrigin(p), section: it.section, keep: p._keep !== false });
        });
      });
      return out;
    });
    // Reykjavik was listed → origin "user", checked.
    expect(origins['reykjavik'].every((e) => e.origin === 'user')).toBe(true);
    // Grundarfjordur is a synthesized hub → origin "max-hub", unchecked.
    expect(origins['grundarfjordur'].every((e) => e.origin === 'max-hub' && !e.keep)).toBe(true);
    // Seljalandsfoss is an LLM suggestion → origin "max", unchecked.
    expect(origins['seljalandsfoss'].every((e) => e.origin === 'max' && !e.keep)).toBe(true);
    // THE INVARIANT: a checked place is ALWAYS origin "user".
    for (const [k, slots] of Object.entries(origins)) {
      for (const s of slots) {
        if (s.keep) expect(s.origin, k + ' is checked but origin=' + s.origin).toBe('user');
      }
    }

    // PD.379: the provenance banner explains the numbers in user
    // terms, and its numbers must MATCH the audit exactly.
    const footerText = await page.evaluate(() => {
      const el = document.querySelector('.tb-footer');
      return el ? el.innerText : '';
    });
    expect(footerText).toContain(audit.unique + ' place');
    expect(footerText).toContain(audit.listed.length + ' you listed');
    if (audit.hubs.length) {
      expect(footerText).toContain(audit.hubs.length + ' overnight hub');
    }
    if (audit.multi.length) {
      expect(footerText).toContain('Section counts add up to ' + audit.slots);
    }

    // Mint happened at build start; one array everywhere.
    expect(s.minted).toBe(true);
    expect(s.storePA).toBe(s.tbPA);
    expect(s.mdcPA).toBe(s.tbPA);

    // Build is over: the banner must be gone (a banner is a function
    // of state, and the state is "not building").
    expect(s.building).toBe(false);
    expect(s.bannerUp).toBe(false);

    // CTA: fresh trip, no destinations yet → Create.
    expect(s.ctaText).toContain('Create my trip');
  });

  test('publish → return loop: CTA states + receipt matches considered', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await bootClean(page);
    await runPipeline(page);

    // Uncheck one Max suggestion so the considered pool is non-empty.
    await page.evaluate(() => {
      let done = false;
      (window._tb.placeActivities || []).forEach((it) => {
        (it.requiredPlaces || []).forEach((p) => {
          if (done || !p || !p.place) return;
          const k = p.place.toLowerCase();
          if (k === 'sky lagoon' || k === 'seljalandsfoss') { p._keep = false; done = true; }
        });
      });
      if (typeof window._persistDiscoveryState === 'function') window._persistDiscoveryState();
    });

    // Capture the PD.269 reconciliation line on publish.
    const logs = [];
    page.on('console', (m) => { const t = m.text(); if (t.indexOf('[Max PD.269]') === 0) logs.push(t); });

    // Publish (the real engine path behind "Create my trip").
    await page.evaluate(() => window.MaxEnginePicker.publishTrip());
    await page.waitForFunction(() => {
      const t = window.TripStore && window.TripStore.isLoaded() && window.TripStore.trip;
      return t && Array.isArray(t.destinations) && t.destinations.length > 0;
    }, { timeout: 30000 });

    // Destinations: the 3 user stays must all be destinations.
    const dests = await page.evaluate(() =>
      (window.TripStore.trip.destinations || []).map((d) => (d.place || '').toLowerCase()));
    for (const stay of ['reykjavik', 'vik', 'hofn']) {
      expect(dests.some((d) => d.indexOf(stay) === 0), stay + ' must be a destination').toBe(true);
    }

    // Return to Discovery on the BUILT trip.
    await page.evaluate(() => { if (typeof window.reopenPickerForEdit === 'function') window.reopenPickerForEdit(); });
    await page.waitForFunction(() => {
      const ov = document.getElementById('trip-brief-overlay');
      return ov && ov.style.display !== 'none';
    }, { timeout: 10000 });

    const s2 = await snapshot(page);
    // CTA on a built trip must NEVER say Create.
    expect(s2.ctaText).not.toContain('Create my trip');
    expect(/Update my trip|Return to my trip/.test(s2.ctaText)).toBe(true);
    // No build running → no banner.
    expect(s2.bannerUp).toBe(false);

    // PD.386: THE MATH MUST RECONCILE ACROSS VIEWS. The discovery
    // considered-PREVIEW (MaxAudit.considered) must equal the trip's
    // actual "Considered (N)" pill (MaxData.getConsideredSights) — the
    // exact mismatch the user hit (discovery 32 vs trip 30).
    const reconcile = await page.evaluate(() => {
      const preview = window.MaxAudit.data().considered;
      const trip = (window.TripStore.isLoaded() && window.TripStore.trip)
        ? (window.MaxData.getConsideredSights(window.TripStore.trip) || []).length : -1;
      return { preview, trip };
    });
    expect(reconcile.trip, 'trip considered pill must be derivable').toBeGreaterThanOrEqual(0);
    expect(reconcile.preview,
      'discovery considered-preview (' + reconcile.preview + ') must equal the trip pill (' + reconcile.trip + ')')
      .toBe(reconcile.trip);
  });
  test('PD.396: checking a catchall sight moves it out of "to consider"', async ({ page }) => {
    await bootClean(page);
    await runPipeline(page);
    const r = await page.evaluate(() => {
      const CATCH = { 'Sights near places you listed': 1, 'More places to consider': 1 };
      window._tb.placeActivities.push({ id: 'invtest', type: 'activity',
        section: 'More places to consider', requiredPlaces: [{ place: 'InvariantSight', lat: 64, lng: -22, _keep: false }] });
      window._reconcileUserListedKeeps();
      (window._tb.placeActivities || []).forEach((it) => (it.requiredPlaces || []).forEach((pp) => {
        if (pp.place === 'InvariantSight') pp._keep = true;
      }));
      window._reconcileUserListedKeeps();
      const badly = [];
      (window._tb.placeActivities || []).forEach((it) => {
        if (!CATCH[it.section]) return;
        (it.requiredPlaces || []).forEach((pp) => { if (pp && pp._keep !== false) badly.push(it.section + ':' + pp.place); });
      });
      const kept = (window._tb.placeActivities || []).find((it) => it.section === "Sights you're keeping");
      return { badly, committed: kept ? kept.requiredPlaces.map((pp) => pp.place) : [] };
    });
    expect(r.badly, 'no checked place may remain in a to-consider catchall').toEqual([]);
    expect(r.committed, 'the checked sight committed to "Sights you\'re keeping"').toContain('InvariantSight');
  });

});
