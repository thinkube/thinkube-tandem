/**
 * GitHubProjectsAdapter — kanban storage backed by GitHub Projects v2.
 *
 * Maps the six methodology columns (Spec / Ready / In Progress / Review /
 * Verify / Done) to the single-select Status field options on a configured
 * project. Load pulls items; save pushes Status changes for cards that
 * moved between columns.
 *
 * Diff strategy: we keep the last-loaded `Board` snapshot in memory. On
 * `save(board)`, we compare per-task `columnId` and push only the differences.
 * Reorderings inside a column don't produce mutations — Projects v2 has a
 * separate position field that this adapter doesn't touch yet.
 *
 * Failure handling: the webview applies drags optimistically. If a status
 * mutation fails (network, rate limit, permission), we reload fresh state
 * from GitHub and emit `onExternalChange` so the webview snaps back to the
 * server's view of the world. The user sees a toast with the failure reason.
 *
 * Coloring (chunk-5 design preview): tasks here ship with `colorSlug:
 * "neutral"`. Resolving the parent-epic ancestry to derive per-task colors
 * requires walking sub-issue parents up to depth 3 and is deferred — the
 * acceptance criterion (drag → Status mutation) lands cleanly first.
 */
import * as vscode from "vscode";

import {
  GitHubService,
  IssueSummary,
  ProjectInfo,
  ProjectItem,
  RepoCoords,
  StatusField,
} from "../../../../github/GitHubService";
import {
  GateFailedError,
  gateForTransition,
  gateInProgressToReview,
  gateReviewToVerify,
  gateSpecToReady,
} from "../../../../methodology/qualityGates";
import { StorageAdapter } from "../StorageAdapter";
import { Board, BoardColumn, TaskCard } from "../types";

const COLUMN_DEFS: ReadonlyArray<{
  id: string;
  title: string;
  status: string;
  /** GitHub Projects option colour used only when auto-creating the option. */
  color: string;
}> = [
  { id: "column-spec", title: "Spec", status: "Spec", color: "GRAY" },
  { id: "column-ready", title: "Ready", status: "Ready", color: "BLUE" },
  {
    id: "column-in-progress",
    title: "In Progress",
    status: "In Progress",
    color: "YELLOW",
  },
  { id: "column-review", title: "Review", status: "Review", color: "ORANGE" },
  { id: "column-verify", title: "Verify", status: "Verify", color: "PINK" },
  { id: "column-done", title: "Done", status: "Done", color: "GREEN" },
];

const EXPECTED_STATUSES = COLUMN_DEFS.map((c) => c.status);

/**
 * The methodology Status options in canonical order, with the colour to use
 * when an option has to be created. Passed to
 * `GitHubService.ensureSingleSelectOptions` to auto-provision boards.
 */
export const METHODOLOGY_OPTIONS: ReadonlyArray<{
  name: string;
  color: string;
}> = COLUMN_DEFS.map((c) => ({ name: c.status, color: c.color }));

/**
 * The methodology Priority options (P0–P3) in canonical order, with the colour
 * + description used when an option has to be created. Kept in sync with
 * `GitHubService.enforceSchema` (the authoritative creator at Configure time) —
 * the adapter only tops up missing options on each board load.
 */
export const PRIORITY_OPTIONS: ReadonlyArray<{
  name: string;
  color: string;
  description: string;
}> = [
  { name: "P0", color: "RED", description: "Critical" },
  { name: "P1", color: "ORANGE", description: "High" },
  { name: "P2", color: "YELLOW", description: "Normal" },
  { name: "P3", color: "GRAY", description: "Low" },
];

const EXPECTED_PRIORITIES = PRIORITY_OPTIONS.map((p) => p.name);

/** Synthetic, non-status column holding untracked issues awaiting triage. */
const INBOX_COLUMN_ID = "column-inbox";

