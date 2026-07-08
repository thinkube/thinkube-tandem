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
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  OrchestratorService,
  verificationExecutesWorkerAuthored,
  verificationIsWorkerAuthored,
  parseAssessment,
  buildAssessPrompt,
  createSdkAssessor,
  parseJudgment,
  buildJudgePrompt,
  createSdkJudge,
  acTextByOrdinal,
  type OrchestratorDeps,
  type OnPark,
  type WorkerResult,
} from "./OrchestratorService";
import { normalizeFilePath } from "../methodology/parallelSlices";
import {
  buildWorkerPrompt,
  CONTRACT_DEFECT_MARKER,
  type AcVerification,
} from "./orchestratorCore";
import { answerParkedWorker } from "./orchestratorSessions";
import type { SchedUnit } from "./orchestratorCore";
import {
  resolveFootprint,
  type ContainmentResult,
} from "../methodology/parallelSlices";

type RunUnit = NonNullable<OrchestratorDeps["runUnit"]>;

/** Reach the orchestrator's private `runViaSdk` (the AC3 path under test) with the
 *  real machinery intact — only the `sdkQuery` dep is faked. A focused cast, not a
 *  reimplementation: the body (PostToolUse hook → containmentCheck → revertPaths →
 *  abort → precedence) is the real production code. */
function svcRunViaSdk(
  deps: OrchestratorDeps,
): (
  unit: SchedUnit,
  specNumber: string,
  cwd: string,
  onPark: OnPark,
  unionFootprint?: string[],
  baseline?: string[],
) => Promise<WorkerResult> {
  const svc = new OrchestratorService(deps) as unknown as {
    runViaSdk: (
      unit: SchedUnit,
      specNumber: string,
      cwd: string,
      onPark: OnPark,
      unionFootprint?: string[],
      baseline?: string[],
    ) => Promise<WorkerResult>;
  };
  return (unit, specNumber, cwd, onPark, unionFootprint, baseline) =>
    svc.runViaSdk(unit, specNumber, cwd, onPark, unionFootprint, baseline);
}

/** Reach the orchestrator's private `loadPromptContext` + the `promptCtx` it populates — the
 *  AC1 path under test (SP-6/6 "hold out the exam"). A focused cast onto the real instance, not a
 *  reimplementation: the body (fetch the spec doc + each slice, reduce each to its intent view via
 *  the core's `stripAcceptanceCriteria` / `stripSatisfies`) is the real production code. */
function svcLoadPromptContext(deps: OrchestratorDeps): {
  load: (specNumber: string) => Promise<void>;
  ctx: () => { specBody: string; sliceBodies: Map<string, string> };
} {
  const svc = new OrchestratorService(deps) as unknown as {
    loadPromptContext: (specNumber: string) => Promise<void>;
    promptCtx: { specBody: string; sliceBodies: Map<string, string> };
  };
  return {
    load: (specNumber) => svc.loadPromptContext(specNumber),
    ctx: () => svc.promptCtx,
  };
}

/** A store fake whose spec doc + slices carry REAL markdown bodies, so `loadPromptContext` is
 *  exercised against actual content (the makeDeps store always returns an empty body). The spec
 *  doc resolves at `SPEC_DOC`; each `slices` entry maps a `teps/.../SL-<n>.md` rel path to a body.
 *  Everything else routes to the makeDeps defaults. */
function makeBodyDeps(
  specBody: string,
  slices: Array<{ n: number; body: string }>,
): OrchestratorDeps {
  const deps = makeDeps({}).deps;
  const sliceRel = (n: number) => `teps/TEP-1/SP-1/SL-${n}.md`;
  const byRel = new Map(slices.map((s) => [sliceRel(s.n), s.body]));
  deps.store = {
    listSlices: async () => slices.map((s) => sliceRel(s.n)),
    getFile: async (rel: string) =>
      rel === SPEC_DOC
        ? { frontmatter: {}, body: specBody, raw: specBody }
        : { frontmatter: {}, body: byRel.get(rel) ?? "", raw: "" },
    sliceHandle: (spec: string, n: number) => {
      const [t, s] = spec.split("/");
      return `TEP-${t}_SP-${s}_SL-${n}`;
    },
    pathForSpecDoc: () => SPEC_DOC,
  } as unknown as OrchestratorDeps["store"];
  return deps;
}

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
  files?: string[];
  satisfies?: number[];
  /** The slice's design-time contract (SP-6/3) — threaded to the judge for triangulation (SP-6/9). */
  contract?: string;
  work_units?: {
    footprint: string[];
    execution: string;
    note?: string;
    /** Files a sibling unit produces that this one reads — the SOLE authored edge language
     *  (SP-5/1): `buildUnitDag` resolves it (global footprint map) into a real producer edge.
     *  The retired `depends_on` forms are no longer accepted. */
    consumes?: string[];
  }[];
}
type FakeFiles = Record<string, FakeFile>;

const SPEC_DOC = "teps/TEP-1/SP-1/spec.md";

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
    /** The judged code-vs-test fault a red closing gate attributes (SP-6/7 AC4). Injected so the
     *  default judge (a real SDK session) never fires in a test; defaults to `code` (re-dispatch). */
    fault?: "code" | "test" | "both" | "contract";
    /** Stamp the Spec doc's `superseded:` frontmatter (SP-6/14) so the orchestrate guard is exercisable. */
    superseded?: string;
  } = {},
): {
  deps: OrchestratorDeps;
  calls: {
    acquired: string[];
    released: string[];
    advanced: string[];
    attention: string[];
    /** The diagnosis string each requires-attention flag carried — so AC3 can assert the
     *  containment hard-stop surfaces the offending out-of-footprint path verbatim (not the
     *  generic "exited without success" message). Aligned 1:1 with `attention`. */
    attentionReasons: string[];
    needsInput: string[];
    checked: number[];
    torndown: string[];
    created: number;
    committed: number;
    log: string[];
    /** The failing units the judge was asked to attribute (SP-6/7 AC4). */
    judged: string[];
    /** The thinking space dir, so a test can read the persisted VERIFICATION-TRACE.json (AC5). */
    thinkubeDir: string;
  };
} {
  const calls = {
    acquired: [] as string[],
    released: [] as string[],
    advanced: [] as string[],
    attention: [] as string[],
    attentionReasons: [] as string[],
    needsInput: [] as string[],
    checked: [] as number[],
    torndown: [] as string[],
    created: 0,
    committed: 0,
    log: [] as string[],
    judged: [] as string[],
    thinkubeDir: "",
  };

  // Default declaration: cover every AC any slice satisfies, else a single generic AC #1.
  const allSatisfies = [
    ...new Set(Object.values(files).flatMap((f) => f.satisfies ?? [])),
  ].sort((a, b) => a - b);
  const defaultVerifs: Record<string, { run: string }> = {};
  for (const n of allSatisfies.length ? allSatisfies : [1])
    defaultVerifs[String(n)] = { run: `verify-AC-${n}` };
  const specVerifs = opts.verifs === undefined ? defaultVerifs : opts.verifs;

  // A real (throwaway) thinking space dir so the closing run's `writeDeliverySummary` can land
  // `teps/TEP-1/SP-1/DELIVERY.md` — the finalization watchdog (SP-th4wqc_SL-2) treats a missing
  // report as a wedge, so the integration fake must let the report write.
  const thinkingSpaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tk-orch-test-"),
  );
  fs.mkdirSync(path.join(thinkingSpaceDir, path.dirname(SPEC_DOC)), {
    recursive: true,
  });
  calls.thinkubeDir = thinkingSpaceDir;

  const deps: OrchestratorDeps = {
    store: {
      thinkubeDir: thinkingSpaceDir,
      listSlices: async () =>
        Object.keys(files).filter((k) => /\/SL-\d+\.md$/.test(k)),
      getFile: async (rel: string) =>
        rel === SPEC_DOC
          ? {
              frontmatter: {
                ...(specVerifs === null
                  ? {}
                  : { ac_verifications: specVerifs }),
                ...(opts.superseded ? { superseded: opts.superseded } : {}),
              },
              body: "",
              raw: "",
            }
          : { frontmatter: files[rel], body: "", raw: "" },
      sliceHandle: (spec: string, n: number) => {
        const [t, s] = spec.split("/");
        return `TEP-${t}_SP-${s}_SL-${n}`;
      },
      pathForSpecDoc: () => SPEC_DOC,
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async (id: string) => {
        calls.acquired.push(id);
        return opts.acquireOk === false
          ? {
              ok: false as const,
              conflicts: [{ file: "x", heldBy: "TEP-9_SP-9_SL-9" }],
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
    // SP-6/7 AC4: the code-vs-test judge seam — injected so the real SDK judge never fires in a test.
    // Records the failing unit it was asked to attribute and returns the configured fault (default code).
    judgeFailure: async (unit) => {
      calls.judged.push(unit.id);
      return {
        fault: opts.fault ?? "code",
        rationale: `test judge: fault is ${opts.fault ?? "code"}`,
      };
    },
    checkAcs: async (_spec: string, ordinals: number[]) => {
      calls.checked.push(...ordinals);
    },
    advance: async (h: string) => {
      calls.advanced.push(h);
    },
    flagAttention: async (h: string, diagnosis: string) => {
      calls.attention.push(h);
      calls.attentionReasons.push(diagnosis);
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
    "teps/TEP-1/SP-1/SL-1.md": { status: "done" },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      files: ["src/a.ts"],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.ok, true);
  assert.equal(r.dispatched, 1);
  assert.deepEqual(r.advanced, ["TEP-1_SP-1_SL-2"]);
  assert.equal(r.committed, true);
  assert.deepEqual(calls.advanced, ["TEP-1_SP-1_SL-2"]);
  assert.equal(calls.committed, 1);
  assert.deepEqual(calls.released, ["TEP-1_SP-1_SL-2"]);
  // the closing gate ran the declared plan
  assert.ok(r.acResults.length >= 1 && r.acResults.every((x) => x.pass));
});

test("SP-6/14: a superseded Spec is NOT orchestrated — dispatchSpec refuses before any worker runs", async () => {
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        work_units: [
          { footprint: ["src/a.ts"], execution: "fan-out", note: "do a" },
        ],
      },
    },
    { superseded: "2026-07-04T00:00:00.000Z" },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.ok, false, "a superseded Spec cannot be orchestrated");
  assert.match(r.reason ?? "", /superseded/i);
  assert.equal(r.dispatched, 0, "no units dispatched");
  assert.equal(calls.created, 0, "no worktree created");
  assert.deepEqual(calls.acquired, [], "no unit acquired");
});

test("dispatchSpec: a slice's code fan-out units collapse into ONE coder; gate advances after it lands", async () => {
  // Tests-first (2026-07-08): the slice is the unit of code scheduling — its code units
  // become one worker with the union footprint and both task notes.
  const capture: { notes: (string | undefined)[]; footprints: string[][] } = {
    notes: [],
    footprints: [],
  };
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["src/a.ts"], execution: "fan-out", note: "do a" },
        { footprint: ["src/b.ts"], execution: "fan-out", note: "do b" },
      ],
    },
  });
  const inner = deps.runUnit!;
  deps.runUnit = async (unit, spec, cwd, onPark) => {
    capture.notes.push(unit.note);
    capture.footprints.push(unit.footprint.slice().sort());
    return inner(unit, spec, cwd, onPark);
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.dispatched, 1, "two code fan-out units → ONE coder");
  assert.deepEqual(capture.footprints, [["src/a.ts", "src/b.ts"]]);
  assert.equal(capture.notes[0], "do a; do b");
  assert.deepEqual(r.advanced, ["TEP-1_SP-1_SL-1"]);
  assert.equal(r.committed, true);
  assert.equal(calls.acquired.length, 1);
});

test("dispatchSpec: serial units of a slice collapse into ONE worker", async () => {
  const { deps } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["src/a.ts"], execution: "serial" },
        { footprint: ["src/b.ts"], execution: "serial" },
      ],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(
    r.dispatched,
    1,
    "two serial units batch into one execution unit",
  );
  assert.deepEqual(r.advanced, ["TEP-1_SP-1_SL-1"]);
});

test("dispatchSpec: units pool ACROSS slices — both slices' units co-schedule, then the gate advances both", async () => {
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
    "teps/TEP-1/SP-1/SL-2.md": { status: "ready", files: ["src/b.ts"] },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.dispatched, 2);
  assert.deepEqual(r.advanced.sort(), ["TEP-1_SP-1_SL-1", "TEP-1_SP-1_SL-2"]);
  assert.equal(r.committed, true);
  assert.equal(calls.created, 1, "one worktree for the whole Spec");
});

