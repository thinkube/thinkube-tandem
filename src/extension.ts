import * as vscode from "vscode";

import { registerBundleCommands } from "./commands/bundle";
import { registerConfigCommands } from "./commands/config";
import { registerKanbanCommands } from "./commands/kanban";
import { registerLauncherCommands } from "./commands/launcher";
import { registerRoadmapCommands } from "./commands/roadmap";
import {
  initActiveContext,
  getCurrentActiveContext,
  updateActiveContext,
  updateConfigContext,
} from "./context/active";
import { AuthService } from "./github/AuthService";
import { GitHubService } from "./github/GitHubService";
import { KanbanMcpProvider } from "./mcp/KanbanMcpProvider";
import { BundleInstaller } from "./methodology/BundleInstaller";
import { TasksMaterializer } from "./methodology/TasksMaterializer";
import { installTasksWatcher } from "./methodology/tasksWatcher";
import { ClaudeConfigService } from "./services/ClaudeConfigService";
import { LauncherService } from "./services/LauncherService";
import { ThinkubeStore } from "./store/ThinkubeStore";
import {
  RoadmapNode,
  RoadmapTreeProvider,
} from "./views/roadmap/RoadmapTreeProvider";
import { BundleTreeProvider } from "./views/sidebar/BundleTreeProvider";
import { ConfigTreeProvider } from "./views/sidebar/ConfigTreeProvider";

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

  // Launcher (process-wrapper) — activate async; openHere works even if the
  // wrapper config update is still in flight because the wrapper falls back
  // to its own dir for state.
  const launcher = new LauncherService(context);
  context.subscriptions.push(launcher);
  launcher.activate().catch((err) => {
    console.error("LauncherService activation failed:", err);
  });

  // GitHub stack (lazy auth — token only resolved on first kanban command).
  const auth = new AuthService(context);
  const github = new GitHubService(auth);
  const kanbanOutput = vscode.window.createOutputChannel("Thinkube Kanban");
  context.subscriptions.push(kanbanOutput);

  // .thinkube/ file layer — rooted at the first workspace folder (multi-root
  // ergonomics revisit in chunk 6 alongside roadmap/kanban panel scoping).
  // Tolerant of "no workspace open" — the store still constructs but its
  // watcher and writes will no-op against a non-existent root.
  const thinkubeStore = workspaceFolders?.[0]
    ? new ThinkubeStore(workspaceFolders[0].uri.fsPath)
    : undefined;
  if (thinkubeStore) {
    context.subscriptions.push(thinkubeStore);
    thinkubeStore.activate();
  }

  // Chunk-9 tasks materialiser — turns .thinkube/specs/SP-*-tasks.md rows
  // into GitHub Task issues + Projects v2 items. Watcher fires the toast
  // when a tasks file appears or changes with unchecked rows.
  const materializer = thinkubeStore
    ? new TasksMaterializer({
        github,
        store: thinkubeStore,
        output: kanbanOutput,
      })
    : undefined;
  if (thinkubeStore && materializer) {
    context.subscriptions.push(
      installTasksWatcher({
        store: thinkubeStore,
        materializer,
        output: kanbanOutput,
      }),
    );
  }

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
    store: thinkubeStore,
    extensionUri: context.extensionUri,
    materializer,
  });

  // MCP provider — exposes the kanban tools to any LLM client in this VS
  // Code instance. Survives no-workspace and no-repo gracefully (provider
  // returns an empty definitions list until both are configured).
  KanbanMcpProvider.install(context, {
    extensionUri: context.extensionUri,
    auth,
    output: kanbanOutput,
  });

  // Methodology bundle installer + tree view.
  const bundleInstaller = new BundleInstaller(context.extensionUri.fsPath);
  registerBundleCommands(context, {
    installer: bundleInstaller,
    output: kanbanOutput,
  });
  const bundleTree = new BundleTreeProvider(bundleInstaller, kanbanOutput);
  const bundleTreeView = vscode.window.createTreeView("thinkubeBundleTree", {
    treeDataProvider: bundleTree,
    showCollapseAll: false,
  });
  context.subscriptions.push(
    bundleTreeView,
    vscode.commands.registerCommand("thinkube.kanban.refreshBundleTree", () =>
      bundleTree.refresh(),
    ),
  );

  // Roadmap tree (Epic → Story → Spec) in the Thinkube Board activity-bar view.
  const roadmapProvider = new RoadmapTreeProvider(github, kanbanOutput);
  const roadmapView = vscode.window.createTreeView<RoadmapNode>(
    "thinkubeRoadmap",
    {
      treeDataProvider: roadmapProvider,
      showCollapseAll: true,
    },
  );
  context.subscriptions.push(roadmapView);

  // Shared deps for the CardDetailPanel — also passed to the wizards so the
  // newly-created issue can open straight into the detail view.
  const cardDetailDeps = {
    extensionUri: context.extensionUri,
    store: thinkubeStore,
    output: kanbanOutput,
    fetchIssue: (coords: { owner: string; name: string }, number: number) =>
      github.getIssue(coords, number),
    updateIssue: (
      coords: { owner: string; name: string },
      number: number,
      fields: { title?: string; body?: string },
    ) => github.updateIssue(coords, number, fields),
    countOpenChildren: async (
      coords: { owner: string; name: string },
      number: number,
    ) => {
      const children = await github.listSubIssues(coords, number);
      return children.filter((c) => c.state === "open").length;
    },
  };

  registerRoadmapCommands(context, {
    treeView: roadmapView,
    provider: roadmapProvider,
    output: kanbanOutput,
    github,
    store: thinkubeStore,
    cardDetail: cardDetailDeps,
  });

  // Track whether `thinkube.kanban.repo` is set so the viewsWelcome can swap
  // between the configure prompt and the populated tree. Initial sync + a
  // listener on settings changes; also refresh the tree when the repo flips.
  const syncRepoContext = () => {
    const raw = vscode.workspace
      .getConfiguration("thinkube.kanban")
      .get<string>("repo", "")
      .trim();
    const configured = raw.includes("/");
    vscode.commands.executeCommand(
      "setContext",
      "thinkube.roadmap.repoConfigured",
      configured,
    );
  };
  syncRepoContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("thinkube.kanban.repo")) {
        syncRepoContext();
        roadmapProvider.refresh();
        // Project view swaps between its setup welcome and the bundle status
        // node based on whether a repo is configured.
        bundleTree.refresh();
      }
    }),
  );
}

export function deactivate() {
  // Clean up if needed
}
