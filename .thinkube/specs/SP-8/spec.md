# Board state from a central sidecar repo (per–Thinking-Space namespaces)

Implements the keystone of ADR-0008: move board state out of each Thinking
Space's co-located `.thinkube/` into one central sidecar "boards" repo, holding
every Thinking Space's board namespaced by Thinking Space. The navigator and MCP
server read and write boards from a configurable central root instead of the
Thinking Space's own working tree, and existing co-located boards migrate into
the sidecar. This decouples the board from code branches (dissolving the
convergence/stuck-card class) and makes a single cross–Thinking-Space board
possible. Deploy-time provisioning of that repo is a separate Spec (SP-10); the
conflict-free ID change is SP-7.

## Acceptance Criteria

- [x] With a board repo mounted at the configured central root, the navigator
      shows each enabled Thinking Space's board read from
      `<board-root>/<thinking-space>/` — not from a co-located `.thinkube/` in
      the Thinking Space's repo.
- [x] Creating or moving a slice for a Thinking Space writes to that Thinking
      Space's namespace under the board root; `git status` in the Thinking
      Space's own repo shows no `.thinkube/` change.
- [x] Boards for two different Thinking Spaces are visible together, each
      labeled by its Thinking Space, from the single board root (navigated one
      at a time — no merged pane in this Spec).
- [ ] An existing co-located `.thinkube/` board migrates into the sidecar once,
      with no loss of specs / slices / retros / decisions; afterwards the
      Thinking Space's repo no longer carries a board `.thinkube/` (fully
      removed — no stub).
- [ ] A Thinking Space whose board has moved out still works — the extension
      resolves its board via the Thinking-Space→namespace mapping, not an absent
      local `.thinkube/`.
- [ ] When the board root is absent/unmounted, the extension surfaces a clear
      "board repo not available" state rather than failing silently.

## Constraints

- **Scope: central storage + per–Thinking-Space navigation.** No merged
  cross–Thinking-Space pane in SP-8 — the navigator still shows one Thinking
  Space's board at a time, just read from the central root. The aggregated
  "rollup" pane (deferred by ADR-0006) stays a later Spec.
- **Migration fully removes** the Thinking Space's repo `.thinkube/` board
  (committed), no stub/pointer left behind; specs/slices/retros/decisions move
  intact.
- **Files-as-truth preserved (ADR-0001).** Board state stays committed
  markdown — now in the sidecar; recovery is `git clone` of the board repo.
- **Thinking Spaces span git hosts.** Platform and User-Templates repos are on
  GitHub; **Apps live in the user's Gitea**. The board repo itself is one GitHub
  repo, but it holds boards for code repos on either host — so the namespace key
  and board logic must be **host-agnostic** and never assume a GitHub-only
  identity.
- **`.claude/`, `.mcp.json`, `CLAUDE.md` stay co-located** in each Thinking
  Space's repo (Claude Code requires them there). Only `.thinkube/` (the board)
  and its bundle stamp move to the sidecar.
- **Reuse existing machinery.** Redirect `ThinkubeStore` path resolution,
  `BoardNavigatorProvider` discovery, the MCP `BoardRegistry`, `enableHere`, and
  `BundleInstaller` — no parallel system.
- **Boundaries.** Deploy-time provisioning/mounting of the board repo is SP-10
  (SP-8 assumes a board root is configured/available); conflict-free IDs are
  SP-7; worktree-as-code-only + the SP-5 fixes are SP-9.
- **Lean (ADR-0003).** One new setting (`thinkube.boards.root`) plus the env
  that carries it; no new modes; `navigator` write-authority semantics unchanged.

## Design

