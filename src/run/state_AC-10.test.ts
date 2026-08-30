/**
 * TRANSITION — view().logCounts must report, for a parent step, the sum of
 * its own lines plus its sub-steps' lines, so the log chip a parent's card
 * carries counts everything one click on that card will show — not just
 * the lines logged under the parent's own name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test("view().logCounts sums a parent step's own lines with its sub-steps'", () => {
  const st = new RunState(() => {});

  st.log("gate: opening line", "gate");
  st.log("closer: round one", "gate#closer");
  st.log("closer: round two", "gate#closer");
  st.log("finisher: repairing", "gate#finisher");
  // An unrelated step must not be folded in.
  st.log("worker: unrelated", "SL-1#eu-0");

  const counts = st.view().logCounts;

  assert.equal(counts["gate"], 4, "1 own + 2 closer + 1 finisher = 4");
  assert.equal(counts["SL-1#eu-0"], 1, "an unrelated step is unaffected");
});
