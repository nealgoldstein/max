// dev-seed.js — LOCALHOST-ONLY sample-trip seeder button.
//
// Adds a small "🌱 Seed sample trip" button (bottom-right) that injects a known-
// valid trip envelope straight into localStorage and reloads — the same
// `bootSeeded` shape the Playwright suite uses (helpers/seed-trip.js's
// ICELAND_RING), so it's guaranteed schema-valid and needs NO build pipeline /
// LLM / app state. Lets you smoke-test the trip view, picker, keep toggles, and
// map locally with zero console pasting.
//
// PROD-SAFE: the whole thing no-ops unless served from localhost.
(function () {
  "use strict";
  var h = location.hostname;
  if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") return; // never in production

  function sampleEnvelope() {
    var id = "dev-sample-" + Date.now();
    function days(prefix, lbls) {
      return lbls.map(function (l, i) { return { id: "dy_" + prefix + "_" + i, lbl: l, note: "", items: [] }; });
    }
    function dest(d) {
      return Object.assign({
        suggestions: [], restaurantSuggestions: [], hotelBookings: [], generalBookings: [],
        locations: [], execMode: false, todayItems: [], discoveredItems: [], attachedEvents: [],
        trackerItems: { booked: [], see: [], visited: [] }, trackerCat: "booked", storyState: "idle"
      }, d);
    }
    var trip = {
      name: "Dev Sample — Iceland",
      destinations: [
        dest({ id: "d1", place: "Reykjavik", intent: "Capital + Golden Circle base", nights: 3,
          lat: 64.14, lng: -21.94, dateFrom: "2026-08-01", dateTo: "2026-08-04",
          days: days("d1", ["Aug 1", "Aug 2", "Aug 3"]) }),
        dest({ id: "d2", place: "Vik", intent: "South coast — black sand + Reynisfjara", nights: 2,
          lat: 63.42, lng: -19.01, dateFrom: "2026-08-04", dateTo: "2026-08-06",
          days: days("d2", ["Aug 4", "Aug 5"]) }),
        dest({ id: "d3", place: "Höfn", intent: "Glacier lagoon + east coast", nights: 2,
          lat: 64.25, lng: -15.20, dateFrom: "2026-08-06", dateTo: "2026-08-08",
          days: days("d3", ["Aug 6", "Aug 7"]) })
      ],
      legs: {}, pendingActions: [], trackSpending: false,
      brief: { region: "Iceland", when: "August 2026", duration: "7 nights" },
      // candidates + placeActivities so the PICKER has content to toggle too
      candidates: [
        { id: "c1", place: "Reykjavik", role: "stay", status: "keep", lat: 64.14, lng: -21.94, overnightCapable: true },
        { id: "c2", place: "Vik", role: "stay", status: "keep", lat: 63.42, lng: -19.01, overnightCapable: true },
        { id: "c3", place: "Höfn", role: "stay", status: "keep", lat: 64.25, lng: -15.20, overnightCapable: true },
        { id: "c4", place: "Gullfoss", role: "see", status: "keep", lat: 64.3271, lng: -20.1199 },
        { id: "c5", place: "Seljalandsfoss", role: "see", status: "keep", lat: 63.6156, lng: -19.9886 },
        { id: "c6", place: "Jokulsarlon", role: "see", status: "keep", lat: 64.0784, lng: -16.2306 }
      ],
      placeActivities: [
        { id: "pa1", type: "activity", section: "Chase waterfalls", description: "South-coast cascades.", requiredPlaces: [
          { place: "Gullfoss", country: "Iceland", lat: 64.3271, lng: -20.1199, _keep: true, _origin: "user" },
          { place: "Seljalandsfoss", country: "Iceland", lat: 63.6156, lng: -19.9886, _keep: true, _origin: "user" }
        ] },
        { id: "pa2", type: "activity", section: "See ice and glaciers", description: "Glacier lagoon.", requiredPlaces: [
          { place: "Jokulsarlon", country: "Iceland", lat: 64.0784, lng: -16.2306, _keep: true, _origin: "user" }
        ] }
      ]
    };
    return { id: id, envelope: { trip: trip, activeDest: "d1", destCtr: 3, sidCtr: 100, bkCtr: 0, activeDmSection: "sights" } };
  }

  function seed() {
    var btn = document.getElementById("dev-seed-btn");
    try {
      var s = sampleEnvelope();
      // 1) write the trip envelope (same key the app reads: max-trip-<id>)
      localStorage.setItem("max-trip-" + s.id, JSON.stringify(s.envelope));
      // 2) register it in the trips index so the home screen lists it
      var idx = [];
      try { idx = JSON.parse(localStorage.getItem("max-trips-index") || "[]") || []; } catch (_) { idx = []; }
      idx = idx.filter(function (e) { return e && e.id !== s.id; });
      var t = s.envelope.trip;
      idx.unshift({
        id: s.id, name: t.name,
        dateRange: t.destinations[0].dateFrom + " – " + t.destinations[t.destinations.length - 1].dateTo,
        destCount: t.destinations.length,
        startDate: t.destinations[0].dateFrom,
        endDate: t.destinations[t.destinations.length - 1].dateTo,
        savedAt: new Date().toISOString()
      });
      localStorage.setItem("max-trips-index", JSON.stringify(idx));
      console.log("[dev-seed] wrote trip", s.id, "— reloading to home");
      location.href = "./index.html";
    } catch (e) {
      console.error("[dev-seed] failed:", e);
      alert("Seed failed — see console: " + (e && e.message || e));
      if (btn) { btn.disabled = false; btn.textContent = "🌱 Seed sample trip"; }
    }
  }

  function addButton() {
    if (document.getElementById("dev-seed-btn")) return;
    var btn = document.createElement("button");
    btn.id = "dev-seed-btn";
    btn.type = "button";
    btn.textContent = "🌱 Seed sample trip";
    btn.style.cssText =
      "position:fixed;bottom:12px;right:12px;z-index:2147483647;padding:8px 12px;" +
      "font:600 12px/1.2 system-ui,sans-serif;background:#1f7a4d;color:#fff;border:none;" +
      "border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;opacity:.9;";
    btn.onmouseenter = function () { btn.style.opacity = "1"; };
    btn.onmouseleave = function () { btn.style.opacity = ".9"; };
    btn.onclick = function () { btn.disabled = true; btn.textContent = "🌱 Seeding…"; seed(); };
    document.body.appendChild(btn);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") addButton();
  else window.addEventListener("DOMContentLoaded", addButton);
})();