The whole co-location assumption funnels through one getter —
`ThinkubeStore.thinkubeDir = <workspaceRoot>/.thinkube`
(`src/store/ThinkubeStore.ts:97`). The codebase **conflates the board location
with the git-repo location** via the single `workspaceRoot` ctor arg: provenance
/ git-coords and worktree logic also read `store.workspaceRoot` as the git repo
(`ThinkubeFilesAdapter.ts:72,122`, `kanbanMcpServer.ts:807`, `worktree.ts:42`).
SP-8's spine is to **split those two concepts** — a `ThinkubeStore` gains a
_board dir_ (`<board-root>/<thinking-space>/.thinkube`) distinct from a _repo
root_ (the git checkout, still needed for provenance). Every path already derives
from `thinkubeDir`, so redirecting that getter and threading `repoRoot`
separately carries most of the change.

**Discovery** is the other half. Today both the navigator
(`BoardNavigatorProvider.discoverRepos`/`walk`, `:60-116`) and the MCP server
(`BoardRegistry.walkForBoards`/`isBoard`/`boardId`, `kanbanMcpServer.ts:239-301`)
treat "a repo with a co-located `.thinkube/`" as an enabled board, scanning
workspace folders at depth ≤ 3. SP-8 inverts this: enumerate Thinking Spaces
under the **central board root**, and resolve each back to its git repo via the
**Thinking-Space→namespace mapping**. The `boardId` (home-relative path, `:259`)
gives way to the namespace key.

**The namespace key is the Thinking Space's workspace-relative path** —
`<container>/<rel>`, e.g. `Platform/extensions/thinkube-ai-integration`,
`Apps/<app>`, `User-Templates/<tmpl>` (resolves ADR-0008's "project→namespace
mapping"). It is **host-agnostic** — Thinking Spaces span hosts (Platform and
User-Templates on GitHub, **Apps in the user's Gitea**), so a GitHub
`owner/repo` key cannot address all of them — and the container segment
(`Apps` / `Platform` / `User-Templates`) **carries semantic meaning** (what kind
of Thinking Space it is). It is stable because the workspace container layout is
deploy-standardized (`thinkube.code-workspace`) and unique by construction (no
two repos share a path). The MCP `boardId` (home-relative path, `:259`) is
replaced by this namespace.

**Migration** is one-shot per Thinking Space: move `<repo>/.thinkube/` →
`<board-root>/<namespace>/`, committing the removal in the code repo and the
addition in the board repo, and relocating the bundle stamp; the
`.claude/`+`CLAUDE.md`+`.mcp.json` bundle files stay put.

**Spike:** confirm the file-watcher can watch a board root _outside_ the open
workspace folders, or whether the board root must itself be an open workspace
folder (which SP-10's "4th root" arranges anyway).

## File Structure Plan

- `src/store/ThinkubeStore.ts` — split board-dir from repo-root; redirect
  `thinkubeDir`; fix the repo-rooted file-watcher `RelativePattern` (`:104`).
- `src/views/boards/BoardNavigatorProvider.ts` — discover Thinking Spaces under
  the central board root and map back to repos (replace the co-located test).
- `src/mcp/kanbanMcpServer.ts` — `BoardRegistry`/`isBoard`/`walkForBoards`/
  `boardId`/`resolve` scan the central root by namespace; thread repo-root into
  `stampOnEnteringDone`.
- `src/mcp/KanbanMcpProvider.ts` + `src/commands/bundle.ts` — carry the central
  board root into `THINKUBE_ROOTS`/env (computed in both today).
- `src/mcp/vscodeStub.ts` — bridge the new board-root config to the subprocess.
- `src/views/kanban/host/storage/ThinkubeFilesAdapter.ts` — use repo-root (not
  board dir) for git coords/provenance.
- `src/commands/boards.ts` — `enableHere` scaffolds under the central root;
  `openBoardFor` path-building.
- `src/views/boards/SpecsProvider.ts` — store construction from the board dir.
- `src/commands/worktree.ts` — derive the canonical repo independent of the (now
  central) spec-file path.
- `src/methodology/BundleInstaller.ts` — the `.thinkube/` bundle stamp follows
  the board to the central root.
- `package.json` — add the `thinkube.boards.root` setting.
- New: a Thinking-Space↔namespace resolver (workspace-relative `<container>/<rel>`
  ↔ `<board-root>/<ns>/`, host-agnostic) and a one-shot migration command.
