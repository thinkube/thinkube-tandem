# Worktree-isolated parallel slices (TEP-tgpupa / SP-tgpwbm)

How Tandem runs a Spec's slices in parallel **safely by construction**: each
Spec works in its own git worktree, `/slice` cuts parallel siblings so their
declared file sets are disjoint, and a single Extension-Host **ownership
arbiter** enforces that disjointness at runtime and reclaims abandoned claims.

This page documents the mechanics that ship in the extension. The _why_ lives in
TEP-tgpupa.

## Starting a Spec in a worktree

`/pair-start` **requires** the Spec's worktree: the pure guard
`requiresWorktree(cwd, canonicalRepo)` returns `"open-worktree"` when invoked
from the canonical/main checkout (so `/pair-start` opens/redirects into the
`spec/SP-{n}` worktree session instead of editing the main tree) and `"proceed"`
when it's already inside a linked worktree. The open itself is the same action:

**Start Spec in Worktree** (the Specs-view action, `WorktreeService.create`)
opens a Spec's `spec/SP-{n}` worktree and is **idempotent**:

- **Create-or-reuse.** If a worktree is already checked out on the Spec's
  branch, it is reused — `create` returns its path instead of failing on
  "already exists". `planWorktree(existing, repo, n, baseDir?)` is the pure
  decision (reuse the existing path, else compute a fresh sibling
  `<repo>-worktrees/SP-{n}`).
- **Board-connected.** A fresh worktree is a clean checkout, so its committed
  `.mcp.json` lacks the machine-specific board location. `create` injects
  `THINKUBE_BOARD_ROOT` (from `thinkube.boards.root`) into the worktree's
  `.mcp.json` kanban-server env via the pure `mcpWithBoardRoot`, so the
  Claude-Code-spawned kanban MCP finds the central sidecar board. The edit is
  machine-local and stays uncommitted (never committed, like `THINKUBE_FOLDERS`).

### Self-driving hand-off (`start_spec_worktree`)

A session that just ran `/slice` can open the worktree pair session itself, with
no manual button, via the `start_spec_worktree(spec)` MCP tool. The standalone
MCP server has no `vscode` API, so it can't open a session directly — instead it
reuses **the board's own MCP→host channel: the filesystem**. (`move_slice`
already works this way: it writes a slice `.md` and a `FileSystemWatcher` in the
host reacts — `ThinkubeStore`.)

- The tool writes a one-shot `{kind:"start-worktree", spec, repo}` JSON request
  (`src/mcp/controlRequests.ts`, pure serialize/parse/route) into the
  host-published control dir (`THINKUBE_CONTROL_DIR`, baked into `.mcp.json` env
  alongside `THINKUBE_BOARD_ROOT`).
- `ControlRequestWatcher` (Extension Host) watches that dir, consumes the request
  fire-once (deletes it), and runs `thinkube.specs.startWorktree` — the very same
  command the button runs (create-or-reuse + board-root inject + open session).

This is **deliberately not** the agent-teams `THINKUBE_TMUX_SHIM_SOCK` bridge:
that socket is tmux-emulation only and gated on an opt-in feature, so routing the
worktree hand-off through it would break whenever agent-teams is disabled. The
control watcher is always-on.

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

### Reconciliation and recovery

After a reload the arbiter can `reconcile(liveSlices)` against the set of slices
whose worktrees are still live, dropping (reclaiming) files held by abandoned
slices and persisting the result — **board-wins** recovery.

`detectRecoverable(slices, liveHolders)` (`parallelSlices.ts`) then spots an
**orphaned worktree-shaped Spec**: one whose slices carry an `assignee:` stamp
and are still open (`doing` / `ready`), yet have no live arbiter holder — the
signature of a worktree session that died mid-Spec (a crash or window reload).
On reactivation the ownership map (reconciled), the `assignee` stamps (persisted
in slice frontmatter), and the worktree on disk all reconstruct, and
`/pair-start` offers to **resume** that worktree rather than starting fresh. The
live respawn-and-resume rides the existing `WorktreeService` + Claude session
recovery; `detectRecoverable` is the pure signal that triggers it. Done and
archived slices are finished, never orphaned.

## Enforcement: the PreToolUse hook

The arbiter records ownership; a `PreToolUse(Edit|Write|MultiEdit)` hook
**enforces** it. The bundle ships `hooks/ownership-guard.mjs` and a
`hooks.PreToolUse` fragment in `settings.json`; `BundleInstaller` copies the
script to `.claude/hooks/` and merges the fragment into the project's
`.claude/settings.json` (de-duplicating, never clobbering other hooks).

On every Edit/Write the hook reads the tool's target file, the active slice
(`THINKUBE_ACTIVE_SLICE`), and the durable ownership map (the journal at
`THINKUBE_OWNERSHIP_JOURNAL`, else git refs in the repo), then:

- **exit 0 (allow)** — the active slice owns the file, _or_ the feature isn't
  engaged (no active slice, or the slice holds no claims — fail-open, so the
  hook never bricks an ordinary non-parallel session).
- **exit 2 (block)** — the file is owned by another slice, or is outside the
  active slice's claimed set; the reason is written to stderr so Claude can pick
  a file it owns.

This catches a stray write the moment it's attempted, rather than discovering
the conflict at merge time.

## Verification in the worktree

Because each Spec runs in its own worktree, `/pair-next` runs a slice's verifier
**in that slice's worktree** — the verification recipe executes against the
isolated checkout, never against the canonical/main tree or another Spec's
uncommitted changes. This is purely a change of _where_ verification runs.

The **Done gate is unchanged**: `gateSliceSatisfiesToDone` (`qualityGates.ts`)
still blocks Done unless the verifier is green **and** every AC the slice
`satisfies` is checked on the Spec. Worktree isolation changes the verifier's
working directory, not the gate's contract — a regression test pins this.
