// @ts-check
// backup.js — a recovery net for the persistence layer, independent of Turso
// sync. The persistence path (localStorage → IndexedDB overflow, sync conflicts,
// schema migration) is the one place a rare edge can corrupt or lose a REAL
// trip. This gives a user-controlled, offline copy + restore.
//
//   MaxBackup.exportAll()        → downloads every trip + the index as one JSON
//   MaxBackup.exportText()       → same payload as a string (no download)
//   MaxBackup.importAll(text)    → restores trips + index (MERGE — never deletes)
//
// Export is side-effect-free (read-only). Import only writes/merges. Additive +
// prod-safe; wire MaxBackup.exportAll() to a Settings button for end users.

(function () {
  "use strict";
  function _db() { return (typeof globalThis !== "undefined") && /** @type {any} */ (globalThis).MaxDB; }

  function exportText() {
    var db = _db();
    if (!db || !db.trip || !db.index) return null;
    var ids = (db.trip.listIds && db.trip.listIds()) || [];
    var trips = {};
    ids.forEach(function (id) { try { var raw = db.trip.readRaw(id); if (raw != null) trips[id] = raw; } catch (_) {} });
    return JSON.stringify({
      _maxBackup: 1, exportedAt: new Date().toISOString(),
      index: (db.index.load && db.index.load()) || [], trips: trips
    });
  }

  function exportAll() {
    var text = exportText();
    if (text == null) { try { alert("Backup unavailable — storage not ready."); } catch (_) {} return null; }
    try {
      var blob = new Blob([text], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "max-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) {} }, 1000);
    } catch (_) {}
    var n = 0; try { n = Object.keys(JSON.parse(text).trips || {}).length; } catch (_) {}
    return { trips: n };
  }

  function importAll(text) {
    var db = _db();
    if (!db || !db.trip) return { error: "storage not ready" };
    var payload; try { payload = JSON.parse(text); } catch (e) { return { error: "bad JSON" }; }
    if (!payload || !payload.trips || payload._maxBackup !== 1) return { error: "not a Max backup" };
    var restored = 0;
    Object.keys(payload.trips).forEach(function (id) {
      try { if (db.trip.writeRaw) { db.trip.writeRaw(id, payload.trips[id]); restored++; } } catch (_) {}
    });
    if (Array.isArray(payload.index) && db.index && db.index.upsert) {
      payload.index.forEach(function (e) { try { if (e && e.id) db.index.upsert(e); } catch (_) {} });
    }
    return { restored: restored };
  }

  if (typeof globalThis !== "undefined") {
    /** @type {any} */ (globalThis).MaxBackup = { exportAll: exportAll, exportText: exportText, importAll: importAll };
  }
})();

export {};
