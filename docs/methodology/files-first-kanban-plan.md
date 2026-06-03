# Implementation plan — files-first kanban

Companion to [ADR-0001](../../.thinkube/decisions/ADR-0001-files-as-source-of-truth.md).
Goal: make committed `.thinkube/` files the host-agnostic source of truth for the
kanban, with the GitHub issue tracker demoted to an optional inbox adapter.

The work is sequenced so the extension stays loadable at every step. The kanban
panel is storage-agnostic already, so most churn is concentrated in the store and
the MCP server.

## Phase 0 — Repo plumbing

- [ ] Stop ignoring methodology artifacts; ensure `.thinkube/` is tracked (it is
      currently neither tracked nor ignored). Add a `.thinkube/inbox.md` ignore
      only if we adopt the local-capture file and decide it's machine-local.
- [ ] Decide the board-commit convention string (`chore(board): <ID> → <Status>`)
      and centralise it as a constant.

## Phase 1 — Store: status, identity, board query

`src/store/ThinkubeStore.ts`

- [ ] Add a `status` field to the frontmatter contract for epic/story/spec/task
      artifacts (`src/store/frontmatter.ts`). Values mirror the six columns;
      default `Spec`/`Ready` per kind on create.
- [ ] Add a **local monotonic ID** allocator (generalise the existing ADR
      auto-increment): `nextId(kind)` scanning existing files / a small counter,
      replacing GitHub-issue-number identity.
- [ ] Add a board query: `listBoard()` returning artifacts grouped by `status`,
      with the fields the panel needs (id, title, parent, status, AC counts,
      staleness). This is the file-native replacement for the Projects v2 read.
- [ ] Keep `scanForSecrets` on every write (unchanged).

## Phase 2 — Files adapter for the panel

`src/views/kanban/host/storage/ThinkubeFilesAdapter.ts` (new)

- [ ] Implement `StorageAdapter`: - `load()` → `ThinkubeStore.listBoard()` mapped to `Board`/`TaskCard`. - `save(board)` / move → write `status:` frontmatter + commit with the
      scoped message. - `updateIssue?`/`createTask?` → file writes (title/body), not API calls. - `onExternalChange` → fire from `ThinkubeStore.onChanged` (the FS watcher
      already exists) so external edits re-render the panel. - `scope` → repo/workspace label.
- [ ] Wire adapter selection in `src/views/kanban/host/Panel.ts` /
      `src/commands/kanban.ts`: **files adapter is the default**;
      `GitHubProjectsAdapter` only when host = GitHub _and_ explicitly opted in.
- [ ] Add a `thinkube.kanban.backend` setting (`files` | `github-projects`),
      default `files`, in `package.json` → `contributes.configuration`.

## Phase 3 — MCP server: files-native tools

`src/mcp/kanbanMcpServer.ts`

- [ ] `create*OfKind` (epic/story/spec) → write the sidecar with a local ID and
      `status` frontmatter; **drop** the `ctx.github.createIssue` call and
      sub-issue linking (hierarchy is `parent:` frontmatter).
- [ ] `move_task` → edit `status:` frontmatter + commit; drop the Projects v2
      `setStatus` path. Keep the SP-86 spec-hash baseline stamping on reaching
      Verify/Done.
- [ ] `list_board` / `list_*_in_*` → read from the store, not the API.
- [ ] `tasks-decompose` → write **task files** (`.thinkube/tasks/T-{n}.md` with
      `status:`/`parent:` frontmatter), not GitHub issues. Per ADR-0003 tasks are
      file-backed cards (card = Task); the issue-minting `create_tasks_from_spec`
      / `materialise` path is removed.
- [ ] Remove the `project`-scope dependency and the API-failure fallbacks from
      the tool surface.

## Phase 4 — Gates & skills (methodology bundle)

`templates/methodology-bundle/`

- [ ] Gates become file checks (Spec→Ready: non-empty `## Acceptance Criteria`;
      Review→Verify: all AC checked). **Drop the In-Progress→Review `≥1 comment`
      gate.**
- [ ] Update `pair-next` / `pair-start` to remove comment-posting as a gate
      satisfier and to read board state from files.
- [ ] Update `spec-prepare` to drop the "optionally mirror to issue" step (no
      issue to mirror to in the default config).
- [ ] Scrub the leaky internal references ("chunk-11 gate", "chunk-9
      materialiser", "SP-86") from user-facing skill text → behaviour-named
      gates.
- [ ] Bump the bundle `VERSION` and update `manifest.json` if files change.

## Phase 5 — Optional GitHub inbox adapter

- [ ] `/triage` skill (new bundle skill): list open `label:inbox` issues via
      `src/github/GitHubService.ts` (reuse existing client), shape each into a
      `.thinkube/` spec/task, close the issue with a link to the artifact.
- [ ] Gate the skill + its permissions behind host = GitHub and an opt-in
      setting (`thinkube.kanban.inbox.enabled`, default false).
- [ ] Optional: `.thinkube/inbox.md` local quick-capture drained by the same
      skill.

## Phase 6 — Retrieval (structural-first, no RAG)

See [ADR-0002](../../.thinkube/decisions/ADR-0002-retrieval-over-thinkube.md).
Vector RAG is explicitly out; this phase implements the cheap, git-native
retrieval that covers the structured majority.

- [ ] **Frontmatter index.** Generate/maintain a lightweight index of all
      `.thinkube/` artifacts (id, kind, title, parent, status) from the store's
      existing `issueIndex`/watcher — the structural lookup table retrieval and
      the `explorer` agent query first.
- [ ] **Status-filtered search.** Ensure retrieval helpers exclude `Done`/stale
      items by default (filter on `status:`), so completed/obsolete specs don't
      pollute results.
- [ ] **Index/summary files for accreting kinds.** Generate committed
      `.thinkube/decisions/INDEX.md` (and a retro index) with one-line synopses,
      refreshed on write via `ThinkubeStore.onChanged`. This is the primary
      "have we decided/seen this before?" surface.
- [ ] **Point skills at it.** Update `spec-prepare` (related-work/dedup check
      before authoring) and `pair-start`/`pair-next` to consult the index +
      `explorer` rather than loading the tree.
- [ ] **Retrieval seam (interface only).** Define a small retrieval interface so a
      future vector retriever can slot in — scoped to decisions+retros, rebuilt on
      demand, never committed, off by default. Do **not** implement it now.

## Validation

- [ ] `npm run compile` clean.
- [ ] Manual: open the kanban panel on a repo with no GitHub config → files
      adapter renders; create/move cards → frontmatter + commits land; reinstall
      simulation (`git clone` fresh) → board restores fully.
- [ ] Gitea remote smoke test: push `.thinkube/`, clone elsewhere, board loads.

## Out of scope (this pass)

- Migrating existing GitHub-Projects-backed boards to files (one-off importer;
  separate task if needed).
- Multi-board / multi-root aggregation.
