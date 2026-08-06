/**
 * The Projects tree — the v1 sidebar convention over the v2 model:
 * products are the top level (created explicitly, existing even when
 * empty), projects strictly underneath (created from their product node),
 * the active project dotted. Click a project to make it active and open
 * its space in the editor. The tree renders labels only; identity stays
 * in the cards.
 */
import * as vscode from "vscode";
import { EnabledProject } from "../core/identity";

class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly project: EnabledProject,
    active: boolean,
  ) {
    super(project.card.label, vscode.TreeItemCollapsibleState.None);
    this.id = project.card.id;
    this.contextValue = "tandem-project";
    this.description =
      (project.prefix
        ? `${vscode.workspace.asRelativePath(project.gitRoot)}/${project.prefix}`
        : vscode.workspace.asRelativePath(project.gitRoot)) + (active ? "  ●" : "");
    this.iconPath = new vscode.ThemeIcon(active ? "repo" : "repo-clone");
    this.tooltip = [
      project.card.label,
      project.card.product ? `product: ${project.card.product}` : undefined,
      `anchor: ${project.anchorDir}`,
      project.card.remote ? `remote: ${project.card.remote}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    this.command = {
      command: "thinkube-tandem.activateProject",
      title: "Open this project's space",
      arguments: [project.card.id],
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
    if (empty) this.description = "no projects yet — use + on this row";
  }
}

type Node = ProductItem | ProjectItem;

export class ProjectsTreeProvider implements vscode.TreeDataProvider<Node> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(
    private readonly listProductNames: () => string[],
    private readonly listProjects: () => EnabledProject[],
    private readonly activeId: () => string | undefined,
  ) {}

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(el: Node): vscode.TreeItem {
    return el;
  }

  getChildren(el?: Node): Node[] {
    const projects = this.listProjects();
    if (!el) {
      const names = new Set(this.listProductNames());
      // Legacy cards without a product surface under an explicit group so
      // they are visible — and nameable — rather than hidden.
      if (projects.some((p) => !p.card.product)) names.add("(unassigned)");
      return [...names]
        .sort()
        .map(
          (n) =>
            new ProductItem(
              n,
              !projects.some((p) => (p.card.product ?? "(unassigned)") === n),
            ),
        );
    }
    if (el instanceof ProductItem)
      return projects
        .filter((p) => (p.card.product ?? "(unassigned)") === el.product)
        .sort((a, b) => a.card.label.localeCompare(b.card.label))
        .map((p) => new ProjectItem(p, p.card.id === this.activeId()));
    return [];
  }
}
