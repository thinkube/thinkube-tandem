/**
 * SpecsProvider — the "Specs" section under Thinking Spaces (master-detail).
 *
 * Lists the specs (`.thinkube/specs/SP-{n}/spec.md`) of whichever thinking
 * space is selected in the navigator above. Files-first: each row IS a file —
 * clicking it opens the spec document in the editor (pair with Markdown
 * Preview, `Ctrl+K V`, for reading; that is the spec review surface, per the
 * /spec-prepare flow).
 *
 * Selection is pushed in by extension.ts (`setRepo`) from the navigator's
 * onDidChangeSelection; this provider stays a dumb renderer over the files.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { RepoEntry } from "./BoardNavigatorProvider";

export type SpecNode =
  | { kind: "spec"; specNumber: number; title: string; file: string }
  | { kind: "placeholder"; text: string };

export class SpecsProvider implements vscode.TreeDataProvider<SpecNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SpecNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repo: RepoEntry | undefined;

  /** The thinking space whose specs we list (undefined = none selected). */
  setRepo(repo: RepoEntry | undefined): void {
    if (this.repo?.path === repo?.path && this.repo?.enabled === repo?.enabled)
      return;
    this.repo = repo;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: SpecNode): Promise<SpecNode[]> {
    if (element) return []; // flat list
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

    const store = new ThinkubeStore(this.repo.path);
    const numbers = await store.listSpecDirs();
    if (numbers.length === 0) {
      return [
        {
          kind: "placeholder",
          text: "No specs yet — use ＋ New Spec on the board",
        },
      ];
    }

    const nodes: SpecNode[] = [];
    for (const n of [...numbers].sort((a, b) => a - b)) {
      const rel = store.pathForSpecDoc(n);
      const doc = await store.getFile(rel);
      nodes.push({
        kind: "spec",
        specNumber: n,
        title: firstHeading(doc?.body) ?? "(untitled)",
        file: path.join(store.thinkubeDir, rel),
      });
    }
    return nodes;
  }

  getTreeItem(node: SpecNode): vscode.TreeItem {
    if (node.kind === "placeholder") {
      const item = new vscode.TreeItem(
        node.text,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("info");
      item.contextValue = "specPlaceholder";
      return item;
    }
    const item = new vscode.TreeItem(
      `SP-${node.specNumber}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = node.title;
    item.tooltip = node.file;
    item.iconPath = new vscode.ThemeIcon("book");
    item.contextValue = "spec";
    item.command = {
      command: "vscode.open",
      title: "Open spec",
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
