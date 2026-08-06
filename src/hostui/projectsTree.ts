/**
 * The navigator — the v1 three-level drill-down restored (Amendment 1):
 * products at the top, REPOSITORIES underneath (code homes; the cards),
 * and under every repository its named THINKING SPACES plus a permanent
 * "New thinking space…" row. Clicking a space opens that space's map.
 * The tree renders labels only; identity stays in the cards.
 */
import * as vscode from "vscode";
import { EnabledProject } from "../core/identity";
import { SpaceRef } from "../core/spaces";

class RepositoryItem extends vscode.TreeItem {
  constructor(
    public readonly project: EnabledProject,
    active: boolean,
  ) {
    super(project.card.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = project.card.id;
    this.contextValue = "tandem-repository";
    this.description =
      (project.prefix
        ? `${vscode.workspace.asRelativePath(project.gitRoot)}/${project.prefix}`
        : vscode.workspace.asRelativePath(project.gitRoot)) + (active ? "  ●" : "");
    this.iconPath = new vscode.ThemeIcon(active ? "repo" : "repo-clone");
    this.tooltip = [
      `Repository: ${project.card.label}`,
      project.card.product ? `product: ${project.card.product}` : undefined,
      `folder: ${project.anchorDir}`,
      project.card.remote ? `remote: ${project.card.remote}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

class ThinkingSpaceItem extends vscode.TreeItem {
  constructor(ownerId: string, space: SpaceRef, active: boolean) {
    super(space.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${ownerId}/${space.slug}`;
    this.contextValue = "tandem-thinking-space";
    this.iconPath = new vscode.ThemeIcon("notebook");
    if (active) this.description = "●";
    this.tooltip = `Thinking space "${space.label}" — click to open its map.`;
    this.command = {
      command: "thinkube-tandem.openThinkingSpace",
      title: "Open this thinking space",
      arguments: [ownerId, space.slug],
    };
  }
}

/** The permanent creation row — v1's gesture, verbatim. */
class NewSpaceItem extends vscode.TreeItem {
  constructor(ownerId: string) {
    super("New thinking space…", vscode.TreeItemCollapsibleState.None);
    this.id = `${ownerId}/…new`;
    this.contextValue = "tandem-new-space";
    this.iconPath = new vscode.ThemeIcon("add");
    this.tooltip = "Start a new, independent stream of thinking here.";
    this.command = {
      command: "thinkube-tandem.newThinkingSpace",
      title: "New thinking space",
      arguments: [ownerId],
    };
  }
}

export class ProductItem extends vscode.TreeItem {
  constructor(
    public readonly product: string,
    empty: boolean,
  ) {
    super(product, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "tandem-product";
    this.iconPath = new vscode.ThemeIcon("archive");
    if (empty) this.description = "no repositories yet — use + on this row";
  }
}

type Node = ProductItem | RepositoryItem | ThinkingSpaceItem | NewSpaceItem;

export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(
    private readonly listProductNames: () => string[],
    private readonly listRepositories: () => EnabledProject[],
    private readonly activeId: () => string | undefined,
    private readonly listSpaces: (ownerId: string) => SpaceRef[],
    private readonly activeSpace: (ownerId: string) => string | undefined,
  ) {}

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  getChildren(el?: Node): Node[] {
    const repos = this.listRepositories();
    if (!el) {
      const names = new Set(this.listProductNames());
      // Legacy cards without a product surface under an explicit group so
      // they are visible — and nameable — rather than hidden.
      if (repos.some((p) => !p.card.product)) names.add("(unassigned)");
      return [...names]
        .sort()
        .map(
          (n) =>
            new ProductItem(
              n,
              !repos.some((p) => (p.card.product ?? "(unassigned)") === n),
            ),
        );
    }
    if (el instanceof ProductItem)
      return repos
        .filter((p) => (p.card.product ?? "(unassigned)") === el.product)
        .sort((a, b) => a.card.label.localeCompare(b.card.label))
        .map((p) => new RepositoryItem(p, p.card.id === this.activeId()));
    if (el instanceof RepositoryItem) {
      const ownerId = el.project.card.id;
      const activeSlug =
        ownerId === this.activeId() ? this.activeSpace(ownerId) : undefined;
      return [
        ...this.listSpaces(ownerId).map(
          (s) => new ThinkingSpaceItem(ownerId, s, s.slug === activeSlug),
        ),
        new NewSpaceItem(ownerId),
      ];
    }
    return [];
  }
}
