/**
 * INVARIANT — a cut that carries a recorded docs exemption is "exempt" and
 * reports its reason, even when none of its promises ground a docs/ path.
 * The exemption is a recorded decision, not the absence of one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDuty } from "./docsDuty";
import { emptySpace } from "./schema";

test("docsDuty is exempt and carries the recorded reason when a cut has a docs exemption and no docs/ grounding", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal helper, nothing a user reads", at: "2026-08-27T00:00:00Z" },
  };
  const result = docsDuty(space, cut);
  assert.equal(result.state, "exempt");
  assert.equal(result.reason, "internal helper, nothing a user reads");
});
