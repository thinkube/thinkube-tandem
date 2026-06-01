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
 * Settings drive the definition. When `thinkube.kanban.repo` is unset, we
 * provide no definitions at all (the server has nothing to talk to).
 * Settings changes fire `onDidChangeMcpServerDefinitions` so VS Code
 * re-fetches and re-launches as needed.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";

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
        e.affectsConfiguration("thinkube.kanban.repo") ||
        e.affectsConfiguration("thinkube.kanban.projectNumber") ||
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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.log("no workspace folder; refusing to launch MCP server");
      throw new Error(
        "Thinkube Kanban MCP: open a workspace folder before starting the server.",
      );
    }

    // Resolve a token non-interactively — at launch time we're inside a
    // background flow, no place to show an input box. If a token isn't
    // available, the subprocess will fail on the first GitHub call with
    // a clear error; we don't block startup.
    const token = await this.deps.auth.getToken({ prompt: false });

    // Mode trumps the explicit allowAIWrites flag: navigator forces
    // read-only, regardless of the flag. driver / both leave it as set.
    const effectiveAllowWrites = cfg.mode !== "navigator" && cfg.allowAIWrites;
    const env: Record<string, string | number | null> = {
      THINKUBE_WORKSPACE: workspaceFolder.uri.fsPath,
      THINKUBE_REPO: cfg.repo,
      THINKUBE_PROJECT_NUMBER: String(cfg.projectNumber),
      THINKUBE_ALLOW_AI_WRITES: effectiveAllowWrites ? "true" : "false",
      THINKUBE_MODE: cfg.mode,
    };
    if (token) {
      env.GITHUB_TOKEN = token;
    } else {
      this.log(
        "WARN: no GitHub token resolved; MCP server will fail on first call",
      );
    }

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
  repo: string;
  projectNumber: number;
  allowAIWrites: boolean;
  mode: "navigator" | "driver" | "both";
}

function readSettings(): ResolvedSettings | undefined {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const repo = (cfg.get<string>("repo") ?? "").trim();
  if (!repo.includes("/")) return undefined;
  const rawMode = cfg.get<string>("mode") ?? "both";
  const mode =
    rawMode === "navigator" || rawMode === "driver" ? rawMode : "both";
  return {
    repo,
    projectNumber: cfg.get<number>("projectNumber") ?? 0,
    allowAIWrites: cfg.get<boolean>("allowAIWrites") ?? true,
    mode,
  };
}
