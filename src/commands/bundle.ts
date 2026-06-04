/**
 * Methodology-bundle commands.
 *
 * Three palette-invocable commands wrap `BundleInstaller`:
 *
 *   thinkube.kanban.installBundle  — install / re-apply the bundle (asks
 *                                    "merge-modified-only" vs "reapply" if
 *                                    the bundle is already installed).
 *   thinkube.kanban.statusBundle   — show the bundle's status in a toast +
 *                                    write a structured report to the
 *                                    Thinkube Kanban output channel.
 *   thinkube.kanban.diffBundle     — write a per-file diff to the output
 *                                    channel for review.
 *
 * The full Config-tree integration (status badge + per-file action buttons
 * inside the existing ConfigTreeProvider) is deferred to chunk-13 polish —
 * it touches the chunk-1 tree code substantively.
 */
import * as vscode from "vscode";

import { getMethodologyRoot } from "../github/workspaceRepo";
import {
  BundleInstaller,
  StatusReport,
  summarizeStatus,
} from "../methodology/BundleInstaller";

export interface BundleCommandDeps {
  installer: BundleInstaller;
  output: vscode.OutputChannel;
}

export function registerBundleCommands(
  context: vscode.ExtensionContext,
  deps: BundleCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.kanban.installBundle", () =>
      installBundle(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.statusBundle", () =>
      statusBundle(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.diffBundle", () =>
      diffBundle(deps),
    ),
  );
}

async function installBundle(deps: BundleCommandDeps): Promise<void> {
  let workspace: string;
  try {
    workspace = getMethodologyRoot();
  } catch (err) {
    vscode.window.showErrorMessage(`Install Bundle: ${(err as Error).message}`);
    return;
  }

  let strategy: "reapply" | "merge-modified-only" = "reapply";
  try {
    const status = await deps.installer.getStatus(workspace);
    if (status.status === "locally-modified") {
      const choice = await vscode.window.showWarningMessage(
        `Bundle is installed but ${status.files.filter((f) => f.state === "modified-locally").length} file(s) have local edits. Keep local edits, or overwrite everything?`,
        "Keep local edits",
        "Overwrite all",
      );
      if (!choice) return;
      strategy =
        choice === "Keep local edits" ? "merge-modified-only" : "reapply";
    }
  } catch {
    // No status yet — first install, strategy doesn't matter.
  }

  // Non-secret env baked into .mcp.json so the standalone Kanban MCP server
  // knows which workspace (.thinkube/ root) to read/write when Claude Code
  // launches it. Files-first: no GitHub repo/board/token is involved.
  const kanbanCfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const mode = kanbanCfg.get<string>("mode") ?? "both";
  const allowWrites =
    mode === "navigator"
      ? false
      : (kanbanCfg.get<boolean>("allowAIWrites") ?? true);
  const mcpEnv: Record<string, string> = {
    THINKUBE_WORKSPACE: workspace,
    THINKUBE_ALLOW_AI_WRITES: String(allowWrites),
  };

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing Thinkube Methodology Bundle…",
    },
    async () => {
      try {
        const result = await deps.installer.install(workspace, {
          strategy,
          mcpEnv,
        });
        deps.output.show(true);
        deps.output.appendLine(
          `[bundle] installed v${result.version} (strategy=${strategy})`,
        );
        for (const w of result.written) {
          deps.output.appendLine(`  wrote ${w}`);
        }
        for (const s of result.skipped) {
          deps.output.appendLine(`  skipped ${s.target}: ${s.reason}`);
        }
        vscode.window.showInformationMessage(
          `Methodology bundle v${result.version} installed (${result.written.length} files written, ${result.skipped.length} skipped).`,
        );
      } catch (err) {
        deps.output.appendLine(
          `[bundle] install failed: ${(err as Error).message}`,
        );
        vscode.window.showErrorMessage(
          `Bundle install failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

async function statusBundle(deps: BundleCommandDeps): Promise<void> {
  let workspace: string;
  try {
    workspace = getMethodologyRoot();
  } catch (err) {
    vscode.window.showErrorMessage(`Bundle status: ${(err as Error).message}`);
    return;
  }
  try {
    const report = await deps.installer.getStatus(workspace);
    const summary = summarizeStatus(report);
    deps.output.show(true);
    deps.output.appendLine(`[bundle] ${summary}`);
    appendDiffLines(deps.output, report);
    vscode.window.showInformationMessage(summary);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Bundle status failed: ${(err as Error).message}`,
    );
  }
}

async function diffBundle(deps: BundleCommandDeps): Promise<void> {
  let workspace: string;
  try {
    workspace = getMethodologyRoot();
  } catch (err) {
    vscode.window.showErrorMessage(`Bundle diff: ${(err as Error).message}`);
    return;
  }
  try {
    const report = await deps.installer.getStatus(workspace);
    deps.output.show(true);
    deps.output.appendLine(`[bundle] diff (${summarizeStatus(report)})`);
    appendDiffLines(deps.output, report);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Bundle diff failed: ${(err as Error).message}`,
    );
  }
}

function appendDiffLines(
  output: vscode.OutputChannel,
  report: StatusReport,
): void {
  for (const f of report.files) {
    const flag =
      f.state === "matches-stamp"
        ? "✓"
        : f.state === "source-changed"
          ? "↑"
          : f.state === "modified-locally"
            ? "✎"
            : "?";
    output.appendLine(`  ${flag} ${f.target}  (${f.state})`);
  }
}
