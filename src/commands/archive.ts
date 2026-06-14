/**
 * Archive / unarchive commands for Specs and TEPs (TEP-tg86v7).
 *
 * Archiving is a manual, reversible frontmatter flag (`archived: true`) — the
 * file never moves or is deleted. The Specs/TEPs nav providers hide archived
 * items by default; a per-view "Show archived" toggle reveals them (marked).
 *
 * This module owns two things:
 *   - the Archive / Unarchive write actions, which read-modify-write the flag
 *     through the board-aware ThinkubeStore (mirroring accept_spec's stamp); and
 *   - the per-view "Show archived" toggle — provider state + persisted
 *     `workspaceState` + a `when`-clause context key, seeded at activation. This
 *     is the same shape as the configured-only filter (see `seedBoardsFilter`).
 */
import * as vscode from "vscode";

import { ThinkubeStore } from "../store/ThinkubeStore";
import { SpecsProvider, SpecNode } from "../views/boards/SpecsProvider";
import { TepsProvider, TepNode } from "../views/boards/TepsProvider";

interface ArchiveDeps {
  specsProvider: SpecsProvider;
  tepsProvider: TepsProvider;
}

/**
 * Per-view keys, each reused for both the persisted `workspaceState` flag and
 * the `when`-clause context key that swaps the title-bar "Show/Hide archived"
 * icon.
 */
const SPECS_SHOW_ARCHIVED_KEY = "thinkube.specs.showArchived";
const TEPS_SHOW_ARCHIVED_KEY = "thinkube.teps.showArchived";

/** Apply a view's "Show archived" choice everywhere it's observed: the provider
 *  (re-renders), persisted `workspaceState` (survives reloads), and the context
 *  key (swaps the title-bar icon). */
function applyShowArchived(
  context: vscode.ExtensionContext,
  key: string,
  setOnProvider: (value: boolean) => void,
  value: boolean,
): void {
  setOnProvider(value);
  void context.workspaceState.update(key, value);
  void vscode.commands.executeCommand("setContext", key, value);
}

/** Restore both views' "Show archived" toggles from persisted state at
 *  activation, so the icon and the list match the choice saved before reload. */
export function seedArchivedFilters(
  context: vscode.ExtensionContext,
  deps: ArchiveDeps,
): void {
  applyShowArchived(
    context,
    SPECS_SHOW_ARCHIVED_KEY,
    (v) => deps.specsProvider.setShowArchived(v),
    context.workspaceState.get<boolean>(SPECS_SHOW_ARCHIVED_KEY, false),
  );
  applyShowArchived(
    context,
    TEPS_SHOW_ARCHIVED_KEY,
    (v) => deps.tepsProvider.setShowArchived(v),
    context.workspaceState.get<boolean>(TEPS_SHOW_ARCHIVED_KEY, false),
  );
}

/** Flip a board file's `archived` frontmatter flag in place (TEP-tg86v7). The
 *  file never moves; absence of the flag means not-archived, so unarchive drops
 *  the key entirely rather than writing `archived: false`. */
async function setArchived(
  store: ThinkubeStore,
  rel: string,
  archived: boolean,
): Promise<void> {
  const doc = await store.getFile(rel);
  if (!doc) throw new Error(`No file at ${rel}.`);
  const fm = { ...doc.frontmatter };
  if (archived) fm.archived = true;
  else delete fm.archived;
  await store.writeFile(rel, fm, doc.body);
}

/** Board-relative paths of completed-but-unarchived specs (SP-tgn2pd). A spec
 *  is "completed" when it carries the `accepted:` stamp (the human acceptance
 *  gate, TEP-0010) — not merely "all slices done". */
async function completedSpecPaths(store: ThinkubeStore): Promise<string[]> {
  const out: string[] = [];
  for (const n of await store.listSpecDirs()) {
    const rel = store.pathForSpecDoc(n);
    const fm = (await store.getFile(rel))?.frontmatter;
    if (!fm || fm.archived === true) continue;
    if (fm.accepted) out.push(rel); // any truthy `accepted` stamp = completed
  }
  return out;
}

/** Completed-but-unarchived TEPs (SP-tgn2pd): `status:` of `accepted` or
 *  `superseded` (proposed → accepted → superseded). */
async function completedTepPaths(store: ThinkubeStore): Promise<string[]> {
  const out: string[] = [];
  for (const { relativePath: rel } of await store.listTeps()) {
    const fm = (await store.getFile(rel))?.frontmatter;
    if (!fm || fm.archived === true) continue;
    const status = typeof fm.status === "string" ? fm.status.toLowerCase() : "";
    if (status === "accepted" || status === "superseded") out.push(rel);
  }
  return out;
}

/** Confirm-then-archive a whole set of completed board items at once
 *  (SP-tgn2pd). Reuses the per-item reversible `archived: true` flag; reports a
 *  count, or a no-op note when nothing qualifies. */
