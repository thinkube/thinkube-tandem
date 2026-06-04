import * as vscode from "vscode";

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
import { getMethodologyRootOrUndefined } from "./github/workspaceRepo";
import { KanbanMcpProvider } from "./mcp/KanbanMcpProvider";
import { BundleInstaller } from "./methodology/BundleInstaller";
import { ClaudeConfigService } from "./services/ClaudeConfigService";
import { LauncherService } from "./services/LauncherService";
import { ThinkubeStore } from "./store/ThinkubeStore";
import { BundleTreeProvider } from "./views/sidebar/BundleTreeProvider";
import { ConfigTreeProvider } from "./views/sidebar/ConfigTreeProvider";
import { BoardNavigatorProvider } from "./views/boards/BoardNavigatorProvider";
import { registerBoardCommands } from "./commands/boards";

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

  // .thinkube/ file layer — rooted at the configured methodology folder
  // (thinkube.kanban.folder), NOT workspaceFolders[0]. If it isn't configured
  // yet we leave the store undefined and log; we do NOT fall back to a default
  // folder, because writing methodology files into the wrong repo is exactly
  // the failure that silent fallback caused before.
  const methodologyRoot = getMethodologyRootOrUndefined();
  const thinkubeStore = methodologyRoot
    ? new ThinkubeStore(methodologyRoot)
    : undefined;
  if (thinkubeStore) {
    context.subscriptions.push(thinkubeStore);
    thinkubeStore.activate();
    kanbanOutput.appendLine(
      `[thinkube] .thinkube store rooted at ${methodologyRoot}`,
    );
  } else {
    kanbanOutput.appendLine(
      '[thinkube] .thinkube store not initialised: no methodology folder configured — run "Thinkube Kanban: Configure Project".',
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

  // Refresh the Project view when the configured repo changes: its setup
  // welcome and bundle-status node depend on whether a repo is configured.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("thinkube.kanban.folder")) {
        bundleTree.refresh();
      }
    }),
  );

  // Per-repo board navigator (ADR-0006): discover every repo's .thinkube/ board
  // across the open workspace folders; open enabled ones, enable disabled ones.
  const boardNavigator = new BoardNavigatorProvider();
  context.subscriptions.push(
    vscode.window.createTreeView("thinkubeBoards", {
      treeDataProvider: boardNavigator,
    }),
  );
  registerBoardCommands(context, {
    extensionUri: context.extensionUri,
    output: kanbanOutput,
    provider: boardNavigator,
  });
}

export function deactivate() {
  // Clean up if needed
}