/**
 * Deterministic colour slug for a card, grouped by its parent Spec so tasks of
 * the same spec share a colour. Must match the assignable slugs (and order) in
 * the webview's `utils/palette.ts`. Cards with no parent get "neutral".
 */
const ASSIGNABLE_SLUGS = [
  "crimson",
  "amber",
  "lime",
  "teal",
  "azure",
  "indigo",
  "violet",
  "magenta",
  "slate",
];
/**
 * A task is "stale" when its parent Spec was updated more recently than the
 * task itself — the spec changed after the task was last touched, so the task
 * may no longer match it and the pair should review it. Coarse on purpose (any
 * spec edit flags its tasks); a "look again" nudge, not a hard signal.
 */
function isSpecStale(
  parentUpdatedAt: string | undefined,
  taskUpdatedAt: string | undefined,
): boolean {
  if (!parentUpdatedAt || !taskUpdatedAt) return false;
  const p = Date.parse(parentUpdatedAt);
  const t = Date.parse(taskUpdatedAt);
  return Number.isFinite(p) && Number.isFinite(t) && p > t;
}

function slugForParent(parentNumber: number | undefined): string {
  if (
    parentNumber == null ||
    !Number.isFinite(parentNumber) ||
    parentNumber <= 0
  ) {
    return "neutral";
  }
  return ASSIGNABLE_SLUGS[Math.floor(parentNumber) % ASSIGNABLE_SLUGS.length];
}

export interface GitHubProjectsAdapterOptions {
  coords: RepoCoords;
  projectNumber: number;
  github: GitHubService;
  output: vscode.OutputChannel;
}

export class StatusFieldMisconfiguredError extends Error {
  constructor(
    public readonly missing: string[],
    public readonly present: string[],
  ) {
    super(
      `Project Status field is missing required options: ${missing.join(", ")}. Run "Thinkube Kanban: Configure Project".`,
    );
    this.name = "StatusFieldMisconfiguredError";
  }
}

export class GitHubProjectsAdapter implements StorageAdapter {
  private readonly _onExternalChange = new vscode.EventEmitter<Board>();
  readonly onExternalChange = this._onExternalChange.event;

  private readonly github: GitHubService;
  private readonly coords: RepoCoords;
  private readonly projectNumber: number;
  private readonly output: vscode.OutputChannel;

  private projectInfo: ProjectInfo | undefined;
  private statusField: StatusField | undefined;
  /** Internal column id → Status option id. */
  private optionIdByColumnId = new Map<string, string>();
  /** Internal task id → Projects v2 item id (needed for setStatus). */
  private itemIdByTaskId = new Map<string, string>();
  /** Inbox task id → issue node id (needed for addItemToProject on triage). */
  private nodeIdByTaskId = new Map<string, string>();
  /** Last board returned to the webview. Diff target for `save`. */
  private lastBoard: Board | undefined;

  constructor(opts: GitHubProjectsAdapterOptions) {
    this.github = opts.github;
    this.coords = opts.coords;
    this.projectNumber = opts.projectNumber;
    this.output = opts.output;
  }

  get scope(): string {
    return `${this.coords.owner}/${this.coords.name} · project #${this.projectNumber}`;
  }

  /** Write a card's edit (title/body) through to its GitHub issue. */
  async updateIssue(
    issueNumber: number,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    await this.github.updateIssue(this.coords, issueNumber, fields);
    this.output.appendLine(
      `[kanban] updated issue #${issueNumber} (${Object.keys(fields).join(", ")})`,
    );
  }

  /** Candidate parent Specs (open) to attach a task/inbox issue under. */
  async listParentSpecs(): Promise<
    Array<{ number: number; title: string; nodeId: string }>
  > {
    const specs = await this.github.listIssues(this.coords, {
      type: "spec",
      state: "open",
    });
    return specs.map((s) => ({
      number: s.number,
      title: s.title,
      nodeId: s.nodeId,
    }));
  }

