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
  epicNumber?: number;
  /** Parent Spec id — the `SP-{id}` chip + colour grouping (SP-7: opaque string). */
  parentId?: string;
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
  /** Spec-level close card (TEP-0010), auto-derived — not a slice file. */
  isAcceptance?: boolean;
  /** Close card only: the Spec has been accepted (rests in Done as a record). */
  accepted?: boolean;
  /** Close card only: every slice Done + every AC checked → "Approve & close" enabled. */
  acceptReady?: boolean;
  /** Close card only: the Spec's `## Acceptance Criteria` as a checklist. */
  acceptanceCriteria?: { label: string; checked: boolean }[];
  /** Close card only: slices Done / total, for the progress line. */
  slicesDone?: number;
  slicesTotal?: number;
  /** Dependency handles (slice-DAG edges) for the control-center graph (SP-tgs8nz). */
  dependsOn?: string[];
  /** A live `claude -p` worker is running on this slice (control-center graph tag). */
  running?: boolean;
  /** Clustering tags — the #hashtag mesh (SP-tgvil2). Effective set (folds legacy `theme`). */
  tags?: string[];
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
  /** Panel key + fallback label. */
  scope: string;
  /** Display title — the thinking space name (SP-tgs8nz). */
  title?: string;
  /** Display subtitle — the Spec's description (spec-scoped board). */
  subtitle?: string;
}

export type WebviewMessage =
  | { kind: "load" }
  | { kind: "save"; board: Board }
  | { kind: "notify"; level: "info" | "warn" | "error"; text: string }
  | { kind: "update-task"; id: string; title?: string; body?: string }
  | { kind: "set-due"; id: string; date: string | null }
  | { kind: "open-detail"; id: string }
  /** Open a commit/PR link in the user's browser (host guards to http(s)). */
  | { kind: "open-external"; url: string }
  /** Accept a Spec (TEP-0010): host runs the gate + accept_spec, then merges the PR. */
  | { kind: "accept-spec"; spec: string }
  /** Float a running session out into a panel (clicked on the control-center graph). */
  | { kind: "float-out"; handle: string };

export type ModeFlag = "navigator" | "driver" | "both";

export type HostMessage =
  | { kind: "state"; board: Board; mode: ModeFlag }
  | { kind: "external-change"; board: Board; mode: ModeFlag };