test("dispatchSpec: a dependent slice waits until its dep is Done", async () => {
  const order: string[] = [];
  const { deps } = makeDeps({
    // SL-1 produces src/a.ts; SL-2 CONSUMES it → a grounded producer edge SL-2#eu-0 → SL-1
    // (the retired `depends_on` re-expressed as `consumes`, SP-5/1).
    "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      work_units: [
        {
          footprint: ["src/b.ts"],
          execution: "serial",
          consumes: ["src/a.ts"],
        },
      ],
    },
  });
  const realAdvance = deps.advance!;
  deps.advance = async (h: string) => {
    order.push(h);
    await realAdvance(h);
  };
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.committed, true);
  assert.deepEqual(
    order,
    ["TEP-1_SP-1_SL-1", "TEP-1_SP-1_SL-2"],
    "dep advances first",
  );
});

test("dispatchSpec: a worker failure flags its slice requires-attention; the gate never runs; nothing committed", async () => {
  const { deps, calls } = makeDeps(
    { "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { run: runOutcome("failed") },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["failed"],
  );
  assert.deepEqual(r.attention, ["TEP-1_SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
  assert.equal(calls.committed, 0);
  assert.deepEqual(r.acResults, [], "the gate did not run — no units landed");
});

// ── The closing AI-verification gate (SP-tgzyfy / TEP-tgzx3p) ──────────────

test("dispatchSpec: NO SKIP — units land but no ac_verifications declared → requires-attention, nothing committed", async () => {
  const { deps, calls } = makeDeps(
    { "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    { verifs: null }, // the Spec declares no verifications
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["success"],
  );
  assert.deepEqual(r.advanced, [], "no advance on an un-runnable gate");
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "left requires-attention (no skip)",
  );
  assert.equal(r.committed, false);
  assert.equal(calls.committed, 0);
  assert.deepEqual(calls.checked, [], "no ACs checked when the gate can't run");
});

test("dispatchSpec: ACs gate Done — green AC → slice Done + its ordinals checked; red AC → requires-attention, unchecked", async () => {
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
      "teps/TEP-1/SP-1/SL-2.md": {
        status: "ready",
        files: ["src/b.ts"],
        satisfies: [2],
      },
    },
    { acPass: { 1: true, 2: false } }, // AC#1 green, AC#2 red
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.deepEqual(
    r.advanced,
    ["TEP-1_SP-1_SL-1"],
    "only the green-AC slice advances",
  );
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-2"],
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
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      files: ["src/a.ts"],
      satisfies: [1, 2],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.deepEqual(r.advanced, ["TEP-1_SP-1_SL-1"]);
  assert.deepEqual(
    calls.checked.sort((a, b) => a - b),
    [1, 2],
  );
  assert.equal(r.committed, true);
  assert.equal(calls.committed, 1);
  assert.deepEqual(
    calls.torndown,
    ["1/1"],
    "a committed Spec tears down its worktree",
  );
});

test("SP-6/18: a red whole-suite regression backstop blocks a green-eligible slice (fail-closed)", async () => {
  // A green-eligible slice (its per-AC grade passes) must STILL not reach Done when the closing
  // gate's whole-suite regression backstop runs red — the collateral-break detection SP-6/18 adds
  // after the per-AC grade. The command resolves from the worktree `package.json`'s `scripts.test`
  // (→ `npm test`); the run itself is the injected `runRegression` seam, returning a non-zero exit.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "tk-orch-regr-"));
  fs.writeFileSync(
    path.join(wt, "package.json"),
    JSON.stringify({ scripts: { test: "node --test out-test/" } }),
  );
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      files: ["src/a.ts"],
      satisfies: [1],
    },
  });
  // Point the worktree at the real dir carrying the package.json (so the command resolves).
  deps.worktrees = {
    create: async () => {
      calls.created++;
      return wt;
    },
  } as unknown as OrchestratorDeps["worktrees"];
  // Inject a RED whole-suite run — the backstop must fail-closed and block the green-eligible slice.
  let regressionRuns = 0;
  let ranCommand = "";
  deps.runRegression = async (command: string) => {
    regressionRuns++;
    ranCommand = command;
    return {
      code: 1,
      output: "FAIL src/services/orchestratorCore.test.ts (a prior-spec red)",
    };
  };

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  assert.equal(regressionRuns, 1, "the whole-suite command ran once at close");
  assert.equal(
    ranCommand,
    "npm test",
    "resolved from the worktree package.json test script",
  );
  assert.deepEqual(r.advanced, [], "no slice advances over a red suite");
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "the green-eligible slice → requires-attention (fail-closed)",
  );
  assert.equal(r.committed, false, "nothing commits over a red tree");
  assert.equal(calls.committed, 0, "the green slice never reached its commit");
  assert.deepEqual(
    calls.checked,
    [],
    "no AC ordinal is ticked for a blocked slice",
  );
  assert.match(
    calls.attentionReasons.join("\n"),
    /regression/i,
    "the requires-attention diagnosis names the regression backstop",
  );

  fs.rmSync(wt, { recursive: true, force: true });
});

test("dispatchSpec: a malformed DAG (cycle) is rejected — nothing dispatched", async () => {
  const { deps, calls } = makeDeps({
    // The cycle is now expressed through `consumes`: each unit reads the file the other
    // produces, so the resolved producer edges form SL-1#eu-0 ↔ SL-2#eu-0 (SP-5/1).
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      work_units: [
        { footprint: ["a.ts"], execution: "serial", consumes: ["b.ts"] },
      ],
    },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      work_units: [
        { footprint: ["b.ts"], execution: "serial", consumes: ["a.ts"] },
      ],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /cycle/i);
  assert.equal(r.dispatched, 0);
  assert.equal(calls.created, 0, "no worktree for a malformed DAG");
});

test("dispatchSpec: nothing ready → no worktree, no commit", async () => {
  const { deps, calls } = makeDeps({
    // SL-1 is in-flight (`doing`) and produces src/a.ts; SL-2 CONSUMES it, so SL-2#eu-0's
    // producer edge lands on the not-yet-done SL-1 and SL-2 stays un-dispatchable (SP-5/1).
    "teps/TEP-1/SP-1/SL-1.md": { status: "doing", files: ["src/a.ts"] },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      work_units: [
        {
          footprint: ["src/b.ts"],
          execution: "serial",
          consumes: ["src/a.ts"],
        },
      ],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.dispatched, 0);
  assert.equal(r.committed, false);
  assert.equal(calls.created, 0);
});

test("dispatchSpec: a requires-attention slice is re-dispatchable (retry on a new run)", async () => {
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "requires-attention",
      files: ["src/a.ts"],
    },
  });
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.dispatched, 1, "the requires-attention slice re-dispatches");
  assert.deepEqual(r.advanced, ["TEP-1_SP-1_SL-1"]);
  assert.equal(r.committed, true);
  assert.equal(calls.committed, 1);
});

test("dispatchSpec: the worker pool never exceeds the cap", async () => {
  // Parallelism is inter-slice now: five file-disjoint slices → five coders over cap 2.
  const track = { inFlight: 0, max: 0 };
  const { deps } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["a.ts"] },
      "teps/TEP-1/SP-1/SL-2.md": { status: "ready", files: ["b.ts"] },
      "teps/TEP-1/SP-1/SL-3.md": { status: "ready", files: ["c.ts"] },
      "teps/TEP-1/SP-1/SL-4.md": { status: "ready", files: ["d.ts"] },
      "teps/TEP-1/SP-1/SL-5.md": { status: "ready", files: ["e.ts"] },
    },
    { run: runTracked(track) },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 2);
  assert.equal(r.dispatched, 5, "all five slices run");
  assert.equal(r.advanced.length, 5);
  assert.ok(track.max <= 2, `peak concurrency ${track.max} should be ≤ cap 2`);
});

test("dispatchSpec: a worker that RETURNS needs-input parks the slice (not failed, not committed, gate skipped)", async () => {
  const { deps, calls } = makeDeps(
    { "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] } },
    {
      run: runOutcome("needs-input", {
        question: "Which database — pg or sqlite?",
      }),
    },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["needs-input"],
  );
  assert.deepEqual(r.needsInput, ["TEP-1_SP-1_SL-1"]);
  assert.equal(r.committed, false);
  assert.deepEqual(calls.advanced, []);
  assert.deepEqual(calls.attention, []); // needs-input is NOT a failure
  assert.deepEqual(calls.needsInput, ["TEP-1_SP-1_SL-1"]);
  assert.match(r.results[0].slice, /TEP-1_SP-1_SL-1/);
});

test("dispatchSpec: a resident worker PARKS (frees its slot), then an external answer resumes it → gate → Done + commit", async () => {
  // The parked coder and the answering coder live in two file-disjoint SLICES (a slice's
  // code side is one worker now, so concurrency — and the freed slot — is inter-slice).
  const parkedId = "TEP-1_SP-1_SL-1#eu-0";
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      work_units: [{ footprint: ["a.ts"], execution: "fan-out", note: "asks" }],
    },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      work_units: [{ footprint: ["b.ts"], execution: "fan-out", note: "runs" }],
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
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.dispatched, 2);
  assert.ok(r.needsInput.includes("TEP-1_SP-1_SL-1"), "parked at least once");
  assert.deepEqual(
    r.advanced.slice().sort(),
    ["TEP-1_SP-1_SL-1", "TEP-1_SP-1_SL-2"],
    "resumed + verified by the gate after the answer",
  );
  assert.equal(r.committed, true);
  assert.deepEqual(calls.needsInput, ["TEP-1_SP-1_SL-1"]); // flagged needs-input on park
});

// ── loadPromptContext supplies the INTENT view, not the raw AC block (SP-6/6 AC1) ──
//
// AC1 (SP-6 AC1 + the SP-6/7 role branch): the implementer must not read the exam — but the
// held-out TEST-author MUST. So `loadPromptContext` now stores the RAW spec/slice bodies (ACs
// included) and the exam-hold-out decision moved to the single per-unit authority,
// `buildWorkerPrompt`, which strips for a `code` unit and KEEPS them for a `test` unit (SP-6/7 AC1).
// Pre-stripping at the source would blind a test unit to the criteria it must grade, so these tests
// assert `loadPromptContext` keeps the raw body, and the role-aware strip is covered by
// `buildWorkerPrompt`'s own tests (orchestratorCore.test.ts). The slice still keeps `satisfies`
// orchestrator-internally (frontmatter, read in `buildSlices`).

const AC1_SPEC_BODY = [
  "## Summary",
  "",
  "Build the dedupe gateway that drops repeated events before the sink.",
  "",
  "## Design",
  "",
  "The gateway hashes each event and consults a bounded LRU before forwarding.",
  "",
  "## Acceptance Criteria",
  "",
  "- [ ] **The gateway drops exact duplicates.** A repeated event id must emit EXACTLY ONCE.",
  "- [ ] **The LRU evicts oldest-first.** After 1024 entries the coldest key is purged.",
  "",
  "satisfies: [1, 2]",
  "",
  "## Constraints",
  "",
  "Stay deterministic — no clock, no randomness.",
].join("\n");

