/**
 * SessionLinkService — keeps launcher-created Claude sessions visible in
 * claude-code's native Session History picker. See sessionLinks.ts for the
 * underlying why & how; this class owns the vscode-side lifecycle:
 *
 *  - remembers every "Open Here" target folder (globalState),
 *  - sweeps on activation, on workspace-folder changes, and after each
 *    launch — polling for a while after a launch because the transcript
 *    file only appears once the user sends their first message.
 */
import * as os from "node:os";
import * as vscode from "vscode";

import { ensureSessionLinked, sweepSessionLinks } from "./sessionLinks";

const STATE_KEY = "thinkube.launcher.sessionLinkTargets";
const POLL_INTERVAL_MS = 20_000;
const POLL_WINDOW_MS = 10 * 60_000;

export class SessionLinkService implements vscode.Disposable {
  private poller: ReturnType<typeof setInterval> | undefined;
  private pollUntil = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): void {
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.sweep()),
    );
    void this.sweep();
  }

  /** Called by LauncherService right after a successful "Open Here". */
  noteLaunch(targetFsPath: string): void {
    const targets = this.targets();
    if (!targets.includes(targetFsPath)) {
      void this.context.globalState.update(STATE_KEY, [
        ...targets,
        targetFsPath,
      ]);
    }
    // The new session's transcript doesn't exist until the first prompt is
    // sent, so keep sweeping for a window rather than just once.
    this.pollUntil = Date.now() + POLL_WINDOW_MS;
    if (!this.poller) {
      this.poller = setInterval(() => {
        if (Date.now() > this.pollUntil) {
          this.stopPolling();
          return;
        }
        void this.sweep();
      }, POLL_INTERVAL_MS);
    }
    void this.sweep();
  }

  /**
   * Make one transcript visible to the picker right now — used before a
   * resume-by-id, which silently falls back to a new session when the
   * transcript isn't in the picker's project dir (F6).
   */
  async ensureVisible(sessionFile: string): Promise<void> {
    await ensureSessionLinked(sessionFile, this.pickerCwd());
  }

  private targets(): string[] {
    return this.context.globalState.get<string[]>(STATE_KEY, []);
  }

  /**
   * claude-code scopes the picker to workspaceFolders[0], falling back to
   * the home dir when no folder is open — mirror exactly that.
   */
  private pickerCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  private async sweep(): Promise<void> {
    const targets = this.targets();
    if (targets.length === 0) return;
    try {
      await sweepSessionLinks(this.pickerCwd(), targets);
    } catch (err) {
      console.error("SessionLinkService: sweep failed:", err);
    }
  }

  private stopPolling(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
  }
}
