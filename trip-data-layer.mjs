// @ts-check
// trip-data-layer.js — #3 god-module decomposition, carve 2. The wisp system
// + must-do data layer + intent-string helpers, extracted verbatim from
// app-main.js (PD.401g pattern: functions unchanged, still run as globals via
// auto-expose; only their home moved). Pure trip-data transforms; the lone
// external dependency is autoSave (a runtime global).

function _wispsArray(trip) {
  if (!trip) return [];
  if (!trip.brief) trip.brief = {};
  if (!trip.brief.tripMeta) trip.brief.tripMeta = {};
  if (!Array.isArray(trip.brief.tripMeta.wisps)) trip.brief.tripMeta.wisps = [];
  return trip.brief.tripMeta.wisps;
}
function _wispsArrayMigrated(trip) {
  if (!trip) return [];
  // Run both migrations before returning the array. _wispsArray itself
  // is also called *from inside* the migration helpers, so this wrapper
  // is the safe entry point for external callers that want a fully-
  // migrated view (modal, history link, captured-ideas surfaces).
  _wispMigrateLegacy(trip);
  _wispMigrateInitialIntent(trip);
  _wispDedupeInitial(trip);
  _mdcItemsDedupe(trip);
  return _wispsArray(trip);
}

// v360.2: collapse duplicate mdcItems by name. The LLM extraction
// sometimes produces multiple condition items with the same name (e.g.
// "Northern Lights viewing" once per viable location), and those all
// get persisted into trip.placeActivities[]. The picker then renders one row
// per item, producing the visible duplicates the user is seeing.
//
// Merge rule: items with the same case-folded name collapse to one
// (the first occurrence wins as the canonical record). Their
// requiredPlaces[] arrays union by place key — so a "Northern Lights"
// item ends up with viable locations from all the original copies.
// Any wisp.resultItemIds[] pointing at a now-deleted item gets
// rewritten to the kept item's id, so the lineage trace stays intact.
//
// Idempotent — safe to run on every read.
function _mdcItemsDedupe(trip) {
  if (!trip || !Array.isArray(trip.placeActivities)) return false;
  var seen = {};
  var keep = [];
  var idMap = {};
  var removed = 0;
  var removedSample = [];
  trip.placeActivities.forEach(function (m) {
    if (!m || !m.name) { keep.push(m); return; }
    var key = String(m.name).trim().toLowerCase();
    if (!key) { keep.push(m); return; }
    if (seen[key]) {
      // Merge requiredPlaces into the kept item (union by place name).
      var existing = seen[key];
      if (Array.isArray(m.requiredPlaces)) {
        if (!Array.isArray(existing.requiredPlaces)) existing.requiredPlaces = [];
        var existingKeys = {};
        existing.requiredPlaces.forEach(function (p) {
          if (p && p.place) existingKeys[String(p.place).toLowerCase()] = true;
        });
        m.requiredPlaces.forEach(function (p) {
          if (p && p.place && !existingKeys[String(p.place).toLowerCase()]) {
            existing.requiredPlaces.push(p);
            existingKeys[String(p.place).toLowerCase()] = true;
          }
        });
      }
      // If the duplicate carries a _fromWispId and the keeper doesn't,
      // adopt it so the lineage trace survives the merge.
      if (m._fromWispId && !existing._fromWispId) {
        existing._fromWispId = m._fromWispId;
      }
      // Preserve "checked" if either copy was checked.
      if (m.checked) existing.checked = true;
      idMap[m.id] = existing.id;
      removed++;
      if (removedSample.length < 5) removedSample.push(m.name);
      return;
    }
    seen[key] = m;
    keep.push(m);
  });
  if (removed > 0) {
    trip.placeActivities = keep;
    // Rewrite wisp.resultItemIds[] so traces point at kept items.
    _wispsArray(trip).forEach(function (w) {
      if (!w || !Array.isArray(w.resultItemIds)) return;
      var seenIds = {};
      w.resultItemIds = w.resultItemIds
        .map(function (rid) { return idMap[rid] || rid; })
        .filter(function (rid) {
          if (seenIds[rid]) return false;
          seenIds[rid] = true;
          return true;
        });
    });
    console.log('[mdc-dedupe] removed ' + removed + ' duplicate mdcItem(s):', removedSample);
    if (typeof autoSave === "function") {
      try { autoSave(); } catch (_) {}
    }
  }
  return removed > 0;
}
if (typeof globalThis !== "undefined") globalThis._mdcItemsDedupe = _mdcItemsDedupe;
// v360.2: clean up duplicate _initial wisps. The migration source
// (trip.brief.mustDo) sometimes contains repeated content because it
// was constructed by joining LLM-extracted mdcItem names, and the LLM
// produces multiple items with the same name when a condition (e.g.
// "Northern Lights viewing") applies to multiple viable locations.
// Idempotent — safe to run on every read.
// v360.2 (A.3): keep initial-WHY wisps in sync with edits to the trip's
// primary intent string. When the user edits trip.brief.intent (via the
// constraints editor / Trip profile chip), we diff the new fragments
// against the existing _initialKind:'why' wisps:
//
//   • Wisps whose text no longer appears in the new intent → dropped
//     (the user has rescinded that part of the why)
//   • New fragments not yet represented → added as new initial-why
//     wisps with current capturedAt (these are "freshly committed" why
//     intents, not original-at-creation)
//   • Wisps that still appear → kept untouched (preserves resultItemIds
//     and the original capturedAt timestamp)
//
// _initialKind:'anchor' wisps are not touched — the mustDo field isn't
// editable from the constraints editor, so there's nothing to sync.
// New wisps captured later via the Spark intake aren't touched either.
// Operates only on _initialKind:'why' wisps.
//
// Returns true if anything changed (so caller can trigger autoSave).
function _syncInitialIntentWisps(trip, newIntentText) {
  if (!trip || !trip.brief) return false;
  if (!trip.brief.tripMeta) trip.brief.tripMeta = {};
  var wisps = _wispsArray(trip);
  var newFrags = (typeof _splitIntentString === "function")
    ? _splitIntentString(newIntentText || '')
    : [];
  function _k(s) { return String(s || '').trim().toLowerCase(); }
  var newKeySet = {};
  newFrags.forEach(function (f) { newKeySet[_k(f)] = true; });
  var existingKeys = {};
  wisps.forEach(function (w) {
    if (w && w._initial && w._initialKind === 'why') existingKeys[_k(w.text)] = true;
  });
  // Drop why-wisps whose text no longer appears in the new intent.
  var dropped = 0;
  var droppedSample = [];
  var newWisps = wisps.filter(function (w) {
    if (!w) return false;
    if (!w._initial || w._initialKind !== 'why') return true;
    if (newKeySet[_k(w.text)]) return true;
    dropped++;
    if (droppedSample.length < 5) droppedSample.push(w.text);
    return false;
  });
  // Add new why-wisps for fragments not yet represented. Use case-
  // folded comparison so "Northern lights" doesn't double-up with
  // "northern lights".
  var added = 0;
  var addedSample = [];
  var now = (new Date()).toISOString();
  newFrags.forEach(function (f) {
    if (existingKeys[_k(f)]) return;
    newWisps.push({
      id: 'w-init-edit-' + Date.now() + '-' + added + '-' + Math.random().toString(36).slice(2, 5),
      text: f,
      capturedAt: now,
      processedAt: now,
      resultItemIds: [],
      _initial: true,
      _initialKind: 'why',
    });
    added++;
    addedSample.push(f);
  });
  if (dropped > 0 || added > 0) {
    trip.brief.tripMeta.wisps = newWisps;
    console.log('[wisp-sync-intent] dropped ' + dropped + ' / added ' + added,
      { dropped: droppedSample, added: addedSample });
    return true;
  }
  return false;
}
if (typeof globalThis !== "undefined") globalThis._syncInitialIntentWisps = _syncInitialIntentWisps;

