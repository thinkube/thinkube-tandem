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
import { listCandidateFolders } from "../github/workspaceRepo";
import { TasksMaterializer } from "../methodology/TasksMaterializer";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { InMemoryAdapter } from "../views/kanban/host/InMemoryAdapter";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { StorageAdapter } from "../views/kanban/host/StorageAdapter";
import {
  GitHubProjectsAdapter,
  METHODOLOGY_OPTIONS,
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
 * Configure-project: pick the local repository folder where the methodology
 * lives, then derive everything else from it.
 *
 * Folder-first by design — the user selects the folder (a git repo) and we read
 * its github.com remote to get `owner/repo` (failing loudly if it has none,
 * rather than guessing a default), discover the owner's Projects v2 board, and
 * persist `thinkube.kanban.folder` + `.repo` + `.projectNumber`. That folder is
 * the single anchor for the `.thinkube` store, the bundle installer, and the MCP
 * server, so the methodology files always land in the repo they belong to.
 *
 * Any missing methodology Status options are created automatically
 * (non-destructive) so the board is ready to use without a manual GitHub-UI step.
 */
async function configureProject(deps: KanbanDeps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("thinkube.kanban");

  // 1. Pick the repository folder where the methodology will live.
  const folder = await pickMethodologyFolder();
  if (!folder) return;

  // 2. Derive the repo from the folder's git remote — fail if there isn't one
  //    (no silent fallback: a folder with no GitHub remote can't back a board).
  const coords = await detectRepoCoords(folder);
  if (!coords) {
    vscode.window.showErrorMessage(
      `"${folder}" is not a git repository with a github.com remote. Pick the folder of a GitHub-hosted repo.`,
    );
    return;
  }
  const repo = `${coords.owner}/${coords.name}`;
  const owner = coords.owner;
  deps.output.appendLine(
    `[configureProject] folder=${folder} repo=${repo} (from git remote)`,
  );

  // 3. Discover the board by listing the owner's Projects v2.
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

      // 3b. Enforce the methodology schema (Issue Types + Priority field)
      //     BEFORE persisting — fail fast (no partial config) when the token
      //     can't create org Issue Types.
      try {
        const schema = await deps.github.enforceSchema(coords, chosen.id);
        deps.output.appendLine(
          `[configureProject] schema: issue types created=${schema.issueTypesCreated.join(", ") || "(none)"}; ` +
            `Priority field ${schema.priorityField.created ? "created" : "verified"}` +
            `${schema.priorityField.optionsAdded.length ? ` (+${schema.priorityField.optionsAdded.join(", ")})` : ""}`,
        );
      } catch (err) {
        deps.output.appendLine(
          `[configureProject] enforceSchema failed: ${(err as Error).message}`,
        );
        vscode.window.showErrorMessage(
          `Configure aborted — couldn't enforce the methodology schema: ${(err as Error).message}`,
        );
        return;
      }

      // 3c. Migrate existing label-based issues to the new Issue Types
      //     (non-fatal: the schema is in place even if a migration row fails).
      try {
        const mig = await deps.github.migrateLabelKindsToTypes(coords);
        deps.output.appendLine(
          `[configureProject] migrated ${mig.migrated} issue(s) to Issue Types (` +
            `${Object.entries(mig.perKind)
              .map(([k, n]) => `${k}:${n}`)
              .join(", ") || "none"})`,
        );
      } catch (err) {
        deps.output.appendLine(
          `[configureProject] migrate labels→types failed (non-fatal): ${(err as Error).message}`,
        );
      }

      // 4. Persist the folder + derived repo + board.
      await cfg.update("folder", folder, vscode.ConfigurationTarget.Workspace);
      await cfg.update("repo", repo, vscode.ConfigurationTarget.Workspace);
      await cfg.update(
        "projectNumber",
        chosen.number,
        vscode.ConfigurationTarget.Workspace,
      );
      deps.output.appendLine(
        `[configureProject] saved: folder=${folder} repo=${repo} project=${chosen.number}`,
      );

      // 5. Ensure the board's Status field has the methodology columns,
      //    creating any that are missing (non-destructive) so the user doesn't
      //    have to add them by hand in the GitHub Projects UI.
      const present = chosen.statusField?.options.map((o) => o.name) ?? [];
      let missing = METHODOLOGY_STATUSES.filter((s) => !present.includes(s));
      let created: string[] = [];
      if (missing.length > 0 && chosen.statusField) {
        try {
          created = await deps.github.ensureSingleSelectOptions(
            chosen.statusField.id,
            METHODOLOGY_OPTIONS,
          );
          deps.output.appendLine(
            `[configureProject] created Status options: ${created.join(", ") || "(none)"}`,
          );
          missing = [];
        } catch (err) {
          deps.output.appendLine(
            `[configureProject] auto-create Status options failed: ${(err as Error).message}`,
          );
        }
      }
      if (missing.length > 0) {
        vscode.window.showWarningMessage(
          `Linked ${repo} · project #${chosen.number} (${chosen.title}), but its Status field is missing: ${missing.join(", ")} — and they couldn't be created automatically (the GitHub token needs the \`project\` scope). Add them in the GitHub Projects UI, then reopen the kanban.`,
        );
      } else {
        const suffix = created.length ? ` (added: ${created.join(", ")})` : "";
        vscode.window.showInformationMessage(
          `Kanban configured: ${repo} · project #${chosen.number} (${chosen.title})${suffix}. Methodology folder: ${folder}. Run "Install Bundle" to (re)write the methodology files there.`,
        );
      }
    },
  );
}

/**
 * Pick the local repository folder for the methodology. Lists open workspace
 * folders (annotated with the GitHub repo detected from each one's remote) plus
 * a "Browse…" entry for repos that aren't open as workspace folders (e.g. a
 * nested sub-repo). Returns the absolute path, or undefined if cancelled.
 */
async function pickMethodologyFolder(): Promise<string | undefined> {
  const candidates = await listCandidateFolders();
  const BROWSE = "$(folder-opened) Browse for a folder…";
  type Item = vscode.QuickPickItem & { fsPath?: string };
  const items: Item[] = candidates.map((c) => ({
    label: c.coords ? `$(repo) ${c.name}` : `$(folder) ${c.name}`,
    description: c.coords
      ? `${c.coords.owner}/${c.coords.name}`
      : "no github.com remote",
    detail: c.fsPath,
    fsPath: c.fsPath,
  }));
  items.push({ label: BROWSE });

  const picked = await vscode.window.showQuickPick(items, {
    title: "Thinkube Kanban — pick the repository folder",
    placeHolder: "The folder whose git remote is the repo backing the kanban",
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;
  if (picked.label === BROWSE) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Use this folder",
      defaultUri: candidates[0]
        ? vscode.Uri.file(candidates[0].fsPath)
        : undefined,
    });
    return uris?.[0]?.fsPath;
  }
  return picked.fsPath;
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
