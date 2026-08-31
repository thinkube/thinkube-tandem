/**
 * TRANSITION — gradeSlice is a new seam on RunState: recording a slice's
 * per-criterion outcomes must make both ordinals readable back through
 * view().sliceChecks, keyed by the slice. Proves the write lands, not just
 * that it does not throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test("gradeSlice records both outcomes, with their ordinals, under the slice", () => {
  const st = new RunState(() => {});

  st.gradeSlice("SL-1", [
    { ac: 1, pass: true },
    { ac: 2, pass: false, text: "…" },
  ]);

  const checks = st.view().sliceChecks["SL-1"];
  assert.ok(checks, "the slice must appear in sliceChecks at all");
  assert.deepEqual(
    checks,
    [
      { ac: 1, pass: true },
      { ac: 2, pass: false, text: "…" },
    ],
    "both outcomes are held, each with its own ac ordinal",
  );
});
