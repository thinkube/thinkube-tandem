/**
 * KanbanMcpProvider — exposes the Thinkube methodology kanban as an MCP
 * server to VS Code-native LLM clients in this instance. (Claude Code
 * sessions don't come through here — they discover the same server via each
 * repo's `.mcp.json`, written by the bundle installer.)
 *
 * VS Code's MCP plumbing is: extensions register a
 * `McpServerDefinitionProvider`, and VS Code launches the resulting
 * subprocesses on demand when an LLM session wants to use them.
 *
 * Board-independent (ADR-0007 Phase 6): ONE definition serves every board —
 * the server takes the board as a per-call tool parameter and discovers
 * boards under THINKUBE_ROOTS (the workspace folders). No single configured
 * methodology root, no per-board definitions.
 *
 * Two-phase resolution. `provideMcpServerDefinitions` returns a bare
 * definition (no env) — it runs at registration time.
 * `resolveMcpServerDefinition` fills the env lazily just before VS Code
 * launches, so the freshest settings/workspace folders always win.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { discoverRepos } from "../views/boards/BoardNavigatorProvider";
import { stableServerScriptPath } from "./stableServerPath";

const SERVER_LABEL = "Thinkube Kanban";

export interface KanbanMcpProviderDeps {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
}

export class KanbanMcpProvider implements vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this._onDidChange.event;

  constructor(private readonly deps: KanbanMcpProviderDeps) {}

  /**
   * Register provider + wire settings/workspace listeners that fire the
   * change event so VS Code re-fetches definitions on relevant edits.
   */
  static install(
    context: vscode.ExtensionContext,
    deps: KanbanMcpProviderDeps,
  ): KanbanMcpProvider {
    const provider = new KanbanMcpProvider(deps);
    const registration = vscode.lm.registerMcpServerDefinitionProvider(
      "thinkube.kanban",
      provider,
    );
    context.subscriptions.push(registration, provider);

    const settingsListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("thinkube.kanban.allowAIWrites") ||
        e.affectsConfiguration("thinkube.kanban.mode")
      ) {
        provider.refresh();
      }
    });
    const folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.refresh();
    });
    context.subscriptions.push(settingsListener, folderListener);

    return provider;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  /** Force VS Code to re-call `provideMcpServerDefinitions`. */
  refresh(): void {
    this._onDidChange.fire();
  }

  provideMcpServerDefinitions(): vscode.ProviderResult<
    vscode.McpStdioServerDefinition[]
  > {
    // Files-first launch gate: only provide the server when at least one
    // board (repo with a committed `.thinkube/`) exists in the workspace.
    if (!discoverRepos().some((r) => r.enabled)) return [];
    // env starts empty; `resolveMcpServerDefinition` fills it in just
    // before VS Code launches the subprocess.
    return [
      new vscode.McpStdioServerDefinition(
        SERVER_LABEL,
        "node",
        [stableServerScriptPath(this.deps.context)],
        {},
      ),
    ];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
    _token: vscode.CancellationToken,
  ): Promise<vscode.McpStdioServerDefinition> {
    const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
    const rawMode = cfg.get<string>("mode") ?? "both";
    const mode =
      rawMode === "navigator" || rawMode === "driver" ? rawMode : "both";
    // Mode trumps the explicit allowAIWrites flag: navigator forces
    // read-only, regardless of the flag. driver / both leave it as set.
    const allowWrites =
      mode !== "navigator" && (cfg.get<boolean>("allowAIWrites") ?? true);

    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    const roots = folders.map((f) => f.path).join(path.delimiter);
    // The central board root (SP-8): boards live at <root>/<container>/<rel>.
    const boardRoot = vscode.workspace
      .getConfiguration("thinkube.boards")
      .get<string>("root")
      ?.trim();
    const env: Record<string, string | number | null> = {
      THINKUBE_ALLOW_AI_WRITES: allowWrites ? "true" : "false",
      THINKUBE_MODE: mode,
    };
    if (roots) env.THINKUBE_ROOTS = roots;
    // Folder names carry the namespace container (Apps/Platform/…), so pass the
    // full {name,path} list — not just paths.
    if (folders.length) env.THINKUBE_FOLDERS = JSON.stringify(folders);
    if (boardRoot) env.THINKUBE_BOARD_ROOT = boardRoot;

    this.log(
      `launching board-independent server (boardRoot=${boardRoot || "(none)"} roots=${roots || "(none)"} writes=${allowWrites})`,
    );
    return new vscode.McpStdioServerDefinition(
      server.label,
      server.command,
      server.args,
      env,
    );
  }

  private log(line: string): void {
    this.deps.output.appendLine(`[mcp-provider] ${line}`);
  }
}
