/**
 * Shared types between the webview and the host. Kept in sync by hand with
 * `src/views/kanban/host/types.ts` — these are not the same file (one is ESM
 * for the React build, the other CJS for the extension), but the shapes must
 * stay aligned because they cross the postMessage boundary.
 *
 * Data model (informed by the upstream trello-kanban repo — see UPSTREAM.md):
 *
 *   Board → ordered list of Columns; tasks live in a flat dict keyed by id.
 *   Each Column owns an ordered `tasksIds` array referencing the dict.
 *
 * The flat-dict design lets a single task move between columns by just
 * updating the index arrays — no deep nesting copy.
 *
 * Color semantics (chunk 5 placeholder): each task carries an optional
 * `colorSlug` referencing one of the discrete palette entries. In chunk 7,
 * that slug gets derived deterministically from the task's parent epic so
 * tasks under the same epic share a color.
 */
export interface TaskCard {
  id: string;
  /** The issue title — the card's heading. */
  description: string;
  /** The issue body (markdown) — shown under the title and editable. */
  body?: string;
  columnId: string;
  /** Discrete palette slug; see `utils/palette.ts`. */
  colorSlug?: string;
  /** Optional epic ancestry (chunk 7 wires this through). */
  epicNumber?: number;
  /** Parent Spec id — shown as an SP-{id} chip; drives card colour (SP-7). */
  parentId?: string;
  /** ISO timestamp of the issue's last update, for the card's "updated N ago". */
  updatedAt?: string;
  /** Parent Spec changed after this task was last touched → review badge. */
  specStale?: boolean;
  /** Board "Due" date (ISO yyyy-mm-dd), editable on the card. */
  dueDate?: string;
  /** Board "Priority" single-select value (P0–P3) — shown as a chip. */
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
  /** A live `claude -p` worker is running on this slice — graph running tag. */
  running?: boolean;
}

export interface BoardColumn {
  id: string;
  title: string;
  /** Whether the column is hidden from the main flow but kept for archive. */
  archived?: boolean;
  /** Order matters; tasks render in this order within the column. */
  tasksIds: string[];
}

export interface Board {
  columns: BoardColumn[];
  tasks: Record<string, TaskCard>;
  /** Human label shown in the panel title — usually a repo/project name. */
  scope: string;
}

/**
 * Messages exchanged between the host and the webview. The host owns the
 * storage adapter; the webview is a thin renderer that asks for state and
 * pushes mutations.
 */
export type WebviewMessage =
  | { kind: "load" }
  | { kind: "save"; board: Board }
  | { kind: "notify"; level: "info" | "warn" | "error"; text: string }
  /** Inline card edit — write the issue title (and/or body) back to GitHub. */
  | { kind: "update-task"; id: string; title?: string; body?: string }
  /** Set or clear (null) a card's due date. */
  | { kind: "set-due"; id: string; date: string | null }
  /** Open the full card-detail panel for an issue. */
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
