/**
 * SpecsProvider — the "Specs" section under Thinking Spaces (master-detail).
 *
 * Lists the specs (`.thinkube/specs/SP-{n}/spec.md`) of whichever thinking
 * space is selected in the navigator above. Files-first: each row IS a file —
 * clicking it opens the spec document in the editor (pair with Markdown
 * Preview, `Ctrl+K V`, for reading; that is the spec review surface, per the
 * /spec-prepare flow).
 *
 * A Spec with done slices expands into a "delivered by" roll-up (SP-2): one
 * row per done slice showing its recorded commit / PR, clickable straight to
 * the commit or pull request on the remote. The provenance is read fresh on
 * each render, so a `refresh()` (repo reselect or `thinkube.specs.refresh`)
 * reflects the current state of the slice files.
 *
 * Selection is pushed in by extension.ts (`setRepo`) from the navigator's
 * onDidChangeSelection; this provider stays a dumb renderer over the files.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { ThinkubeStore } from "../../store/ThinkubeStore";
import { RepoEntry } from "./BoardNavigatorProvider";
import {
  buildCommitUrl,
  detectRepoCoords,
  RepoCoords,
} from "../../github/gitRemote";

/** A done slice's delivery provenance, rolled up under its parent Spec. */
export interface DeliveredSlice {
  sliceNumber: number;
  title: string;
  commit?: string;
  /** Full URL to `commit` on the remote, when the remote is resolvable. */
  commitUrl?: string;
  pr?: string;
  /** Slice file path — the fallback click target when no commit/PR is recorded. */
  file: string;
}

export type SpecNode =
  | {
      kind: "spec";
      specNumber: number;
      title: string;
      file: string;
      delivered: DeliveredSlice[];
    }
  | { kind: "delivered"; slice: DeliveredSlice }
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
    if (element) {
      // Expand a Spec into its "delivered by" roll-up of done slices.
      if (element.kind === "spec") {
        return element.delivered.map((slice) => ({ kind: "delivered", slice }));
      }
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

    // Resolve the repo coords once so a recorded commit SHA becomes a
    // clickable URL. Undefined for non-GitHub remotes — the SHA still shows.
    const coords = await detectRepoCoords(this.repo.path);

    const nodes: SpecNode[] = [];
    for (const n of [...numbers].sort((a, b) => a - b)) {
      const rel = store.pathForSpecDoc(n);
      const doc = await store.getFile(rel);
      nodes.push({
        kind: "spec",
        specNumber: n,
        title: firstHeading(doc?.body) ?? "(untitled)",
        file: path.join(store.thinkubeDir, rel),
        delivered: await this.deliveredSlices(store, n, coords),
      });
    }
    return nodes;
  }

  /** Done slices under a Spec, in slice order, with their recorded commit/PR. */
  private async deliveredSlices(
    store: ThinkubeStore,
    specNumber: number,
    coords: RepoCoords | undefined,
  ): Promise<DeliveredSlice[]> {
    const out: DeliveredSlice[] = [];
    for (const rel of await store.listSlices(specNumber)) {
      const m = /SL-(\d+)\.md$/.exec(rel);
      if (!m) continue;
      const parsed = await store.getFile(rel);
      const fm = parsed?.frontmatter;
      if (fm?.status !== "done") continue;
      const commit = typeof fm.commit === "string" ? fm.commit : undefined;
      const pr = typeof fm.pr === "string" ? fm.pr : undefined;
      out.push({
        sliceNumber: Number(m[1]),
        title: firstHeading(parsed?.body) ?? `SL-${m[1]}`,
        commit,
        commitUrl:
          commit && coords ? buildCommitUrl(coords, commit) : undefined,
        pr,
        file: path.join(store.thinkubeDir, rel),
      });
    }
    return out.sort((a, b) => a.sliceNumber - b.sliceNumber);
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

    if (node.kind === "delivered") return deliveredItem(node.slice);

    // A Spec with done slices expands into the delivery roll-up.
    const item = new vscode.TreeItem(
      `SP-${node.specNumber}`,
      node.delivered.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
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

/** A "delivered by" row: SL-{m} with its commit/PR, clicking opens the link. */
function deliveredItem(slice: DeliveredSlice): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `SL-${slice.sliceNumber}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.description = provenanceSummary(slice);
  item.iconPath = new vscode.ThemeIcon(
    slice.pr ? "git-pull-request" : "git-commit",
  );
  item.contextValue = "specDelivered";
  item.tooltip = deliveredTooltip(slice);
  // Click target: the PR first (the delivery vehicle), then the commit, then
  // the slice file. http(s) URLs open externally via vscode.open.
  const link = slice.pr ?? slice.commitUrl;
  item.command = link
    ? {
        command: "vscode.open",
        title: "Open delivery",
        arguments: [vscode.Uri.parse(link)],
      }
    : {
        command: "vscode.open",
        title: "Open slice",
        arguments: [vscode.Uri.file(slice.file)],
      };
  return item;
}

/** Muted one-liner: "<title> · ea7d4fe · PR #13", or a "not recorded" note. */
function provenanceSummary(s: DeliveredSlice): string {
  const marks: string[] = [];
  if (s.commit) marks.push(s.commit.slice(0, 7));
  if (s.pr) marks.push(prLabel(s.pr));
  const title = clip(s.title, 52);
  return marks.length
    ? `${title} · ${marks.join(" · ")}`
    : `${title} · no commit/PR recorded`;
}

/** Clip at a word boundary so long one-paragraph slice titles stay readable. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${at > max / 2 ? cut.slice(0, at) : cut}…`;
}

function deliveredTooltip(s: DeliveredSlice): string {
  const lines = [s.title];
  if (s.commit) lines.push(`commit ${s.commit}`);
  if (s.commitUrl) lines.push(s.commitUrl);
  if (s.pr) lines.push(`PR ${s.pr}`);
  if (!s.commit && !s.pr) lines.push("no commit/PR recorded yet");
  return lines.join("\n");
}

/** "PR #13" parsed from a pull-request URL, or a bare "PR" if no number. */
function prLabel(url: string): string {
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? `PR #${m[1]}` : "PR";
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
