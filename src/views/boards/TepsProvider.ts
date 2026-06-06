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

export type TepNode =
  | {
      kind: "tep";
      tepId: string;
      title: string;
      status: string;
      file: string;
    }
  | { kind: "placeholder"; text: string };

export class TepsProvider implements vscode.TreeDataProvider<TepNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TepNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repo: RepoEntry | undefined;

  /** The thinking space whose TEPs we list (undefined = none selected). */
  setRepo(repo: RepoEntry | undefined): void {
    if (this.repo?.path === repo?.path && this.repo?.enabled === repo?.enabled)
      return;
    this.repo = repo;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: TepNode): Promise<TepNode[]> {
    if (element) return [];
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
    const ids = await store.listTeps();
    if (ids.length === 0) {
      return [
        {
          kind: "placeholder",
          text: "No TEPs yet — use ＋ New TEP on the board",
        },
      ];
    }

    const nodes: TepNode[] = [];
    for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
      const rel = store.pathForTep(id);
      const doc = await store.getFile(rel);
      const fm = doc?.frontmatter;
      const title =
        typeof fm?.title === "string"
          ? fm.title
          : (firstHeading(doc?.body) ?? "(untitled)");
      nodes.push({
        kind: "tep",
        tepId: id,
        title,
        status: typeof fm?.status === "string" ? fm.status : "",
        file: path.join(store.thinkubeDir, rel),
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

    const item = new vscode.TreeItem(
      `TEP-${node.tepId}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.status
      ? `${node.status} · ${node.title}`
      : node.title;
    item.tooltip = node.file;
    item.iconPath = new vscode.ThemeIcon("lightbulb");
    item.contextValue = "tep";
    item.command = {
      command: "vscode.open",
      title: "Open TEP",
      arguments: [vscode.Uri.file(node.file)],
    };
    return item;
  }
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
