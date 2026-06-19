/**
 * Writes the machine-level kanban-MCP config file (TEP-tgvwct, Phase 3).
 *
 * The plugin-shipped server (`node ${CLAUDE_PLUGIN_ROOT}/mcp/kanban.js`) gets no
 * per-repo `.mcp.json` env injection, so the extension writes the same board
 * root / folders / roots it would have injected into a machine-level file the
 * server reads (`serverConfig.resolveServerConfig`, precedence env → file → cwd).
 * Mirrors `buildMcpEnv` in `commands/bundle.ts`.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/** `<CLAUDE_CONFIG_DIR or ~/.claude>/thinkube-mcp.json`. */
export function machineConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(dir, "thinkube-mcp.json");
}

/** Write the machine-level config from the current workspace + settings.
 *  Best-effort; idempotent enough (overwrites with the current truth). */
export async function writeMachineMcpConfig(): Promise<void> {
  const kanbanCfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const mode = kanbanCfg.get<string>("mode") ?? "both";
  const allowAIWrites =
    mode === "navigator" ? false : (kanbanCfg.get<boolean>("allowAIWrites") ?? true);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const boardRoot = vscode.workspace
    .getConfiguration("thinkube.boards")
    .get<string>("root")
    ?.trim();

  const cfg: Record<string, unknown> = { allowAIWrites };
  if (boardRoot) cfg.boardRoot = boardRoot;
  if (folders.length) {
    cfg.folders = folders;
    cfg.roots = folders.map((f) => f.path);
  }

  const file = machineConfigPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
