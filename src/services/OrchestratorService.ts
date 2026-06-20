/**
 * Board orchestrator (SP-tgs8nz) — the integration shell around `orchestratorCore`'s pure
 * scheduler. `dispatchSpec` runs a **makespan scheduler over the Spec's work-unit DAG**: it
 * pools every slice's execution units into one graph (units span slices, never Specs), keeps
 * a per-Spec pool of N workers saturated (ready frontier ∧ footprint-disjoint, critical-path
 * first), verifies each slice when all its units land, and commits **once** when the whole
 * Spec is green. A worker is a headless `claude -p` (the SDK `query()` substrate swaps in
 * behind the injectable `spawnWorker`); workers only edit files — the orchestrator owns git.
 *
 * The pure DAG/frontier/prompt logic lives in `orchestratorCore` + `parallelSlices`
 * (unit-tested). This shell is the low-AI-testability part (live spawn + worktree + commit):
 * its end-to-end behaviour is a human verdict (SP-tgsdvw lever), exercised here with fakes.
 */
import { spawn } from "child_process";
import type * as vscode from "vscode";
import type { WorktreeService } from "./WorktreeService";
import type { OwnershipArbiter } from "./OwnershipArbiter";
import type { ThinkubeStore } from "../store/ThinkubeStore";
import {
  buildUnitDag,
  readyFrontier,
  buildWorkerPrompt,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  type SliceForDag,
  type SchedUnit,
  type SchedulerState,
  type WorkUnit,
} from "./orchestratorCore";
import { validateDag } from "../methodology/parallelSlices";
import {
  startSession,
  appendSession,
  endSession,
} from "./orchestratorSessions";

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
  /** Override the spawn (tests): defaults to spawning the real `claude`. */
  spawnWorker?: (args: string[], cwd: string) => SpawnedWorker;
  /** Verify a slice at grain in its worktree (tests): defaults to `npm run compile`. */
  verify?: (cwd: string) => Promise<boolean>;
  /** Advance a slice to Done (tests): defaults to stamping `status: done`. */
  advance?: (handle: string) => Promise<void>;
  /** Flag a slice requires-attention with a diagnosis (tests): defaults to a frontmatter+body write. */
  flagAttention?: (handle: string, diagnosis: string) => Promise<void>;
  /** Commit the worktree once the whole Spec is Done (tests): defaults to `git add -A && git commit`. */
  commit?: (specNumber: string, cwd: string) => Promise<void>;
}

/** Minimal shape of a spawned worker process the shell consumes. */
export interface SpawnedWorker {
  stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
}

