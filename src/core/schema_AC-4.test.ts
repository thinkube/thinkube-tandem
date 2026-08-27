/**
 * INVARIANT — signCut refuses a cut whose promises ground no docs/
 * touchpoint and that carries no exemption; the refusal reason must name
 * documentation, so the person reads what is missing without guessing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

test("signCut refuses a cut with no docs/ touchpoint and no exemption, naming documentation in the reason", () => {
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
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-27T00:00:00Z", "t");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /documentation/i);
});