test("loadPromptContext: stores the RAW spec body (ACs kept) so buildWorkerPrompt can hold the exam per role (SP-6/7)", async () => {
  const h = svcLoadPromptContext(makeBodyDeps(AC1_SPEC_BODY, []));
  await h.load("1/1");
  const { specBody } = h.ctx();

  // Intent survives — the worker must build correctly from this.
  assert.match(specBody, /## Summary/);
  assert.match(specBody, /dedupe gateway/);
  assert.match(specBody, /## Design/);
  assert.match(specBody, /bounded LRU/);
  assert.match(specBody, /## Constraints/);

  // SP-6/7: the RAW body is stored (ACs + satisfies present) — the role-aware exam-hold-out is
  // buildWorkerPrompt's job now (a code unit strips, a test unit keeps). Pre-stripping here would
  // blind the held-out test-author to the very criteria it must grade.
  assert.match(specBody, /## Acceptance Criteria/);
  assert.match(specBody, /drops exact duplicates/i);
  assert.match(specBody, /^\s*satisfies\s*:/im);

  // End-to-end: a CODE unit's prompt built from this raw body still holds out the exam.
  const codePrompt = buildWorkerPrompt(
    {
      id: "TEP-1_SP-1_SL-1#eu-0",
      slice: "TEP-1_SP-1_SL-1",
      footprint: ["src/a.ts"],
      requires: [],
      shape: "fan-out",
      role: "code",
    },
    "1/1",
    { specBody },
  );
  assert.doesNotMatch(codePrompt, /## Acceptance Criteria/);
  assert.doesNotMatch(codePrompt, /drops exact duplicates/i);
});

test("loadPromptContext: stores each slice's RAW body keyed by handle (buildWorkerPrompt applies the role strip)", async () => {
  const sliceBody = [
    "satisfies: [3]",
    "",
    "## Task",
    "",
    "Wire the LRU into the gateway's forward path.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] **Forwarding is single-pass.** Each event hits the LRU AT MOST ONCE.",
  ].join("\n");
  const h = svcLoadPromptContext(
    makeBodyDeps(AC1_SPEC_BODY, [{ n: 1, body: sliceBody }]),
  );
  await h.load("1/1");
  const { sliceBodies } = h.ctx();

  const raw = sliceBodies.get("TEP-1_SP-1_SL-1");
  assert.ok(
    raw !== undefined,
    "the slice's raw body is stored under its handle",
  );
  // Intent (the unit's task) survives…
  assert.match(raw!, /## Task/);
  assert.match(raw!, /forward path/);
  // …and the ACs are KEPT raw (a held-out test unit needs them; a code unit's buildWorkerPrompt strips).
  assert.match(raw!, /## Acceptance Criteria/);
  assert.match(raw!, /single-pass/i);
});

test("loadPromptContext: a store read error is best-effort — promptCtx falls back to empty, never leaks a raw body", async () => {
  const deps = makeBodyDeps(AC1_SPEC_BODY, []);
  (deps.store as unknown as { getFile: () => Promise<never> }).getFile =
    async () => {
      throw new Error("thinking space unreachable");
    };
  const h = svcLoadPromptContext(deps);
  await h.load("1/1");
  const { specBody, sliceBodies } = h.ctx();
  // No partial/raw spec body is exposed when the read fails — the worker just falls back to its
  // unit note, never to an un-stripped (exam-bearing) body.
  assert.equal(specBody, "");
  assert.equal(sliceBodies.size, 0);
});

// ── Post-tool footprint containment hard-stop (SP-6/2 AC3) ─────────────────
//
// AC3: "When an execution unit's run leaves any create/modify/delete in the
// working tree outside its declared footprint — whether via Edit/Write or via
// Bash — the orchestrator aborts the unit, restores the working tree, and marks
// the unit requires-attention naming the offending path; it does not surface the
// violation as a recoverable permission deny." These two tests cover the two
// halves of that wiring deterministically (no live Agent SDK, no live cluster):
//
//   • the orchestrator-level handling of a containment hard-stop — `runViaSdk`
//     aborts the `query()` and returns a TERMINAL `failed` carrying a diagnosis
//     that names the offending out-of-footprint path, so the slice is flagged
//     requires-attention naming it (never a recoverable deny), while a sibling
//     unit's landed in-tree work is untouched (not failed, not flagged); and
//   • the real-git post-tool containment itself (`containmentCheck` → porcelain
//     diff → `footprintContainment` → path-scoped `git restore`/`clean`): an
//     out-of-footprint Bash create (`cat >`) AND delete (`rm`) are detected and
//     reverted, while a declared in-flight (sibling) change in the shared tree
//     survives — the revert touches ONLY the offending paths, never the tree.

/** A hermetic, offline git repo with one commit seeding the given tracked files.
 *  Stands in for the shared spec worktree the post-tool diff runs against. */
function initGitRepo(seed: Record<string, string>): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tk-orch-ac3-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  for (const [rel, body] of Object.entries(seed)) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return repo;
}

/**
 * Drive the REAL {@link OrchestratorService.runViaSdk} with the Agent SDK boundary
 * faked through the `sdkQuery` dep — NOT the `runUnit` seam (which would bypass the
 * very machinery AC3 is about). The fake `query` performs the worker's tool calls as
 * REAL Bash (`execFileSync('sh', ['-c', …])` so the change carries no `file_path` for
 * the PreToolUse guard to pre-screen — the stub-and-`rm` hole), then fires the
 * orchestrator's PostToolUse hook exactly as the live SDK would after each tool call,
 * then (if the run was not aborted) emits a `result: success`. Everything inside
 * `runViaSdk` is real: the PostToolUse hook, the real git `containmentCheck`
 * (`git status --porcelain` → `footprintContainment`), the path-scoped `revertPaths`
 * (`git restore`/`clean`), the `AbortController` hard-stop, and the
 * success-precedence. `bash` runs the tool calls so Bash coverage is exercised end
 * to end. Returns the messages the fake yields + whether the abort signal tripped.
 */
function fakeSdkQueryRunningBashThen(
  repo: string,
  bashScripts: string[],
  observed: { aborted?: boolean },
): NonNullable<OrchestratorDeps["sdkQuery"]> {
  return ({ options }) => {
    const opts = options as {
      hooks: {
        PostToolUse?: Array<{
          hooks: Array<(i: unknown) => Promise<unknown>>;
        }>;
      };
      abortController: AbortController;
    };
    async function* gen(): AsyncGenerator<unknown> {
      // An assistant turn (a tool is about to run).
      yield { type: "assistant", session_id: "ac3-sdk" };
      // The worker's tool calls land as REAL Bash changes in the shared tree.
      for (const script of bashScripts)
        execFileSync("sh", ["-c", script], { cwd: repo, stdio: "pipe" });
      // The SDK fires PostToolUse after the tool call — drive every registered hook.
      for (const grp of opts.hooks.PostToolUse ?? [])
        for (const h of grp.hooks)
          await h({ tool_name: "Bash", tool_input: {} });
      // A faithful SDK stops the stream once the orchestrator aborts the query.
      observed.aborted = opts.abortController.signal.aborted;
      if (opts.abortController.signal.aborted) return;
      // If (wrongly) not aborted, a success races in — the breach must STILL win.
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "ac3-sdk",
      };
    }
    return gen();
  };
}

/** The unit under test: fenced to its own footprint, the sibling's file declared
 *  in-flight (so a sibling's shared-tree edit is in-bounds, not a violation). */
function ac3Unit(footprint: string[]): SchedUnit {
  return {
    id: "TEP-1_SP-1_SL-1#eu-0",
    slice: "TEP-1_SP-1_SL-1",
    footprint,
    requires: [],
    shape: "fan-out",
    note: "the breaching unit",
  };
}

test("runViaSdk: an out-of-footprint Bash create+delete after a tool call → abort + PATH-SCOPED revert + TERMINAL requires-attention naming the path; a sibling's in-tree work survives", async () => {
  // The shared worktree: this unit's owned file, a sibling's (declared in-flight),
  // and a tracked file an out-of-footprint Bash `rm` will illegally delete.
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "src/sibling.ts": "// sibling original\n",
    "src/gone.ts": "// only its owner may delete this\n",
  });

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  // Drive the REAL runViaSdk: the fake query runs Bash (create out-of-footprint,
  // delete out-of-footprint, edit sibling in-flight) then fires the PostToolUse hook.
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    [
      "cat > src/evil.ts <<'E'\n// injected out-of-footprint\nE", // CREATE (untracked, ??)
      "rm src/gone.ts", // DELETE (the stub-and-rm hole)
      "printf '// sibling in-progress\\n' > src/sibling.ts", // a SIBLING's in-flight edit
    ],
    observed,
  );

  // Footprint fences this unit to owned + the sibling's declared in-flight file.
  const unit = ac3Unit(["src/owned.ts", "src/sibling.ts"]);
  const result = await svcRunViaSdk(deps)(unit, "1/1", repo, () => {});

  // (a) The live query was aborted the instant containment fired.
  assert.equal(
    observed.aborted,
    true,
    "the SDK abortController.signal was aborted by the PostToolUse hard-stop",
  );

  // (c) TERMINAL requires-attention NAMING an offending out-of-footprint path —
  //     never a recoverable deny the worker routes around.
  assert.equal(result.outcome, "failed", "a containment breach is terminal");
  assert.match(result.attention ?? "", /src\/evil\.ts/);
  assert.match(result.attention ?? "", /src\/gone\.ts/);
  assert.match(result.attention ?? "", /requires-attention/);
  assert.match(result.attention ?? "", /not a recoverable deny/i);

  // (b) The revert is PATH-SCOPED — only the two offenders, never a tree reset:
  //   the out-of-footprint create is cleaned away…
  assert.equal(
    fs.existsSync(path.join(repo, "src/evil.ts")),
    false,
    "the out-of-footprint Bash create was reverted (git clean)",
  );
  //   …the out-of-footprint delete is restored to HEAD…
  assert.equal(
    fs.existsSync(path.join(repo, "src/gone.ts")),
    true,
    "the out-of-footprint Bash delete was restored (git restore)",
  );
  //   …and a SIBLING's in-progress edit in the shared tree is untouched.
  assert.equal(
    fs.readFileSync(path.join(repo, "src/sibling.ts"), "utf8"),
    "// sibling in-progress\n",
    "a sibling's in-progress work in the shared tree is never touched",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("runViaSdk: a containment breach beats a raced `result: success` — the run is failed, NEVER reported success", async () => {
  // Same machinery, narrowed to the precedence clause: even if the query is NOT
  // aborted and a `result: success` is emitted, the breach must still win. We force
  // that race by NOT short-circuiting on the abort signal in the fake query.
  const repo = initGitRepo({ "src/owned.ts": "// owned\n" });

  const deps = makeDeps({}).deps;
  deps.sdkQuery = ({ options }) => {
    const opts = options as {
      hooks: {
        PostToolUse?: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }>;
      };
    };
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: "assistant", session_id: "ac3-race" };
      // Out-of-footprint Bash create — a real working-tree change.
      execFileSync("sh", ["-c", "echo '// injected' > src/evil.ts"], {
        cwd: repo,
        stdio: "pipe",
      });
      for (const grp of opts.hooks.PostToolUse ?? [])
        for (const h of grp.hooks)
          await h({ tool_name: "Bash", tool_input: {} });
      // Deliberately IGNORE the abort signal and race a success in behind the breach.
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "ac3-race",
      };
    }
    return gen();
  };

  const unit = ac3Unit(["src/owned.ts"]);
  const result = await svcRunViaSdk(deps)(unit, "1/1", repo, () => {});

  // The success message was emitted, yet the breach takes precedence: NOT success.
  assert.equal(
    result.outcome,
    "failed",
    "a raced result:success must not override a containment breach",
  );
  assert.match(result.attention ?? "", /src\/evil\.ts/);
  // And the offending create was still reverted (path-scoped).
  assert.equal(fs.existsSync(path.join(repo, "src/evil.ts")), false);

  fs.rmSync(repo, { recursive: true, force: true });
});

test("containmentCheck: an out-of-footprint Bash create + delete are detected and reverted PATH-SCOPED; a declared sibling change in the shared tree survives", async () => {
  // The shared worktree: src/owned.ts (this unit's), src/sibling.ts (a sibling's,
  // in-flight), and src/gone.ts (a tracked file a Bash `rm` will illegally delete).
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "src/sibling.ts": "// sibling original\n",
    "src/gone.ts":
      "// must survive — only the unit that owns it may delete it\n",
  });

  // Simulate a worker's Bash-driven tool calls in the shared tree:
  //   `cat > src/evil.ts`  — an out-of-footprint CREATE (untracked, `??`)
  //   `rm src/gone.ts`     — an out-of-footprint DELETE (the stub-and-rm hole)
  //   edit src/owned.ts    — legitimate in-footprint work
  //   edit src/sibling.ts  — a SIBLING's in-progress work, present in the tree
  fs.writeFileSync(path.join(repo, "src/evil.ts"), "// injected\n");
  fs.rmSync(path.join(repo, "src/gone.ts"));
  fs.writeFileSync(path.join(repo, "src/owned.ts"), "// owned — edited\n");
  fs.writeFileSync(
    path.join(repo, "src/sibling.ts"),
    "// sibling — in-progress edit\n",
  );

  // The post-tool diff is scoped to the in-flight declared footprints (this unit's
  // owned file + the sibling's), so a sibling's declared work is in-bounds and only
  // the truly out-of-footprint paths are violations.
  const footprint = ["src/owned.ts", "src/sibling.ts"];

  const svc = new OrchestratorService(makeDeps({}).deps);
  // `containmentCheck` with no injected seam routes to the real git-based default:
  // `git status --porcelain` → footprintContainment → revert ONLY the offenders.
  const verdict = await (
    svc as unknown as {
      containmentCheck: (
        cwd: string,
        footprint: string[],
      ) => Promise<ContainmentResult>;
    }
  ).containmentCheck(repo, footprint);

  // Both out-of-footprint changes are surfaced (Bash-made, no `file_path` to pre-screen).
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("expected a containment violation");
  assert.deepEqual(verdict.violations.map((v) => v.file).sort(), [
    "src/evil.ts",
    "src/gone.ts",
  ]);
  assert.match(verdict.reason, /src\/evil\.ts/);

  // The revert is PATH-SCOPED — it touched ONLY the two offending paths:
  //   the out-of-footprint create is cleaned away…
  assert.equal(
    fs.existsSync(path.join(repo, "src/evil.ts")),
    false,
    "the out-of-footprint Bash create was reverted (git clean)",
  );
  //   …the out-of-footprint delete is restored to HEAD…
  assert.equal(
    fs.existsSync(path.join(repo, "src/gone.ts")),
    true,
    "the out-of-footprint Bash delete was restored (git restore)",
  );
  // …and NOTHING else was touched: the unit's own edit and the SIBLING's
  // in-progress edit both survive (never a whole-tree reset).
  assert.equal(
    fs.readFileSync(path.join(repo, "src/owned.ts"), "utf8"),
    "// owned — edited\n",
    "the unit's own in-footprint edit survives",
  );
  assert.equal(
    fs.readFileSync(path.join(repo, "src/sibling.ts"), "utf8"),
    "// sibling — in-progress edit\n",
    "a sibling's in-progress work in the shared tree is never touched",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

// ── Union-scoped containment backstop (SP-2 / TEP-6 mechanism 4, AC4) ───────
//
// The AC3 post-tool fence ran `footprintContainment` over a WHOLE-TREE
// `git status --porcelain` against THIS unit's footprint, with a *running*-sibling
// exclusion to spare concurrent siblings. That exclusion missed a FINISHED sibling:
// once a sibling left the running set, its legitimate, landed in-footprint change was
// misattributed as THIS unit's violation, aborted the unit, and reverted it. The real
// failure: eu-1 aborted and reverted eu-2's COMPLETED change once eu-2 left the
// running set (the SP-6 concurrent-run mutual destruction).
//
// AC4 (this unit): the backstop screens against the run-level UNION of every dispatched
// unit's footprint — it cannot attribute a shared-tree change to a unit, so a change is
// a violation only when it lands OUTSIDE all declared territory. A sibling's in-footprint
// change is in the union whether that sibling is still running OR has already finished.
// These end-to-end tests drive the REAL `runViaSdk` (only the SDK boundary faked, a real
// on-disk git repo — the AC3 pattern):
//   (a) a FINISHED sibling's in-union change present in the tree → NO abort, NO revert
//       (the exact case the running-exclusion missed);
//   (b) a change present BEFORE the unit started (baseline) → NO abort;
//   (c) a write outside the UNION of all declared footprints → STILL aborts + reverts
//       only that path + terminal requires-attention.

test("runViaSdk AC4: a FINISHED sibling's in-union change in the shared tree does NOT abort this unit (nor is it reverted)", async () => {
  // The shared worktree holds this unit's file and a sibling's. The sibling has ALREADY
  // FINISHED and landed its in-footprint change — it is NOT in any running set. This is the
  // exact case the earlier *running*-sibling exclusion missed: once the sibling left the
  // running set, its legitimate landed change was misattributed to this unit and reverted
  // (eu-1 reverting eu-2's completed work). The run-level UNION of declared footprints
  // includes the sibling's file regardless of whether it still runs, so the whole-tree
  // backstop must NOT attribute the finished sibling's change to this unit.
  const repo = initGitRepo({
    "src/methodology/orchestratorCore.ts": "// core\n",
    "src/methodology/parallelSlices.ts": "// slices\n",
  });
  // A FINISHED sibling's landed in-footprint change, present in the shared tree.
  fs.writeFileSync(
    path.join(repo, "src/methodology/parallelSlices.ts"),
    "// slices — finished sibling's landed work\n",
  );

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  // This unit only touches its OWN footprint file (legitimate in-footprint work).
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    ["printf '// core — edited\\n' > src/methodology/orchestratorCore.ts"],
    observed,
  );

  const unit = ac3Unit(["src/methodology/orchestratorCore.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    // The run-level UNION of every dispatched unit's footprint — the FINISHED sibling's
    // file is in it (no running set is consulted any more).
    [
      "src/methodology/orchestratorCore.ts",
      "src/methodology/parallelSlices.ts",
    ],
    [], // nothing dirty at this unit's start
  );

  // No breach: the query was never aborted and the run succeeded.
  assert.equal(
    observed.aborted,
    false,
    "the query was not aborted (no breach)",
  );
  assert.equal(
    result.outcome,
    "success",
    "a finished sibling's in-union change is not this unit's violation",
  );
  // The finished sibling's landed work in the shared tree was NEVER reverted.
  assert.equal(
    fs.readFileSync(
      path.join(repo, "src/methodology/parallelSlices.ts"),
      "utf8",
    ),
    "// slices — finished sibling's landed work\n",
    "a finished sibling's in-union change must never be reverted (the running-exclusion miss)",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("runViaSdk AC4: a change present BEFORE the unit started (baseline) does NOT abort it", async () => {
  // An earlier unit left src/earlier.ts dirty before this unit ran. It is outside the
  // run-level union now, but it predates this unit's run (baseline), so this unit must
  // not be aborted for it nor have it reverted.
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "src/earlier.ts": "// earlier original\n",
  });
  // An earlier unit's change, already present in the tree when this unit starts.
  fs.writeFileSync(
    path.join(repo, "src/earlier.ts"),
    "// earlier — already changed\n",
  );

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    ["printf '// owned — edited\\n' > src/owned.ts"],
    observed,
  );

  const unit = ac3Unit(["src/owned.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    ["src/owned.ts"], // the run-level union (earlier.ts is in no footprint)
    ["src/earlier.ts"], // …but it WAS dirty at this unit's start (baseline)
  );

  assert.equal(
    observed.aborted,
    false,
    "a baseline change does not abort the unit",
  );
  assert.equal(result.outcome, "success");
  // The pre-existing change is left untouched (never reverted as this unit's work).
  assert.equal(
    fs.readFileSync(path.join(repo, "src/earlier.ts"), "utf8"),
    "// earlier — already changed\n",
    "a change present before the unit started must never be reverted",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("runViaSdk AC4: a write outside the UNION of all declared footprints STILL aborts + reverts only that path + requires-attention", async () => {
  // The genuine breach still hard-stops: src/evil.ts is in NO unit's footprint (outside the
  // union) and was not present at start. A sibling's in-union change (its owner already
  // finished) and a baseline change are both present too — neither may be reverted, only the
  // breach.
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "src/sibling.ts": "// sibling original\n",
    "src/earlier.ts": "// earlier original\n",
  });
  // A baseline change present before this unit starts.
  fs.writeFileSync(
    path.join(repo, "src/earlier.ts"),
    "// earlier — pre-existing\n",
  );

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    [
      "printf '// owned — edited\\n' > src/owned.ts", // legit in-footprint
      "printf '// sibling in-progress\\n' > src/sibling.ts", // a (finished) sibling's in-union edit
      "cat > src/evil.ts <<'E'\n// injected breach\nE", // the TRUE out-of-union breach
    ],
    observed,
  );

  const unit = ac3Unit(["src/owned.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    ["src/owned.ts", "src/sibling.ts"], // the run-level union (sibling's footprint included)
    ["src/earlier.ts"], // baseline
  );

  // The breach still hard-stops: aborted, terminal failure, naming ONLY the breach.
  assert.equal(
    observed.aborted,
    true,
    "the genuine breach still aborts the query",
  );
  assert.equal(
    result.outcome,
    "failed",
    "a true out-of-bounds write is still terminal",
  );
  assert.match(result.attention ?? "", /src\/evil\.ts/);
  assert.match(result.attention ?? "", /requires-attention/);
  assert.match(result.attention ?? "", /not a recoverable deny/i);
  // evil.ts is the ONLY change listed as a reverted violation. The sibling's file may appear
  // in the declared-territory header (it is part of the union), but NEVER as a reverted
  // violation bullet; the baseline file appears nowhere at all (both are exempt, not violations).
  assert.match(result.attention ?? "", /•[^\n]*src\/evil\.ts/);
  assert.doesNotMatch(result.attention ?? "", /•[^\n]*src\/sibling\.ts/);
  assert.doesNotMatch(result.attention ?? "", /src\/earlier\.ts/);

  // The revert is PATH-SCOPED to the breach only:
  assert.equal(
    fs.existsSync(path.join(repo, "src/evil.ts")),
    false,
    "the true out-of-footprint create was reverted (git clean)",
  );
  // …the sibling's in-union edit survives…
  assert.equal(
    fs.readFileSync(path.join(repo, "src/sibling.ts"), "utf8"),
    "// sibling in-progress\n",
    "a sibling's in-union change survives the breach revert",
  );
  // …and the baseline change survives.
  assert.equal(
    fs.readFileSync(path.join(repo, "src/earlier.ts"), "utf8"),
    "// earlier — pre-existing\n",
    "a baseline change survives the breach revert",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("runViaSdk AC4 (mirror): a unit on B is NOT aborted by a finished sibling's in-union change to A (the other direction)", async () => {
  // The MIRROR of the test above (which ran the unit on orchestratorCore.ts with
  // parallelSlices.ts as the sibling). Here the unit owns parallelSlices.ts and a sibling
  // that already FINISHED has changed orchestratorCore.ts in the shared tree. Both
  // directions of the original SP-6 mutual-destruction pair must be exempt — a regression
  // that broke only one direction would otherwise slip the suite.
  const repo = initGitRepo({
    "src/methodology/orchestratorCore.ts": "// core\n",
    "src/methodology/parallelSlices.ts": "// slices\n",
  });
  // The finished sibling has already edited ITS in-footprint file (orchestratorCore.ts).
  fs.writeFileSync(
    path.join(repo, "src/methodology/orchestratorCore.ts"),
    "// core — sibling in-progress\n",
  );

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  // This unit only touches its OWN footprint file (parallelSlices.ts).
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    ["printf '// slices — edited\\n' > src/methodology/parallelSlices.ts"],
    observed,
  );

  const unit = ac3Unit(["src/methodology/parallelSlices.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    // The run-level union includes the finished sibling's file (A).
    [
      "src/methodology/orchestratorCore.ts",
      "src/methodology/parallelSlices.ts",
    ],
    [], // nothing dirty at this unit's start
  );

  assert.equal(
    observed.aborted,
    false,
    "the query was not aborted (no breach)",
  );
  assert.equal(
    result.outcome,
    "success",
    "a finished sibling's in-union change to A is not this unit's violation",
  );
  // The sibling's in-progress work on A in the shared tree was NEVER reverted.
  assert.equal(
    fs.readFileSync(
      path.join(repo, "src/methodology/orchestratorCore.ts"),
      "utf8",
    ),
    "// core — sibling in-progress\n",
    "a finished sibling's in-union change to A must never be reverted (mirror direction)",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

// ── End-to-end: the scheduler ITSELF builds the run-level footprint union ─────
//
// The unit-level AC4 tests above hand `runViaSdk` a written `unionFootprint`, so they
// prove the check HONOURS the union but never that the SCHEDULER assembles it. This test
// drives the REAL `dispatchSpec` with two concurrently-dispatched, disjoint-footprint
// units (cap 2) and the REAL `runViaSdk` (no `runUnit` seam) against a REAL on-disk git
// worktree, so the run-level UNION of every dispatched unit's footprint is built BY THE
// SCHEDULER and threaded into each worker. A barrier holds both units in-flight until
// BOTH have written their in-footprint file, so each unit's PostToolUse containment check
// runs while the OTHER's change is already in the shared tree — the exact SP-6
// mutual-destruction shape. Both must land success; neither may be aborted or have its
// file reverted. This is the test that would have caught the original bug: break the
// scheduler's union computation and it FAILS (the units revert each other).
test("dispatchSpec AC4 (end-to-end): two concurrent disjoint units — the SCHEDULER builds the footprint union so NEITHER reverts the other (no mutual destruction)", async () => {
  const A = "src/methodology/orchestratorCore.ts";
  const B = "src/methodology/parallelSlices.ts";
  // The shared spec worktree, a real git repo seeding both units' files.
  const repo = initGitRepo({ [A]: "// core\n", [B]: "// slices\n" });

  // A two-party barrier: both unit workers write their own file, then wait here until
  // BOTH have written, so each unit's PostToolUse check runs with the other's change
  // already present in the shared tree (and the other unit still running).
  let release!: () => void;
  const bothWritten = new Promise<void>((r) => (release = r));
  let arrived = 0;
  const barrier = async () => {
    if (++arrived === 2) release();
    await bothWritten;
  };

  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      satisfies: [1],
      work_units: [{ footprint: [A], execution: "fan-out", note: "owns A" }],
    },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      satisfies: [2],
      work_units: [{ footprint: [B], execution: "fan-out", note: "owns B" }],
    },
  });

  // Drive the REAL runViaSdk (NOT the runUnit seam, which would bypass the very
  // PostToolUse/containment machinery AC4 is about). Remove the default runUnit so
  // runWorker falls through to runViaSdk.
  delete deps.runUnit;
  // The shared worktree is a real git repo (runViaSdk's `git status --porcelain` and
  // path-scoped revert run against it). worktrees.create returns it.
  deps.worktrees = {
    create: async () => repo,
  } as unknown as OrchestratorDeps["worktrees"];

  const aborted: Record<string, boolean> = {};
  // Per-unit fake SDK: branch on the unit id embedded in the worker prompt; write THIS
  // unit's in-footprint file as REAL Bash, sync on the barrier, then fire the real
  // PostToolUse hooks, then (unless aborted) emit result:success.
  deps.sdkQuery = ({ prompt, options }) => {
    const opts = options as {
      hooks: {
        PostToolUse?: Array<{
          hooks: Array<(i: unknown) => Promise<unknown>>;
        }>;
      };
      abortController: AbortController;
    };
    async function* gen(): AsyncGenerator<unknown> {
      // Read the first user message to learn which unit this is (its id + footprint).
      let promptText = "";
      for await (const m of prompt as AsyncIterable<unknown>) {
        const content = (m as { message?: { content?: unknown } })?.message
          ?.content;
        if (typeof content === "string") promptText = content;
        break; // only the task message is needed to route
      }
      const ownsA = promptText.includes(A);
      const file = ownsA ? A : B;
      const tag = ownsA ? "A" : "B";
      yield { type: "assistant", session_id: `e2e-${tag}` };
      // This unit makes its OWN in-footprint change in the shared tree.
      execFileSync("sh", ["-c", `printf '// ${tag} — edited\\n' > ${file}`], {
        cwd: repo,
        stdio: "pipe",
      });
      // Hold until BOTH units have written, so each check sees the other's change.
      await barrier();
      for (const grp of opts.hooks.PostToolUse ?? [])
        for (const h of grp.hooks)
          await h({ tool_name: "Bash", tool_input: {} });
      aborted[tag] = opts.abortController.signal.aborted;
      if (opts.abortController.signal.aborted) return;
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: `e2e-${tag}`,
      };
    }
    return gen();
  };

  // Cap 2 so both units dispatch concurrently — the scheduler holds both footprints
  // in state.running at once.
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 2);

  // Both units dispatched and BOTH landed success — neither was aborted by the other.
  assert.equal(r.dispatched, 2, "two disjoint units dispatched concurrently");
  assert.deepEqual(
    r.results.map((x) => x.outcome).sort(),
    ["success", "success"],
    "both units landed success — neither aborted the other",
  );
  assert.equal(aborted.A, false, "unit A's query was not aborted");
  assert.equal(aborted.B, false, "unit B's query was not aborted");
  // No slice was flagged requires-attention by a misattributed containment breach.
  assert.deepEqual(r.attention, [], "no slice flagged for a footprint breach");
  // Crucially: NEITHER unit's in-footprint change was reverted by the other.
  assert.equal(
    fs.readFileSync(path.join(repo, A), "utf8"),
    "// A — edited\n",
    "unit A's change survived (B did not revert it)",
  );
  assert.equal(
    fs.readFileSync(path.join(repo, B), "utf8"),
    "// B — edited\n",
    "unit B's change survived (A did not revert it)",
  );
  // Both slices advanced and the Spec committed (the green path completed end-to-end).
  assert.deepEqual(
    r.advanced.sort(),
    ["TEP-1_SP-1_SL-1", "TEP-1_SP-1_SL-2"],
    "both slices advanced",
  );
  assert.equal(calls.acquired.length, 2, "the scheduler dispatched both units");

  fs.rmSync(repo, { recursive: true, force: true });
});

// ── Run-halt policy (SP-2 / TEP-6 mechanism 4, AC5) ─────────────────────────
//
// Today the loop is per-UNIT isolated: a failed unit → requires-attention while the
// run keeps dispatching the rest of the frontier to quiescence — so a systemic
// failure (a footprint violation, or a cascade) burns tokens on a doomed run the
// human can't interrupt until it ends. AC5 adds a run-halt:
//   • a footprint VIOLATION (the AC3/AC4 containment hard-stop, carried as the clean
//     `containment: true` outcome flag — NOT a reason-string match) halts on the FIRST;
//   • N ordinary failures (N a small configurable default, here overridden via the
//     dispatchSpec `failThreshold` arg) halt the run;
//   • once halted, `fill()` stops pulling the ready frontier — NO new units dispatch —
//     the loop drains the in-flight units, writes the report, and returns; already-Done
//     units are untouched and not-yet-dispatched units stay ready for a re-orchestrate.
//
// cap 1 makes dispatch serial, so the halt takes effect (in the completing unit's loop
// turn) BEFORE the next fill — the later ready units provably never dispatch.

test("dispatchSpec AC5: a footprint VIOLATION halts the run on the FIRST one — no later unit dispatches, the report is still written, a Done unit is untouched", async () => {
  // SL-1 is already Done (must stay untouched). SL-2 returns a footprint VIOLATION
  // (containment: true). SL-3 is ready but must NEVER dispatch once the run halts.
  const seen: string[] = [];
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": { status: "done", files: ["src/done.ts"] },
      "teps/TEP-1/SP-1/SL-2.md": { status: "ready", files: ["src/a.ts"] },
      "teps/TEP-1/SP-1/SL-3.md": { status: "ready", files: ["src/b.ts"] },
    },
    {
      run: async (unit) => {
        seen.push(unit.id);
        // The breaching unit fails as a footprint violation; any other ready unit
        // would succeed — but it must never get the chance to run.
        return unit.slice === "TEP-1_SP-1_SL-2"
          ? {
              outcome: "failed" as const,
              attention:
                "out-of-footprint write to src/evil.ts — not a recoverable deny",
              containment: true,
            }
          : { outcome: "success" as const };
      },
    },
  );

  // cap 1 → serial dispatch, so the violation halts the run before SL-3 can be pulled.
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 1);

  // Exactly one unit dispatched (the violating SL-2); SL-3 stayed ready (never run).
  assert.equal(
    r.dispatched,
    1,
    "only the violating unit dispatched — the run halted before SL-3",
  );
  assert.deepEqual(
    seen,
    ["TEP-1_SP-1_SL-2"],
    "no later unit ran after the violation",
  );
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["failed"],
    "the one dispatched unit failed (a footprint violation)",
  );
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-2"],
    "the breaching slice → requires-attention",
  );
  // SL-1 was already Done before the run — it is untouched (never re-dispatched, never advanced).
  assert.ok(
    !seen.includes("TEP-1_SP-1_SL-1"),
    "the already-Done unit was not re-dispatched",
  );
  assert.ok(
    !calls.advanced.includes("TEP-1_SP-1_SL-1"),
    "the already-Done slice is left untouched",
  );
  assert.equal(r.committed, false, "a halted run does not commit the Spec");
  // The report is STILL written (durable work / audit trail preserved on a halt).
  assert.ok(
    r.deliveryDoc,
    "the delivery report is written even on a halted run",
  );
});

