/**
 * Board orchestrator (SP-tgs8nz_SL-1) — the integration shell around `orchestratorCore`.
 * On demand it dispatches **one** Ready slice end-to-end: pick (deps satisfied) → claim its
 * files → ensure the Spec's worktree → spawn a headless `claude -p` worker in that worktree,
 * streaming its `--output-format stream-json` events to an OutputChannel → release on exit.
 *
 * The pure pick/parse logic lives in `orchestratorCore` (unit-tested). This shell is the
 * low-AI-testability part (live spawn + worktree): its end-to-end behaviour is a human
 * verdict (SP-tgsdvw lever), not something these types can self-certify. Concurrency/queue
 * (SL-2), failure→requires-attention (SL-3), and the graph/float-out (SL-4) build on this.
 */
import { spawn } from "child_process";
import type * as vscode from "vscode";
import type { WorktreeService } from "./WorktreeService";
import type { OwnershipArbiter } from "./OwnershipArbiter";
import type { ThinkubeStore } from "../store/ThinkubeStore";
import {
  pickNextSlice,
  pickFrontier,
  selectDisjoint,
  runWithConcurrency,
  batchExecutionUnits,
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  type SliceRow,
  type WorkUnit,
} from "./orchestratorCore";

/** Per-slice dispatch metadata derived from frontmatter. */
interface SliceMeta {
  num: number;
  /** Disjointness footprint = declared files ∪ work-unit footprints. */
  files: string[];
  /** Raw work units (SP-tgs8gb) for economy batching (AC6). */
  workUnits: WorkUnit[];
}

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
}

/** Minimal shape of a spawned worker process the shell consumes. */
export interface SpawnedWorker {
  stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): void };
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
}

export interface DispatchResult {
  dispatched: boolean;
  handle?: string;
  /** The worker (`claude -p`) reported a success result. */
  success?: boolean;
  /** The slice-grain verify ran green (only when success). */
  verified?: boolean;
  /** The slice was advanced to Done (only when verified green). */
  advanced?: boolean;
  reason?: string;
}

export class OrchestratorService {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Read the Spec's slices → rows + a handle→{num, footprint} index. */
  private async buildRows(specNumber: string): Promise<{
    rows: SliceRow[];
    byHandle: Map<string, SliceMeta>;
  }> {
    const { store } = this.deps;
    const rows: SliceRow[] = [];
    const byHandle = new Map<string, SliceMeta>();
    for (const rel of await store.listSlices(specNumber)) {
      const m = SLICE_REL_RE.exec(rel);
      if (!m) continue;
      const num = Number(m[2]);
      const fm = (await store.getFile(rel))?.frontmatter;
      const handle = store.sliceHandle(specNumber, num);
      rows.push({
        handle,
        status: String(fm?.status ?? "ready"),
        dependsOn: Array.isArray(fm?.depends_on)
          ? (fm!.depends_on as string[])
          : [],
      });
      // Footprint for disjointness = declared files ∪ work-unit footprints (SP-tgs8gb).
      const files = Array.isArray(fm?.files) ? (fm!.files as string[]) : [];
      const workUnits = Array.isArray(fm?.work_units)
        ? (fm!.work_units as WorkUnit[])
        : [];
      const wuFootprints = workUnits.flatMap((w) => w.footprint ?? []);
      byHandle.set(handle, {
        num,
        files: [...files, ...wuFootprints],
        workUnits,
      });
    }
    return { rows, byHandle };
  }

  /** Dispatch the next Ready+deps-satisfied slice of `specNumber`, if any. */
  async dispatchNext(specNumber: string): Promise<DispatchResult> {
    const { rows, byHandle } = await this.buildRows(specNumber);
    const handle = pickNextSlice(rows);
    if (!handle) {
      this.deps.output.appendLine(
        `▸ SP-${specNumber}: no Ready slice with satisfied deps.`,
      );
      return { dispatched: false, reason: "no dispatchable slice" };
    }
    return this.dispatchSlice(handle, byHandle.get(handle)!, specNumber);
  }

  /**
   * Dispatch the **ready frontier** of `specNumber`: every Ready+deps-satisfied slice, narrowed
   * to a footprint-disjoint subset, run with at most `cap` concurrent `claude -p` workers (AC3);
   * a wider frontier queues and drains as slots free. Returns one result per dispatched slice.
   */
  async dispatchFrontier(
    specNumber: string,
    cap: number,
  ): Promise<DispatchResult[]> {
    const { rows, byHandle } = await this.buildRows(specNumber);
    const frontier = pickFrontier(rows);
    const disjoint = selectDisjoint(
      frontier.map((h) => ({ handle: h, footprint: byHandle.get(h)!.files })),
    );
    const deferred = frontier.length - disjoint.length;
    this.deps.output.appendLine(
      `▸ SP-${specNumber}: frontier ${frontier.length}, running ${disjoint.length} disjoint (cap ${cap})` +
        (deferred ? `, ${deferred} deferred for footprint overlap` : ""),
    );
    return runWithConcurrency(disjoint, cap, (handle) =>
      this.dispatchSlice(handle, byHandle.get(handle)!, specNumber),
    );
  }

