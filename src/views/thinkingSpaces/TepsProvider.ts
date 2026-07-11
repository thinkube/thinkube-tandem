/**
 * TepsProvider — the "TEPs" section under Thinking Spaces (TEP-0009).
 *
 * Lists the Tandem Enhancement Proposals (`<thinkingSpaceDir>/teps/TEP-{id}.md`) of
 * whichever thinking space is selected in the navigator above — peer to the
 * Specs section, the orthogonal *why* axis. Files-first: each row IS a file —
 * clicking it opens the TEP document (pair with Markdown Preview, `Ctrl+K V`).
 *
 * A TEP is NOT a thinking space-flowing tier (TEP-0003 keeps Spec→Slice); it's read from
 * the thinking space, not dragged. Selection is pushed in by extension.ts (`setRepo`)
 * from the navigator's onDidChangeSelection; this provider stays a dumb renderer
 * over the files. The spec↔TEP link roll-up is layered on in SL-2.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { RepoEntry } from "./ThinkingSpaceNavigatorProvider";
import { namespaceForRepo } from "../../store/thinkingSpaceNamespace";

/** A Project source the TEPs view can scope to — lists its umbrella TEPs. */
export interface ProjectSource {
  product: string;
  id: string;
  name: string;
  thinkingSpaceRoot: string;
}

/** A Spec that delivers a TEP, rolled up under it (TEP-0009). */
export interface ImplementingSpec {
  specId: string;
  /** Spec doc path — the click target. */
  file: string;
}

export type TepNode =
  | {
      kind: "tep";
      tepId: string;
      title: string;
      status: string;
      file: string;
      /** The namespace owning this TEP — repo namespace or project namespace
       *. Drives the cross-thinking space Specs resolver on selection. */
      ownerNamespace: string;
      /** Specs delivering this TEP (its `SP-m` subdirs in the tree). */
      implementedBy: ImplementingSpec[];
      /** Total specs under the TEP, and how many are delivered (`accepted:` set) —
       *  the at-a-glance progress roll-up. */
      specTotal: number;
      specDelivered: number;
      /** Hidden from the default nav; revealed (marked) under "Show archived". */
      archived: boolean;
    }
  | { kind: "implementing-spec"; spec: ImplementingSpec }
  | { kind: "placeholder"; text: string };

