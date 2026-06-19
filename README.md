# Thinkube AI Integration

A VS Code extension that surfaces the **Thinkube methodology** — a GitHub-Issues-backed kanban for pair-programming with Claude — inside the editor.

> ⚠️ **v0.1.0** — first public cut. The methodology bundle has been iterated on real projects; expect rough edges in skill prompts and welcome feedback at the repo's issue tracker.

## What you get

Four features ship in one extension:

|                              | What it is                                                                                                                                                                                                                                                                                                                                                                                                      | Where it lives                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Process-wrapper launcher** | Right-click any folder → opens a Claude Code conversation rooted there. The CLI's `cwd` is patched via a bundled wrapper script — works on both fresh sessions and `--resume`.                                                                                                                                                                                                                                  | Explorer context menu (`Open Here`)                                                       |
| **Claude config manager**    | Browse and edit `.claude/{settings.json, commands, skills, agents, hooks}` plus `.mcp.json` and `CLAUDE.md` for any project in your workspace. Read-modify-write discipline preserves unknown fields.                                                                                                                                                                                                           | Activity Bar → **Thinkube AI**                                                            |
| **Roadmap + Kanban**         | A GitHub-backed Epic → Story → Spec tree (Roadmap panel) plus a six-column Projects v2 kanban (Spec / Ready / In Progress / Review / Verify / Done). Quality gates enforce non-empty acceptance criteria, work comments, and AC completion across column transitions.                                                                                                                                           | Activity Bar → **Thinkube Board**                                                         |
| **Methodology bundle**       | A pre-authored `.claude/` configuration that installs into each project: 11 skills (`/epic-new`, `/spec-prepare`, `/tasks-decompose`, `/pair-start`, `/pair-next`, etc.) + 3 subagents (explorer, reviewer, verifier) + sensible `settings.json` permissions + `.mcp.json` server entry + `CLAUDE.md` methodology block. Installed via **Install Methodology Bundle** command; drift-detected and update-aware. | `templates/methodology-bundle/` in the extension; installs into your project's `.claude/` |

## Quick start

1. **Install the extension.** `code --install-extension thinkube-ai-integration-0.1.0.vsix` (or Open VSX once published).
2. **Configure your project.** Command palette → **Thinkube Kanban: Configure Project**. Sets `thinkube.kanban.repo` (`owner/repo`) and `thinkube.kanban.projectNumber` (Projects v2 number). The wizard verifies your Projects v2 Status field has the six methodology options.
3. **Install the methodology bundle.** **Thinkube Kanban: Install Methodology Bundle**. Drops `.claude/skills/*`, `.claude/agents/*`, merges permissions into `.claude/settings.json`, adds the MCP server to `.mcp.json`, and inserts the methodology block into `CLAUDE.md`.
4. **Open a Claude Code session.** The methodology skills are now available: `/epic-new`, `/story-new`, `/spec-prepare`, `/tasks-decompose`, `/tasks-materialize`, `/pair-start`, `/pair-next`, `/pair-start-quick`, `/board`, `/retro`.
5. **Read `docs/METHODOLOGY.md`** to understand the end-to-end flow.

## Settings reference

| Setting                         | Type                              | Default | Purpose                                                                                        |
| ------------------------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `thinkube.kanban.repo`          | string                            | `""`    | GitHub repository as `owner/name`.                                                             |
| `thinkube.kanban.projectNumber` | integer                           | `0`     | Projects v2 number (from the URL). `0` disables project read/write.                            |
| `thinkube.kanban.allowAIWrites` | boolean                           | `true`  | When false, MCP mutating tools are gated off.                                                  |
| `thinkube.kanban.mode`          | `navigator` \| `driver` \| `both` | `both`  | Pair-programming role. `navigator` forces `allowAIWrites` to false; `driver`/`both` honour it. |

## Specs & TEPs views

