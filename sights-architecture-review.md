# Sights architecture review — for tomorrow

Written at the end of a 9+ hour session. Neal asked me to figure out why user-listed sights still don't appear in the day plan even after PD.240 collapsed the two known writers.

## Direct answer

There are **at least 3, probably more, places that write to `dest.suggestions`**. I patched 2. The third is at index.html line 54184. There are likely others. Every patch round we found a new one.

The bug isn't a single missing fix. The bug is that the data model has no owner. Anything that wants to populate a destination's sights just assigns to `dest.suggestions =` directly. Nothing enforces invariants. There's no API.

## Map of every `dest.suggestions` writer I found

Search: `grep -n "\.suggestions\s*=\|\.suggestions\.push\|\.suggestions\.splice" index.html`

### Replace-style writers (full overwrite, dangerous)

| Line | Function | What it does | Has user-list guard? |
|------|----------|--------------|----------------------|
| 38130 | `_replaceDestSuggestions` (PD.240) | The intended single writer | **Yes** — preserves `_fromUserList` |
| 38530 | `generateCityData` LLM-call path | Now routes through PD.240 | Yes (via PD.240) |
| 38377 (was) | `generateCityData` cached path | Now routes through PD.240 | Yes (via PD.240) |
| **54184** | **`drawDestMode`-area cache replay** | **NOT patched. Replaces suggestions if empty.** | **No** |
| 39913 | `od.suggestions.push(...)` | Adds to OTHER destination (od = other dest). Some movement logic | Doesn't touch _fromUserList specifically |

### Append-style writers (safer, but still issues)

| Line | Function | What it adds |
|------|----------|--------------|
| 38146 | `_replaceDestSuggestions` (PD.240) | Appends preserved user-list items after replace |
| 38352 | `mergeEssentialsIntoSuggestions` | Appends ATMs/banks/groceries/etc. |
| 38338 | Auto-seed init | `if(!dest.suggestions) dest.suggestions=[]` — only inits |
| 52762 | (need to look) | Init guard |
| 55260 | (need to look) | Init guard |
| 55288 | (need to look) | Push (likely user-action add-sight) |

### Filter-style writers (also dangerous if they don't preserve flags)

| Line | What it does |
|------|--------------|
| 37223 | `dest.suggestions = dest.suggestions.filter(x => x.id !== pick.id)` — removes a sight |
| 38330 | `dest.suggestions = dest.suggestions.filter(s => !placedIds[s.id])` — auto-seed's "remove what's placed" pass |
| 53518 | similar filter |

The filters are dangerous because they recreate the array. If something resets state, the filter's input matters.

## Why every patch round surfaced a new path

When I added PD.223 to attach user-sights, the LLM-call path overwrote them. When I added PD.239 to preserve through the LLM-call path, the cached path was also doing it. When I added PD.240 to handle both, the **line 54184 path** runs at trip-view render time and replaces suggestions from the LLM cache when the view detects them as empty.

There's almost certainly a 4th path. The codebase has 30,000+ lines and `dest.suggestions` is treated as a mutable shared array that any layer can touch.

## The architectural problem in one sentence

**`dest.suggestions` is a public mutable array with no owner, no invariants, and no API. Any code anywhere can replace it, append to it, or filter it, and there's no contract that says "preserve user-list contributions."**

## What would actually fix it

Two options, in increasing order of effort:

### Option A — Inversion of control via getter/setter (1 hour)

Replace `dest.suggestions` with a property that goes through a single setter:

```js
Object.defineProperty(dest, 'suggestions', {
  get: function() { return this._suggestions; },
  set: function(newList) {
    // PRESERVE _fromUserList items
    var preserve = (this._suggestions || []).filter(s => s && s._fromUserList);
    this._suggestions = (newList || []).slice();
    preserve.forEach(/* re-merge */);
  }
});
```

This catches every `dest.suggestions = ...` assignment in the codebase automatically. Nobody can wipe `_fromUserList` items, regardless of which path they came from. Bug fixed at the data layer.

The catch: getter/setter on plain objects survives serialization (JSON.stringify uses the getter), but if `trip.destinations[i]` is rebuilt from JSON via `JSON.parse`, the property descriptor is lost and the protection disappears. Would need to re-install the setter every time a destination is hydrated.

### Option B — Eliminate parallel writers (3-4 hours)

The real fix. Refactor so there's exactly **one** code path that produces `dest.suggestions`:

1. Define a `SightsSource` model:
   - Sources contribute typed items: LLM, user-list, essentials, user-added
   - Sources are stored separately on the destination
   - `dest.suggestions` is computed (memoized) from the sources

2. All current writers become calls to "add to source X":
   - `generateCityData` → adds to LLM source
   - PD.223 → adds to user-list source
   - `mergeEssentialsIntoSuggestions` → adds to essentials source
   - User add-sight → adds to user-added source

3. Reading code stays unchanged — `dest.suggestions` still returns the array.

This is a real refactor. But it permanently kills the class of bug we've been chasing all night.

## My recommendation

Tomorrow morning, do **Option A first** (1 hour) to get the trip working. Validate that Monument appears. Then schedule **Option B** as proper work because option A is a hack against the symptom — the architecture is still broken, just with a guard rail.

If you only have time for one of them, do A. It will work and free up your time to ship the rest of Max instead of fighting this bug class forever.

## State you're leaving with

- All 240 PDs are committed to the working tree, most deployed
- The plan doc `sights-rearchitecture-plan.md` describes the bucket-based architecture (which is still right; it correctly identifies sights as the wrong destinations)
- This doc describes the third architectural layer (suggestions writers) that's still broken
- The 329 tests pass

## Things I got wrong tonight that you should remember

1. I diagnosed paths instead of the architecture for ~6 hours before you forced me to step back. Each "path fix" introduced a new dependency on a different code path's order of execution.
2. I shipped PD.240 without grep'ing for all writers first. Five seconds of `grep -n "\.suggestions\s*="` would have shown me line 54184 immediately.
3. I kept calling things "architectural fix" when they were patches. PD.234 (the bucket refactor) was a real architectural fix. PD.239 and PD.240 are patches that look architectural.

Sleep well. The work is documented enough that you (or I) can pick it up tomorrow without re-loading 9 hours of context.
