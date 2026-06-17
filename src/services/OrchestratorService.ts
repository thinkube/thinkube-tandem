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
  StreamJsonBuffer,
  summarizeEvent,
  isResultSuccess,
  type SliceRow,
} from "./orchestratorCore";

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
  success?: boolean;
  reason?: string;
}

export class OrchestratorService {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Dispatch the next Ready+deps-satisfied slice of `specNumber`, if any. */
  async dispatchNext(specNumber: string): Promise<DispatchResult> {
    const { store, arbiter, worktrees, output } = this.deps;

    // 1. Read the Spec's slices → rows + a handle→frontmatter index.
    const rows: SliceRow[] = [];
    const byHandle = new Map<string, { num: number; files: string[] }>();
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
      byHandle.set(handle, {
        num,
        files: Array.isArray(fm?.files) ? (fm!.files as string[]) : [],
      });
    }

    // 2. Pick (pure).
    const handle = pickNextSlice(rows);
    if (!handle) {
      output.appendLine(
        `▸ SP-${specNumber}: no Ready slice with satisfied deps.`,
      );
      return { dispatched: false, reason: "no dispatchable slice" };
    }
    const picked = byHandle.get(handle)!;

    // 3. Claim its declared files (atomic; skip on conflict).
    const claim = await arbiter.acquire(handle, picked.files);
    if (!claim.ok) {
      const who = claim.conflicts
        .map((c) => `${c.file} (held by ${c.heldBy})`)
        .join(", ");
      output.appendLine(`▸ ${handle}: ownership conflict — ${who}. Skipping.`);
      return { dispatched: false, handle, reason: "ownership conflict" };
    }

    try {
      // 4. Ensure the Spec's worktree (board-injected).
      const worktreePath = await worktrees.create(
        this.deps.canonicalRepo,
        specNumber,
        this.deps.baseDir,
        this.deps.boardRoot,
      );
      output.appendLine(`▸ dispatching ${handle} in ${worktreePath}`);

      // 5. Spawn the worker; stream its JSON-log events.
      const success = await this.runWorker(
        handle,
        specNumber,
        picked.num,
        worktreePath,
      );
      output.appendLine(
        success
          ? `✓ ${handle}: worker reported success`
          : `✗ ${handle}: worker did not succeed`,
      );
      return { dispatched: true, handle, success };
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
}

function defaultSpawn(args: string[], cwd: string): SpawnedWorker {
  return spawn("claude", args, { cwd }) as unknown as SpawnedWorker;
}
