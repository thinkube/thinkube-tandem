# Worktrees for code isolation only

ADR-0008 keeps per-Spec git worktrees but refocuses them on what they are good
at — isolating a Spec's _code_ — now that SP-8 moved board state into the central
sidecar. A worktree no longer carries or forks a board; it shares its canonical
Spec's sidecar board. This also fixes the SP-5 surface bugs: the "Start Spec in
Worktree" button appeared on every Spec and always fired `/pair-start`, and
retiring a worktree could strand the Spec's last card — none of which should
happen once the board is central and the action is context-aware.

## Acceptance Criteria

- [x] The "Start Spec in Worktree" action appears **only on a Spec with open
      (Ready/Doing) slices** — it is hidden on a fully-done Spec.
- [x] Starting a worktree opens a **context-aware** session: `/pair-start N`
      only when the Spec has open work; it never drops you into `/pair-start`
      on a finished or empty Spec.
- [x] A worktree and its canonical repo show the **same board** — the worktree's
      board resolves to the canonical Spec's central namespace, not a co-located
      `.thinkube/` in the worktree.
- [x] Retiring a worktree is a **pure code operation** — it removes the worktree
      (refusing when dirty/un-pushed), and the Spec's board in the sidecar is
      untouched: no card is stranded or lost.

## Constraints

- **Worktrees stay opt-in / additive** (ADR-0008); the single-tree flow is
  unaffected, and nothing forces a worktree.
- **Reuse, don't add machinery.** Extend `SpecsProvider`'s existing per-Spec
  slice pass and the existing discovery walks; no new worktree service surface.
- **Preserve the SP-5 retire guard** — refuse to remove a worktree with
  uncommitted/un-pushed work (no silent data loss).
- **Lean (ADR-0003):** no new settings.

## Design

The shift is small in code but spans a few seams, all enabled by SP-8's central
board.

**Worktree boards resolve to the canonical Spec's namespace (AC #3).** Both
discovery walks — `BoardNavigatorProvider.walk` and the MCP `walkForBoards` —
handle a linked worktree (`.git` _file_) by resolving its board dir from the
_worktree's own_ path, which, being a sibling outside the workspace folders,
falls back to a co-located `.thinkube/`. SP-9 resolves it from the **canonical**
repo instead: `linkedWorktreeInfo(dir).canonicalRepo` → `namespaceForRepo(
canonicalRepo)` → the central namespace. So a worktree and its canonical repo
render the _same_ sidecar board (and a worktree carries no board of its own).

**The Start button gates on open work (AC #1); the launch is context-aware
(AC #2).** `SpecsProvider` already iterates each Spec's slices for the delivery
roll-up; it now also computes `hasOpenWork` (any `ready`/`doing` slice) and
carries it on the `SpecNode`, setting the spec node's `contextValue` to
`spec-open` vs `spec-done`. `package.json` binds `startWorktree` to
`viewItem == spec-open`. The `startWorktree` command reads `node.hasOpenWork`
and prefixes `/pair-start N` only when true (otherwise a plain session) — a
defensive guard for a Command-Palette invocation that bypasses the menu.

**The worktree is cut from the code repo, not the board.** Under central boards
`node.file` lives in the _sidecar_, so `worktree.ts`'s
`canonicalRepo(path.dirname(node.file))` would resolve the _board_ repo. SP-9
threads the Thinking Space's repo path onto the `SpecNode` and cuts the worktree
from there.

**Retire is already pure-code (AC #4).** `WorktreeService.remove` removes the
worktree's working dir, refusing when dirty/unmerged; the board lives in the
sidecar, so nothing board-side is touched. SP-9 verifies this end-to-end and
strips any residual board assumption.

**Spike:** confirm `linkedWorktreeInfo` + `namespaceForRepo(canonicalRepo)`
yields the canonical's central namespace for a worktree placed outside the
workspace folders (the sibling `<repo>-worktrees/SP-N` location).

## File Structure Plan

- `src/views/boards/SpecsProvider.ts` — compute `hasOpenWork` + carry the code
  `repoPath` on `SpecNode`; set `contextValue` `spec-open` / `spec-done`.
- `src/commands/worktree.ts` — cut the worktree from the code repo
  (`node.repoPath`), and gate `/pair-start` on `node.hasOpenWork`.
- `src/views/boards/BoardNavigatorProvider.ts` — a linked worktree's board dir
  resolves from its canonical repo's namespace.
- `src/mcp/kanbanMcpServer.ts` — the same worktree board-dir fix in
  `walkForBoards`.
- `package.json` — bind `thinkube.specs.startWorktree` to `viewItem == spec-open`.
- `src/services/WorktreeService.ts` — verify/trim any residual board assumption
  in `remove` (the dirty/unmerged guard stays).
