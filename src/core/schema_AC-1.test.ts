/**
 * INVARIANT — a cut whose promises ground no docs/ touchpoint and that
 * carries no exemption owes documentation: docsDuty() must say "missing" so
 * one rule, in one place, is the sole judge of the documentation decision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDuty } from "./docsDuty";
import { emptySpace } from "./schema";

test("docsDuty is missing for a cut grounded only in src/ with no exemption", () => {
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
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const result = docsDuty(space, cut);
  assert.equal(result.state, "missing");
});
