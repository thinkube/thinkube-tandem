/**
 * Methodology-bundle commands — per-repo (ADR-0006 / ADR-0007 Phase 6).
 *
 * Three commands wrap `BundleInstaller`, each scoped to a target repository:
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
 * The target repo comes from the invocation: the Boards navigator passes its
 * node (a RepoEntry or its bundle-status child), programmatic callers pass an
 * absolute path, and a bare palette invocation quick-picks across the
 * discovered repos. There is no single configured methodology root anymore.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import {
  BundleInstaller,
  StatusReport,
  summarizeStatus,
} from "../methodology/BundleInstaller";
import { discoverRepos } from "../views/boards/BoardNavigatorProvider";

export interface BundleCommandDeps {
  installer: BundleInstaller;
  output: vscode.OutputChannel;
}

export function registerBundleCommands(
  context: vscode.ExtensionContext,
  deps: BundleCommandDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.kanban.installBundle",
      (target?: unknown) => installBundle(deps, target),
    ),
    vscode.commands.registerCommand(
      "thinkube.kanban.statusBundle",
      (target?: unknown) => statusBundle(deps, target),
    ),
    vscode.commands.registerCommand(
      "thinkube.kanban.diffBundle",
      (target?: unknown) => diffBundle(deps, target),
    ),
  );
}

/**
 * Resolve the target repo path from whatever the command was invoked with:
 * a Boards tree node (RepoEntry or its bundle-status child), an explicit
 * absolute path, or — from the palette — a quick-pick over discovered repos.
 */
async function resolveTargetRepo(
  target?: unknown,
): Promise<string | undefined> {
  if (typeof target === "string" && target.trim()) return target;
  if (target && typeof target === "object") {
    const o = target as { path?: unknown; repo?: { path?: unknown } };
    if (typeof o.path === "string") return o.path; // RepoEntry
    if (typeof o.repo?.path === "string") return o.repo.path; // BundleStatusNode
  }
  const repos = discoverRepos();
  if (repos.length === 0) {
    vscode.window.showErrorMessage(
      "No git repositories found in the open workspace folders.",
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    repos.map((r) => ({
      label: r.name,
      description: r.enabled ? r.rel : `${r.rel} — not enabled`,
      path: r.path,
    })),
    { placeHolder: "Select the repository for the methodology bundle" },
  );
  return picked?.path;
}

/**
 * Non-secret env baked into the repo's `.mcp.json` so the board-independent
 * Kanban MCP server can discover boards when Claude Code launches it.
 * THINKUBE_ROOTS = the workspace folders (the board-discovery scan roots);
 * the default board is NOT baked — the server derives it from the session's
 * cwd. Never put a token here — `.mcp.json` is committed.
 */
function buildMcpEnv(): Record<string, string> {
  const kanbanCfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const mode = kanbanCfg.get<string>("mode") ?? "both";
  const allowWrites =
    mode === "navigator"
      ? false
      : (kanbanCfg.get<boolean>("allowAIWrites") ?? true);
  const roots = (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .join(path.delimiter);
  const env: Record<string, string> = {
    THINKUBE_ALLOW_AI_WRITES: String(allowWrites),
  };
  if (roots) env.THINKUBE_ROOTS = roots;
  return env;
}

async function installBundle(
  deps: BundleCommandDeps,
  target?: unknown,
): Promise<void> {
  const workspace = await resolveTargetRepo(target);
  if (!workspace) return;

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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing Thinkube Methodology Bundle…",
    },
    async () => {
      try {
        const result = await deps.installer.install(workspace, {
          strategy,
          mcpEnv: buildMcpEnv(),
        });
        deps.output.show(true);
        deps.output.appendLine(
          `[bundle] installed v${result.version} into ${workspace} (strategy=${strategy})`,
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

async function statusBundle(
  deps: BundleCommandDeps,
  target?: unknown,
): Promise<void> {
  const workspace = await resolveTargetRepo(target);
  if (!workspace) return;
  try {
    const report = await deps.installer.getStatus(workspace);
    const summary = summarizeStatus(report);
    deps.output.show(true);
    deps.output.appendLine(`[bundle] ${workspace}: ${summary}`);
    appendDiffLines(deps.output, report);
    vscode.window.showInformationMessage(summary);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Bundle status failed: ${(err as Error).message}`,
    );
  }
}

async function diffBundle(
  deps: BundleCommandDeps,
  target?: unknown,
): Promise<void> {
  const workspace = await resolveTargetRepo(target);
  if (!workspace) return;
  try {
    const report = await deps.installer.getStatus(workspace);
    deps.output.show(true);
    deps.output.appendLine(
      `[bundle] ${workspace}: diff (${summarizeStatus(report)})`,
    );
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
