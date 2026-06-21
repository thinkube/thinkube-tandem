/**
 * Unit tests for the orchestrator shell's makespan scheduler (SP-tgs8nz), exercised with fakes
 * (store / arbiter / worktrees / runUnit / commit) — no live Agent SDK, no vscode. Verifies the
 * scheduler logic (validate DAG → saturate the frontier → per-slice verify-join → commit-once);
 * the live worker actually doing useful work stays a human verdict (SP-tgsdvw lever).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
  type WorkerResult,
} from "./OrchestratorService";
import { answerParkedWorker } from "./orchestratorSessions";

type RunUnit = NonNullable<OrchestratorDeps["runUnit"]>;

/** A runUnit that resolves to a fixed outcome (the default seam: success). */
const runOutcome =
  (
    outcome: WorkerResult["outcome"],
    extra: Partial<WorkerResult> = {},
  ): RunUnit =>
  async () => ({ outcome, ...extra });

/** A runUnit that defers to a microtask, tracking peak concurrency (for the cap test). */
const runTracked =
  (track: { inFlight: number; max: number }): RunUnit =>
  async () => {
    track.inFlight++;
    track.max = Math.max(track.max, track.inFlight);
    await new Promise((r) => setImmediate(r));
    track.inFlight--;
    return { outcome: "success" as const };
  };

interface FakeFile {
  status?: string;
  depends_on?: string[];
  files?: string[];
  work_units?: { footprint: string[]; execution: string; note?: string }[];
}
type FakeFiles = Record<string, FakeFile>;

function makeDeps(
  files: FakeFiles,
  opts: {
    acquireOk?: boolean;
    run?: RunUnit;
    verifyOk?: boolean;
  } = {},
): {
  deps: OrchestratorDeps;
  calls: {
    acquired: string[];
    released: string[];
    advanced: string[];
    attention: string[];
    needsInput: string[];
    torndown: string[];
    created: number;
    committed: number;
    log: string[];
  };
} {
  const calls = {
    acquired: [] as string[],
    released: [] as string[],
    advanced: [] as string[],
    attention: [] as string[],
    needsInput: [] as string[],
    torndown: [] as string[],
    created: 0,
    committed: 0,
    log: [] as string[],
  };
  const deps: OrchestratorDeps = {
    store: {
      listSlices: async () => Object.keys(files),
      getFile: async (rel: string) => ({
        frontmatter: files[rel],
        body: "",
        raw: "",
      }),
      sliceHandle: (spec: string, n: number) => `SP-${spec}_SL-${n}`,
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async (id: string) => {
        calls.acquired.push(id);
        return opts.acquireOk === false
          ? { ok: false as const, conflicts: [{ file: "x", heldBy: "SP-9_SL-9" }] }
          : { ok: true as const, state: {}, acquired: [] };
      },
      release: async (id: string) => {
        calls.released.push(id);
      },
    } as unknown as OrchestratorDeps["arbiter"],
    worktrees: {
      create: async () => {
        calls.created++;
        return "/tmp/wt/SP-1";
      },
    } as unknown as OrchestratorDeps["worktrees"],
    output: {
      appendLine: (l: string) => calls.log.push(l),
    } as unknown as OrchestratorDeps["output"],
    canonicalRepo: "/repo",
    runUnit: opts.run ?? runOutcome("success"),
    verify: async () => opts.verifyOk !== false,
    advance: async (h: string) => {
      calls.advanced.push(h);
    },
    flagAttention: async (h: string) => {
      calls.attention.push(h);
    },
    flagNeedsInput: async (h: string) => {
      calls.needsInput.push(h);
    },
    commit: async () => {
      calls.committed++;
    },
    teardown: async (n: string) => {
      calls.torndown.push(n);
    },
  };
  return { deps, calls };
}

test("dispatchSpec: a legacy (unit-less) ready slice runs, verifies, advances, commits", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "done" },
    "specs/SP-1/SL-2.md": {
      status: "ready",
      depends_on: ["SP-1_SL-1"],
      files: ["src/a.ts"],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.ok, true);
  assert.equal(r.dispatched, 1);
  assert.deepEqual(r.advanced, ["SP-1_SL-2"]);
  assert.equal(r.committed, true);
  assert.deepEqual(calls.advanced, ["SP-1_SL-2"]);
  assert.equal(calls.committed, 1);
  assert.deepEqual(calls.released, ["SP-1_SL-2"]);
});

test("dispatchSpec: a slice's fan-out units dispatch as SEPARATE workers; slice advances after all land", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["src/a.ts"], execution: "fan-out", note: "do a" },
        { footprint: ["src/b.ts"], execution: "fan-out", note: "do b" },
      ],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 2, "two fan-out units → two workers");
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]); // slice advances once after BOTH units
  assert.equal(r.committed, true);
  // one acquire/release per unit (work-unit grain)
  assert.equal(calls.acquired.length, 2);
});

test("dispatchSpec: serial units of a slice collapse into ONE worker", async () => {
  const { deps } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["src/a.ts"], execution: "serial" },
        { footprint: ["src/b.ts"], execution: "serial" },
      ],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 1, "two serial units batch into one execution unit");
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]);
});

test("dispatchSpec: units pool ACROSS slices — both slices' units co-schedule, then both Done", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
    "specs/SP-1/SL-2.md": { status: "ready", files: ["src/b.ts"] },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 2);
  assert.deepEqual(r.advanced.sort(), ["SP-1_SL-1", "SP-1_SL-2"]);
  assert.equal(r.committed, true);
  assert.equal(calls.created, 1, "one worktree for the whole Spec");
});

