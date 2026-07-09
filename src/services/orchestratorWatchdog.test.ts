/**
 * Finalization-watchdog integration test (SP-th4wqc_SL-2 / TEP-th3i18 #11).
 *
 * AC#3: a run where **every execution unit lands** but the **finalize step is suppressed** (no real
 * commit SHA, no DELIVERY.md on disk) must surface `Requires-attention` carrying a diagnosis that
 * names "units done but run never finalized" — proving the watchdog is **wired into the real
 * `dispatchSpec`**, not merely a pure verdict checked in isolation.
 *
 * It drives the actual `OrchestratorService.dispatchSpec` through the injected `OrchestratorDeps`
 * fakes (store / arbiter / worktrees / runUnit / runAcVerifications / advance / commit) — no live
 * Agent SDK, no live git, no vscode — and arranges the **finalize markers to be genuinely absent**:
 *
 *   • the worktree path the shell asks `git rev-parse` against does NOT exist → its short SHA is "";
 *   • the store has no `thinkubeDir` → `writeDeliverySummary` throws and writes no report.
 *
 * Every unit still lands and the all-green closing gate still advances the slice + records a commit,
 * so the run reaches a *clean quiescence* (no attention / needs-input mid-run) — exactly the state in
 * which `finalizationVerdict` is consulted. With both finalize markers missing it returns `{ wedged }`,
 * and the shell flags the landed slice `requires-attention`, un-sets `committed`, and surfaces the
 * diagnosis. The assertion is made **via the imported `FINALIZATION_WEDGED_DIAGNOSIS` constant**
 * (never a hand-copied string), so the message and its test can never silently diverge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OrchestratorService,
  type OrchestratorDeps,
} from "./OrchestratorService";
import { FINALIZATION_WEDGED_DIAGNOSIS } from "./orchestratorCore";

/** A worktree path that does NOT exist, so the shell's `git rev-parse --short HEAD` errors and the
 *  committed-SHA finalize marker resolves to "" — one of the two suppressed markers this test needs. */
const NONEXISTENT_WORKTREE = "/tmp/sp-th4wqc-watchdog-no-such-worktree";

interface CapturedCalls {
  /** [handle, diagnosis] for each requires-attention flag the shell raised. */
  attentionFlags: { handle: string; diagnosis: string }[];
  advanced: string[];
  committed: number;
  torndown: string[];
}

/**
 * Build `OrchestratorDeps` for the wedge scenario: one ready slice whose single unit lands (success)
 * and whose satisfied AC verifies green — but with the two finalize markers SUPPRESSED so the wired
 * watchdog must fire. `thinkubeDir` is intentionally absent (no DELIVERY.md) and the worktree path is
 * non-existent (no real commit SHA).
 */
