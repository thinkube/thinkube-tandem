/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space end to end — signing starts the run, accepting merges on
 * the project's forge — and every webview action is a registered
 * affordance.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { TandemSession } from "./surfaces/session";
import { SpacePanel, SpaceViewProvider } from "./surfaces/panel";
import { Forge, forgeFor } from "./dispatch/forge";
import { StoreSyncService } from "./engine/StoreSyncService";
import { ClaudeConfigService } from "./engine/host/ClaudeConfigService";
import { ConfigTreeProvider } from "./engine/host/ConfigTreeProvider";
import { registerConfigCommands } from "./engine/host/configCommands";
import {
  getCurrentActiveContext,
  initActiveContext,
  updateActiveContext,
  updateConfigContext,
} from "./engine/host/active";
import { parseDefectLog } from "./engine/defectStats";
import * as nodeFs from "node:fs";

let panel: SpacePanel | undefined;
let sideView: SpaceViewProvider | undefined;
let storeSync: StoreSyncService | undefined;

function gitAuthor(repoRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "config", "user.name"],
      { encoding: "utf8" },
      (err, stdout) => resolve(err ? "user" : stdout.trim().replace(/\s+/g, "-").toLowerCase() || "user"),
    );
  });
}

function gitRemote(repoRoot: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "remote", "get-url", "origin"],
      { encoding: "utf8" },
      (err, stdout) => resolve(err ? undefined : stdout.trim()),
    );
  });
}

async function resolveForge(
  repoRoot: string,
  giteaToken: string,
): Promise<Forge | undefined> {
  const remote = await gitRemote(repoRoot);
  if (!remote) return undefined;
  try {
    return forgeFor(remote, {
      giteaToken: giteaToken || undefined,
      http: async (method, url, token, payload) => {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
        return res.json();
      },
    });
  } catch {
    return undefined;
  }
}

/** Retire a merged TEP's worktrees (code, tester snapshot, oracle runners) —
 *  best-effort: a missing tree is a no-op, the accept never fails on cleanup. */