  /**
   * Promote a set of Inbox issues into a **full Epic→Story→Spec chain**
   * (placeholder titles/bodies — fill in later) and link the selected issues
   * as Tasks under the new Spec, placing them on the board in Ready. Nothing is
   * orphaned: the chain shows in the Roadmap; the tasks show on the kanban.
   * Returns the created issue numbers.
   */
  async promoteToChain(
    title: string,
    childNumbers: number[],
  ): Promise<{ epic: number; story: number; spec: number }> {
    const base = title.trim() || "New work";
    const epic = await this.github.createIssue(this.coords, {
      type: "epic",
      title: base,
      body: "_Epic — fill in the outcome._",
    });
    const story = await this.github.createIssue(this.coords, {
      type: "story",
      title: base,
      body: "_Story — fill in the user-observable deliverable._",
    });
    await this.github.addSubIssue(epic.nodeId, story.nodeId);
    const spec = await this.github.createIssue(this.coords, {
      type: "spec",
      title: base,
      body: "## Acceptance Criteria\n\n- [ ] _fill in via /spec-prepare_\n",
    });
    await this.github.addSubIssue(story.nodeId, spec.nodeId);

    const readyOption = this.optionIdByColumnId.get("column-ready");
    for (const n of childNumbers) {
      const childNode =
        this.nodeIdByTaskId.get(`inbox-${n}`) ??
        this.nodeIdByTaskId.get(`task-${n}`);
      if (!childNode) continue;
      try {
        await this.github.addSubIssue(spec.nodeId, childNode);
        if (this.projectInfo && this.statusField && readyOption) {
          const { itemId } = await this.github.addItemToProject(
            this.projectInfo.id,
            childNode,
          );
          await this.github.setStatus(
            this.projectInfo.id,
            itemId,
            this.statusField.id,
            readyOption,
          );
        }
      } catch (err) {
        this.log(
          `promoteToChain: place #${n} failed: ${(err as Error).message}`,
        );
      }
    }
    this.log(
      `[kanban] promoted ${childNumbers.length} issue(s) → EP-${epic.number} ▸ ST-${story.number} ▸ SP-${spec.number}`,
    );
    return { epic: epic.number, story: story.number, spec: spec.number };
  }

  /** Link an issue under a parent Spec (sub-issue) → places it in the hierarchy. */
  async setParent(childNumber: number, parentNodeId: string): Promise<void> {
    const childNodeId =
      this.nodeIdByTaskId.get(`task-${childNumber}`) ??
      this.nodeIdByTaskId.get(`inbox-${childNumber}`);
    if (!childNodeId) throw new Error(`No node id for issue #${childNumber}`);
    await this.github.addSubIssue(parentNodeId, childNodeId);
    this.log(
      `[kanban] linked #${childNumber} under parent node ${parentNodeId}`,
    );
  }

  /** Set (or clear) a card's due date on the board's DATE field. */
  async setDueDate(issueNumber: number, date: string | null): Promise<void> {
    if (!this.projectInfo?.dateField) {
      throw new Error(
        'This board has no "Due" date field. Add a Date field in the GitHub Projects UI.',
      );
    }
    const itemId = this.itemIdByTaskId.get(`task-${issueNumber}`);
    if (!itemId) throw new Error(`No board item for #${issueNumber}`);
    await this.github.setDateField(
      this.projectInfo.id,
      itemId,
      this.projectInfo.dateField.id,
      date,
    );
  }

  /** Create a Task issue and drop it into the given column on the board. */
  async createTask(columnId: string, title: string): Promise<void> {
    if (!this.projectInfo || !this.statusField) await this.load();
    const issue = await this.github.createIssue(this.coords, {
      type: "task",
      title,
    });
    const { itemId } = await this.github.addItemToProject(
      this.projectInfo!.id,
      issue.nodeId,
    );
    const optionId = this.optionIdByColumnId.get(columnId);
    if (optionId) {
      await this.github.setStatus(
        this.projectInfo!.id,
        itemId,
        this.statusField!.id,
        optionId,
      );
    }
    this.output.appendLine(
      `[kanban] created Task #${issue.number} "${title}" in ${columnId}`,
    );
  }

