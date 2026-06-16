#!/usr/bin/env node
/* build.js — Phase B (extensibility lever #2) bootstrap.
 *
 * Produces dist/app.bundle.js by concatenating the LOCAL module <script src>
 * files in the exact order index.html loads them. Concatenation (not esbuild
 * --bundle) is deliberate for v1: the app is still a classic-script app where
 * modules share state through globals + rely on load order. Concatenating in
 * order preserves that behavior EXACTLY (same global scope, same sequence) —
 * the browser already executes these files back-to-back; this just emits them
 * as one artifact. So a dist/app.bundle.js + the inline index.html script +
 * the vendor scripts is behaviorally identical to today's 60 tags.
 *
 * This is the foundation #2 (ES-module migration) plugs into: as each module is
 * converted to import/export, it moves from this concat list into a real
 * esbuild entry graph, leaf-first, with the Playwright suite gating each step.
 *
 * Verify path (for CI / your machine — can't be confirmed in the agent sandbox,
 * which only serves the raw files): build, point an index variant at the bundle,
 * run the full Playwright suite against it. Until that's wired, CI just gates
 * that the bundle BUILDS and is valid JS (`node --check`).
 *
 * Usage:  node build.js   (or: npm run build)
 */
"use strict";
var fs = require("fs");
var path = require("path");
var esbuild = require("esbuild");

var ROOT = __dirname;
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// Pull <script src="..."> in document order; keep only LOCAL .js (skip vendor +
// CDN/absolute URLs). Strip any ?v= cache-buster.
var srcRe = /<script\b[^>]*\bsrc="([^"]+)"/g;
var order = [];
var m;
while ((m = srcRe.exec(html)) !== null) {
  var src = m[1].replace(/\?.*$/, "");
  if (/^https?:\/\//.test(src)) continue;        // CDN
  if (/(^|\/)vendor\//.test(src)) continue;       // vendored libs
  // app-main.js (the extracted monolith body) loads AFTER the page body, so it
  // must stay a standalone tag at its own position — concatenating it into the
  // early module bundle would run it before the DOM exists. Keep it out of the
  // concat; index.bundle.html leaves its tag in place.
  if (/(^|\/)app-main\.js$/.test(src)) continue;
  if (!/\.m?js$/.test(src)) continue;
  order.push(src.replace(/^\//, ""));
}

var missing = order.filter(function (f) { return !fs.existsSync(path.join(ROOT, f)); });
if (missing.length) {
  console.error("[build] referenced scripts not found:\n  " + missing.join("\n  "));
  process.exit(1);
}

// `;\n` between files guards against ASI hazards (a file ending without a
// semicolon followed by one starting with `(`).
//
// INTERIM bundling for #2 Stage 2 (NOT the final form). No .mjs has a real
// cross-module `import` yet — every module still shares state through globals
// (explicit globalThis.X exposure AND implicit top-level bindings that other
// modules read as bare globals). That means esbuild-per-entry is the WRONG tool
// here: `format:"iife"` wraps each module in its own function scope, which
// module-scopes those top-level bindings and breaks every bare cross-module read
// (it would also double-execute any real import, since each entry re-bundles its
// deps). The app today depends on global scope, so we reproduce it: for .mjs,
// strip the trailing top-level export statements and concatenate the module as
// global-scope classic code — byte-for-byte the behavior these files had when
// they were .js. The SOURCE keeps its `export`s (so TypeScript treats them as
// modules and raw index.html's type=module tags stay valid); only the bundled
// OUTPUT is globalized. When the import-rewiring phase lands real import graphs,
// this branch is replaced by a single-entry `esbuild.buildSync({bundle:true})`
// that follows the import tree (and `esbuild` stays required for that).
var EXPORT_LINE = /^[ \t]*export\s+(?:default\s+[\w$.]+|\{[^}]*\})\s*;?[ \t]*$/gm;

// Concat collision guard. In one shared scope, two modules declaring the same
// top-level `const`/`let` name is a hard SyntaxError ("already been declared").
// Classic `var`/`function` are redeclarable so they never collide; only block-
// scoped top-level decls do. Collect them per module and fail the build with a
// precise message if any name (other than the `global` typing alias, demoted to
// var below) appears in more than one module — so a future batch trips this at
// build time, not as a cryptic 14-minute Playwright red.
var TOP_LEXICAL = /^(?:const|let)[ \t]+([A-Za-z_$][\w$]*)/gm;
var lexOwners = {};
order.forEach(function (f) {
  if (!/\.mjs$/.test(f)) return;
  var src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  var mm; while ((mm = TOP_LEXICAL.exec(src)) !== null) {
    var name = mm[1];
    if (name === "global") continue; // demoted to var in the concat below
    (lexOwners[name] = lexOwners[name] || []).push(f);
  }
});
var collisions = Object.keys(lexOwners).filter(function (n) {
  return lexOwners[n].length > 1;
});
if (collisions.length) {
  console.error("[build] top-level const/let name collision across concatenated modules:");
  collisions.forEach(function (n) {
    console.error("  '" + n + "' in: " + lexOwners[n].join(", "));
  });
  console.error("  Rename one, or make it a `var`, so the global-scope concat stays valid.");
  process.exit(1);
}

var bundle = order.map(function (f) {
  var header = "/* ===== " + f + " ===== */\n";
  var code = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (/\.mjs$/.test(f)) {
    code = code.replace(EXPORT_LINE, "");
    // The `const/let global = (globalThis)` typing alias is identical in every
    // module; demote to `var` so the 24 copies coexist in the concatenated scope.
    code = code.replace(/^([ \t]*)(?:const|let)([ \t]+global[ \t]*=)/gm, "$1var$2");
  }
  return header + code;
}).join("\n;\n");

var outDir = path.join(ROOT, "dist");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
var outFile = path.join(outDir, "app.bundle.js");
fs.writeFileSync(outFile, bundle);

console.log("[build] bundled " + order.length + " local modules → dist/app.bundle.js ("
  + (bundle.length / 1024).toFixed(0) + " KB)");

// Phase B verify harness: emit index.bundle.html — index.html with the
// contiguous local-module <script src> tags collapsed to a single bundle tag (at
// the first one's position; the rest removed). Vendor + the inline block are
// untouched, and the modules still load before the inline block, so it's a
// behavior-equivalent load variant the bundle can be SMOKE-TESTED through
// (Chrome against the dev server, or Playwright in CI) before any ESM cutover.
var bundledHtml = html;
var inserted = false;
order.forEach(function (rel) {
  var esc = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var re = new RegExp('[ \\t]*<script[^>]*\\bsrc="/?' + esc + '(\\?[^"]*)?"[^>]*></script>\\n?');
  bundledHtml = bundledHtml.replace(re, inserted ? "" : '<script src="dist/app.bundle.js?v=DEV"></script>\n');
  inserted = true;
});
fs.writeFileSync(path.join(ROOT, "index.bundle.html"), bundledHtml);
console.log("[build] wrote index.bundle.html (bundle load variant for verification)");