test("dispatchSpec: a dependent slice waits until its dep is Done", async () => {
  const order: string[] = [];
  const { deps } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
    "specs/SP-1/SL-2.md": {
      status: "ready",
      depends_on: ["SP-1_SL-1"],
      files: ["src/b.ts"],
    },
  });
  // capture advance order
  const realAdvance = deps.advance!;
  deps.advance = async (h: string) => {
    order.push(h);
    await realAdvance(h);
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.committed, true);
  assert.deepEqual(order, ["SP-1_SL-1", "SP-1_SL-2"], "dep advances first");
});

test("dispatchSpec: a worker failure flags its slice requires-attention; nothing committed", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { run: runOutcome("failed") },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(r.results.map((x) => x.outcome), ["failed"]);
  assert.deepEqual(r.attention, ["SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
  assert.equal(calls.committed, 0);
});

test("dispatchSpec: worker success but verify red → requires-attention, not committed", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { verifyOk: false },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(r.attention, ["SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
});

test("dispatchSpec: a malformed DAG (cycle) is rejected — nothing dispatched", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      depends_on: ["SP-1_SL-2"],
      files: ["a.ts"],
    },
    "specs/SP-1/SL-2.md": {
      status: "ready",
      depends_on: ["SP-1_SL-1"],
      files: ["b.ts"],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /cycle/i);
  assert.equal(r.dispatched, 0);
  assert.equal(calls.created, 0, "no worktree for a malformed DAG");
});

test("dispatchSpec: nothing ready → no worktree, no commit", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "doing" },
    "specs/SP-1/SL-2.md": { status: "ready", depends_on: ["SP-1_SL-1"] },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 0);
  assert.equal(r.committed, false);
  assert.equal(calls.created, 0);
});

test("dispatchSpec: a requires-attention slice is re-dispatchable (retry on a new run)", async () => {
  // After a failed/verify-red run a slice sits in requires-attention; clicking ▶ again must
  // retry it (the human's re-run), not leave it stranded as a dead end.
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": { status: "requires-attention", files: ["src/a.ts"] },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 1, "the requires-attention slice re-dispatches");
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]);
  assert.equal(r.committed, true);
  assert.equal(calls.committed, 1);
});

test("dispatchSpec: the worker pool never exceeds the cap", async () => {
  const track = { inFlight: 0, max: 0 };
  const { deps } = makeDeps(
    {
      "specs/SP-1/SL-1.md": {
        status: "ready",
        work_units: [
          { footprint: ["a.ts"], execution: "fan-out" },
          { footprint: ["b.ts"], execution: "fan-out" },
          { footprint: ["c.ts"], execution: "fan-out" },
          { footprint: ["d.ts"], execution: "fan-out" },
          { footprint: ["e.ts"], execution: "fan-out" },
        ],
      },
    },
    { run: runTracked(track) },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 2);
  assert.equal(r.dispatched, 5, "all five units run");
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]);
  assert.ok(track.max <= 2, `peak concurrency ${track.max} should be ≤ cap 2`);
});

test("dispatchSpec: a worker that RETURNS needs-input parks the slice (not failed, not committed)", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    {
      run: runOutcome("needs-input", {
        question: "Which database — pg or sqlite?",
      }),
    },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["needs-input"],
  );
  assert.deepEqual(r.needsInput, ["SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
  assert.deepEqual(calls.attention, []); // needs-input is NOT a failure
  assert.deepEqual(calls.needsInput, ["SP-1_SL-1"]);
  // the question is carried on the result
  assert.match(r.results[0].slice, /SP-1_SL-1/);
});

// (Removed: "success wins over a stray sentinel mention" tested the spawn-path `classify`
// helper, now deleted. The success-over-sentinel precedence lives in `runViaSdk`'s control
// flow — a live-SDK behaviour verified by the smoke test / human verdict, not this seam.)

test("dispatchSpec: a resident worker PARKS (frees its slot), then an external answer resumes it to Done + commit", async () => {
  // SL-1 has two fan-out units: #eu-0 asks a question (parks resident), #eu-1 runs normally.
  // The parked unit must free its slot so #eu-1 proceeds; once answered (simulating /attend),
  // it resumes to success → the slice verifies + advances → the Spec commits.
  const parkedId = "SP-1_SL-1#eu-0";
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["a.ts"], execution: "fan-out", note: "asks" },
        { footprint: ["b.ts"], execution: "fan-out", note: "runs" },
      ],
    },
  });
  deps.runUnit = async (unit, _spec, _cwd, onPark) => {
    if (unit.id === parkedId) {
      // Park resident: resolve only when the registered answer fn is invoked.
      return await new Promise((resolve) => {
        onPark(unit, "which database?", () => resolve({ outcome: "success" }));
      });
    }
    // The other unit completes immediately, then delivers the human's answer to the parked one.
    setImmediate(() => answerParkedWorker(parkedId, "use postgres"));
    return { outcome: "success" };
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 2);
  assert.ok(r.needsInput.includes("SP-1_SL-1"), "parked at least once");
  assert.deepEqual(r.advanced, ["SP-1_SL-1"], "resumed + verified after the answer");
  assert.equal(r.committed, true);
  assert.deepEqual(calls.needsInput, ["SP-1_SL-1"]); // flagged needs-input on park
});
