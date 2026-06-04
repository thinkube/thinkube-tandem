# Run Specs in parallel via per-Spec git worktrees

Working more than one Spec at a time in a single working tree tangles their uncommitted changes — you can't cleanly stage or branch one Spec's work when another Spec's edits sit in the same tree (we hit exactly this finishing SP-2, where SP-3/SP-4 and a bundle upgrade had to be hand-excluded from the commit). This Spec isolates each in-flight Spec into its own git **worktree** (a separate working directory on its own branch), so parallel Specs never share a tree and each one's commits/branch/PR stay clean — with the extension creating, opening, and retiring the worktree from the board.

## Acceptance Criteria

- [x] Starting a Spec from the board creates a dedicated git worktree on its own branch and opens a session rooted in that worktree (its working directory is the worktree, not the main checkout).
- [x] Two Specs can be in progress at once, each with uncommitted changes, without interfering — `git status` and commits in one Spec's worktree never show or include the other Spec's edits, nor the main checkout's (the SP-2 tangle, where unrelated specs/bundle edits bled toward the commit, can't happen).
- [x] Creating Specs while worktrees are active never produces a duplicate Spec number — every Spec gets a unique number regardless of which or how many worktrees exist.
- [x] Each active Spec worktree is navigable as its own board, labeled as a worktree of its repo (not surfaced as a separate, unrelated repo).
- [x] Finishing a Spec retires its worktree (removed cleanly), with the work landed on `main` via PR.

## Constraints

- **Numbering is canonical-only.** Top-level Spec numbers are minted exclusively against the canonical checkout (resolved via `git rev-parse --git-common-dir`), never from a worktree's possibly-stale view. Worktrees only ever work an already-numbered Spec. Slice numbers stay safe by single-owner-per-Spec (one worktree per Spec).
- **Reuse existing machinery, no new spawn path.** Root the session in the worktree through the existing `LauncherService.openHere` + wrapper, not a new mechanism.
- **Worktrees are opt-in and additive.** The current single-tree flow keeps working untouched; nothing forces a worktree.
- **Worktrees must not masquerade as independent repos.** Discovery treats any dir with `.git` + `.thinkube/` as a board, and a worktree matches that — so the navigator/MCP must detect linked worktrees (their `.git` is a _file_; `--git-common-dir` ≠ `--git-dir`) and group/label them under their canonical repo, never list them as separate top-level boards.
- **Worktree location must not pollute discovery.** Place worktrees outside the canonical repo tree (e.g. a sibling dir) so the depth-limited board walk doesn't pick them up as nested boards.
- **Clean retirement.** Removing a Spec's worktree must refuse if it has uncommitted/un-pushed work (no silent data loss); only retire once the work is on `main`.
- Platform reality: must work in the user's code-server / Mac setup where keybindings don't fire and a window reload kills terminal sessions.

## Design

A new `WorktreeService` wraps `git worktree` (via `execFile`, like `gitRemote.ts`): `create(specNumber)` runs `git worktree add <base>/SP-{n} -b spec/SP-{n} <canonicalRepo> ` rooted at a configurable sibling base dir; `list()` parses `git worktree list --porcelain`; `remove(specNumber)` runs `git worktree remove` (refusing when dirty). It also exposes `canonicalRepo(cwd)` — `git rev-parse --git-common-dir` resolves the shared `.git`, so the extension can always tell a linked worktree from the canonical checkout and route number-minting correctly.

Board-integrated lifecycle: a "Start Spec" action on a spec/board node calls `WorktreeService.create(n)` then `LauncherService.openHere(worktreeUri, "/pair-start " + n)` — reusing the existing cwd-wrapper so the Claude session roots in the worktree. A "Retire" action calls `remove(n)` once the Spec's PR is merged. Spec slices ride the `spec/SP-{n}` branch and ship as the Spec's PR(s); per-slice branches remain possible inside the worktree.

The board model is **per-branch, converge-on-merge, with canonical-only minting**: a Spec's slice-status moves commit on its worktree branch and integrate into `main`'s board on merge (safe — single owner per Spec). The one shared invariant, numbering, is protected by resolving the canonical repo for every Spec-number allocation (`ThinkubeStore.nextSpecNumber` / the "New Spec" path), so a stale worktree view can never mint a duplicate. Discovery (`discoverRepos` + the MCP `BoardRegistry`) gains worktree-awareness: linked worktrees are detected (`--git-common-dir` ≠ `--git-dir`) and grouped/labeled under their canonical repo instead of appearing as independent top-level boards, which—because the MCP server is already board-independent (one server, many boards)—gives a live multi-Spec view for free.

**Spikes (not slices):** confirm `git worktree add`/`remove` behave under code-server and on the Mac client; confirm `--git-common-dir` reliably distinguishes canonical vs linked worktree across the depth-limited discovery walk; confirm `openHere`'s wrapper roots a session correctly at a worktree path (the `.target-cwd` handoff + `--resume` cwd recovery from `~/.claude/projects`).

## File Structure Plan

- `src/services/WorktreeService.ts` _(new)_ — `create`/`list`/`remove` via `git worktree`; `canonicalRepo(cwd)` via `--git-common-dir`.
- `src/commands/worktree.ts` _(new)_ — register "Start Spec" / "Retire worktree" commands; wire `create` → `LauncherService.openHere`.
- `src/services/LauncherService.ts` — reuse `openHere(worktreeUri, "/pair-start {n}")` to root the session (likely no change, or a small prefill tweak).
- `src/store/ThinkubeStore.ts` — `nextSpecNumber` / new-Spec allocation resolves the canonical repo so minting can't collide across worktrees.
- `src/views/boards/BoardNavigatorProvider.ts` — `discoverRepos` detects linked worktrees and groups/labels them under their canonical repo (not separate top-level boards).
- `src/mcp/kanbanMcpServer.ts` — mirror the worktree-awareness in `BoardRegistry`/`walkForBoards` so MCP boards match the navigator.
- `src/views/boards/SpecsProvider.ts` — per-Spec "open worktree" affordance / active-worktree indicator.
- `package.json` — command declarations + menu bindings (spec/board context menus) + a setting for the worktree base directory.
- `.claude/skills/repo-conventions/SKILL.md` — document the per-Spec worktree workflow + `spec/SP-{n}` branch naming (doc-only; bundle file).
