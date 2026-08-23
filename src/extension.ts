/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space end to end — signing starts the run, accepting merges on
 * the project's forge — and every webview action is a registered
 * affordance.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { TandemSession } from "./surfaces/session";
import { PanelHost, PanelLike, SpacePanel } from "./surfaces/panel";
import { SpaceTabs } from "./surfaces/spaceTabs";
import { Forge, forgeFor } from "./dispatch/forge";
import { StoreSyncService } from "./engine/StoreSyncService";
import { createProduct, discoverProjects, EnabledProject, listProducts, setCardProduct } from "./core/identity";
import { ProductItem, ProjectsTreeProvider } from "./hostui/projectsTree";
import { deleteThinkingSpace, deletionCost, listThinkingSpaces, nextTepNumber, thinkingSpaceDirs } from "./core/spaces";
import { resolveSpaceHandle } from "./surfaces/sessionDeps";
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
import { getCurrentActiveContext, initActiveContext, updateActiveContext, updateConfigContext } from "./engine/host/active";
import { AUTHOR_MISSING, currentAuthor } from "./core/author";

let projectsTree: ProjectsTreeProvider | undefined;
let storeSync: StoreSyncService | undefined;

/** The concrete, vscode-backed panel host: builds the real webview panel,
 *  loads and rewrites the bundle HTML, computes CSP. SpacePanel itself
 *  never reaches any of this — a panel opened for one space never touches
 *  a panel any other space's SpacePanel created. */
export function makeVscodePanelHost(extensionUri: vscode.Uri): PanelHost {
  return {
    createPanel(title: string): PanelLike {
      // Active column, not a fixed one: each space's tab joins the group the
      // human is looking at, so a second space opens as its own tab beside
      // the first rather than replacing it in column one.
      const webviewPanel = vscode.window.createWebviewPanel(
        "thinkubeTandemSpace",
        title,
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true },
      );
      void renderBundleHtml(extensionUri, webviewPanel.webview).then((html) => {
        webviewPanel.webview.html = html;
      });
      return webviewPanel as unknown as PanelLike;
    },
  };
}

async function renderBundleHtml(extensionUri: vscode.Uri, webview: vscode.Webview): Promise<string> {
  const mediaRoot = vscode.Uri.joinPath(extensionUri, "media", "map");
  let raw: string;
  try {
    raw = await fs.readFile(vscode.Uri.joinPath(mediaRoot, "index.html").fsPath, "utf8");
  } catch {
    return `<!doctype html><html><body><h2>Map bundle missing</h2><p>Run <code>npm run compile</code> at the extension root (expected ${path.join("media", "map", "index.html")}), then reopen.</p></body></html>`;
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const nonce = Array.from({ length: 16 }, () => alphabet.charAt(Math.floor(Math.random() * 62))).join("");
  const rewritten = raw.replace(/(\s(?:src|href))="([^"]+)"/g, (_m, attr: string, ref: string) => {
    if (/^https?:|^data:/.test(ref)) return `${attr}="${ref}"`;
    const cleaned = ref.replace(/^\.\//, "").replace(/^\//, "");
    return `${attr}="${webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, ...cleaned.split("/"))).toString()}"`;
  });
  const withNonce = rewritten.replace(/<script(\s)/g, `<script nonce="${nonce}"$1`);
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join("; ");
  return withNonce.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
}

function gitRemote(repoRoot: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["-C", repoRoot, "remote", "get-url", "origin"], { encoding: "utf8" }, (err, stdout) =>
      resolve(err ? undefined : stdout.trim()),
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
        const headers = { Authorization: `token ${token}`, "Content-Type": "application/json" };
        const res = await fetch(url, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
        if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
        return res.json();
      },
    });
  } catch {
    return undefined;
  }
}

const sessions = new Map<string, TandemSession>();

// The register of open thinking-space tabs, keyed by "ownerKey/slug" — one
// tab per key, reused while open, dropped once it reports itself closed.
// Its factory needs the extension context to build a real webview panel,
// so it is wired in `activate`; until then the register legitimately holds
// none, and disposing it is still correct.
let spaceTabs = new SpaceTabs((key) => {
  throw new Error(`no thinking-space tab factory wired yet for ${key}`);
});

