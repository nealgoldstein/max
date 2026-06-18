#!/usr/bin/env node
/* check-classic-exposes.js — guards a DEV-ONLY boot-halt class.
 *
 * app-main.js is a CLASSIC <script>; in dev it runs BEFORE the deferred .mjp
 * modules. So a top-level line like
 *     globalThis._pmRtCmd = _pmRtCmd;
 * that reads a bare symbol app-main no longer DEFINES (because the function was
 * migrated into a .mjs) throws ReferenceError at boot — and since the symbol
 * exists in the BUNDLE (modules concatenated before app-main), the Playwright
 * bundle gate stays green while localhost/dev is broken. This static check
 * closes that gap: every bare-RHS expose in app-main.js must reference a symbol
 * app-main itself declares.
 *
 * Usage: node tools/check-classic-exposes.js   (exit 1 on any landmine)
 */
"use strict";
var fs = require("fs");
var path = require("path");
var FILE = path.join(__dirname, "..", "app-main.js");
var src = fs.readFileSync(FILE, "utf8").split("\n");

var defined = Object.create(null);
src.forEach(function (ln) {
  var m;
  var reFn = /\bfunction\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reFn.exec(ln))) defined[m[1]] = true;
  var reVar = /\b(?:var|const|let)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reVar.exec(ln))) defined[m[1]] = true;
});

var landmines = [];
src.forEach(function (ln, i) {
  // globalThis.X = X;  or  window.X = X;   (bare RHS, same name)
  var m = ln.match(/^\s*(?:globalThis|window)\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/);
  if (m && m[1] === m[2] && !defined[m[1]]) landmines.push({ line: i + 1, sym: m[1] });
});

if (landmines.length) {
  console.error("[check-classic-exposes] FAIL — app-main.js exposes " + landmines.length +
    " symbol(s) it does not define (bare ReferenceError at dev boot):");
  landmines.forEach(function (l) { console.error("  app-main.js:" + l.line + "  " + l.sym); });
  console.error("Fix: remove the stale expose line(s) — the symbol now lives in a .mjs that\n" +
    "exposes itself, OR restore the definition in app-main.js.");
  process.exit(1);
}
console.log("[check-classic-exposes] OK — no stale bare-expose landmines in app-main.js.");