export class TepsProvider implements vscode.TreeDataProvider<TepNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TepNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repo: RepoEntry | undefined;

  /** A Project source — when set, the view lists its umbrella TEPs
   *  instead of a repo's. Mutually exclusive with `repo`. */
  private project: ProjectSource | undefined;

  /** Whether archived TEPs are shown; default hides them. */
  private showArchived = false;

  /** The currently-scoped thinking space — the "+ New TEP" command roots its
   *  session here and mints the id from its thinking space. */
  get repoEntry(): RepoEntry | undefined {
    return this.repo;
  }

  /** The thinking space whose TEPs we list (undefined = none selected). */
  setRepo(repo: RepoEntry | undefined): void {
    if (
      !this.project &&
      this.repo?.path === repo?.path &&
      this.repo?.enabled === repo?.enabled
    )
      return;
    this.repo = repo;
    this.project = undefined;
    this.refresh();
  }

  /** Scope the view to a Project — lists its umbrella TEPs. */
  setProject(project: ProjectSource | undefined): void {
    this.project = project;
    this.repo = undefined;
    this.refresh();
  }

  /** Toggle whether archived TEPs appear in the list. */
  setShowArchived(value: boolean): void {
    if (this.showArchived === value) return;
    this.showArchived = value;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: TepNode): Promise<TepNode[]> {
    if (element) {
      // Expand a TEP into its "delivered by" roll-up of implementing Specs.
      if (element.kind === "tep")
        return element.implementedBy.map((spec) => ({
          kind: "implementing-spec",
          spec,
        }));
      return [];
    }
    // Resolve the source — a repo Thinking Space or a Project umbrella.
    let store: ThinkubeStore;
    let ownerNamespace: string;
    if (this.project) {
      const dir = path.join(
        this.project.thinkingSpaceRoot,
        this.project.product,
        "projects",
        this.project.id,
      );
      store = new ThinkubeStore(dir, dir);
      ownerNamespace = `${this.project.product}/projects/${this.project.id}`;
    } else {
      // No selection → empty, which surfaces the view's welcome text.
      if (!this.repo) return [];
      if (!this.repo.enabled) {
        return [
          {
            kind: "placeholder",
            text: "Methodology not enabled in this thinking space",
          },
        ];
      }
      store = new ThinkubeStore(this.repo.path, this.repo.thinkingSpaceDir);
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
        name: f.name,
        path: f.uri.fsPath,
      }));
      ownerNamespace = namespaceForRepo(this.repo.path, folders) ?? "";
    }
    const teps = await store.listTeps();
    if (teps.length === 0) {
      return [
        {
          kind: "placeholder",
          text: "No TEPs yet — use ＋ New TEP on the thinking space",
        },
      ];
    }

    // In the org-scoped tree a TEP's specs ARE its `SP-m` subdirs (location is the
    // relationship), so roll them up from the store — not stale `implemented_by`.
    const allSpecs = await store.listSpecDirs();
    const nodes: TepNode[] = [];
    for (const { id, relativePath: rel } of teps) {
      const doc = await store.getFile(rel);
      const fm = doc?.frontmatter;
      // Manual archive flag: hidden unless "Show archived" is on.
      const archived = fm?.archived === true;
      if (archived && !this.showArchived) continue;
      const title =
        typeof fm?.title === "string"
          ? fm.title
          : (firstHeading(doc?.body) ?? "(untitled)");
      // The TEP's specs = its `SP-m` subdirs in the tree (composite id `${tep}/${m}`).
      // A spec is "delivered" when it carries an `accepted:` stamp.
      const specIds = allSpecs
        .filter((s) => s.split("/")[0] === id)
        .sort((a, b) => Number(a.split("/")[1]) - Number(b.split("/")[1]));
      let specDelivered = 0;
      const implementedBy: ImplementingSpec[] = [];
      for (const s of specIds) {
        const sfm = (await store.getFile(store.pathForSpecDoc(s)))?.frontmatter;
        if (sfm?.accepted != null && sfm.accepted !== "") specDelivered++;
        implementedBy.push({
          specId: s.split("/")[1],
          file: path.join(store.thinkubeDir, store.pathForSpecDoc(s)),
        });
      }
      nodes.push({
        kind: "tep",
        tepId: id,
        title,
        status: typeof fm?.status === "string" ? fm.status : "",
        file: path.join(store.thinkubeDir, rel),
        ownerNamespace,
        implementedBy,
        specTotal: specIds.length,
        specDelivered,
        archived,
      });
    }
    return nodes;
  }

  getTreeItem(node: TepNode): vscode.TreeItem {
    if (node.kind === "placeholder") {
      const item = new vscode.TreeItem(
        node.text,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("info");
      item.contextValue = "tepPlaceholder";
      return item;
    }

    if (node.kind === "implementing-spec") {
      const item = new vscode.TreeItem(
        `delivered by SP-${node.spec.specId}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("book");
      item.contextValue = "tepImplementingSpec";
      item.tooltip = `Open SP-${node.spec.specId}`;
      item.command = {
        command: "vscode.open",
        title: "Open spec",
        arguments: [vscode.Uri.file(node.spec.file)],
      };
      return item;
    }

    // A TEP with delivering specs expands into the "delivered by" roll-up.
    const item = new vscode.TreeItem(
      `TEP-${node.tepId}`,
      node.implementedBy.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    // Status lives in the icon colour, so keep it out of the row — that frees the
    // width for the title. Hover surfaces the status + the full title.
    item.description = node.archived ? `archived · ${node.title}` : node.title;
    item.tooltip = node.status ? `${node.status} · ${node.title}` : node.title;
    item.iconPath = tepStatusIcon(node);
    // Archived TEPs get a distinct contextValue so Unarchive (not Archive) shows.
    item.contextValue = node.archived ? "tep-archived" : "tep";
    // No `command` on click: selecting a TEP only scopes the Specs view (via
    // onDidChangeSelection → setTepFilter). The inline eye icon opens it rendered — opening the
    // raw markdown on every click was noise when you just wanted to list a TEP's specs.
    return item;
  }
}

/** Status-at-a-glance icon for a TEP: archived keeps the archive
 *  affordance; otherwise accepted = green check, superseded = muted, and
 *  proposed (or any other in-flight status) = blue. */
function tepStatusIcon(node: {
  archived: boolean;
  status: string;
}): vscode.ThemeIcon {
  if (node.archived) return new vscode.ThemeIcon("archive");
  const status = node.status.toLowerCase();
  if (status === "accepted")
    return new vscode.ThemeIcon(
      "pass-filled",
      new vscode.ThemeColor("charts.green"),
    );
  if (status === "superseded")
    return new vscode.ThemeIcon(
      "circle-slash",
      new vscode.ThemeColor("disabledForeground"),
    );
  return new vscode.ThemeIcon(
    "circle-filled",
    new vscode.ThemeColor("charts.blue"),
  );
}

/** First markdown heading / non-empty line of the body, marker stripped. */
function firstHeading(body: string | undefined): string | undefined {
  if (!body) return undefined;
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t) return t;
  }
  return undefined;
}
