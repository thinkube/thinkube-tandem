/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space end to end — signing starts the run, accepting merges on
 * the project's forge — and every webview action is a registered
 * affordance.
 */
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { TandemSession } from "./surfaces/session";
import { SpacePanel } from "./surfaces/panel";
import { SpaceTabs } from "./surfaces/panels";
import { spacePush } from "./surfaces/push";
import { Forge, forgeFor } from "./dispatch/forge";
import { StoreSyncService } from "./engine/StoreSyncService";
import { appendDefect } from "./engine/defectLog";
import {
  createProduct,
  discoverProjects,
  EnabledProject,
  listProducts,
  setCardProduct,
} from "./core/identity";
import { ProductItem, ProjectsTreeProvider } from "./hostui/projectsTree";
import { deleteThinkingSpace, deletionCost, listThinkingSpaces, nextTepNumber, spaceLabel, thinkingSpaceDirs } from "./core/spaces";
import {
  chooseThinkingSpace,
  configuredStoreRoot,
  registerSpaceCommands,
} from "./hostui/spaceOps";
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
import { AUTHOR_MISSING, currentAuthor } from "./core/author";

// One editor tab per open thinking space, keyed by "<ownerId>/<slug>" —
// never a single module-level panel standing in for whichever space was
// opened last.
let tabs: SpaceTabs | undefined;
let projectsTree: ProjectsTreeProvider | undefined;
let storeSync: StoreSyncService | undefined;
// Set once at activation — pushChanged is fixed to (sessionKey, message?)
// by the shared contract, so the extension context it needs for the status
// bar comes from here rather than a parameter.
let extContext: vscode.ExtensionContext | undefined;

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

/**
 * The status line reports EVERY session's activity, not only the active
 * one's — several spaces can be building at once, each in its own tab.
 * A worker parked on a question always wins the line (it needs a person),
 * then the count of sessions still building, then the count still
 * grounding/asking, so nothing is hidden behind whichever space happened
 * to be opened last.
 */
