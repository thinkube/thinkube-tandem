/**
 * The navigator — the v1 three-level drill-down restored (Amendment 1):
 * products at the top, REPOSITORIES underneath (code homes; the cards),
 * and under every repository its named THINKING SPACES plus a permanent
 * "New thinking space…" row. Clicking a space opens that space's map.
 * The tree renders labels only; identity stays in the cards.
 */
import type * as vscodeTypes from "vscode";
import { createRequire } from "node:module";
import { EnabledProject } from "../core/identity";
import { SpaceOwnerKind, SpaceRef } from "../core/spaces";
import { WorkProject } from "../core/workProjects";

const req: NodeRequire =
  typeof require !== "undefined" ? require : createRequire(__filename);
function vs(): typeof vscodeTypes {
  return req("vscode") as typeof vscodeTypes;
}

class RepositoryItem extends vs().TreeItem {
  constructor(
    public readonly project: EnabledProject,
    active: boolean,
  ) {
    super(project.card.label, vs().TreeItemCollapsibleState.Expanded);
    this.id = project.card.id;
    this.contextValue = "tandem-repository";
    this.description =
      (project.prefix
        ? `${vs().workspace.asRelativePath(project.gitRoot)}/${project.prefix}`
        : vs().workspace.asRelativePath(project.gitRoot)) + (active ? "  ●" : "");
    this.iconPath = new (vs().ThemeIcon)(active ? "repo" : "repo-clone");
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

class ThinkingSpaceItem extends vs().TreeItem {
  constructor(ownerKey: string, kind: SpaceOwnerKind, space: SpaceRef, active: boolean) {
    super(space.label, vs().TreeItemCollapsibleState.None);
    this.id = `${ownerKey}/${space.slug}`;
    this.contextValue = kind === "project" ? "tandem-thinking-space-project" : "tandem-thinking-space";
    this.iconPath = new (vs().ThemeIcon)("notebook");
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
class NewSpaceItem extends vs().TreeItem {
  constructor(ownerKey: string, kind: SpaceOwnerKind) {
    super("New thinking space…", vs().TreeItemCollapsibleState.None);
    this.id = `${ownerKey}/…new`;
    this.contextValue = "tandem-new-space";
    this.iconPath = new (vs().ThemeIcon)("add");
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
class WorkProjectItem extends vs().TreeItem {
  constructor(public readonly wp: WorkProject, active: boolean) {
    super(wp.name, vs().TreeItemCollapsibleState.Expanded);
    this.id = `wp:${wp.id}`;
    this.contextValue = wp.state === "done" ? "tandem-work-project-done" : "tandem-work-project";
    this.iconPath = new (vs().ThemeIcon)(wp.state === "done" ? "pass-filled" : "milestone");
    this.description = (wp.state === "done" ? "✓ done" : "open") + (active ? "  ●" : "");
    this.tooltip = `Project "${wp.name}" — work that may touch several repositories.`;
  }
}

export class ProductItem extends vs().TreeItem {
  constructor(
    public readonly product: string,
    empty: boolean,
  ) {
    super(product, vs().TreeItemCollapsibleState.Expanded);
    this.contextValue = "tandem-product";
    this.iconPath = new (vs().ThemeIcon)("archive");
    if (empty) this.description = "no repositories yet — use + on this row";
  }
}

type Node = ProductItem | RepositoryItem | WorkProjectItem | ThinkingSpaceItem | NewSpaceItem;

export class ProjectsTreeProvider implements vscodeTypes.TreeDataProvider<Node> {
  private _emitter: vscodeTypes.EventEmitter<void>;
  readonly onDidChangeTreeData: vscodeTypes.Event<void>;

  constructor(
    private readonly listProductNames: () => string[],
    private readonly listRepositories: () => EnabledProject[],
    private readonly activeId: () => string | undefined,
    private readonly listSpaces: (ownerKey: string, kind: SpaceOwnerKind) => SpaceRef[],
    // Every slug this owner currently holds an OPEN tab for — read fresh on
    // each render, never captured, so a tab closed between two renders
    // stops showing as open on the very next draw.
    private readonly openSpacesFor: (ownerKey: string) => string[],
    private readonly listProjects: () => WorkProject[],
  ) {
    this._emitter = new (vs().EventEmitter)<void>();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh(): void {
    this._emitter.fire();
  }

  getTreeItem(el: Node): vscodeTypes.TreeItem {
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
      const openSlugs = this.openSpacesFor(ownerKey);
      return [
        ...this.listSpaces(ownerKey, "repository").map(
          (s) => new ThinkingSpaceItem(ownerKey, "repository", s, openSlugs.includes(s.slug)),
        ),
        new NewSpaceItem(ownerKey, "repository"),
      ];
    }
    if (el instanceof WorkProjectItem) {
      const ownerKey = `wp:${el.wp.id}`;
      const openSlugs = this.openSpacesFor(ownerKey);
      return [
        ...this.listSpaces(el.wp.id, "project").map(
          (s) => new ThinkingSpaceItem(ownerKey, "project", s, openSlugs.includes(s.slug)),
        ),
        new NewSpaceItem(ownerKey, "project"),
      ];
    }
    return [];
  }
}
