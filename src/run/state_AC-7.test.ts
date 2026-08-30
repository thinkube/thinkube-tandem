/**
 * INVARIANT — sliceCheckTally(undefined) and sliceCheckTally([]) must both
 * report graded: false, so an ungraded slice's audit card is never drawn
 * as though it had passed criteria — an empty pass count and an absent
 * grading must not be told apart by a reader as "0 of 0 passed".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sliceCheckTally } from "../surfaces/auditCard";

test("sliceCheckTally(undefined) reports graded: false", () => {
  const tally = sliceCheckTally(undefined);
  assert.equal(tally.graded, false, "no checks were ever recorded for this slice");
});

test("sliceCheckTally([]) reports graded: false", () => {
  const tally = sliceCheckTally([]);
  assert.equal(tally.graded, false, "an empty checks list is not a slice that passed everything");
});