test("dispatchSpec AC5: N ordinary failures halt the run (N=2 via override) — the (N+1)th ready unit never dispatches", async () => {
  // Three ready units, each an ordinary failure. With N=2 the run halts after the
  // second failure, so the third unit is never pulled. cap 1 → serial dispatch.
  const seen: string[] = [];
  const { deps } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": { status: "ready", files: ["src/a.ts"] },
      "teps/TEP-1/SP-1/SL-2.md": { status: "ready", files: ["src/b.ts"] },
      "teps/TEP-1/SP-1/SL-3.md": { status: "ready", files: ["src/c.ts"] },
    },
    {
      run: async (unit) => {
        seen.push(unit.id);
        return { outcome: "failed" as const }; // ordinary failure (no containment flag)
      },
    },
  );

  // Override N=2 via the dispatchSpec failThreshold arg.
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 1, 2);

  assert.equal(
    r.dispatched,
    2,
    "exactly N=2 units dispatched — the 3rd never ran",
  );
  assert.equal(seen.length, 2, "the (N+1)th ready unit was never dispatched");
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["failed", "failed"],
    "both dispatched units failed",
  );
  assert.equal(
    r.attention.length,
    2,
    "both failures flagged requires-attention",
  );
  assert.equal(r.committed, false);
});

