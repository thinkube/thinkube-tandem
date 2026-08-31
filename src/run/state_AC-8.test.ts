/**
 * TRANSITION — logTail(step) must fold in a sub-step's own lines: asking for
 * "gate" today returns only what was logged under "gate" itself, so a
 * closing gate whose real work happens under "gate#closer" reads as an
 * empty panel. Lines logged under "gate#closer" must come back from
 * logTail("gate"), placed after "gate"'s own lines.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test('logTail("gate") returns "gate#closer" lines after "gate"\'s own lines', () => {
  const st = new RunState(() => {});

  st.log("gate: opening line one", "gate");
  st.log("closer: repairing round one", "gate#closer");
  st.log("gate: opening line two", "gate");
  st.log("closer: repairing round two", "gate#closer");

  const { lines } = st.logTail("gate");

  assert.deepEqual(
    lines,
    [
      "gate: opening line one",
      "gate: opening line two",
      "closer: repairing round one",
      "closer: repairing round two",
    ],
    "gate's own lines come first, in order, then the closer's, in order",
  );
});
