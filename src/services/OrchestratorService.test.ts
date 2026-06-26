/**
 * Unit tests for the orchestrator shell's makespan scheduler + the closing AI-verification gate
 * (SP-tgs8nz / SP-tgzyfy), exercised with fakes (store / arbiter / worktrees / runUnit /
 * runAcVerifications / checkAcs / commit) — no live Agent SDK, no live cluster, no vscode.
 * Verifies the scheduler logic (validate DAG → saturate the frontier → land units) AND the
 * closing gate (run the declared per-AC verifications → gate Done/commit on all-green → check
 * the satisfied AC ordinals → commit once). The live worker + the live cluster verification stay
 * a human verdict (SP-tgsdvw lever); here the per-AC outcomes are injected through the seam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
  satisfies?: number[];
  work_units?: { footprint: string[]; execution: string; note?: string }[];
}
type FakeFiles = Record<string, FakeFile>;

const SPEC_DOC = "specs/SP-1/spec.md";

function makeDeps(
  files: FakeFiles,
  opts: {
    acquireOk?: boolean;
    run?: RunUnit;
    /** The Spec's `ac_verifications` declaration. `null` → none (the no-skip case);
     *  `undefined` → a default plan covering every satisfied AC (or #1 when none). */
    verifs?: Record<string, { run: string; env?: "cluster" | "local" }> | null;
    /** Per-AC pass override for the injected runner (default: every declared AC passes). */
    acPass?: Record<number, boolean>;
  } = {},
): {
  deps: OrchestratorDeps;
  calls: {
    acquired: string[];
    released: string[];
    advanced: string[];
    attention: string[];
    needsInput: string[];
    checked: number[];
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
    checked: [] as number[],
    torndown: [] as string[],
    created: 0,
    committed: 0,
    log: [] as string[],
  };

  // Default declaration: cover every AC any slice satisfies, else a single generic AC #1.
  const allSatisfies = [
    ...new Set(Object.values(files).flatMap((f) => f.satisfies ?? [])),
  ].sort((a, b) => a - b);
  const defaultVerifs: Record<string, { run: string }> = {};
  for (const n of allSatisfies.length ? allSatisfies : [1])
    defaultVerifs[String(n)] = { run: `verify-AC-${n}` };
  const specVerifs = opts.verifs === undefined ? defaultVerifs : opts.verifs;

  // A real (throwaway) board dir so the closing run's `writeDeliverySummary` can land
  // `specs/SP-1/DELIVERY.md` — the finalization watchdog (SP-th4wqc_SL-2) treats a missing
  // report as a wedge, so the integration fake must let the report write.
  const boardDir = fs.mkdtempSync(path.join(os.tmpdir(), "tk-orch-test-"));
  fs.mkdirSync(path.join(boardDir, path.dirname(SPEC_DOC)), {
    recursive: true,
  });

  const deps: OrchestratorDeps = {
    store: {
      thinkubeDir: boardDir,
      listSlices: async () =>
        Object.keys(files).filter((k) => /\/SL-\d+\.md$/.test(k)),
      getFile: async (rel: string) =>
        rel === SPEC_DOC
          ? {
              frontmatter:
                specVerifs === null ? {} : { ac_verifications: specVerifs },
              body: "",
              raw: "",
            }
          : { frontmatter: files[rel], body: "", raw: "" },
      sliceHandle: (spec: string, n: number) => `SP-${spec}_SL-${n}`,
      pathForSpecDoc: () => SPEC_DOC,
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async (id: string) => {
        calls.acquired.push(id);
        return opts.acquireOk === false
          ? {
              ok: false as const,
              conflicts: [{ file: "x", heldBy: "SP-9_SL-9" }],
            }
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
    // The closing gate's injectable seam: map each declared verification to a pass/fail outcome
    // (default all-pass), so the gate is exercised end-to-end without a live cluster.
    runAcVerifications: async (verifs) =>
      verifs.map((v) => {
        const pass = opts.acPass ? opts.acPass[v.ac] !== false : true;
        return {
          ac: v.ac,
          pass,
          evidence: `$ ${v.run} → exit ${pass ? 0 : 1}`,
        };
      }),
    checkAcs: async (_spec: string, ordinals: number[]) => {
      calls.checked.push(...ordinals);
    },
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
    // The worktree HEAD's short SHA — injected so the finalization watchdog sees a real commit
    // marker without a live git repo (SP-th4wqc_SL-2). A non-empty SHA + the written DELIVERY.md
    // make `finalizationVerdict` return "finalized", so a clean run isn't flagged a false wedge.
    gitShortSha: async () => "deadbee",
  };
  return { deps, calls };
}

test("dispatchSpec: a legacy (unit-less) ready slice runs, lands, the gate advances + commits", async () => {
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
  // the closing gate ran the declared plan
  assert.ok(r.acResults.length >= 1 && r.acResults.every((x) => x.pass));
});

test("dispatchSpec: a slice's fan-out units dispatch as SEPARATE workers; gate advances after all land", async () => {
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
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]); // slice advances once after BOTH units + the gate
  assert.equal(r.committed, true);
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
  assert.equal(
    r.dispatched,
    1,
    "two serial units batch into one execution unit",
  );
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]);
});