test("dispatchSpec AC5: a SINGLE ordinary failure with N=3 does NOT halt — a healthy sibling still dispatches and lands (isolation below the threshold)", async () => {
  // Two ready units: SL-1 fails (ordinary), SL-2 succeeds. Below the N=3 threshold the
  // run does NOT halt — per-unit isolation holds and the healthy sibling still runs to
  // a landed unit (its whole-Spec commit stays gated by the failure, as today: the
  // closing gate only runs at a clean quiescence — the point here is dispatch continues).
  const seen: string[] = [];
  const { deps } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
      "teps/TEP-1/SP-1/SL-2.md": {
        status: "ready",
        files: ["src/b.ts"],
        satisfies: [2],
      },
    },
    {
      run: async (unit) => {
        seen.push(unit.id);
        return unit.slice === "TEP-1_SP-1_SL-1"
          ? { outcome: "failed" as const }
          : { outcome: "success" as const };
      },
    },
  );

  // Threshold N=3 (one failure is below it) → no halt.
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 1, 3);

  assert.equal(
    r.dispatched,
    2,
    "both units dispatched — one failure below N=3 does not halt",
  );
  assert.equal(
    seen.length,
    2,
    "the healthy sibling still ran despite the single failure",
  );
  assert.ok(
    seen.includes("TEP-1_SP-1_SL-2"),
    "the healthy sibling was dispatched (not halted)",
  );
  assert.deepEqual(
    r.results.map((x) => x.outcome).sort(),
    ["failed", "success"],
    "the sibling landed success while the other failed — per-unit isolation preserved",
  );
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "only the failed slice → requires-attention",
  );
});

