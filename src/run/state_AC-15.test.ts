/**
 * INVARIANT — every line written under step "gate" or any of its sub-steps
 * (e.g. "gate#closer", "gate#finisher") must still reach the run-wide
 * top-level log the bottom panel renders (view().logs), so filing a line
 * under a named step never hides it from the live tail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";
import { GATE_STEP, sayAt } from "./gate";

test('lines filed under "gate" and its sub-steps still land in the run-wide view().logs', () => {
  const st = new RunState(() => {});

  st.log("gate: opening line", "gate");
  st.log("closer: a repair round", "gate#closer");
  st.log("finisher: bringing the suite under", "gate#finisher");

  const topLevel = st.view().logs;

  for (const line of ["gate: opening line", "closer: a repair round", "finisher: bringing the suite under"])
    assert.ok(topLevel.includes(line), `"${line}" must reach the run-wide log the bottom panel renders`);
});

/**
 * The promise is about the step names the CLOSING GATE actually writes, not
 * about strings a check spells for itself. Driving `sayAt` — the gate's own
 * filing seam — and the sub-step names spelled from `GATE_STEP` is what ties
 * this criterion to `src/run/gate.ts`: a gate that filed its lines under some
 * other step, or under none, fails here instead of passing on a check that
 * only ever exercised RunState.
 */
test("the closing gate's own filing seam reaches the run-wide log the bottom panel renders", () => {
  const st = new RunState(() => {});

  // The gate's own lines go through the seam `closeGate` uses, not a literal.
  const say = sayAt((line, step) => st.log(line, step));
  say("gate: the suite is red after every actor");

  // Its sub-steps are spelled from GATE_STEP exactly as closeGate spells them.
  st.log("closer: a repair round", `${GATE_STEP}#closer`);
  st.log("finisher: bringing the suite under", `${GATE_STEP}#finisher`);

  assert.equal(GATE_STEP, "gate", "the gate's card and its step name are the same word");

  const topLevel = st.view().logs;
  for (const line of [
    "gate: the suite is red after every actor",
    "closer: a repair round",
    "finisher: bringing the suite under",
  ])
    assert.ok(topLevel.includes(line), `"${line}" must reach the run-wide log the bottom panel renders`);

  // And the gate's own line is filed under "gate" itself — a seam that
  // dropped the step would still reach view().logs, and must not pass.
  assert.deepEqual(
    st.logTail(GATE_STEP).lines,
    [
      "gate: the suite is red after every actor",
      "closer: a repair round",
      "finisher: bringing the suite under",
    ],
    "the gate's card opens one account: its own line, then its sub-steps'",
  );
});
