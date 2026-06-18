// dev-seed.js — LOCALHOST-ONLY sample-trip seeder button.
//
// Adds a small "🌱 Seed sample trip" button (bottom-right) that builds a real
// sample trip via the app's OWN engine with canned LLM responses — the same
// path the green build-harness test uses, so the trip is always schema-correct
// and saved through the normal path. Lets you smoke-test the picker / keep
// toggles / map locally without any console pasting.
//
// PROD-SAFE: the whole thing no-ops unless the page is served from localhost.
// Loaded by index.html via a plain <script> tag; uses window globals at CLICK
// time (after the app has finished loading), so module load order is irrelevant.
(function () {
  "use strict";
  var h = location.hostname;
  if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") return; // never in production

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
    btn.onclick = seed;
    document.body.appendChild(btn);
  }

  async function seed() {
    var btn = document.getElementById("dev-seed-btn");
    if (btn) { btn.disabled = true; btn.textContent = "🌱 Seeding…"; }
    try {
      if (!window.MaxEnginePicker || typeof window._buildPickerFromPastedList !== "function") {
        alert("App not loaded yet — wait a second and click again.");
        if (btn) { btn.disabled = false; btn.textContent = "🌱 Seed sample trip"; }
        return;
      }
      var USERS = [
        { place: "Reykjavik", isStay: true }, { place: "Vik", isStay: true },
        { place: "Hofn", isStay: true },
        { place: "Gullfoss", isStay: false }, { place: "Seljalandsfoss", isStay: false },
        { place: "Jokulsarlon", isStay: false }, { place: "Blue Lagoon", isStay: false }
      ];
      var GEN = [
        { name: "Chase waterfalls", type: "activity", category: "scenery-nature",
          section: "Chase waterfalls", description: "South-coast cascades.", iconic: true, durationHours: 4,
          requiredPlaces: [
            { place: "Gullfoss", country: "Iceland", nights: 0, lat: 64.3271, lng: -20.1199, overnight: false },
            { place: "Seljalandsfoss", country: "Iceland", nights: 0, lat: 63.6156, lng: -19.9886, overnight: false }
          ] },
        { name: "See ice and glaciers", type: "activity", category: "scenery-nature",
          section: "See ice and glaciers", description: "Glacier lagoon.", iconic: true, durationHours: 3,
          requiredPlaces: [
            { place: "Jokulsarlon", country: "Iceland", nights: 0, lat: 64.0784, lng: -16.2306, overnight: false },
            { place: "Blue Lagoon", country: "Iceland", nights: 0, lat: 63.8804, lng: -22.4495, overnight: false }
          ] }
      ];
      window.MaxEnginePicker.resetState({
        tripMode: "place", placeName: "Iceland", region: "Iceland",
        candidates: [], chips: [], activityChips: [], requiredPlaces: [],
        interests: ["waterfalls"], drivers: [], avoid: {}
      });
      window._buildDone = false;
      if (window.MaxBuild && window.MaxBuild.on) {
        window.MaxBuild.on("build:done", function () { window._buildDone = true; });
        window.MaxBuild.on("build:error", function () { window._buildDone = true; });
      }
      window.callMax = async function (messages) {
        var p = (messages && messages[0] && messages[0].content) || "";
        if (p.indexOf("Classify each entry") !== -1) {
          return JSON.stringify(USERS.map(function (u, i) {
            return { i: i + 1, classification: u.isStay ? "city" : "poi",
              parentCity: u.isStay ? null : "Reykjavik", parentRelation: u.isStay ? null : "from" };
          }));
        }
        if (p.indexOf("OVERNIGHT FLAG") !== -1) return JSON.stringify(GEN);
        if (p.indexOf("A traveler is planning a trip") !== -1) return "[]"; // skip theming
        throw new Error("dev-seed: no canned response for this call");
      };
      await window._buildPickerFromPastedList(
        { destinations: USERS, tripName: "Dev Sample — Iceland", region: "Iceland" },
        USERS.map(function (u) { return u.place; }).join("\n"), {});
      for (var i = 0; i < 240 && !window._buildDone; i++) { await new Promise(function (r) { setTimeout(r, 250); }); }
      console.log("[dev-seed] build done:", window._buildDone, "— reloading");
      location.href = "./index.html";
    } catch (e) {
      console.error("[dev-seed] failed:", e);
      alert("Seed failed — see console: " + (e && e.message || e));
      if (btn) { btn.disabled = false; btn.textContent = "🌱 Seed sample trip"; }
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") addButton();
  else window.addEventListener("DOMContentLoaded", addButton);
})();
