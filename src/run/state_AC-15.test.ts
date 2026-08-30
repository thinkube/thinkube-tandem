/**
 * INVARIANT — every line written under step "gate" or any of its sub-steps
 * (e.g. "gate#closer", "gate#finisher") must still reach the run-wide
 * top-level log the bottom panel renders (view().logs), so filing a line
 * under a named step never hides it from the live tail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test('lines filed under "gate" and its sub-steps still land in the run-wide view().logs', () => {
  const st = new RunState(() => {});

  st.log("gate: opening line", "gate");
  st.log("closer: a repair round", "gate#closer");
  st.log("finisher: bringing the suite under", "gate#finisher");

  const topLevel = st.view().logs;

  for (const line of ["gate: opening line", "closer: a repair round", "finisher: bringing the suite under"])
    assert.ok(topLevel.includes(line), `"${line}" must reach the run-wide log the bottom panel renders`);
});
