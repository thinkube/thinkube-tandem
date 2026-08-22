/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space end to end — signing starts the run, accepting merges on
 * the project's forge — and every webview action is a registered
 * affordance.
 */
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { TandemSession } from "./surfaces/session";
import { SpacePanel, vscodePanelHost } from "./surfaces/panel";
import { Forge, forgeFor } from "./dispatch/forge";
import { StoreSyncService } from "./engine/StoreSyncService";
import { createProduct, discoverProjects, EnabledProject, listProducts, setCardProduct } from "./core/identity";
import { ProductItem, ProjectsTreeProvider } from "./hostui/projectsTree";
import { SpaceTabs } from "./surfaces/spaceTabs";
import { deleteThinkingSpace, deletionCost, listThinkingSpaces, nextTepNumber, thinkingSpaceDirs } from "./core/spaces";
import { chooseThinkingSpace, configuredStoreRoot, registerSpaceCommands } from "./hostui/spaceOps";
import { chooseProject, newProjectFlow, retireTepWorktrees, sweepDeletedSpaceRuns } from "./hostui/projectOps";
import { placeCommands } from "./hostui/placeCommands";
import { editContextScope, ensureWorkSession, findWorkProject } from "./hostui/workSession";
import { createWorkProject, listWorkProjects, setWorkProjectState } from "./core/workProjects";
import { newAppGesture } from "./hostui/templateFlow";
import { ClaudeConfigService } from "./engine/host/ClaudeConfigService";
import { LauncherService } from "./engine/host/LauncherService";
import { SessionLinkService } from "./engine/host/SessionLinkService";
import { ConfigTreeProvider } from "./engine/host/ConfigTreeProvider";
import { registerConfigCommands } from "./engine/host/configCommands";
import {
  getCurrentActiveContext,
  initActiveContext,
  updateActiveContext,
  updateConfigContext,
} from "./engine/host/active";
import { parseDefectLog } from "./engine/defectStats";
import { AUTHOR_MISSING, currentAuthor } from "./core/author";

let projectsTree: ProjectsTreeProvider | undefined;
let storeSync: StoreSyncService | undefined;
const spaceTabs = new SpaceTabs();

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

