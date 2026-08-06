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
import {
  discoverProjects,
  EnabledProject,
  mintCard,
  scopesNotOpen,
} from "./core/identity";
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

/** Author identity is mechanical (§7ter): the git user.email localpart,
 *  never a typed display name. */
function gitAuthor(repoRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "config", "user.email"],
      { encoding: "utf8" },
      (err, stdout) => {
        const local = err ? "" : (stdout.trim().split("@")[0] ?? "");
        resolve(local.replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase() || "user");
      },
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
 * Projects, not folders (§7quater): the picker lists ENABLED projects —
 * identity cards discovered across the workspace, grouped by their product
 * label — plus enablement for folders without a card. The active project
 * is a remembered identity, never a positional accident.
 */
const sessions = new Map<string, TandemSession>();
let statusBar: vscode.StatusBarItem | undefined;

function openProjects(): EnabledProject[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const seen = new Map<string, EnabledProject>();
  for (const f of folders)
    for (const p of discoverProjects(f.uri.fsPath))
      if (!seen.has(p.card.id)) seen.set(p.card.id, p);
  return [...seen.values()];
}

function rememberedProject(context: vscode.ExtensionContext): EnabledProject | undefined {
  const open = openProjects();
  const saved = context.workspaceState.get<string>("tandem.activeProject");
  const hit = saved ? open.find((p) => p.card.id === saved) : undefined;
  if (hit) return hit;
  if (open.length === 1) return open[0];
  return undefined;
}

async function chooseProject(context: vscode.ExtensionContext): Promise<EnabledProject | undefined> {
  const open = openProjects();
  const folders = vscode.workspace.workspaceFolders ?? [];
  type Item = vscode.QuickPickItem & { project?: EnabledProject; enableDir?: string };
  const items: Item[] = [];
  const byProduct = new Map<string, EnabledProject[]>();
  for (const p of open) {
    const k = p.card.product ?? "";
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k)!.push(p);
  }
  for (const [product, ps] of [...byProduct.entries()].sort()) {
    if (product)
      items.push({ label: product, kind: vscode.QuickPickItemKind.Separator });
    for (const p of ps) {
      const missing = scopesNotOpen(p, open);
      items.push({
        label: p.card.label,
        description: p.prefix ? `${path.basename(p.gitRoot)}/${p.prefix}` : path.basename(p.gitRoot),
        detail: missing.length
          ? `⚠ scope(s) not open in this workspace: ${missing.map((s) => s.label ?? s.id ?? s.remote ?? "?").join(", ")}`
          : undefined,
        project: p,
      });
    }
  }
  const carded = new Set(open.map((p) => path.resolve(p.anchorDir)));
  const enableable = folders.filter((f) => !carded.has(path.resolve(f.uri.fsPath)));
  if (enableable.length) {
    items.push({ label: "Enable as a project", kind: vscode.QuickPickItemKind.Separator });
    for (const f of enableable)
      items.push({
        label: `$(add) Enable ${f.name}…`,
        description: f.uri.fsPath,
        enableDir: f.uri.fsPath,
      });
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: "Tandem — which project are you working on?",
  });
  if (!pick) return undefined;
  if (pick.enableDir) {
    const label = await vscode.window.showInputBox({
      title: "Project label (a name, never an identity)",
      value: path.basename(pick.enableDir),
    });
    if (!label) return undefined;
    const product = await vscode.window.showInputBox({
      title: "Product grouping label (optional — e.g. KubeXlat, Platform)",
      value: "",
    });
    const remote = await new Promise<string | undefined>((resolve) =>
      execFile(
        "git",
        ["-C", pick.enableDir!, "remote", "get-url", "origin"],
        { encoding: "utf8" },
        (err, out) => resolve(err ? undefined : out.trim()),
      ),
    );
    const minted = mintCard(pick.enableDir, {
      label,
      ...(product ? { product } : {}),
      ...(remote ? { remote } : {}),
    });
    if (!minted.ok) {
      void vscode.window.showErrorMessage(`Tandem: ${minted.reason}`);
      return undefined;
    }
    const enabled = openProjects().find((p) => p.card.id === minted.card.id);
    if (enabled) await context.workspaceState.update("tandem.activeProject", enabled.card.id);
    return enabled;
  }
  await context.workspaceState.update("tandem.activeProject", pick.project!.card.id);
  return pick.project;
}

