/**
 * BoardNavigatorProvider — the per-repo board navigator (ADR-0006).
 *
 * Under files-first there is no single configured board: each repository owns
 * its own committed `.thinkube/` kanban, and a repo is "enabled" iff that
 * directory exists. This tree discovers the git repos across the open workspace
 * folders, marks which are enabled, and lets the user open an enabled board or
 * "Enable here" a disabled one. No settings registry — presence of `.thinkube/`
 * is the single source of truth (ADR-0001).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export interface RepoEntry {
  /** Absolute path to the repo root. */
  path: string;
  /** Display name (basename of the repo dir). */
  name: string;
  /** Path relative to its workspace folder, for the secondary label. */
  rel: string;
  /** True when the repo has a `.thinkube/` board (= methodology-enabled). */
  enabled: boolean;
}

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

export class BoardNavigatorProvider
  implements vscode.TreeDataProvider<RepoEntry>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    RepoEntry | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getChildren(): RepoEntry[] {
    return discoverRepos();
  }

  getTreeItem(r: RepoEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(
      r.name,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = r.enabled ? r.rel : `${r.rel} — not enabled`;
    item.tooltip = r.path;
    item.contextValue = r.enabled
      ? "tandemBoardEnabled"
      : "tandemBoardDisabled";
    item.iconPath = new vscode.ThemeIcon(
      r.enabled ? "project" : "circle-outline",
    );
    if (r.enabled) {
      item.command = {
        command: "thinkube.boards.open",
        title: "Open Tandem board",
        arguments: [r],
      };
    }
    return item;
  }
}
