/**
 * Mirror of `webview/kanban/src/types.ts`. Hand-kept in sync — the same
 * shapes cross the postMessage boundary, but they live in two TS modules
 * because the build settings differ (CJS extension vs. ESM webview).
 *
 * If you edit one, edit the other. The webview side is authoritative for
 * data shape; the host side is authoritative for message names.
 */

import type { ExitAction } from "../../../services/orchestratorCore";

/**
 * An execution-unit node: a slice's work units expanded to the
 * scheduler's execution units, so the control-center graph shows a node per worker
 * even before dispatch. `id` matches the live `runningWorkers`/`parkedWorkers` keys
 * (the Agent SDK worker/session key the scheduler dispatches and `float-out` opens).
 */
export interface WorkUnitNode {
  /** `${sliceHandle}#eu-${i}`, or the slice handle for a unit-less (legacy) slice. */
  id: string;
  /** Execution shape of the batched unit. */
  shape: "serial" | "mechanize" | "fan-out";
  /** The unit's task text (the worker's prompt), for the node label. */
  note?: string;
  /** Unit/slice handles this unit waits on (work-unit DAG edges). */
  dependsOn?: string[];
}

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
  /** Thinking Space "Due" date (ISO yyyy-mm-dd), if set. */
  dueDate?: string;
  /** Thinking Space "Priority" single-select value (P0–P3), if set. */
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
  /** Close card only: the Spec is superseded (SP-6/14) — its Orchestrate action is disabled. */
  superseded?: boolean;
  /** Close card only: the Spec's `## Acceptance Criteria` as a checklist. */
  acceptanceCriteria?: { label: string; checked: boolean }[];
  /** Close card only: slices Done / total, for the progress line. */
  slicesDone?: number;
  slicesTotal?: number;
  /** Dependency handles (slice-DAG edges) for the control-center graph. */
  dependsOn?: string[];
  /** A live worker is running on this slice (control-center graph tag). */
  running?: boolean;
  /** The live worker (execution-unit) ids running on this slice — a node per worker (SL-4). */
  runningWorkers?: string[];
  /** The parked worker (execution-unit) ids awaiting an answer on this slice — needs-input (SL-3). */
  parkedWorkers?: string[];
  /** Execution-unit ids that completed successfully — the graph colours their node done (lime). */
  doneWorkers?: string[];
  /** The slice's execution-unit nodes — a node per worker, shown idle before
   *  dispatch and coloured live via `runningWorkers`/`parkedWorkers` (ids align). */
  workUnits?: WorkUnitNode[];
  /** Clustering tags — the #hashtag mesh. Effective set (folds legacy `theme`). */
  tags?: string[];
}

export interface ThinkingSpaceColumn {
  id: string;
  title: string;
  archived?: boolean;
  tasksIds: string[];
}

export interface ThinkingSpace {
  columns: ThinkingSpaceColumn[];
  tasks: Record<string, TaskCard>;
  /** Panel key + fallback label. */
  scope: string;
  /** Display title — the thinking space name. */
  title?: string;
  /** Display subtitle — the Spec's description (spec-scoped thinking space). */
  subtitle?: string;
}

export type WebviewMessage =
  | { kind: "load" }
  | { kind: "save"; thinkingSpace: ThinkingSpace }
  | { kind: "notify"; level: "info" | "warn" | "error"; text: string }
  | { kind: "update-task"; id: string; title?: string; body?: string }
  | { kind: "set-due"; id: string; date: string | null }
  | { kind: "open-detail"; id: string }
  /** Open a commit/PR link in the user's browser (host guards to http(s)). */
  | { kind: "open-external"; url: string }
  /** Accept a Spec (TEP-0010): host runs the gate + accept_spec, then merges the PR. */
  | { kind: "accept-spec"; spec: string }
  /** Float a running session out into a panel (clicked on the control-center graph). */
  | { kind: "float-out"; handle: string }
  | { kind: "attend"; handle: string }
  /** Start the makespan scheduler on a Spec (the ▶ button on the control-center graph). */
  | { kind: "orchestrate"; spec: string }
  /** Accept the delivered Spec: host runs the gated merge spec/SP-{n} → main. */
  | { kind: "accept"; spec: string }
  /** Reject the delivered Spec: open a Claude session primed with the delivery report. */
  | { kind: "reject"; spec: string }
  /**
   * Re-run a stalled delivery's exit set (SP-11/2, `rerun`): re-dispatch the makespan
   * scheduler on the Spec — identical to `orchestrate`, surfaced as a state-derived exit.
   */
  | { kind: "rerun"; spec: string }
  /** Stop ONE spec's in-flight run (the ■ button that replaces ▶ while running). */
  | { kind: "stop-orchestration"; spec: string };

export type ModeFlag = "navigator" | "driver" | "both";

export type HostMessage =
  | { kind: "state"; thinkingSpace: ThinkingSpace; mode: ModeFlag }
  | { kind: "external-change"; thinkingSpace: ThinkingSpace; mode: ModeFlag }
  /**
   * A Spec's state-derived delivery exit set (SP-11/2): the exact `ExitAction`
   * ids + labels from `deliveryExitState`, forwarded so the webview renders and
   * dispatches buttons from THEM (never hardcoded labels). Re-posted on every
   * state push, so it doubles as the status event that reconciles the button
   * model — clearing any pending action and re-enabling the exits.
   */
  | { kind: "delivery-exits"; spec: string; exits: ExitAction[] }
  /**
   * The specs (tep-qualified handles, `TEP-n_SP-m`) with an orchestration run in
   * flight — pushed on every registry change AND every state push, so the graph's
   * per-spec ▶/■ toggle reflects the live run set without a window reload.
   */
  | { kind: "running-orchestrations"; specs: string[] };