function _wispDedupeInitial(trip) {
  if (!trip) return false;
  var wisps = _wispsArray(trip);
  var seen = {};
  var keep = [];
  var removed = 0;
  var removedSample = [];
  wisps.forEach(function (w) {
    if (!w) return;
    if (!w._initial) { keep.push(w); return; }
    var key = String(w.text || '').trim().toLowerCase();
    if (!key) { removed++; return; } // drop empty fragments
    if (seen[key]) {
      removed++;
      if (removedSample.length < 5) removedSample.push(w.text);
      return;
    }
    seen[key] = true;
    keep.push(w);
  });
  if (removed > 0) {
    trip.brief.tripMeta.wisps = keep;
    console.log("[wisp-dedupe-initial] removed " + removed + " duplicate initial wisp(s):", removedSample);
    // Persist the cleanup or it'll come back on the next sync pull.
    if (typeof autoSave === "function") {
      try { autoSave(); } catch (_) {}
    }
  }
  return removed > 0;
}
// v360.2: split a free-text "intent" or "must-do" string into individual
// wisp fragments. The user types comma-joined or "and"-joined lists at
// trip creation ("see volcanic landscape and northern lights"; "Blue
// Lagoon, Mývatn, Skogafoss"), but each fragment is its own current in
// the Spark stream — they should become separate wisps. Splits on both
// commas and the word "and" with surrounding whitespace.
//
// Empty or 1-char fragments are dropped; everything else is trimmed and
// returned in order.
function _splitIntentString(s) {
  if (!s || typeof s !== 'string') return [];
  // Split on commas, " and ", " or ", or semicolons. Case-insensitive.
  return s.split(/,\s*|\s+and\s+|\s+or\s+|\s*;\s*/i)
    .map(function (f) { return f.trim(); })
    .filter(function (f) { return f.length > 1; });
}

