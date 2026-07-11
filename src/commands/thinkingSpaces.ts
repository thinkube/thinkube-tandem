/**
 * Per-repo thinking space commands (thinkube.thinkingSpace.*) — the navigator's actions.
 *
 * `open` builds a ThinkubeStore + ThinkubeFilesAdapter scoped to the selected
 * repo and opens its thinking space (KanbanPanel is singleton-by-scope, so each repo's
 * thinking space is its own panel). `enable` scaffolds a committable `.thinkube/`
 * skeleton so a repo becomes methodology-enabled (ADR-0006). No single-binding
 * settings — the repo path comes from the navigator selection.
 *
 * `newClaudeSession` / `resumeClaudeSession` make the thinking space the entry point
 * for Claude sessions rooted in that repo: new sessions go through the
 * cwd-patching launcher, and resume lists the repo's past sessions (matched
 * by the cwd recorded in each transcript) and reopens one via claude-code's
 * native resume — see docs/claude-code-internals.md.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { LauncherService } from "../services/LauncherService";
import { SessionLinkService } from "../services/SessionLinkService";
import { listSessionsForFolder, SessionInfo } from "../services/sessionLinks";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { resolveOrg, gitUserName } from "../store/thinkingSpaceNamespace";
import { workingRepoPath } from "../store/workingRepo";
import { gateSpecAcceptance } from "../methodology/qualityGates";
import { mergeSpecPr } from "../github/specMerge";
import { WorktreeService } from "../services/WorktreeService";
import { fastForwardBaseNote, retireWorktreeNote } from "./acceptLand";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { ThinkubeFilesAdapter } from "../views/kanban/host/storage/ThinkubeFilesAdapter";
import {
  ThinkingSpaceNavigatorProvider,
  RepoEntry,
  ProjectNode,
  discoverRepos,
} from "../views/thinkingSpaces/ThinkingSpaceNavigatorProvider";
import {
  registerMarketplace,
  enableMethodologyPluginForRepo,
  discoverMetadataMarketplaces,
  readMarketplaceName,
} from "../methodology/pluginEnablement";

interface ThinkingSpaceDeps {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  provider: ThinkingSpaceNavigatorProvider;
  launcher: LauncherService;
  sessionLinks: SessionLinkService;
  /**
   * globalStorage-derived directory the Approve affordance mints approvals
   * into (SP-10 arming). Threaded to KanbanPanel.open so Approve is available
   * whenever the panel opens; absent, the panel reports it unavailable.
   */
  approvalStorageDir?: string;
}

/**
 * Single key reused for both the persisted `workspaceState` flag and the
 * `when`-clause context key that swaps the title-bar filter icon.
 */
const CONFIGURED_ONLY_KEY = "thinkube.thinkingSpace.configuredOnly";

/**
 * Apply the configured-only filter everywhere it's observed: the provider
 * (re-renders the list), persisted `workspaceState` (survives reloads), and
 * the `when`-clause context key (swaps the title-bar icon).
 */
function applyConfiguredOnly(
  context: vscode.ExtensionContext,
  provider: ThinkingSpaceNavigatorProvider,
  value: boolean,
): void {
  provider.setConfiguredOnly(value);
  void context.workspaceState.update(CONFIGURED_ONLY_KEY, value);
  void vscode.commands.executeCommand("setContext", CONFIGURED_ONLY_KEY, value);
}

/**
 * Seed the filter from persisted state at activation so the icon and the list
 * match the choice saved before the last reload. Call after the view exists.
 */
export function seedThinkingSpacesFilter(
  context: vscode.ExtensionContext,
  provider: ThinkingSpaceNavigatorProvider,
): void {
  const saved = context.workspaceState.get<boolean>(CONFIGURED_ONLY_KEY, false);
  applyConfiguredOnly(context, provider, saved);
}

export function registerThinkingSpaceCommands(
  context: vscode.ExtensionContext,
  deps: ThinkingSpaceDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.thinkingSpace.refresh", () =>
      deps.provider.refresh(),
    ),
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.open",
      (r: RepoEntry) => openThinkingSpaceFor(context, deps, r),
    ),
    // Spec-scoped thinking space: a single Spec's slices + DAG graph. Invoked
    // by clicking a Spec in the Specs view.
    vscode.commands.registerCommand(
      "thinkube.specs.openKanban",
      (r: RepoEntry, specId: string) =>
        openThinkingSpaceFor(context, deps, r, specId),
    ),
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.enable",
      (r: RepoEntry) => enableHere(deps, r),
    ),
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.newClaudeSession",
      (r: RepoEntry) => deps.launcher.openHere(vscode.Uri.file(r.path)),
    ),
    vscode.commands.registerCommand(
      "thinkube.projects.newClaudeSession",
      (node: ProjectNode) => openProjectSession(deps, node),
    ),
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.resumeClaudeSession",
      (r: RepoEntry) => resumeClaudeSession(deps, r),
    ),
    vscode.commands.registerCommand(
      "thinkube.thinkingSpace.showConfiguredOnly",
      () => applyConfiguredOnly(context, deps.provider, true),
    ),
    vscode.commands.registerCommand("thinkube.thinkingSpace.showAll", () =>
      applyConfiguredOnly(context, deps.provider, false),
    ),
  );
}