async function bulkArchive(
  store: ThinkubeStore,
  paths: string[],
  noun: string,
  refresh: () => void,
): Promise<void> {
  const plural = (n: number) => (n === 1 ? noun : `${noun}s`);
  if (paths.length === 0) {
    vscode.window.showInformationMessage(
      `Nothing to archive — no completed ${noun}s are unarchived.`,
    );
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Archive ${paths.length} completed ${plural(paths.length)}?`,
    { modal: true },
    "Archive",
  );
  if (confirm !== "Archive") return;
  for (const rel of paths) await setArchived(store, rel, true);
  refresh();
  vscode.window.showInformationMessage(
    `Archived ${paths.length} completed ${plural(paths.length)}.`,
  );
}

export function registerArchiveCommands(
  context: vscode.ExtensionContext,
  deps: ArchiveDeps,
): void {
  const setSpecArchived = async (
    node: SpecNode | undefined,
    archived: boolean,
  ): Promise<void> => {
    const repo = deps.specsProvider.repoEntry;
    if (!repo || !node || node.kind !== "spec") return;
    try {
      const store = new ThinkubeStore(repo.path, repo.boardDir);
      await setArchived(store, store.pathForSpecDoc(node.specNumber), archived);
      deps.specsProvider.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Couldn't ${archived ? "archive" : "unarchive"} SP-${node.specNumber}: ${(err as Error).message}`,
      );
    }
  };

  const setTepArchived = async (
    node: TepNode | undefined,
    archived: boolean,
  ): Promise<void> => {
    const repo = deps.tepsProvider.repoEntry;
    if (!repo || !node || node.kind !== "tep") return;
    try {
      const store = new ThinkubeStore(repo.path, repo.boardDir);
      // A TEP file may be slugged; resolve the real path, else the canonical one.
      const rel =
        (await store.findTep(node.tepId)) ?? store.pathForTep(node.tepId);
      await setArchived(store, rel, archived);
      deps.tepsProvider.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(
        `Couldn't ${archived ? "archive" : "unarchive"} TEP-${node.tepId}: ${(err as Error).message}`,
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube.specs.archive", (n: SpecNode) =>
      setSpecArchived(n, true),
    ),
    vscode.commands.registerCommand("thinkube.specs.unarchive", (n: SpecNode) =>
      setSpecArchived(n, false),
    ),
    vscode.commands.registerCommand("thinkube.teps.archive", (n: TepNode) =>
      setTepArchived(n, true),
    ),
    vscode.commands.registerCommand("thinkube.teps.unarchive", (n: TepNode) =>
      setTepArchived(n, false),
    ),
    vscode.commands.registerCommand("thinkube.specs.showArchived", () =>
      applyShowArchived(
        context,
        SPECS_SHOW_ARCHIVED_KEY,
        (v) => deps.specsProvider.setShowArchived(v),
        true,
      ),
    ),
    vscode.commands.registerCommand("thinkube.specs.hideArchived", () =>
      applyShowArchived(
        context,
        SPECS_SHOW_ARCHIVED_KEY,
        (v) => deps.specsProvider.setShowArchived(v),
        false,
      ),
    ),
    vscode.commands.registerCommand("thinkube.teps.showArchived", () =>
      applyShowArchived(
        context,
        TEPS_SHOW_ARCHIVED_KEY,
        (v) => deps.tepsProvider.setShowArchived(v),
        true,
      ),
    ),
    vscode.commands.registerCommand("thinkube.teps.hideArchived", () =>
      applyShowArchived(
        context,
        TEPS_SHOW_ARCHIVED_KEY,
        (v) => deps.tepsProvider.setShowArchived(v),
        false,
      ),
    ),
    // Bulk archive (SP-tgn2pd): archive every completed-but-unarchived item in
    // one confirmed action, from the view title bar.
    vscode.commands.registerCommand(
      "thinkube.specs.archiveAllCompleted",
      async () => {
        const repo = deps.specsProvider.repoEntry;
        if (!repo) return;
        try {
          const store = new ThinkubeStore(repo.path, repo.boardDir);
          await bulkArchive(
            store,
            await completedSpecPaths(store),
            "spec",
            () => deps.specsProvider.refresh(),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Couldn't archive completed specs: ${(err as Error).message}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "thinkube.teps.archiveAllCompleted",
      async () => {
        const repo = deps.tepsProvider.repoEntry;
        if (!repo) return;
        try {
          const store = new ThinkubeStore(repo.path, repo.boardDir);
          await bulkArchive(store, await completedTepPaths(store), "TEP", () =>
            deps.tepsProvider.refresh(),
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Couldn't archive completed TEPs: ${(err as Error).message}`,
          );
        }
      },
    ),
  );
}
