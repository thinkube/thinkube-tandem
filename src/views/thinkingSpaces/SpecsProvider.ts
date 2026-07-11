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
import { RepoEntry, discoverRepos } from "./ThinkingSpaceNavigatorProvider";
import { namespaceForRepo } from "../../store/thinkingSpaceNamespace";
import { specsImplementing, SpecImpl } from "./productTree";
import { parseImplements } from "../../store/implementsRef";
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

/** The TEP a Spec implements, rolled up under it (TEP-0009). */
export interface ImplementsLink {
  tepId: string;
  /** TEP file path — the click target (opens the proposal). */
  file: string;
}

export type SpecNode =
  | {
      kind: "spec";
      specNumber: string;
      title: string;
      file: string;
      delivered: DeliveredSlice[];
      /** The TEP this Spec implements (`implements:` frontmatter), if any. */
      implementsTep?: ImplementsLink;
      /** The Thinking Space's code repo path — worktrees are cut from here (SP-9). */
      repoPath: string;
      /** The owning repo entry — the kanban/worktree target (a
       *  cross-thinking space umbrella member lives in a different repo than the selection). */
      repo: RepoEntry;
      /** Any ready/doing slice — gates the Start-in-Worktree action (SP-9). */
      hasOpenWork: boolean;
      /** The Spec carries the `accepted:` stamp (completed; TEP-0010) — drives
       *  the green status icon. */
      accepted: boolean;
      /** Hidden from the default nav; revealed (marked) under "Show archived". */
      archived: boolean;
      /** The Spec carries a non-empty `superseded:` stamp (SP-6/14) — a deliberate
       *  "not building this" state, distinct from done and from archived. Drives the
       *  muted `circle-slash` icon + `spec-superseded` contextValue. */
      superseded: boolean;
      /** The `superseded_reason:` recorded at supersede time (SP-6/14), shown in the
       *  "superseded · <reason>" description. Undefined when not superseded. */
      supersededReason?: string;
    }
  | { kind: "delivered"; slice: DeliveredSlice }
  | { kind: "implements"; link: ImplementsLink }
  | { kind: "placeholder"; text: string };

