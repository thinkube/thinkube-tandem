/**
 * INVARIANT — a slice's checks are always its LATEST verdict, never a
 * history. A second gradeSlice for a slice already graded must replace the
 * earlier outcomes, not append to them — otherwise a slice re-graded after
 * a fix would show both the old failure and the new pass at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RunState } from "./state";

test("a second gradeSlice for the same slice replaces, never appends", () => {
  const st = new RunState(() => {});

  st.gradeSlice("SL-1", [
    { ac: 1, pass: false, text: "first pass, failed" },
    { ac: 2, pass: true },
  ]);
  st.gradeSlice("SL-1", [{ ac: 1, pass: true }]);

  assert.deepEqual(
    st.view().sliceChecks["SL-1"],
    [{ ac: 1, pass: true }],
    "the earlier three-entry outcome is gone; only the latest grading remains",
  );
});