// ── AC5 durability: the REAL containment-threading drives the halt (not a hand-set flag) ──
//
// The three policy tests above inject the outcome through the `runUnit` seam and HAND-SET
// `containment: true`, so they exercise the halt POLICY but NOT the wiring that produces the flag:
// `runViaSdk` (the post-tool hard-stop) → `dispatchUnit` (threads `wr.containment` onto UnitDone) →
// the completion loop's `d.containment` halt branch. This end-to-end test closes that gap: it runs
// the REAL `runViaSdk` (only the SDK boundary faked via `sdkQuery`) against a REAL on-disk git repo
// where a worker makes a GENUINE out-of-footprint Bash change (`cat >` a create, `rm` a delete), so
// the real PostToolUse containment check fires, sets `containment: true`, and that flag — threaded
// through the real loop — is what halts the run on the FIRST violation. A regression that stopped
// `runViaSdk` emitting the flag, or dropped it in `dispatchUnit`, would let dispatch continue and
// FAIL this test. cap 1 → serial dispatch, so the halt provably lands before the next unit is pulled.
test("dispatchSpec AC5 (end-to-end): a REAL runViaSdk footprint breach sets containment:true AND halts the run on the FIRST violation — no further dispatch, report still written", async () => {
  // The shared worktree: the breaching unit's owned file, plus a tracked file its out-of-footprint
  // `rm` will illegally delete. A real git repo so the real containment check has a tree to diff.
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "src/gone.ts": "// only its owner may delete this\n",
  });

  // First, prove the THREADING link directly: the real runViaSdk, on a genuine breach, RETURNS a
  // WorkerResult carrying containment:true (the flag the loop's halt branch keys on). This is the
  // exact link the hand-set-`containment` policy tests skip.
  {
    const probeDeps = makeDeps({}).deps;
    delete probeDeps.runUnit;
    probeDeps.sdkQuery = fakeSdkQueryRunningBashThen(
      repo,
      [
        "cat > src/evil.ts <<'E'\n// injected out-of-footprint\nE", // CREATE (untracked)
        "rm src/gone.ts", // DELETE (the stub-and-rm hole)
      ],
      {},
    );
    const probeResult = await svcRunViaSdk(probeDeps)(
      ac3Unit(["src/owned.ts"]),
      "1/1",
      repo,
      () => {},
      ["src/owned.ts"], // the run-level union (evil.ts / gone.ts are outside it → a breach)
      [],
    );
    assert.equal(probeResult.outcome, "failed", "a real breach fails the unit");
    assert.equal(
      probeResult.containment,
      true,
      "runViaSdk PRODUCES containment:true on a genuine footprint breach (the threading source)",
    );
    // Restore the tree the probe's revert already cleaned, so the dispatchSpec run below starts fresh.
    execFileSync("git", ["-C", repo, "checkout", "-q", "--", "."], {
      stdio: "pipe",
    });
    execFileSync("git", ["-C", repo, "clean", "-fdq"], { stdio: "pipe" });
  }

  // Now the full loop: SL-1 (the breacher) + SL-2 (a healthy ready unit that must NEVER dispatch
  // once the run halts on SL-1's violation). Drive the REAL runViaSdk for BOTH units — SL-1's fake
  // SDK makes a real out-of-footprint change; SL-2's would succeed but must never get the chance.
  const seen: string[] = [];
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      satisfies: [1],
      work_units: [
        {
          footprint: ["src/owned.ts"],
          execution: "fan-out",
          note: "the breacher",
        },
      ],
    },
    "teps/TEP-1/SP-1/SL-2.md": {
      status: "ready",
      satisfies: [2],
      work_units: [
        {
          footprint: ["src/healthy.ts"],
          execution: "fan-out",
          note: "healthy sibling",
        },
      ],
    },
  });
  delete deps.runUnit; // fall through to the REAL runViaSdk
  deps.worktrees = {
    create: async () => repo,
  } as unknown as OrchestratorDeps["worktrees"];

  // Per-unit fake SDK: route on the unit id in the prompt. SL-1 makes a GENUINE out-of-footprint
  // Bash change → the real PostToolUse containment check aborts it (containment:true). SL-2 would
  // edit its own file and succeed — but the halt must stop it being dispatched at all.
  deps.sdkQuery = ({ prompt, options }) => {
    const opts = options as {
      hooks: {
        PostToolUse?: Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }>;
      };
      abortController: AbortController;
    };
    async function* gen(): AsyncGenerator<unknown> {
      let promptText = "";
      for await (const m of prompt as AsyncIterable<unknown>) {
        const content = (m as { message?: { content?: unknown } })?.message
          ?.content;
        if (typeof content === "string") promptText = content;
        break;
      }
      const isBreacher = promptText.includes("src/owned.ts");
      seen.push(isBreacher ? "SL-1" : "SL-2");
      yield {
        type: "assistant",
        session_id: isBreacher ? "e2e-breach" : "e2e-ok",
      };
      if (isBreacher) {
        // A genuine out-of-footprint create — real working-tree change the real check catches.
        execFileSync("sh", ["-c", "printf '// evil\\n' > src/evil.ts"], {
          cwd: repo,
          stdio: "pipe",
        });
      } else {
        execFileSync("sh", ["-c", "printf '// ok\\n' > src/healthy.ts"], {
          cwd: repo,
          stdio: "pipe",
        });
      }
      for (const grp of opts.hooks.PostToolUse ?? [])
        for (const h of grp.hooks)
          await h({ tool_name: "Bash", tool_input: {} });
      if (opts.abortController.signal.aborted) return; // the breach aborted us
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: isBreacher ? "e2e-breach" : "e2e-ok",
      };
    }
    return gen();
  };

  // cap 1 → serial dispatch, so the violation halts the run BEFORE SL-2 can be pulled.
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 1);

  // The run halted on the FIRST (and only) violation: exactly one unit dispatched, SL-2 never ran.
  // This is ONLY reachable if containment:true threaded runViaSdk → dispatchUnit → the loop.
  assert.equal(
    r.dispatched,
    1,
    "only the breaching unit dispatched — the run halted before SL-2",
  );
  assert.deepEqual(
    seen,
    ["SL-1"],
    "no unit ran after the real footprint violation",
  );
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["failed"],
    "the one dispatched unit failed (a footprint violation)",
  );
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "the breaching slice → requires-attention",
  );
  assert.equal(r.committed, false, "a halted run does not commit");
  // The report is STILL written on a halt (the audit trail the human re-orchestrating needs).
  assert.ok(
    r.deliveryDoc,
    "the delivery report is written even on a halted run",
  );
  // Only the breacher was ever claimed — SL-2's worker never started.
  assert.deepEqual(
    calls.acquired,
    ["TEP-1_SP-1_SL-1#eu-0"],
    "SL-2's worker was never dispatched",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

// ── Held-out acceptance evidence: untouchable grader + independent grade (SP-6/6 AC2 + AC4) ──
//
// AC2: "The implementer cannot author or alter the grading evidence. The acceptance probes the
// closing gate runs resolve to paths OUTSIDE every unit's declared footprint, and a worker
// attempt to create/modify/delete an acceptance-evidence file is refused/hard-stopped (via SP-2's
// fence) — the unit goes requires-attention rather than producing a green it authored."
//
// AC4: "The independent grader closes the loop; the worker cannot. The pass/fail that advances a
// slice toward Done is produced by re-running the independently-authored acceptance evidence;
// there is no path by which the implementing or fixing worker marks its own ACs green (no
// self-tick, no worker-authored test counts as the grade)."
//
// The evidence convention (`acceptance/` path segment → never-in-footprint, via
// `parallelSlices.resolveFootprint`) and the self-tick predicate
// (`OrchestratorService.verificationIsWorkerAuthored`) are the seams this unit reuses — it does
// NOT re-invent the rule, it drives the real wiring:
//   • AC2 rides the SAME real `runViaSdk` → PostToolUse → `footprintContainment` → path-scoped
//     revert → terminal requires-attention machinery the AC3/AC4 (SP-2) tests above exercise,
//     but with the breach pointed at a held-out `acceptance/` path — which is a violation EVEN
//     when the unit declared it (the resolver strips it from every exemption set);
//   • AC4 drives the REAL closing gate in `dispatchSpec`: a verification whose `run` reaches a
//     dispatched unit's own footprint is a self-tick that is DROPPED from the grade (the AC falls
//     un-graded → the slice goes requires-attention, never advanced/committed/checked), while a
//     verification that runs only the out-of-footprint acceptance evidence grades the slice green.

test("runViaSdk AC2: a worker write to a held-out acceptance-evidence path hard-stops → abort + PATH-SCOPED revert + TERMINAL requires-attention naming it (the implementer cannot author the grader)", async () => {
  // The shared worktree holds this unit's owned file plus the held-out acceptance evidence the
  // independent grader runs. The worker tries to TAMPER with the grader (rewrite it so its own AC
  // goes green) — the deterministic analog of "the student edits the answer key."
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "tests/acceptance/SP-6.test.ts":
      "// the held-out grader — only the independent verifier may author this\n",
  });

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  // A Bash MODIFY of the tracked acceptance file (no `file_path` for the PreToolUse guard to
  // pre-screen — the stub-and-edit hole the post-tool containment closes).
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    ["printf '// tampered so my AC passes\\n' > tests/acceptance/SP-6.test.ts"],
    observed,
  );

  // The unit is fenced to its own file; the acceptance path is in NO footprint.
  const unit = ac3Unit(["src/owned.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    ["src/owned.ts"], // the run-level union — the acceptance evidence is outside it
    [],
  );

  // The live query was aborted the instant containment fired (SP-2 fence).
  assert.equal(
    observed.aborted,
    true,
    "a write to the held-out acceptance evidence aborts the worker",
  );
  // TERMINAL requires-attention NAMING the acceptance path — never a recoverable deny.
  assert.equal(
    result.outcome,
    "failed",
    "tampering with the grader is a terminal containment breach",
  );
  assert.match(result.attention ?? "", /tests\/acceptance\/SP-6\.test\.ts/);
  assert.match(result.attention ?? "", /requires-attention/);
  assert.match(result.attention ?? "", /not a recoverable deny/i);
  // The tamper was reverted (restored to HEAD): the independent grader is left intact, never
  // a green the worker authored.
  assert.equal(
    fs.readFileSync(path.join(repo, "tests/acceptance/SP-6.test.ts"), "utf8"),
    "// the held-out grader — only the independent verifier may author this\n",
    "the held-out grader is restored — the worker's tamper never lands",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("runViaSdk AC2: even when a unit DECLARES the acceptance-evidence path in its footprint, a write there STILL hard-stops (the resolver makes it never-in-footprint — no claiming the grader)", async () => {
  // The strongest form of AC2: a worker that brazenly LISTS the acceptance evidence in its own
  // footprint still cannot author it. `resolveFootprint` strips the held-out path from owned, the
  // running-union, AND baseline, so the create is a violation regardless of what the unit declared.
  // `tests/acceptance/` is already tracked (a held-out grader lives there) so git reports the NEW
  // file by its full path — otherwise git collapses a brand-new untracked dir to `tests/` and the
  // breach would be caught generically rather than specifically via the resolver strip.
  const repo = initGitRepo({
    "src/owned.ts": "// owned\n",
    "tests/acceptance/keep.test.ts": "// an existing held-out grader\n",
  });

  const observed: { aborted?: boolean } = {};
  const deps = makeDeps({}).deps;
  // A Bash CREATE of an acceptance-evidence file (untracked, `??`) the unit "owns" on paper.
  deps.sdkQuery = fakeSdkQueryRunningBashThen(
    repo,
    [
      "cat > tests/acceptance/sneak.test.ts <<'E'\n// a grader I wrote for myself\nE",
    ],
    observed,
  );

  // The code unit DECLARES both its real file AND the acceptance path — but role-resolution strips
  // the held-out path from BOTH its own footprint (owned) AND the run-level union (a `code` unit
  // contributes no acceptance), so the write lands outside all exempt territory and is a breach.
  const unit = ac3Unit(["src/owned.ts", "tests/acceptance/sneak.test.ts"]);
  const result = await svcRunViaSdk(deps)(
    unit,
    "1/1",
    repo,
    () => {},
    // The union the real dispatch passes is role-resolved: a code unit contributes NO acceptance
    // path (resolveRoleFootprint strips it), so `tests/acceptance/…` is not in the union either.
    ["src/owned.ts"],
    [],
  );

  assert.equal(
    observed.aborted,
    true,
    "a declared acceptance-evidence write is still a breach (never-in-footprint)",
  );
  assert.equal(result.outcome, "failed");
  assert.match(result.attention ?? "", /tests\/acceptance\/sneak\.test\.ts/);
  assert.match(result.attention ?? "", /requires-attention/);
  // The self-authored grader was cleaned away — it never lands as evidence.
  assert.equal(
    fs.existsSync(path.join(repo, "tests/acceptance/sneak.test.ts")),
    false,
    "a worker-authored grader is reverted — declaring it in footprint does not let it land",
  );

  fs.rmSync(repo, { recursive: true, force: true });
});

test("dispatchSpec AC4: a worker-authored verification (its `run` reaches the unit's OWN footprint) is EXCLUDED from the grade — the AC is un-graded → requires-attention, never advanced/committed/checked (no self-tick)", async () => {
  // SL-1's worker owns (and authored) `src/feature.test.ts`. The Spec declares AC#1's verification
  // as running THAT test (the compiled `out-test/feature.test.js`). Even though the runner reports
  // it green, it is the worker's OWN evidence — it must NOT count as the grade. With AC#1 dropped,
  // the slice falls un-graded and goes requires-attention; nothing advances or commits.
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/feature.test.ts"], // the worker owns the test it would be graded on
        satisfies: [1],
      },
    },
    {
      verifs: { "1": { run: "node --test out-test/feature.test.js" } },
      acPass: { 1: true }, // the worker-authored test "passes" — it must STILL not count
    },
  );

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // The unit landed (the worker succeeded) — the gate ran, so this is about the GRADE, not a crash.
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["success"],
    "the unit landed — the gate ran",
  );
  // No self-tick path: the slice cannot advance off its own evidence.
  assert.deepEqual(
    r.advanced,
    [],
    "a self-ticked AC can never advance the slice",
  );
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "the AC is un-graded (self-tick dropped) → requires-attention",
  );
  assert.equal(r.committed, false, "no commit on a self-ticked grade");
  assert.deepEqual(
    calls.checked,
    [],
    "the AC ordinal is NEVER checked off the worker's own evidence",
  );
  // The full per-AC run still lands on the auditable result (the human sees WHY it didn't count)…
  assert.deepEqual(
    r.acResults.map((x) => [x.ac, x.pass] as [number, boolean]),
    [[1, true]],
    "the self-tick still appears in the audit trail (run, but not graded)",
  );
  // …but the grade excluded it, and that exclusion is logged.
  assert.ok(
    calls.log.some((l) => /self-tick/i.test(l)),
    "the self-tick exclusion from the grade is logged",
  );
});

test("dispatchSpec AC4: an INDEPENDENT verification (its `run` reaches only out-of-footprint acceptance evidence) grades — the slice advances, its ordinal is checked, the Spec commits", async () => {
  // SL-1's worker owns the IMPLEMENTATION (`src/feature.ts`) only. AC#1 is proven by held-out
  // acceptance evidence under `acceptance/` — never-in-footprint, so it is independent of the
  // implementer. The independent green is the ONLY thing that ticks the ordinal and advances Done.
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/feature.ts"], // the worker owns only the implementation
        satisfies: [1],
      },
    },
    {
      verifs: { "1": { run: "node --test out-test/acceptance/sp6.test.js" } },
      acPass: { 1: true },
    },
  );

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  assert.deepEqual(
    r.advanced,
    ["TEP-1_SP-1_SL-1"],
    "an independently-graded green advances the slice",
  );
  assert.deepEqual(
    calls.checked,
    [1],
    "the ordinal is checked off the INDEPENDENT evidence (the grader closed the loop)",
  );
  assert.equal(
    r.committed,
    true,
    "the Spec commits on an independently-graded green",
  );
  assert.deepEqual(
    r.attention,
    [],
    "nothing requires-attention — the independent grade passed",
  );
});