test("dispatchSpec: units pool ACROSS slices — both slices' units co-schedule, then the gate advances both", async () => {
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
  const realAdvance = deps.advance!;
  deps.advance = async (h: string) => {
    order.push(h);
    await realAdvance(h);
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.committed, true);
  assert.deepEqual(order, ["SP-1_SL-1", "SP-1_SL-2"], "dep advances first");
});

test("dispatchSpec: a worker failure flags its slice requires-attention; the gate never runs; nothing committed", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { run: runOutcome("failed") },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["failed"],
  );
  assert.deepEqual(r.attention, ["SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
  assert.equal(calls.committed, 0);
  assert.deepEqual(r.acResults, [], "the gate did not run — no units landed");
});

// ── The closing AI-verification gate (SP-tgzyfy / TEP-tgzx3p) ──────────────

test("dispatchSpec: NO SKIP — units land but no ac_verifications declared → requires-attention, nothing committed", async () => {
  const { deps, calls } = makeDeps(
    { "specs/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { verifs: null }, // the Spec declares no verifications
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["success"],
  );
  assert.deepEqual(r.advanced, [], "no advance on an un-runnable gate");
  assert.deepEqual(
    r.attention,
    ["SP-1_SL-1"],
    "left requires-attention (no skip)",
  );
  assert.equal(r.committed, false);
  assert.equal(calls.committed, 0);
  assert.deepEqual(calls.checked, [], "no ACs checked when the gate can't run");
});

test("dispatchSpec: ACs gate Done — green AC → slice Done + its ordinals checked; red AC → requires-attention, unchecked", async () => {
  const { deps, calls } = makeDeps(
    {
      "specs/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
      "specs/SP-1/SL-2.md": {
        status: "ready",
        files: ["src/b.ts"],
        satisfies: [2],
      },
    },
    { acPass: { 1: true, 2: false } }, // AC#1 green, AC#2 red
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(
    r.advanced,
    ["SP-1_SL-1"],
    "only the green-AC slice advances",
  );
  assert.deepEqual(
    r.attention,
    ["SP-1_SL-2"],
    "the red-AC slice → requires-attention",
  );
  assert.deepEqual(
    calls.checked,
    [1],
    "exactly the green slice's AC is checked on the Spec",
  );
  assert.equal(r.committed, false, "a red AC blocks the whole-Spec commit");
  // the per-AC results are auditable on the result
  assert.deepEqual(
    r.acResults
      .map((x) => [x.ac, x.pass] as [number, boolean])
      .sort((a, b) => a[0] - b[0]),
    [
      [1, true],
      [2, false],
    ],
  );
});

test("dispatchSpec: all-green per-AC plan → satisfied ordinals checked, all slices Done, committed once", async () => {
  const { deps, calls } = makeDeps({
    "specs/SP-1/SL-1.md": {
      status: "ready",
      files: ["src/a.ts"],
      satisfies: [1, 2],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.deepEqual(r.advanced, ["SP-1_SL-1"]);
  assert.deepEqual(
    calls.checked.sort((a, b) => a - b),
    [1, 2],
  );
  assert.equal(r.committed, true);
  assert.equal(calls.committed, 1);
  assert.deepEqual(
    calls.torndown,
    ["1"],
    "a committed Spec tears down its worktree",
  );
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

test("dispatchSpec: a worker that RETURNS needs-input parks the slice (not failed, not committed, gate skipped)", async () => {
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
  assert.match(r.results[0].slice, /SP-1_SL-1/);
});

test("dispatchSpec: a resident worker PARKS (frees its slot), then an external answer resumes it → gate → Done + commit", async () => {
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
      return await new Promise((resolve) => {
        onPark(unit, "which database?", () => resolve({ outcome: "success" }));
      });
    }
    setImmediate(() => answerParkedWorker(parkedId, "use postgres"));
    return { outcome: "success" };
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1", 4);
  assert.equal(r.dispatched, 2);
  assert.ok(r.needsInput.includes("SP-1_SL-1"), "parked at least once");
  assert.deepEqual(
    r.advanced,
    ["SP-1_SL-1"],
    "resumed + verified by the gate after the answer",
  );
  assert.equal(r.committed, true);
  assert.deepEqual(calls.needsInput, ["SP-1_SL-1"]); // flagged needs-input on park
});
