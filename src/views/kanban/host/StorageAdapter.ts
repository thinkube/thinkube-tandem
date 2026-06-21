/**
 * Storage strategy for the kanban panel.
 *
 * The vendored React app is unaware of where the board lives — it just asks
 * the host for state and pushes saves. The host plugs in one of several
 * adapters depending on how the panel was opened:
 *
 *   - `InMemoryAdapter` (chunk 5) — seeded demo data, save is a no-op.
 *   - `GitHubProjectsAdapter` (chunk 7) — Projects v2 backed, two-way sync.
 *   - future adapters (file-based, multi-board, etc.) slot in here without
 *     touching the React or the Panel.
 *
 * `onExternalChange` is the inbound event the GitHub adapter will fire when
 * polling detects a server-side change so the webview can re-render. Adapters
 * that don't need it can omit the property entirely.
 */
import * as vscode from "vscode";
import { Board } from "./types";

export interface StorageAdapter {
  load(): Promise<Board>;
  save(board: Board): Promise<void>;
  /**
   * Edit the issue behind a card (inline title edit, or body from the detail
   * panel) and write it through to the backing store. Optional so adapters
   * that don't back onto editable issues can omit it.
   */
  updateIssue?(
    id: string,
    fields: { title?: string; body?: string },
  ): Promise<void>;
  /** Set/clear a card's due date (board DATE field). Optional. */
  setDueDate?(id: string, date: string | null): Promise<void>;
  /** Optional event for adapters that observe out-of-band changes. */
  readonly onExternalChange?: vscode.Event<Board>;
  /** Adapter-supplied label used in the panel title. */
  readonly scope: string;
  /** The backing board's identity (root repo, sidecar board dir, display name), so a command
   *  triggered from THIS panel acts on its board rather than the ambient sidebar selection.
   *  Optional — the in-memory demo adapter omits it. */
  boardContext?(): { root: string; boardDir: string; name: string };
}
