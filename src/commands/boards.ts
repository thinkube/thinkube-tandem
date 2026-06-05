/**
 * Per-repo board commands (thinkube.boards.*) — the navigator's actions.
 *
 * `open` builds a ThinkubeStore + ThinkubeFilesAdapter scoped to the selected
 * repo and opens its board (KanbanPanel is singleton-by-scope, so each repo's
 * board is its own panel). `enable` scaffolds a committable `.thinkube/`
 * skeleton so a repo becomes methodology-enabled (ADR-0006). No single-binding
 * settings — the repo path comes from the navigator selection.
 *
 * `newClaudeSession` / `resumeClaudeSession` make the board the entry point
 * for Claude sessions rooted in that repo: new sessions go through the
 * cwd-patching launcher, and resume lists the repo's past sessions (matched
 * by the cwd recorded in each transcript) and reopens one via claude-code's
 * native resume — see docs/claude-code-internals.md.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { LauncherService } from "../services/LauncherService";
import { SessionLinkService } from "../services/SessionLinkService";
import { listSessionsForFolder, SessionInfo } from "../services/sessionLinks";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { migrateBoardDir } from "../store/boardMigration";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { ThinkubeFilesAdapter } from "../views/kanban/host/storage/ThinkubeFilesAdapter";
import {
  BoardNavigatorProvider,
  RepoEntry,
} from "../views/boards/BoardNavigatorProvider";

interface BoardDeps {
  extensionUri: vscode.Uri;
  output: vscode.OutputChannel;
  provider: BoardNavigatorProvider;
  launcher: LauncherService;
  sessionLinks: SessionLinkService;
}

/**
 * Single key reused for both the persisted `workspaceState` flag and the
 * `when`-clause context key that swaps the title-bar filter icon.
 */
const CONFIGURED_ONLY_KEY = "thinkube.boards.configuredOnly";

/**
 * Apply the configured-only filter everywhere it's observed: the provider
 * (re-renders the list), persisted `workspaceState` (survives reloads), and
 * the `when`-clause context key (swaps the title-bar icon).
 */
function applyConfiguredOnly(
  context: vscode.ExtensionContext,
  provider: BoardNavigatorProvider,
  value: boolean,
): void {
  provider.setConfiguredOnly(value);
  void context.workspaceState.update(CONFIGURED_ONLY_KEY, value);
  void vscode.commands.executeCommand("setContext", CONFIGURED_ONLY_KEY, value);
}

/**
 * Seed the filter from persisted state at activation so the icon and the list
 * match the choice saved before the last reload. Call after the view exists.
 */
export function seedBoardsFilter(
  context: vscode.ExtensionContext,
  provider: BoardNavigatorProvider,
): void {
  const saved = context.workspaceState.get<boolean>(CONFIGURED_ONLY_KEY, false);
  applyConfiguredOnly(context, provider, saved);
}

export function registerBoardCommands(
  context: vscode.ExtensionContext,
  deps: BoardDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.boards.refresh", () =>
      deps.provider.refresh(),
    ),
    vscode.commands.registerCommand("thinkube.boards.open", (r: RepoEntry) =>
      openBoardFor(context, deps, r),
    ),
    vscode.commands.registerCommand("thinkube.boards.enable", (r: RepoEntry) =>
      enableHere(deps, r),
    ),
    vscode.commands.registerCommand("thinkube.boards.migrate", (r: RepoEntry) =>
      migrateBoardToSidecar(deps, r),
    ),
    vscode.commands.registerCommand(
      "thinkube.boards.newClaudeSession",
      (r: RepoEntry) => deps.launcher.openHere(vscode.Uri.file(r.path)),
    ),
    vscode.commands.registerCommand(
      "thinkube.boards.resumeClaudeSession",
      (r: RepoEntry) => resumeClaudeSession(deps, r),
    ),
    vscode.commands.registerCommand("thinkube.boards.showConfiguredOnly", () =>
      applyConfiguredOnly(context, deps.provider, true),
    ),
    vscode.commands.registerCommand("thinkube.boards.showAll", () =>
      applyConfiguredOnly(context, deps.provider, false),
    ),
  );
}

/**
 * Pick one of the repo's past Claude sessions and reopen it natively.
 *
 * Sessions are matched by the cwd recorded inside each transcript, so this
 * includes sessions rooted in subfolders of the repo. `ensureVisible` first:
 * claude-code's resume-by-id silently falls back to a NEW session when the
 * transcript isn't in its picker project dir (claude-code-internals.md, F6).
 */
