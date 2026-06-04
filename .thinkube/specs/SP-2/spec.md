# Record commit + PR on completed slices

When a slice moves to Done, capture the commit it was delivered in and the PR that carried it, write them into the slice's frontmatter (git-tracked), and surface them as clickable links on the slice card and in the spec detail — so a finished Spec shows exactly which commits/PRs delivered each slice.

## Acceptance Criteria

- [x] When a slice is moved to Done, its `SL-{m}.md` frontmatter is updated to record the commit SHA of the work and — when a PR exists for the branch — the PR link.
- [x] A slice card in the panel that has a recorded commit/PR shows them as **clickable links** (commit opens the commit on the remote host; PR opens the pull request).
- [x] The spec detail surfaces, for each done slice, its recorded commit/PR — a roll-up of how the Spec was delivered.
- [x] If `git`/`gh` are unavailable or the branch has no PR, moving a slice to Done **still succeeds** — it records whatever is available (e.g. commit only, or nothing) and never blocks the Done transition.

## Constraints

- **Best-effort, never blocking.** Provenance capture must not fail or delay the Done move; detection errors are swallowed (logged), and fields are omitted when unavailable.
- **One Done seam.** Today only the MCP `moveSlice` path stamps on Done (`src/mcp/kanbanMcpServer.ts` ~697-711); the panel drag-to-Done (`ThinkubeFilesAdapter.save()`) persists status but doesn't stamp. Capture must run on **both** paths via one shared helper — no forked behavior.
- **Captured-at-Done semantics.** What's recorded is the branch HEAD commit + the open PR at Done time, _not_ the eventual squash-merge SHA (which doesn't exist yet). Document this so the field isn't mistaken for the merge commit.
- **No new runtime dependency.** Shell out via `execFile` like `src/github/gitRemote.ts`, reusing `parseGitHubRemote` to build commit/PR URLs from `owner/repo`.
- **Frontmatter round-trips.** New fields must survive `parseFrontmatter`/serialize read-modify-write and pass the secret scanner (a PR URL is not a secret — verify against the carve-out in `src/store/frontmatter.ts` ~143-146).
- Additive only — no change to board projection or the AC quality gates.

## Design

Add two optional frontmatter fields to the shared `Frontmatter` interface: `commit` (full SHA) and `pr` (PR URL). A new best-effort helper `captureSliceProvenance(cwd)` runs `git rev-parse HEAD` and `gh pr view --json url` for the current branch and returns `{ commit?, pr? }` — every failure (no `git`/`gh`, detached repo, no open PR) resolving to empty. The clickable commit **URL** is derived at render time (SL-2) from the stored SHA + the remote via `parseGitHubRemote`, not stored in frontmatter.

The provenance capture is unified behind a shared `stampOnEnteringDone(fm, cwd)` that sets the new `commit`/`pr`; **both** Done seams call it — the MCP `moveSlice` Done branch (alongside its existing `verified_req_hash` stamp) and `ThinkubeFilesAdapter.save()` when a card crosses into the Done column, so panel drags record provenance too. The `verified_req_hash` baseline stays inside `moveSlice` as before: unifying that into the shared helper would make panel drags start stamping the staleness baseline, a change to existing behavior that this Spec's "additive only" constraint rules out.

For surfacing, `TaskCard` gains optional `commit`/`commitUrl`/`pr` (mirrored in both `webview/kanban/src/types.ts` and `src/views/kanban/host/types.ts`); the webview card renders them as external links via the panel's open-external bridge. `SpecsProvider` rolls up done slices' commit/PR under the spec.

**Spike (not a slice):** confirm `gh pr view` resolves the open PR for the current branch in this repo's flow, and confirm a full PR URL passes the secret scanner carve-out.

## File Structure Plan

- `src/store/frontmatter.ts` — add optional `commit` + `pr` to `Frontmatter`; verify round-trip + scanner allowance.
- `src/github/sliceProvenance.ts` _(new)_ — `captureSliceProvenance(cwd)`: `git rev-parse HEAD` + `gh pr view`, commit-URL build via `parseGitHubRemote`.
- `src/mcp/kanbanMcpServer.ts` — `moveSlice` Done branch calls the shared `stampOnEnteringDone` to set `commit`/`pr`.
- `src/views/kanban/host/storage/ThinkubeFilesAdapter.ts` — stamp provenance when `save()` moves a slice into Done.
- `src/views/kanban/host/types.ts` + `webview/kanban/src/types.ts` — add optional `commit`/`commitUrl`/`pr` to `TaskCard` (both mirrors).
- `media/kanban/` slice-card component — render commit/PR as clickable external links.
- `src/views/boards/SpecsProvider.ts` — per-spec roll-up of done slices' commit/PR.
- `src/views/kanban/host/Panel.ts` — open-external message bridge (if not already present).