test("verificationExecutesWorkerAuthored: only EXECUTING a worker-owned file is a self-tick — reading it (grep/[ -e ]/redirect/for-in operand) is not (the TEP-13_SP-1 docs-spec deadlock)", () => {
  const owned = new Set(
    resolveFootprint([
      "src/feature.ts",
      "src/feature.test.ts",
      "scripts/tool.sh",
      "docs/preview-playbook.yml",
      "docs/modules/ROOT/nav.adoc",
      "docs/METHODOLOGY.md",
      "docs/VISION.md",
    ]),
  );

  // Execution of worker-authored content → self-tick, exactly as before.
  assert.equal(
    verificationExecutesWorkerAuthored(
      "node --test out-test/feature.test.js",
      owned,
    ),
    true,
    "node --test over the worker's own compiled test executes it",
  );
  assert.equal(
    verificationExecutesWorkerAuthored("npx tsx src/feature.ts", owned),
    true,
    "npx tsx over an in-footprint source executes it",
  );
  assert.equal(
    verificationExecutesWorkerAuthored("bash scripts/tool.sh", owned),
    true,
    "bash over a worker-owned script executes it",
  );
  assert.equal(
    verificationExecutesWorkerAuthored("scripts/tool.sh --check", owned),
    true,
    "a worker-owned script in command position is executed",
  );
  assert.equal(
    verificationExecutesWorkerAuthored(
      "npm run docs:build && node src/feature.ts",
      owned,
    ),
    true,
    "execution after a && boundary is still caught",
  );

  // Reads of the deliverable → NOT a self-tick (the signed probe text grades, not the worker).
  assert.equal(
    verificationExecutesWorkerAuthored(
      "grep -q 'failure_level: warn' docs/preview-playbook.yml && grep -q xref docs/modules/ROOT/nav.adoc",
      owned,
    ),
    false,
    "grep targets are data, not execution (TEP-13 AC#1 shape)",
  );
  assert.equal(
    verificationExecutesWorkerAuthored(
      'set -e; for f in docs/METHODOLOGY.md docs/VISION.md; do [ ! -e "$f" ] || exit 1; done',
      owned,
    ),
    false,
    "for-in operands and [ -e ] targets are data (TEP-13 AC#6 shape)",
  );
  assert.equal(
    verificationExecutesWorkerAuthored(
      '[ "$(wc -l < docs/VISION.md)" -le 80 ]',
      owned,
    ),
    false,
    "a redirect operand is data",
  );
  // The broad reference detector still sees those reads — that is the log-note path.
  assert.equal(
    verificationIsWorkerAuthored(
      "grep -q 'failure_level: warn' docs/preview-playbook.yml",
      owned,
    ),
    true,
    "the reference detector still flags the read for the log note",
  );
  // Empty footprint → vacuously independent.
  assert.equal(
    verificationExecutesWorkerAuthored(
      "node --test out-test/feature.test.js",
      new Set<string>(),
    ),
    false,
    "with no worker-owned footprint nothing is a self-tick",
  );
});

test("dispatchSpec AC4: a signed probe that READS worker-owned files (a docs-spec grep) stays in the grade — the slice advances and the Spec commits (no TEP-13 deadlock)", async () => {
  // SL-1's worker owns the page the probe inspects. The probe only greps it — the verdict comes
  // from the server-signed command text, not from anything the worker authored — so it must grade.
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["docs/page.adoc"], // the worker owns the deliverable the probe reads
        satisfies: [1],
      },
    },
    {
      verifs: { "1": { run: "grep -q ':page-type:' docs/page.adoc" } },
      acPass: { 1: true },
    },
  );

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  assert.deepEqual(
    r.advanced,
    ["TEP-1_SP-1_SL-1"],
    "a read-only probe over the deliverable grades and advances the slice",
  );
  assert.deepEqual(calls.checked, [1], "the ordinal is checked");
  assert.equal(r.committed, true, "the Spec commits");
  assert.deepEqual(r.attention, [], "nothing requires-attention");
  assert.ok(
    calls.log.some((l) => /reads worker-owned files/i.test(l)),
    "the kept-in-grade read is surfaced in the log",
  );
});

test("verificationIsWorkerAuthored: a run reaching worker-owned footprint is a self-tick; a run reaching only (stripped) acceptance evidence is independent — empty footprint never self-ticks", () => {
  // Build `workerOwned` exactly as the closing gate does: the union of dispatched footprints with
  // held-out acceptance evidence stripped (`resolveFootprint` → never-in-footprint). This locks the
  // contract the gate consumes — the predicate that decides "the worker could have authored this."
  const owned = new Set(
    resolveFootprint([
      "src/feature.ts",
      "src/feature.test.ts",
      "tests/acceptance/sp6.test.ts", // held-out — must be stripped out of owned
    ]),
  );
  assert.ok(
    !owned.has("tests/acceptance/sp6.test.ts"),
    "the acceptance evidence is stripped from the worker-owned set (never-in-footprint)",
  );

  // A run that executes the worker's OWN (compiled) test resolves back to its `src/` source → self-tick.
  assert.equal(
    verificationIsWorkerAuthored("node --test out-test/feature.test.js", owned),
    true,
    "running the worker's own compiled test is a self-tick",
  );
  // A plain in-footprint source path → self-tick.
  assert.equal(
    verificationIsWorkerAuthored("npx tsx src/feature.ts", owned),
    true,
    "a run reaching an in-footprint source is a self-tick",
  );
  // A run that executes ONLY the held-out acceptance evidence → independent (it grades).
  assert.equal(
    verificationIsWorkerAuthored(
      "node --test out-test/acceptance/sp6.test.js",
      owned,
    ),
    false,
    "a run over only the out-of-footprint acceptance evidence is independent",
  );
  // No dispatched footprint at all → nothing can be a self-tick (vacuously independent).
  assert.equal(
    verificationIsWorkerAuthored(
      "node --test out-test/feature.test.js",
      new Set<string>(),
    ),
    false,
    "with no worker-owned footprint nothing is a self-tick",
  );
});

// ── SP-6/7 AC3: the independent assessor (assessment ACs) ──────────────────
// The one independent-judgment primitive: a fresh SDK session, never the implementing worker, that
// returns pass/fail WITH a rationale. Pure parse + prompt + the spawn path are unit-testable with a
// faked query — no live model.

test("SP-6/7 AC3: parseAssessment reads pass + rationale, tolerates a fence, fails safe on garbage", () => {
  assert.deepEqual(
    parseAssessment('{"pass": true, "rationale": "matches intent"}'),
    {
      pass: true,
      rationale: "matches intent",
    },
  );
  // Surrounding prose / a ```json fence still parses the last object.
  assert.deepEqual(
    parseAssessment(
      'here is my verdict:\n```json\n{"pass": false, "rationale": "regressed X"}\n```',
    ),
    { pass: false, rationale: "regressed X" },
  );
  // No parseable object → a FAIL (never a silent pass — the no-skip rule).
  const junk = parseAssessment("I think it is probably fine");
  assert.equal(junk.pass, false);
  assert.match(junk.rationale, /no parseable verdict/);
});

test("SP-6/7 AC3: buildAssessPrompt frames an INDEPENDENT judge over the AC intent + artifact", () => {
  const ac: AcVerification = { ac: 3, run: "", env: "assessment" };
  const p = buildAssessPrompt(
    ac,
    "the panel must feel responsive",
    "footprint: src/panel.ts",
  );
  assert.match(p, /INDEPENDENT/);
  assert.match(p, /did NOT implement/i);
  assert.match(p, /#3/);
  assert.match(p, /the panel must feel responsive/);
  assert.match(p, /footprint: src\/panel\.ts/);
  assert.match(p, /"pass"/); // asks for the JSON verdict shape
});

test("SP-6/7 AC3: createSdkAssessor dispatches a fresh session and returns its parsed verdict", async () => {
  const calls: { prompt: string; cwd: string }[] = [];
  const fakeQuery = (args: { prompt: string; options: { cwd: string } }) => {
    calls.push({ prompt: args.prompt, cwd: args.options.cwd });
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: '{"pass": true, "rationale": "intent satisfied"}',
        session_id: "assess-1",
      };
    })();
  };
  const assessAc = createSdkAssessor({
    cwd: "/worktree",
    loadQuery: async () => fakeQuery as never,
  });
  const verdict = await assessAc(
    { ac: 1, run: "", env: "assessment" },
    "AC 1 intent",
    "the delivered change",
  );
  assert.deepEqual(verdict, { pass: true, rationale: "intent satisfied" });
  assert.equal(
    calls.length,
    1,
    "dispatched exactly one fresh assessor session",
  );
  assert.equal(calls[0].cwd, "/worktree");
  assert.match(calls[0].prompt, /AC 1 intent/);
});

test("SP-6/7 AC3: createSdkAssessor fails safe when the session does not complete successfully", async () => {
  const fakeQuery = () =>
    (async function* () {
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
      };
    })();
  const assessAc = createSdkAssessor({
    cwd: "/worktree",
    loadQuery: async () => fakeQuery as never,
  });
  const verdict = await assessAc(
    { ac: 1, run: "", env: "assessment" },
    "x",
    "y",
  );
  assert.equal(verdict.pass, false);
  assert.match(verdict.rationale, /did not complete/);
});

test("SP-6/7 AC3: acTextByOrdinal maps 1-based ordinals to the AC prose", () => {
  const body = [
    "## Acceptance Criteria",
    "",
    "- [ ] first criterion holds",
    "- [x] second criterion holds",
    "",
    "## Design",
    "",
    "- not an AC",
  ].join("\n");
  const map = acTextByOrdinal(body);
  assert.equal(map.get(1), "first criterion holds");
  assert.equal(map.get(2), "second criterion holds");
  assert.equal(map.get(3), undefined, "the Design bullet is not an AC");
});

// ── SP-6/7 AC4: the grade counts a held-out probe, drops a code-author's own test ──

test("SP-6/7 AC4: a held-out acceptance/ probe counts; a code-author's own co-located test is dropped", () => {
  // The code-author's declared footprint — resolveFootprint strips the held-out acceptance/ path,
  // so it is NOT in the worker-owned set even if declared.
  const declared = [
    "src/foo.ts",
    "src/foo.test.ts",
    "acceptance/SP-6.foo.test.ts",
  ];
  const workerOwned = new Set(
    resolveFootprint(declared).map(normalizeFilePath),
  );

  // A verification that runs the code-author's OWN co-located test is worker-authored → dropped.
  assert.equal(
    verificationIsWorkerAuthored(
      "node --test out-test/foo.test.js",
      workerOwned,
    ),
    true,
    "a code-author's own co-located test can never tick an AC",
  );
  // A verification that runs ONLY the held-out acceptance/ probe is independent → counts.
  assert.equal(
    verificationIsWorkerAuthored(
      "node --test out-test/acceptance/SP-6.foo.test.js",
      workerOwned,
    ),
    false,
    "the held-out acceptance/ probe lies outside every code-author footprint, so it grades",
  );
});

// ── SP-6/7 AC4: a red acceptance run is judged + routed; AC5: the trace is persisted ──

test("SP-6/7 AC4: a red closing gate JUDGES the failure and routes the re-dispatch to that role", async () => {
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
    },
    { acPass: { 1: false }, fault: "test" }, // AC#1 red; judged a TEST fault
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  // The judge was consulted for the failing slice's unit.
  assert.equal(
    calls.judged.length,
    1,
    "the red slice's failure is judged once",
  );
  // The slice is requires-attention (re-dispatch route, not escalated — below the bound).
  assert.deepEqual(r.attention, ["TEP-1_SP-1_SL-1"]);
  assert.deepEqual(
    r.escalated,
    [],
    "a test fault below the bound re-dispatches, not escalates",
  );
  // The judged fault is surfaced on the diagnosis so a human/next-run sees the route.
  assert.ok(
    calls.attentionReasons.some((d) => /Judged fault: test/.test(d)),
    "the requires-attention diagnosis records the judged fault",
  );
  assert.equal(r.committed, false);
});

test("SP-6/7 AC4: an ambiguous (both) fault ESCALATES even below the attempt bound", async () => {
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
    },
    { acPass: { 1: false }, fault: "both" },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(calls.judged.length, 1);
  assert.deepEqual(
    r.escalated,
    ["TEP-1_SP-1_SL-1"],
    "a both/ambiguous fault escalates to a human on the first attempt",
  );
});

test("SP-6/7 AC5: the structured verification trace is persisted alongside DELIVERY.md and surfaced in it", async () => {
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
    },
    { acPass: { 1: false }, fault: "code" },
  );
  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // The trace is on the run result …
  assert.equal(r.verificationTrace.length, 1);
  assert.equal(r.verificationTrace[0].ac, 1);
  assert.equal(r.verificationTrace[0].verdict, "fail");
  assert.equal(
    r.verificationTrace[0].route,
    "code",
    "the judged route is recorded",
  );

  // … persisted as a durable JSON sibling of DELIVERY.md …
  const traceFile = path.join(
    calls.thinkubeDir,
    "teps/TEP-1/SP-1/VERIFICATION-TRACE.json",
  );
  assert.ok(fs.existsSync(traceFile), "VERIFICATION-TRACE.json is written");
  const persisted = JSON.parse(fs.readFileSync(traceFile, "utf8"));
  assert.equal(persisted[0].ac, 1);
  assert.equal(persisted[0].route, "code");

  // … and surfaced in the delivery report the panel renders.
  const deliveryFile = path.join(
    calls.thinkubeDir,
    "teps/TEP-1/SP-1/DELIVERY.md",
  );
  const md = fs.readFileSync(deliveryFile, "utf8");
  assert.match(md, /Verification trace/);
  assert.match(md, /code/);
});

test("SP-6/7 AC4: buildJudgePrompt frames an independent code-vs-test judge; parseJudgment is fail-safe", () => {
  const p = buildJudgePrompt(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "AC #1: $ probe → exit 1",
  );
  assert.match(p, /INDEPENDENT/);
  assert.match(p, /did NOT implement/i);
  assert.match(p, /did NOT author the test/i);
  assert.match(p, /"fault"/);

  // A clean verdict parses; an unparseable one fails safe to `both` (escalate), never a mis-route.
  assert.deepEqual(
    parseJudgment('{"fault":"test","rationale":"probe over-strict"}'),
    {
      fault: "test",
      rationale: "probe over-strict",
    },
  );
  assert.equal(parseJudgment("not json at all").fault, "both");
  assert.equal(parseJudgment('{"fault":"weird"}').fault, "both");
});

