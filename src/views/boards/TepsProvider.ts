/**
 * TepsProvider — the "TEPs" section under Thinking Spaces (TEP-0009).
 *
 * Lists the Tandem Enhancement Proposals (`<boardDir>/teps/TEP-{id}.md`) of
 * whichever thinking space is selected in the navigator above — peer to the
 * Specs section, the orthogonal *why* axis. Files-first: each row IS a file —
 * clicking it opens the TEP document (pair with Markdown Preview, `Ctrl+K V`).
 *
 * A TEP is NOT a board-flowing tier (TEP-0003 keeps Spec→Slice); it's read from
 * the board, not dragged. Selection is pushed in by extension.ts (`setRepo`)
 * from the navigator's onDidChangeSelection; this provider stays a dumb renderer
 * over the files. The spec↔TEP link roll-up is layered on in SL-2.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { RepoEntry } from "./BoardNavigatorProvider";

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
      /** Specs delivering this TEP (`implemented_by:` frontmatter). */
      implementedBy: ImplementingSpec[];
      /** Hidden from the default nav; revealed (marked) under "Show archived" (TEP-tg86v7). */
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

  /** Whether archived TEPs are shown (TEP-tg86v7); default hides them. */
  private showArchived = false;

  /** The currently-scoped thinking space — the "+ New TEP" command roots its
   *  session here and mints the id from its board. */
  get repoEntry(): RepoEntry | undefined {
    return this.repo;
  }

  /** The thinking space whose TEPs we list (undefined = none selected). */
  setRepo(repo: RepoEntry | undefined): void {
    if (this.repo?.path === repo?.path && this.repo?.enabled === repo?.enabled)
      return;
    this.repo = repo;
    this.refresh();
  }

  /** Toggle whether archived TEPs appear in the list (TEP-tg86v7). */
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

    const store = new ThinkubeStore(this.repo.path, this.repo.boardDir);
    const teps = await store.listTeps();
    if (teps.length === 0) {
      return [
        {
          kind: "placeholder",
          text: "No TEPs yet — use ＋ New TEP on the board",
        },
      ];
    }

    const nodes: TepNode[] = [];
    for (const { id, relativePath: rel } of teps) {
      const doc = await store.getFile(rel);
      const fm = doc?.frontmatter;
      // Manual archive flag (TEP-tg86v7): hidden unless "Show archived" is on.
      const archived = fm?.archived === true;
      if (archived && !this.showArchived) continue;
      const title =
        typeof fm?.title === "string"
          ? fm.title
          : (firstHeading(doc?.body) ?? "(untitled)");
      // `implemented_by: [SP-<id>, …]` → click-through to each delivering Spec.
      const implementedBy: ImplementingSpec[] = Array.isArray(
        fm?.implemented_by,
      )
        ? fm.implemented_by
            .filter(
              (s): s is string => typeof s === "string" && s.trim() !== "",
            )
            .map((s) => {
              const specId = s.trim().replace(/^SP-/i, "");
              return {
                specId,
                file: path.join(
                  store.thinkubeDir,
                  store.pathForSpecDoc(specId),
                ),
              };
            })
        : [];
      nodes.push({
        kind: "tep",
        tepId: id,
        title,
        status: typeof fm?.status === "string" ? fm.status : "",
        file: path.join(store.thinkubeDir, rel),
        implementedBy,
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
    const base = node.status ? `${node.status} · ${node.title}` : node.title;
    item.description = node.archived ? `archived · ${base}` : base;
    item.tooltip = node.archived ? `(archived)\n${node.file}` : node.file;
    item.iconPath = tepStatusIcon(node);
    // Archived TEPs get a distinct contextValue so Unarchive (not Archive) shows.
    item.contextValue = node.archived ? "tep-archived" : "tep";
    item.command = {
      command: "vscode.open",
      title: "Open TEP",
      arguments: [vscode.Uri.file(node.file)],
    };
    return item;
  }
}

/** Status-at-a-glance icon for a TEP (SP-tgn2pd): archived keeps the archive
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
