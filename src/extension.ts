import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { registerConfigCommands } from "./commands/config";
import { registerKanbanCommands } from "./commands/kanban";
import { registerLauncherCommands } from "./commands/launcher";
import {
  initActiveContext,
  getCurrentActiveContext,
  updateActiveContext,
  updateConfigContext,
} from "./context/active";
import { AuthService } from "./github/AuthService";
import { GitHubService } from "./github/GitHubService";
import { ensureStableServerLink } from "./mcp/stableServerPath";
import {
  ensureKanbanMcpRegistration,
  writeMachineMcpConfig,
} from "./mcp/machineConfig";
import { AgentTeamsShimServer } from "./services/agentTeams/AgentTeamsShimServer";
import {
  OwnershipArbiter,
  GitRefsClaimStore,
  JournalClaimStore,
  type ClaimStore,
} from "./services/OwnershipArbiter";
import { WorktreeService } from "./services/WorktreeService";
import {
  ControlRequestWatcher,
  controlDir,
} from "./services/ControlRequestWatcher";
import { ClaudeConfigService } from "./services/ClaudeConfigService";
import { LauncherService } from "./services/LauncherService";
import { SessionLinkService } from "./services/SessionLinkService";
import { initSessions } from "./services/orchestratorSessions";
import { ConfigTreeProvider } from "./views/sidebar/ConfigTreeProvider";
import { ThinkingSpaceNavigatorProvider } from "./views/thinkingSpaces/ThinkingSpaceNavigatorProvider";
import { SpecsProvider } from "./views/thinkingSpaces/SpecsProvider";
import { TepsProvider } from "./views/thinkingSpaces/TepsProvider";
import { ThinkubeStore } from "./store/ThinkubeStore";
import {
  registerThinkingSpaceCommands,
  seedThinkingSpacesFilter,
} from "./commands/thinkingSpaces";
import { registerProductCommands } from "./commands/products";
import {
  registerArchiveCommands,
  seedArchivedFilters,
} from "./commands/archive";
import { registerWorktreeCommands } from "./commands/worktree";
import { registerOrchestrateCommands } from "./commands/orchestrate";
import { showFreshMarkdownPreview } from "./commands/freshPreview";
import { registerScratchpadCommands } from "./scratchpad";