function updateStatusBar(project: EnabledProject | undefined): void {
  if (!statusBar) return;
  statusBar.text = project
    ? `$(repo) Tandem: ${project.card.product ? `${project.card.product} / ` : ""}${project.card.label}`
    : "$(repo) Tandem: choose project";
  statusBar.show();
}

function pushActive(context: vscode.ExtensionContext, message?: string): void {
  const project = rememberedProject(context);
  const s = project ? sessions.get(project.card.id) : undefined;
  if (!s) return;
  panel?.pushFrom(s, message);
  sideView?.pushFrom(s, message);
}

async function ensureSession(
  context: vscode.ExtensionContext,
  interactive = true,
): Promise<TandemSession | undefined> {
  let project = rememberedProject(context);
  if (!project && interactive) project = await chooseProject(context);
  if (!project) return undefined;
  updateStatusBar(project);
  const existing = sessions.get(project.card.id);
  if (existing) return existing;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot =
    config.get<string>("storeRoot", "") ||
    path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
  const forge = await resolveForge(
    project.gitRoot,
    config.get<string>("giteaToken", ""),
  );
  const author = await gitAuthor(project.gitRoot);
  const bound = project;
  const s = new TandemSession({
    round: {
      model: config.get<string>("groundingModel", "opus"),
      // Grounding reads the ANCHOR scope — the subtree for a monorepo
      // sub-project, the repo root otherwise.
      repoRoot: project.anchorDir,
    },
    // The store is keyed by minted identity, per-user append-scoped
    // (§7ter / multi-user provision) — never by a folder spelling.
    storeDir: path.join(storeRoot, "spaces", project.card.id, author),
    projectDir: path.join(storeRoot, "spaces", project.card.id),
    storageDir: context.globalStorageUri.fsPath,
    now: () => new Date().toISOString(),
    author,
    forge,
    scope: {
      gitRoot: project.gitRoot,
      prefix: project.prefix,
      projectId: project.card.id,
      label: project.card.product
        ? `${project.card.product} / ${project.card.label}`
        : project.card.label,
    },
    suiteCommand: config
      .get<string>("suiteCommand", "npm test")
      .split(" ")
      .filter(Boolean),
    retire: (tepId) => retireTepWorktrees(bound.gitRoot, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    onChanged: (message) => pushActive(context, message),
  });
  sessions.set(project.card.id, s);
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
  updateStatusBar(rememberedProject(context));
  context.subscriptions.push(statusBar);

  // The Configuration area (v1, verbatim): hooks / commands / skills /
  // agents / MCP / permissions / plugins per scope, in the same container.
  const seedPath =
    rememberedProject(context)?.gitRoot ??
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
  void updateActiveContext(rememberedProject(context)?.gitRoot);
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
    const project = rememberedProject(context);
    const s = project ? sessions.get(project.card.id) : undefined;
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
    vscode.commands.registerCommand("thinkube-tandem.openDocs", async () => {
      const pagesDir = vscode.Uri.joinPath(
        context.extensionUri,
        "docs",
        "modules",
        "ROOT",
        "pages",
      );
      const pages: { label: string; file: string }[] = [
        { label: "What Tandem is", file: "index.adoc" },
        { label: "Getting started", file: "getting-started.adoc" },
        { label: "The space — asks, changes, units", file: "the-space.adoc" },
        { label: "The two gates", file: "gates.adoc" },
        { label: "The run and the orchestration graph", file: "the-run.adoc" },
        { label: "Configuration and settings", file: "configuration.adoc" },
        { label: "The store", file: "store.adoc" },
        { label: "The defect ledger", file: "defects.adoc" },
        { label: "When something goes wrong", file: "troubleshooting.adoc" },
      ];
      const pick = await vscode.window.showQuickPick(pages, {
        title: "Tandem documentation",
      });
      if (!pick) return;
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(pagesDir, pick.file),
      );
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand("thinkube-tandem.showDefects", async () => {
      const config = vscode.workspace.getConfiguration("thinkubeTandem");
      const storeRoot =
        config.get<string>("storeRoot", "") ||
        path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
      const project = rememberedProject(context);
      const author = project ? await gitAuthor(project.gitRoot) : "user";
      const dirs = project
        ? [path.join(storeRoot, "spaces", project.card.id, author, "defects")]
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
      const picked = await chooseProject(context);
      if (!picked) return;
      await ensureSession(context, true);
      updateStatusBar(picked);
      pushActive(context, `Working on ${picked.card.label}.`);
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
  storeSync?.dispose();
}
