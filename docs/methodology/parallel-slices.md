# Worktree-isolated parallel slices (TEP-tgpupa / SP-tgpwbm)

How Tandem runs a Spec's slices in parallel **safely by construction**: each
Spec works in its own git worktree, `/slice` cuts parallel siblings so their
declared file sets are disjoint, and a single Extension-Host **ownership
arbiter** enforces that disjointness at runtime and reclaims abandoned claims.

This page documents the mechanics that ship in the extension. The _why_ lives in
TEP-tgpupa.

## Slice file-set declarations

Each slice declares, in its frontmatter, the files it will edit and how it
relates to its siblings (`src/store/frontmatter.ts`):

- `files:` — the machine-readable, repo-relative **file set** the slice owns.
  This is the unit of disjointness and the arbiter's claim.
- `parallel_group:` — a name shared by slices meant to run **concurrently**.
  Members of one group must own disjoint `files` sets.
- `assignee:` — the teammate / worktree currently holding the slice; written
  empty at authoring time and claimed later by the ownership arbiter.
- `depends_on:` — existing DAG edges (full handles, e.g. `SP-3_SL-7`); a slice
  runs only once its dependencies are Done.

`create_slice` (the MCP tool `/slice` calls) authors these fields, and refuses a
`parallel_group` whose members' file sets overlap — naming the conflicting
files — so an overlapping group can never be written.

### `validateParallelGroup` (pure)

`src/methodology/parallelSlices.ts` holds the pure validator. It groups slices by
`parallel_group`, and within each group flags any file claimed by more than one
member. Ungrouped slices and singleton groups are never in conflict (they run
sequentially — disjointness is a constraint on _concurrency_, not on the whole
board). Paths are compared after a light normalization (trim, drop a leading
`./`).

## The ownership arbiter

The runtime authority over **which slice owns which file** while parallel Specs
run in separate worktrees. Coordination is _not_ committed markdown — markdown
commits aren't atomic, and there is one arbiter per Extension Host, so it can
serialize claims. The board sidecar keeps declarations and the record; the
arbiter owns the live truth.

### Atomic, all-or-nothing claims

The claim algebra is pure (`parallelSlices.ts`) and unit-tested:

- `acquireClaim(state, slice, files)` — grants the files to `slice` only if none
  is held by a _different_ slice; otherwise it is **denied whole**, naming each
  conflicting file and its holder. Re-claiming a file the same slice already
  owns is idempotent.
- `releaseClaim(state, slice)` — frees every file the slice held.
- `reconcileOwnership(state, liveSlices)` — reclaims files owned by a slice whose
  worktree is no longer live (board-wins recovery).

The single-writer `OwnershipArbiter` (`src/services/OwnershipArbiter.ts`) wraps
this algebra: it is the sole writer of the durable store, so an in-memory
all-or-nothing acquire followed by a persist is atomic for every caller.

### Durable, survives a window reload

Claims persist to a `ClaimStore` and the arbiter **rehydrates from it on
`activate()`**, so a reload reconstructs ownership rather than starting blank.
Two stores ship:

- **`GitRefsClaimStore`** (preferred) — each owned file is a ref
  `refs/locks/<hex(path)>` whose blob is the owning slice handle, living in the
  code repo's shared `.git`. Every worktree of that repo sees the same claims,
  and they survive a reload in `.git` itself.
- **`JournalClaimStore`** (fallback) — a JSON journal in the extension's
  globalStorage, written atomically (temp file + rename). Used when the seed
  path isn't a git repo.

A corrupt journal degrades to "no claims" rather than a dead arbiter that can't
activate.

### Reconciliation

After a reload the arbiter can `reconcile(liveSlices)` against the set of slices
whose worktrees are still live, dropping (reclaiming) files held by abandoned
slices and persisting the result. The live-worktree → live-slice signal and the
orphaned-Spec recovery flow are wired by the worktree-recovery slice.
