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
  | { kind: "create-task"; columnId: string; title: string }
  | { kind: "set-due"; number: number; date: string | null }
  | { kind: "set-parent"; number: number }
  | { kind: "group"; childNumbers: number[] }
  | { kind: "open-detail"; number: number };

export type ModeFlag = "navigator" | "driver" | "both";

export type HostMessage =
  | { kind: "state"; board: Board; mode: ModeFlag }
  | { kind: "external-change"; board: Board; mode: ModeFlag };
