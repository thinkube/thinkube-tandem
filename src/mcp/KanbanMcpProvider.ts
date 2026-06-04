/**
 * KanbanMcpProvider — exposes the Thinkube methodology kanban as an MCP
 * server to any LLM client running inside this VS Code instance.
 *
 * VS Code's MCP plumbing is: extensions register a
 * `McpServerDefinitionProvider`, and VS Code launches the resulting
 * subprocesses on demand when an LLM session wants to use them. We provide
 * one definition: a stdio Node script at `dist/mcp/kanbanMcpServer.js`.
 *
 * Two-phase resolution. `provideMcpServerDefinitions` returns a bare
 * definition (no env, no auth) — it runs at registration time. The auth
 * resolution happens lazily in `resolveMcpServerDefinition`, called by VS
 * Code just before launch — that way we don't burn a token lookup on
 * extension activation and we always pick up the freshest GH credentials.
 *
 * Files-first: the server is provided only when a methodology root exists (a
 * configured or discoverable `.thinkube/`). No GitHub repo/project is needed.
 * Settings changes fire `onDidChangeMcpServerDefinitions` so VS Code
 * re-fetches and re-launches as needed.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import {
  getMethodologyRoot,
  getMethodologyRootOrUndefined,
} from "../github/workspaceRepo";

const SERVER_LABEL = "Thinkube Kanban";

export interface KanbanMcpProviderDeps {
  extensionUri: vscode.Uri;
  auth: AuthService;
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
        e.affectsConfiguration("thinkube.kanban.folder") ||
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
    const cfg = readSettings();
    if (!cfg) return [];
    const scriptPath = path.join(
      this.deps.extensionUri.fsPath,
      "dist",
      "mcp",
      "kanbanMcpServer.js",
    );
    // env starts empty; `resolveMcpServerDefinition` fills it in with
    // freshly-resolved settings + token just before VS Code launches.
    return [
      new vscode.McpStdioServerDefinition(
        SERVER_LABEL,
        "node",
        [scriptPath],
        {},
      ),
    ];
  }

  async resolveMcpServerDefinition(
    server: vscode.McpStdioServerDefinition,
    _token: vscode.CancellationToken,
  ): Promise<vscode.McpStdioServerDefinition> {
    const cfg = readSettings();
    if (!cfg) return server;

    let workspaceFsPath: string;
    try {
      workspaceFsPath = getMethodologyRoot();
    } catch (err) {
      this.log(`refusing to launch MCP server: ${(err as Error).message}`);
      throw new Error(`Thinkube Kanban MCP: ${(err as Error).message}`);
    }

    // Files-first: the server reads/writes only `.thinkube/` under the
    // workspace. No GitHub coords or token are needed. Mode trumps the
    // explicit allowAIWrites flag: navigator forces read-only, regardless of
    // the flag. driver / both leave it as set.
    const effectiveAllowWrites = cfg.mode !== "navigator" && cfg.allowAIWrites;
    const env: Record<string, string | number | null> = {
      THINKUBE_WORKSPACE: workspaceFsPath,
      THINKUBE_ALLOW_AI_WRITES: effectiveAllowWrites ? "true" : "false",
      THINKUBE_MODE: cfg.mode,
    };

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

interface ResolvedSettings {
  allowAIWrites: boolean;
  mode: "navigator" | "driver" | "both";
}

function readSettings(): ResolvedSettings | undefined {
  // Files-first launch gate: only provide the server when a methodology root
  // exists (a configured/discoverable `.thinkube/`). No GitHub repo/project.
  if (!getMethodologyRootOrUndefined()) return undefined;
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const rawMode = cfg.get<string>("mode") ?? "both";
  const mode =
    rawMode === "navigator" || rawMode === "driver" ? rawMode : "both";
  return {
    allowAIWrites: cfg.get<boolean>("allowAIWrites") ?? true,
    mode,
  };
}