// v360.2: migrate the trip's initial intent + must-do fields into the
// wisp stream as `_initial: true` records. The unification refactor's
// goal is that Spark is one stream — the original "why" the user typed
// at creation is just the first batch of wisps. This makes that true at
// the data layer (subsequent slices will update the UI + LLM paths).
//
// Idempotent: runs once per trip, gated by trip.brief.tripMeta._initialMigrated.
// Initial wisps are stamped processedAt = trip.createdAt (or now) because
// their content already drove the first Discovery extraction back at
// trip creation — they're not "unprocessed" in the late-binding sense.
function _wispMigrateInitialIntent(trip) {
  if (!trip || !trip.brief) return false;
  if (!trip.brief.tripMeta) trip.brief.tripMeta = {};
  var meta = trip.brief.tripMeta;
  if (meta._initialMigrated) return false;
  // Also bail if any _initial wisps already exist — defensive against
  // a partial earlier migration.
  var wisps = _wispsArray(trip);
  var hasInitial = wisps.some(function (w) { return w && w._initial; });
  if (hasInitial) {
    meta._initialMigrated = true;
    // Persist the flag so a sync poll doesn't clobber it and force
    // re-migration on next read.
    if (typeof autoSave === "function") { try { autoSave(); } catch (_) {} }
    return false;
  }
  var intentFrags = _splitIntentString(trip.brief.intent || trip.brief.aboutTrip || '');
  var mustDoFrags = _splitIntentString(trip.brief.mustDo || trip.brief.anchors || '');
  if (!intentFrags.length && !mustDoFrags.length) {
    meta._initialMigrated = true;
    if (typeof autoSave === "function") { try { autoSave(); } catch (_) {} }
    return false;
  }
  // Dedupe fragments at the source — same key as _wispDedupeInitial.
  // Without this, "Northern Lights viewing" appearing four times in
  // mustDo (because the LLM produced four condition items with that
  // exact name, joined into mustDo) creates four wisps; only one
  // survives the dedupe pass after, but the migration churn means new
  // wisps with fresh IDs get created each load if persistence didn't
  // take. Dedupe at creation prevents the churn entirely.
  var seenKey = {};
  function _key(text) { return String(text || '').trim().toLowerCase(); }
  var procAt = trip.createdAt || (new Date()).toISOString();
  var capAt = trip.createdAt || (new Date()).toISOString();
  var added = 0;
  function _push(text, kind) {
    if (!text) return;
    var k = _key(text);
    if (!k) return;
    if (seenKey[k]) return;
    seenKey[k] = true;
    wisps.push({
      id: 'w-init-' + Date.now() + '-' + added + '-' + Math.random().toString(36).slice(2, 5),
      text: text,
      capturedAt: capAt,
      processedAt: procAt,
      resultItemIds: [],
      _initial: true,
      _initialKind: kind,  // 'why' for intent fragments, 'anchor' for mustDo fragments
    });
    added++;
  }
  intentFrags.forEach(function (f) { _push(f, 'why'); });
  mustDoFrags.forEach(function (f) { _push(f, 'anchor'); });
  meta._initialMigrated = true;
  console.log("[wisp-migrate-initial] added " + added + " initial wisps for trip " + (trip.name || _currentTripId));
  // CRITICAL: persist immediately. Without autoSave, sync polling can
  // re-pull the server's pre-migration trip object and the migration
  // will run again on the next read, churning out new wisps each time.
  if (added > 0 && typeof autoSave === "function") {
    try { autoSave(); } catch (_) {}
  }
  return added > 0;
}

