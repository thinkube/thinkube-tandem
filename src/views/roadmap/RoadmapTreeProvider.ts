/**
 * Roadmap tree — Epic → Story → Spec hierarchy backed by GitHubService.
 *
 * Three layers of nodes share the same shape (`RoadmapNode`) so the tree
 * provider can stay narrow. The differences:
 *
 *   - Epics: roots; fetched via `listIssues({type: 'epic'})`.
 *   - Stories: children of an epic; fetched via `listSubIssues(epic.number)`.
 *   - Specs: children of a story; fetched via `listSubIssues(story.number)`.
 *   - Tasks: not shown in this tree — they're the kanban's job. A spec node
 *     is therefore always a leaf in the roadmap.
 *
 * Caching: each parent caches its children once fetched. `refresh()` flushes
 * the cache and fires `onDidChangeTreeData` for a hard re-pull. There's no
 * background polling — the tree is on-demand and the user pulls the refresh
 * button when they want fresh data. (Chunk 7's GitHubProjectsAdapter and
 * chunk 10's MCP server tools both invalidate the cache so writes are
 * reflected without manual refresh.)
 *
 * Empty / unconfigured state: when `thinkube.kanban.repo` isn't set, the
 * provider returns no roots. A `viewsWelcome` entry in package.json renders
 * the setup prompt in that case.
 */
import * as vscode from "vscode";

import {
  GitHubService,
  IssueSummary,
  Kind,
  RepoCoords,
} from "../../github/GitHubService";

export type RoadmapNodeKind = "epic" | "story" | "spec";

export class RoadmapNode {
  constructor(
    public readonly kind: RoadmapNodeKind,
    public readonly coords: RepoCoords,
    public readonly issue: IssueSummary,
  ) {}

  /** Stable id so VS Code preserves the expanded state across refreshes. */
  get id(): string {
    return `${this.kind}:${this.coords.owner}/${this.coords.name}#${this.issue.number}`;
  }
}

export class RoadmapTreeProvider implements vscode.TreeDataProvider<RoadmapNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    RoadmapNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** parent node id → cached children. Roots keyed by "__roots__". */
  private readonly cache = new Map<string, RoadmapNode[]>();
  private readonly inFlight = new Map<string, Promise<RoadmapNode[]>>();

  constructor(
    private readonly github: GitHubService,
    private readonly output: vscode.OutputChannel,
  ) {}

  /** Drop all caches and notify the tree. */
  refresh(): void {
    this.cache.clear();
    this.inFlight.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Drop one node's child cache; useful after a write touched that branch. */
  invalidate(node?: RoadmapNode): void {
    if (!node) return this.refresh();
    const key = childKey(node);
    this.cache.delete(key);
    this.inFlight.delete(key);
    this._onDidChangeTreeData.fire(node);
  }

  getTreeItem(node: RoadmapNode): vscode.TreeItem {
    const collapsible =
      node.kind === "spec"
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed;
    const item = new vscode.TreeItem(
      `${prefixFor(node.kind)}-${node.issue.number}  ${node.issue.title}`,
      collapsible,
    );
    item.id = node.id;
    item.contextValue = `roadmap-${node.kind}`;
    item.tooltip = new vscode.MarkdownString(
      `**${node.kind.toUpperCase()} #${node.issue.number}** — ${node.issue.state}\n\n${escapeMd(node.issue.title)}\n\n[${node.issue.url}](${node.issue.url})`,
    );
    item.description = node.issue.state === "closed" ? "closed" : undefined;
    item.iconPath = iconFor(node.kind, node.issue.state);
    item.command = {
      command: "thinkube.roadmap.openCard",
      title: "Open card detail",
      arguments: [node],
    };
    return item;
  }

  async getChildren(parent?: RoadmapNode): Promise<RoadmapNode[]> {
    const coords = this.readRepoSetting();
    if (!coords) {
      // viewsWelcome handles the empty state — return nothing.
      return [];
    }

    const key = parent ? childKey(parent) : "__roots__";
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const work = this.fetchChildren(parent, coords).then(
      (rows) => {
        this.cache.set(key, rows);
        this.inFlight.delete(key);
        return rows;
      },
      (err) => {
        this.inFlight.delete(key);
        this.output.appendLine(
          `[roadmap] fetch failed for ${key}: ${(err as Error).message}`,
        );
        throw err;
      },
    );
    this.inFlight.set(key, work);
    return work;
  }

  private async fetchChildren(
    parent: RoadmapNode | undefined,
    coords: RepoCoords,
  ): Promise<RoadmapNode[]> {
    if (!parent) {
      const epics = await this.github.listIssues(coords, {
        type: "epic",
        state: "open",
      });
      return epics.map((i) => new RoadmapNode("epic", coords, i));
    }
    const childKind: RoadmapNodeKind | undefined =
      parent.kind === "epic"
        ? "story"
        : parent.kind === "story"
          ? "spec"
          : undefined;
    if (!childKind) return [];

    // listSubIssues already handles the native → tasklist fallback, and
    // filters by parent. We additionally filter by the expected kind in
    // case a spec issue accidentally got linked under an epic.
    const kids = await this.github.listSubIssues(coords, parent.issue.number);
    return kids
      .filter(
        (k) =>
          !k.kind ||
          k.kind === childKind ||
          classifierKindMatches(k.kind, childKind),
      )
      .map((k) => new RoadmapNode(childKind, coords, k));
  }

  private readRepoSetting(): RepoCoords | undefined {
    const raw = vscode.workspace
      .getConfiguration("thinkube.kanban")
      .get<string>("repo", "");
    const trimmed = raw.trim();
    if (!trimmed.includes("/")) return undefined;
    const [owner, name] = trimmed.split("/", 2);
    if (!owner || !name) return undefined;
    return { owner, name };
  }
}

function childKey(node: RoadmapNode): string {
  return node.id;
}

function prefixFor(kind: RoadmapNodeKind): string {
  return kind === "epic" ? "EP" : kind === "story" ? "ST" : "SP";
}

function classifierKindMatches(
  actual: Kind,
  expected: RoadmapNodeKind,
): boolean {
  // Defensive: cc-sdd or older tooling may use "task-decomposition" or
  // other neighbouring tags that we don't surface in the roadmap.
  return actual === expected;
}

function iconFor(
  kind: RoadmapNodeKind,
  state: "open" | "closed",
): vscode.ThemeIcon {
  if (state === "closed") return new vscode.ThemeIcon("issue-closed");
  if (kind === "epic") return new vscode.ThemeIcon("rocket");
  if (kind === "story") return new vscode.ThemeIcon("book");
  return new vscode.ThemeIcon("note");
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}\[\]()#+\-.!|])/g, "\\$1");
}
