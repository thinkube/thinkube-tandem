/**
 * Writes the machine-level kanban-MCP config file (TEP-tgvwct, Phase 3).
 *
 * The plugin-shipped server (`node ${CLAUDE_PLUGIN_ROOT}/mcp/kanban.js`) gets no
 * per-repo `.mcp.json` env injection, so the extension writes the same thinking space
 * root / folders / roots it would have injected into a machine-level file the
 * server reads (`serverConfig.resolveServerConfig`, precedence env → file → cwd).
 * Mirrors `buildMcpEnv` in `commands/bundle.ts`.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { applyKanbanRegistration } from "./kanbanRegistration";
import { stableExtensionSubpath } from "./stableServerPath";

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/thinkube-mcp.json`. */
export function machineConfigPath(): string {
  const dir =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(dir, "thinkube-mcp.json");
}

/**
 * Claude Code's user-scope config file — `~/.claude.json` (or
 * `$CLAUDE_CONFIG_DIR/.claude.json`). This is where user-scope `mcpServers` live —
 * the store `claude mcp add -s user` writes and that `claude mcp list` reads.
 * NOTE: `~/.claude/settings.json`'s `mcpServers` key is NOT consulted for MCP
 * (verified via `claude mcp list`), so the registration MUST land here.
 */
export function userConfigPath(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? os.homedir();
  return path.join(base, ".claude.json");
}

/** Write the machine-level config from the current workspace + settings.
 *  Best-effort; idempotent enough (overwrites with the current truth). */
export async function writeMachineMcpConfig(): Promise<void> {
  const kanbanCfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const mode = kanbanCfg.get<string>("mode") ?? "both";
  const allowAIWrites =
    mode === "navigator"
      ? false
      : (kanbanCfg.get<boolean>("allowAIWrites") ?? true);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const thinkingSpaceRoot = vscode.workspace
    .getConfiguration("thinkube.thinkingSpace")
    .get<string>("root")
    ?.trim();

  const cfg: Record<string, unknown> = { allowAIWrites };
  if (thinkingSpaceRoot) cfg.thinkingSpaceRoot = thinkingSpaceRoot;
  if (folders.length) {
    cfg.folders = folders;
    cfg.roots = folders.map((f) => f.path);
  }

  const file = machineConfigPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

/**
 * The kanban MCP server registration Claude Code reads from user-scope
 * `mcpServers` (TEP-th3i18 follow-up). cwd-INDEPENDENT: one entry serves EVERY
 * session — a code repo, a worktree, and a board thinking-space sidecar that has
 * no per-repo `.mcp.json`. The sidecar is exactly the case that regressed when the
 * plugin stopped vendoring the server (375f1d3) and per-repo `.mcp.json` became the
 * only delivery path — it never reaches a non-repo folder.
 *
 * This builds the same env each repo's `.mcp.json` carries (and that the deleted
 * `KanbanMcpProvider` assembled), but on the channel Claude Code actually consumes:
 * Claude ignores VS Code's `registerMcpServerDefinitionProvider`, so the provider
 * could never have served Claude sessions — only this user-scope registration can.
 *
 * The server script resolves through the version-stable `extension-current` symlink
 * so an extension update never orphans it. Signing points at `<globalStorage>/signing`
 * — the same key dir the launcher publishes on the host env — so the verifiability
 * audit + signature stay on and existing signatures still verify.
 */
export function kanbanServerEntry(
  context: vscode.ExtensionContext,
): Record<string, unknown> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const rawMode = cfg.get<string>("mode") ?? "both";
  const mode =
    rawMode === "navigator" || rawMode === "driver" ? rawMode : "both";
  // navigator forces read-only regardless of the flag (mirrors the old provider).
  const allowWrites =
    mode !== "navigator" && (cfg.get<boolean>("allowAIWrites") ?? true);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const roots = folders.map((f) => f.path).join(path.delimiter);
  const thinkingSpaceRoot = vscode.workspace
    .getConfiguration("thinkube.thinkingSpace")
    .get<string>("root")
    ?.trim();
  const docsGateMode =
    cfg.get<string>("docsGateMode") === "blocking" ? "blocking" : "advisory";
  const gs = context.globalStorageUri.fsPath;

  const env: Record<string, string> = {
    THINKUBE_ALLOW_AI_WRITES: allowWrites ? "true" : "false",
    THINKUBE_MODE: mode,
    THINKUBE_DOCS_GATE_MODE: docsGateMode,
    // The launcher publishes THINKUBE_SIGNING_KEY_DIR=<globalStorage>/signing on the
    // host env; match it (NOT the deleted provider's bare globalStorage) so the audit
    // signs with — and readyGate verifies against — the one live key.
    THINKUBE_SIGNING_KEY_DIR: path.join(gs, "signing"),
  };
  if (roots) env.THINKUBE_ROOTS = roots;
  if (folders.length) env.THINKUBE_FOLDERS = JSON.stringify(folders);
  if (thinkingSpaceRoot) env.THINKUBE_THINKING_SPACE_ROOT = thinkingSpaceRoot;

  return {
    command: "node",
    args: [
      stableExtensionSubpath(context, "dist", "mcp", "kanbanMcpServer.js"),
    ],
    env,
  };
}

/**
 * Register the kanban server at user scope (in `~/.claude.json` `mcpServers`) so
 * Claude Code sees it in EVERY session regardless of cwd. Best-effort and
 * idempotent — it only writes when the entry actually changed, so after the first
 * activation every later one reads, finds it current, and writes nothing (no churn,
 * no race on a file Claude itself owns). When it does write, it goes through a
 * temp-file + atomic rename so a concurrent reader never sees a half-written config,
 * and EVERY existing key (projects, history, other servers) is preserved. Refuses to
 * touch an existing-but-unparseable file — a malformed `JSON.parse` throws to the
 * caller, which logs it, and the file is left exactly as found.
 */
export async function ensureKanbanMcpRegistration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const file = userConfigPath();
  let raw: string | undefined;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
    raw = undefined; // missing → create a fresh config file
  }
  const parsed =
    raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);

  const { settings, changed } = applyKanbanRegistration(
    parsed,
    kanbanServerEntry(context),
  );
  if (!changed) return;

  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.thinkube-${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file); // atomic swap — never leave a half-written ~/.claude.json
}
