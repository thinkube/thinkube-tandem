/**
 * TRANSITION — standingPassLine is a new function on the run's plan-side
 * bookkeeping: given a run id, its sentence must name that run id and say
 * the step passed THERE, not here, so a step marked "done" from an earlier
 * run's standing work is never read as work this run performed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { standingPassLine } from "./plan";

test("standingPassLine, given a run id, names that run id and says the step passed in it", () => {
  const line = standingPassLine("SL-1#eu-1", "SL-1", "TEP-cmxela-31@abc123");

  assert.match(
    line,
    /TEP-cmxela-31@abc123/,
    "the earlier run's own id must appear in the sentence",
  );
  assert.match(
    line,
    /pass(ed)?/i,
    "the sentence says the step passed",
  );
  assert.doesNotMatch(
    line,
    /\bhere\b/i,
    "it says the step passed in the earlier run, not here",
  );
});