function _wispMigrateLegacy(trip) {
  if (!trip || !trip.brief || !trip.brief.tripMeta) return false;
  var meta = trip.brief.tripMeta;
  if (meta._wispsMigrated) return false;
  var notes = (meta.notes || '');
  if (!notes || notes.indexOf('✨') < 0) {
    meta._wispsMigrated = true;
    return false;
  }
  var lines = notes.split(/\r?\n/);
  var kept = [];
  var migrated = 0;
  var now = new Date().toISOString();
  var wisps = _wispsArray(trip);
  lines.forEach(function (ln) {
    var trimmed = ln.replace(/^[\s​]+/, '');
    if (trimmed.indexOf('✨') === 0) {
      var text = trimmed.replace(/^✨\s*/, '').trim();
      if (text) {
        wisps.push({
          id: 'w-' + Date.now() + '-' + migrated + '-' + Math.random().toString(36).slice(2, 6),
          text: text,
          capturedAt: now,          // best guess; original timestamp not preserved
          processedAt: null,
          resultItemIds: [],
        });
        migrated++;
        return;
      }
    }
    kept.push(ln);
  });
  if (migrated > 0) meta.notes = kept.join('\n').replace(/\n+$/, '');
  meta._wispsMigrated = true;
  return migrated > 0;
}
function _wispAdd(trip, text) {
  if (!trip || !text) return null;
  _wispMigrateLegacy(trip);
  var wisps = _wispsArray(trip);
  var w = {
    id: 'w-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    text: String(text).trim(),
    capturedAt: new Date().toISOString(),
    processedAt: null,
    resultItemIds: [],
  };
  wisps.push(w);
  return w;
}
function _wispUnprocessed(trip) {
  if (!trip) return [];
  _wispMigrateLegacy(trip);
  _wispMigrateInitialIntent(trip);
  return _wispsArray(trip).filter(function (w) { return w && !w.processedAt; });
}
function _wispMarkProcessed(trip, wispIds, resultItemIds) {
  if (!trip || !Array.isArray(wispIds) || !wispIds.length) return 0;
  var idSet = {};
  wispIds.forEach(function (id) { if (id) idSet[id] = true; });
  var resultIds = Array.isArray(resultItemIds) ? resultItemIds : [];
  var now = new Date().toISOString();
  var n = 0;
  _wispsArray(trip).forEach(function (w) {
    if (w && idSet[w.id] && !w.processedAt) {
      w.processedAt = now;
      if (resultIds.length) w.resultItemIds = (w.resultItemIds || []).concat(resultIds);
      n++;
    }
  });
  return n;
}
// v360.2: delete a wisp (and optionally the mdcItems it produced).
// When also=true, every place/route/condition Max generated from this
// wisp is removed from trip.placeActivities[] in the same call — useful when
// the wisp was a bad idea and so were its results. Default behavior
// (also=false) keeps the produced items in case the user still wants
// some of them; they live as ordinary mdcItems with no wisp reference.
function _wispDelete(trip, wispId, alsoDeleteItems) {
  if (!trip || !wispId) return 0;
  var wisps = _wispsArray(trip);
  var wisp = null;
  var keep = [];
  wisps.forEach(function (w) {
    if (w && w.id === wispId) { wisp = w; }
    else keep.push(w);
  });
  if (!wisp) return 0;
  trip.brief.tripMeta.wisps = keep;
  var removed = 1;
  if (alsoDeleteItems && Array.isArray(/** @type {any} */(wisp).resultItemIds) && /** @type {any} */(wisp).resultItemIds.length) {
    var idSet = {};
    /** @type {any} */(wisp).resultItemIds.forEach(function (id) { idSet[id] = true; });
    if (Array.isArray(trip.placeActivities)) {
      trip.placeActivities = trip.placeActivities.filter(function (m) {
        if (m && idSet[m.id]) { removed++; return false; }
        return true;
      });
    }
  }
  // v360.2: a delete invalidates any "just evaluated" celebration. The
  // green Discovery panel and the in-picker banner both read from
  // window._lastWispEvalResult; if the user is now undoing the result,
  // that banner is no longer truthful. Clear it.
  if (typeof window !== "undefined" && window._lastWispEvalResult) {
    window._lastWispEvalResult = null;
  }
  return removed;
}
// Delete an mdcItem outright. Also scrubs the id from any wisp's
// resultItemIds[] so the wisp's "produced N items" count stays honest.
function _mdcItemDelete(trip, itemId) {
  if (!trip || !itemId || !Array.isArray(trip.placeActivities)) return false;
  var before = trip.placeActivities.length;
  trip.placeActivities = trip.placeActivities.filter(function (m) { return !(m && m.id === itemId); });
  if (trip.placeActivities.length === before) return false;
  _wispsArray(trip).forEach(function (w) {
    if (w && Array.isArray(w.resultItemIds)) {
      w.resultItemIds = w.resultItemIds.filter(function (rid) { return rid !== itemId; });
    }
  });
  // v360.2: invalidate "just evaluated" celebration when the deleted
  // item was one of the freshly-added ones — the banner would still
  // claim "Max added N things" but one of them is now gone.
  if (typeof window !== "undefined" && window._lastWispEvalResult &&
      Array.isArray(window._lastWispEvalResult.addedItemIds) &&
      window._lastWispEvalResult.addedItemIds.indexOf(itemId) >= 0) {
    window._lastWispEvalResult = null;
  }
  return true;
}