function heartbeat(context: vscode.ExtensionContext): void {
  if (!statusBar) return;
  const project = rememberedProject(context);
  const all = [...sessions.values()];
  const parked = all.filter((s) => s.running && s.runState && s.runState.view().parked.length);
  if (parked.length) {
    statusBar.text =
      parked.length === 1
        ? `$(warning) Tandem: a worker needs your answer`
        : `$(warning) Tandem: ${parked.length} workers need your answer`;
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    statusBar.show();
    return;
  }
  const building = all.filter((s) => s.running && s.runState);
  if (building.length) {
    if (building.length === 1) {
      const v = building[0].runState!.view();
      const done = v.units.filter((u) => u.state === "done").length;
      statusBar.text = `$(sync~spin) Tandem: building — ${done}/${v.units.length} units`;
    } else {
      statusBar.text = `$(sync~spin) Tandem: building — ${building.length} spaces`;
    }
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  const grounding = all.filter((s) => s.groundingView().length > 0);
  if (grounding.length) {
    if (grounding.length === 1) {
      const g = grounding[0].groundingView();
      const running = g.filter((row) => row.label !== "waiting").length;
      statusBar.text = `$(sync~spin) Tandem: thinking about ${running} of ${g.length} asks`;
    } else {
      statusBar.text = `$(sync~spin) Tandem: thinking — ${grounding.length} spaces`;
    }
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  const busy = all.filter((s) => s.activity);
  if (busy.length) {
    if (busy.length === 1) {
      const a = busy[0].activity!;
      statusBar.text = `$(sync~spin) Tandem: ${a.label}… (${a.current}/${a.total})`;
    } else {
      statusBar.text = `$(sync~spin) Tandem: working — ${busy.length} spaces`;
    }
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  statusBar.backgroundColor = undefined;
  updateStatusBar(project);
}

/** Split "<ownerId>/<slug>" into its parts; a work-project owner key keeps
 *  its "wp:" prefix as part of ownerId. */
function splitSessionKey(sessionKey: string): { ownerId: string; slug: string } {
  const i = sessionKey.lastIndexOf("/");
  return { ownerId: sessionKey.slice(0, i), slug: sessionKey.slice(i + 1) };
}

function labelForSessionKey(sessionKey: string): string {
  const { ownerId, slug } = splitSessionKey(sessionKey);
  const kind = ownerId.startsWith("wp:") ? "project" : "repository";
  const id = ownerId.startsWith("wp:") ? ownerId.slice(3) : ownerId;
  return spaceLabel(configuredStoreRoot(), id, slug, kind);
}

/** The one entry point every session's onChanged calls, named by that
 *  session's OWN key — never "the active session". Pushes only to that
 *  key's tab (a no-op if the space has no open tab) and, for a
 *  delivery-ready notice, names that space and targets its own tab. */
function pushChanged(sessionKey: string, message?: string): void {
  if (extContext) heartbeat(extContext);
  const s = sessions.get(sessionKey);
  if (s) tabs?.pushTo(sessionKey, spacePush(s, message));
  if (message?.startsWith("Delivery ready")) {
    const label = labelForSessionKey(sessionKey);
    void vscode.window
      .showInformationMessage(`Tandem — ${label}: ${message}`, "Open the space")
      .then((pick) => {
        if (!pick) return;
        const { ownerId, slug } = splitSessionKey(sessionKey);
        void vscode.commands.executeCommand("thinkube-tandem.openThinkingSpace", ownerId, slug);
      });
  } else if (message?.startsWith("The run refused"))
    void vscode.window.showWarningMessage(`Tandem — ${message}`);
}

async function ensureSession(
  context: vscode.ExtensionContext,
  interactive = true,
): Promise<TandemSession | undefined> {
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
    // ensureWorkSession resolves the space's own slug and registers the
    // session into `sessions` under its key before onChanged can ever
    // fire, so the key is found by identity (never "the active one") at
    // call time rather than threaded through as an extra parameter.
    const keyOf = (s: TandemSession): string | undefined => {
      for (const [k, v] of sessions) if (v === s) return k;
      return undefined;
    };
    let onChangedSession: TandemSession | undefined;
    const s = await ensureWorkSession({
      context,
      ownerKey: savedOwner,
      interactive,
      storeRoot: configuredStoreRoot(),
      sessions,
      chooseSpace: (k, i) => chooseThinkingSpace(context, k, i),
      author,
      resolveForge: (root) =>
        resolveForge(
          root,
          vscode.workspace.getConfiguration("thinkubeTandem").get<string>("giteaToken", ""),
        ),
      openRepos: openProjects,
      onChanged: (message) => {
        const key = onChangedSession && keyOf(onChangedSession);
        if (key) pushChanged(key, message);
      },
      storageDir: context.globalStorageUri.fsPath,
    });
    onChangedSession = s;
    return s;
  }
  let project = rememberedProject(context);
  if (!project && interactive) project = await chooseProject(context, openProjects);
  if (!project) return undefined;
  updateStatusBar(project);
  const spaceSlug = await chooseThinkingSpace(context, project.card.id, interactive);
  if (!spaceSlug) return undefined;
  const sessionKey = `${project.card.id}/${spaceSlug}`;
  const existing = sessions.get(sessionKey);
  if (existing) return existing;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot = configuredStoreRoot();
  const forge = await resolveForge(
    project.gitRoot,
    config.get<string>("giteaToken", ""),
  );
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
    suiteCommand: config
      .get<string>("suiteCommand", "npm test")
      .split(" ")
      .filter(Boolean),
    prepareCommand: config.get<string>("prepareCommand", ""),
    retire: (tepId) => retireTepWorktrees(bound.gitRoot, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    nextTepNumber: () => nextTepNumber(storeRoot, project.card.id, author),
    onChanged: (message) => pushChanged(sessionKey, message),
  });
  sessions.set(sessionKey, s);
  // Units loaded unnamed (or renamed past their render) get titles at open,
  // not only after the next act.
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
  return s;
}

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
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
    (ownerKey, slug) => (tabs?.keys() ?? []).includes(`${ownerKey}/${slug}`),
    () => listWorkProjects(configuredStoreRoot()),
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
  // Every open thinking space gets its own tab, titled with that space's
  // own name — never one module-level panel standing in for whichever
  // space was opened last.
  tabs = new SpaceTabs((key) => {
    const s = sessions.get(key);
    if (!s) throw new Error(`Tandem — no session for thinking space "${key}"`);
    return new SpacePanel(s, labelForSessionKey(key), hooks);
  });
  const openSpaceFor = async (projectId?: string): Promise<void> => {
    if (projectId) await context.workspaceState.update("tandem.activeProject", projectId);
    const s = await ensureSession(context, true);
    if (!s) return;
    updateStatusBar(rememberedProject(context));
    const ownerKey = activeOwnerKey(context);
    const slug = ownerKey ? context.workspaceState.get<string>(`tandem.space.${ownerKey}`) : undefined;
    if (!ownerKey || !slug) return;
    const sessionKey = `${ownerKey}/${slug}`;
    projectsTree?.refresh();
    // SpaceTab (the registry's own vocabulary) has no show(): only the real
    // host surface builds or reveals its webview. open() either returns a
    // fresh SpacePanel from the factory above or reveals an existing one;
    // either way it is the same SpacePanel type this extension constructs.
    const tab = tabs!.open(sessionKey, labelForSessionKey(sessionKey)) as SpacePanel;
    await tab.show(context.extensionUri);
    pushChanged(sessionKey);
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
  // A run lives in this process. When the window reloads, the run dies
  // with it — and a death nobody wrote down looks exactly like a run that
  // is still going. Every in-flight run says so, in its own log and in the
  // ledger, before the process goes.
  for (const s of sessions.values())
    if (s.running && s.runState) {
      const open = [...s.runState.units.values()]
        .filter((u) => u.state !== "done" && u.state !== "failed" && u.state !== "blocked")
        .map((u) => `- ${u.id}: ${u.state}${u.activity ? ` — ${u.activity.text}` : ""}`)
        .join("\n");
      s.runState.log(
        `⛔ the editor window is closing or reloading — this run ends here, unfinished. What was still open:\n${open || "- nothing: the run was between units"}\nRun again resumes what was committed.`,
      );
      appendDefect(s.deps.storeDir, {
        spec: s.unrunCut()?.tepId ?? "run",
        activity: "run",
        trigger: "window-reload",
        type: "gate",
        impact: "run lost — the editor process ended",
        detail: open.slice(0, 1500),
      });
      s.runState.halt();
    }
  tabs?.disposeAll();
  storeSync?.dispose();
}