/** The sidecar dir of a Project: `<thinkingSpaceRoot>/<product>/projects/<id>`. */
export function projectDirPath(
  thinkingSpaceRoot: string,
  product: string,
  id: string,
): string {
  return path.join(thinkingSpaceRoot, product, "projects", id);
}

/**
 * "New Claude Session in Project" (Phase 6) — the cockpit affordance projects
 * lacked. Resolve the project's sidecar dir, ensure it's plugin-enabled (register
 * the discovered metadata marketplaces + write its portable `enabledPlugins`), and
 * open a Claude session rooted there. The plugin supplies the methodology + thinking space
 * MCP; per-spec code work still happens in member-repo worktrees.
 */
async function openProjectSession(
  deps: ThinkingSpaceDeps,
  node: ProjectNode,
): Promise<void> {
  const thinkingSpaceRoot = vscode.workspace
    .getConfiguration("thinkube.thinkingSpace")
    .get<string>("root")
    ?.trim();
  if (!thinkingSpaceRoot) {
    vscode.window.showErrorMessage(
      "Set `thinkube.thinkingSpace.root` to open a project session.",
    );
    return;
  }
  const dir = projectDirPath(thinkingSpaceRoot, node.product, node.id);
  try {
    await fs.mkdir(dir, { recursive: true });
    for (const m of discoverMetadataMarketplaces(
      discoverRepos(),
      readMarketplaceName,
    ))
      await registerMarketplace(m.path);
    await enableMethodologyPluginForRepo(dir);
  } catch {
    /* best-effort — still open the session */
  }
  await deps.launcher.openHere(vscode.Uri.file(dir));
}

/**
 * Pick one of the repo's past Claude sessions and reopen it natively.
 *
 * Sessions are matched by the cwd recorded inside each transcript, so this
 * includes sessions rooted in subfolders of the repo. `ensureVisible` first:
 * claude-code's resume-by-id silently falls back to a NEW session when the
 * transcript isn't in its picker project dir (claude-code-internals.md, F6).
 */
