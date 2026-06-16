/**
 * ControlRequestWatcher — the Extension-Host end of the MCP→host control
 * channel (SP-tgpwbm AC8).
 *
 * The standalone (Claude-Code-spawned) Kanban MCP server can't open a VS Code
 * session itself, so `start_spec_worktree` writes a one-shot JSON request into
 * the shared control dir. This watcher — the same `vscode.FileSystemWatcher`
 * pattern the board uses for MCP-side slice writes — reacts to that file, runs
 * the matching command (`thinkube.specs.startWorktree`, the button's machinery),
 * and deletes the request (fire-once). Always-on: deliberately NOT gated on the
 * agent-teams feature, since opening a worktree session has nothing to do with
 * tmux emulation.
 *
 * The request parsing/routing is the pure `controlRequests` module; the file
 * I/O here is the untested shell.
 */
import * as vscode from "vscode";
import * as path from "node:path";

import {
  parseControlRequest,
  routeControlRequest,
} from "../mcp/controlRequests";

/** The shared control dir, derived from globalStorage so the MCP env and the
 *  watcher agree on one location (published to the MCP as THINKUBE_CONTROL_DIR). */
export function controlDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "control");
}

export class ControlRequestWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly dir: string,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Start watching the control dir for request files. Idempotent. */
  async activate(): Promise<void> {
    if (this.watcher) return;
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.dir));
    const pattern = new vscode.RelativePattern(this.dir, "*.json");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidCreate((uri) => void this.handle(uri));
    this.watcher.onDidChange((uri) => void this.handle(uri));
  }

  private async handle(uri: vscode.Uri): Promise<void> {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(
        "utf8",
      );
    } catch {
      return; // file vanished (consumed by a concurrent handler) — fine
    }
    const req = parseControlRequest(text);
    // Consume the request fire-once, whether or not it parsed, so a malformed
    // file doesn't re-fire on every change.
    await vscode.workspace.fs.delete(uri).then(undefined, () => {});
    if (!req) {
      this.log(`ignored unrecognized control request: ${uri.fsPath}`);
      return;
    }
    try {
      await routeControlRequest(req, {
        startWorktree: (spec) =>
          this.openWorktree(spec, "repo" in req ? req.repo : undefined),
      });
    } catch (err) {
      this.log(`control request ${req.kind} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Run the same command the "Start Spec in Worktree" button runs. The handler
   * reads `kind` / `specNumber` / `repoPath` / `hasOpenWork` off the node, so a
   * minimal node-shaped payload drives it without coupling to the full SpecNode.
   */
  private async openWorktree(spec: string, repo?: string): Promise<void> {
    const repoPath = repo ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!repoPath) {
      this.log(`start-worktree ${spec}: no repo to root the worktree`);
      return;
    }
    await vscode.commands.executeCommand("thinkube.specs.startWorktree", {
      kind: "spec",
      specNumber: spec,
      repoPath,
      hasOpenWork: true,
    });
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }
}
