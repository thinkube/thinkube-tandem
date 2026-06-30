/**
 * Thinking Space orchestrator (SP-tgs8nz) — the integration shell around `orchestratorCore`'s pure
 * scheduler. `dispatchSpec` runs a **makespan scheduler over the Spec's work-unit DAG**: it
 * pools every slice's execution units into one graph (units span slices, never Specs), keeps
 * a per-Spec pool of N workers saturated (ready frontier ∧ footprint-disjoint, critical-path
 * first), verifies each slice when all its units land, and commits **once** when the whole
 * Spec is green. A worker is an **Agent SDK `query()` session** (`runViaSdk`) — a headless
 * `claude` subprocess the SDK manages under `bypassPermissions`; workers only edit files, the
 * orchestrator owns git. The SDK is the sole substrate; tests inject the `runUnit` seam to
 * return outcomes (success / needs-input / failed) without a live SDK call.
 *
 * The pure DAG/frontier/prompt logic lives in `orchestratorCore` + `parallelSlices`
 * (unit-tested). This shell is the low-AI-testability part (live SDK worker + worktree +
 * commit): its end-to-end behaviour is a human verdict (SP-tgsdvw lever), exercised with fakes.
 */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import type { WorktreeService } from "./WorktreeService";
import type { OwnershipArbiter } from "./OwnershipArbiter";
import type { ThinkubeStore } from "../store/ThinkubeStore";
import {
  buildUnitDag,
  readyFrontier,
  buildWorkerPrompt,
  extractNeedsInput,
  sessionIdOf,
  summarizeEvent,
  isResultSuccess,
  parseAcVerifications,
  runAcVerifications,
  checkAcOrdinals,
  buildDeliveryReport,
  finalizationVerdict,
  FINALIZATION_WEDGED_DIAGNOSIS,
  commitPlan,
  resumeDecision,
  type SliceForDag,
  type SchedUnit,
  type SchedulerState,
  type WorkUnit,
  type AcVerification,
  type AcResult,
  type FinalizationState,
  type SliceOutcome,
} from "./orchestratorCore";
import {
  validateDag,
  footprintGuard,
  footprintContainment,
  type ContainmentResult,
} from "../methodology/parallelSlices";
import {
  startSession,
  appendSession,
  endSession,
  markUnitDone,
  parkWorker,
  unparkWorker,
} from "./orchestratorSessions";

/**
 * Called when a worker escalates a question and **parks resident** (SP-tgs8nz_SL-3): the scheduler
 * frees its active slot but the worker stays alive, suspended. `answer` pushes the human's reply
 * into the live session (via `/attend`), continuing it in place.
 */
export type OnPark = (
  unit: SchedUnit,
  question: string,
  answer: (a: string) => void,
) => void;

const SLICE_REL_RE = /teps\/TEP-(\d+)\/SP-(\d+)\/SL-(\d+)\.md$/;

export interface OrchestratorDeps {
  worktrees: WorktreeService;
  arbiter: OwnershipArbiter;
  store: ThinkubeStore;
  output: vscode.OutputChannel;
  /** Absolute path to the canonical (non-worktree) code repo. */
  canonicalRepo: string;
  /** `thinkube.thinkingSpace.root` — injected into the worktree's `.mcp.json`. */
  thinkingSpaceRoot?: string;
  /** `thinkube.worktree.baseDir` — where linked worktrees are created. */
  baseDir?: string;
  /** Run the Spec's declared per-AC verifications at quiescence (tests): defaults to the core
   *  `runAcVerifications` runner (spawns each declared check in the worktree / live cluster).
   *  This is the closing gate's injectable seam — tests feed per-AC outcomes without a cluster. */
  runAcVerifications?: (
    verifs: AcVerification[],
    cwd: string,
  ) => Promise<AcResult[]>;
  /** Tick the satisfied AC ordinals on the Spec doc (tests): defaults to flipping the checkboxes
   *  under the Spec body's `## Acceptance Criteria`, so the accept gate (every AC checked) passes. */
  checkAcs?: (specNumber: string, ordinals: number[]) => Promise<void>;
  /** @deprecated Legacy per-slice verify recipe (`thinkube.orchestrator.verifyCommand`); the
   *  closing gate (SP-tgzyfy) is now per-AC, so this is no longer consulted. Kept so the command
   *  layer that still passes it compiles. */
  verifyCommand?: string;
  /** Advance a slice to Done (tests): defaults to stamping `status: done`. */
  advance?: (handle: string) => Promise<void>;
  /** Flag a slice requires-attention with a diagnosis (tests): defaults to a frontmatter+body write. */
  flagAttention?: (handle: string, diagnosis: string) => Promise<void>;
  /** Park a slice needs-input with its question + the worker's session id + unit id (tests): defaults to a frontmatter+body write. */
  flagNeedsInput?: (
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ) => Promise<void>;
  /** Commit ONE slice's work before it is marked Done (SP-th4wqc_SL-3 / #9): per-slice
   *  commit-before-Done. Rejecting signals a git failure → the orchestrator rolls that slice back to
   *  `ready` (NOT Done) per `commitPlan`'s commit-failure protocol. Defaults to `git add -A && git
   *  commit` of the slice's footprint in the worktree (tests inject a fake git that fails one slice). */
  commit?: (handle: string, specNumber: string, cwd: string) => Promise<void>;
  /** Roll a slice back to `ready` (SP-th4wqc_SL-3): used when its commit fails — no slice ever ends
   *  Done with uncommitted work, so a later run re-attempts it. Defaults to stamping `status: ready`. */
  rollbackToReady?: (handle: string) => Promise<void>;
  /** Tear down a finished Spec — close its worktree (tests): defaults to `WorktreeService.remove`. */
  teardown?: (specNumber: string) => Promise<void>;
  /** Run one execution unit (tests): overrides the SDK substrate; `onPark` parks it resident. */
  runUnit?: (
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
  ) => Promise<WorkerResult>;
  /** Resolve the worktree HEAD's short SHA — the finalization watchdog's commit marker and the
   *  delivery report's stamp (SP-th4wqc_SL-2). Defaults to `git rev-parse --short HEAD` in the
   *  worktree; tests inject it so the watchdog sees a real commit without a live git repo. */
  gitShortSha?: (cwd: string) => Promise<string>;
  /** Post-tool footprint containment (SP-6/2 AC3 + SP-2/TEP-6 AC4): diff the worktree against the
   *  unit's declared `footprint` and REVERT only the out-of-footprint create/modify/delete (a sibling's
   *  in-progress work in the shared tree is never touched), returning the containment verdict. The
   *  whole-tree porcelain also shows every OTHER running unit's (and earlier units') legitimate
   *  in-their-own-footprint changes; `running` (the union of all currently-running units' footprints)
   *  and `baseline` (paths already dirty when THIS unit started) fence those out so they are never
   *  misattributed to this unit and reverted (AC4). Defaults to `git status --porcelain` →
   *  `footprintContainment` → `git restore`/`clean` of only the offending paths; tests inject it to
   *  drive `runViaSdk`'s abort/rollback wiring without a live git repo. */
  containmentCheck?: (
    cwd: string,
    footprint: string[],
    ctx?: { running?: string[]; baseline?: string[] },
  ) => Promise<ContainmentResult>;
  /** The Agent SDK `query()` entry (tests): defaults to the lazy `import("@anthropic-ai/claude-agent-sdk")`.
   *  Injected so a test can drive the REAL {@link OrchestratorService.runViaSdk} body — its PostToolUse
   *  containment hook, the `AbortController` hard-stop, and the success-precedence — with only the SDK
   *  boundary faked (no live `claude` subprocess). The default keeps production on the real lazy import. */
  sdkQuery?: (args: {
    prompt: AsyncIterable<unknown>;
    options: Record<string, unknown>;
  }) => AsyncIterable<unknown>;
}

