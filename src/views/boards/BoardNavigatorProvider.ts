/**
 * BoardNavigatorProvider — the per-repo board navigator (ADR-0006).
 *
 * Under files-first there is no single configured board: each repository owns
 * its own committed `.thinkube/` kanban, and a repo is "enabled" iff that
 * directory exists. This tree discovers the git repos across the open workspace
 * folders, marks which are enabled, and lets the user open an enabled board or
 * "Enable here" a disabled one. No settings registry — presence of `.thinkube/`
 * is the single source of truth (ADR-0001).
 *
 * Per ADR-0007 Phase 6 the navigator also absorbed the old "Project" view:
 * each enabled repo expands to a methodology-bundle status node (computed
 * per-repo via `BundleInstaller`), with install/diff actions on the node.
 * There is no single configured methodology root anymore.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  BundleInstaller,
  StatusReport,
  summarizeStatus,
} from "../../methodology/BundleInstaller";

export interface RepoEntry {
  kind: "repo";
  /** Absolute path to the repo root. */
  path: string;
  /** Display name (basename of the repo dir). */
  name: string;
  /** Path relative to its workspace folder, for the secondary label. */
  rel: string;
  /** True when the repo has a `.thinkube/` board (= methodology-enabled). */
  enabled: boolean;
}

/** Child node of an enabled repo: its methodology-bundle install state. */
export interface BundleStatusNode {
  kind: "bundle-status";
  repo: RepoEntry;
  report?: StatusReport;
  error?: string;
}

export type BoardNode = RepoEntry | BundleStatusNode;

/**
 * Find git repos across the open workspace folders (depth-limited), marking
 * which have a `.thinkube/` board. A repo is a directory containing `.git`; we
 * don't descend into one (no nested repos as boards). Dedups by path.
 */
export function discoverRepos(maxDepth = 3): RepoEntry[] {
  const out = new Map<string, RepoEntry>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = folder.uri.fsPath;
    walk(root, root, 0, maxDepth, out);
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function walk(
  dir: string,
  base: string,
  depth: number,
  maxDepth: number,
  out: Map<string, RepoEntry>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.isDirectory() && e.name === ".git")) {
    out.set(dir, {
      kind: "repo",
      path: dir,
      name: path.basename(dir),
      rel: path.relative(base, dir) || path.basename(dir),
      enabled: fs.existsSync(path.join(dir, ".thinkube")),
    });
    return; // a repo is a leaf in this tree
  }
  if (depth >= maxDepth) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    walk(path.join(dir, e.name), base, depth + 1, maxDepth, out);
  }
}

export class BoardNavigatorProvider implements vscode.TreeDataProvider<BoardNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BoardNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Per-repo bundle status, cached until the next refresh(). */
  private readonly reportCache = new Map<string, StatusReport>();

  constructor(
    private readonly installer: BundleInstaller,
    private readonly output: vscode.OutputChannel,
  ) {}

  refresh(): void {
    this.reportCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: BoardNode): Promise<BoardNode[]> {
    if (!element) return discoverRepos();
    if (element.kind !== "repo" || !element.enabled) return [];
    // Enabled repo → one bundle-status child (per-file detail stays behind
    // the Diff command, matching the old Project view's single-row design).
    try {
      let report = this.reportCache.get(element.path);
      if (!report) {
        report = await this.installer.getStatus(element.path);
        this.reportCache.set(element.path, report);
      }
      return [{ kind: "bundle-status", repo: element, report }];
    } catch (err) {
      this.output.appendLine(
        `[boards] bundle status failed for ${element.rel}: ${(err as Error).message}`,
      );
      return [
        { kind: "bundle-status", repo: element, error: (err as Error).message },
      ];
    }
  }

  getTreeItem(node: BoardNode): vscode.TreeItem {
    if (node.kind === "bundle-status") return bundleStatusItem(node);
    const item = new vscode.TreeItem(
      node.name,
      node.enabled
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.enabled ? node.rel : `${node.rel} — not enabled`;
    item.tooltip = node.path;
    item.contextValue = node.enabled
      ? "tandemBoardEnabled"
      : "tandemBoardDisabled";
    item.iconPath = new vscode.ThemeIcon(
      node.enabled ? "project" : "circle-outline",
    );
    if (node.enabled) {
      item.command = {
        command: "thinkube.boards.open",
        title: "Open Tandem board",
        arguments: [node],
      };
    }
    return item;
  }
}

function bundleStatusItem(node: BundleStatusNode): vscode.TreeItem {
  if (!node.report) {
    const item = new vscode.TreeItem(
      "Methodology Bundle — status unavailable",
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `bundle-status:${node.repo.path}`;
    item.iconPath = new vscode.ThemeIcon("warning");
    item.tooltip = node.error;
    item.contextValue = "tandemBundle-error";
    return item;
  }
  const status = node.report.status;
  const item = new vscode.TreeItem(
    `Methodology Bundle — ${labelForStatus(status)}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.id = `bundle-status:${node.repo.path}`;
  item.iconPath = iconForStatus(status);
  item.contextValue = `tandemBundle-${status}`;
  item.description =
    node.report.stampVersion &&
    node.report.stampVersion !== node.report.manifestVersion
      ? `installed v${node.report.stampVersion} → bundle v${node.report.manifestVersion}`
      : `v${node.report.manifestVersion}`;
  item.tooltip = new vscode.MarkdownString(
    [
      `**${summarizeStatus(node.report)}**`,
      "",
      `repo: \`${node.repo.rel}\``,
      "",
      "Use the inline actions to install/update or diff the bundle.",
    ].join("\n"),
  );
  return item;
}

function labelForStatus(status: StatusReport["status"]): string {
  switch (status) {
    case "not-installed":
      return "not installed";
    case "up-to-date":
      return "up to date";
    case "update-available":
      return "update available";
    case "locally-modified":
      return "locally modified";
  }
}

function iconForStatus(status: StatusReport["status"]): vscode.ThemeIcon {
  switch (status) {
    case "not-installed":
      return new vscode.ThemeIcon("cloud-download");
    case "up-to-date":
      return new vscode.ThemeIcon("check");
    case "update-available":
      return new vscode.ThemeIcon("cloud-upload");
    case "locally-modified":
      return new vscode.ThemeIcon("edit");
  }
}