function makeWedgeDeps(): { deps: OrchestratorDeps; calls: CapturedCalls } {
  const calls: CapturedCalls = {
    attentionFlags: [],
    advanced: [],
    committed: 0,
    torndown: [],
  };

  const SPEC_DOC = "teps/TEP-1/SP-1/spec.md";
  const SLICE_DOC = "teps/TEP-1/SP-1/SL-1.md";
  // The lone ready slice: one unit-less (legacy) footprint, satisfying AC #1.
  const sliceFm = { status: "ready", files: ["src/a.ts"], satisfies: [1] };

  const deps: OrchestratorDeps = {
    store: {
      listSlices: async () => [SLICE_DOC],
      getFile: async (rel: string) =>
        rel === SPEC_DOC
          ? {
              // The closing gate's declaration: AC #1 has a verification (so the gate can RUN and
              // pass — the run reaches a clean, "finalize-believed" quiescence rather than pausing).
              frontmatter: {
                ac_verifications: { "1": { run: "verify-AC-1" } },
              },
              body: "",
              raw: "",
            }
          : { frontmatter: sliceFm, body: "", raw: "" },
      sliceHandle: (spec: string, n: number) => {
        const [t, s] = spec.split("/");
        return `TEP-${t}_SP-${s}_SL-${n}`;
      },
      pathForSpecDoc: () => SPEC_DOC,
      // NOTE: no `thinkubeDir` — `writeDeliverySummary` will throw and write no DELIVERY.md
      // (the second suppressed finalize marker).
    } as unknown as OrchestratorDeps["store"],
    arbiter: {
      acquire: async () => ({ ok: true as const, state: {}, acquired: [] }),
      release: async () => {},
    } as unknown as OrchestratorDeps["arbiter"],
    worktrees: {
      // A non-existent worktree → `git rev-parse` errors → committed SHA "" (first suppressed marker).
      create: async () => NONEXISTENT_WORKTREE,
    } as unknown as OrchestratorDeps["worktrees"],
    output: {
      appendLine: () => {},
    } as unknown as OrchestratorDeps["output"],
    canonicalRepo: "/repo",
    // SP-17/1: OrchestratorDeps now REQUIRES a worker-model config (the decoupled worker model
    // source). Supply the default so this construction compiles.
    workerModel: { workerModel: "sonnet" },
    // Every unit lands: the worker seam resolves success.
    runUnit: async () => ({ outcome: "success" as const }),
    // The closing gate runs green for the declared AC, so the slice advances and the run BELIEVES
    // it finalized — the precondition for the watchdog to treat a missing marker as a real wedge.
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
    flagAttention: async (handle: string, diagnosis: string) => {
      calls.attentionFlags.push({ handle, diagnosis });
    },
    flagNeedsInput: async () => {},
    commit: async () => {
      // The shell calls commit (workers never do); but no real git stands behind it, so there is no
      // commit SHA — the watchdog catches that the finalize did not actually land.
      calls.committed++;
    },
    teardown: async (n: string) => {
      calls.torndown.push(n);
    },
  };
  return { deps, calls };
}

test("dispatchSpec: units all land but finalize is suppressed → watchdog surfaces requires-attention with the wedge diagnosis", async () => {
  const { deps, calls } = makeWedgeDeps();

  const r = await new OrchestratorService(deps).dispatchSpec("1/1", 4);

  // Precondition — every execution unit landed (the "units done" half of the wedge).
  assert.equal(r.dispatched, 1, "the lone unit was dispatched");
  assert.deepEqual(
    r.results.map((x) => x.outcome),
    ["success"],
    "the unit landed (success)",
  );

  // The run never truly finalized: no real commit SHA + no DELIVERY.md on disk.
  assert.equal(
    r.committed,
    false,
    "the watchdog un-sets `committed` — the run never finalized",
  );
  assert.equal(
    r.deliveryDoc,
    undefined,
    "no DELIVERY.md was written (finalize marker suppressed)",
  );

  // The watchdog surfaced Requires-attention for the landed slice.
  assert.deepEqual(
    r.attention,
    ["TEP-1_SP-1_SL-1"],
    "the landed-but-unfinalized slice is flagged requires-attention",
  );

  // The diagnosis names the wedge — asserted VIA the imported constant, never a hardcoded copy,
  // so the surfaced message and this assertion can never silently diverge.
  const flag = calls.attentionFlags.find((f) => f.handle === "TEP-1_SP-1_SL-1");
  assert.ok(flag, "the slice was flagged with a diagnosis");
  assert.ok(
    flag!.diagnosis.includes(FINALIZATION_WEDGED_DIAGNOSIS),
    `diagnosis should name the wedge ("${FINALIZATION_WEDGED_DIAGNOSIS}"), got: ${flag!.diagnosis}`,
  );

  // A wedged run keeps its worktree (no teardown) for the human's re-run / inspection.
  assert.deepEqual(
    calls.torndown,
    [],
    "a wedged Spec is NOT torn down — its worktree is kept",
  );
});