export type UnitOutcome = "success" | "failed";

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
  /** Slices flagged requires-attention this run. */
  attention: string[];
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
      } else if (st !== "ready") {
        // doing / requires-attention — not dispatchable, and not done (deps wait).
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

    const fill = () => {
      for (const u of readyFrontier(dag, state)) {
        if (running.size >= limit) break;
        if (running.has(u.id)) continue;
        u.footprint.forEach((f) => state.running.add(f));
        running.set(u.id, this.dispatchUnit(u, specNumber, worktreePath));
        result.dispatched++;
        output.appendLine(
          `▸ ${u.id} [${u.shape}] dispatched (${running.size}/${limit})`,
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
      const d = await Promise.race(running.values());
      running.delete(d.id);
      (footprintsOf.get(d.id) ?? []).forEach((f) => state.running.delete(f));
      result.results.push({ id: d.id, slice: d.slice, outcome: d.outcome });

      if (d.outcome === "failed") {
        await blockSlice(
          d.slice,
          `Worker for ${d.id} exited without success — see the session JSON-log.`,
        );
        output.appendLine(`⚑ ${d.slice}: ${d.id} failed → requires-attention.`);
      } else {
        state.done.add(d.id);
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

    // Commit ONCE when every slice is Done (workers never commit — the orchestrator owns git).
    if (slices.every((s) => doneSlices.has(s.handle))) {
      await this.commit(specNumber, worktreePath);
      result.committed = true;
      output.appendLine(`✓ SP-${specNumber}: all slices Done — committed.`);
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

  /** Claim the unit's footprint → run the worker → release. Resolves with its outcome. */
  private async dispatchUnit(
    unit: SchedUnit,
    specNumber: string,
    worktreePath: string,
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
      const ok = await this.runWorker(unit, specNumber, worktreePath);
      return { id: unit.id, slice: unit.slice, outcome: ok ? "success" : "failed" };
    } finally {
      endSession(unit.id);
      await this.deps.arbiter.release(unit.id);
    }
  }

  /**
   * Run one execution unit. The **default substrate is the Agent SDK** (`runViaSdk`); a test or a
   * `claude -p` fallback injects `spawnWorker` to take the subprocess path. Returns true on a
   * `result: success`.
   */
  private runWorker(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
  ): Promise<boolean> {
    return this.deps.spawnWorker
      ? this.runViaSpawn(unit, specNumber, cwd)
      : this.runViaSdk(unit, specNumber, cwd);
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
  ): Promise<boolean> {
    const prompt = buildWorkerPrompt(unit, specNumber);
    let success = false;
    try {
      const { query } = await import("@anthropic-ai/claude-agent-sdk");
      for await (const msg of query({
        prompt,
        options: { cwd, permissionMode: "bypassPermissions" },
      })) {
        const rec = msg as unknown as Record<string, unknown>;
        appendSession(unit.id, JSON.stringify(rec) + "\n");
        const line = summarizeEvent(rec);
        if (line) this.deps.output.appendLine(`  [${unit.id}] ${line}`);
        if (isResultSuccess(rec)) success = true;
      }
    } catch (err) {
      this.deps.output.appendLine(
        `  ✗ ${unit.id} SDK worker error: ${(err as Error).message}`,
      );
      return false;
    }
    return success;
  }

  /** The subprocess worker (injected `spawnWorker`): a headless `claude -p`, stream-json parsed. */
  private runViaSpawn(
    unit: SchedUnit,
    specNumber: string,
    cwd: string,
  ): Promise<boolean> {
    const prompt = buildWorkerPrompt(unit, specNumber);
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      // Autonomy posture (SP-tgs8nz): never prompt for permission in headless runs.
      // The PreToolUse footprint hook (SP-tgs8nz_SL-6) is the silent guardrail.
      "--permission-mode",
      "bypassPermissions",
    ];
    const proc = (this.deps.spawnWorker ?? defaultSpawn)(args, cwd);
    const buf = new StreamJsonBuffer();
    let success = false;
    return new Promise<boolean>((resolve) => {
      proc.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        appendSession(unit.id, text);
        for (const evt of buf.push(text)) {
          const line = summarizeEvent(evt);
          if (line) this.deps.output.appendLine(`  [${unit.id}] ${line}`);
          if (isResultSuccess(evt)) success = true;
        }
      });
      proc.on("error", (err) => {
        this.deps.output.appendLine(`  ✗ ${unit.id} spawn error: ${err.message}`);
        resolve(false);
      });
      proc.on("close", () => resolve(success));
    });
  }

  private verify(cwd: string): Promise<boolean> {
    return (this.deps.verify ?? ((c) => this.defaultVerify(c)))(cwd);
  }

  /** Default slice-grain verify: `npm run compile` in the worktree; green = exit 0. */
  private defaultVerify(cwd: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn("npm", ["run", "compile"], { cwd });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
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

  private commit(specNumber: string, cwd: string): Promise<void> {
    return (this.deps.commit ?? ((n, c) => this.defaultCommit(n, c)))(
      specNumber,
      cwd,
    );
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
}

function defaultSpawn(args: string[], cwd: string): SpawnedWorker {
  return spawn("claude", args, { cwd }) as unknown as SpawnedWorker;
}
