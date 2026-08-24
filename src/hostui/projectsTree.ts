/**
 * The navigator — the v1 three-level drill-down restored (Amendment 1):
 * products at the top, REPOSITORIES underneath (code homes; the cards),
 * and under every repository its named THINKING SPACES plus a permanent
 * "New thinking space…" row. Clicking a space opens that space's map.
 * The tree renders labels only; identity stays in the cards.
 */
import * as vscode from "vscode";
import { EnabledProject } from "../core/identity";
import { SpaceOwnerKind, SpaceRef } from "../core/spaces";
import { WorkProject } from "../core/workProjects";

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
  constructor(ownerKey: string, kind: SpaceOwnerKind, space: SpaceRef, active: boolean) {
    super(space.label, vscode.TreeItemCollapsibleState.None);
    this.id = `${ownerKey}/${space.slug}`;
    this.contextValue = kind === "project" ? "tandem-thinking-space-project" : "tandem-thinking-space";
    this.iconPath = new vscode.ThemeIcon("notebook");
    if (active) this.description = "●";
    this.tooltip = `Thinking space "${space.label}" — click to open its map.`;
    this.command = {
      command: "thinkube-tandem.openThinkingSpace",
      title: "Open this thinking space",
      arguments: [ownerKey, space.slug, kind],
    };
  }
}

/** The permanent creation row — v1's gesture, verbatim. */
class NewSpaceItem extends vscode.TreeItem {
  constructor(ownerKey: string, kind: SpaceOwnerKind) {
    super("New thinking space…", vscode.TreeItemCollapsibleState.None);
    this.id = `${ownerKey}/…new`;
    this.contextValue = "tandem-new-space";
    this.iconPath = new vscode.ThemeIcon("add");
    this.tooltip = "Start a new, independent stream of thinking here.";
    this.command = {
      command: "thinkube-tandem.newThinkingSpace",
      title: "New thinking space",
      arguments: [ownerKey, kind],
    };
  }
}

/** A project in the v1 sense: bounded WORK across repositories, open or
 *  done — never code. Its thinking spaces hang beneath it. */
class WorkProjectItem extends vscode.TreeItem {
  constructor(public readonly wp: WorkProject, active: boolean) {
    super(wp.name, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `wp:${wp.id}`;
    this.contextValue = wp.state === "done" ? "tandem-work-project-done" : "tandem-work-project";
    this.iconPath = new vscode.ThemeIcon(wp.state === "done" ? "pass-filled" : "milestone");
    this.description = (wp.state === "done" ? "✓ done" : "open") + (active ? "  ●" : "");
    this.tooltip = `Project "${wp.name}" — work that may touch several repositories.`;
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

type Node = ProductItem | RepositoryItem | WorkProjectItem | ThinkingSpaceItem | NewSpaceItem;

export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(
    private readonly listProductNames: () => string[],
    private readonly listRepositories: () => EnabledProject[],
    private readonly activeId: () => string | undefined,
    private readonly listSpaces: (ownerKey: string, kind: SpaceOwnerKind) => SpaceRef[],
    // Every space with an open tab is marked, not only one per owner — a
    // person can have several tabs open at once, one per space.
    private readonly isSpaceOpen: (ownerKey: string, slug: string) => boolean,
    private readonly listProjects: () => WorkProject[],
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
      return [
        ...repos
          .filter((p) => (p.card.product ?? "(unassigned)") === el.product)
          .sort((a, b) => a.card.label.localeCompare(b.card.label))
          .map((p) => new RepositoryItem(p, p.card.id === this.activeId())),
        ...this.listProjects()
          .filter((w) => w.product === el.product)
          .map((w) => new WorkProjectItem(w, `wp:${w.id}` === this.activeId())),
      ];
    if (el instanceof RepositoryItem) {
      const ownerKey = el.project.card.id;
      return [
        ...this.listSpaces(ownerKey, "repository").map(
          (s) => new ThinkingSpaceItem(ownerKey, "repository", s, this.isSpaceOpen(ownerKey, s.slug)),
        ),
        new NewSpaceItem(ownerKey, "repository"),
      ];
    }
    if (el instanceof WorkProjectItem) {
      const ownerKey = `wp:${el.wp.id}`;
      return [
        ...this.listSpaces(el.wp.id, "project").map(
          (s) => new ThinkingSpaceItem(ownerKey, "project", s, this.isSpaceOpen(ownerKey, s.slug)),
        ),
        new NewSpaceItem(ownerKey, "project"),
      ];
    }
    return [];
  }
}