async function resumeClaudeSession(
  deps: ThinkingSpaceDeps,
  r: RepoEntry,
): Promise<void> {
  const sessions = await listSessionsForFolder(r.path);
  if (sessions.length === 0) {
    const pick = await vscode.window.showInformationMessage(
      `No Claude sessions recorded for ${r.name}.`,
      "Start new session",
    );
    if (pick) await deps.launcher.openHere(vscode.Uri.file(r.path));
    return;
  }

  type Item = vscode.QuickPickItem & { session: SessionInfo };
  const items: Item[] = sessions.map((s) => ({
    label: s.title ?? s.uuid.slice(0, 8),
    description: [
      agoLabel(s.mtimeMs),
      s.cwd === r.path ? "" : path.relative(r.path, s.cwd),
    ]
      .filter(Boolean)
      .join(" · "),
    session: s,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Resume a Claude session in ${r.name}`,
    matchOnDescription: true,
  });
  if (!picked) return;

  await deps.sessionLinks.ensureVisible(picked.session.file);
  await vscode.commands.executeCommand(
    "claude-vscode.editor.open",
    picked.session.uuid,
  );
}

function agoLabel(mtimeMs: number): string {
  const mins = Math.max(1, Math.round((Date.now() - mtimeMs) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

async function openThinkingSpaceFor(
  context: vscode.ExtensionContext,
  deps: ThinkingSpaceDeps,
  r: RepoEntry,
  specFilter?: string,
): Promise<void> {
  const store = new ThinkubeStore(r.path, r.thinkingSpaceDir);
  store.activate();
  context.subscriptions.push(store);
  const adapter = new ThinkubeFilesAdapter(
    store,
    specFilter ? `SP-${specFilter}` : r.name,
    specFilter,
    r.name,
  );
  adapter.watchExternal();
  await KanbanPanel.open({
    extensionUri: deps.extensionUri,
    adapter,
    output: deps.output,
    approvalStorageDir: deps.approvalStorageDir,
    // A card's "detail" is its slice file open in the editor.
    openDetail: async (id: string) => {
      const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(id);
      if (!m) return;
      const rel = store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(store.thinkubeDir, rel)),
      );
    },
    // ("+ New Spec" now lives on the sidebar Specs section header, consistent
    // with "+ New TEP" — see thinkube.specs.new in extension.ts.)
    // Acceptance card's "Accept Spec" (TEP-0010): the single human gate at the
    // end of a Spec. Re-run the acceptance gate (every slice Done + every AC
    // checked), stamp `accepted:` on the Spec doc, then merge the Spec's one PR.
    // Mirrors the MCP `accept_spec` tool's gate+stamp, plus the PR merge. Throws
    // on refusal/failure — KanbanPanel surfaces the reason.
    onAcceptSpec: async (spec: string) => {
      const specRel = store.pathForSpecDoc(spec);
      const specDoc = await store.getFile(specRel);
      if (!specDoc) {
        throw new Error(`No spec at ${specRel} — nothing to accept.`);
      }
      const sliceStatuses: string[] = [];
      for (const rel of await store.listSlices(spec)) {
        const parsed = await store.getFile(rel);
        sliceStatuses.push(String(parsed?.frontmatter?.status ?? ""));
      }
      const gate = gateSpecAcceptance({
        specBody: specDoc.body,
        sliceStatuses,
      });
      if (!gate.ok) throw new Error(gate.reason);

      // Resolve the Spec's PR first (TEP-0010), tolerant of straight-to-main
      // Specs with no PR. A real merge failure throws, and we must
      // NOT leave the Spec stamped accepted while its PR is still open — so stamp
      // only after the merge call returns (it returns without merging when there
      // is simply no PR).
      // A project-member spec lives on the (code-less) project thinking space but its
      // code/branch/worktree are in the repo named by `repo:`. Run all git ops in
      // that WORKING repo, not `store.workspaceRoot` (the project dir, no `.git`).
      // For a normal same-repo spec this resolves back to the thinking space repo — unchanged.
      const wrp = await workingRepoPath(store, spec, store.workspaceRoot);
      const worktrees = new WorktreeService();
      const merge = await mergeSpecPr(spec, wrp);
      await store.writeFile(
        specRel,
        { ...specDoc.frontmatter, accepted: new Date().toISOString() },
        specDoc.body,
      );
      const retireNote = merge.merged
        ? await retireWorktreeNote(worktrees, wrp, spec)
        : "";
      // Fast-forward local `main` to origin so the accepted work is present locally, not just on
      // origin. Attempt it whenever the Spec landed on the remote — merged NOW *or* already merged by
      // an earlier accept: gating on `merge.merged` skipped the sync for an already-merged PR and left
      // the local checkout stale (the gap that bit us repeatedly). fastForwardBaseNote is best-effort.
      const syncNote = await fastForwardBaseNote(worktrees, wrp);
      vscode.window.showInformationMessage(
        merge.merged
          ? `Accepted SP-${spec} — ${merge.opened ? "opened + merged" : "merged"} ${merge.branch}${merge.output ? `: ${merge.output}` : ""}.${retireNote}${syncNote}`
          : `Accepted SP-${spec} — no PR to merge (shipped straight to main).`,
      );
    },
  });
}

async function enableHere(
  deps: ThinkingSpaceDeps,
  r: RepoEntry,
): Promise<void> {
  if (r.enabled) {
    vscode.window.showInformationMessage(
      `${r.name} already has a Tandem thinking space.`,
    );
    return;
  }
  // Scaffold the thinking space at its resolved thinking space dir — central
  // `<thinking space-root>/<namespace>` when configured, else co-located. The org-scoped
  // tree namespaces everything one level deeper under a per-
  // maintainer `<org>/`; specs nest under teps, so the scaffold is
  // `<org>/{teps,decisions,retros}` (no top-level `specs/`).
  const base = r.thinkingSpaceDir;
  let org: string;
  try {
    org = resolveOrg(gitUserName(r.path));
  } catch (e) {
    vscode.window.showErrorMessage((e as Error).message);
    return;
  }
  for (const sub of ["teps", "decisions", "retros"]) {
    await fs.mkdir(path.join(base, org, sub), { recursive: true });
    // .gitkeep so the empty dir is committable — the thinking space is the committed tree.
    await fs.writeFile(path.join(base, org, sub, ".gitkeep"), "");
  }

  // Per-repo opt-in plugin delivery: make THIS repo's
  // methodology come from the tandem-methodology plugin. Register the
  // marketplace once per machine from the local thinkube-metadata clone (a
  // directory source — offline; the machine path stays in ~/.claude), then write
  // the portable `enabledPlugins` entry into this repo's committed
  // .claude/settings.json. On a trusted session here the plugin auto-installs;
  // repos that weren't opted in get nothing. Best-effort.
  // Register every locally-cloned `*-metadata` marketplace:
  // the official `thinkube-metadata` AND any user `{org}-metadata`, so a user can
  // publish/enable their own plugins beside the official ones. Org-agnostic.
  const marketplaces = discoverMetadataMarketplaces(
    discoverRepos(),
    readMarketplaceName,
  );
  try {
    for (const m of marketplaces) await registerMarketplace(m.path);
    await enableMethodologyPluginForRepo(r.path);
  } catch {
    /* best-effort — marketplace registration / enablement can fail offline */
  }
  deps.provider.refresh();
  const action = await vscode.window.showInformationMessage(
    `Enabled the Tandem methodology in ${r.name}. Commit .thinkube/ and start adding specs.`,
    "Open thinking space",
  );
  if (action === "Open thinking space") {
    await vscode.commands.executeCommand("thinkube.thinkingSpace.open", {
      ...r,
      enabled: true,
    });
  }
}
