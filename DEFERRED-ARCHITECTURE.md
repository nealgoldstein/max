# Discovery — architecture state & deferred work

## What the architecture IS now (load-bearing)

The Discovery subsystem runs on two coherent single-authority abstractions:

- **`MaxRoleWriter`** — the one writer for keep / reject / role on the working
  state. Every checkbox/toggle goes through it (`toggleDestKeep` → `MaxRoleWriter.set`).
- **`DiscoveryModel`** — the one *derived* authority for placement + counts. It is
  load-bearing in the live path: `_applyDiscoveryModelToSights()` projects the
  render's sections from it, and the receipt banner now derives from it (via the
  `IngestionService`).

Around the model sits a real service layer, each a vanilla namespaced module,
each unit-tested and gated in `tests/run.sh`:

| Service | Role | File |
|---|---|---|
| `DiscoveryModel` | SSOT + single writer; `PlacementRule` registry, change events, snapshot/restore | `discovery-model.js` |
| `MaxIngestion` | one trip→model pipeline (pool union + identity + opts) | `discovery-ingestion.js` |
| `MaxPersistence` | model↔trip writer (inverse of ingestion) + debounced event→save pump | `discovery-persistence.js` |
| `MaxEnhance` | `SuggestionSource` registry; results flow through `model.upsert` | `discovery-enhance.js` |
| `MaxDiscoverySession` | coordinator façade composing all of the above | `discovery-session.js` |

**Extension points (open/closed):** a new category is `PlacementPolicy.addRule(...)`;
a new way to enhance is `MaxEnhance.register({ id, label, appliesTo, fetch })` —
no edits to the picker, counts, or persistence.

## What's a residual compensation (one)

`_reconcileUserListedKeeps`'s orphan-catchall **union** (index.html). It is the
*correct* operation today — the model collapses the orphan and Enhance "Sights
near" items into one before the orphan logic runs, so a union is right and an
overwrite reintroduces an order-dependent disappearing-pin bug. It is locked by
**contract-checks Rule 30** (the unsafe overwrite can never return). It cannot be
*removed* without the deferred rewrite below.

## Deferred — the model-as-sole-writer rewrite (do only if needed)

Trigger: only if a real bug surfaces that the current "model as derived SSOT"
architecture can't fix. It is a large, high-risk change to the disappearing-pin
subsystem and must be done step-by-step with live verification.

1. Ingest orphan user-listed sights into the `DiscoveryModel` **before** the
   projection — then the orphan-catchall block (and its union) can be deleted.
2. Make the `DiscoveryModel` the **sole live writer**, replacing `MaxRoleWriter`
   and the imperative `_tb` state across the picker.
3. Renderer reads `model.sections()` directly; delete `_applyDiscoveryModelToSights`
   write-back.
4. Delete the pass-chain (`_reconcileUserListedKeeps` etc.).
5. Remove the Stage-2/Stage-5 compensations that exist only for the old flow.

Why deferred: `MaxRoleWriter` is already a principled single writer, so the only
payoff of replacing it is purity — not worth the disappearing-pin risk unless a
concrete failure forces it.

## The honest line

The placement/count architecture is real and load-bearing. The *full* "delete the
imperative layer" purity is deferred behind a clear trigger. The one residual
compensation is correct and contract-locked. No patch is hiding a broken behavior.
