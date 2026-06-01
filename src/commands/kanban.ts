/**
 * Kanban / roadmap commands (thinkube.kanban.*).
 *
 * Chunk-3 surface: just the `dumpRoadmap` smoke command. It exists to verify
 * the GitHubService stack against a real repo + project without committing
 * to any UI yet. Output goes to a dedicated channel so the JSON tree is easy
 * to copy out and inspect.
 *
 * Each later chunk hangs additional commands here as the panels and the MCP
 * provider come online.
 */
import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import {
  GitHubService,
  IssueSummary,
  ProjectInfo,
  RepoCoords,
} from "../github/GitHubService";
import { detectRepoCoords } from "../github/gitRemote";
import { TasksMaterializer } from "../methodology/TasksMaterializer";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { InMemoryAdapter } from "../views/kanban/host/InMemoryAdapter";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { StorageAdapter } from "../views/kanban/host/StorageAdapter";
import {
  GitHubProjectsAdapter,
  METHODOLOGY_STATUSES,
  StatusFieldMisconfiguredError,
} from "../views/kanban/host/storage/GitHubProjectsAdapter";

interface KanbanDeps {
  auth: AuthService;
  github: GitHubService;
  output: vscode.OutputChannel;
  store: ThinkubeStore | undefined;
  extensionUri: vscode.Uri;
  materializer: TasksMaterializer | undefined;
}