export function activate(context: vscode.ExtensionContext) {
  console.log("Thinkube Tandem is now active!");

  // Create status bar item to show active project
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.command = "thinkube.switchProject";
  context.subscriptions.push(statusBarItem);

  // Initialize core services with first workspace folder or home as the seed path
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const initialPath = workspaceFolders?.[0]?.uri.fsPath || "/home/thinkube";
  const configService = new ClaudeConfigService(initialPath);
  const treeProvider = new ConfigTreeProvider(configService);

  // Tree view
  const treeView = vscode.window.createTreeView("claudeConfigTree", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Wire active-context tracking
  initActiveContext({ configService, treeProvider, statusBarItem });

  // Track active project from tree selection
  context.subscriptions.push(
    treeView.onDidChangeSelection((e) => {
      const item = e.selection[0];
      if (item?.projectPath && item.projectPath !== getCurrentActiveContext()) {
        updateActiveContext(item.projectPath);
      }
    }),
  );

  // Refresh context whenever the config service signals a change
  configService.onConfigChanged(() => {
    updateConfigContext();
  });

  // Initial active-context resolution
  updateActiveContext();

  // Update active project when editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateActiveContext();
    }),
  );

  // `thinkube.hasClaudeConfig` reflects whether the active project actually
  // has a .claude/ folder — it's kept current by updateConfigContext() (called
  // from updateActiveContext above and on every config change). The tree lists
  // all projects independently of this key, so we must NOT pin it to a constant.

  // Session-link maintenance — claude-code's Session History picker only
  // scans the project dir keyed off workspaceFolders[0]; sessions rooted in
  // other folders via "Open Here" are invisible to it, and a window reload
  // orphans their tabs (claude-code respawns panels without the session id).
  // This service mirrors their transcripts into the picker's dir via
  // symlinks so they stay listed and natively resumable.
  const sessionLinks = new SessionLinkService(context);
  context.subscriptions.push(sessionLinks);
  sessionLinks.activate();

  // Launcher (process-wrapper) — activate async; openHere works even if the
  // wrapper config update is still in flight because the wrapper falls back
  // to its own dir for state.
  const launcher = new LauncherService(context, sessionLinks);
  context.subscriptions.push(launcher);
  launcher.activate().catch((err) => {
    console.error("LauncherService activation failed:", err);
  });

  // Agent-teams fake-tmux display backend: run the IPC server the
  // on-PATH `tmux` shim forwards to, so Claude Code agent teams render as VS
  // Code terminal panes where tmux/iTerm2 are unavailable. Activates async;
  // it only spawns panes on demand when a team forms.
  const agentTeamsOutput = vscode.window.createOutputChannel(
    "Thinkube Agent Teams",
  );
  context.subscriptions.push(agentTeamsOutput);
  const agentTeams = new AgentTeamsShimServer(context, agentTeamsOutput);
  context.subscriptions.push(agentTeams);
  agentTeams.activate().catch((err) => {
    console.error("AgentTeamsShimServer activation failed:", err);
  });

  // Ownership arbiter: the single Extension-Host authority over which
  // slice owns which files while parallel Specs run in separate worktrees. Backed
  // by git refs (refs/locks/*) in the code repo's shared .git when available, else
  // a globalStorage JSON journal — and it RE-HYDRATES from that durable store on
  // activate, so a window reload reconstructs ownership rather than starting
  // blank. Consumed by the PreToolUse ownership hook (SL-4) and the
  // worktree-recovery flow (SL-5); held here so its rehydrated cache lives for
  // the session.
  let ownershipArbiter: OwnershipArbiter | undefined;
  activateOwnershipArbiter(context, initialPath)
    .then((arbiter) => {
      ownershipArbiter = arbiter;
      void ownershipArbiter; // wired by SL-4 (IPC) / SL-5 (recovery)
    })
    .catch((err) => {
      console.error("OwnershipArbiter activation failed:", err);
    });

  // GitHub stack (lazy auth — token only resolved on first kanban command).
  const auth = new AuthService(context);
  const github = new GitHubService(auth);
  const kanbanOutput = vscode.window.createOutputChannel("Thinkube Kanban");
  context.subscriptions.push(kanbanOutput);

  // Version-stable MCP server path: refresh the globalStorage symlink that
  // every repo's .mcp.json points through, so extension updates don't orphan
  // them (ADR-0007 Phase 6). Async — nothing below depends on it landing.
  ensureStableServerLink(context).catch((err) => {
    kanbanOutput.appendLine(
      `[thinkube] stable server link failed: ${(err as Error).message}`,
    );
  });

  // Machine-level MCP config: write thinking space root / folders
  // so the plugin-shipped kanban server self-configures without per-repo
  // `.mcp.json` env injection. Best-effort; refreshed when the thinkingSpaces root changes.
  writeMachineMcpConfig().catch((err) => {
    kanbanOutput.appendLine(
      `[thinkube] machine MCP config write failed: ${(err as Error).message}`,
    );
  });

  // User-scope kanban server registration ( follow-up): the plugin no
  // longer vendors the server and per-repo `.mcp.json` only reaches code repos, so a
  // session rooted in a board thinking-space sidecar (no `.mcp.json`) lost
  // `write_spec`. Register the server in Claude's user-scope `mcpServers` so EVERY
  // session sees it, cwd-independent — the channel Claude Code reads (it ignores VS
  // Code's MCP provider API the old KanbanMcpProvider used). Best-effort.
  ensureKanbanMcpRegistration(context).catch((err) => {
    kanbanOutput.appendLine(
      `[thinkube] kanban MCP registration failed: ${(err as Error).message}`,
    );
  });

  // Approval directory: the ONE machine-local directory both sides of the
  // human-approval gate agree on — the kanban panel's Approve mints tokens into it
  // (as `approvalStorageDir`), and the kanban MCP server self-locates the very same
  // directory from its own invocation path (SP-6/17). Derived from globalStorage,
  // so it is machine-specific and must never be committed into a repo. No env
  // injection is needed to arm the gate: self-location makes it always armed.
  const approvalDir = context.globalStorageUri.fsPath;

  // No activation-time ThinkubeStore: there is no single configured
  // methodology root anymore (ADR-0006). Stores are built per-repo where
  // they're used — thinkingSpaces.open, the kanban panel, the MCP server.

  // Register command groups
  registerConfigCommands(context, {
    configService,
    treeProvider,
    getCurrentActiveContext,
    updateActiveContext,
    updateConfigContext,
  });
  registerLauncherCommands(context, launcher);
  registerKanbanCommands(context, {
    auth,
    github,
    output: kanbanOutput,
    extensionUri: context.extensionUri,
    // SP-10: the panel's Approve affordance mints into this globalStorage-derived
    // dir — the same one the server env names — so gate and panel agree.
    approvalStorageDir: approvalDir,
  });

  // Per-repo thinking space navigator (ADR-0006): discover every repo's thinking space across the
  // open workspace folders; open enabled ones, enable disabled ones. The
  // methodology is delivered as a versioned plugin (not a per-repo bundle), so a
  // Thinking Space is a leaf — selecting it scopes the TEPs → Specs side-views.
  const thinkingSpaceNavigator = new ThinkingSpaceNavigatorProvider(
    kanbanOutput,
  );
  const thinkingSpacesView = vscode.window.createTreeView(
    "thinkubeThinkingSpaces",
    {
      treeDataProvider: thinkingSpaceNavigator,
    },
  );
  registerThinkingSpaceCommands(context, {
    extensionUri: context.extensionUri,
    output: kanbanOutput,
    provider: thinkingSpaceNavigator,
    launcher,
    sessionLinks,
    // SP-10: same approval dir as the kanban command path — one directory,
    // one source, whichever route opens the panel.
    approvalStorageDir: approvalDir,
  });
  // Restore the configured-only filter (icon + list) from the last session.
  seedThinkingSpacesFilter(context, thinkingSpaceNavigator);
  // New Product / New Project commands.
  registerProductCommands(context, thinkingSpaceNavigator);

  // Specs section (master-detail): lists the selected thinking space's
  // .thinkube/specs/SP-{n}/spec.md files; clicking opens the document.
  // Selecting a Thinking Space row scopes the Specs + TEPs side-views.
  const specsProvider = new SpecsProvider();
  const specsView = vscode.window.createTreeView("thinkubeSpecs", {
    treeDataProvider: specsProvider,
  });
  // TEPs section (TEP-0009): peer to Specs, lists the selected space's
  // teps/TEP-{id}.md; clicking opens the proposal. Scoped by the same
  // navigator selection that scopes Specs.
  const tepsProvider = new TepsProvider();
  const tepsView = vscode.window.createTreeView("thinkubeTeps", {
    treeDataProvider: tepsProvider,
  });
  context.subscriptions.push(
    thinkingSpacesView,
    specsView,
    tepsView,
    thinkingSpacesView.onDidChangeSelection((e) => {
      const node = e.selection[0];
      const repo = node?.kind === "repo" ? node : undefined;
      if (repo) {
        specsProvider.setRepo(repo);
        specsView.description = repo.name;
        tepsProvider.setRepo(repo);
        tepsView.description = repo.name;
        // The Configuration view follows the same selection:
        // scope it to the selected Thinking Space's .claude/.
        treeProvider.setSelectedRepo({ path: repo.path, name: repo.name });
        treeView.description = repo.name;
      } else if (node?.kind === "project") {
        // A Project navigates exactly like a Thinking Space: scope
        // the TEPs view to its umbrella TEPs; the Specs/Config views clear until
        // a TEP is picked (a project has no specs of its own — they're cross-repo).
        const thinkingSpaceRoot =
          vscode.workspace
            .getConfiguration("thinkube.thinkingSpace")
            .get<string>("root")
            ?.trim() || undefined;
        if (thinkingSpaceRoot) {
          tepsProvider.setProject({
            product: node.product,
            id: node.id,
            name: node.name,
            thinkingSpaceRoot,
          });
          tepsView.description = node.name;
        }
        specsProvider.setRepo(undefined);
        specsView.description = "";
        treeProvider.setSelectedRepo(undefined);
        treeView.description = "";
      }
    }),
    // Drill-down: selecting a TEP fills the Specs view with its implementing
    // specs — resolved CROSS-THINKING-SPACE via the TEP's owner namespace, so
    // an umbrella TEP shows its specs across repos and a repo TEP shows its own.
    tepsView.onDidChangeSelection((e) => {
      const node = e.selection[0];
      if (node?.kind === "tep")
        specsProvider.setTepFilter(node.tepId, node.ownerNamespace);
    }),
    // Auto-refresh the navigator when its discovery inputs change. Discovery
    // (discoverRepos) depends on `thinkube.thinkingSpace.root` and the workspace-folder
    // layout (each folder name is a namespace's container segment). Without
    // these listeners the view only re-discovered on a full window reload —
    // setting thinkingSpaces.root or adding a folder mid-session left it stale (SP-8).
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("thinkube.thinkingSpace.root")) {
        thinkingSpaceNavigator.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      thinkingSpaceNavigator.refresh(),
    ),
    vscode.commands.registerCommand("thinkube.specs.refresh", () =>
      specsProvider.refresh(),
    ),
    // Eye icon on a TEP/Spec row → open the document in the Markdown PREVIEW (rendered),
    // not the raw editor. The node (passed by the inline menu) carries its `.file`.
    vscode.commands.registerCommand(
      "thinkube.specs.openRendered",
      (node?: { file?: string }) => {
        if (node?.file)
          void showFreshMarkdownPreview(vscode.Uri.file(node.file));
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.teps.openRendered",
      (node?: { file?: string }) => {
        if (node?.file)
          void showFreshMarkdownPreview(vscode.Uri.file(node.file));
      },
    ),
    // "+ New Spec" on the Specs section header — mint the next Spec id from the
    // selected space's thinking space and open `/spec-prepare <n>` (sidebar-consistent
    // with "+ New TEP"; the kanban webview no longer owns this).
    vscode.commands.registerCommand("thinkube.specs.new", async () => {
      const repo = specsProvider.repoEntry;
      if (!repo || !repo.enabled) {
        vscode.window.showInformationMessage(
          "Select an enabled thinking space to add a Spec.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repo.path, repo.thinkingSpaceDir);
        // A Spec lives under a TEP in the org-scoped tree, so a parent TEP is
        // required to allocate its per-TEP `SP-m` number.
        const tep = specsProvider.selectedTep;
        if (!tep) {
          vscode.window.showInformationMessage(
            "Open a TEP first — a Spec is created under its TEP.",
          );
          return;
        }
        const m = await store.nextSpecNumber(tep);
        const prefill = `/spec-prepare ${tep}/${m} (implements TEP-${tep})`;
        await launcher.openHere(vscode.Uri.file(repo.path), prefill);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Couldn't start a new spec: ${(err as Error).message}`,
        );
      }
    }),
    vscode.commands.registerCommand("thinkube.teps.refresh", () =>
      tepsProvider.refresh(),
    ),
    // "+ New TEP" (TEP-0009): mint a conflict-free id from the selected space's
    // thinking space and open a Claude session with `/tep <id>` prefilled — mirrors
    // "+ New Spec" → `/spec-prepare <n>`.
    vscode.commands.registerCommand("thinkube.teps.new", async () => {
      const repo = tepsProvider.repoEntry;
      if (!repo || !repo.enabled) {
        vscode.window.showInformationMessage(
          "Select an enabled thinking space to add a TEP.",
        );
        return;
      }
      try {
        const store = new ThinkubeStore(repo.path, repo.thinkingSpaceDir);
        const id = await store.nextTepId();
        await launcher.openHere(vscode.Uri.file(repo.path), `/tep ${id} `);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Couldn't start a new TEP: ${(err as Error).message}`,
        );
      }
    }),
  );

  // Archive / unarchive Specs + TEPs and the per-view "Show archived" toggle
  //; seed both toggles from persisted state, like the thinkingSpaces filter.
  registerArchiveCommands(context, { specsProvider, tepsProvider });
  seedArchivedFilters(context, { specsProvider, tepsProvider });

  // "Start Spec in Worktree": create the Spec's git worktree and open a session
  // rooted there, so parallel Specs never share a working tree (SP-5).
  // approvalDir rides along for the control-request/Approve mint path; the gate
  // itself is self-located by the MCP server (SP-6/17), not env-armed.
  const worktreeDeps = { launcher, approvalDir };
  registerWorktreeCommands(context, worktreeDeps);

  // Thinking Space orchestrator: dispatch a Spec's next Ready slice to an
  // Agent SDK worker in its worktree. Consumes the (async-built) ownership arbiter
  // via a getter so it's read at invoke time.
  // Persist orchestrator session logs (the .jsonl the control-center float-out renders).
  initSessions(
    nodePath.join(context.globalStorageUri.fsPath, "orchestrator-sessions"),
  );
  // approvalDir: threaded to the orchestrator/WorktreeService for the Approve-mint
  // path; it no longer arms the gate via env injection — the MCP server
  // self-locates its approval store (SP-6/17).
  const orchestrateDeps = {
    specsProvider,
    getArbiter: () => ownershipArbiter,
    launcher,
    approvalDir,
  };
  registerOrchestrateCommands(context, orchestrateDeps);

  // Scratchpad: human-paced intent authoring surface (TEP-21).
  registerScratchpadCommands(context);

  // Control-request watcher: the standalone Kanban MCP server can't
  // open a VS Code session itself, so its `start_spec_worktree` tool drops a
  // one-shot request file into the shared control dir; this watcher runs the
  // matching command (`thinkube.specs.startWorktree`) — the same filesystem
  // MCP→host channel the thinking space uses, decoupled from the agent-teams tmux bridge.
  const controlWatcher = new ControlRequestWatcher(
    controlDir(context),
    (m) => kanbanOutput.appendLine(`[thinkube] control: ${m}`),
    // SP-6/3 open_review bridge: the same globalStorage approval dir the panel
    // call sites and the MCP env use, so the Approve button mints into the store
    // the gate reads — one directory, whichever route opens the panel.
    approvalDir,
  );
  context.subscriptions.push(controlWatcher);
  controlWatcher.activate().catch((err) => {
    console.error("ControlRequestWatcher activation failed:", err);
  });
}

/**
 * Build the ownership arbiter and rehydrate it from its durable store. Prefers
 * git refs in the seed path's canonical repo (shared across that repo's
 * worktrees, durable in .git); falls back to a globalStorage JSON journal when
 * the seed isn't a git repo. Rehydrating here is what makes ownership survive a
 * window reload.
 */
async function activateOwnershipArbiter(
  context: vscode.ExtensionContext,
  seedPath: string,
): Promise<OwnershipArbiter> {
  let store: ClaimStore;
  const repo = await new WorktreeService().canonicalRepo(seedPath);
  if (repo) {
    store = new GitRefsClaimStore(repo);
  } else {
    const dir = context.globalStorageUri.fsPath;
    await nodeFs.mkdir(dir, { recursive: true });
    store = new JournalClaimStore(nodePath.join(dir, "ownership-claims.json"));
  }
  const arbiter = new OwnershipArbiter(store);
  await arbiter.rehydrate();
  return arbiter;
}

export function deactivate() {
  // Clean up if needed
}
