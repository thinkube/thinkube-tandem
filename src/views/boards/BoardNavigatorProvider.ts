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
import { linkedWorktreeInfo } from "../../services/WorktreeService";
import {
  boardDirForNamespace,
  namespaceForRepo,
} from "../../store/boardNamespace";

export interface RepoEntry {
  kind: "repo";
  /** Absolute path to the repo root. */
  path: string;
  /** Display name (basename of the repo dir). */
  name: string;
  /** Path relative to its workspace folder, for the secondary label. */
  rel: string;
  /** True when the repo has a board (= methodology-enabled). */
  enabled: boolean;
  /**
   * The resolved board dir (the `.thinkube`-equivalent holding
   * specs/decisions/retros): the central `<board-root>/<namespace>` when
   * `thinkube.boards.root` is set and the repo maps to a namespace, else the
   * co-located `<repo>/.thinkube`. Construct `ThinkubeStore` with this (SP-8).
   */
  boardDir: string;
  /**
   * Set when this entry is a linked git worktree (SP-5), not a standalone repo:
   * the canonical repo's name and the worktree's own name, for a "worktree of
   * its repo" label rather than a rogue top-level board.
   */
  worktreeOf?: { repo: string; name: string };
}

/** Child node of an enabled repo: its methodology-bundle install state. */
export interface BundleStatusNode {
  kind: "bundle-status";
  repo: RepoEntry;
  report?: StatusReport;
  error?: string;
}

/** A standalone message row — e.g. the board root is configured but missing. */
export interface BoardMessageNode {
  kind: "message";
  text: string;
  detail?: string;
  icon: string;
}

export type BoardNode = RepoEntry | BundleStatusNode | BoardMessageNode;

/**
 * Find git repos across the open workspace folders (depth-limited), marking
 * which have a board. A repo is a directory containing `.git`; we don't descend
 * into one (no nested repos as boards). Dedups by path.
 *
 * The board may live at a central root (ADR-0008 / SP-8): when
 * `thinkube.boards.root` is set, a repo's board dir is its namespace under that
 * root (`<board-root>/<container>/<rel>`) and `enabled` reflects that central
 * dir; otherwise it's the co-located `<repo>/.thinkube`.
 */