function activeSession(
  context: vscode.ExtensionContext,
  project?: EnabledProject,
): TandemSession | undefined {
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

// Read fresh on every call — never cached — so a tab closed between two
// tree renders stops showing as open on the very next draw.
function openSlugsFor(ownerKey: string): string[] {
  const prefix = `${ownerKey}/`;
  return spaceTabs
    .liveKeys()
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
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
  const spaceName = s?.spaceName ?? "this space";
  if (s?.running && s.runState) {
    const v = s.runState.view();
    const done = v.units.filter((u) => u.state === "done").length;
    if (v.parked.length) {
      statusBar.text = `$(warning) Tandem: a worker needs your answer`;
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      statusBar.text = `$(sync~spin) Tandem: building "${spaceName}" — ${done}/${v.units.length} units`;
      statusBar.backgroundColor = undefined;
    }
    statusBar.show();
    return;
  }
  const grounding = s?.groundingView() ?? [];
  if (grounding.length) {
    const running = grounding.filter((g) => g.label !== "waiting").length;
    statusBar.text = `$(sync~spin) Tandem: thinking about "${spaceName}" — ${running} of ${grounding.length} asks`;
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

/** Pushes ONE space's own change into ONE space's own tab — never into
 *  whichever tab happens to be on top. `spaceKey` is the owner-and-slug key
 *  the change came from; the delivery-ready notification, when raised,
 *  opens THAT space, not whatever the workspace remembers as active. */
function pushActive(context: vscode.ExtensionContext, message?: string, spaceKey?: string): void {
  heartbeat(context);
  if (!spaceKey) return;
  const s = sessions.get(spaceKey);
  if (!s) return;
  spaceTabs.push(spaceKey, message);
  if (message?.startsWith("Delivery ready"))
    // Opens the space that finished — the key this push carries — never
    // the workspace's remembered "active" one, and never the zero-argument
    // command that reads that memory.
    void vscode.window.showInformationMessage(`Tandem — ${message}`, "Open the space").then((pick) => {
      if (pick) spaceTabs.open(spaceKey).reveal();
    });
  else if (message?.startsWith("The run refused"))
    void vscode.window.showWarningMessage(`Tandem — ${message}`);
}

/** Resolves a thinking space to its session, handed back beside the
 *  owner-and-slug key this act resolved and the space's own display name
 *  — so the caller addresses the tab register with THIS key, never a
 *  remembered active slug. */
async function ensureSession(context: vscode.ExtensionContext, interactive = true): Promise<{ key: string; name: string; session: TandemSession } | undefined> {
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
      // ensureWorkSession binds this to the session's OWN resolved key
      // before wiring it in — never "the active session" read back later.
      onChanged: (key, message) => pushActive(context, message, key),
      storageDir: context.globalStorageUri.fsPath,
    });
  }
  let project = rememberedProject(context);
  if (!project && interactive) project = await chooseProject(context, openProjects);
  if (!project) return undefined;
  updateStatusBar(project);
  const spaceSlug = await chooseThinkingSpace(context, project.card.id, interactive);
  if (!spaceSlug) return undefined;
  const storeRoot = configuredStoreRoot();
  // The space's own display name and owner-and-slug key, read from the
  // listing by the one act both owner kinds resolve through — never the
  // repository or project label, never a remembered active slug.
  const { key: sessionKey, name: spaceName } = resolveSpaceHandle(storeRoot, project.card.id, project.card.id, spaceSlug);
  const existing = sessions.get(sessionKey);
  if (existing) return { key: sessionKey, name: spaceName, session: existing };
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
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
      label: project.card.product ? `${project.card.product} / ${project.card.label}` : project.card.label,
    },
    spaceName,
    spaceKey: sessionKey,
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
    // Bound to THIS session's own key — never "the active session" read
    // back from workspaceState by whatever push happens to run later.
    onChanged: (message) => pushActive(context, message, sessionKey),
  });
  sessions.set(sessionKey, s);
  // Units loaded unnamed (or renamed past their render) get titles at open,
  // not only after the next act.
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
  return { key: sessionKey, name: spaceName, session: s };
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
  launcher.activate().catch((err) => console.error("LauncherService activation failed:", err));

  // The sidebar NAVIGATES; the editor WORKS (the v1 shell rule): the
  // Projects tree + Configuration tree live in the container, the space is
  // an editor tab. Products first — a repository is born under its product.
  projectsTree = new ProjectsTreeProvider(
    () => listProducts(storeRootOf(), openProjects()),
    openProjects,
    () => activeOwnerKey(context),
    (ownerId, kind) => listThinkingSpaces(configuredStoreRoot(), ownerId, kind),
    (ownerKey) => openSlugsFor(ownerKey),
    () => listWorkProjects(configuredStoreRoot()),
  );
  context.subscriptions.push(
    vscode.window.createTreeView("tandemProjects", { treeDataProvider: projectsTree, showCollapseAll: true }),
  );

  // The Configuration area (v1, verbatim).
  // §7bis: never the first workspace folder — the remembered identity,
  // else the user's home (a neutral seed until a repository is chosen).
  const seedPath = rememberedProject(context)?.gitRoot ?? process.env.HOME ?? "/";
  const configService = new ClaudeConfigService(seedPath);
  const configTree = new ConfigTreeProvider(configService);
  const configView = vscode.window.createTreeView("claudeConfigTree", { treeDataProvider: configTree, showCollapseAll: true });
  context.subscriptions.push(configView);
  initActiveContext({ configService, treeProvider: configTree, statusBarItem: statusBar });
  configService.onConfigChanged(() => void updateConfigContext());
  void updateActiveContext(rememberedProject(context)?.gitRoot);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => void updateActiveContext()));
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
    onOpenCutReview: async (content: string) => {
      const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: true });
    },
    onWithProgress: async (
      title: string,
      run: (report: (message: string) => void, onCancel: (fn: () => void) => void) => Promise<void>,
    ) => {
      const opts = { location: vscode.ProgressLocation.Notification, title, cancellable: true };
      await vscode.window.withProgress(opts, (progress, token) =>
        run((message) => progress.report({ message }), (fn) => token.onCancellationRequested(fn)),
      );
    },
    // The tab itself is already gone from the register the moment it
    // reports isClosed() — nothing to remove here. The tree still needs
    // telling, since a closed tab must stop showing as open in it.
    onClosed: () => projectsTree?.refresh(),
  };
  // The one register of open thinking-space tabs, keyed by owner and slug:
  // reveals a space's tab when it is already open, builds a fresh
  // SpacePanel — for that key's own session, never any other's — when it
  // is not.
  spaceTabs = new SpaceTabs((key) => {
    const session = sessions.get(key);
    if (!session) throw new Error(`no session resolved yet for thinking-space tab ${key}`);
    const tab = new SpacePanel({ key, name: session.spaceName ?? key, session }, makeVscodePanelHost(context.extensionUri), hooks);
    void tab.show();
    return tab;
  });
  context.subscriptions.push({ dispose: () => spaceTabs.dispose() });

  const openSpaceFor = async (projectId?: string): Promise<void> => {
    if (projectId) await context.workspaceState.update("tandem.activeProject", projectId);
    const resolved = await ensureSession(context, true);
    if (!resolved) return;
    updateStatusBar(rememberedProject(context));
    projectsTree?.refresh();
    // The session is already registered under resolved.key by ensureSession
    // — the factory above reads it straight back out.
    const tab = spaceTabs.open(resolved.key);
    tab.reveal();
    pushActive(context, undefined, resolved.key);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube-ai.claude.openHere", (uri?: vscode.Uri) => launcher.openHere(uri)),
    vscode.commands.registerCommand("thinkube-tandem.openSpace", () => openSpaceFor()),
    vscode.commands.registerCommand("thinkube-tandem.activateProject", (id: string) => openSpaceFor(id)),
    // The v1 gestures (open / create / delete a thinking space) — spaceOps.
    ...registerSpaceCommands(context, {
      openSpaceFor,
      refreshTree: () => projectsTree?.refresh(),
      // Deleting a space drops its session and closes its tab in the same
      // act — a tab left open over a dropped session is a tab over nothing.
      dropSession: (key) => {
        sessions.delete(key);
        spaceTabs.close(key);
      },
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