/** What a worker run resolved to — the third outcome carries the escalated question + session id. */
export interface WorkerResult {
  outcome: UnitOutcome;
  /** The escalated question (needs-input only). */
  question?: string;
  /** The worker's session id, captured for resume-on-answer (SL-3 / SL-5). */
  sessionId?: string;
  /** A requires-attention diagnosis to surface verbatim on the slice (failed only). Set by the
   *  post-tool footprint-containment hard-stop (SP-6/2 AC3) so the flagged slice names the exact
   *  out-of-footprint path, rather than the generic "exited without success" failure message. */
  attention?: string;
}

export type UnitOutcome = "success" | "needs-input" | "failed";

export interface UnitResult {
  id: string;
  slice: string;
  outcome: UnitOutcome;
}

export interface SpecRunResult {
  specNumber: string;
  /** false only when the DAG was malformed (nothing dispatched). */
  ok: boolean;
  /** DAG-malformed reason (when ok=false). */
  reason?: string;
  /** Execution units dispatched this run. */
  dispatched: number;
  /** One result per dispatched unit. */
  results: UnitResult[];
  /** Slices that completed + verified + advanced this run. */
  advanced: string[];
  /** Slices flagged requires-attention (a worker failed or a verify was red) this run. */
  attention: string[];
  /** Slices parked needs-input (a worker asked a question) this run. */
  needsInput: string[];
  /** Slices rolled back to `ready` this run because their commit failed (SP-th4wqc_SL-3) — a slice
   *  is never left Done with uncommitted work; a later run re-attempts (or resumes) it. */
  rolledBack: string[];
  /** The whole Spec landed and was committed. */
  committed: boolean;
  /** Thinking Space-relative path of the written delivery summary (DELIVERY.md), set when the report is written. */
  deliveryDoc?: string;
  /** The closing gate's per-AC verification results (pass/fail + evidence); empty when it couldn't run. */
  acResults: AcResult[];
}

export class OrchestratorService {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Spec + slice bodies to embed in each worker's prompt — the worktree has no specs dir, so the
   *  worker can't read them from disk. Loaded once per dispatchSpec. */
  private promptCtx: { specBody: string; sliceBodies: Map<string, string> } = {
    specBody: "",
    sliceBodies: new Map(),
  };

  /** Per-slice resume state read from frontmatter (SP-th4wqc_SL-3): whether a slice's units already
   *  landed (`units_landed`) and whether its work was already committed (`committed` / `commit_sha`).
   *  `resumeDecision` consults this so a re-run COMMITS a complete-but-uncommitted slice rather than
   *  re-authoring it (the frontier never re-dispatches a worker for it). Loaded once per dispatchSpec. */
  private sliceResumeState: Map<
    string,
    { unitsLanded: boolean; committed: boolean }
  > = new Map();

  /** Fetch the parent spec doc + each slice body from the thinking space, to embed in worker prompts. */
  private async loadPromptContext(specNumber: string): Promise<void> {
    const { store } = this.deps;
    const sliceBodies = new Map<string, string>();
    let specBody = "";
    try {
      const specDoc = await store.getFile(store.pathForSpecDoc(specNumber));
      specBody = specDoc?.body ?? "";
      for (const rel of await store.listSlices(specNumber)) {
        const m = SLICE_REL_RE.exec(rel);
        if (!m) continue;
        const parsed = await store.getFile(rel);
        if (parsed?.body)
          sliceBodies.set(
            store.sliceHandle(specNumber, Number(m[2])),
            parsed.body,
          );
      }
    } catch {
      /* best-effort — a worker just falls back to its unit note without the embedded context */
    }
    this.promptCtx = { specBody, sliceBodies };
  }

  /** Read the Spec's slices into the DAG-builder input (frontmatter → SliceForDag). */
  private async buildSlices(specNumber: string): Promise<SliceForDag[]> {
    const { store } = this.deps;
    const slices: SliceForDag[] = [];
    this.sliceResumeState = new Map();
    for (const rel of await store.listSlices(specNumber)) {
      const m = SLICE_REL_RE.exec(rel);
      if (!m) continue;
      const fm = (await store.getFile(rel))?.frontmatter;
      const handle = store.sliceHandle(specNumber, Number(m[3]));
      // Resume markers (SP-th4wqc_SL-3): a prior run that landed the units but couldn't commit
      // stamps `units_landed: true` without a `commit_sha`; `resumeDecision` then COMMITS rather
      // than re-authoring it on the next run. `committed`/`commit_sha` mark an already-landed slice.
      this.sliceResumeState.set(handle, {
        unitsLanded: fm?.units_landed === true,
        committed:
          fm?.committed === true ||
          (typeof fm?.commit_sha === "string" && !!fm.commit_sha),
      });
      slices.push({
        handle,
        status: String(fm?.status ?? "ready"),
        requires: Array.isArray(fm?.depends_on)
          ? (fm!.depends_on as string[])
          : [],
        files: Array.isArray(fm?.files) ? (fm!.files as string[]) : [],
        workUnits: Array.isArray(fm?.work_units)
          ? (fm!.work_units as (WorkUnit & { note?: string })[])
          : [],
        satisfies: Array.isArray(fm?.satisfies)
          ? (fm!.satisfies as number[]).filter(
              (n) => Number.isInteger(n) && n > 0,
            )
          : [],
      });
    }
    return slices;
  }

