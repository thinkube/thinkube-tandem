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
    issueNumber: number,
    fields: { title?: string; body?: string },
  ): Promise<void>;
  /**
   * Create a new Task issue and place it on the board in the given column.
   * Optional — adapters not backed by a real issue tracker omit it.
   */
  createTask?(columnId: string, title: string): Promise<void>;
  /** Set/clear a card's due date (board DATE field). Optional. */
  setDueDate?(issueNumber: number, date: string | null): Promise<void>;
  /** Candidate parent Specs to attach an issue under. Optional. */
  listParentSpecs?(): Promise<
    Array<{ number: number; title: string; nodeId: string }>
  >;
  /** Attach an issue under a parent (sub-issue link). Optional. */
  setParent?(childNumber: number, parentNodeId: string): Promise<void>;
  /**
   * Promote a set of issues into a full Epic→Story→Spec chain (placeholders),
   * link them as Tasks under the Spec, and place them on the board. Returns
   * the created issue numbers.
   */
  promoteToChain?(
    title: string,
    childNumbers: number[],
  ): Promise<{ epic: number; story: number; spec: number }>;
  /** Optional event for adapters that observe out-of-band changes. */
  readonly onExternalChange?: vscode.Event<Board>;
  /** Adapter-supplied label used in the panel title. */
  readonly scope: string;
}
