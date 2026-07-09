/**
 * Atomic, resumable per-slice commit integration test (SP-th4wqc_SL-3 / TEP-th3i18 #9).
 *
 * AC#4 drives the **real** `OrchestratorService.dispatchSpec` through injected `OrchestratorDeps`
 * fakes (store / arbiter / worktrees / runUnit / runAcVerifications / advance / commit /
 * rollbackToReady) — no live Agent SDK, no live git, no vscode — to pin the two commit invariants
 * the pure `commitPlan` / `resumeDecision` (orchestratorCore.ts) exist to serve:
 *
 *   1. **No sticky Done.** With a fake git that FAILS one slice's commit, no slice ends `Done` with
 *      uncommitted work: every slice whose commit succeeded advances (Done), the slice whose commit
 *      threw is rolled back to `ready` (re-runnable, NOT Done), and the whole-Spec `committed` flag
 *      stays false. Asserted as the invariant `r.advanced ⊆ { handles whose commit actually
 *      succeeded }`, plus the failed slice landing in `r.rolledBack`.
 *
 *   2. **Resume, don't re-author.** A re-run over a slice SEEDED complete-but-uncommitted
 *      (`units_landed: true`, not yet committed/Done) COMMITS it WITHOUT re-running its workers —
 *      the spy `runUnit` is never called for that slice's units. This is the
 *      `resumeDecision(state) === 'commit'` path wired into `dispatchSpec`.
 *
 * The shell's contract (the producer side of this slice consumes the pure `commitPlan` /
 * `resumeDecision` from orchestratorCore.ts and wires them here):
 *   • `commit(handle, specNumber, cwd)` is invoked **once per committable slice handle**
 *     (commit-before-Done). A commit that **throws** is treated as a rollback — that slice is rolled
 *     back to `ready` (`result.rolledBack`) and does NOT reach Done; only commit-succeeded slices
 *     advance.
 *   • A slice carrying `units_landed: true` (work already present, not yet committed) is RESUMED on
 *     a (re-)run — committed without re-authoring — never re-dispatched to a worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
  type WorkerResult,
} from "./OrchestratorService";

type RunUnit = NonNullable<OrchestratorDeps["runUnit"]>;

interface FakeFile {
  status?: string;
  depends_on?: string[];
  files?: string[];
  satisfies?: number[];
  work_units?: { footprint: string[]; execution: string; note?: string }[];
  /** Resume marker (SL-3): this slice's units already landed but were never committed. */
  units_landed?: boolean;
}
type FakeFiles = Record<string, FakeFile>;

const SPEC_DOC = "teps/TEP-1/SP-1/spec.md";

interface Calls {
  /** Slice handles passed to `commit` whose commit ACTUALLY succeeded (no throw). */
  committedOk: string[];
  /** Every slice handle `commit` was invoked for (attempted, incl. the one that threw). */
  committedAttempt: string[];
  /** Execution-unit ids the `runUnit` worker seam was actually dispatched for. */
  ranUnits: string[];
  advanced: string[];
  rolledBack: string[];
  attention: string[];
  log: string[];
}

/**
 * Build `OrchestratorDeps` over `files`. `commitFailFor` makes the fake git **throw** for that
 * slice handle's commit (the AC4 "fake git fails one slice's commit"); every other commit
 * succeeds. `runUnit` is a spy that records each dispatched unit id (and returns success), so the
 * resume test can assert it is NEVER called for an already-landed slice.
 */
function makeDeps(
  files: FakeFiles,
  opts: { commitFailFor?: string } = {},
): { deps: OrchestratorDeps; calls: Calls } {
  const calls: Calls = {
    committedOk: [],
    committedAttempt: [],
    ranUnits: [],
    advanced: [],
    rolledBack: [],
    attention: [],
    log: [],
  };

  // Declare a passing per-AC verification for every AC any slice satisfies (default #1) so the
  // closing gate runs green — isolating THIS test to the commit/resume behaviour, not the gate.
  const allSatisfies = [
    ...new Set(Object.values(files).flatMap((f) => f.satisfies ?? [])),
  ].sort((a, b) => a - b);
  const specVerifs: Record<string, { run: string }> = {};
  for (const n of allSatisfies.length ? allSatisfies : [1])
    specVerifs[String(n)] = { run: `verify-AC-${n}` };

  const spyRun: RunUnit = async (unit) => {
    calls.ranUnits.push(unit.id);
    return { outcome: "success" as const } as WorkerResult;
  };

  const deps: OrchestratorDeps = {
    store: {
      listSlices: async () =>
        Object.keys(files).filter((k) => /\/SL-\d+\.md$/.test(k)),
      getFile: async (rel: string) =>
        rel === SPEC_DOC
          ? {
              frontmatter: { ac_verifications: specVerifs },
              body: "",
              raw: "",
            }
          : { frontmatter: files[rel], body: "", raw: "" },
      sliceHandle: (spec: string, n: number) => {
        const [t, s] = spec.split("/");
        return `TEP-${t}_SP-${s}_SL-${n}`;
      },
      pathForSpecDoc: () => SPEC_DOC,
      pathForSlice: (spec: string, n: number) => {
        const [t, s] = spec.split("/");
        return `teps/TEP-${t}/SP-${s}/SL-${n}.md`;
      },
      writeFile: async () => {},
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async () => ({ ok: true as const, state: {}, acquired: [] }),
      release: async () => {},
    } as unknown as OrchestratorDeps["arbiter"],
    worktrees: {
      create: async () => "/tmp/wt/TEP-1_SP-1",
    } as unknown as OrchestratorDeps["worktrees"],
    output: {
      appendLine: (l: string) => calls.log.push(l),
    } as unknown as OrchestratorDeps["output"],
    canonicalRepo: "/repo",
    // SP-17/1: OrchestratorDeps now REQUIRES a worker-model config (the decoupled worker model
    // source). Supply the default so this construction compiles.
    workerModel: { workerModel: "sonnet" },
    runUnit: spyRun,
    runAcVerifications: async (verifs) =>
      verifs.map((v) => ({
        ac: v.ac,
        pass: true,
        evidence: `$ ${v.run} → exit 0`,
      })),
    checkAcs: async () => {},
    advance: async (h: string) => {
      calls.advanced.push(h);
    },
    flagAttention: async (h: string) => {
      calls.attention.push(h);
    },
    flagNeedsInput: async () => {},
    // Per-slice commit (SL-3): the shell passes the slice `handle` FIRST, then specNumber + cwd,
    // once per committable slice. A throw is the fake git failing that slice's commit → the shell
    // must roll it back (NOT advance it to Done).
    commit: async (handle: string, _specNumber: string, _cwd: string) => {
      calls.committedAttempt.push(handle);
      if (opts.commitFailFor !== undefined && handle === opts.commitFailFor)
        throw new Error(`fake git: commit failed for ${handle}`);
      calls.committedOk.push(handle);
    },
    rollbackToReady: async (handle: string) => {
      calls.rolledBack.push(handle);
    },
    teardown: async () => {},
  };
  return { deps, calls };
}