test("SP-6/7 AC4: createSdkJudge dispatches a fresh session and returns its parsed fault", async () => {
  const calls: { prompt: string; cwd: string }[] = [];
  const fakeQuery = (args: { prompt: string; options: { cwd: string } }) => {
    calls.push({ prompt: args.prompt, cwd: args.options.cwd });
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: '{"fault":"code","rationale":"the implementation diverged"}',
      };
    })();
  };
  const judge = createSdkJudge({
    cwd: "/worktree",
    loadQuery: async () => fakeQuery as never,
  });
  const verdict = await judge(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "the probe went red",
  );
  assert.deepEqual(verdict, {
    fault: "code",
    rationale: "the implementation diverged",
  });
  assert.equal(calls.length, 1, "dispatched exactly one fresh judge session");
  assert.equal(calls[0].cwd, "/worktree");
});

test("SP-6/7 AC4: createSdkJudge fails safe to `both` when the session does not complete", async () => {
  const fakeQuery = () =>
    (async function* () {
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
      };
    })();
  const judge = createSdkJudge({
    cwd: "/worktree",
    loadQuery: async () => fakeQuery as never,
  });
  const verdict = await judge(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1" },
    "x",
  );
  assert.equal(verdict.fault, "both");
  assert.match(verdict.rationale, /did not complete/);
});

// ── SP-6/9: contract-aware fault triangulation ─────────────────────────────
// The judge triangulates a red against the slice's CONTRACT (the arbiter), can return a `contract`
// verdict, and a `contract` route writes a CONTRACT_DEFECT_MARKER diagnosis + re-cut direction WITHOUT
// burning a rework attempt (the slice was never the problem).

test("SP-6/9: buildJudgePrompt embeds the contract VERBATIM and instructs TRIANGULATION", () => {
  const contract =
    "export function arm(token: ArmToken): void; // sets the ARMED flag in the store";
  const p = buildJudgePrompt(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "AC #1: $ probe → exit 1",
    contract,
  );
  // The contract text is present verbatim (it is the arbiter — a paraphrase would not do).
  assert.ok(p.includes(contract), "the contract is embedded verbatim");
  // The prompt instructs triangulation (case-insensitive substring).
  assert.ok(/TRIANGULATE/i.test(p), "the prompt instructs triangulation");
  // The `contract` verdict is offered as an option.
  assert.match(p, /`contract`/);
  // Judge each hand against the contract, NOT by comparing the two hands to each other.
  assert.match(p, /comparing the two hands/i);
});

test("SP-6/9: buildJudgePrompt with a blank/undefined contract notes none was supplied and omits the verbatim block", () => {
  const blank = buildJudgePrompt(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "probe red",
    "   ",
  );
  const undef = buildJudgePrompt(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "probe red",
  );
  for (const p of [blank, undef]) {
    assert.match(p, /No contract was supplied/i);
    assert.ok(
      !p.includes("SLICE CONTRACT"),
      "the verbatim contract block is omitted when there is no contract",
    );
    // TRIANGULATE still appears in the static rubric.
    assert.ok(/TRIANGULATE/i.test(p));
  }
});

test("SP-6/9: parseJudgment recognizes a `contract` verdict, keeping the fail-safe default of `both`", () => {
  assert.deepEqual(
    parseJudgment('{"fault":"contract","rationale":"undefined arming seam"}'),
    { fault: "contract", rationale: "undefined arming seam" },
  );
  // Verdict-key form is recognized too.
  assert.equal(parseJudgment('{"verdict":"contract"}').fault, "contract");
  // Still fail-safe: an unrecognised fault → `both` (escalate), never a silent mis-route.
  assert.equal(parseJudgment('{"fault":"nonsense"}').fault, "both");
  assert.equal(parseJudgment("garbage").fault, "both");
});

test("SP-6/9: createSdkJudge forwards its contract argument to buildJudgePrompt", async () => {
  const contract = "MARKER_CONTRACT_TEXT: the shared seam every hand builds to";
  let capturedPrompt = "";
  const fakeQuery = (args: { prompt: string; options: { cwd: string } }) => {
    capturedPrompt = args.prompt;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result:
          '{"fault":"contract","rationale":"both conform; seam undefined"}',
      };
    })();
  };
  const judge = createSdkJudge({
    cwd: "/worktree",
    loadQuery: async () => fakeQuery as never,
  });
  const verdict = await judge(
    { id: "SP-1_SL-1#eu-0", slice: "SP-1_SL-1", role: "code" },
    "the probe went red",
    contract,
  );
  assert.equal(verdict.fault, "contract");
  assert.ok(
    capturedPrompt.includes(contract),
    "the live session's prompt carries the forwarded contract verbatim",
  );
});

test("SP-6/9: a `contract`-routed red gate writes CONTRACT_DEFECT_MARKER, threads the contract to the judge, and burns NO attempt", async () => {
  const CONTRACT_TEXT =
    "export const ARMED_KEY: string; // where the armed state lives";
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
        contract: CONTRACT_TEXT,
      },
    },
    { acPass: { 1: false }, fault: "contract" },
  );
  // Capture the contract the judge is handed + the escalation attempts persisted to the slice.
  let judgeContract: string | undefined = "SENTINEL";
  deps.judgeFailure = async (unit, _failure, contract) => {
    calls.judged.push(unit.id);
    judgeContract = contract;
    return {
      fault: "contract",
      rationale: "both hands conform; ARMED seam undefined",
    };
  };
  let persistedAttempts: number | undefined;
  deps.flagAttention = async (h, diagnosis, escalation) => {
    calls.attention.push(h);
    calls.attentionReasons.push(diagnosis);
    persistedAttempts = escalation?.attempts;
  };

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // The slice's contract reached the judge (triangulation arbiter).
  assert.equal(
    judgeContract,
    CONTRACT_TEXT,
    "runClosingGate threads the red slice's contract into the judge call",
  );
  // The requires-attention diagnosis leads with the contract-defect marker + a re-cut direction.
  const diag = calls.attentionReasons.find((d) =>
    d.includes(CONTRACT_DEFECT_MARKER),
  );
  assert.ok(diag, "the diagnosis carries CONTRACT_DEFECT_MARKER");
  assert.match(diag!, /re-cut the contract/i);
  assert.match(diag!, /update_slice contract/i);
  // No rework attempt was burned — the prior count (0) is persisted unchanged.
  assert.equal(
    persistedAttempts,
    0,
    "a contract defect does not burn a rework attempt",
  );
  // The route is recorded on the verification trace, and the slice is held (not committed).
  assert.equal(r.verificationTrace[0]?.route, "contract");
  assert.equal(r.committed, false);
  assert.ok(r.attention.includes("TEP-1_SP-1_SL-1"));
});

// ── SP-11/3: human-first delivery report — diagnosis / AC text / discoveries wiring ─────────
//
// The orchestrator (a) keeps the judge's UNCLIPPED per-AC rationale on the run result and passes it to
// the report builder as `diagnosis`, (b) passes the Spec's criterion lines as `acTexts`, and (c) mines
// each unit's final output for a trailing `## Discoveries` block (via `extractDiscoveries`), pairing
// each finding with its unit id. All three land in DELIVERY.md.
test("SP-11/3: the closing gate carries the judge's UNCLIPPED diagnosis, the AC criterion text, and workers' discoveries into DELIVERY.md", async () => {
  const longRationale = (
    "JUDGED-MECHANISM: " +
    "the held-out probe asserts a shape the contract never defined. ".repeat(12)
  ).trim();
  const specBody =
    "## Acceptance Criteria\n\n" +
    "- [ ] The gate keeps the judge's full rationale in the report\n";
  const { deps, calls } = makeDeps(
    {
      "teps/TEP-1/SP-1/SL-1.md": {
        status: "ready",
        files: ["src/a.ts"],
        satisfies: [1],
      },
    },
    {
      acPass: { 1: false }, // a red AC → the judge fires and the report is a failure
      run: async () => ({
        outcome: "success",
        finalOutput:
          "All done.\n\n## Discoveries\n" +
          "- The neighbouring helper `foo` has an unrelated off-by-one\n" +
          "- Config `bar.json` is stale\n",
      }),
    },
  );
  // Give the spec doc a real body so `acTextByOrdinal` yields the criterion line (makeDeps returns "").
  const baseGetFile = deps.store.getFile.bind(deps.store);
  deps.store.getFile = (async (rel: string) => {
    const f = await baseGetFile(rel);
    return rel === SPEC_DOC && f ? { ...f, body: specBody } : f;
  }) as typeof deps.store.getFile;
  // A judge whose rationale is far longer than the audit trace's clip — the report must keep it whole.
  deps.judgeFailure = async () => ({ fault: "code", rationale: longRationale });

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);
  assert.equal(r.committed, false, "a red AC blocks the commit");
  assert.ok(r.deliveryDoc, "a delivery report is written");
  const unitId = r.results[0]!.id;
  const report = fs.readFileSync(
    path.join(calls.thinkubeDir, r.deliveryDoc!),
    "utf8",
  );

  // (1) the judge's rationale survives VERBATIM — the trace-table clip did not eat it.
  assert.ok(
    report.includes(longRationale),
    "the full, unclipped judge rationale is in the report",
  );
  // (2) the AC row carries the criterion's TEXT, not just its ordinal.
  assert.ok(
    report.includes("The gate keeps the judge's full rationale in the report"),
    "the AC row carries the criterion text",
  );
  // (3) both discoveries are surfaced verbatim, and the finding names its reporting unit.
  assert.ok(
    report.includes("unrelated off-by-one") &&
      report.includes("Config `bar.json` is stale"),
    "the workers' discoveries are surfaced verbatim",
  );
  assert.ok(
    report.includes(unitId),
    "a discovery is paired with its reporting unit id",
  );
});

// SP-11/3 fault-test rework routing: on a rework round (the slice body carries the judge's diagnosis
// under `## ⚑ Requires attention`), OrchestratorService appends `buildTestReworkContext`'s result —
// the diagnosis verbatim — to the `role: "test"` re-author's prompt ONLY. The code author's prompt is
// untouched (full redaction kept: `buildTestReworkContext` returns undefined for route "code").
test("SP-11/3 rework routing: a role:test re-author's prompt gets the judged mechanism; the code author's is untouched", async () => {
  const diagnosis =
    "JUDGE: the held-out probe pins an internal detail the contract never named — rewrite the check.";
  const slice = "TEP-1_SP-1_SL-1";
  const sliceBody = `Some slice intent.\n\n## ⚑ Requires attention\n\n${diagnosis}\n`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tk-rework-"));

  const capturePromptFor = async (role: "code" | "test"): Promise<string> => {
    const { deps } = makeDeps({});
    const svc = new OrchestratorService(deps) as unknown as {
      promptCtx: { specBody: string; sliceBodies: Map<string, string> };
      runViaSdk: (
        u: SchedUnit,
        s: string,
        c: string,
        p: OnPark,
      ) => Promise<WorkerResult>;
    };
    // Seed promptCtx exactly as loadPromptContext would after a red round: the reworking slice body
    // carries the judge's diagnosis under `## ⚑ Requires attention`.
    svc.promptCtx = {
      specBody: "",
      sliceBodies: new Map([[slice, sliceBody]]),
    };
    const captured = { text: "" };
    deps.sdkQuery = ({ prompt }) => {
      async function* gen(): AsyncGenerator<unknown> {
        for await (const m of prompt as AsyncIterable<unknown>) {
          const content = (m as { message?: { content?: unknown } }).message
            ?.content;
          if (typeof content === "string") captured.text = content;
          break; // the first user message IS the worker prompt
        }
        yield { type: "assistant", session_id: "cap" };
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "ok",
          session_id: "cap",
        };
      }
      return gen();
    };
    const unit: SchedUnit = {
      id: `${slice}#eu-0`,
      slice,
      footprint: role === "test" ? ["acceptance/x.test.ts"] : ["src/x.ts"],
      requires: [],
      shape: "fan-out",
      role,
    };
    await svc.runViaSdk(unit, "1/1", cwd, () => {});
    return captured.text;
  };

  const testPrompt = await capturePromptFor("test");
  const codePrompt = await capturePromptFor("code");
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  assert.ok(
    testPrompt.includes(diagnosis),
    "the test re-author's prompt carries the judge's diagnosis",
  );
  // Both prompts embed the slice body once; ONLY the test prompt appends buildTestReworkContext's
  // result — so the diagnosis appears exactly one MORE time for the test author than the code author.
  assert.equal(
    count(testPrompt, diagnosis),
    count(codePrompt, diagnosis) + 1,
    "buildTestReworkContext is appended for the test author and NOTHING is added for the code author",
  );
});