Under **Activity Bar → Thinkube AI → Boards**, selecting a Thinking Space populates two nav sections:

- **Specs** — every `specs/SP-{n}/spec.md` in the selected space. A spec expands into its "delivered by" slice roll-up and the TEP it implements.
- **TEPs** — the space's Tandem Enhancement Proposals.

Per-item right-click actions archive a single spec/TEP (a reversible `archived: true` frontmatter flag — the file never moves or is deleted). Archived items are hidden by default; toggle **Show Archived** in the view title bar.

**Archive All Completed** (title-bar `$(archive)`) archives every completed item in the selected space in one shot — _accepted_ specs, or _accepted/superseded_ TEPs — after a confirmation that names the count. It reports how many were archived, or notes when nothing qualifies. Each is reversible via **Unarchive** under **Show Archived**.

Each row carries a **colored status icon** so completion state is visible at a glance:

| Icon               | Spec                                     | TEP                    |
| ------------------ | ---------------------------------------- | ---------------------- |
| 🟢 green check     | accepted (completed)                     | `accepted`             |
| 🔵 blue dot        | has open (ready/doing) slices            | `proposed` / in-flight |
| ⚪ neutral outline | not started (no open work, not accepted) | —                      |
| ⚫ muted slash     | —                                        | `superseded`           |

Archived items keep the archive icon regardless of status.