async function resolveForge(repoRoot: string, giteaToken: string): Promise<Forge | undefined> {
  let remote = await gitRemote(repoRoot);
  if (!remote) return undefined;
  // A credentialed remote (https://user:token@host/…) is stripped for
  // parsing; the token doubles as the forge token when none is set.
  const creds = /^https?:\/\/([^/@:]+):([^/@]+)@/.exec(remote);
  if (creds) remote = remote.replace(`${creds[1]}:${creds[2]}@`, "");
  try {
    return forgeFor(remote, {
      giteaToken: giteaToken || creds?.[2] || undefined,
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

const sessions = new Map<string, TandemSession>();

function activeSession(context: vscode.ExtensionContext, project?: EnabledProject): TandemSession | undefined {
  const ownerKey = project?.card.id ?? activeOwnerKey(context);
  if (!ownerKey) return undefined;
  const slug = context.workspaceState.get<string>(`tandem.space.${ownerKey}`);
  return slug ? sessions.get(`${ownerKey}/${slug}`) : undefined;
}
let statusBar: vscode.StatusBarItem | undefined;

function openProjects(): EnabledProject[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const seen = new Map<string, EnabledProject>();
  for (const f of folders)
    for (const p of discoverProjects(f.uri.fsPath))
      if (!seen.has(p.card.id)) seen.set(p.card.id, p);
  return [...seen.values()];
}

function activeOwnerKey(context: vscode.ExtensionContext): string | undefined {
  const saved = context.workspaceState.get<string>("tandem.activeProject");
  if (saved?.startsWith("wp:")) return saved;
  return rememberedProject(context)?.card.id;
}

function rememberedProject(context: vscode.ExtensionContext): EnabledProject | undefined {
  const open = openProjects();
  const saved = context.workspaceState.get<string>("tandem.activeProject");
  if (saved?.startsWith("wp:")) return undefined;
  const hit = saved ? open.find((p) => p.card.id === saved) : undefined;
  if (hit) return hit;
  if (open.length === 1) return open[0];
  return undefined;
}

function updateStatusBar(project: EnabledProject | undefined): void {
  if (!statusBar) return;
  statusBar.text = project
    ? `$(repo) Tandem: ${project.card.product ? `${project.card.product} / ` : ""}${project.card.label}`
    : "$(repo) Tandem: choose a repository";
  statusBar.show();
}

const storeRootOf = configuredStoreRoot;

function heartbeat(context: vscode.ExtensionContext): void {
  if (!statusBar) return;
  const project = rememberedProject(context);
  const s = activeSession(context);
  if (s?.running && s.runState) {
    const v = s.runState.view();
    const done = v.units.filter((u) => u.state === "done").length;
    if (v.parked.length) {
      statusBar.text = `$(warning) Tandem: a worker needs your answer`;
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      statusBar.text = `$(sync~spin) Tandem: building — ${done}/${v.units.length} units`;
      statusBar.backgroundColor = undefined;
    }
    statusBar.show();
    return;
  }
  const grounding = s?.groundingView() ?? [];
  if (grounding.length) {
    const running = grounding.filter((g) => g.label !== "waiting").length;
    statusBar.text = `$(sync~spin) Tandem: thinking about ${running} of ${grounding.length} asks`;
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  if (s?.activity) {
    statusBar.text = `$(sync~spin) Tandem: ${s.activity.label}… (${s.activity.current}/${s.activity.total})`;
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  statusBar.backgroundColor = undefined;
  updateStatusBar(project);
}

function pushActive(context: vscode.ExtensionContext, message?: string): void {
  heartbeat(context);
  const ownerKey = activeOwnerKey(context);
  const slug = ownerKey
    ? context.workspaceState.get<string>(`tandem.space.${ownerKey}`)
    : undefined;
  const s = ownerKey && slug ? sessions.get(`${ownerKey}/${slug}`) : undefined;
  if (!s) return;
  // The update belongs to the tab holding THIS space, not to whichever
  // tab happened to be opened first.
  spaceTabs.push(`${ownerKey}/${slug}`, (tab) => (tab as SpacePanel).pushFrom(message));
  if (message?.startsWith("Delivery ready"))
    void vscode.window
      .showInformationMessage(`Tandem — ${message}`, "Open the space")
      .then((pick) => {
        if (pick) void vscode.commands.executeCommand("thinkube-tandem.openSpace");
      });
  else if (message?.startsWith("The run refused"))
    void vscode.window.showWarningMessage(`Tandem — ${message}`);
}

/**
 * Resolve which thinking space the human means and build (or reuse) its
 * session, handing back the owner-and-slug key beside it — so the caller
 * addresses a tab register with the key THIS act resolved, never a
 * remembered active slug.
 */
async function ensureSession(context: vscode.ExtensionContext, interactive = true): Promise<{ key: string; session: TandemSession } | undefined> {
  const savedOwner = context.workspaceState.get<string>("tandem.activeProject") ?? "";
  // No identity, no records: writing under a name every installation
  // shares would silently overwrite the other person's whole space.
  const author = currentAuthor();
  if (!author) {
    if (interactive) void vscode.window.showErrorMessage(`Tandem — ${AUTHOR_MISSING}`);
    return undefined;
  }
  if (savedOwner.startsWith("wp:")) {
    if (!storeSync) {
      storeSync = new StoreSyncService(configuredStoreRoot(), (l) => console.log(l));
      storeSync.start();
    }
    return ensureWorkSession({
      context,
      ownerKey: savedOwner,
      interactive,
      storeRoot: configuredStoreRoot(),
      sessions,
      chooseSpace: (k, i) => chooseThinkingSpace(context, k, i),
      author,
      resolveForge: (root) =>
        resolveForge(root, vscode.workspace.getConfiguration("thinkubeTandem").get<string>("giteaToken", "")),
      openRepos: openProjects,
      onChanged: (message) => pushActive(context, message),
      storageDir: context.globalStorageUri.fsPath,
    });
  }
  let project = rememberedProject(context);
  if (!project && interactive) project = await chooseProject(context, openProjects);
  if (!project) return undefined;
  updateStatusBar(project);
  const spaceSlug = await chooseThinkingSpace(context, project.card.id, interactive);
  if (!spaceSlug) return undefined;
  const sessionKey = `${project.card.id}/${spaceSlug}`;
  const existing = sessions.get(sessionKey);
  if (existing) return { key: sessionKey, session: existing };
  const spaceName =
    listThinkingSpaces(storeRootOf(), project.card.id).find((s) => s.slug === spaceSlug)
      ?.label ?? spaceSlug;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot = configuredStoreRoot();
  const forge = await resolveForge(project.gitRoot, config.get<string>("giteaToken", ""));
  const bound = project;
  const s = new TandemSession({
    round: {
      model: config.get<string>("groundingModel", "opus"),
      volumeModel: config.get<string>("volumeModel", "sonnet"),
      // Grounding reads the ANCHOR scope — the subtree for a monorepo
      // sub-project, the repo root otherwise.
      repoRoot: project.anchorDir,
    },
    // The store is keyed by minted identity, then by THINKING SPACE
    // (Amendment 1), per-user append-scoped — never by a folder spelling.
    storeDir: thinkingSpaceDirs(storeRoot, project.card.id, spaceSlug, author).storeDir,
    projectDir: thinkingSpaceDirs(storeRoot, project.card.id, spaceSlug, author).foldDir,
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
    suiteCommand: config.get<string>("suiteCommand", "npm test").split(" ").filter(Boolean),
    prepareCommand: config.get<string>("prepareCommand", ""),
    retire: (tepId) => retireTepWorktrees(bound.gitRoot, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    nextTepNumber: () => nextTepNumber(storeRoot, project.card.id, author),
    onChanged: (message) => pushActive(context, message),
    spaceName,
  });
  sessions.set(sessionKey, s);
  // Units loaded unnamed (or renamed past their render) get titles at open,
  // not only after the next act.
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
  return { key: sessionKey, session: s };
}

export function activate(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBar.command = "thinkube-tandem.switchProject";
  statusBar.tooltip = "Switch the repository or project Tandem works on";
  updateStatusBar(rememberedProject(context));
  context.subscriptions.push(statusBar);

  // The Claude launcher (v1, verbatim): registers the cwd-patching wrapper
  // under claudeCode.claudeProcessWrapper — through the version-stable
  // extension-current symlink, so extension updates and the deploy script's
  // stale-version pruning never orphan the setting — and mirrors
  // launcher-created sessions into the Session History picker.
  const sessionLinks = new SessionLinkService(context);
  sessionLinks.activate();
  context.subscriptions.push(sessionLinks);
  const launcher = new LauncherService(context, sessionLinks);
  context.subscriptions.push(launcher);
  launcher.activate().catch((err) => {
    console.error("LauncherService activation failed:", err);
  });

  // The sidebar NAVIGATES; the editor WORKS (the v1 shell rule): the
  // Projects tree + Configuration tree live in the container, the space is
  // an editor tab. Products first — a repository is born under its product.
  projectsTree = new ProjectsTreeProvider(
    () => listProducts(storeRootOf(), openProjects()),
    openProjects,
    () => activeOwnerKey(context),
    (ownerId, kind) => listThinkingSpaces(configuredStoreRoot(), ownerId, kind),
    (ownerKey) => context.workspaceState.get<string>(`tandem.space.${ownerKey}`),
    () => listWorkProjects(configuredStoreRoot()),
    (key) => spaceTabs.isOpen(key),
  );
  context.subscriptions.push(
    vscode.window.createTreeView("tandemProjects", {
      treeDataProvider: projectsTree,
      showCollapseAll: true,
    }),
  );

  // The Configuration area (v1, verbatim).
  // §7bis: never the first workspace folder — the remembered identity,
  // else the user's home (a neutral seed until a repository is chosen).
  const seedPath = rememberedProject(context)?.gitRoot ?? process.env.HOME ?? "/";
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

  const hooks = {
    onSwitchRepo: async () => {
      await vscode.commands.executeCommand("thinkube-tandem.switchProject");
    },
  };
  const openSpaceFor = async (projectId?: string): Promise<void> => {
    if (projectId) await context.workspaceState.update("tandem.activeProject", projectId);
    const resolved = await ensureSession(context, true);
    if (!resolved) return;
    const { key, session: s } = resolved;
    updateStatusBar(rememberedProject(context));
    // One tab per space key: an already-open space is revealed, a new one
    // is built and registered, and a tab the human closed drops out of the
    // register so the tree stops marking that space open.
    const tab = spaceTabs.open(
      key,
      () =>
        new SpacePanel(
          key,
          s,
          vscodePanelHost(context.extensionUri),
          { ...hooks, onClosed: () => projectsTree?.refresh() },
          context.extensionUri,
        ),
    );
    await (tab as SpacePanel).show();
    projectsTree?.refresh();
    pushActive(context);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube-ai.claude.openHere", (uri?: vscode.Uri) =>
      launcher.openHere(uri),
    ),
    vscode.commands.registerCommand("thinkube-tandem.openSpace", () => openSpaceFor()),
    vscode.commands.registerCommand("thinkube-tandem.activateProject", (id: string) =>
      openSpaceFor(id),
    ),
    // The v1 gestures (open / create / delete a thinking space) — spaceOps.
    ...registerSpaceCommands(context, {
      openSpaceFor,
      refreshTree: () => projectsTree?.refresh(),
      dropSession: (key) => void sessions.delete(key),
      deleteSpace: deleteThinkingSpace,
      costOfDeleting: deletionCost,
      sweepResidue: (ownerKey, cost) => sweepDeletedSpaceRuns(openProjects, ownerKey, cost),
    }),
    vscode.commands.registerCommand("thinkube-tandem.refreshProjects", () =>
      projectsTree?.refresh(),
    ),
    vscode.commands.registerCommand("thinkube-tandem.newProduct", async () => {
      const name = await vscode.window.showInputBox({
        title: "New Product — the top-level grouping (e.g. KubeXlat)",
        placeHolder: "product name",
      });
      if (!name?.trim()) return;
      const r = createProduct(storeRootOf(), name);
      if (!r.ok) {
        void vscode.window.showErrorMessage(`Tandem: ${r.reason}`);
        return;
      }
      projectsTree?.refresh();
    }),
    vscode.commands.registerCommand(
      "thinkube-tandem.newProject",
      async (node?: ProductItem) => {
        let product = node?.product;
        if (!product || product === "(unassigned)") {
          const names = listProducts(storeRootOf(), openProjects());
          if (names.length === 0) {
            void vscode.window.showErrorMessage(
              "Tandem: create a Product first (the + on the Projects view title).",
            );
            return;
          }
          product = await vscode.window.showQuickPick(names, {
            title: "New Repository — under which product?",
          });
          if (!product) return;
        }
        const kind = await vscode.window.showQuickPick(
          [
            { label: "Enable a repository", description: "an existing folder in the open workspace", k: "repo" },
            { label: "New project", description: "work that may touch several repositories — no code of its own", k: "work" },
            { label: "New application from a template", description: "the platform instantiates it (Gitea + CI); thinking grounds in the real code", k: "app" },
          ],
          { title: `New under ${product}` },
        );
        if (!kind) return;
        if (kind.k === "repo") {
          await newProjectFlow(product, openProjects, () => projectsTree?.refresh());
          return;
        }
        if (kind.k === "app") {
          const owner = activeOwnerKey(context);
          const slug = owner ? context.workspaceState.get<string>(`tandem.space.${owner}`) : undefined;
          await newAppGesture({
            product,
            storeRoot: configuredStoreRoot(),
            ...(owner ? { ownerKey: owner } : {}),
            ...(slug ? { activeSlug: slug } : {}),
            refresh: () => projectsTree?.refresh(),
            activate: (cardId) => openSpaceFor(cardId),
          });
          return;
        }
        const name = await vscode.window.showInputBox({
          title: `Name the project under ${product}`,
          placeHolder: "e.g. plugin delivery — a bounded piece of work, open until done",
        });
        if (!name?.trim()) return;
        const made = createWorkProject(configuredStoreRoot(), product, name);
        if (!made.ok) {
          void vscode.window.showErrorMessage(`Tandem: ${made.reason}`);
          return;
        }
        projectsTree?.refresh();
        await openSpaceFor(`wp:${made.project.id}`);
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.toggleProjectDone",
      (node?: { wp?: { id: string; state: string } }) => {
        if (!node?.wp) return;
        const r = setWorkProjectState(
          configuredStoreRoot(),
          node.wp.id,
          node.wp.state === "done" ? "open" : "done",
        );
        if (!r.ok) void vscode.window.showWarningMessage(`Tandem — ${r.reason}`);
        projectsTree?.refresh();
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.setContextScope",
      async (node?: { id?: string }) => {
        const [ownerKey, slug] = (node?.id ?? "").split("/");
        if (!ownerKey?.startsWith("wp:") || !slug) return;
        const wp = findWorkProject(configuredStoreRoot(), ownerKey.slice(3));
        if (!wp) return;
        await editContextScope(configuredStoreRoot(), wp, slug, openProjects());
      },
    ),
    vscode.commands.registerCommand(
      "thinkube-tandem.setProduct",
      async (node?: { project?: EnabledProject }) => {
        const project =
          node?.project ??
          openProjects().find((p) => p.card.id === rememberedProject(context)?.card.id);
        if (!project) return;
        const names = listProducts(storeRootOf(), openProjects());
        const pick = await vscode.window.showQuickPick(
          [...names.map((n) => ({ label: n })), { label: "$(add) New product…" }],
          { title: `Which product does “${project.card.label}” belong to?` },
        );
        if (!pick) return;
        let product = pick.label;
        if (product.startsWith("$(add)")) {
          const typed = await vscode.window.showInputBox({ title: "New product name" });
          if (!typed?.trim()) return;
          createProduct(storeRootOf(), typed);
          product = typed.trim();
        }
        const r = setCardProduct(project.anchorDir, product);
        if (!r.ok) void vscode.window.showErrorMessage(`Tandem: ${r.reason}`);
        projectsTree?.refresh();
      },
    ),
    ...placeCommands({ context, openProjects, openSpaceFor, rememberedProject, currentAuthor }),
  );
}

export function deactivate(): void {
  spaceTabs.dispose();
  storeSync?.dispose();
}