export function discoverRepos(maxDepth = 3): RepoEntry[] {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const boardRoot =
    vscode.workspace
      .getConfiguration("thinkube.boards")
      .get<string>("root")
      ?.trim() || undefined;
  const ctx: DiscoverCtx = { folders, boardRoot };
  const out = new Map<string, RepoEntry>();
  for (const folder of folders) {
    walk(folder.path, folder.path, 0, maxDepth, out, ctx);
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

interface DiscoverCtx {
  folders: { name: string; path: string }[];
  boardRoot: string | undefined;
}

/**
 * The board dir for a repo: the central `<board-root>/<namespace>` when a board
 * root is configured and the repo maps to a namespace, else the co-located
 * `<repo>/.thinkube` (the legacy default and the fallback for paths outside any
 * workspace folder, e.g. worktrees — SP-9 revisits those).
 */
function resolveBoardDir(repoPath: string, ctx: DiscoverCtx): string {
  if (ctx.boardRoot) {
    // A linked worktree shares its canonical Spec's board (SP-9).
    const wt = linkedWorktreeInfo(repoPath);
    const ns = namespaceForRepo(wt ? wt.canonicalRepo : repoPath, ctx.folders);
    if (ns) return boardDirForNamespace(ctx.boardRoot, ns);
  }
  return path.join(repoPath, ".thinkube");
}

/**
 * Board dir for a single repo path, reading the current `thinkube.boards.root`
 * + workspace folders. Convenience over the discovery-internal resolver for
 * callers outside the walk (e.g. constructing a `ThinkubeStore` for a repo not
 * already enumerated, like the canonical repo behind a worktree).
 */
export function boardDirForRepo(repoPath: string): string {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const boardRoot =
    vscode.workspace
      .getConfiguration("thinkube.boards")
      .get<string>("root")
      ?.trim() || undefined;
  return resolveBoardDir(repoPath, { folders, boardRoot });
}

export interface BoardRootStatus {
  configured: boolean;
  root?: string;
  /** true unless a configured root is missing on disk. */
  available: boolean;
}

/** Whether the central board root (if configured) is present on disk (SP-8). */
export function boardRootStatus(): BoardRootStatus {
  const root =
    vscode.workspace
      .getConfiguration("thinkube.boards")
      .get<string>("root")
      ?.trim() || undefined;
  if (!root) return { configured: false, available: true };
  return { configured: true, root, available: fs.existsSync(root) };
}

function walk(
  dir: string,
  base: string,
  depth: number,
  maxDepth: number,
  out: Map<string, RepoEntry>,
  ctx: DiscoverCtx,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const dotGit = entries.find((e) => e.name === ".git");
  if (dotGit?.isDirectory()) {
    const boardDir = resolveBoardDir(dir, ctx);
    out.set(dir, {
      kind: "repo",
      path: dir,
      name: path.basename(dir),
      rel: path.relative(base, dir) || path.basename(dir),
      boardDir,
      enabled: fs.existsSync(boardDir),
    });
    return; // a repo is a leaf in this tree
  }
  if (dotGit?.isFile()) {
    // A `.git` *file* marks a linked worktree (SP-5/SP-9) — also a leaf (never
    // descend into a checkout). It carries NO board of its own: its board is the
    // canonical Spec's central namespace. Label it as a worktree of its repo.
    const wt = linkedWorktreeInfo(dir);
    const boardDir = resolveBoardDir(dir, ctx); // resolveBoardDir maps a worktree → canonical
    if (wt && fs.existsSync(boardDir)) {
      out.set(dir, {
        kind: "repo",
        path: dir,
        name: path.basename(dir),
        rel: path.relative(base, dir) || path.basename(dir),
        boardDir,
        enabled: true,
        worktreeOf: { repo: path.basename(wt.canonicalRepo), name: wt.name },
      });
    }
    return;
  }
  if (depth >= maxDepth) return;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    walk(path.join(dir, e.name), base, depth + 1, maxDepth, out, ctx);
  }
}

export class BoardNavigatorProvider implements vscode.TreeDataProvider<BoardNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    BoardNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Per-repo bundle status, cached until the next refresh(). */
  private readonly reportCache = new Map<string, StatusReport>();

  /**
   * When true, only methodology-enabled repos (those with a `.thinkube/` board)
   * are listed; unconfigured repos are hidden. Persisted across reloads by the
   * caller (see `seedBoardsFilter` in `commands/boards.ts`).
   */
  private _configuredOnly = false;

  constructor(
    private readonly installer: BundleInstaller,
    private readonly output: vscode.OutputChannel,
  ) {}

  get configuredOnly(): boolean {
    return this._configuredOnly;
  }

  /** Set the configured-only filter; refresh the tree only if it changed. */
  setConfiguredOnly(value: boolean): void {
    if (this._configuredOnly === value) return;
    this._configuredOnly = value;
    this.refresh();
  }

  refresh(): void {
    this.reportCache.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: BoardNode): Promise<BoardNode[]> {
    if (!element) {
      const status = boardRootStatus();
      if (status.configured && !status.available) {
        // Don't silently show every space as disabled — say why (AC #6, SP-8).
        return [
          {
            kind: "message",
            text: "Board repo not available",
            detail: `${status.root} not found — clone or mount the board repo, or clear thinkube.boards.root.`,
            icon: "cloud-offline",
          },
        ];
      }
      const repos = discoverRepos();
      return this._configuredOnly ? repos.filter((r) => r.enabled) : repos;
    }
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
    if (node.kind === "message") {
      const item = new vscode.TreeItem(
        node.text,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = node.detail;
      item.tooltip = node.detail;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = "tandemBoardUnavailable";
      return item;
    }
    // A linked worktree reads as "<repo> · <name>" labeled a worktree, not a
    // standalone repo (SP-5). It is still an enabled, openable board.
    const label = node.worktreeOf
      ? `${node.worktreeOf.repo} · ${node.worktreeOf.name}`
      : node.name;
    const item = new vscode.TreeItem(
      label,
      node.enabled
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.worktreeOf
      ? "worktree"
      : node.enabled
        ? node.rel
        : `${node.rel} — not enabled`;
    item.tooltip = node.worktreeOf
      ? `${node.path}\nLinked worktree of ${node.worktreeOf.repo}`
      : node.path;
    item.contextValue = node.enabled
      ? "tandemBoardEnabled"
      : "tandemBoardDisabled";
    item.iconPath = new vscode.ThemeIcon(
      node.worktreeOf
        ? "repo-clone"
        : node.enabled
          ? "project"
          : "circle-outline",
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
