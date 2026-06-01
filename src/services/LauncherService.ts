/**
 * LauncherService — Claude Code launcher backed by a cwd-patching process
 * wrapper.
 *
 * VS Code's Claude Code extension exposes `claudeCode.claudeProcessWrapper` —
 * a path to an executable that gets `exec`'d in place of the real `claude`
 * binary, with the real binary as $1. The bundled wrapper scripts under
 * `dist/wrapper/` `cd` to a per-invocation target directory before exec-ing
 * the real CLI, which is what lets "Open Here" actually root a session in the
 * clicked folder regardless of how the host extension would have spawned it.
 *
 * State handoff between this service and the wrapper happens via two files
 * in `globalStorageUri`, whose location is published to the wrapper through
 * the `CLAUDE_CWD_PROXY_DIR` env var:
 *
 *   .target-cwd     absolute path the wrapper should cd to (fresh sessions)
 *   .target-prefix  tab-title prefix injected via --append-system-prompt
 *
 * On resume the wrapper instead reads the original cwd from
 * `~/.claude/projects/*<uuid>.jsonl` — `.target-cwd` is only the seed.
 *
 * Wrapper-path takeover policy: we register our wrapper if the setting is
 * empty or already points at one of our installed paths. Unrecognised
 * third-party wrappers are left alone with a one-time confirmation toast.
 */
import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const CFG_SECTION = "claudeCode";
const CFG_KEY = "claudeProcessWrapper";
const COMPETING_WRAPPER_TOAST_KEY =
  "thinkube.launcher.competingWrapperToastShown";

export class LauncherService implements vscode.Disposable {
  private stateDir: string | undefined;
  private wrapperPath: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async activate(): Promise<void> {
    const wrapperName =
      process.platform === "win32"
        ? "claude-cwd-wrapper.cmd"
        : "claude-cwd-wrapper.sh";
    this.wrapperPath = this.context.asAbsolutePath(
      path.join("dist", "wrapper", wrapperName),
    );

    if (process.platform !== "win32") {
      await fs.chmod(this.wrapperPath, 0o755).catch(() => {});
    }

    this.stateDir = this.context.globalStorageUri.fsPath;
    await fs.mkdir(this.stateDir, { recursive: true });

    // The wrapper reads .target-cwd / .target-prefix from this directory.
    process.env.CLAUDE_CWD_PROXY_DIR = this.stateDir;

    await this.ensureWrapperRegistered();
  }

  private async ensureWrapperRegistered(): Promise<void> {
    if (!this.wrapperPath) return;
    const cfg = vscode.workspace.getConfiguration(CFG_SECTION);
    const current = cfg.get<string>(CFG_KEY);

    // Take over when the setting is empty or already points at one of our
    // installed locations (e.g. an extension reinstall changes the absolute
    // path under the extension's own directory).
    const isOurs = current === this.wrapperPath;
    const isInheritable =
      !current || (current && current.includes("thinkube-ai-integration"));

    if (isOurs) return;

    if (isInheritable) {
      await cfg.update(
        CFG_KEY,
        this.wrapperPath,
        vscode.ConfigurationTarget.Global,
      );
      return;
    }

    // Unknown wrapper — don't displace; warn once.
    await this.showCompetingWrapperToast(current!);
  }

  private async showCompetingWrapperToast(competing: string): Promise<void> {
    const seen = this.context.globalState.get<boolean>(
      COMPETING_WRAPPER_TOAST_KEY,
    );
    if (seen) return;
    await this.context.globalState.update(COMPETING_WRAPPER_TOAST_KEY, true);
    const choice = await vscode.window.showWarningMessage(
      `Thinkube AI launcher disabled: claudeCode.claudeProcessWrapper is already set to "${competing}". Override with Thinkube's wrapper?`,
      "Use Thinkube wrapper",
      "Keep existing",
    );
    if (choice === "Use Thinkube wrapper" && this.wrapperPath) {
      await vscode.workspace
        .getConfiguration(CFG_SECTION)
        .update(CFG_KEY, this.wrapperPath, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Open a fresh Claude Code conversation rooted at `uri`.
   * Writes the handoff files, then delegates to the claude-vscode extension's
   * own command — that command spawns the CLI through our wrapper, which is
   * what actually patches the cwd.
   */
  async openHere(uri?: vscode.Uri): Promise<void> {
    if (!uri) {
      vscode.window.showErrorMessage(
        "Open Claude Code Here: no folder URI in command context.",
      );
      return;
    }
    if (!this.stateDir) {
      vscode.window.showErrorMessage(
        "Open Claude Code Here: launcher not yet activated.",
      );
      return;
    }

    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(uri.fsPath);
    } catch {
      vscode.window.showErrorMessage(
        `Open Claude Code Here: path does not exist: ${uri.fsPath}`,
      );
      return;
    }
    if (!stat.isDirectory()) {
      vscode.window.showErrorMessage(
        `Open Claude Code Here: not a directory: ${uri.fsPath}`,
      );
      return;
    }

    const prefix = buildPrefix(uri);
    await fs.writeFile(
      path.join(this.stateDir, ".target-cwd"),
      uri.fsPath + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(this.stateDir, ".target-prefix"),
      prefix.trimEnd() + "\n",
      "utf8",
    );

    await vscode.commands.executeCommand(
      "claude-vscode.editor.open",
      undefined,
      prefix,
    );
  }

  dispose(): void {
    // Nothing held that VS Code won't reclaim.
  }
}

function buildPrefix(uri: vscode.Uri): string {
  const clickedPath = uri.fsPath;
  const clickedBase = path.basename(clickedPath);
  const ws = vscode.workspace.getWorkspaceFolder(uri);
  if (!ws) {
    return `[${clickedBase}] `;
  }
  const rootBase = path.basename(ws.uri.fsPath);
  if (ws.uri.fsPath === clickedPath) {
    return `[${rootBase}] `;
  }
  return `[${rootBase}/${clickedBase}] `;
}
