/**
 * Board orchestrator (SP-tgs8nz) — the integration shell around `orchestratorCore`'s pure
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
  type SliceForDag,
  type SchedUnit,
  type SchedulerState,
  type WorkUnit,
} from "./orchestratorCore";
import { validateDag, footprintGuard } from "../methodology/parallelSlices";
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

const SLICE_REL_RE = /specs\/SP-(.+?)\/SL-(\d+)\.md$/;

export interface OrchestratorDeps {
  worktrees: WorktreeService;
  arbiter: OwnershipArbiter;
  store: ThinkubeStore;
  output: vscode.OutputChannel;
  /** Absolute path to the canonical (non-worktree) code repo. */
  canonicalRepo: string;
  /** `thinkube.boards.root` — injected into the worktree's `.mcp.json`. */
  boardRoot?: string;
  /** `thinkube.worktree.baseDir` — where linked worktrees are created. */
  baseDir?: string;
  /** Verify a slice at grain in its worktree (tests): defaults to `npm run compile`. */
  verify?: (cwd: string) => Promise<boolean>;
  /** `thinkube.orchestrator.verifyCommand` — a shell verify recipe run in the worktree; when set
   *  it overrides the `npm run compile` default (e.g. `ansible-lint` for an Ansible repo). */
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
  /** Commit the worktree once the whole Spec is Done (tests): defaults to `git add -A && git commit`. */
  commit?: (specNumber: string, cwd: string) => Promise<void>;
  /** Tear down a finished Spec — close its worktree (tests): defaults to `WorktreeService.remove`. */
  teardown?: (specNumber: string) => Promise<void>;
  /** Run one execution unit (tests): overrides the SDK substrate; `onPark` parks it resident. */
  runUnit?: (
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
  ) => Promise<WorkerResult>;
}

/** What a worker run resolved to — the third outcome carries the escalated question + session id. */
export interface WorkerResult {
  outcome: UnitOutcome;
  /** The escalated question (needs-input only). */
  question?: string;
  /** The worker's session id, captured for resume-on-answer (SL-3 / SL-5). */
  sessionId?: string;
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
  /** The whole Spec landed and was committed. */
  committed: boolean;
}

export class OrchestratorService {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Read the Spec's slices into the DAG-builder input (frontmatter → SliceForDag). */
  private async buildSlices(specNumber: string): Promise<SliceForDag[]> {
    const { store } = this.deps;
    const slices: SliceForDag[] = [];
    for (const rel of await store.listSlices(specNumber)) {
      const m = SLICE_REL_RE.exec(rel);
      if (!m) continue;
      const fm = (await store.getFile(rel))?.frontmatter;
      slices.push({
        handle: store.sliceHandle(specNumber, Number(m[2])),
        status: String(fm?.status ?? "ready"),
        dependsOn: Array.isArray(fm?.depends_on)
          ? (fm!.depends_on as string[])
          : [],
        files: Array.isArray(fm?.files) ? (fm!.files as string[]) : [],
        workUnits: Array.isArray(fm?.work_units)
          ? (fm!.work_units as (WorkUnit & { note?: string })[])
          : [],
      });
    }
    return slices;
  }