For specs, two per-item right-click actions manage a git **worktree** (parallel work, one tree per spec): **Start Spec in Worktree** creates an isolated worktree + branch and opens a Claude session there; **Retire Spec Worktree** removes that worktree after delivery (refusing if it's dirty/unmerged) — it does _not_ delete the spec. Hover either action for the full description.

## Products

A **Product** is the code-less top node of the hierarchy — a top-level directory in the sidecar board root whose member Thinking Spaces are the board namespaces nested under it (e.g. `Platform/core/thinkube`, `Platform/docs/site` belong to the `Platform` product). A Product exists by virtue of containing board namespaces; an optional **`<product>/product.yaml`** (`name:` + metadata) gives it a display name. Products are discovered straight from the sidecar tree, so they need no `.git` of their own, and they generalize the old fixed `Platform / Apps / Templates` containers into arbitrary, user-defined groupings.

The **`list_products`** tool returns each Product `{ id, name, members }` across the board root (empty when no board root is configured). In the **Thinking Spaces** navigator, Products appear as the top-level nodes — each expands to its member Thinking Spaces and its Projects; repos under no Product stay listed at the top level (nothing disappears). The view title bar has **New Product**; a Product's context menu has **New Project** (both write the manifest under `thinkube.boards.root`).

A **Project** is a bounded multi-repo effort under a Product — a **code-less umbrella** that owns one or more TEPs: `<product>/projects/<name>/` holds `project.yaml` (`name`, `state`) and a `teps/` dir (its umbrella TEPs); it has **no `specs/`** (specs live in code repos, where worktrees are cut). A project's **members are structural, not tagged**: a spec is a member iff its `implements:` resolves to one of the project's umbrella TEPs, and that spec's slices inherit. `implements:` may be **bare** (`TEP-id`, repo-local — the default) or **qualified** (`<namespace>:TEP-id`, cross-repo — written for you by *Promote to Project* / *New Spec in this Project*). **`list_projects`** returns every product's projects; **`get_project`** (by `product` + `id`) returns the umbrella TEPs + the implementing specs and their slices `{ board, handle, kind }`. In the navigator, a Project drills into its umbrella TEP → its implementing specs (cross-repo) → slices. _(Hashtags are an orthogonal **concern** axis — `#security`, `#inference` — not project membership.)_ _(The navigator Product/Project tree and the "New Product"/"New Project" commands land in a follow-up; this is the data + discovery layer.)_

## Tags

Specs, TEPs, and slices carry a free-form **`tags: [...]`** frontmatter array — the cross-board clustering mesh. Tags span multiple axes at once: component (`keycloak`), concern (`security`, `inference`), or project (`rebrand`). They're set via the board tools (`create_slice` / `create_tep` accept a `tags` argument; `update_slice` replaces them — pass `[]` to clear), returned by `get_slice`, and shown on each `list_board` card. A legacy single `theme:` value is still honored (folded in as a tag, never dropped).

The **`list_tags`** tool aggregates the mesh **across every board** in the workspace: it returns each tag with a `count` and the `items` carrying it (`{ board, handle, kind }`), so one tag clusters work wherever it lives. An item with N tags appears under all N. This cross-board clustering is the layer Products and Projects build on — a project is, in effect, a promoted tag.

## Configuration view

The **Configuration** view (Activity Bar → Thinkube AI → **Configuration**) **follows the navigator selection**: select a Thinking Space in **Boards** and the view scopes to _that_ repo's Claude config — its skills, agents, hooks, commands, MCP entries, permissions, and `CLAUDE.md`, read from the repo's `.claude/`. A **Global** node (`~/.claude`) is always shown above it. With no Thinking Space selected, the view shows the Global node plus a _"Select a Thinking Space"_ placeholder. (Selection drives the scope — there is no separate "Set Active Project" step for the config view, and no hardcoded Platform/Apps/Templates roots.)

## Split-pane agent teams in VS Code (experimental)

Claude Code's experimental **agent teams** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) render teammates as `tmux`/iTerm2 split panes. Where neither is available — plain VS Code — this extension ships a fake-`tmux` shim so a team still gets one pane per teammate, as VS Code terminals.

How it works: the extension runs a small IPC server in the host and puts a `tmux` shim on `PATH` ahead of any system tmux (it won't displace a non-Thinkube `tmux` without a one-time confirmation). Claude Code's `tmux` calls are forwarded to the host, which spawns each teammate as a PTY and pipes its output into a dedicated terminal pane; your keystrokes route back to the selected teammate.

When `thinkube.agentTeams.enableExperimental` is on (default), the extension sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for Claude sessions it launches and for integrated terminals, and installs the shim on PATH — so you can just ask Claude to form a team. Set it to `false` to opt out entirely (no flag, no shim, no server). Changes take effect for sessions/terminals started after a window reload.

> **Experimental / requirements.** Needs Claude Code ≥ 2.1.32, and the native `node-pty` module (declared dependency; node-pty 1.x ships ABI-independent N-API prebuilds, so it loads across VS Code / code-server Node runtimes). The reverse-engineered `tmux` surface is re-verified per `docs/claude-code-internals.md` (§7) after Claude Code updates; unrecognised `tmux` calls are logged and no-op'd rather than crashing.

## Two MCPs — disambiguation

The Claude Code ecosystem talks about MCP in two distinct senses; this extension touches both:

- **MCP-1 — your project's MCP server entries.** The config manager (Activity Bar → Thinkube AI → **Configuration** view → MCP Entries) lets you browse, add, and remove entries in `.claude/settings.json` and `.mcp.json` for the Claude sessions running in your project. This is about _what other MCP servers_ Claude can talk to.
- **MCP-2 — this extension _is_ an MCP server.** It registers a stdio MCP server (`thinkube-kanban`) via `vscode.lm.registerMcpServerDefinitionProvider`, exposing 18 tools across the methodology hierarchy (`list_epics`, `move_task`, `create_tasks_from_spec`, `write_retro_note`, …) plus 4 resources (`board_state`, `roadmap`, `issue/{n}`, `thinkube_file/{path}`). Claude sessions discover these automatically while VS Code is running.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Copyright

Copyright 2025–2026 Alejandro Martínez Corriá.

## Feedback

Please file issues at the repo's tracker. The methodology bundle is a deliberately opinionated set of prompts — concrete feedback ("the `/tasks-decompose` skill split this spec too aggressively because…") is the most useful kind.
