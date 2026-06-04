/**
 * Mirror of `webview/kanban/src/types.ts`. Hand-kept in sync — the same
 * shapes cross the postMessage boundary, but they live in two TS modules
 * because the build settings differ (CJS extension vs. ESM webview).
 *
 * If you edit one, edit the other. The webview side is authoritative for
 * data shape; the host side is authoritative for message names.
 */

export interface TaskCard {
  id: string;
  description: string;
  body?: string;
  columnId: string;
  colorSlug?: string;
  issueNumber?: number;
  epicNumber?: number;
  /** Parent Spec issue number (for the SP-{n} chip + colour grouping). */
  parentNumber?: number;
  updatedAt?: string;
  /** Parent Spec changed more recently than this task → may need review. */
  specStale?: boolean;
  /** Board "Due" date (ISO yyyy-mm-dd), if set. */
  dueDate?: string;
  /** Board "Priority" single-select value (P0–P3), if set. */
  priority?: string;
  /** How the parent Spec last changed relative to this task (SP-86). */
  specChange?: "none" | "metadata" | "requirements";
  /** Delivery provenance captured when the slice entered Done (SP-2): commit SHA. */
  commit?: string;
  /** Full URL to `commit` on the remote host, derived from the git remote. */
  commitUrl?: string;
  /** Pull-request URL carrying the slice. */
  pr?: string;
}

export interface BoardColumn {
  id: string;
  title: string;
  archived?: boolean;
  tasksIds: string[];
}

export interface Board {
  columns: BoardColumn[];
  tasks: Record<string, TaskCard>;
  scope: string;
}

export type WebviewMessage =
  | { kind: "load" }
  | { kind: "save"; board: Board }
  | { kind: "notify"; level: "info" | "warn" | "error"; text: string }
  | { kind: "update-task"; number: number; title?: string; body?: string }
  | { kind: "set-due"; number: number; date: string | null }
  | { kind: "open-detail"; number: number }
  /** Open a commit/PR link in the user's browser (host guards to http(s)). */
  | { kind: "open-external"; url: string }
  /** "New Spec" header button — host opens a Claude session with /spec-prepare prefilled. */
  | { kind: "create-spec" };

export type ModeFlag = "navigator" | "driver" | "both";

export type HostMessage =
  | { kind: "state"; board: Board; mode: ModeFlag }
  | { kind: "external-change"; board: Board; mode: ModeFlag };
