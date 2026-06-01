# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension (`thinkube-ai-integration`) that wraps the Claude Code CLI and surfaces Claude Code configuration management inside the editor. It's a TypeScript extension targeting VS Code ≥ 1.100, packaged as a `.vsix` via `vsce` and also publishable to Open VSX. Status: under development — README warns "Not Ready for Use."

## Commands

```bash
npm run compile        # tsc -p ./ && node scripts/build-assets.mjs  (TS + wrapper assets → dist/)
npm run watch          # tsc -watch -p ./  (TS only — re-run compile to refresh wrapper/*)
npm run package        # vsce package → .vsix
npm test               # node ./dist/test/runTest.js (no tests wired up yet)
npm run publish:ovsx   # compile + package + ovsx publish
```

There is no linter and no test suite configured. `main` in `package.json` points to `./dist/extension.js`, so you must run `compile` (or `watch`) before the extension will load in an Extension Host.

## Architecture

The extension has two largely independent concerns, both rooted in `src/extension.ts` (`activate()`):

### 1. Claude launcher (process-wrapper)

Explorer-only context menu (`Open Here`) that opens a new Claude Code conversation rooted in the clicked folder. There is **no terminal** and **no `--add-dir` injection** anymore — we patch the spawn cwd of the real `claude` binary by registering a wrapper script at `claudeCode.claudeProcessWrapper`. Flow:

1. `LauncherService.activate()` (`src/services/LauncherService.ts`) writes the absolute path of `dist/wrapper/claude-cwd-wrapper.{sh,cmd}` into the `claudeCode.claudeProcessWrapper` user setting, mkdir's `globalStorageUri`, and exports its path as `CLAUDE_CWD_PROXY_DIR` so the wrapper can find the handoff files.
2. `openHere(uri)` writes `<stateDir>/.target-cwd` (the clicked folder) and `.target-prefix` (a `[repo/sub] ` tab-title hint), then invokes `claude-vscode.editor.open` — claude-vscode spawns the CLI, our wrapper intercepts, `cd`s to `.target-cwd`, and `exec`s the real binary.
3. On `--resume` / `--continue`, the wrapper instead reads the session's original cwd from `~/.claude/projects/*<uuid>.jsonl` — `.target-cwd` is only the seed for fresh sessions.

Wrappers live at `wrapper/` in the repo and are copied to `dist/wrapper/` by `scripts/build-assets.mjs` (run after `tsc` via `npm run compile`). Wrapper-takeover policy: register only if the setting is empty or already points at one of our installed paths; unknown third-party wrappers trigger a one-time confirmation toast.

### 2. Claude Code configuration manager (the larger feature)

A sidebar ("Thinkube AI" activity-bar view) with two panels:

- **`thinkube.chatPanel`** — `ChatPanel` webview (`src/views/sidebar/ChatPanel.ts`) for conversing with Claude about configuration.
- **`claudeConfigTree`** — `ConfigTreeProvider` (`src/views/sidebar/ConfigTreeProvider.ts`) that renders a tree of `.claude/` contents across multiple projects and supports add/delete/generate actions on every node type.

The data model lives in `src/models/` — one file per entity (`Hook`, `Command`, `Skill`, `Agent`, `McpServer`, `ClaudeConfig`) with `parseXMarkdown` / `xToMarkdown` helpers. Persistence is the responsibility of `ClaudeConfigService` (`src/services/ClaudeConfigService.ts`), which reads/writes the on-disk layout that Claude Code itself expects:

```
<project>/.claude/settings.json        # hooks, permissions, MCP servers, plus passthrough fields
<project>/.claude/settings.local.json
<project>/.claude/commands/<name>.md   # slash commands
<project>/.claude/skills/<name>/SKILL.md
<project>/.claude/agents/<name>.md     # subagents
<project>/.mcp.json                    # project-root MCP servers
<project>/CLAUDE.md                    # project instructions
```

`ClaudeSettings` is typed as `Record<string, unknown>` with typed accessors for known fields — **any unknown fields in `settings.json` must be preserved during read-modify-write**. Do not replace the file wholesale; merge.

### Active-project model

The extension supports multi-root workspaces and treats any directory (not only workspace folders) as a potential Claude project. Active-project state lives in `src/context/active.ts` (`currentActiveContext`, accessed via `getCurrentActiveContext` / `updateActiveContext`); `extension.ts` seeds it once at activation via `initActiveContext`. It's updated from (a) tree selection, (b) active editor changes (walks up looking for `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`), or (c) the `thinkube.switchProject` quick-pick. The tree always shows **all** projects regardless of active context.

### Services

- **`ClaudeConfigService`** — the single source of truth for reading/writing `.claude/*`. All tree/command handlers route through it. Emits `onConfigChanged` for the tree to refresh.
- **`ClaudeAnalyzer`** (`src/services/ClaudeAnalyzer.ts`) — spawns the `claude` CLI for chat/analysis. Extension startup shows a warning toast if `claude` isn't on PATH.
- **`ClaudeLauncher`** (`src/services/ClaudeLauncher.ts`) — opens a terminal and drives `claude` with pre-built prompts to generate hooks/commands/skills/agents/MCP servers or a full project setup. Because we can't detect CLI exit, after launching we show a "Refresh Tree" notification (`scheduleTreeRefresh`) rather than auto-refreshing.
- **`ProjectAnalyzer`** — detects tooling (package managers, frameworks, test runners) and proposes `ConfigSuggestion`s.
- **`QuickSetup`** — applies `ProjectAnalyzer` suggestions to create a starter `.claude/` without going through the CLI.
- **`PluginService` / `PluginTemplates`** — browse/install/create Claude Code plugins from marketplaces; UI in `src/views/wizards/PluginCreationWizard.ts`. Marked "WIP" in recent commits.

### Command registration

All user-facing commands are declared in `package.json` → `contributes.commands`. `extension.ts` is intentionally thin (~115 lines) — it only wires services and delegates registration to two groups:

- `thinkube-ai.claude.openHere` — the single launcher command, registered by `registerLauncherCommands` in `src/commands/launcher.ts` (delegates to `LauncherService`)
- `thinkube.*` — config-manager commands, registered by `registerConfigCommands` in `src/commands/config.ts` (handlers receive a deps object with `configService`, `treeProvider`, `claudeLauncher`, and the active-context accessors)

The previous `thinkube-ai.app.*` / `thinkube-ai.deploy.preview` scaffolding commands and the `claude.continueHere` / `claude.addDirectory` / `claude.configureProject` / `claude.showConfiguration` legacy launcher commands were removed in chunk 2 (along with the `.thinkube/claude-config` `add-dir:` format) when the launcher switched to the process-wrapper approach.

When adding a command, update **both** `package.json` (declaration + menu bindings) and the appropriate `register*` function. Context keys used in `when` clauses: `thinkube.hasClaudeConfig`, `thinkube.activeContext`, and `viewItem == <kind>-section | <kind>` on tree nodes.

## Thinkube deployment context

This repo is a workspace sibling of `thinkube-control`, `thinkube-installer`, and the other `thinkube-platform/` repos, but it is **not** part of the platform deployment pipeline — there is no Copier/Gitea/Argo flow for this extension. It's a standalone VS Code extension. Ignore the `thinkube-control` deployment workflow described in parent `CLAUDE.md` files when working here; it doesn't apply.

The `tk-ai-extension/` sibling directory is a **different** project (a JupyterLab extension), not this one.