  /**
   * Run the makespan scheduler over `specNumber`'s work-unit DAG: validate the DAG, then keep up
   * to `cap` workers saturated dispatching the ready, footprint-disjoint, critical-path frontier
   * (units pooled across slices). A slice verifies + advances when its last unit lands; a failed
   * unit or red verify flags its slice `requires-attention` and blocks it. When every slice is
   * Done the worktree is committed **once**.
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
      committed: false,
    };

    const slices = await this.buildSlices(specNumber);
    const dag = buildUnitDag(slices);

    // Deterministic gate: reject a malformed DAG before any worker runs.
    const v = validateDag(dag.map((u) => ({ id: u.id, dependsOn: u.dependsOn })));
    if (!v.ok) {
      output.appendLine(`✗ SP-${specNumber}: malformed DAG — not dispatched.\n${v.reason}`);
      return { ...result, ok: false, reason: v.reason };
    }

    // Seed scheduler state from board statuses.
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
    // Slices that are verified+advanced (or already done on the board) — the **commit gate**.
    // Tracked apart from `state.done` because a legacy slice's unit id equals its handle, so a
    // unit completing must NOT mark its slice committable until the slice-grain verify passes.
    const doneSlices = new Set<string>();
    for (const s of slices) {
      const st = s.status.toLowerCase();
      const ids = (unitsBySlice.get(s.handle) ?? []).map((u) => u.id);
      if (st === "done" || st === "archived") {
        state.done.add(s.handle);
        doneSlices.add(s.handle);
        ids.forEach((id) => state.done.add(id));
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
    if (readyFrontier(dag, state).length === 0) {
      output.appendLine(`▸ SP-${specNumber}: nothing ready to dispatch.`);
      return result;
    }

    const worktreePath = await this.deps.worktrees.create(
      this.deps.canonicalRepo,
      specNumber,
      this.deps.baseDir,
      this.deps.boardRoot,
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
        running.set(u.id, this.dispatchUnit(u, specNumber, worktreePath, onPark));
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
        // board for resume-by-session-id (/attend fallback).
        await this.flagNeedsInput(
          d.slice,
          d.question ?? "(no question text)",
          d.sessionId,
          d.id,
        );
        (unitsBySlice.get(d.slice) ?? []).forEach((u) => state.blocked.add(u.id));
        remaining.delete(d.slice);
        if (!result.needsInput.includes(d.slice)) result.needsInput.push(d.slice);
        output.appendLine(
          `❓ ${d.slice}: ${d.id} asked a question → needs-input (slot freed).`,
        );
      } else if (d.outcome === "failed") {
        await blockSlice(
          d.slice,
          `Worker for ${d.id} exited without success — see the session JSON-log.`,
        );
        output.appendLine(`⚑ ${d.slice}: ${d.id} failed → requires-attention.`);
      } else {
        state.done.add(d.id);
        markUnitDone(d.id); // graph: show this worker's node done (lime) until re-dispatch
        const rem = (remaining.get(d.slice) ?? 1) - 1;
        remaining.set(d.slice, rem);
        if (rem <= 0) {
          // Slice complete → verify-join at slice grain.
          const verified = await this.verify(worktreePath);
          if (verified) {
            state.done.add(d.slice);
            doneSlices.add(d.slice);
            remaining.delete(d.slice);
            await this.advance(d.slice);
            result.advanced.push(d.slice);
            output.appendLine(`✓ ${d.slice}: all units landed + verified → Done.`);
          } else {
            await blockSlice(
              d.slice,
              "All units landed but the slice-grain verify was red in the worktree.",
            );
            output.appendLine(`⚑ ${d.slice}: verify red → requires-attention.`);
          }
        }
      }
      fill();
    }

    // Commit ONCE when every slice is Done (workers never commit — the orchestrator owns git),
    // then TEAR DOWN: close the Spec's worktree (its branch persists for the accept step) and
    // drop any leftover parked agents (SP-tgs8nz_SL-5).
    if (slices.every((s) => doneSlices.has(s.handle))) {
      await this.commit(specNumber, worktreePath);
      result.committed = true;
      output.appendLine(`✓ SP-${specNumber}: all slices Done — committed.`);
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
    } else if (remaining.size > 0) {
      output.appendLine(
        `▸ SP-${specNumber}: paused — ${remaining.size} slice(s) still have unreached units (blocked deps); nothing committed.`,
      );
    } else {
      output.appendLine(
        `▸ SP-${specNumber}: ${result.attention.length} slice(s) need attention; nothing committed.`,
      );
    }
    return result;
  }

  /** Claim the unit's footprint → run the worker (may park resident) → release. Resolves with its outcome. */
  private async dispatchUnit(
    unit: SchedUnit,
    specNumber: string,
    worktreePath: string,
    onPark: OnPark,
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
    try {
      const wr = await this.runWorker(unit, specNumber, worktreePath, onPark);
      return {
        id: unit.id,
        slice: unit.slice,
        outcome: wr.outcome,
        question: wr.question,
        sessionId: wr.sessionId,
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
  ): Promise<WorkerResult> {
    return this.deps.runUnit
      ? this.deps.runUnit(unit, specNumber, cwd, onPark)
      : this.runViaSdk(unit, specNumber, cwd, onPark);
  }

  /**
   * The Agent SDK worker (SP-tgs8nz_SL-2): `query()` runs a headless `claude` subprocess in the
   * worktree under `bypassPermissions` (no prompts — the PreToolUse footprint hook from SL-6 is the
   * guardrail). Typed messages are persisted to the unit's `.jsonl` (for the graph float-out) and
   * summarized to the channel. The SDK is **lazy-imported** so it never loads at activation, and a
   * load/run failure degrades to a non-success (→ requires-attention) rather than crashing the host.
   */
  private async runViaSdk(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
    onPark: OnPark,
  ): Promise<WorkerResult> {
    const prompt = buildWorkerPrompt(unit, specNumber);
    let success = false;
    let sessionId: string | undefined;
    let turnText = "";
    let parkedOnce = false;

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
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      for await (const msg of query({
        prompt: input,
        options: {
          cwd,
          permissionMode: "bypassPermissions",
          // The guardrail (SL-6): a PreToolUse hook runs FIRST and denies any Edit/Write
          // outside this unit's footprint — silently, no prompt. Must be a hook, not
          // `canUseTool`, which bypassPermissions/acceptEdits skip for edits.
          hooks: {
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
      this.deps.output.appendLine(
        `  ✗ ${unit.id} SDK worker error: ${(err as Error).message}`,
      );
      resolveNext(null);
      return { outcome: "failed", sessionId };
    }
    return success
      ? { outcome: "success", sessionId }
      : { outcome: "failed", sessionId };
  }

  private verify(cwd: string): Promise<boolean> {
    return (this.deps.verify ?? ((c) => this.defaultVerify(c)))(cwd);
  }

  /**
   * Slice-grain verify in the worktree (green = exit 0). In order:
   *  1. `thinkube.orchestrator.verifyCommand` if set (a shell recipe, e.g. `ansible-lint`);
   *  2. else `npm run compile` if the repo has a `package.json` (the JS default);
   *  3. else SKIP — a JS-only gate must not falsely fail a non-JS repo (the Ansible case). The
   *     skip is logged, not silent; set the setting for a real gate.
   */
  private defaultVerify(cwd: string): Promise<boolean> {
    const cmd = this.deps.verifyCommand?.trim();
    if (cmd) {
      this.deps.output.appendLine(`  ▸ verify: ${cmd}`);
      return new Promise<boolean>((resolve) => {
        const proc = spawn(cmd, { cwd, shell: true });
        proc.on("error", () => resolve(false));
        proc.on("close", (code) => resolve(code === 0));
      });
    }
    if (fs.existsSync(path.join(cwd, "package.json"))) {
      return new Promise<boolean>((resolve) => {
        const proc = spawn("npm", ["run", "compile"], { cwd });
        proc.on("error", () => resolve(false));
        proc.on("close", (code) => resolve(code === 0));
      });
    }
    this.deps.output.appendLine(
      "  ▸ verify: no recipe (no package.json, and thinkube.orchestrator.verifyCommand unset) — " +
        "treating as PASS. Set thinkube.orchestrator.verifyCommand for a real gate.",
    );
    return Promise.resolve(true);
  }

  private advance(handle: string): Promise<void> {
    return (this.deps.advance ?? ((h) => this.defaultAdvance(h)))(handle);
  }

  /** Default advance: stamp the slice `status: done` in its file. */
  private async defaultAdvance(handle: string): Promise<void> {
    const m = /^SP-(.+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(m[1], Number(m[2]));
    const parsed = await this.deps.store.getFile(rel);
    if (!parsed?.frontmatter) return;
    await this.deps.store.writeFile(
      rel,
      { ...parsed.frontmatter, status: "done" },
      parsed.body,
    );
  }

  private flagAttention(handle: string, diagnosis: string): Promise<void> {
    return (this.deps.flagAttention ?? ((h, d) => this.defaultFlagAttention(h, d)))(
      handle,
      diagnosis,
    );
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
    const m = /^SP-(.+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(m[1], Number(m[2]));
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
    const m = /^SP-(.+)_SL-(\d+)$/.exec(handle);
    if (!m) return;
    const rel = this.deps.store.pathForSlice(m[1], Number(m[2]));
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

  private commit(specNumber: string, cwd: string): Promise<void> {
    return (this.deps.commit ?? ((n, c) => this.defaultCommit(n, c)))(
      specNumber,
      cwd,
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
   * Default commit-once: stage everything and commit in the Spec's worktree (workers never
   * commit). Best-effort — a "nothing to commit" exit is not an error. The merge-back to the
   * canonical branch is the human's accept step (SP-tgqf1v), not forced here.
   */
  private defaultCommit(specNumber: string, cwd: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const add = spawn("git", ["add", "-A"], { cwd });
      add.on("error", () => resolve());
      add.on("close", () => {
        const commit = spawn(
          "git",
          ["commit", "-m", `feat(SP-${specNumber}): orchestrated Spec complete`],
          { cwd },
        );
        commit.on("error", () => resolve());
        commit.on("close", () => resolve());
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
}