async function resumeClaudeSession(
  deps: BoardDeps,
  r: RepoEntry,
): Promise<void> {
  const sessions = await listSessionsForFolder(r.path);
  if (sessions.length === 0) {
    const pick = await vscode.window.showInformationMessage(
      `No Claude sessions recorded for ${r.name}.`,
      "Start new session",
    );
    if (pick) await deps.launcher.openHere(vscode.Uri.file(r.path));
    return;
  }

  type Item = vscode.QuickPickItem & { session: SessionInfo };
  const items: Item[] = sessions.map((s) => ({
    label: s.title ?? s.uuid.slice(0, 8),
    description: [
      agoLabel(s.mtimeMs),
      s.cwd === r.path ? "" : path.relative(r.path, s.cwd),
    ]
      .filter(Boolean)
      .join(" · "),
    session: s,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Resume a Claude session in ${r.name}`,
    matchOnDescription: true,
  });
  if (!picked) return;

  await deps.sessionLinks.ensureVisible(picked.session.file);
  await vscode.commands.executeCommand(
    "claude-vscode.editor.open",
    picked.session.uuid,
  );
}

function agoLabel(mtimeMs: number): string {
  const mins = Math.max(1, Math.round((Date.now() - mtimeMs) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

async function openBoardFor(
  context: vscode.ExtensionContext,
  deps: BoardDeps,
  r: RepoEntry,
): Promise<void> {
  const store = new ThinkubeStore(r.path, r.boardDir);
  store.activate();
  context.subscriptions.push(store);
  const adapter = new ThinkubeFilesAdapter(store, r.name);
  adapter.watchExternal();
  await KanbanPanel.open({
    extensionUri: deps.extensionUri,
    adapter,
    output: deps.output,
    // A card's "detail" is its slice file open in the editor.
    openDetail: async (id: string) => {
      const m = /^SP-([A-Za-z0-9]+)_SL-(\d+)$/.exec(id);
      if (!m) return;
      const rel = store.pathForSlice(m[1], Number(m[2]));
      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(store.thinkubeDir, rel)),
      );
    },
    // "New Spec" header button: mint the next Spec id and open a Claude session
    // rooted in the repo with /spec-prepare prefilled — spec authoring is a
    // conversation (ADR-0003), so the button only starts it in the right place
    // with the right id. SP-7: ids are conflict-free base36-epoch strings, so
    // the SP-5 canonical-repo round-trip (which existed only to keep `max+1`
    // unique across worktrees) is gone.
    onCreateSpec: async () => {
      const n = await store.nextSpecNumber();
      await deps.launcher.openHere(
        vscode.Uri.file(r.path),
        `/spec-prepare ${n} `,
      );
    },
  });
}

/**
 * Migrate a Thinking Space's co-located `.thinkube/` board into the central
 * sidecar at its namespace dir (SP-8). No-loss, no-stub; refuses when the
 * central target already holds a board. The `.claude/`+`CLAUDE.md`+`.mcp.json`
 * bundle files stay in the repo — only the board moves.
 */
async function migrateBoardToSidecar(
  deps: BoardDeps,
  r: RepoEntry,
): Promise<void> {
  const boardRoot = vscode.workspace
    .getConfiguration("thinkube.boards")
    .get<string>("root")
    ?.trim();
  if (!boardRoot) {
    vscode.window.showErrorMessage(
      "Set `thinkube.boards.root` before migrating a board to the sidecar.",
    );
    return;
  }
  const coLocated = path.join(r.path, ".thinkube");
  const target = r.boardDir; // central namespace dir (boards.root is set)
  if (path.resolve(target) === path.resolve(coLocated)) {
    vscode.window.showErrorMessage(
      `${r.name}: the board root resolves to the repo's own .thinkube/ — nothing to migrate.`,
    );
    return;
  }
  const hasCoLocated = await fs
    .stat(coLocated)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!hasCoLocated) {
    vscode.window.showInformationMessage(
      `${r.name} has no co-located .thinkube/ board to migrate.`,
    );
    return;
  }
  try {
    const { files } = await migrateBoardDir(coLocated, target);
    deps.provider.refresh();
    vscode.window.showInformationMessage(
      `Migrated ${r.name}'s board (${files} files) to the sidecar at ${target}. ` +
        `Commit the removal in the repo and the addition in the board repo.`,
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Migrate ${r.name} failed: ${(err as Error).message}`,
    );
  }
}

async function enableHere(deps: BoardDeps, r: RepoEntry): Promise<void> {
  if (r.enabled) {
    vscode.window.showInformationMessage(
      `${r.name} already has a Tandem board.`,
    );
    return;
  }
  // Scaffold the board at its resolved board dir — central
  // `<board-root>/<namespace>` when configured, else co-located. The bundle
  // (.claude/CLAUDE.md/.mcp.json) still installs into the repo below.
  const base = r.boardDir;
  for (const sub of ["specs", "decisions", "retros"]) {
    await fs.mkdir(path.join(base, sub), { recursive: true });
    // .gitkeep so the empty dir is committable — the board is the committed tree.
    await fs.writeFile(path.join(base, sub, ".gitkeep"), "");
  }
  // ADR-0006: enable = the .thinkube/ skeleton + the per-repo methodology
  // bundle (skills, agents, .mcp.json server entry), via BundleInstaller.
  await vscode.commands.executeCommand("thinkube.kanban.installBundle", r.path);
  deps.provider.refresh();
  const action = await vscode.window.showInformationMessage(
    `Enabled the Tandem methodology in ${r.name}. Commit .thinkube/ and start adding specs.`,
    "Open board",
  );
  if (action === "Open board") {
    await vscode.commands.executeCommand("thinkube.boards.open", {
      ...r,
      enabled: true,
    });
  }
}
