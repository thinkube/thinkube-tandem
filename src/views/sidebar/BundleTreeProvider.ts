/**
 * BundleTreeProvider — surfaces methodology-bundle install state as its own
 * sidebar view (under the Thinkube AI activity-bar container).
 *
 * Top-level row: one node whose label + icon reflect the current state of
 * the bundle in the active workspace folder (`not-installed`, `up-to-date`,
 * `update-available`, `locally-modified`). Expanding the node shows a row
 * per file in the bundle with that file's individual state.
 *
 * Actions live on the view title (Install / Status / Diff) and the node
 * context menu (Install / Refresh). All three palette commands from
 * `commands/bundle.ts` work unchanged — this provider just gives the user
 * a visual entry point.
 *
 * Why a separate provider rather than extending `ConfigTreeProvider`?
 * `ConfigTreeProvider` is the rendering engine for `.claude/` browsing
 * (chunk 1); folding a methodology-bundle status node into its `getChildren`
 * would mean entangling two different domains. A dedicated provider keeps
 * each concern small and is the standard VS Code pattern.
 */
import * as vscode from "vscode";

import {
  BundleInstaller,
  FileDiff,
  StatusReport,
  summarizeStatus,
} from "../../methodology/BundleInstaller";

export class BundleTreeProvider implements vscode.TreeDataProvider<BundleNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BundleNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private cachedReport: StatusReport | undefined;

  constructor(
    private readonly installer: BundleInstaller,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Drop the cached status and reload on next tree fetch. */
  refresh(): void {
    this.cachedReport = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: BundleNode): vscode.TreeItem {
    if (node.kind === "root") {
      const status = node.report.status;
      const item = new vscode.TreeItem(
        `Methodology Bundle — ${labelForStatus(status)}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = "bundle-root";
      item.iconPath = iconForStatus(status);
      item.contextValue = `bundle-root-${status}`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**${summarizeStatus(node.report)}**`,
          "",
          "Run **Thinkube Kanban: Install Methodology Bundle** to install or re-apply.",
        ].join("\n"),
      );
      item.description =
        node.report.stampVersion &&
        node.report.stampVersion !== node.report.manifestVersion
          ? `installed v${node.report.stampVersion} → bundle v${node.report.manifestVersion}`
          : `v${node.report.manifestVersion}`;
      return item;
    }
    // file row
    const item = new vscode.TreeItem(
      node.file.target,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `bundle-file:${node.file.target}`;
    item.contextValue = `bundle-file-${node.file.state}`;
    item.iconPath = iconForFileState(node.file.state);
    item.description = node.file.state;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${node.file.target}**`,
        "",
        `kind: \`${node.file.kind}\``,
        `state: \`${node.file.state}\``,
        node.file.installedHash
          ? `installed: \`${shortHash(node.file.installedHash)}\``
          : "installed: *(missing)*",
        node.file.stampHash
          ? `stamp:     \`${shortHash(node.file.stampHash)}\``
          : "stamp:     *(none)*",
        `source:    \`${shortHash(node.file.sourceHash)}\``,
      ].join("\n"),
    );
    return item;
  }

  async getChildren(element?: BundleNode): Promise<BundleNode[]> {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.output.appendLine(
      `[bundle-tree] getChildren element=${element ? element.kind : "root"} workspace=${workspace ?? "(none)"}`,
    );
    if (!workspace) {
      this.output.appendLine(
        "[bundle-tree] no workspace folder — returning []",
      );
      return [];
    }

    // When the project isn't linked to a repo yet, return nothing so the
    // view's welcome screen (Configure Project / Install Bundle) shows instead
    // of a bare status node.
    const repo = vscode.workspace
      .getConfiguration("thinkube.kanban")
      .get<string>("repo", "")
      .trim();
    if (!repo.includes("/")) {
      this.output.appendLine(
        "[bundle-tree] no repo configured — deferring to welcome view",
      );
      return [];
    }

    if (!element) {
      try {
        if (!this.cachedReport) {
          this.output.appendLine("[bundle-tree] fetching status…");
          this.cachedReport = await this.installer.getStatus(workspace);
        }
        this.output.appendLine(
          `[bundle-tree] status=${this.cachedReport.status} files=${this.cachedReport.files.length}`,
        );
      } catch (err) {
        this.output.appendLine(
          `[bundle-tree] getStatus failed: ${(err as Error).message}\n${(err as Error).stack ?? ""}`,
        );
        return [];
      }
      return [{ kind: "root", report: this.cachedReport }];
    }
    // The root status node is a single summary line — per-file detail lives
    // behind the Diff command, not a wall of per-file rows.
    return [];
  }
}

type BundleNode =
  | { kind: "root"; report: StatusReport }
  | { kind: "file"; file: FileDiff };

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

function iconForFileState(state: FileDiff["state"]): vscode.ThemeIcon {
  switch (state) {
    case "matches-stamp":
      return new vscode.ThemeIcon("check");
    case "missing":
      return new vscode.ThemeIcon("warning");
    case "modified-locally":
      return new vscode.ThemeIcon("edit");
    case "source-changed":
      return new vscode.ThemeIcon("arrow-up");
  }
}

function shortHash(hash: string): string {
  return hash.slice(0, 8);
}
