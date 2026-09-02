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
import { NoticeHost, notifyForSpace, SpacePanels } from "./surfaces/panels";
import { Forge, forgeFor } from "./dispatch/forge";
import { StoreSyncService } from "./engine/StoreSyncService";
import { appendDefect } from "./engine/defectLog";
import { thinkubeDeclaration } from "./core/thinkubeYaml";
import { configureDocsRoots, docsRootsOf } from "./core/docsDuty";
import { followFor } from "./hostui/storeWatch";
import { registerServer } from "./hostui/mcpRegister";
import { createProduct, EnabledProject, listProducts, setCardProduct } from "./core/identity";
import { ProductItem, ProjectsTreeProvider } from "./hostui/projectsTree";
import { activeOwnerKey, forgetProjects, openProjects, rememberedProject } from "./hostui/whichProject";
import { deleteThinkingSpace, deletionCost, listThinkingSpaces, nextTepNumber, thinkingSpaceDirs } from "./core/spaces";
import {
  chooseThinkingSpace,
  configuredStoreRoot,
  panelOpening,
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
import { busyLine, spaceBusy } from "./surfaces/busy";

let panels: SpacePanels;
let projectsTree: ProjectsTreeProvider | undefined;
let storeSync: StoreSyncService | undefined;

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

const watches = new Map<string, { dispose(): void }>();
const sessions = new Map<string, TandemSession>();
/** Last time each space changed, keyed the same as `sessions` —
 *  "<ownerKey>/<slug>". Dropped in the same act as the session and the
 *  panel, so the busy line never names a space that is gone. */
const lastChangeMs = new Map<string, number>();

let statusBar: vscode.StatusBarItem | undefined;

function updateStatusBar(project: EnabledProject | undefined): void {
  if (!statusBar) return;
  statusBar.text = project
    ? `$(repo) Tandem: ${project.card.product ? `${project.card.product} / ` : ""}${project.card.label}`
    : "$(repo) Tandem: choose a repository";
  statusBar.show();
}

const storeRootOf = configuredStoreRoot;

/** Speaks for every open thinking space, not just the remembered one, and
 *  is driven both by pushes and by its own repeating tick — so a space
 *  left running in the background is still reported. */
function heartbeat(context: vscode.ExtensionContext): void {
  if (!statusBar) return;
  const spaces = [...sessions.entries()]
    .map(([key, s]) => spaceBusy(key, s.repoName, s, lastChangeMs.get(key)))
    .filter((b): b is NonNullable<typeof b> => b !== undefined);
  const line = busyLine(spaces, Date.now());
  if (line) {
    statusBar.text = line.alert
      ? `$(warning) Tandem: ${line.text}`
      : `$(sync~spin) Tandem: ${line.text}`;
    statusBar.tooltip = line.detail;
    statusBar.backgroundColor = line.alert
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    statusBar.show();
    return;
  }
  statusBar.tooltip = "Switch the repository or project Tandem works on";
  statusBar.backgroundColor = undefined;
  updateStatusBar(rememberedProject(context));
}

/** The live editor's own gestures — the seam between this entry point and
 *  the notification rule, so the rule can be driven against a test editor. */
export function editorNoticeHost(): NoticeHost {
  return {
    info: (text, action) =>
      Promise.resolve(vscode.window.showInformationMessage(text, action)),
    warn: (text) => void vscode.window.showWarningMessage(text),
    run: (command, ...args) => void vscode.commands.executeCommand(command, ...args),
  };
}

/** key is "<ownerKey>/<slug>" — the space this change came from, never
 *  whichever space is remembered as active. */
function pushActive(context: vscode.ExtensionContext, key: string, message?: string): void {
  lastChangeMs.set(key, Date.now());
  heartbeat(context);
  const s = sessions.get(key);
  if (!s) return;
  panels.pushTo(key, s, message);
  void notifyForSpace(editorNoticeHost(), key, message);
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
    return ensureWorkSession({
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
      onChanged: (spaceKey, message) => pushActive(context, spaceKey, message),
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
  if (existing) return existing;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot = configuredStoreRoot();
  // What this repository publishes to its readers, found from its own
  // documentation system, so the duty at signing names the pages a person
  // reads rather than any file that happens to sit under docs/.
  configureDocsRoots(
    docsRootsOf(project.gitRoot, (() => { const d = thinkubeDeclaration(project.gitRoot); return d && "declared" in d ? d.declared.docsRoot : undefined; })()),
  );
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
    // A setting is a CANDIDATE, never a fact: the door runs it here before
    // anything judges by it.
    ...(config.get<string>("suiteCommand", "").trim()
      ? { told: { suite: config.get<string>("suiteCommand", "").trim() } }
      : {}),
    prepareCommand: config.get<string>("prepareCommand", ""),
    retire: (tepId) => retireTepWorktrees(bound.gitRoot, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    nextTepNumber: () => nextTepNumber(storeRoot, project.card.id, author),
    onChanged: (message) => pushActive(context, sessionKey, message),
  });
  sessions.set(sessionKey, s);
  // The space follows what is written to it, whoever wrote: a server
  // acting on the person's behalf, or a run started outside this window.
  followFor(vscode, watches, sessionKey, {
    storeDir: thinkingSpaceDirs(storeRoot, project.card.id, spaceSlug, author).storeDir,
    session: s,
    onReloaded: () => pushActive(context, sessionKey),
  });
  // Units loaded unnamed (or renamed past their render) get titles at open,
  // not only after the next act.
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
  return s;
}

export function activate(context: vscode.ExtensionContext): void {
  // The server that drives a space from outside this window is part of the
  // product, so the product keeps its own registration correct.
  registerServer(context.globalStorageUri.fsPath);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  statusBar.command = "thinkube-tandem.switchProject";
  statusBar.tooltip = "Switch the repository or project Tandem works on";
  updateStatusBar(rememberedProject(context));
  context.subscriptions.push(statusBar);

  // The status bar keeps itself current on its own clock, not only when a
  // change happens to arrive — a run left going in a background space is
  // still reported minutes later.
  const tick = setInterval(() => heartbeat(context), 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

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
  );
  context.subscriptions.push(
    vscode.window.createTreeView("tandemProjects", {
      treeDataProvider: projectsTree,
      showCollapseAll: true,
    }),
    // A folder added or removed changes which projects exist — the one
    // way the set moves without any gesture of ours.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      forgetProjects();
      projectsTree?.refresh();
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

  // A panel's session getter is bound to the one space key it was opened
  // for — never to whichever space is remembered as active, so a panel
  // never drifts onto another space's session.
  const sessionForKey = (key: string): (() => TandemSession) => {
    return () => {
      const s = sessions.get(key);
      if (!s) throw new Error("no active Tandem session — open the space first");
      return s;
    };
  };
  const hooks = {
    onSwitchRepo: async () => {
      await vscode.commands.executeCommand("thinkube-tandem.switchProject");
    },
  };
  // One panel per thinking space: opening a space never disposes another
  // space's panel — each is made once per key and reused after that. A tab
  // the person closes drops that space's session and change time in the
  // same act, so the busy line never names a space that is gone.
  panels = new SpacePanels((key, title) => {
    const panel = new SpacePanel({
      key,
      title,
      getSession: sessionForKey(key),
      hooks,
    });
    panel.onDidDispose(() => {
      sessions.delete(key);
      lastChangeMs.delete(key);
    });
    return panel;
  });
  const openSpaceFor = async (projectId?: string): Promise<void> => {
    if (projectId) await context.workspaceState.update("tandem.activeProject", projectId);
    const s = await ensureSession(context, true);
    if (!s) return;
    updateStatusBar(rememberedProject(context));
    (forgetProjects(), projectsTree?.refresh());
    const ownerKey = activeOwnerKey(context);
    const slug = ownerKey
      ? context.workspaceState.get<string>(`tandem.space.${ownerKey}`)
      : undefined;
    const opening = panelOpening(configuredStoreRoot(), ownerKey, slug);
    if ("refusal" in opening) {
      void vscode.window.showWarningMessage(`Tandem — ${opening.refusal}`);
      return;
    }
    const spacePanel = panels.open(opening.key, opening.title) as SpacePanel;
    await spacePanel.show(context.extensionUri);
    pushActive(context, opening.key);
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
      refreshTree: () => (forgetProjects(), projectsTree?.refresh()),
      // The deleted space's own panel is disposed and dropped; every
      // other open space's panel is untouched.
      dropSession: (key) => {
        sessions.delete(key);
        lastChangeMs.delete(key);
        panels.dispose(key);
      },
      deleteSpace: deleteThinkingSpace,
      costOfDeleting: deletionCost,
      sweepResidue: (ownerKey, cost) => sweepDeletedSpaceRuns(openProjects, ownerKey, cost),
    }),
    vscode.commands.registerCommand("thinkube-tandem.refreshProjects", () =>
      (forgetProjects(), projectsTree?.refresh()),
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
      (forgetProjects(), projectsTree?.refresh());
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
          await newProjectFlow(product, openProjects, () => (forgetProjects(), projectsTree?.refresh()));
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
            refresh: () => (forgetProjects(), projectsTree?.refresh()),
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
        (forgetProjects(), projectsTree?.refresh());
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
        (forgetProjects(), projectsTree?.refresh());
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
        const r = setCardProduct(project.anchorDir, product, configuredStoreRoot());
        if (!r.ok) void vscode.window.showErrorMessage(`Tandem: ${r.reason}`);
        (forgetProjects(), projectsTree?.refresh());
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
  panels?.disposeAll();
  storeSync?.dispose();
}
