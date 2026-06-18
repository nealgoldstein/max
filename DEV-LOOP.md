# Local dev loop

The fast, safe loop for developing + smoke-testing Max on your machine.

## 1. Serve

```
./dev.sh serve          # python no-cache server on http://localhost:8765
```

Open `http://localhost:8765/index.html`. The server version-busts every module
on each load, so a plain reload always pulls fresh code (no stale-JS confusion).
Hard-reload (Cmd-Shift-R) once if a tab was open before you (re)started serving.

## 2. Why localhost starts empty (and why that's the SAFE default)

Trips live in **localStorage/IndexedDB, scoped to the origin**, and sync pulls
from `https://api.travelingwithmax.app` using an **origin-scoped auth token**.
`localhost:8765` is a different origin from the deployed app, so it has *no
token* → sync is **inert** → no trips appear.

That is exactly what you want for development: **localhost is an isolated
sandbox**. Nothing you click can touch your real trips, because there is no
authenticated connection to the server. Don't "fix" this by pasting your prod
token into localhost — that re-arms autosave against real data. Keep dev
isolated; seed a throwaway trip instead (next step).

## 3. Seed a sample trip (one paste, or save as a bookmarklet)

With `index.html` open on localhost, paste this in the DevTools console. It
drives the app's **real build engine** with canned LLM responses (the same path
the green `build-harness` test uses), so the trip is always schema-correct and
saved through the normal path — then it lands you on the trip:

```js
(async () => {
  const USERS = [
    { place: 'Reykjavik', isStay: true }, { place: 'Vik', isStay: true },
    { place: 'Hofn', isStay: true },
    { place: 'Gullfoss', isStay: false }, { place: 'Seljalandsfoss', isStay: false },
    { place: 'Jokulsarlon', isStay: false }, { place: 'Blue Lagoon', isStay: false },
  ];
  const GEN = [
    { name: 'Chase waterfalls', type: 'activity', category: 'scenery-nature',
      section: 'Chase waterfalls', description: 'South-coast cascades.', iconic: true, durationHours: 4,
      requiredPlaces: [
        { place: 'Gullfoss', country: 'Iceland', nights: 0, lat: 64.3271, lng: -20.1199, overnight: false },
        { place: 'Seljalandsfoss', country: 'Iceland', nights: 0, lat: 63.6156, lng: -19.9886, overnight: false },
      ] },
    { name: 'See ice and glaciers', type: 'activity', category: 'scenery-nature',
      section: 'See ice and glaciers', description: 'Glacier lagoon.', iconic: true, durationHours: 3,
      requiredPlaces: [
        { place: 'Jokulsarlon', country: 'Iceland', nights: 0, lat: 64.0784, lng: -16.2306, overnight: false },
        { place: 'Blue Lagoon', country: 'Iceland', nights: 0, lat: 63.8804, lng: -22.4495, overnight: false },
      ] },
  ];
  window.MaxEnginePicker.resetState({
    tripMode: 'place', placeName: 'Iceland', region: 'Iceland',
    candidates: [], chips: [], activityChips: [], requiredPlaces: [],
    interests: ['waterfalls'], drivers: [], avoid: {},
  });
  window._buildDone = false;
  if (window.MaxBuild && window.MaxBuild.on) {
    window.MaxBuild.on('build:done', () => { window._buildDone = true; });
    window.MaxBuild.on('build:error', () => { window._buildDone = true; });
  }
  window.callMax = async (messages) => {
    const p = (messages && messages[0] && messages[0].content) || '';
    if (p.indexOf('Classify each entry') !== -1)
      return JSON.stringify(USERS.map((u, i) => ({ i: i + 1, classification: u.isStay ? 'city' : 'poi',
        parentCity: u.isStay ? null : 'Reykjavik', parentRelation: u.isStay ? null : 'from' })));
    if (p.indexOf('OVERNIGHT FLAG') !== -1) return JSON.stringify(GEN);
    if (p.indexOf('A traveler is planning a trip') !== -1) return '[]'; // skip theming
    throw new Error('dev-seed: no canned response for this call');
  };
  await window._buildPickerFromPastedList(
    { destinations: USERS, tripName: 'Dev Sample — Iceland', region: 'Iceland' },
    USERS.map(u => u.place).join('\n'), {});
  for (let i = 0; i < 240 && !window._buildDone; i++) await new Promise(r => setTimeout(r, 250));
  console.log('[dev-seed] build done:', window._buildDone, '— reloading');
  location.href = './index.html';
})();
```

To make it one-click, save it as a bookmarklet: `javascript:` + the snippet
(minified), then click it on any localhost Max tab.

After it runs you'll have a real Iceland trip — stays, two sight sections with
multiple required places — perfect for smoke-testing the picker, the keep
toggles, the map, etc. Re-run any time for a fresh trip.

## 4. (Optional) real discovery locally

The seeder stubs the LLM. To run *real* discovery/build on localhost, set your
API key via the app's own key UI (the key prompt / settings, backed by
`apikey.mjs`) — it's stored per-origin, so a localhost key never leaks to prod.
Do **not** point the sync URL at the production API for dev; that re-arms
autosave against your real trips.

## 5. Run the gate

```
./dev.sh check          # Node suite + Playwright browser suite
```

Or a single spec while iterating:

```
cd tests/playwright && npx playwright test build-harness --reporter=line
```