  /**
   * Run the makespan scheduler over `specNumber`'s work-unit DAG: validate the DAG, then keep up
   * to `cap` workers saturated dispatching the ready, footprint-disjoint, critical-path frontier
   * (units pooled across slices). A failed unit or a needs-input worker flags its slice
   * `requires-attention`/`needs-input` during the run. When every slice's units have **landed**
   * (Spec quiescence) the **closing AI-verification gate** runs (SP-tgzyfy): the Spec's declared
   * per-AC verifications run as a full plan; a slice reaches Done only when the ACs it `satisfies`
   * all ran green (then those AC ordinals are ticked on the Spec); any red / un-runnable check
   * leaves its slice `requires-attention` (no skip). When the whole Spec is green it commits
   * **once**; the auditable per-AC report is written on every completion (pass or fail).
   */
  async dispatchSpec(specNumber: string, cap: number): Promise<SpecRunResult> {
    const { output } = this.deps;
    const result: SpecRunResult = {
      specNumber,
      ok: true,
      dispatched: 0,
      results: [],
      advanced: [],
      attention: [],
      needsInput: [],
      rolledBack: [],
      committed: false,
      acResults: [],
    };

    const slices = await this.buildSlices(specNumber);
    await this.loadPromptContext(specNumber);
    const dag = buildUnitDag(slices);

    // Deterministic gate: reject a malformed DAG before any worker runs.
    const v = validateDag(dag.map((u) => ({ id: u.id, requires: u.requires })));
    if (!v.ok) {
      output.appendLine(
        `✗ SP-${specNumber}: malformed DAG — not dispatched.\n${v.reason}`,
      );
      return { ...result, ok: false, reason: v.reason };
    }

    // Seed scheduler state from thinking space statuses.
    const unitsBySlice = new Map<string, SchedUnit[]>();
    for (const u of dag) {
      const arr = unitsBySlice.get(u.slice) ?? [];
      arr.push(u);
      unitsBySlice.set(u.slice, arr);
    }
    const state: SchedulerState = {
      done: new Set(),
      running: new Set(),
      blocked: new Set(),
    };
    // Slices already Done on the thinking space (or advanced by this run's closing gate) — the **commit
    // gate** is "every slice Done". `landed` (below) tracks slices whose units all landed THIS
    // run; they only become Done once the closing AC-verification gate passes for their ACs.
    const doneSlices = new Set<string>();
    // Slices whose every unit landed this run — the candidates the closing gate verifies.
    const landed = new Set<string>();
    // Slices RESUMED this run (SP-th4wqc_SL-3): their units already landed in a prior run but were
    // never committed, so `resumeDecision` says COMMIT (not author). Their units are seeded done so
    // the frontier never re-dispatches a worker for them — the resume commits the present work.
    const resumeCommit = new Set<string>();
    for (const s of slices) {
      const st = s.status.toLowerCase();
      const ids = (unitsBySlice.get(s.handle) ?? []).map((u) => u.id);
      const rs = this.sliceResumeState.get(s.handle) ?? {
        unitsLanded: false,
        committed: false,
      };
      const decision = resumeDecision({
        status: s.status,
        unitsLanded: rs.unitsLanded,
        committed: rs.committed,
      });
      if (decision === "skip" || st === "done" || st === "archived") {
        // Already committed / Done / archived — nothing to do; mark done so dependents unblock.
        state.done.add(s.handle);
        doneSlices.add(s.handle);
        ids.forEach((id) => state.done.add(id));
      } else if (decision === "commit") {
        // Complete-but-uncommitted — RESUME: commit the already-present work WITHOUT re-authoring.
        // Seed its units done (so the frontier never re-dispatches them) and record it as a landed
        // candidate the closing gate verifies + the per-slice commit then lands.
        state.done.add(s.handle);
        ids.forEach((id) => state.done.add(id));
        landed.add(s.handle);
        resumeCommit.add(s.handle);
      } else if (st !== "ready" && st !== "requires-attention") {
        // `doing` (in-flight elsewhere) — not dispatchable, not done (deps wait). A
        // `requires-attention` slice IS re-dispatchable: clicking ▶ again retries it (the
        // human's re-run after looking), so it falls through into the ready frontier.
        ids.forEach((id) => state.blocked.add(id));
      }
    }
    const remaining = new Map<string, number>();
    for (const [slice, us] of unitsBySlice) {
      if (state.done.has(slice)) continue;
      const rem = us.filter(
        (u) => !state.done.has(u.id) && !state.blocked.has(u.id),
      ).length;
      if (rem > 0) remaining.set(slice, rem);
    }
    if (readyFrontier(dag, state).length === 0 && resumeCommit.size === 0) {
      output.appendLine(`▸ SP-${specNumber}: nothing ready to dispatch.`);
      return result;
    }

    const worktreePath = await this.deps.worktrees.create(
      this.deps.canonicalRepo,
      specNumber,
      this.deps.baseDir,
      this.deps.thinkingSpaceRoot,
    );
    const limit = Math.max(1, Math.floor(cap));
    output.appendLine(
      `▸ SP-${specNumber}: scheduling ${dag.length} unit(s) over cap ${limit} in ${worktreePath}`,
    );

    const footprintsOf = new Map<string, string[]>(
      dag.map((u) => [u.id, u.footprint]),
    );
    const running = new Map<string, Promise<UnitDone>>();
    const parked = new Set<string>(); // dispatched but suspended awaiting an answer (off the cap)
    let wake: () => void = () => {};
    let wakeSignal = new Promise<void>((r) => (wake = r));
    const activeCount = () => running.size - parked.size;

    // Resident needs-input park (SL-3): free the worker's slot + register its LIVE session so
    // `/attend` can push the answer in, but keep it alive (its promise resolves on the answered
    // continuation). Distinct from the exit-model `needs-input` outcome (a runUnit that RETURNS it)
    // handled in the loop below; here the worker never resolved — it's suspended mid-stream.
    const onPark: OnPark = (u, question, answer) => {
      (footprintsOf.get(u.id) ?? []).forEach((f) => state.running.delete(f));
      parked.add(u.id);
      parkWorker(u.id, u.slice, question, answer);
      if (!result.needsInput.includes(u.slice)) result.needsInput.push(u.slice);
      void this.flagNeedsInput(u.slice, question, undefined, u.id);
      output.appendLine(
        `❓ ${u.slice}: ${u.id} asked a question → parked resident (slot freed, awaiting /attend).`,
      );
      wake();
    };

    const fill = () => {
      for (const u of readyFrontier(dag, state)) {
        if (activeCount() >= limit) break;
        if (running.has(u.id)) continue;
        u.footprint.forEach((f) => state.running.add(f));
        running.set(
          u.id,
          // `state.running` is the live UNION of every running unit's footprint files (a
          // unit's footprint is added on dispatch above, removed on completion below). Pass
          // it as the running-footprints source so this unit's post-tool containment check
          // never misattributes a concurrent sibling's in-footprint change as its own (AC4).
          this.dispatchUnit(
            u,
            specNumber,
            worktreePath,
            onPark,
            () => [...state.running],
          ),
        );
        result.dispatched++;
        output.appendLine(
          `▸ ${u.id} [${u.shape}] dispatched (${activeCount()}/${limit})`,
        );
      }
    };

    const blockSlice = async (slice: string, diagnosis: string) => {
      await this.flagAttention(slice, diagnosis);
      (unitsBySlice.get(slice) ?? []).forEach((u) => state.blocked.add(u.id));
      remaining.delete(slice);
      result.attention.push(slice);
    };

    fill();
    while (running.size > 0) {
      // Race worker completions against a park-wake (a freed slot with no completion, so we
      // re-fill). If only parked workers remain, the loop waits here for `/attend` to answer them.
      const winner = await Promise.race<
        { kind: "done"; d: UnitDone } | { kind: "wake" }
      >([
        ...[...running.values()].map((p) =>
          p.then((d) => ({ kind: "done" as const, d })),
        ),
        wakeSignal.then(() => ({ kind: "wake" as const })),
      ]);
      if (winner.kind === "wake") {
        wakeSignal = new Promise<void>((r) => (wake = r));
        fill();
        continue;
      }
      const d = winner.d;
      running.delete(d.id);
      parked.delete(d.id);
      unparkWorker(d.id);
      (footprintsOf.get(d.id) ?? []).forEach((f) => state.running.delete(f));
      result.results.push({ id: d.id, slice: d.slice, outcome: d.outcome });

      if (d.outcome === "needs-input") {
        // Non-resident needs-input: a worker that RETURNED a question instead of parking its live
        // session. runViaSdk parks resident via onPark and never returns this; this branch covers a
        // runUnit seam (tests) / a future exit-model runner. No live session to feed → flag via the
        // thinking space for resume-by-session-id (/attend fallback).
        await this.flagNeedsInput(
          d.slice,
          d.question ?? "(no question text)",
          d.sessionId,
          d.id,
        );
        (unitsBySlice.get(d.slice) ?? []).forEach((u) =>
          state.blocked.add(u.id),
        );
        remaining.delete(d.slice);
        if (!result.needsInput.includes(d.slice))
          result.needsInput.push(d.slice);
        output.appendLine(
          `❓ ${d.slice}: ${d.id} asked a question → needs-input (slot freed).`,
        );
      } else if (d.outcome === "failed") {
        // A footprint-containment hard-stop (SP-6/2 AC3) carries its own diagnosis naming the
        // offending out-of-footprint path; otherwise fall back to the generic exit message.
        await blockSlice(
          d.slice,
          d.attention ??
            `Worker for ${d.id} exited without success — see the session JSON-log.`,
        );
        output.appendLine(`⚑ ${d.slice}: ${d.id} failed → requires-attention.`);
      } else {
        state.done.add(d.id);
        markUnitDone(d.id); // graph: show this worker's node done (lime) until re-dispatch
        const rem = (remaining.get(d.slice) ?? 1) - 1;
        remaining.set(d.slice, rem);
        if (rem <= 0) {
          // Slice's units all LANDED. No per-slice verify any more — verification is the Spec's
          // declared per-AC plan, run once at quiescence (the closing gate below). Mark the slice
          // done for SCHEDULING (so dependents unblock) and record it as a gate candidate; it only
          // becomes Done-on-the-thinking space when the closing gate passes for the ACs it satisfies.
          state.done.add(d.slice);
          landed.add(d.slice);
          remaining.delete(d.slice);
          output.appendLine(
            `✓ ${d.slice}: all units landed (verification deferred to the closing gate).`,
          );
        }
      }
      fill();
    }

    // ── Closing AI-verification gate (SP-tgzyfy / TEP-tgzx3p) ──────────────
    // At Spec quiescence — every slice's units landed (none failed / parked / blocked) — run the
    // Spec's DECLARED per-AC verifications as one full plan. The gate returns the landed slices that
    // are AC-green (→ their satisfied ordinals); a red / un-runnable slice is flagged
    // requires-attention in place. The green slices are the input to the per-slice commit below.
    const everyLanded = slices.every(
      (s) => doneSlices.has(s.handle) || landed.has(s.handle),
    );
    const greenByGate = new Map<string, number[]>();
    if (everyLanded && landed.size > 0) {
      const green = await this.runClosingGate(
        specNumber,
        worktreePath,
        slices,
        landed,
        unitsBySlice,
        state,
        blockSlice,
        result,
      );
      for (const [h, ords] of green) greenByGate.set(h, ords);
    } else if (landed.size > 0) {
      output.appendLine(
        `▸ SP-${specNumber}: paused — ${result.attention.length} need attention / ${result.needsInput.length} need input; closing gate not run, nothing committed.`,
      );
    }

    // ── Per-slice commit-before-Done (SP-th4wqc_SL-3 / TEP-th3i18 #9) ──────
    // No more all-or-nothing commit. `commitPlan` is the per-slice decision: only landed ∧ gate-green
    // slices are eligible to commit-then-Done. We commit each slice BEFORE marking it Done; a slice
    // whose git commit FAILS rolls back to `ready` (the commit-failure protocol) and is NOT advanced —
    // so no slice ever ends Done with uncommitted work. A partial-gate / partial-commit failure thus
    // commits the slices that passed and rolls the rest back, rather than freezing them Done.
    const outcomes: SliceOutcome[] = slices
      .filter((s) => greenByGate.has(s.handle))
      .map((s) => ({ handle: s.handle, unitsLanded: true, gatePassed: true }));
    const plan = commitPlan(outcomes);
    const checkedOrdinals: number[] = [];
    for (const handle of plan.commit) {
      try {
        // commit-before-Done: the commit must succeed before the slice can be advanced.
        await this.commit(handle, specNumber, worktreePath);
      } catch (err) {
        // Commit-failure protocol: roll this slice back to `ready` (NOT Done) so a later run
        // re-attempts (or resumes) it; block its units this run so nothing else lands on it.
        await this.rollbackToReady(handle);
        result.rolledBack.push(handle);
        (unitsBySlice.get(handle) ?? []).forEach((u) =>
          state.blocked.add(u.id),
        );
        output.appendLine(
          `⚑ ${handle}: commit failed → rolled back to ready (not Done) — ${(err as Error).message}`,
        );
        continue;
      }
      doneSlices.add(handle);
      await this.advance(handle);
      result.advanced.push(handle);
      checkedOrdinals.push(...(greenByGate.get(handle) ?? []));
      output.appendLine(`✓ ${handle}: committed → Done.`);
    }

    // Tick exactly the satisfied AC ordinals of the COMMITTED slices on the Spec (so the accept gate
    // — every AC checked — can pass). One write with the union; out-of-range/checked are no-ops.
    const ordinals = [...new Set(checkedOrdinals)].sort((a, b) => a - b);
    if (ordinals.length) {
      await this.checkAcs(specNumber, ordinals);
      output.appendLine(
        `▸ SP-${specNumber}: checked AC ${ordinals.map((n) => `#${n}`).join(", ")} on the Spec.`,
      );
    }

    // The whole Spec is committed iff every slice ended Done (each via its own successful commit).
    const allDone = slices.every((s) => doneSlices.has(s.handle));
    result.committed = allDone && landed.size > 0;
    if (result.committed) {
      output.appendLine(`✓ SP-${specNumber}: every slice committed → Done.`);
    } else if (landed.size > 0) {
      output.appendLine(
        `⚑ SP-${specNumber}: Spec not fully committed — ${result.attention.length} requires-attention, ${result.rolledBack.length} rolled back.`,
      );
    }

    if (landed.size > 0) {
      result.deliveryDoc = await this.writeDeliverySummary(
        specNumber,
        worktreePath,
        result,
        dag,
      );
    }

    // ── Finalization watchdog (SP-th4wqc_SL-2 / TEP-th3i18 #11) ────────────
    // A run can land every unit and then silently wedge: the finalize tail above (commit, write
    // DELIVERY.md, advance the slice off `ready`) believed it ran, but a marker is actually absent
    // — no real commit SHA, no report on disk — so the work sits done-but-uncommitted and the loop
    // would otherwise stall without surfacing anything. We consult the pure `finalizationVerdict`
    // ONLY at a clean quiescence (no slice flagged attention / needs-input / rolled back this run):
    // there the run BELIEVED it finalized, so any missing marker is a genuine wedge — not a normal
    // pause at the closing gate, and not an EXPLICIT per-slice commit rollback (SP-th4wqc_SL-3),
    // which is a handled outcome the slice already moved back to `ready` for, not a silent wedge.
    // A `{ wedged }` verdict surfaces the affected slices Requires-attention with the exported
    // diagnosis so a human (or a re-run) picks it up instead of a silent loop.
    let wedged = false;
    const cleanQuiescence =
      result.dispatched > 0 &&
      result.attention.length === 0 &&
      result.needsInput.length === 0 &&
      result.rolledBack.length === 0;
    if (cleanQuiescence && everyLanded && landed.size > 0) {
      const finalizeState: FinalizationState = {
        unitsAllDone: true,
        committedSha: result.committed
          ? await this.gitShortSha(worktreePath)
          : "",
        deliveryWritten: !!result.deliveryDoc,
        slicesStillReady: slices
          .filter((s) => landed.has(s.handle) && !doneSlices.has(s.handle))
          .map((s) => s.handle),
      };
      const verdict = finalizationVerdict(finalizeState);
      if (typeof verdict !== "string") {
        wedged = true;
        // The run never truly finalized — don't let `committed` (set optimistically above) hide it.
        result.committed = false;
        output.appendLine(
          `⚑ SP-${specNumber}: finalization watchdog — ${FINALIZATION_WEDGED_DIAGNOSIS}. ${verdict.wedged}`,
        );
        for (const s of slices) {
          if (!landed.has(s.handle)) continue;
          await blockSlice(s.handle, verdict.wedged);
          output.appendLine(
            `⚑ ${s.handle}: units landed but the run never finalized → requires-attention.`,
          );
        }
      }
    }

    // Tear down only a fully-committed Spec (its branch persists for accept); a stalled or wedged
    // Spec keeps its worktree for the human's re-run / `/attend`. Always drop leftover parked agents.
    if (result.committed && !wedged) {
      for (const u of dag) unparkWorker(u.id);
      try {
        await this.teardown(specNumber);
        output.appendLine(
          `▸ SP-${specNumber}: worktree closed (branch kept for accept).`,
        );
      } catch (err) {
        output.appendLine(
          `▸ SP-${specNumber}: worktree teardown skipped — ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  /**
   * The closing AI-verification gate (SP-tgzyfy): run the Spec's declared `ac_verifications` as a
   * full plan against the worktree, then classify each landed slice as **AC-green** iff the ACs it
   * `satisfies` all ran green. Returns a map of the green slices → the AC ordinals they satisfy (the
   * input to the per-slice commit-before-Done step, which commits then advances + ticks those
   * ordinals — SP-th4wqc_SL-3). No skip: a Spec with no declaration (or a red / un-runnable check)
   * leaves the affected slices `requires-attention` in place (not green, never returned). The per-AC
   * results land on `result.acResults` (and the auditable report). Mutates `state` / `result`; does
   * NOT advance / commit / check ordinals — that is the caller's per-slice commit responsibility.
   */
  private async runClosingGate(
    specNumber: string,
    worktreePath: string,
    slices: SliceForDag[],
    landed: Set<string>,
    unitsBySlice: Map<string, SchedUnit[]>,
    state: SchedulerState,
    blockSlice: (slice: string, diagnosis: string) => Promise<void>,
    result: SpecRunResult,
  ): Promise<Map<string, number[]>> {
    const { output, store } = this.deps;
    const green = new Map<string, number[]>();
    const specDoc = await store.getFile(store.pathForSpecDoc(specNumber));
    const verifs = parseAcVerifications(specDoc?.frontmatter?.ac_verifications);

    if (verifs.length === 0) {
      // No declaration ⇒ the closing gate cannot run. NO SKIP: every landed slice →
      // requires-attention; nothing advances, nothing commits (TEP-tgzx3p reverses the old pass).
      const diagnosis =
        "Closing AI-verification gate could not run: the Spec declares no `ac_verifications`. " +
        "Declare a per-AC verification map on the Spec (AC ordinal → { run, env }), then re-run.";
      for (const s of slices)
        if (landed.has(s.handle)) await blockSlice(s.handle, diagnosis);
      output.appendLine(
        `⚑ SP-${specNumber}: no ac_verifications declared — closing gate un-runnable → requires-attention (no skip).`,
      );
      return green;
    }

    output.appendLine(
      `▸ SP-${specNumber}: closing gate — running ${verifs.length} declared AC verification(s).`,
    );
    const acResults = await (
      this.deps.runAcVerifications ??
      ((vs: AcVerification[], cwd: string) => runAcVerifications(vs, cwd))
    )(verifs, worktreePath);
    result.acResults = acResults;
    const pass = new Map<number, boolean>(acResults.map((r) => [r.ac, r.pass]));
    const allGreen = acResults.length > 0 && acResults.every((r) => r.pass);

    // Per slice: green iff every AC it satisfies ran green. A slice with no `satisfies` rides on the
    // whole-plan verdict (all declared checks green) — a legacy slice can't be stranded by having no
    // ordinals, but it still can't reach Done on a red plan. Red/un-runnable → requires-attention here;
    // green slices are returned for the caller to commit-before-Done (never advanced in this method).
    for (const s of slices) {
      if (!landed.has(s.handle)) continue;
      const sat = s.satisfies ?? [];
      const missing = sat.filter((n) => !pass.has(n));
      const red = sat.filter((n) => pass.get(n) === false);
      const isGreen =
        sat.length > 0 ? missing.length === 0 && red.length === 0 : allGreen;
      if (isGreen) {
        green.set(s.handle, [...sat]);
        output.appendLine(
          `✓ ${s.handle}: AC ${sat.length ? sat.map((n) => `#${n}`).join(", ") : "(plan)"} green → eligible to commit.`,
        );
      } else {
        const why = sat.length
          ? `AC ${[...missing.map((n) => `#${n} (no verification ran)`), ...red.map((n) => `#${n} (verification red)`)].join(", ")} did not pass`
          : "the declared AC verification plan was not all-green";
        await blockSlice(
          s.handle,
          `Closing gate: ${why}. The acceptance criteria were NOT verified green — see DELIVERY.md for per-AC evidence.`,
        );
        (unitsBySlice.get(s.handle) ?? []).forEach((u) =>
          state.blocked.add(u.id),
        );
        output.appendLine(
          `⚑ ${s.handle}: closing gate red → requires-attention.`,
        );
      }
    }

    return green;
  }

  /** Claim the unit's footprint → run the worker (may park resident) → release. Resolves with its outcome.
   *  `runningFootprints` reads the live UNION of every running unit's footprint (AC4) at check time; the
   *  per-unit `baseline` (the paths already dirty when this unit started) is captured here, once, before
   *  the worker runs — both fence the post-tool containment check from misattributing other units' work. */
  private async dispatchUnit(
    unit: SchedUnit,
    specNumber: string,
    worktreePath: string,
    onPark: OnPark,
    runningFootprints?: () => string[],
  ): Promise<UnitDone> {
    const claim = await this.deps.arbiter.acquire(unit.id, unit.footprint);
    if (!claim.ok) {
      // The scheduler pre-selects a disjoint frontier, so this is rare (a stale cross-Spec
      // claim). Treat as failed so the slice surfaces for attention rather than silently dropping.
      this.deps.output.appendLine(
        `▸ ${unit.id}: ownership conflict — ${claim.conflicts
          .map((c) => `${c.file} (held by ${c.heldBy})`)
          .join(", ")}.`,
      );
      return { id: unit.id, slice: unit.slice, outcome: "failed" };
    }
    startSession(unit.id);
    // Per-unit baseline (AC4): the paths already dirty in the shared worktree at THIS unit's
    // start — earlier units' already-present changes. A change present in the baseline predates
    // this unit's run, so containment must never attribute it to this unit (and revert it).
    const baseline = await this.gitDirtyPaths(worktreePath);
    try {
      const wr = await this.runWorker(
        unit,
        specNumber,
        worktreePath,
        onPark,
        runningFootprints,
        baseline,
      );
      return {
        id: unit.id,
        slice: unit.slice,
        outcome: wr.outcome,
        question: wr.question,
        sessionId: wr.sessionId,
        attention: wr.attention,
      };
    } finally {
      endSession(unit.id);
      await this.deps.arbiter.release(unit.id);
    }
  }

  /**
   * Run one execution unit. The sole substrate is the Agent SDK (`runViaSdk`); tests inject the
   * `runUnit` seam to return an outcome (success / needs-input / failed) without a live SDK call.
   */
  private runWorker(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
    runningFootprints?: () => string[],
    baseline?: string[],
  ): Promise<WorkerResult> {
    return this.deps.runUnit
      ? this.deps.runUnit(unit, specNumber, cwd, onPark)
      : this.runViaSdk(
          unit,
          specNumber,
          cwd,
          onPark,
          runningFootprints,
          baseline,
        );
  }

  /**
   * The Agent SDK worker (SP-tgs8nz_SL-2): `query()` runs a headless `claude` subprocess in the
   * worktree under `bypassPermissions` (no prompts — the PreToolUse footprint hook from SL-6 is the
   * cheap early guardrail). Typed messages are persisted to the unit's `.jsonl` (for the graph
   * float-out) and summarized to the channel. The SDK is **lazy-imported** so it never loads at
   * activation, and a load/run failure degrades to a non-success (→ requires-attention) rather than
   * crashing the host.
   *
   * The **authority** over footprint is a post-tool working-tree check (SP-6/2 AC3): a `PostToolUse`
   * hook runs after EVERY tool call (Bash included — `rm`/`mv`/`sed -i`/redirect carry no `file_path`
   * the PreToolUse guard can pre-screen) and diffs the worktree against the unit's declared footprint.
   * Any out-of-footprint create/modify/delete is **terminal**: we abort the `query()` (the SDK
   * `AbortController`), revert ONLY the offending path(s) (`git restore`/`clean` — a sibling's
   * in-progress work in the shared tree survives), and fail the unit with a diagnosis naming the path
   * so its slice is flagged requires-attention. This is NOT a recoverable deny the worker can route
   * around — it closes the stub-and-`rm` hole that the Edit/Write-only PreToolUse guard could not see.
   */
  private async runViaSdk(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
    runningFootprints?: () => string[],
    baseline?: string[],
  ): Promise<WorkerResult> {
    const prompt = buildWorkerPrompt(unit, specNumber, {
      specBody: this.promptCtx.specBody,
      sliceBody: this.promptCtx.sliceBodies.get(unit.slice),
    });
    let success = false;
    let sessionId: string | undefined;
    let turnText = "";
    let parkedOnce = false;
    // Set by the post-tool containment hard-stop (AC3) when a tool call left an out-of-footprint
    // change: its diagnosis names the offending path and makes the unit fail → requires-attention.
    // Once set, the run is terminal — it takes precedence over any later `success`.
    let containmentReason: string | undefined;
    // Aborts the live `query()` the instant containment fires (SDK `Options.abortController`).
    const abort = new AbortController();

    // Streaming-input session (SL-3 resident standby): yield the task; when the agent ends a turn
    // with a `⟦NEEDS-INPUT⟧` question, the session stays alive (suspended at `await nextInput`) and
    // we `onPark` it off the active cap. `/attend` resolves `nextInput` with the answer → the agent
    // continues in place. No process restart, no context re-read while within the cache TTL.
    let resolveNext: (v: string | null) => void = () => {};
    const nextInput = new Promise<string | null>((r) => (resolveNext = r));
    const userMsg = (content: string) => ({
      type: "user" as const,
      message: { role: "user" as const, content },
      parent_tool_use_id: null,
    });
    const input = (async function* () {
      yield userMsg(prompt);
      const a = await nextInput;
      if (a != null) yield userMsg(a);
    })();

    try {
      const query =
        this.deps.sdkQuery ??
        (await import("@anthropic-ai/claude-agent-sdk")).query;
      for await (const msg of query({
        prompt: input,
        options: {
          cwd,
          permissionMode: "bypassPermissions",
          // Aborting this stops the query the moment the post-tool containment check fires (AC3).
          abortController: abort,
          hooks: {
            // The cheap early guardrail (SL-6): a PreToolUse hook runs FIRST and denies any Edit/Write
            // outside this unit's footprint — silently, no prompt. Must be a hook, not
            // `canUseTool`, which bypassPermissions/acceptEdits skip for edits.
            PreToolUse: [
              {
                hooks: [
                  async (input: unknown) => {
                    const inp = input as {
                      tool_name?: string;
                      tool_input?: unknown;
                    };
                    const d = footprintGuard(
                      inp.tool_name ?? "",
                      inp.tool_input,
                      unit.footprint,
                      cwd,
                    );
                    if (d.allow) return {};
                    this.deps.output.appendLine(
                      `  ⛔ [${unit.id}] denied: ${d.reason.split("\n")[0]}`,
                    );
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: d.reason,
                      },
                    };
                  },
                ],
              },
            ],
            // The authority (AC3): after EVERY tool call — Bash included — diff the worktree vs the
            // footprint and hard-stop on any out-of-footprint change. This is terminal (abort +
            // revert-only-the-offending-path → requires-attention), NOT a recoverable deny: a Bash
            // `rm`/`mv`/`sed -i`/redirect carries no `file_path` for the PreToolUse guard to screen,
            // so the post-tool diff is what closes the stub-and-`rm` hole.
            PostToolUse: [
              {
                hooks: [
                  async () => {
                    // Already tripped (a prior tool in the same batch) — don't re-diff/re-revert.
                    if (containmentReason) return {};
                    // AC4: pass the running-units footprint UNION (read live at check time) and this
                    // unit's start baseline so a concurrent sibling's in-footprint change, or a change
                    // already present before this unit started, is never misattributed here + reverted.
                    const verdict = await this.containmentCheck(
                      cwd,
                      unit.footprint,
                      {
                        running: runningFootprints?.() ?? [],
                        baseline: baseline ?? [],
                      },
                    );
                    if (verdict.ok) return {};
                    containmentReason = verdict.reason;
                    this.deps.output.appendLine(
                      `  ⛔ [${unit.id}] footprint breach — aborting + reverting ${verdict.violations
                        .map((v) => `${v.change} ${v.file}`)
                        .join(", ")}.`,
                    );
                    // Settle the streaming-input generator and tear down the live query.
                    resolveNext(null);
                    abort.abort();
                    return {};
                  },
                ],
              },
            ],
          },
        },
      })) {
        const rec = msg as unknown as Record<string, unknown>;
        appendSession(unit.id, JSON.stringify(rec) + "\n");
        sessionId = sessionId ?? sessionIdOf(rec);
        const line = summarizeEvent(rec);
        if (line) {
          this.deps.output.appendLine(`  [${unit.id}] ${line}`);
          turnText += line + "\n";
        }
        if (isResultSuccess(rec)) success = true;
        if (rec.type === "result") {
          // A turn ended. Finish on success; otherwise park once on a question; otherwise stop.
          if (success) {
            resolveNext(null);
          } else if (!parkedOnce) {
            const q = extractNeedsInput(turnText);
            if (q) {
              parkedOnce = true;
              turnText = "";
              onPark(unit, q, (ans) => resolveNext(ans));
            } else {
              resolveNext(null);
            }
          } else {
            resolveNext(null);
          }
        }
      }
    } catch (err) {
      resolveNext(null);
      // A containment hard-stop aborts the query, which surfaces here as an abort error — that is
      // the EXPECTED terminal path, not an SDK failure: fail the unit with the offending-path
      // diagnosis so its slice is flagged requires-attention naming the breach.
      if (containmentReason)
        return { outcome: "failed", sessionId, attention: containmentReason };
      this.deps.output.appendLine(
        `  ✗ ${unit.id} SDK worker error: ${(err as Error).message}`,
      );
      return { outcome: "failed", sessionId };
    }
    // A containment breach is terminal even if the abort raced a `result: success`.
    if (containmentReason)
      return { outcome: "failed", sessionId, attention: containmentReason };
    return success
      ? { outcome: "success", sessionId }
      : { outcome: "failed", sessionId };
  }

  /** Post-tool footprint containment (SP-6/2 AC3): diff the worktree against `footprint` and revert
   *  only the out-of-footprint changes, returning the verdict. Routes through the injectable seam
   *  (tests) or the real git-based default. */
  private containmentCheck(
    cwd: string,
    footprint: string[],
    ctx?: { running?: string[]; baseline?: string[] },
  ): Promise<ContainmentResult> {
    return (
      this.deps.containmentCheck ??
      ((c, f, x) => this.defaultContainmentCheck(c, f, x))
    )(cwd, footprint, ctx);
  }

  /**
   * Default containment check (SP-6/2 AC3): `git status --porcelain` in the worktree → the pure
   * {@link footprintContainment} (which surfaces every create/modify/delete outside the footprint,
   * Bash-made ones included) → on a violation, `git restore`/`clean` of ONLY the offending paths,
   * so a sibling unit's in-progress work in the shared tree is never reverted. Best-effort at the
   * git layer; returns the verdict the caller acts on (abort the query + fail requires-attention).
   */
  private async defaultContainmentCheck(
    cwd: string,
    footprint: string[],
    ctx?: { running?: string[]; baseline?: string[] },
  ): Promise<ContainmentResult> {
    const porcelain = await this.gitPorcelain(cwd);
    // AC4: `running` (the running-units footprint union) and `baseline` (paths already dirty
    // at this unit's start) exempt OTHER units' legitimate changes from this whole-tree diff,
    // so the revert below only ever touches THIS unit's true out-of-footprint changes.
    const verdict = footprintContainment(porcelain, footprint, {
      running: ctx?.running,
      baseline: ctx?.baseline,
    });
    if (!verdict.ok)
      await this.revertPaths(
        cwd,
        verdict.violations.map((v) => v.file),
      );
    return verdict;
  }

  /** The worktree diff as `git status --porcelain` text; "" on any git error (degrades to no diff). */
  private gitPorcelain(cwd: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const proc = spawn("git", ["status", "--porcelain"], { cwd });
      let out = "";
      proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", () => resolve(out));
    });
  }

  /**
   * The set of repo-relative paths already dirty in the worktree (the per-unit containment
   * baseline, AC4) — every endpoint `footprintContainment` would derive from the current
   * `git status --porcelain`, captured at a unit's START. A change present here predates the
   * unit's run, so its post-tool check must not attribute it to (and revert) this unit. Reuses
   * `footprintContainment` with an empty footprint so the porcelain parsing/quoting/rename-split
   * stays in one place; "" porcelain (clean tree or git error) yields an empty baseline.
   */
  private async gitDirtyPaths(cwd: string): Promise<string[]> {
    const porcelain = await this.gitPorcelain(cwd);
    const verdict = footprintContainment(porcelain, []);
    return verdict.ok ? [] : verdict.violations.map((v) => v.file);
  }

  /**
   * Revert ONLY the given out-of-footprint paths (SP-6/2 AC3) — never the whole tree, so a sibling's
   * concurrent work survives. Per path, two best-effort git calls cover every change kind: `git
   * restore --source=HEAD --staged --worktree` undoes a tracked modify/delete back to HEAD (a no-op
   * error for an untracked path), and `git clean -fdq` removes an untracked create. Errors are
   * swallowed — the leftover (if any) re-surfaces on the next post-tool diff.
   */
  private async revertPaths(cwd: string, files: string[]): Promise<void> {
    for (const f of files) {
      await this.runGit(
        ["restore", "--source=HEAD", "--staged", "--worktree", "--", f],
        cwd,
      );
      await this.runGit(["clean", "-fdq", "--", f], cwd);
    }
  }

  /** Run `git <args>` in `cwd`, resolving regardless of exit code (best-effort revert). */
  private runGit(args: string[], cwd: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const proc = spawn("git", args, { cwd });
      proc.on("error", () => resolve());
      proc.on("close", () => resolve());
    });
  }

  private checkAcs(specNumber: string, ordinals: number[]): Promise<void> {
    return (this.deps.checkAcs ?? ((n, o) => this.defaultCheckAcs(n, o)))(
      specNumber,
      ordinals,
    );
  }

  /** Default AC-check: tick the given ordinals' boxes under the Spec body's `## Acceptance
   *  Criteria` and write the Spec doc back (frontmatter preserved). A no-op for empty ordinals. */
  private async defaultCheckAcs(
    specNumber: string,
    ordinals: number[],
  ): Promise<void> {
    if (!ordinals.length) return;
    const rel = this.deps.store.pathForSpecDoc(specNumber);
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed) return;
    const body = checkAcOrdinals(parsed.body ?? "", ordinals);
    if (body !== parsed.body)
      await this.deps.store.writeFile(rel, parsed.frontmatter, body);
  }

  /** Short HEAD sha of the worktree (for the delivery summary); "" on any error. */
  private gitShortSha(cwd: string): Promise<string> {
    if (this.deps.gitShortSha) return this.deps.gitShortSha(cwd);
    return new Promise<string>((resolve) => {
      const proc = spawn("git", ["rev-parse", "--short", "HEAD"], { cwd });
      let out = "";
      proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      proc.on("error", () => resolve(""));
      proc.on("close", () => resolve(out.trim()));
    });
  }

  /** Build the auditable delivery report (SP-tgzyfy): the per-AC pass/fail table + evidence, the
   *  per-unit outcomes, caught problems, and the commit. Delegates to the pure `buildDeliveryReport`. */
  private deliveryMarkdown(
    specNumber: string,
    sha: string,
    files: string[],
    result: SpecRunResult,
    verifs: AcVerification[],
  ): string {
    // Caught problems for the audit trail: each failed / parked unit, surfaced from the run.
    const problems = result.results
      .filter((r) => r.outcome !== "success")
      .map(
        (r) =>
          `\`${r.id}\` (${r.slice}) — ${r.outcome}${r.outcome === "needs-input" ? " (worker asked a question)" : ""}.`,
      );
    return buildDeliveryReport({
      specNumber,
      sha,
      files,
      units: result.results.map((r) => ({ id: r.id, outcome: r.outcome })),
      declared: verifs,
      acResults: result.acResults,
      problems,
      advanced: result.advanced,
      attention: result.attention,
      committed: result.committed,
    });
  }

  /** Write the delivery summary to `specs/SP-{n}/DELIVERY.md` (a separate doc, so it doesn't touch
   *  the spec body / trip the staleness hash). Returns the thinking space-relative path, or undefined. */
  private async writeDeliverySummary(
    specNumber: string,
    worktreePath: string,
    result: SpecRunResult,
    dag: SchedUnit[],
  ): Promise<string | undefined> {
    try {
      const sha = await this.gitShortSha(worktreePath);
      const files = [...new Set(dag.flatMap((u) => u.footprint))].sort();
      const specDoc = await this.deps.store.getFile(
        this.deps.store.pathForSpecDoc(specNumber),
      );
      const verifs = parseAcVerifications(
        specDoc?.frontmatter?.ac_verifications,
      );
      const body = this.deliveryMarkdown(
        specNumber,
        sha,
        files,
        result,
        verifs,
      );
      const rel = this.deps.store
        .pathForSpecDoc(specNumber)
        .replace(/spec\.md$/, "DELIVERY.md");
      fs.writeFileSync(
        path.join(this.deps.store.thinkubeDir, rel),
        body,
        "utf8",
      );
      this.deps.output.appendLine(
        `▸ SP-${specNumber}: delivery summary → ${rel}`,
      );
      return rel;
    } catch (err) {
      this.deps.output.appendLine(
        `▸ SP-${specNumber}: delivery summary skipped — ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private advance(handle: string): Promise<void> {
    return (this.deps.advance ?? ((h) => this.defaultAdvance(h)))(handle);
  }

  /** Default advance: stamp the slice `status: done` in its file. */
  private async defaultAdvance(handle: string): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "done" },
      parsed.body,
    );
  }

  private flagAttention(handle: string, diagnosis: string): Promise<void> {
    return (
      this.deps.flagAttention ?? ((h, d) => this.defaultFlagAttention(h, d))
    )(handle, diagnosis);
  }

  /**
   * Default requires-attention flag: stamp the slice `status: requires-attention` and append
   * the worker's failure diagnosis to its body, so the stalled card carries the reason a human
   * needs (AC4). `/attend` (SL-5) returns it to the loop.
   */
  private async defaultFlagAttention(
    handle: string,
    diagnosis: string,
  ): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    const note = `\n\n## ⚑ Requires attention\n\n${diagnosis}\n`;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "requires-attention" },
      (parsed.body ?? "") + note,
    );
  }

  private flagNeedsInput(
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ): Promise<void> {
    return (
      this.deps.flagNeedsInput ??
      ((h, q, s, u) => this.defaultFlagNeedsInput(h, q, s, u))
    )(handle, question, sessionId, unitId);
  }

  /**
   * Default needs-input park (SL-3): mark the slice `requires-attention` (the human-needed column)
   * but distinct from a failure — `needs_input: true` + the worker's `worker_session` (resume
   * fallback) + `worker_unit` (the resident-session key `/attend` uses) + the question under a
   * `## ❓ Needs input` heading. `/attend` (SL-5) answers it.
   */
  private async defaultFlagNeedsInput(
    handle: string,
    question: string,
    sessionId?: string,
    unitId?: string,
  ): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    const note = `\n\n## ❓ Needs input\n\n${question}\n`;
    await this.deps.store.writeFile(
      rel,
      {
        ...parsed.frontmatter,
        status: "requires-attention",
        needs_input: true,
        ...(sessionId ? { worker_session: sessionId } : {}),
        ...(unitId ? { worker_unit: unitId } : {}),
      },
      (parsed.body ?? "") + note,
    );
  }

  private commit(
    handle: string,
    specNumber: string,
    cwd: string,
  ): Promise<void> {
    return (this.deps.commit ?? ((h, n, c) => this.defaultCommit(h, n, c)))(
      handle,
      specNumber,
      cwd,
    );
  }

  /** Roll a slice back to `ready` (SP-th4wqc_SL-3): used when its commit fails so it is never left
   *  Done with uncommitted work. Defaults to stamping `status: ready`. */
  private rollbackToReady(handle: string): Promise<void> {
    return (
      this.deps.rollbackToReady ?? ((h) => this.defaultRollbackToReady(h))
    )(handle);
  }

  /** Default rollback: stamp the slice `status: ready` (clearing any stale `units_landed`) so a
   *  later run re-attempts it. The work itself stays in the worktree — a re-run RESUMES (commits)
   *  rather than re-authors only when the run records `units_landed` without a commit. */
  private async defaultRollbackToReady(handle: string): Promise<void> {
    const m = /^TEP-(\d+)_SP-(\d+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(`${m[1]}/${m[2]}`, Number(m[3]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "ready" },
      parsed.body,
    );
  }

  /** Tear down a finished Spec: remove its worktree (the committed branch survives the removal). */
  private teardown(specNumber: string): Promise<void> {
    return (
      this.deps.teardown ??
      ((n: string) =>
        this.deps.worktrees.remove(this.deps.canonicalRepo, n).then(() => {}))
    )(specNumber);
  }

  /**
   * Default per-slice commit (SP-th4wqc_SL-3): stage everything present and commit it as ONE slice's
   * landing, then **publish the branch** (workers never commit). Commit-before-Done — the caller only
   * marks the slice Done after this resolves; a rejection would roll it back to `ready`. Best-effort
   * at the git layer — a "nothing to commit" exit (e.g. a sibling slice already swept the worktree in
   * the same run) is NOT a failure, so we resolve rather than reject and the slice still advances. A
   * genuine rollback is driven by an injected git that rejects (tests). The branch MUST be pushed so
   * the commit isn't local-only (TEP-th3i18 #29); push is non-interactive and best-effort.
   */
  private defaultCommit(
    handle: string,
    specNumber: string,
    cwd: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const add = spawn("git", ["add", "-A"], { cwd });
      add.on("error", () => resolve());
      add.on("close", () => {
        const commit = spawn(
          "git",
          ["commit", "-m", `feat(${handle}): orchestrated slice complete`],
          { cwd },
        );
        commit.on("error", () => resolve());
        commit.on("close", () => {
          const push = spawn(
            "git",
            [
              "push",
              "-u",
              "origin",
              `spec/TEP-${specNumber.replace("/", "_SP-")}`,
            ],
            { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
          );
          push.on("error", () => resolve());
          push.on("close", () => resolve());
        });
      });
    });
  }
}

interface UnitDone {
  id: string;
  slice: string;
  outcome: UnitOutcome;
  /** The escalated question (needs-input only). */
  question?: string;
  /** The worker's session id (for resume-on-answer). */
  sessionId?: string;
  /** A requires-attention diagnosis to surface verbatim (failed only) — the footprint-containment
   *  hard-stop's offending-path message (SP-6/2 AC3). */
  attention?: string;
}