  async load(): Promise<Board> {
    const project = await this.github.getProject(
      this.coords.owner,
      this.projectNumber,
    );
    this.projectInfo = project;
    let statusField = project.statusField;
    if (!statusField) {
      throw new StatusFieldMisconfiguredError(EXPECTED_STATUSES, []);
    }
    let present = statusField.options.map((o) => o.name);
    let missing = EXPECTED_STATUSES.filter((s) => !present.includes(s));
    if (missing.length > 0) {
      // Self-heal: create the missing methodology options in place rather than
      // making the user add them by hand. Non-destructive — existing options
      // and their items are preserved. On failure (e.g. the token lacks the
      // `project` scope) fall through to the misconfigured error below so the
      // UI can still guide the user.
      try {
        const added = await this.github.ensureSingleSelectOptions(
          statusField.id,
          METHODOLOGY_OPTIONS,
        );
        if (added.length) {
          this.log(`created missing Status options: ${added.join(", ")}`);
        }
        const refreshed = await this.github.getStatusField(project.id);
        if (refreshed) {
          statusField = refreshed;
          present = refreshed.options.map((o) => o.name);
          missing = EXPECTED_STATUSES.filter((s) => !present.includes(s));
        }
      } catch (err) {
        this.log(
          `auto-create Status options failed: ${(err as Error).message}`,
        );
      }
      if (missing.length > 0) {
        throw new StatusFieldMisconfiguredError(missing, present);
      }
    }
    this.statusField = statusField;
    this.optionIdByColumnId.clear();
    for (const def of COLUMN_DEFS) {
      const opt = statusField.options.find((o) => o.name === def.status);
      if (opt) this.optionIdByColumnId.set(def.id, opt.id);
    }

    // Self-heal the Priority field options (P0–P3) too, mirroring Status.
    // Non-fatal by design: Priority is a decorative card chip, so a missing
    // field or options must never block board load. `enforceSchema`
    // (Configure Project) is the authoritative creator — here we only top up
    // missing options on an already-created field, keeping it consistent on
    // every open. A missing field is logged, not created or thrown.
    try {
      const priorityField = await this.github.getSingleSelectFieldByName(
        project.id,
        "Priority",
      );
      if (!priorityField) {
        this.log(
          `Priority field absent; run "Thinkube Kanban: Configure Project" to create it`,
        );
      } else {
        const missingPriorities = EXPECTED_PRIORITIES.filter(
          (p) => !priorityField.options.some((o) => o.name === p),
        );
        if (missingPriorities.length > 0) {
          const added = await this.github.ensureSingleSelectOptions(
            priorityField.id,
            PRIORITY_OPTIONS,
          );
          if (added.length) {
            this.log(`created missing Priority options: ${added.join(", ")}`);
          }
        }
      }
    } catch (err) {
      this.log(`Priority self-heal failed: ${(err as Error).message}`);
    }

    const items = await this.github.listProjectItems(project.id);
    const inbox = await this.fetchInbox(items);
    const board = this.buildBoard(items, inbox);
    this.lastBoard = board;
    return cloneBoard(board);
  }

  /**
   * Open repo issues that aren't on the board yet and aren't roadmap-level
   * (Epic/Story/Spec) — i.e. unplanned work (bugs, requests others opened).
   * They populate the synthetic "Inbox" column; dragging one onto a real
   * column triages it onto the board (addItemToProject + setStatus).
   */
  private async fetchInbox(items: ProjectItem[]): Promise<IssueSummary[]> {
    const onBoard = new Set(
      items.map((i) => i.issue?.number).filter((n): n is number => !!n),
    );
    try {
      const open = await this.github.listIssues(this.coords, { state: "open" });
      return open.filter(
        (i) =>
          !onBoard.has(i.number) &&
          i.kind !== "epic" &&
          i.kind !== "story" &&
          i.kind !== "spec",
      );
    } catch (err) {
      this.log(`fetchInbox failed: ${(err as Error).message}`);
      return [];
    }
  }