test("dispatchSpec: a fake git failing one slice's commit leaves NO slice Done with uncommitted work (passed → committed+Done, failed → rolled back to ready)", async () => {
  // Two independent ready slices (disjoint footprints), each satisfying a distinct, green AC, so
  // BOTH are gate-eligible to commit-then-Done. The fake git then fails TEP-1_SP-1_SL-2's commit only.
  const FAIL = "TEP-1_SP-1_SL-2";
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
    { commitFailFor: FAIL },
  );

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // Both units landed and the gate was green, so the shell ATTEMPTED to commit both slices
  // (commit-before-Done is per slice — never a single whole-Spec commit).
  assert.deepEqual(
    [...calls.committedAttempt].sort(),
    ["TEP-1_SP-1_SL-1", "TEP-1_SP-1_SL-2"],
    "commit is attempted once per gate-green slice (per-slice, commit-before-Done)",
  );

  // Only TEP-1_SP-1_SL-1's commit succeeded; TEP-1_SP-1_SL-2's threw.
  assert.deepEqual(
    calls.committedOk,
    ["TEP-1_SP-1_SL-1"],
    "only the slice whose commit did not throw is actually committed",
  );

  // THE INVARIANT — no slice ends Done with uncommitted work: every advanced (Done) slice is one
  // whose commit actually succeeded.
  const committedOk = new Set(calls.committedOk);
  for (const h of r.advanced)
    assert.ok(
      committedOk.has(h),
      `slice ${h} reached Done but its commit never succeeded — sticky-Done lie`,
    );

  // The passed slice is committed-then-Done; the failed one is NOT Done — it is rolled back to
  // `ready` so a later run re-attempts (or resumes) it.
  assert.deepEqual(
    r.advanced,
    ["TEP-1_SP-1_SL-1"],
    "only the committed slice is Done",
  );
  assert.ok(
    !r.advanced.includes(FAIL),
    "the commit-failed slice must NOT be Done",
  );
  assert.deepEqual(
    r.rolledBack,
    [FAIL],
    "the commit-failed slice is rolled back to ready (re-runnable)",
  );

  // The whole-Spec commit flag stays false while any slice is uncommitted.
  assert.equal(
    r.committed,
    false,
    "the Spec is not wholesale-committed while a slice's commit failed",
  );
});

test("dispatchSpec: a re-run over a seeded complete-but-uncommitted slice COMMITS it without re-authoring (spy runUnit not called for it)", async () => {
  // The slice is seeded complete-but-uncommitted: `units_landed: true`, two fan-out work units that
  // a naive run WOULD dispatch as two workers. Status is not Done, so it is eligible to finalize.
  const { deps, calls } = makeDeps({
    "teps/TEP-1/SP-1/SL-1.md": {
      status: "ready",
      units_landed: true,
      satisfies: [1],
      work_units: [
        { footprint: ["src/a.ts"], execution: "fan-out", note: "do a" },
        { footprint: ["src/b.ts"], execution: "fan-out", note: "do b" },
      ],
    },
  });

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // RESUME, not re-author: the worker seam is never dispatched for the already-landed slice's units.
  assert.deepEqual(
    calls.ranUnits,
    [],
    "runUnit must NOT be called for a complete-but-uncommitted slice on a re-run",
  );
  assert.equal(
    r.dispatched,
    0,
    "no worker is dispatched — the work is already present, only the commit was missing",
  );

  // It is COMMITTED on the re-run (the missing finalize marker is supplied) and reaches Done.
  assert.ok(
    calls.committedOk.includes("TEP-1_SP-1_SL-1"),
    "the resumed slice's commit is applied on the re-run",
  );
  assert.deepEqual(
    r.advanced,
    ["TEP-1_SP-1_SL-1"],
    "the resumed-and-committed slice reaches Done",
  );
  assert.equal(r.committed, true, "the Spec finalizes once the resume commits");
  assert.deepEqual(r.rolledBack, [], "a clean resume rolls nothing back");
});