export class SpecsProvider implements vscode.TreeDataProvider<SpecNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SpecNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repo: RepoEntry | undefined;

  /** Whether archived specs are shown; default hides them. */
  private showArchived = false;

  /** Drill-down: when set, list only Specs implementing this TEP id. */
  private tepFilter: string | undefined;

  /** The namespace owning the drilled-into TEP. When it's a project
   *  namespace (an umbrella TEP), implementers are resolved CROSS-THINKING-SPACE; absent
   *  (or a repo namespace) ⇒ the single-repo path. */
  private tepOwnerNamespace: string | undefined;

  /** The currently-scoped thinking space — the "+ New Spec" command roots its
   *  session here and mints the id from its thinking space. */
  get repoEntry(): RepoEntry | undefined {
    return this.repo;
  }

  /** The TEP currently drilled into (drives auto-`implements` on New Spec). */
  get selectedTep(): string | undefined {
    return this.tepFilter;
  }

  /** The thinking space whose specs we list (undefined = none selected). */
  setRepo(repo: RepoEntry | undefined): void {
    if (this.repo?.path === repo?.path && this.repo?.enabled === repo?.enabled)
      return;
    this.repo = repo;
    this.tepFilter = undefined; // a new space → no TEP drill-down yet
    this.tepOwnerNamespace = undefined;
    this.refresh();
  }

  /** Toggle whether archived specs appear in the list. */
  setShowArchived(value: boolean): void {
    if (this.showArchived === value) return;
    this.showArchived = value;
    this.refresh();
  }

  /**
   * Drill into a single TEP's implementing Specs (undefined = none). When
   * `ownerNamespace` is a project namespace (an umbrella TEP), implementers are
   * resolved cross-thinking space; otherwise the single-repo path is used.
   */
  setTepFilter(tepId: string | undefined, ownerNamespace?: string): void {
    const next = tepId || undefined;
    const owner = ownerNamespace || undefined;
    if (this.tepFilter === next && this.tepOwnerNamespace === owner) return;
    this.tepFilter = next;
    this.tepOwnerNamespace = owner;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: SpecNode): Promise<SpecNode[]> {
    if (element) {
      // Expand a Spec into: the TEP it implements (the *why*, TEP-0009), then
      // its "delivered by" roll-up of done slices.
      if (element.kind === "spec") {
        const rows: SpecNode[] = [];
        if (element.implementsTep)
          rows.push({ kind: "implements", link: element.implementsTep });
        for (const slice of element.delivered)
          rows.push({ kind: "delivered", slice });
        return rows;
      }
      return [];
    }
    // Cross-thinking space drill-down: an umbrella TEP's implementers span
    // repos, so resolve them across all thinkingSpaces rather than a single repo.
    if (this.tepFilter && this.tepOwnerNamespace) {
      return this.crossThinkingSpaceSpecs(
        this.tepOwnerNamespace,
        this.tepFilter,
      );
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

    // Specs are TEP-driven: nothing until a TEP is selected above.
    if (!this.tepFilter) return [];

    const store = new ThinkubeStore(this.repo.path, this.repo.thinkingSpaceDir);
    const numbers = await store.listSpecDirs();
    if (numbers.length === 0) {
      return [
        {
          kind: "placeholder",
          text: "No specs yet — use ＋ New Spec on the thinking space",
        },
      ];
    }

    // Resolve the repo coords once so a recorded commit SHA becomes a
    // clickable URL. Undefined for non-GitHub remotes — the SHA still shows.
    const coords = await detectRepoCoords(this.repo.path);
    const thinkingSpaceRoot = thinkingSpacesRoot();

    const nodes: SpecNode[] = [];
    for (const n of [...numbers].sort((a, b) => a.localeCompare(b))) {
      // Org-scoped tree: the spec's composite id is `${tep}/${m}`, so its TEP is
      // the prefix — match the drilled-into TEP by location, not `implements:`.
      if (n.split("/")[0] !== this.tepFilter) continue;
      const node = await this.buildSpecNode(
        this.repo,
        store,
        n,
        coords,
        thinkingSpaceRoot,
      );
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Specs implementing an umbrella TEP, resolved across every enabled thinking space
   * — each result carries its own repo. */
  private async crossThinkingSpaceSpecs(
    ownerNamespace: string,
    tepId: string,
  ): Promise<SpecNode[]> {
    // Post-migration, a project's member specs physically live under the project
    // thinking space's tree (`<project>/<org>/teps/TEP-n/SP-m/`), not in their code repos.
    // List them from the project store, filtered by the drilled-into TEP; each
    // spec's home code-repo (for orchestration/commit paths) rides in its `repo:`
    // frontmatter, resolved back to a RepoEntry.
    const thinkingSpaceRoot = thinkingSpacesRoot();
    if (!thinkingSpaceRoot) return [];
    const projDir = path.join(thinkingSpaceRoot, ...ownerNamespace.split("/"));
    const store = new ThinkubeStore(projDir, projDir);
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
    const repos = discoverRepos().filter((r) => r.enabled && !r.worktreeOf);
    const repoByNs = new Map<string, RepoEntry>();
    for (const r of repos) {
      const ns = namespaceForRepo(r.path, folders);
      if (ns) repoByNs.set(ns, r);
    }
    // The kanban/thinkingSpaceCtx target for every member is the PROJECT thinking space itself —
    // that's where the spec + its slices live, so the panel must load from here
    // (loading the working repo is what made a member look "not sliced"). The
    // WORKING repo (where the worktree is cut) rides in the spec's `repo:` and is
    // resolved at orchestrate time, not here.
    const projectRepo: RepoEntry = {
      kind: "repo",
      path: projDir,
      name: ownerNamespace.split("/").pop() ?? ownerNamespace,
      rel: ownerNamespace,
      enabled: true,
      thinkingSpaceDir: projDir,
    };
    const nodes: SpecNode[] = [];
    for (const n of await store.listSpecDirs()) {
      if (n.split("/")[0] !== tepId) continue;
      const fm = (await store.getFile(store.pathForSpecDoc(n)))?.frontmatter;
      const homeNs = typeof fm?.repo === "string" ? fm.repo : undefined;
      const workingRepo = (homeNs && repoByNs.get(homeNs)) ?? repos[0];
      // Commit-URL coords come from the WORKING repo (where commits land), even
      // though the node's thinking space is the project.
      const coords = workingRepo
        ? await detectRepoCoords(workingRepo.path)
        : undefined;
      const node = await this.buildSpecNode(
        projectRepo,
        store,
        n,
        coords,
        thinkingSpaceRoot,
      );
      if (node) nodes.push(node);
    }
    return nodes;
  }

  /** Build a Spec tree node for one spec in a given repo's store. */
  private async buildSpecNode(
    repo: RepoEntry,
    store: ThinkubeStore,
    n: string,
    coords: RepoCoords | undefined,
    thinkingSpaceRoot: string | undefined,
  ): Promise<SpecNode | undefined> {
    const rel = store.pathForSpecDoc(n);
    const doc = await store.getFile(rel);
    const archived = doc?.frontmatter?.archived === true;
    if (archived && !this.showArchived) return undefined;
    const supersededStamp = doc?.frontmatter?.superseded;
    const superseded =
      typeof supersededStamp === "string" && supersededStamp.trim().length > 0;
    const supersededReason =
      typeof doc?.frontmatter?.superseded_reason === "string"
        ? doc.frontmatter.superseded_reason
        : undefined;
    const { delivered, hasOpenWork } = await this.specRollup(store, n, coords);
    const implRaw =
      typeof doc?.frontmatter?.implements === "string"
        ? doc.frontmatter.implements.trim()
        : "";
    let implementsTep: ImplementsLink | undefined;
    if (implRaw) {
      const ref = parseImplements(implRaw);
      const tepId = ref?.id ?? implRaw.replace(/^TEP-/i, "");
      // A qualified ref's TEP lives in its owner namespace (a project umbrella);
      // a bare ref's TEP is in the spec's own repo (slug-tolerant via findTep).
      const file =
        ref?.namespace && thinkingSpaceRoot
          ? path.join(
              thinkingSpaceRoot,
              ...ref.namespace.split("/"),
              "teps",
              `TEP-${tepId}.md`,
            )
          : path.join(
              store.thinkubeDir,
              (await store.findTep(tepId)) ?? store.pathForTep(tepId),
            );
      implementsTep = { tepId, file };
    }
    return {
      kind: "spec",
      specNumber: n,
      title: firstHeading(doc?.body) ?? "(untitled)",
      file: path.join(store.thinkubeDir, rel),
      delivered,
      implementsTep,
      repoPath: repo.path,
      repo,
      hasOpenWork,
      accepted: doc?.frontmatter?.accepted != null,
      archived,
      superseded,
      supersededReason,
    };
  }

  /** A Spec's delivery roll-up (done slices, with commit/PR) plus whether it has
   *  any open (ready/doing) slice — both from a single slice pass (SP-9). */
  private async specRollup(
    store: ThinkubeStore,
    specNumber: string,
    coords: RepoCoords | undefined,
  ): Promise<{ delivered: DeliveredSlice[]; hasOpenWork: boolean }> {
    const delivered: DeliveredSlice[] = [];
    let hasOpenWork = false;
    for (const rel of await store.listSlices(specNumber)) {
      const m = /SL-(\d+)\.md$/.exec(rel);
      if (!m) continue;
      const parsed = await store.getFile(rel);
      const fm = parsed?.frontmatter;
      const status = (fm?.status ?? "").toLowerCase();
      if (status === "ready" || status === "doing") hasOpenWork = true;
      if (status !== "done") continue;
      const commit = typeof fm?.commit === "string" ? fm.commit : undefined;
      const pr = typeof fm?.pr === "string" ? fm.pr : undefined;
      delivered.push({
        sliceNumber: Number(m[1]),
        title: firstHeading(parsed?.body) ?? `SL-${m[1]}`,
        commit,
        commitUrl:
          commit && coords ? buildCommitUrl(coords, commit) : undefined,
        pr,
        file: path.join(store.thinkubeDir, rel),
      });
    }
    delivered.sort((a, b) => a.sliceNumber - b.sliceNumber);
    return { delivered, hasOpenWork };
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

    if (node.kind === "implements") return implementsItem(node.link);

    // A Spec with done slices or a TEP link expands into the roll-up. The label
    // shows ONLY the spec number (`SP-1`), not the composite `${tep}/${spec}` id
    // (`SP-31/1`) — the view is already scoped to a drilled-into TEP, so the tep
    // prefix is redundant. The composite stays in `specNumber` for the click logic.
    const specLabel = node.specNumber.includes("/")
      ? node.specNumber.split("/")[1]
      : node.specNumber;
    const item = new vscode.TreeItem(
      `SP-${specLabel}`,
      node.delivered.length || node.implementsTep
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    // Status precedence (superseded > archived > accepted > open) drives the row's
    // label prefix, icon, and contextValue from a single pure classifier (SP-6/14).
    const state = specDisplayState(node);
    const label =
      state === "superseded"
        ? `superseded · ${node.supersededReason ?? node.title}`
        : node.archived
          ? `archived · ${node.title}`
          : node.title;
    item.description = label;
    // Hover shows the full title (the spec's description), not the file path.
    item.tooltip = label;
    item.iconPath = specStatusIcon(node);
    // Superseded / archived specs get a distinct contextValue so the right
    // reversal action (Unsupersede / Unarchive), not the worktree actions, shows
    // (SP-6/14).
    item.contextValue =
      state === "superseded"
        ? "spec-superseded"
        : node.archived
          ? "spec-archived"
          : node.hasOpenWork
            ? "spec-open"
            : "spec-done";
    // Click a Spec → open its scoped kanban + DAG graph.
    item.command = {
      command: "thinkube.specs.openKanban",
      title: "Open Spec kanban",
      arguments: [node.repo, node.specNumber],
    };
    return item;
  }
}

/**
 * Pure display classifier for a Spec (SP-6/14): collapses the three orthogonal
 * facts — `superseded`, `archived`, `accepted` — into a single lifecycle state
 * with precedence **superseded > archived > accepted > open**. Returns the STRING
 * LITERAL (never a `vscode.ThemeIcon`), so `specStatusIcon` / `contextValue` /
 * the row description all derive from ONE source of truth and can't diverge.
 */
export function specDisplayState(node: {
  superseded: boolean;
  accepted: boolean;
  archived: boolean;
}): "superseded" | "accepted" | "open" | "archived" {
  if (node.superseded) return "superseded";
  if (node.archived) return "archived";
  if (node.accepted) return "accepted";
  return "open";
}

/** Status-at-a-glance icon for a Spec (SP-6/14), derived from
 *  {@link specDisplayState}: superseded = a muted `circle-slash` (mirroring the
 *  TEP provider); archived keeps the archive affordance; accepted = green check;
 *  open work = blue; a Spec with neither (not started / no open work) = a neutral
 *  outline. */
function specStatusIcon(node: {
  superseded: boolean;
  archived: boolean;
  accepted: boolean;
  hasOpenWork: boolean;
}): vscode.ThemeIcon {
  switch (specDisplayState(node)) {
    case "superseded":
      return new vscode.ThemeIcon(
        "circle-slash",
        new vscode.ThemeColor("disabledForeground"),
      );
    case "archived":
      return new vscode.ThemeIcon("archive");
    case "accepted":
      return new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("charts.green"),
      );
    default:
      // "open" — distinguish in-flight work (blue) from not-yet-started (outline).
      return node.hasOpenWork
        ? new vscode.ThemeIcon(
            "circle-filled",
            new vscode.ThemeColor("charts.blue"),
          )
        : new vscode.ThemeIcon("circle-outline");
  }
}

/** An "implements TEP-{id}" row under a Spec; clicking opens the proposal. */
function implementsItem(link: ImplementsLink): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `implements TEP-${link.tepId}`,
    vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("lightbulb");
  item.contextValue = "specImplements";
  item.tooltip = `Open TEP-${link.tepId}`;
  item.command = {
    command: "vscode.open",
    title: "Open TEP",
    arguments: [vscode.Uri.file(link.file)],
  };
  return item;
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

/** The configured central thinking space root (`thinkube.thinkingSpace.root`), or undefined. */
function thinkingSpacesRoot(): string | undefined {
  return (
    vscode.workspace
      .getConfiguration("thinkube.thinkingSpace")
      .get<string>("root")
      ?.trim() || undefined
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
