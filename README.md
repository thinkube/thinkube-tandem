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