export { _wispsArray, _wispsArrayMigrated, _mdcItemsDedupe, _syncInitialIntentWisps, _wispDedupeInitial, _splitIntentString, _wispMigrateInitialIntent, _wispMigrateLegacy, _wispAdd, _wispUnprocessed, _wispMarkProcessed, _wispDelete, _mdcItemDelete };

/* #2 Stage 2 interim (auto-expose.js): re-publish this module's non-colliding top-level
   declarations as globals. esbuild isolates each .mjs to an IIFE, so other
   modules' and app-main.js's bare-global / window.X reads would otherwise
   break. Generated by `npm run expose`; verified by `npm run expose:check`
   in the gate. Removed when the import-rewiring phase lands real imports. */
{
  const __expg = /** @type {any} */ (globalThis);
  __expg._mdcItemDelete = _mdcItemDelete;
  __expg._mdcItemsDedupe = _mdcItemsDedupe;
  __expg._splitIntentString = _splitIntentString;
  __expg._syncInitialIntentWisps = _syncInitialIntentWisps;
  __expg._wispAdd = _wispAdd;
  __expg._wispDedupeInitial = _wispDedupeInitial;
  __expg._wispDelete = _wispDelete;
  __expg._wispMarkProcessed = _wispMarkProcessed;
  __expg._wispMigrateInitialIntent = _wispMigrateInitialIntent;
  __expg._wispMigrateLegacy = _wispMigrateLegacy;
  __expg._wispUnprocessed = _wispUnprocessed;
  __expg._wispsArray = _wispsArray;
  __expg._wispsArrayMigrated = _wispsArrayMigrated;
}
