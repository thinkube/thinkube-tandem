// WHY (INVARIANT): a written exemption with a non-empty reason is the one
// recorded escape hatch from the documentation obligation — a cut that
// lands no documentation must still be signable when a human has typed a
// real reason on the record. This must hold for as long as the exemption
// exists as a gate bypass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../out-test/gates/sign.js";

function baseSpace() {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "Add a widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "ac1", text: "widget renders" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
}

test("signCut signs a cut that lands no documentation when the cut carries an exemption with a non-empty reason", () => {
  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "this cut only touches internal tooling, no user-facing surface changed" },
  };
  const result = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, true);
});
