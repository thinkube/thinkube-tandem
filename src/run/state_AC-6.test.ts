/**
 * TRANSITION — sliceCheckTally is a new function the audit card reads: it
 * must count how many of a slice's recorded criteria passed against the
 * total, and hand back the failing ones — with their own words — so the
 * card can name each one rather than folding them into a single count.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceCheckTally } from "../surfaces/auditCard";

test("sliceCheckTally counts passed against total and names the failing check", () => {
  const tally = sliceCheckTally([
    { ac: 1, pass: true },
    { ac: 2, pass: false, text: "the card names the failing check" },
  ]);

  assert.equal(tally.graded, true, "a non-empty checks list is a graded slice");
  assert.equal(tally.passed, 1, "one of the two checks passed");
  assert.equal(tally.total, 2, "the total counts every recorded check");
  assert.deepEqual(
    tally.failed,
    [{ ac: 2, pass: false, text: "the card names the failing check" }],
    "the failing check comes back whole, including its own words",
  );
});