export function registerKanbanCommands(
  context: vscode.ExtensionContext,
  deps: KanbanDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.kanban.dumpRoadmap", () =>
      dumpRoadmap(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.smokeStore", () =>
      smokeStore(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.openKanban", () =>
      openKanban(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.configureProject", () =>
      configureProject(deps),
    ),
    vscode.commands.registerCommand(
      "thinkube.kanban.materializeTasks",
      (resource?: vscode.Uri) => materializeTasks(deps, resource),
    ),
    vscode.commands.registerCommand("thinkube.kanban.refreshFromGitHub", () =>
      refreshFromGitHub(deps),
    ),
  );
}

/**
 * Picks a `.thinkube/specs/SP-*-tasks.md` file and runs the materializer on
 * it. Source preference: the resource the command was invoked with (e.g. an
 * explorer right-click), then the active editor, then a QuickPick over all
 * tasks files in the active workspace's `.thinkube/specs/`.
 */
async function materializeTasks(
  deps: KanbanDeps,
  resource?: vscode.Uri,
): Promise<void> {
  if (!deps.store) {
    vscode.window.showErrorMessage(
      "Materialise tasks: no workspace folder is open.",
    );
    return;
  }
  if (!deps.materializer) {
    vscode.window.showErrorMessage(
      "Materialise tasks: materializer not initialised.",
    );
    return;
  }

  const relativePath = await pickTasksFile(deps.store, resource);
  if (!relativePath) return;

  // Read the file to find the parent spec — the materializer drives off the
  // spec issue number, not the path.
  const parsed = await deps.store.getFile(relativePath);
  if (!parsed) {
    vscode.window.showErrorMessage(`Tasks file not found: ${relativePath}`);
    return;
  }
  const fm = parsed.frontmatter ?? {};
  const candidate = fm.parent_issue ?? fm.issue;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    vscode.window.showErrorMessage(
      `${relativePath}: frontmatter must include \`parent_issue\` (or \`issue\`) pointing at the spec issue number.`,
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Materialising tasks for SP-${candidate}…`,
    },
    async () => {
      try {
        const result = await deps.materializer!.materialize({
          specIssueNumber: candidate,
        });
        if (result.created.length > 0) {
          vscode.window.showInformationMessage(
            `Created ${result.created.length} Task issue${result.created.length === 1 ? "" : "s"} for SP-${candidate}.`,
          );
        } else if (result.failed.length === 0) {
          vscode.window.showInformationMessage(
            `No unchecked tasks in ${relativePath}; nothing to materialise.`,
          );
        }
        if (result.failed.length > 0) {
          vscode.window.showWarningMessage(
            `${result.failed.length} row(s) failed — see Thinkube Kanban output.`,
          );
        }
      } catch (err) {
        deps.output.appendLine(`[materializeTasks] ${(err as Error).message}`);
        vscode.window.showErrorMessage(
          `Materialise failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

async function pickTasksFile(
  store: ThinkubeStore,
  resource: vscode.Uri | undefined,
): Promise<string | undefined> {
  const fromResource = matchTasksUri(store, resource);
  if (fromResource) return fromResource;

  const editor = vscode.window.activeTextEditor;
  const fromEditor = matchTasksUri(store, editor?.document.uri);
  if (fromEditor) return fromEditor;

  const all = await store.listTaskDecompositions();
  if (all.length === 0) {
    vscode.window.showInformationMessage(
      "No `.thinkube/specs/SP-*-tasks.md` files in this workspace yet.",
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(all, {
    title: "Pick a tasks file to materialise",
    placeHolder: ".thinkube/specs/SP-{n}-tasks.md",
  });
  return picked;
}

function matchTasksUri(
  store: ThinkubeStore,
  uri: vscode.Uri | undefined,
): string | undefined {
  if (!uri) return undefined;
  if (uri.scheme !== "file") return undefined;
  const fs = uri.fsPath;
  if (!fs.startsWith(store.thinkubeDir)) return undefined;
  if (!/SP-\d+-tasks\.md$/.test(fs)) return undefined;
  return fs.slice(store.thinkubeDir.length + 1).replace(/\\/g, "/");
}

/**
 * Drops cached client + classifier state so the next read re-fetches from
 * GitHub. The roadmap tree also refreshes. If the kanban panel is open, the
 * user re-triggers a load by closing and reopening it — the in-place reload
 * path lives with the adapter and lands in chunk 13 polish.
 */
async function refreshFromGitHub(deps: KanbanDeps): Promise<void> {
  deps.github.invalidate();
  try {
    await vscode.commands.executeCommand("thinkube.roadmap.refresh");
  } catch {
    // Roadmap may not be registered yet; non-fatal.
  }
  deps.output.appendLine("[refreshFromGitHub] caches dropped; tree refreshed");
  vscode.window.showInformationMessage(
    "GitHub state refreshed. Reopen the Kanban panel to pull fresh project state.",
  );
}

async function openKanban(deps: KanbanDeps): Promise<void> {
  const adapter = await pickAdapter(deps);
  if (!adapter) return;
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const repo = (cfg.get<string>("repo") ?? "").trim();
  try {
    await KanbanPanel.open({
      extensionUri: deps.extensionUri,
      adapter,
      output: deps.output,
      openDetail: repo.includes("/")
        ? async (issueNumber: number) => {
            await vscode.env.openExternal(
              vscode.Uri.parse(
                `https://github.com/${repo}/issues/${issueNumber}`,
              ),
            );
          }
        : undefined,
    });
  } catch (err) {
    deps.output.appendLine(`[openKanban] failed: ${(err as Error).message}`);
    if (err instanceof StatusFieldMisconfiguredError) {
      const action = await vscode.window.showErrorMessage(
        err.message,
        "Configure Project",
      );
      if (action === "Configure Project") {
        await vscode.commands.executeCommand(
          "thinkube.kanban.configureProject",
        );
      }
      return;
    }
    vscode.window.showErrorMessage(
      `Failed to open kanban: ${(err as Error).message}`,
    );
  }
}

/**
 * Resolve which adapter to use based on settings. GitHubProjectsAdapter when
 * both repo and projectNumber are set; InMemoryAdapter otherwise.
 *
 * The GitHub adapter eagerly loads inside `KanbanPanel.open` so misconfigured
 * Status fields surface at open time, not on the first drag. We don't load
 * here — Panel.bootstrap drives the first `load()` after the webview asks
 * for state, which keeps the chunk-5 in-memory path unchanged.
 */
async function pickAdapter(
  deps: KanbanDeps,
): Promise<StorageAdapter | undefined> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const repoSetting = (cfg.get<string>("repo") ?? "").trim();
  const projectNumber = cfg.get<number>("projectNumber") ?? 0;

  if (repoSetting.includes("/") && projectNumber > 0) {
    const [owner, name] = repoSetting.split("/", 2);
    return new GitHubProjectsAdapter({
      coords: { owner, name },
      projectNumber,
      github: deps.github,
      output: deps.output,
    });
  }
  // Fall through to the chunk-5 in-memory demo.
  return new InMemoryAdapter();
}

/**
 * Configure-project: link this workspace to its GitHub repo + Projects v2 board.
 *
 * Auto-detects rather than asking the user to retype things the environment
 * already knows:
 *   - the repo comes from the workspace's git remote (`detectRepoCoords`),
 *     falling back to the saved setting, and only then to a manual prompt;
 *   - the board is discovered by listing the owner's Projects v2 and matching
 *     the one whose Status field has all six methodology columns. One match →
 *     auto-selected; several → quick-pick; none → quick-pick over all boards so
 *     the user can still choose, then we report what's missing.
 *
 * Writes `thinkube.kanban.repo` + `thinkube.kanban.projectNumber` to workspace
 * settings. Status options are validated read-only (never auto-created).
 */
async function configureProject(deps: KanbanDeps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 1. Resolve the repo: git remote → saved setting → manual prompt.
  let repo = "";
  const detected = workspacePath
    ? await detectRepoCoords(workspacePath)
    : undefined;
  if (detected) {
    repo = `${detected.owner}/${detected.name}`;
    deps.output.appendLine(`[configureProject] repo from git remote: ${repo}`);
  } else {
    const saved = (cfg.get<string>("repo") ?? "").trim();
    const repoInput = await vscode.window.showInputBox({
      title: "Thinkube Kanban — repository",
      prompt:
        "owner/repo backing this kanban (no git remote found to detect it)",
      value: saved,
      placeHolder: "octocat/hello-world",
      validateInput: (v) =>
        /^[\w.-]+\/[\w.-]+$/.test(v.trim())
          ? undefined
          : "Expected `owner/repo` format.",
      ignoreFocusOut: true,
    });
    if (repoInput === undefined) return;
    repo = repoInput.trim();
  }
  const [owner] = repo.split("/", 2);

  // 2. Discover the board by listing the owner's Projects v2.
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Finding the methodology board for ${owner}…`,
    },
    async () => {
      let projects: ProjectInfo[];
      try {
        projects = await deps.github.listProjects(owner);
      } catch (err) {
        deps.output.appendLine(
          `[configureProject] listProjects failed: ${(err as Error).message}`,
        );
        vscode.window.showErrorMessage(
          `Configure failed: ${(err as Error).message}`,
        );
        return;
      }

      if (projects.length === 0) {
        vscode.window.showErrorMessage(
          `No Projects v2 boards found for ${owner}. Create one with a Status field whose options are: ${METHODOLOGY_STATUSES.join(", ")}.`,
        );
        return;
      }

      const hasAllStatuses = (p: ProjectInfo) =>
        !!p.statusField &&
        METHODOLOGY_STATUSES.every((s) =>
          p.statusField!.options.some((o) => o.name === s),
        );
      const matches = projects.filter(hasAllStatuses);

      let chosen: ProjectInfo | undefined;
      if (matches.length === 1) {
        chosen = matches[0];
        deps.output.appendLine(
          `[configureProject] auto-selected board #${chosen.number} (${chosen.title})`,
        );
      } else if (matches.length > 1) {
        chosen = await pickProject(
          matches,
          "Multiple boards have the six methodology columns — pick one",
        );
      } else {
        chosen = await pickProject(
          projects,
          "No board has all six methodology columns — pick one to configure anyway",
        );
      }
      if (!chosen) return;

      // 3. Persist.
      await cfg.update("repo", repo, vscode.ConfigurationTarget.Workspace);
      await cfg.update(
        "projectNumber",
        chosen.number,
        vscode.ConfigurationTarget.Workspace,
      );
      deps.output.appendLine(
        `[configureProject] saved: repo=${repo} project=${chosen.number}`,
      );

      // 4. Report on the chosen board's Status field.
      const present = chosen.statusField?.options.map((o) => o.name) ?? [];
      const missing = METHODOLOGY_STATUSES.filter((s) => !present.includes(s));
      if (missing.length > 0) {
        vscode.window.showWarningMessage(
          `Linked ${repo} · project #${chosen.number} (${chosen.title}), but its Status field is missing: ${missing.join(", ")}. Add them in the GitHub Projects UI, then reopen the kanban.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `Kanban configured: ${repo} · project #${chosen.number} (${chosen.title}).`,
        );
      }
    },
  );
}

