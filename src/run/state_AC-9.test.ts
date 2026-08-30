/**
 * INVARIANT — a step that has no sub-steps must still return exactly its
 * own lines, unchanged, from logTail: the fold-in of sub-step lines must
 * never invent lines for a step that has none, and must never reorder or
 * drop what the step logged itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test("logTail of a step with no sub-steps returns only that step's own lines", () => {
  const st = new RunState(() => {});

  st.log("worker: reading the brief", "SL-1#eu-0");
  st.log("worker: wrote src/greet.ts", "SL-1#eu-0");
  // A sibling step's lines must never leak in.
  st.log("worker: a different unit entirely", "SL-1#eu-1");

  const { lines } = st.logTail("SL-1#eu-0");

  assert.deepEqual(
    lines,
    ["worker: reading the brief", "worker: wrote src/greet.ts"],
    "no sibling's lines, no reordering, nothing invented",
  );
});
