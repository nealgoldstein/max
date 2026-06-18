// @ts-check
// error-monitor.js — make production failures NOT silent.
//
// Captures UNHANDLED errors (window 'error') and promise rejections
// ('unhandledrejection') into a capped, localStorage-persisted ring buffer
// (survives reload) and console.errors them with a [max-error] tag. Retrieve via
// MaxErrors.recent() / MaxErrors.exportText() — so "it broke and I don't know
// why" becomes "here's the error log to send."
//
// Scope/honesty: this catches UNHANDLED errors app-wide. It does NOT catch the
// many `try {} catch(_) {}` swallows (those never reach window.onerror — fixing
// them is the separate R6/R7-style work). And it stores LOCALLY: to actually
// route errors to you in production you'd add a backend endpoint / Sentry; this
// is the foundation + the retrievable log. Additive + prod-safe; loads first so
// it catches boot-time errors.

(function () {
  "use strict";
  var KEY = "max-error-log", CAP = 50;
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]") || []; } catch (_) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-CAP))); } catch (_) {} }
  function record(kind, msg, detail) {
    try {
      var a = load();
      a.push({ t: new Date().toISOString(), kind: kind, msg: String(msg == null ? "" : msg).slice(0, 500),
               detail: String(detail || "").slice(0, 2000), url: (typeof location !== "undefined" && location.href) || "" });
      save(a);
      try { console.error("[max-error]", kind, msg); } catch (_) {}
    } catch (_) {}
  }
  try {
    window.addEventListener("error", function (e) {
      var st = e && e.error && e.error.stack ? String(e.error.stack) : ((e && e.filename || "") + ":" + (e && e.lineno || ""));
      record("error", e && e.message, st);
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      record("unhandledrejection", (r && r.message) || r, (r && r.stack) ? String(r.stack) : "");
    });
  } catch (_) {}
  var api = {
    recent: function (n) { var a = load(); return n ? a.slice(-n) : a; },
    clear: function () { save([]); return true; },
    exportText: function () {
      return load().map(function (x) { return x.t + " [" + x.kind + "] " + x.msg + (x.detail ? "\n  " + x.detail : ""); }).join("\n");
    },
    record: record
  };
  if (typeof globalThis !== "undefined") globalThis.MaxErrors = api;
})();

export {};
