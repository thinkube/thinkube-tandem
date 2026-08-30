/**
 * TRANSITION — a criterion whose text heads an entry in delivery.observations
 * (the gate's own "what only the person can certify" list, worded as
 * "<criterion text> — <why>" by src/run/observations.ts) must read as
 * certifiable, not as unchecked. This is the second of the two ways a
 * criterion earns "for you to certify": the wording rule in AC-2, and this
 * one — a reviewer at the closing gate ruled OBSERVE on a criterion the
 * wording rule did not catch, and that ruling still has to land as
 * certifiable on the page. Pinned once; done when both paths agree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { criterionVerdicts } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("criterionVerdicts reads a reviewer's OBSERVE ruling (headed in delivery.observations) as certifiable", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the map feels responsive while zooming",
        serves: [],
        needs: [],
        acceptance: [
          // Worded so the deterministic rule in observations.ts would NOT
          // catch it as observation-shaped — only the reviewer's own OBSERVE
          // verdict, recorded on delivery.observations, says so.
          { id: "c1", text: "zooming out keeps every card legible", kind: "assessment" },
        ],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [],
    // The reviewer's OBSERVE ruling, exactly as gradeAssessments records it:
    // the criterion's own text, then " — ", then its reason.
    observations: ["zooming out keeps every card legible — this can only be judged in the running map"],
  };

  const rows = criterionVerdicts(space, delivery);

  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].verdict,
    "for you to certify",
    "a criterion headed in delivery.observations reads as certifiable, not unchecked",
  );
});
