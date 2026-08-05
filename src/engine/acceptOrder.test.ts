/**
 * Unit tests for the extracted accept ordering driver (SP-th4wqe_SL-1 / #10-residual).
 * node:test + node:assert; run via `npm test`.
 *
 * Background. Accept currently inlines the same `merge → stamp → retire` sequence in two
 * places — `commands/thinkingSpaces.ts` (`onAcceptSpec`, the kanban-panel accept button) and
 * `commands/orchestrate.ts` (`thinkube.accept`, the delivery-report surface). Both:
 *   1. `mergeSpecPr(...)`            — merge the Spec's PR (no-op for a straight-to-main Spec),
 *   2. stamp `accepted:` on the Spec — only after the merge call returns (never stamp a Spec
 *                                      whose branch is still open),
 *   3. retire the worktree           — only when `merge.merged`, and *best-effort*: a retire
 *                                      failure is folded into a note, never thrown, because the
 *                                      Spec is already merged + stamped (acceptLand.ts).
 *
 * This slice extracts that into the injectable `acceptOrder({ merge, stamp, retire })` so the
 * ordering + idempotence invariants are unit-testable without `gh`/`git`/the network, and the
 * two call sites dispatch through it. These tests drive that seam with **recording fakes** — a
 * shared call log proves the order and presence/absence of each step.
 *
 * The contract under test lives in `./acceptOrder` (owned by the implementation unit):
 *   - `acceptOrder(steps)` runs `merge → stamp → retire`.
 *   - `merge` throwing aborts (no stamp, no retire) and rejects the accept.
 *   - `stamp(merge)` always runs after a resolved merge.
 *   - `retire(merge)` runs **iff** `merge.merged`; its rejection is captured in
 *     `result.retireError`, never propagated — a landed accept is a success even when the
 *     worktree was already gone (already-merged / branch-gone ⇒ no zombie-worktree failure).
 *   - `result` is `{ ok: true, merge, retire?, retireError? }`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  acceptOrder,
  AcceptOrderSteps,
  AcceptMergeResult,
} from "./acceptOrder";

/** A merge result shaped like the real `mergeSpecPr` (extra fields ride through untouched). */
interface FakeMerge extends AcceptMergeResult {
  branch: string;
}
/** The retire outcome, mirroring `WorktreeService.retireAfterAccept`. */
type RetireOutcome = "retired" | "deferred" | "absent";

/**
 * Build recording fakes over a shared call log. Each step pushes its name on entry, so the log
 * is the literal call order; the merge result is threaded to `stamp`/`retire` and recorded so a
 * test can assert it was passed through. Per-step behaviour is overridable to pin one scenario.
 */
function fakes(
  over: {
    merged?: boolean;
    mergeThrows?: Error;
    retire?: RetireOutcome;
    retireThrows?: Error;
  } = {},
): {
  steps: AcceptOrderSteps<FakeMerge, RetireOutcome>;
  log: string[];
  stampedWith: FakeMerge[];
  retiredWith: FakeMerge[];
} {
  const log: string[] = [];
  const stampedWith: FakeMerge[] = [];
  const retiredWith: FakeMerge[] = [];
  const steps: AcceptOrderSteps<FakeMerge, RetireOutcome> = {
    merge: async () => {
      log.push("merge");
      if (over.mergeThrows) throw over.mergeThrows;
      return { merged: over.merged ?? false, branch: "spec/SP-th4wqe" };
    },
    stamp: async (m) => {
      log.push("stamp");
      stampedWith.push(m);
    },
    retire: async (m) => {
      log.push("retire");
      retiredWith.push(m);
      if (over.retireThrows) throw over.retireThrows;
      return over.retire ?? "retired";
    },
  };
  return { steps, log, stampedWith, retiredWith };
}

test("merge merged → full sequence merge → stamp → retire, in order", async () => {
  const { steps, log } = fakes({ merged: true, retire: "retired" });
  const res = await acceptOrder(steps);
  assert.deepEqual(log, ["merge", "stamp", "retire"]);
  assert.equal(res.ok, true);
  assert.equal(res.merge.merged, true);
  assert.equal(res.retire, "retired");
  assert.equal(res.retireError, undefined);
});

test("merge did NOT merge → retire is absent from the call log (straight-to-main)", async () => {
  const { steps, log } = fakes({ merged: false });
  const res = await acceptOrder(steps);
  // The defining invariant: no retire unless merge reported merged. Stamp still runs.
  assert.deepEqual(log, ["merge", "stamp"]);
  assert.ok(!log.includes("retire"), "retire must not run when nothing merged");
  assert.equal(res.ok, true);
  assert.equal(res.merge.merged, false);
  assert.equal(res.retire, undefined);
  assert.equal(res.retireError, undefined);
});

test("stamp runs after merge resolves and receives the merge result", async () => {
  const { steps, log, stampedWith } = fakes({ merged: true });
  await acceptOrder(steps);
  assert.ok(
    log.indexOf("merge") < log.indexOf("stamp"),
    "merge must complete before the accepted: stamp is written",
  );
  assert.equal(stampedWith.length, 1);
  assert.equal(stampedWith[0].merged, true);
});

test("a retire that throws still resolves the accept as success (best-effort cleanup)", async () => {
  const boom = new Error("worktree remove failed: uncommitted changes");
  const { steps, log } = fakes({ merged: true, retireThrows: boom });
  // Must NOT reject — the Spec is already merged + stamped; cleanup must never fail the accept.
  const res = await acceptOrder(steps);
  assert.equal(res.ok, true);
  assert.equal(res.merge.merged, true);
  assert.equal(res.retire, undefined, "no retire value on a failed retire");
  assert.equal(
    res.retireError,
    boom,
    "the swallowed failure is surfaced, not thrown",
  );
  // The retire was still attempted (after the stamp), it just failed.
  assert.deepEqual(log, ["merge", "stamp", "retire"]);
});

test("already-merged / branch-gone → success, no zombie-worktree failure", async () => {
  // The Spec's branch was already merged/deleted out-of-band: merge still reports merged, and
  // retire finds the worktree gone ("absent"). This must be a clean success, not an error.
  const { steps } = fakes({ merged: true, retire: "absent" });
  const res = await acceptOrder(steps);
  assert.equal(res.ok, true);
  assert.equal(res.merge.merged, true);
  assert.equal(res.retire, "absent");
  assert.equal(res.retireError, undefined);
});

test("retire deferred (accept fired from inside the worktree) → success, outcome surfaced", async () => {
  const { steps } = fakes({ merged: true, retire: "deferred" });
  const res = await acceptOrder(steps);
  assert.equal(res.ok, true);
  assert.equal(res.retire, "deferred");
  assert.equal(res.retireError, undefined);
});

test("a real merge failure throws and neither stamp nor retire run", async () => {
  // Ordering guard from the inline call sites: merge first, stamp second — a failed merge must
  // never leave a Spec stamped accepted while its branch is open, and must never retire.
  const { steps, log } = fakes({
    mergeThrows: new Error("gh pr merge: conflict"),
  });
  await assert.rejects(() => acceptOrder(steps), /conflict/);
  assert.deepEqual(log, ["merge"]);
});
