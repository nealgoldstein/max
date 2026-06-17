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

// #2 Stage 3 — SINGLE-ENTRY graph bundle. We synthesize one entry module that
// side-effect-imports every local module in index.html order, and let esbuild
// bundle the whole import graph in ONE pass (each module included exactly once,
// in dependency order — which for today's side-effect-only imports is just the
// entry order). This is the foundation the import-rewiring phase needs: as a
// module switches a `globalThis.X` cross-ref to a real `import`, esbuild dedupes
// it in this same graph (the OLD per-entry approach would have inlined and
// DOUBLE-EXECUTED a shared dependency once real imports existed).
//
// Two deliberate choices for THIS step (behavior must equal the per-entry concat):
//   * treeShaking:false — keep every top-level statement. Modules still publish
//     their API via globalThis (auto-expose.js); dead-code elimination only
//     becomes safe once cross-refs are real imports, so it's off until then.
//   * No minify, keepNames — preserve identifiers so `globalThis.X = X` exposes
//     the right global name. esbuild auto-renames the cross-module private-helper
//     COLLISIONS (api/_norm/on/…) to keep them isolated — strictly better than
//     the per-entry IIFEs, and those names are never exposed anyway.
var entryContents = order.map(function (f) { return 'import "./' + f + '";'; }).join("\n") + "\n";
var built = esbuild.buildSync({
  stdin: { contents: entryContents, resolveDir: ROOT, sourcefile: "app.entry.mjs", loader: "js" },
  bundle: true, format: "iife", platform: "browser",
  treeShaking: false, keepNames: true,
  write: false, logLevel: "silent"
});
var bundle = built.outputFiles[0].text;

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
