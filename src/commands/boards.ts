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
import { KanbanPanel } from "../views/kanban/host/Panel";
import { ThinkubeFilesAdapter } from "../views/kanban/host/storage/ThinkubeFilesAdapter";
import { decodeCardNumber } from "../views/kanban/host/storage/sliceBoard";
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
    vscode.commands.registerCommand(
      "thinkube.boards.newClaudeSession",
      (r: RepoEntry) => deps.launcher.openHere(vscode.Uri.file(r.path)),
    ),
    vscode.commands.registerCommand(
      "thinkube.boards.resumeClaudeSession",
      (r: RepoEntry) => resumeClaudeSession(deps, r),
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
  const store = new ThinkubeStore(r.path);
  store.activate();
  context.subscriptions.push(store);
  const adapter = new ThinkubeFilesAdapter(store, r.name);
  adapter.watchExternal();
  await KanbanPanel.open({
    extensionUri: deps.extensionUri,
    adapter,
    output: deps.output,
    // A card's "detail" is its slice file open in the editor.
    openDetail: async (issueNumber: number) => {
      const { specNumber, sliceNumber } = decodeCardNumber(issueNumber);
      const rel = store.pathForSlice(specNumber, sliceNumber);
      await vscode.window.showTextDocument(
        vscode.Uri.file(path.join(store.thinkubeDir, rel)),
      );
    },
  });
}

async function enableHere(deps: BoardDeps, r: RepoEntry): Promise<void> {
  if (r.enabled) {
    vscode.window.showInformationMessage(
      `${r.name} already has a Tandem board.`,
    );
    return;
  }
  const base = path.join(r.path, ".thinkube");
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