async function retireTepWorktrees(repoRoot: string, tepId: string): Promise<void> {
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve) =>
      execFile("git", ["-C", repoRoot, ...args], { encoding: "utf8" }, (_e, out) =>
        resolve(out ?? ""),
      ),
    );
  const wtRoot = path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-worktrees`,
  );
  const listed = await run(["worktree", "list", "--porcelain"]);
  const targets = listed
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter(
      (p) =>
        p === path.join(wtRoot, tepId) ||
        p === path.join(wtRoot, `${tepId}-tester`) ||
        p.startsWith(path.join(wtRoot, "oracle-runners", `${tepId}-`)),
    );
  for (const t of targets) await run(["worktree", "remove", "--force", t]);
  await run(["worktree", "prune"]);
}

/**
 * The active repository is an explicit choice, never a positional accident:
 * a remembered pick, else the single workspace folder, else the human
 * chooses. One session per repository; the store namespaces by repo name.
 */
const sessions = new Map<string, TandemSession>();
let statusBar: vscode.StatusBarItem | undefined;

function rememberedRepo(context: vscode.ExtensionContext): string | undefined {
  const saved = context.workspaceState.get<string>("tandem.activeRepo");
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (saved && folders.some((f) => f.uri.fsPath === saved)) return saved;
  if (folders.length === 1) return folders[0].uri.fsPath;
  return undefined;
}

async function chooseRepo(context: vscode.ExtensionContext): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return undefined;
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({
      label: f.name,
      description: f.uri.fsPath,
      path: f.uri.fsPath,
    })),
    { title: "Tandem — which project / repository are you working on?" },
  );
  if (!pick) return undefined;
  await context.workspaceState.update("tandem.activeRepo", pick.path);
  return pick.path;
}

function updateStatusBar(repoRoot: string | undefined): void {
  if (!statusBar) return;
  statusBar.text = repoRoot
    ? `$(repo) Tandem: ${path.basename(repoRoot)}`
    : "$(repo) Tandem: choose repo";
  statusBar.show();
}

function pushActive(context: vscode.ExtensionContext, message?: string): void {
  const repo = rememberedRepo(context);
  const s = repo ? sessions.get(repo) : undefined;
  if (!s) return;
  panel?.pushFrom(s, message);
  sideView?.pushFrom(s, message);
}

async function ensureSession(
  context: vscode.ExtensionContext,
  interactive = true,
): Promise<TandemSession | undefined> {
  let repoRoot = rememberedRepo(context);
  if (!repoRoot && interactive) repoRoot = await chooseRepo(context);
  if (!repoRoot) return undefined;
  updateStatusBar(repoRoot);
  const existing = sessions.get(repoRoot);
  if (existing) return existing;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot =
    config.get<string>("storeRoot", "") ||
    path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
  const spaceName = path.basename(repoRoot);
  const forge = await resolveForge(
    repoRoot,
    config.get<string>("giteaToken", ""),
  );
  const boundRepo = repoRoot;
  const s = new TandemSession({
    round: {
      model: config.get<string>("groundingModel", "opus"),
      repoRoot,
    },
    storeDir: path.join(storeRoot, "spaces", spaceName),
    storageDir: context.globalStorageUri.fsPath,
    now: () => new Date().toISOString(),
    author: await gitAuthor(repoRoot),
    forge,
    suiteCommand: config
      .get<string>("suiteCommand", "npm test")
      .split(" ")
      .filter(Boolean),
    retire: (tepId) => retireTepWorktrees(boundRepo, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    onChanged: (message) => pushActive(context, message),
  });
  sessions.set(repoRoot, s);
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
  return s;
}

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBar.command = "thinkube-tandem.switchProject";
  statusBar.tooltip = "Switch the project / repository Tandem works on";
  updateStatusBar(rememberedRepo(context));
  context.subscriptions.push(statusBar);

  // The Configuration area (v1, verbatim): hooks / commands / skills /
  // agents / MCP / permissions / plugins per scope, in the same container.
  const seedPath =
    rememberedRepo(context) ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    process.env.HOME ??
    "/";
  const configService = new ClaudeConfigService(seedPath);
  const configTree = new ConfigTreeProvider(configService);
  const configView = vscode.window.createTreeView("claudeConfigTree", {
    treeDataProvider: configTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(configView);
  initActiveContext({ configService, treeProvider: configTree, statusBarItem: statusBar });
  configService.onConfigChanged(() => {
    void updateConfigContext();
  });
  void updateActiveContext(rememberedRepo(context));
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      void updateActiveContext();
    }),
  );
  registerConfigCommands(context, {
    configService,
    treeProvider: configTree,
    getCurrentActiveContext,
    updateActiveContext,
    updateConfigContext,
  });

  const activeSession = (): TandemSession => {
    const repo = rememberedRepo(context);
    const s = repo ? sessions.get(repo) : undefined;
    if (!s) throw new Error("no active Tandem session — open the space first");
    return s;
  };
  const hooks = {
    onSwitchRepo: async () => {
      await vscode.commands.executeCommand("thinkube-tandem.switchProject");
    },
  };
  sideView = new SpaceViewProvider(
    context.extensionUri,
    (interactive) => ensureSession(context, interactive),
    hooks,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("thinkubeTandemSpaceView", sideView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("thinkube-tandem.openSpace", async () => {
      const s = await ensureSession(context, true);
      if (!s) return;
      if (!panel) panel = new SpacePanel(activeSession, hooks);
      await panel.show(context.extensionUri);
    }),
    vscode.commands.registerCommand("thinkube-tandem.showDefects", async () => {
      const config = vscode.workspace.getConfiguration("thinkubeTandem");
      const storeRoot =
        config.get<string>("storeRoot", "") ||
        path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
      const repo = rememberedRepo(context);
      const dirs = repo
        ? [path.join(storeRoot, "spaces", path.basename(repo), "defects")]
        : [];
      const lines: string[] = ["# Tandem defects — find-time ledger", ""];
      let total = 0;
      for (const dir of dirs) {
        let files: string[] = [];
        try {
          files = nodeFs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }
        for (const f of files.sort().reverse()) {
          const { rows } = parseDefectLog(nodeFs.readFileSync(path.join(dir, f), "utf8"));
          if (!rows.length) continue;
          lines.push(`## ${f.replace(".jsonl", "")}`, "", "| when | TEP | slice | trigger | impact | detail |", "|---|---|---|---|---|---|");
          for (const r of rows) {
            total++;
            lines.push(
              `| ${(r.ts ?? "").slice(0, 16)} | ${r.spec ?? ""} | ${r.slice ?? ""} | ${r.trigger ?? ""} | ${r.impact ?? ""} | ${(r.detail ?? "").replace(/\|/g, "/").slice(0, 120)} |`,
            );
          }
          lines.push("");
        }
      }
      if (total === 0) lines.push("No defect rows recorded for this space yet.");
      const doc = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: lines.join("\n"),
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("thinkube-tandem.switchProject", async () => {
      const picked = await chooseRepo(context);
      if (!picked) return;
      await ensureSession(context, true);
      updateStatusBar(picked);
      pushActive(context, `Working on ${path.basename(picked)}.`);
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
  storeSync?.dispose();
}