  async save(board: Board): Promise<void> {
    if (!this.projectInfo || !this.statusField) {
      this.log("save called before load — re-loading first");
      await this.load();
      return;
    }
    const previous = this.lastBoard ?? this.buildBoard([]);

    // Diff: tasks whose columnId moved.
    const moved: Array<{ taskId: string; toColumn: string }> = [];
    for (const [taskId, task] of Object.entries(board.tasks)) {
      const prev = previous.tasks[taskId];
      if (prev && prev.columnId !== task.columnId) {
        moved.push({ taskId, toColumn: task.columnId });
      }
    }
    const failures: Array<{ taskId: string; error: Error }> = [];
    for (const move of moved) {
      const fromColumnId = previous.tasks[move.taskId]?.columnId;

      // Triage: dragging an Inbox card onto a real column adds the issue to
      // the project, then sets its status. (Inbox cards have no project item
      // id yet — only a node id.)
      if (fromColumnId === INBOX_COLUMN_ID) {
        const nodeId = this.nodeIdByTaskId.get(move.taskId);
        const optionId = this.optionIdByColumnId.get(move.toColumn);
        if (!nodeId || !optionId) {
          failures.push({
            taskId: move.taskId,
            error: new Error(`cannot triage ${move.taskId} → ${move.toColumn}`),
          });
          continue;
        }
        try {
          const { itemId } = await this.github.addItemToProject(
            this.projectInfo.id,
            nodeId,
          );
          this.itemIdByTaskId.set(move.taskId, itemId);
          await this.github.setStatus(
            this.projectInfo.id,
            itemId,
            this.statusField.id,
            optionId,
          );
        } catch (err) {
          failures.push({ taskId: move.taskId, error: err as Error });
        }
        continue;
      }

      // Dragging a board card back into Inbox isn't supported (it would mean
      // removing it from the project) — ignore; reload snaps it back.
      if (move.toColumn === INBOX_COLUMN_ID) continue;

      const itemId = this.itemIdByTaskId.get(move.taskId);
      const optionId = this.optionIdByColumnId.get(move.toColumn);
      if (!itemId || !optionId) {
        failures.push({
          taskId: move.taskId,
          error: new Error(
            `missing item id or option id for ${move.taskId} → ${move.toColumn}`,
          ),
        });
        continue;
      }

      // Quality-gate check before the mutation. Gate failures get reported
      // through the same failure path as network errors — the existing
      // refetch-and-snap-back flow surfaces the reason to the user.
      const gateErr = await this.checkGate(move.taskId, board, previous);
      if (gateErr) {
        failures.push({ taskId: move.taskId, error: gateErr });
        continue;
      }

      try {
        await this.github.setStatus(
          this.projectInfo.id,
          itemId,
          this.statusField.id,
          optionId,
        );
      } catch (err) {
        failures.push({ taskId: move.taskId, error: err as Error });
      }
    }

    if (failures.length === 0) {
      // Persist within-column priority order (Projects v2 item position).
      try {
        await this.persistOrder(board, previous);
      } catch (err) {
        this.log(`persistOrder failed: ${(err as Error).message}`);
      }
      this.lastBoard = cloneBoard(board);
      return;
    }

    // At least one mutation failed — refetch and snap the webview back to
    // the truth. We surface the first error to the user as a toast and
    // log the rest.
    this.log(`save: ${failures.length} mutation(s) failed; reloading`);
    for (const f of failures) {
      this.log(`  ${f.taskId}: ${f.error.message}`);
    }
    const first = failures[0].error;
    vscode.window.showErrorMessage(
      `Kanban: ${failures.length === 1 ? "1 update" : `${failures.length} updates`} failed — ${first.message}`,
    );
    try {
      const fresh = await this.load();
      this._onExternalChange.fire(cloneBoard(fresh));
    } catch (reloadErr) {
      this.log(
        `save: reload after failure also failed: ${(reloadErr as Error).message}`,
      );
    }
  }