/** Quick-pick over Projects v2 boards, returning the chosen one. */
async function pickProject(
  projects: ProjectInfo[],
  placeHolder: string,
): Promise<ProjectInfo | undefined> {
  if (projects.length === 1) return projects[0];
  const items = projects.map((p) => ({
    label: p.title,
    description: `#${p.number}`,
    project: p,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Thinkube Kanban — board",
    placeHolder,
    ignoreFocusOut: true,
  });
  return picked?.project;
}

async function dumpRoadmap(deps: KanbanDeps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");
  const repoSetting = (cfg.get<string>("repo") ?? "").trim();
  const projectNumber = cfg.get<number>("projectNumber") ?? 0;

  if (!repoSetting.includes("/")) {
    vscode.window.showErrorMessage(
      "Thinkube Kanban: set `thinkube.kanban.repo` to `owner/repo` first.",
    );
    return;
  }
  const [owner, name] = repoSetting.split("/", 2);
  const coords: RepoCoords = { owner, name };

  deps.output.show(true);
  deps.output.appendLine(
    `[dumpRoadmap] ${coords.owner}/${coords.name} project=${projectNumber || "(none)"}`,
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Dumping roadmap…",
    },
    async (progress) => {
      try {
        const mode = await deps.github.getClassifierMode(coords);
        deps.output.appendLine(`[dumpRoadmap] classifier mode: ${mode}`);
        progress.report({ message: "epics…" });

        const epics = await deps.github.listIssues(coords, {
          type: "epic",
          state: "open",
        });
        const tree = await Promise.all(
          epics.map(async (epic) => {
            const stories = await deps.github.listSubIssues(
              coords,
              epic.number,
            );
            const storyTrees = await Promise.all(
              stories.map(async (story) => {
                const specs = await deps.github.listSubIssues(
                  coords,
                  story.number,
                );
                const specTrees = await Promise.all(
                  specs.map(async (spec) => {
                    const tasks = await deps.github.listSubIssues(
                      coords,
                      spec.number,
                    );
                    return {
                      ...summarize(spec),
                      tasks: tasks.map(summarize),
                    };
                  }),
                );
                return { ...summarize(story), specs: specTrees };
              }),
            );
            return { ...summarize(epic), stories: storyTrees };
          }),
        );

        let project: unknown = null;
        if (projectNumber > 0) {
          progress.report({ message: "project…" });
          try {
            const info = await deps.github.getProject(owner, projectNumber);
            const items = await deps.github.listProjectItems(info.id);
            project = {
              id: info.id,
              number: info.number,
              title: info.title,
              url: info.url,
              statusField: info.statusField,
              items,
            };
          } catch (err) {
            deps.output.appendLine(
              `[dumpRoadmap] project fetch failed: ${(err as Error).message}`,
            );
          }
        }

        const payload = {
          repo: `${coords.owner}/${coords.name}`,
          classifierMode: mode,
          epics: tree,
          project,
          generatedAt: new Date().toISOString(),
        };

        deps.output.appendLine(JSON.stringify(payload, null, 2));
        deps.output.appendLine(`[dumpRoadmap] done — ${epics.length} epic(s)`);
      } catch (err) {
        deps.output.appendLine(
          `[dumpRoadmap] failed: ${(err as Error).message}`,
        );
        vscode.window.showErrorMessage(
          `Roadmap dump failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

function summarize(issue: IssueSummary): {
  number: number;
  title: string;
  state: "open" | "closed";
  kind: string | undefined;
  url: string;
  nodeId: string;
} {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    kind: issue.kind,
    url: issue.url,
    nodeId: issue.nodeId,
  };
}

/**
 * Acceptance test for chunk 4: writes a sample `.thinkube/specs/SP-50.md`,
 * reads it back, listens for one watcher event, and resolves
 * `linkIssueToFile(50)`. All three results are reported in the Thinkube
 * Kanban output channel so the user can verify chunk 4 from the palette.
 */
async function smokeStore(deps: KanbanDeps): Promise<void> {
  const { store, output } = deps;
  if (!store) {
    vscode.window.showErrorMessage(
      "Thinkube store: no workspace folder is open.",
    );
    return;
  }

  output.show(true);
  const rel = store.pathFor("spec", 50);
  output.appendLine(`[smokeStore] target: ${rel}`);

  const watcherEvents: string[] = [];
  const sub = store.watch("spec", (change) => {
    if (change.relativePath === rel) {
      watcherEvents.push(`${change.type}@${new Date().toISOString()}`);
    }
  });

  try {
    const frontmatter = {
      kind: "spec" as const,
      issue: 50,
      parent_issue: 34,
      repo: "thinkube/example",
      created: new Date().toISOString().slice(0, 10),
    };
    const body =
      "# Smoke spec\n\n## Acceptance Criteria\n- [ ] thinkube store round-trips\n";
    await store.writeFile(rel, frontmatter, body);
    output.appendLine("[smokeStore] write: OK");

    const parsed = await store.getFile(rel);
    if (!parsed) {
      throw new Error("getFile returned undefined right after writeFile");
    }
    const roundTrip =
      parsed.frontmatter?.issue === 50 &&
      parsed.body.includes("Acceptance Criteria");
    output.appendLine(
      `[smokeStore] round-trip: ${roundTrip ? "OK" : "FAILED"}`,
    );

    // Give the FileSystemWatcher a tick to fire.
    await new Promise((r) => setTimeout(r, 750));
    output.appendLine(
      `[smokeStore] watcher events: ${watcherEvents.length} (${watcherEvents.join(", ") || "none"})`,
    );

    const path = await store.linkIssueToFile(50);
    output.appendLine(
      `[smokeStore] linkIssueToFile(50): ${path ?? "undefined"}`,
    );

    if (roundTrip && watcherEvents.length > 0 && path === rel) {
      output.appendLine("[smokeStore] ✅ acceptance criteria met");
      vscode.window.showInformationMessage("Thinkube store smoke test passed.");
    } else {
      output.appendLine(
        "[smokeStore] ❌ one or more checks failed — see above",
      );
      vscode.window.showWarningMessage(
        "Thinkube store smoke test had failures — see Thinkube Kanban output.",
      );
    }
  } catch (err) {
    output.appendLine(`[smokeStore] failed: ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Smoke store failed: ${(err as Error).message}`,
    );
  } finally {
    sub.dispose();
  }
}
