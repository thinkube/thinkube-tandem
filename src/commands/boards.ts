/**
 * Per-repo board commands (thinkube.boards.*) — the navigator's actions.
 *
 * `open` builds a ThinkubeStore + ThinkubeFilesAdapter scoped to the selected
 * repo and opens its board (KanbanPanel is singleton-by-scope, so each repo's
 * board is its own panel). `enable` scaffolds a committable `.thinkube/`
 * skeleton so a repo becomes methodology-enabled (ADR-0006). No single-binding
 * settings — the repo path comes from the navigator selection.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

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
  );
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