  private buildBoard(items: ProjectItem[], inbox: IssueSummary[] = []): Board {
    this.itemIdByTaskId.clear();
    this.nodeIdByTaskId.clear();

    // One bucket per column; "no status" lands in column-spec, our
    // methodology default for unranked work.
    const buckets = new Map<string, string[]>();
    for (const def of COLUMN_DEFS) buckets.set(def.id, []);

    const tasks: Record<string, TaskCard> = {};
    for (const item of items) {
      if (!item.issue) continue;
      const columnId = columnIdForStatus(item.status) ?? "column-spec";
      const taskId = `task-${item.issue.number}`;
      const card: TaskCard = {
        id: taskId,
        description: item.issue.title,
        body: item.issue.body,
        columnId,
        colorSlug: slugForParent(item.issue.parentNumber),
        issueNumber: item.issue.number,
        parentNumber: item.issue.parentNumber,
        updatedAt: item.issue.updatedAt,
        specStale: isSpecStale(
          item.issue.parentUpdatedAt,
          item.issue.updatedAt,
        ),
        dueDate: item.dueDate,
        priority: item.priority,
      };
      tasks[taskId] = card;
      this.itemIdByTaskId.set(taskId, item.id);
      this.nodeIdByTaskId.set(taskId, item.issue.nodeId);
      buckets.get(columnId)?.push(taskId);
    }

    // Inbox: untracked open issues, as a synthetic leftmost column.
    const inboxIds: string[] = [];
    for (const issue of inbox) {
      const taskId = `inbox-${issue.number}`;
      tasks[taskId] = {
        id: taskId,
        description: issue.title,
        body: issue.body ?? undefined,
        columnId: INBOX_COLUMN_ID,
        colorSlug: "neutral",
        issueNumber: issue.number,
      };
      this.nodeIdByTaskId.set(taskId, issue.nodeId);
      inboxIds.push(taskId);
    }

    const columns: BoardColumn[] = COLUMN_DEFS.map((def) => ({
      id: def.id,
      title: def.title,
      tasksIds: buckets.get(def.id) ?? [],
    }));
    if (inboxIds.length > 0) {
      columns.unshift({
        id: INBOX_COLUMN_ID,
        title: "Inbox",
        tasksIds: inboxIds,
      });
    }

    return { columns, tasks, scope: this.scope };
  }

