import * as vscode from "vscode";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

import { registerBundleCommands } from "./commands/bundle";
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
import { KanbanMcpProvider } from "./mcp/KanbanMcpProvider";
import {
  ensureStableServerLink,
  stableServerScriptPath,
} from "./mcp/stableServerPath";
import { BundleInstaller } from "./methodology/BundleInstaller";
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
import { BoardNavigatorProvider } from "./views/boards/BoardNavigatorProvider";
import { SpecsProvider } from "./views/boards/SpecsProvider";
import { TepsProvider } from "./views/boards/TepsProvider";
import { ThinkubeStore } from "./store/ThinkubeStore";
import { registerBoardCommands, seedBoardsFilter } from "./commands/boards";
import { registerProductCommands } from "./commands/products";
import {
  registerArchiveCommands,
  seedArchivedFilters,
} from "./commands/archive";
import { registerWorktreeCommands } from "./commands/worktree";
import { registerOrchestrateCommands } from "./commands/orchestrate";

export function activate(context: vscode.ExtensionContext) {
  console.log("Thinkube AI Integration is now active!");

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

  // Agent-teams fake-tmux display backend (SP-tgnb5o): run the IPC server the
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

  // Ownership arbiter (SP-tgpwbm): the single Extension-Host authority over which
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

  // No activation-time ThinkubeStore: there is no single configured
  // methodology root anymore (ADR-0006). Stores are built per-repo where
  // they're used — boards.open, the kanban panel, the MCP server.

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
  });

  // MCP provider — exposes the board-independent kanban server to VS Code-
  // native LLM clients. (Claude Code sessions discover the same server via
  // each repo's .mcp.json.) Returns no definitions until a board exists.
  KanbanMcpProvider.install(context, {
    context,
    output: kanbanOutput,
  });

  // Methodology bundle installer — per-repo (ADR-0006); bakes the
  // version-stable server path into each .mcp.json it writes.
  const bundleInstaller = new BundleInstaller(
    context.extensionUri.fsPath,
    stableServerScriptPath(context),
  );
  registerBundleCommands(context, {
    installer: bundleInstaller,
    output: kanbanOutput,
  });

  // Per-repo board navigator (ADR-0006): discover every repo's .thinkube/ board
  // across the open workspace folders; open enabled ones, enable disabled ones.
  // Each enabled repo expands to its methodology-bundle status (the old
  // "Project" view, absorbed — ADR-0007 Phase 6).
  const boardNavigator = new BoardNavigatorProvider(
    bundleInstaller,
    kanbanOutput,
  );
  const boardsView = vscode.window.createTreeView("thinkubeBoards", {
    treeDataProvider: boardNavigator,
  });
  registerBoardCommands(context, {
    extensionUri: context.extensionUri,
    output: kanbanOutput,
    provider: boardNavigator,
    launcher,
    sessionLinks,
  });
  // Restore the configured-only filter (icon + list) from the last session.
  seedBoardsFilter(context, boardNavigator);
  // New Product / New Project commands (SP-tgvl81_SL-3).
  registerProductCommands(context, boardNavigator);

  // Specs section (master-detail): lists the selected thinking space's
  // .thinkube/specs/SP-{n}/spec.md files; clicking opens the document.
  // Selecting either the repo row or its bundle-status child scopes it.
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
    boardsView,
    specsView,
    tepsView,
    boardsView.onDidChangeSelection((e) => {
      const node = e.selection[0];
      const repo =
        node?.kind === "repo"
          ? node
          : node?.kind === "bundle-status"
            ? node.repo
            : undefined;
      if (repo) {
        specsProvider.setRepo(repo);
        specsView.description = repo.name;
        tepsProvider.setRepo(repo);
        tepsView.description = repo.name;
        // The Configuration view follows the same selection (SP-tgvhfk_SL-1):
        // scope it to the selected Thinking Space's .claude/.
        treeProvider.setSelectedRepo({ path: repo.path, name: repo.name });
        treeView.description = repo.name;
      } else if (node?.kind === "project") {
        // A Project navigates exactly like a Thinking Space (SP-tgvud7): scope
        // the TEPs view to its umbrella TEPs; the Specs/Config views clear until
        // a TEP is picked (a project has no specs of its own — they're cross-repo).
        const boardRoot =
          vscode.workspace
            .getConfiguration("thinkube.boards")
            .get<string>("root")
            ?.trim() || undefined;
        if (boardRoot) {
          tepsProvider.setProject({
            product: node.product,
            id: node.id,
            name: node.name,
            boardRoot,
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
    // specs — resolved CROSS-BOARD via the TEP's owner namespace (SP-tgvud7), so
    // an umbrella TEP shows its specs across repos and a repo TEP shows its own.
    tepsView.onDidChangeSelection((e) => {
      const node = e.selection[0];
      if (node?.kind === "tep")
        specsProvider.setTepFilter(node.tepId, node.ownerNamespace);
    }),
    // Auto-refresh the navigator when its discovery inputs change. Discovery
    // (discoverRepos) depends on `thinkube.boards.root` and the workspace-folder
    // layout (each folder name is a namespace's container segment). Without
    // these listeners the view only re-discovered on a full window reload —
    // setting boards.root or adding a folder mid-session left it stale (SP-8).
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("thinkube.boards.root")) {
        boardNavigator.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() =>
      boardNavigator.refresh(),
    ),
    vscode.commands.registerCommand("thinkube.specs.refresh", () =>
      specsProvider.refresh(),
    ),
    // "+ New Spec" on the Specs section header — mint the next Spec id from the
    // selected space's board and open `/spec-prepare <n>` (sidebar-consistent
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
        const store = new ThinkubeStore(repo.path, repo.boardDir);
        const n = await store.nextSpecNumber();
        // If a TEP is drilled into, pre-assign the new Spec to it (implements:).
        const tep = specsProvider.selectedTep;
        const prefill = tep
          ? `/spec-prepare ${n} (implements TEP-${tep})`
          : `/spec-prepare ${n} `;
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
    // board and open a Claude session with `/tep <id>` prefilled — mirrors
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
        const store = new ThinkubeStore(repo.path, repo.boardDir);
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
  // (TEP-tg86v7); seed both toggles from persisted state, like the boards filter.
  registerArchiveCommands(context, { specsProvider, tepsProvider });
  seedArchivedFilters(context, { specsProvider, tepsProvider });

  // "Start Spec in Worktree": create the Spec's git worktree and open a session
  // rooted there, so parallel Specs never share a working tree (SP-5).
  registerWorktreeCommands(context, { launcher });

  // Board orchestrator (SP-tgs8nz_SL-1): dispatch a Spec's next Ready slice to a
  // `claude -p` worker in its worktree. Consumes the (async-built) ownership arbiter
  // via a getter so it's read at invoke time.
  // Persist orchestrator session logs (the .jsonl the control-center float-out renders).
  initSessions(
    nodePath.join(context.globalStorageUri.fsPath, "orchestrator-sessions"),
  );
  registerOrchestrateCommands(context, {
    specsProvider,
    getArbiter: () => ownershipArbiter,
    launcher,
  });

  // Control-request watcher (SP-tgpwbm): the standalone Kanban MCP server can't
  // open a VS Code session itself, so its `start_spec_worktree` tool drops a
  // one-shot request file into the shared control dir; this watcher runs the
  // matching command (`thinkube.specs.startWorktree`) — the same filesystem
  // MCP→host channel the board uses, decoupled from the agent-teams tmux bridge.
  const controlWatcher = new ControlRequestWatcher(controlDir(context), (m) =>
    kanbanOutput.appendLine(`[thinkube] control: ${m}`),
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
 * window reload (SP-tgpwbm AC3).
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
