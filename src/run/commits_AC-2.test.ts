/**
 * TRANSITION — standingPassLine must also handle the case where no run id
 * rode the commit that made a slice standing (an older commit, from before
 * this feature): its sentence must say the earlier run is not on the
 * record, and it must never invent a run id to fill the gap.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { standingPassLine } from "./plan";

test("standingPassLine, given no run id, says the earlier run is not on the record", () => {
  const line = standingPassLine("SL-1#eu-1", "SL-1");

  assert.match(
    line,
    /not (on the record|known|recorded)/i,
    "the sentence says plainly that the earlier run is not on the record",
  );
  assert.doesNotMatch(
    line,
    /@[a-z0-9]+/i,
    "no invented run id (of the tep@stamp shape) appears in the sentence",
  );
});