  /**
   * Persist within-column card order as Projects v2 item position. For each
   * card whose preceding sibling changed vs the previous snapshot, move it to
   * just after that sibling (or to the top). Only touches changed positions.
   */
  private async persistOrder(board: Board, previous: Board): Promise<void> {
    if (!this.projectInfo) return;
    for (const col of board.columns) {
      const prevCol = previous.columns.find((c) => c.id === col.id);
      for (let i = 0; i < col.tasksIds.length; i++) {
        const taskId = col.tasksIds[i];
        const afterTaskId = i > 0 ? col.tasksIds[i - 1] : null;
        // What preceded this task previously (undefined = task is new here).
        const prevIdx = prevCol?.tasksIds.indexOf(taskId) ?? -1;
        const prevAfter =
          prevIdx > 0
            ? prevCol!.tasksIds[prevIdx - 1]
            : prevIdx === 0
              ? null
              : undefined;
        if (afterTaskId === prevAfter) continue; // predecessor unchanged
        const itemId = this.itemIdByTaskId.get(taskId);
        if (!itemId) continue;
        const afterItemId = afterTaskId
          ? (this.itemIdByTaskId.get(afterTaskId) ?? null)
          : null;
        try {
          await this.github.setItemPosition(
            this.projectInfo.id,
            itemId,
            afterItemId,
          );
        } catch (err) {
          this.log(
            `setItemPosition(${taskId}) failed: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  private log(line: string): void {
    this.output.appendLine(`[kanban-gh] ${line}`);
  }

  /**
   * Check the chunk-11 quality gate for a move, if any. Returns a
   * `GateFailedError` to record in the failures list, or `undefined` when
   * the move is allowed.
   *
   * Gate 1 (Spec → Ready) and gate 2 (In Progress → Review) are wired here.
   * Gate 3 (Review → Verify) requires walking the task's parent spec — that
   * ancestry resolution is the chunk-13 follow-up that pairs with the
   * color-by-epic enhancement. For v0.1.0 the gate function exists and can
   * be called directly from skills/MCP tools, but the adapter doesn't
   * enforce it on drag because we don't have the parent body in hand.
   */
  private async checkGate(
    taskId: string,
    board: Board,
    previous: Board,
  ): Promise<GateFailedError | undefined> {
    const fromColumnId = previous.tasks[taskId]?.columnId;
    const toColumnId = board.tasks[taskId]?.columnId;
    if (!fromColumnId || !toColumnId) return undefined;
    const fromStatus = COLUMN_DEFS.find((c) => c.id === fromColumnId)?.status;
    const toStatus = COLUMN_DEFS.find((c) => c.id === toColumnId)?.status;
    if (!fromStatus || !toStatus) return undefined;
    const gate = gateForTransition(fromStatus, toStatus);
    if (!gate) return undefined;

    const task = board.tasks[taskId];
    const issueNumber = task?.issueNumber;
    if (issueNumber === undefined) return undefined;

    let issue;
    try {
      issue = await this.github.getIssue(this.coords, issueNumber);
    } catch (err) {
      // Can't fetch the issue → can't check the gate. Allow the move and
      // log; the user can re-check by hand if they hit the same column
      // boundary again.
      this.log(
        `checkGate: getIssue(#${issueNumber}) failed; skipping gate: ${(err as Error).message}`,
      );
      return undefined;
    }

    if (gate === "in-progress-to-review") {
      const result = gateInProgressToReview({
        commentCount: issue.comments ?? 0,
      });
      if (!result.ok) return new GateFailedError(gate, result.reason);
      return undefined;
    }

    // Both acceptance-criteria gates (spec-to-ready and review-to-verify)
    // check the parent SPEC's `## Acceptance Criteria` checklist — NOT the
    // moving Task's own body (a Task never carries an AC checklist; that's
    // why this gate used to block every task forever). Walk one step up via
    // the sub-issue parent API; if it can't be resolved, skip the gate rather
    // than block the move.
    let parent;
    try {
      parent = await this.github.getParentIssue(this.coords, issueNumber);
    } catch (err) {
      this.log(
        `checkGate: getParentIssue(#${issueNumber}) failed; skipping ${gate} gate: ${(err as Error).message}`,
      );
      return undefined;
    }
    if (!parent) {
      this.log(
        `checkGate: Task #${issueNumber} has no resolvable parent Spec; skipping ${gate} gate`,
      );
      return undefined;
    }
    const result =
      gate === "spec-to-ready"
        ? gateSpecToReady({ specBody: parent.body })
        : gateReviewToVerify({ specBody: parent.body });
    if (!result.ok) return new GateFailedError(gate, result.reason);
    return undefined;
  }
}

function columnIdForStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  const match = COLUMN_DEFS.find((d) => d.status === status);
  return match?.id;
}

function cloneBoard(board: Board): Board {
  return JSON.parse(JSON.stringify(board)) as Board;
}

export const METHODOLOGY_STATUSES = EXPECTED_STATUSES;
