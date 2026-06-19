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
import { discoverProducts } from "../../store/products";
import { discoverProjects, projectTeps } from "../../store/projects";
import { buildProductTree, projectTepGroups, SpecImpl } from "./productTree";
import { ThinkubeStore } from "../../store/ThinkubeStore";

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

/** A Product — the code-less top node (SP-tgvl81): groups member Spaces + Projects. */
export interface ProductNode {
  kind: "product";
  id: string;
  name: string;
  repos: RepoEntry[];
  projects: ProjectNode[];
}

/** A Project under a Product (SP-tgvl81) — a promoted tag; leaf in the tree (its
 *  members surface in the dedicated member view on selection). */
export interface ProjectNode {
  kind: "project";
  product: string;
  id: string;
  name: string;
  state: "open" | "done";
  tag: string;
}

/** An umbrella TEP under a Project (SP-tgvpbm) — drills to its implementing specs. */
export interface UmbrellaTepNode {
  kind: "umbrella-tep";
  product: string;
  project: string;
  projectNamespace: string;
  tepId: string;
}

/** A member spec of an umbrella TEP (SP-tgvpbm) — a spec implementing it, in some repo. */
export interface MemberSpecNode {
  kind: "member-spec";
  board: string;
  handle: string;
}

export type BoardNode =
  | RepoEntry
  | BundleStatusNode
  | BoardMessageNode
  | ProductNode
  | ProjectNode
  | UmbrellaTepNode
  | MemberSpecNode;

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
      const showWorktrees = vscode.workspace
        .getConfiguration("thinkube.boards")
        .get<boolean>("showWorktrees", false);
      let repos = discoverRepos();
      // A linked worktree shares its canonical repo's board (it is not a
      // separate Thinking Space), so hide worktree entries unless opted in —
      // they otherwise read as duplicate top-level boards.
      if (!showWorktrees) repos = repos.filter((r) => !r.worktreeOf);
      if (this._configuredOnly) repos = repos.filter((r) => r.enabled);

      // Group the visible repos under their Product when the board root has any
      // (SP-tgvl81). With no board root / no products, fall back to the flat
      // repo list — Products are an additive layer, nothing disappears.
      const boardRoot =
        vscode.workspace
          .getConfiguration("thinkube.boards")
          .get<string>("root")
          ?.trim() || undefined;
      const products = boardRoot ? discoverProducts(boardRoot) : [];
      if (boardRoot && products.length) {
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
          name: f.name,
          path: f.uri.fsPath,
        }));
        const refs = repos.map((r) => ({
          path: r.path,
          namespace: namespaceForRepo(r.path, folders),
        }));
        const tree = buildProductTree(products, discoverProjects(boardRoot), refs);
        const byPath = new Map(repos.map((r) => [r.path, r]));
        const lookup = (p: string): RepoEntry | undefined => byPath.get(p);
        const productNodes: BoardNode[] = tree.products.map((g) => ({
          kind: "product",
          id: g.id,
          name: g.name,
          repos: g.repoPaths.map(lookup).filter((r): r is RepoEntry => !!r),
          projects: g.projects.map((pr) => ({
            kind: "project",
            product: pr.product,
            id: pr.id,
            name: pr.name,
            state: pr.state,
            tag: pr.tag,
          })),
        }));
        const ungrouped = tree.ungroupedRepoPaths
          .map(lookup)
          .filter((r): r is RepoEntry => !!r);
        return [...productNodes, ...ungrouped];
      }
      return repos;
    }
    if (element.kind === "product") {
      return [...element.repos, ...element.projects];
    }
    if (element.kind === "project") {
      // Drill to the project's umbrella TEPs (SP-tgvpbm).
      const boardRoot =
        vscode.workspace
          .getConfiguration("thinkube.boards")
          .get<string>("root")
          ?.trim() || undefined;
      if (!boardRoot) return [];
      return projectTeps(boardRoot, element.product, element.id).map(
        (tepId): UmbrellaTepNode => ({
          kind: "umbrella-tep",
          product: element.product,
          project: element.id,
          projectNamespace: `${element.product}/projects/${element.id}`,
          tepId,
        }),
      );
    }
    if (element.kind === "umbrella-tep") {
      // Implementing specs (cross-repo) of this umbrella TEP.
      const specs = await this.collectSpecImpls();
      const group = projectTepGroups(element.projectNamespace, [element.tepId], specs)[0];
      return (group?.specs ?? []).map(
        (s): MemberSpecNode => ({ kind: "member-spec", board: s.board, handle: s.handle }),
      );
    }
    if (element.kind === "member-spec") return [];
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

  /** Collect every enabled repo's specs as SpecImpl (board, namespace, handle,
   *  implements) — the host-side input to `projectTepGroups` (SP-tgvpbm_SL-4). */
  private async collectSpecImpls(): Promise<SpecImpl[]> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    const out: SpecImpl[] = [];
    for (const repo of discoverRepos()) {
      if (!repo.enabled || repo.worktreeOf) continue;
      const ns = namespaceForRepo(repo.path, folders);
      if (!ns) continue;
      const store = new ThinkubeStore(repo.path, repo.boardDir);
      try {
        for (const spec of await store.listSpecDirs()) {
          const fm = (await store.getFile(store.pathForSpecDoc(spec)))
            ?.frontmatter;
          out.push({
            board: repo.name,
            namespace: ns,
            handle: `SP-${spec}`,
            implements: typeof fm?.implements === "string" ? fm.implements : undefined,
          });
        }
      } catch {
        // skip an unreadable board
      }
    }
    return out;
  }

  getTreeItem(node: BoardNode): vscode.TreeItem {
    if (node.kind === "bundle-status") return bundleStatusItem(node);
    if (node.kind === "product") {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      const n = node.projects.length;
      item.description = `product${n ? ` · ${n} project${n === 1 ? "" : "s"}` : ""}`;
      item.tooltip = `Product: ${node.id}`;
      item.contextValue = "thinkubeProduct";
      item.iconPath = new vscode.ThemeIcon("package");
      return item;
    }
    if (node.kind === "project") {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = node.state === "done" ? "✓ done" : "open";
      item.tooltip = `Project ${node.product}/${node.id} · ${node.state}`;
      item.contextValue = "thinkubeProject";
      item.iconPath = new vscode.ThemeIcon(
        node.state === "done" ? "pass-filled" : "milestone",
      );
      return item;
    }
    if (node.kind === "umbrella-tep") {
      const item = new vscode.TreeItem(
        `TEP-${node.tepId}`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = "umbrella TEP";
      item.tooltip = `Umbrella TEP-${node.tepId} of ${node.projectNamespace}`;
      item.contextValue = "thinkubeUmbrellaTep";
      item.iconPath = new vscode.ThemeIcon("lightbulb");
      return item;
    }
    if (node.kind === "member-spec") {
      const item = new vscode.TreeItem(
        node.handle,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = node.board;
      item.tooltip = `${node.handle} — implementing spec in ${node.board}`;
      item.contextValue = "thinkubeMemberSpec";
      item.iconPath = new vscode.ThemeIcon("list-tree");
      return item;
    }
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
    // Clicking a Thinking Space only *selects* it (driving the TEPs → Specs
    // drill-down); the kanban opens per-Spec, not for the whole space (SP-tgs8nz).
    // The whole-space board stays available via the palette / context menu.
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