  /** Claim → worktree → spawn → verify → advance → release, for one picked slice. */
  private async dispatchSlice(
    handle: string,
    picked: SliceMeta,
    specNumber: string,
  ): Promise<DispatchResult> {
    const { arbiter, worktrees, output } = this.deps;

    // Claim its footprint (atomic; skip on conflict).
    const claim = await arbiter.acquire(handle, picked.files);
    if (!claim.ok) {
      const who = claim.conflicts
        .map((c) => `${c.file} (held by ${c.heldBy})`)
        .join(", ");
      output.appendLine(`▸ ${handle}: ownership conflict — ${who}. Skipping.`);
      return { dispatched: false, handle, reason: "ownership conflict" };
    }

    try {
      // Ensure the Spec's worktree (board-injected).
      const worktreePath = await worktrees.create(
        this.deps.canonicalRepo,
        specNumber,
        this.deps.baseDir,
        this.deps.boardRoot,
      );
      output.appendLine(`▸ dispatching ${handle} in ${worktreePath}`);

      // Economy batching (AC6): the slice's work units share this one worker session —
      // one cold-start amortized across its execution units, never spanning slices.
      if (picked.workUnits.length) {
        const eu = batchExecutionUnits(picked.workUnits);
        output.appendLine(
          `  ${picked.workUnits.length} work unit(s) → ${eu.length} execution unit(s) [${eu
            .map((u) => u.shape)
            .join(", ")}] in one session`,
        );
      }

      // Spawn the worker; stream its JSON-log events.
      const success = await this.runWorker(
        handle,
        specNumber,
        picked.num,
        worktreePath,
      );
      if (!success) {
        output.appendLine(
          `✗ ${handle}: worker did not succeed — left in flight.`,
        );
        return { dispatched: true, handle, success: false };
      }
      output.appendLine(`✓ ${handle}: worker reported success — verifying…`);

      // Verify at slice grain in the worktree; advance only on green.
      const verify = this.deps.verify ?? ((cwd) => this.defaultVerify(cwd));
      const verified = await verify(worktreePath);
      if (!verified) {
        output.appendLine(
          `✗ ${handle}: verifier red — left in Doing (gate refusal).`,
        );
        return {
          dispatched: true,
          handle,
          success: true,
          verified: false,
          advanced: false,
        };
      }
      const advance = this.deps.advance ?? ((h) => this.defaultAdvance(h));
      await advance(handle);
      output.appendLine(`✓ ${handle}: verified green → advanced to Done.`);
      return {
        dispatched: true,
        handle,
        success: true,
        verified: true,
        advanced: true,
      };
    } finally {
      // Release the claim regardless — the slice's lifecycle (→ Done) is gated
      // elsewhere (the verifier + AC gate / SL-3 on failure), not forced here.
      await arbiter.release(handle);
    }
  }

  /** Spawn `claude -p` in the worktree and render its stream-json to the output channel. */
  private runWorker(
    handle: string,
    specNumber: string,
    sliceNumber: number,
    cwd: string,
  ): Promise<boolean> {
    const prompt =
      `Work the Tandem slice ${handle}: read specs/SP-${specNumber}/SL-${sliceNumber}.md ` +
      `and its parent spec, implement it end-to-end, verify, and report. Do not move the ` +
      `board card — the gate handles that.`;
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
    ];
    const proc = (this.deps.spawnWorker ?? defaultSpawn)(args, cwd);
    const buf = new StreamJsonBuffer();
    let success = false;
    return new Promise<boolean>((resolve) => {
      proc.stdout.on("data", (chunk) => {
        for (const evt of buf.push(chunk.toString())) {
          const line = summarizeEvent(evt);
          if (line) this.deps.output.appendLine(`  ${line}`);
          if (isResultSuccess(evt)) success = true;
        }
      });
      proc.on("error", (err) => {
        this.deps.output.appendLine(`  ✗ worker spawn error: ${err.message}`);
        resolve(false);
      });
      proc.on("close", () => resolve(success));
    });
  }

  /** Default slice-grain verify: `npm run compile` in the worktree; green = exit 0. */
  private defaultVerify(cwd: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const proc = spawn("npm", ["run", "compile"], { cwd });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }

  /**
   * Default advance: stamp the slice `status: done` in its file. Verifier-green is the
   * core of the → Done gate; the richer AC-satisfies / docs gate is `/pair-next`'s layer.
   */
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
}

function defaultSpawn(args: string[], cwd: string): SpawnedWorker {
  return spawn("claude", args, { cwd }) as unknown as SpawnedWorker;
}
