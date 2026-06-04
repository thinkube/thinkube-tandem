/**
 * Kanban commands (thinkube.kanban.*).
 *
 * Files-first surface: open the Tandem board (rendered over the repo's
 * committed `.thinkube/specs/SP-{n}/SL-{m}.md` slice files via
 * `ThinkubeFilesAdapter`) and a refresh nudge. The board's source of truth is
 * the files; GitHub is no longer read here.
 */
import * as path from "node:path";

import * as vscode from "vscode";

import { AuthService } from "../github/AuthService";
import { GitHubService } from "../github/GitHubService";
import { ThinkubeStore } from "../store/ThinkubeStore";
import { InMemoryAdapter } from "../views/kanban/host/InMemoryAdapter";
import { KanbanPanel } from "../views/kanban/host/Panel";
import { StorageAdapter } from "../views/kanban/host/StorageAdapter";
import { ThinkubeFilesAdapter } from "../views/kanban/host/storage/ThinkubeFilesAdapter";
import { decodeCardNumber } from "../views/kanban/host/storage/sliceBoard";

interface KanbanDeps {
  // Retained for now so extension.ts wiring is untouched; the files-first
  // board no longer reads GitHub, but the inbox + auth stack still hangs here.
  auth: AuthService;
  github: GitHubService;
  output: vscode.OutputChannel;
  store: ThinkubeStore | undefined;
  extensionUri: vscode.Uri;
}

export function registerKanbanCommands(
  context: vscode.ExtensionContext,
  deps: KanbanDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.kanban.openKanban", () =>
      openKanban(deps),
    ),
    vscode.commands.registerCommand("thinkube.kanban.refreshFromGitHub", () =>
      refreshFromGitHub(deps),
    ),
  );
}

/**
 * Drops cached client + classifier state so the next read re-fetches from
 * GitHub. If the kanban panel is open, the user re-triggers a load by closing
 * and reopening it.
 */
async function refreshFromGitHub(deps: KanbanDeps): Promise<void> {
  deps.github.invalidate();
  deps.output.appendLine("[refreshFromGitHub] caches dropped");
  vscode.window.showInformationMessage(
    "GitHub state refreshed. Reopen the Kanban panel to pull fresh project state.",
  );
}

async function openKanban(deps: KanbanDeps): Promise<void> {
  const adapter = await pickAdapter(deps);
  if (!adapter) return;
  const store = deps.store;
  try {
    await KanbanPanel.open({
      extensionUri: deps.extensionUri,
      adapter,
      output: deps.output,
      // Files-first: a card's "detail" is its slice file open in the editor.
      openDetail: store
        ? async (issueNumber: number) => {
            const { specNumber, sliceNumber } = decodeCardNumber(issueNumber);
            const rel = store.pathForSlice(specNumber, sliceNumber);
            await vscode.window.showTextDocument(
              vscode.Uri.file(path.join(store.thinkubeDir, rel)),
            );
          }
        : undefined,
    });
  } catch (err) {
    deps.output.appendLine(`[openKanban] failed: ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Failed to open kanban: ${(err as Error).message}`,
    );
  }
}

/**
 * Resolve which adapter to use: the files-backed ThinkubeFilesAdapter when a
 * methodology root is wired, otherwise the in-memory demo board.
 */
async function pickAdapter(
  deps: KanbanDeps,
): Promise<StorageAdapter | undefined> {
  // Files-first (ADR-0001/0007): render the board over the repo's committed
  // .thinkube/ via ThinkubeFilesAdapter whenever a methodology root is wired.
  if (deps.store) {
    const scope = path.basename(deps.store.workspaceRoot) || "Tandem board";
    const adapter = new ThinkubeFilesAdapter(deps.store, scope);
    adapter.watchExternal();
    return adapter;
  }
  // No methodology root yet → the in-memory demo board.
  return new InMemoryAdapter();
}
