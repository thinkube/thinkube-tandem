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

import { SessionLinkService } from "./SessionLinkService";
import {
  ensureStableServerLink,
  stableExtensionSubpath,
} from "../mcp/stableServerPath";

const CFG_SECTION = "claudeCode";
const CFG_KEY = "claudeProcessWrapper";
const COMPETING_WRAPPER_TOAST_KEY =
  "thinkube.launcher.competingWrapperToastShown";

export class LauncherService implements vscode.Disposable {
  private stateDir: string | undefined;
  private wrapperPath: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessionLinks?: SessionLinkService,
  ) {}

  async activate(): Promise<void> {
    const wrapperName =
      process.platform === "win32"
        ? "claude-cwd-wrapper.cmd"
        : "claude-cwd-wrapper.sh";
    // Resolve the wrapper through the version-stable `extension-current` symlink,
    // NOT `context.asAbsolutePath` (which bakes the versioned install dir and gets
    // orphaned on every update — the bug that left the setting pinned to an old
    // version). Ensure the symlink exists first so the path resolves.
    await ensureStableServerLink(this.context).catch(() => {});
    this.wrapperPath = stableExtensionSubpath(
      this.context,
      "dist",
      "wrapper",
      wrapperName,
    );

    if (process.platform !== "win32") {
      await fs.chmod(this.wrapperPath, 0o755).catch(() => {});
    }

    this.stateDir = this.context.globalStorageUri.fsPath;
    await fs.mkdir(this.stateDir, { recursive: true });

    // The wrapper reads .target-cwd / .target-prefix from this directory.
    process.env.CLAUDE_CWD_PROXY_DIR = this.stateDir;

    // Provenance signing (TEP-6 SP-1): publish the signing-secret dir on the host
    // env so every launched session's kanban MCP server inherits it
    // (host → claude → MCP, the same inheritance CLAUDE_CWD_PROXY_DIR rides). Its
    // presence turns on write_spec's verifiability audit + signing and readyGate's
    // signature check. One stable globalStorage dir means all servers share one key;
    // `??=` lets an explicit override (e.g. tests) win.
    process.env.THINKUBE_SIGNING_KEY_DIR ??= path.join(
      this.stateDir,
      "signing",
    );

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
      !current || (current && current.includes("thinkube-tandem"));

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
      `Thinkube Tandem launcher disabled: claudeCode.claudeProcessWrapper is already set to "${competing}". Override with Thinkube Tandem's wrapper?`,
      "Use Thinkube Tandem wrapper",
      "Keep existing",
    );
    if (choice === "Use Thinkube Tandem wrapper" && this.wrapperPath) {
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
   *
   * `prefill` overrides the text seeded into the chat input (the second
   * argument of `claude-vscode.editor.open` lands in the input box — see
   * docs/claude-code-internals.md, F6). Default: the `[repo/sub]` prefix.
   * Used by the thinking space's "New Spec" button to seed `/spec-prepare <n> `.
   */
  async openHere(uri?: vscode.Uri, prefill?: string): Promise<void> {
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
      prefill ?? prefix,
    );

    // Keep the new session reachable after its tab is gone: remember the
    // target so SessionLinkService mirrors its transcript into the Session
    // History picker's project dir once the first prompt creates it.
    this.sessionLinks?.noteLaunch(uri.fsPath);
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
