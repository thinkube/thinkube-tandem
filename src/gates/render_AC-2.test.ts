/**
 * TRANSITION — an observation-shaped criterion (one only the running
 * product can show) must never read as "not checked" — that wording says
 * nothing judged it, when in truth nothing COULD judge it by design — and
 * must never read as "red", since no check failed. It gets its own verdict,
 * "for you to certify". Pinned once; a regression would fold it back into
 * one of the other two verdicts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criterionVerdicts } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("criterionVerdicts gives an observation-shaped criterion its own verdict, never 'not checked' or 'red'", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the tab strip reflows on a narrow window",
        serves: [],
        needs: [],
        acceptance: [
          // Worded so only a person watching the running product can judge it
          // (src/run/observations.ts's own rule for what counts as an observation).
          { id: "c1", text: "in the running extension, the user sees two tabs side by side" },
        ],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  // No proof at all answers c1 — an observation is never a check the run can run.
  const delivery: Delivery = { id: "d1", cutId: "cut-1", branch: "b", proofs: [] };

  const rows = criterionVerdicts(space, delivery);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, "for you to certify", "an observation-shaped criterion is certifiable, not 'not checked'");
  assert.notEqual(rows[0].verdict, "not checked");
  assert.notEqual(rows[0].verdict, "red");
});
