// WHY (INVARIANT): signing must always refuse a cut whose members ground no
// documentation path when the cut carries no written exemption — a cut can
// never sail past the human's signature without either real docs landing or
// an explicit, on-the-record excuse. This must hold for as long as the docs
// obligation exists.
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

function baseCut() {
  return { id: "c1", changeIds: ["n1"] };
}

test("signCut refuses a cut whose members ground no documentation path and carries no exemption", () => {
  const space = baseSpace();
  const cut = baseCut();
  const result = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason.toLowerCase(), /documentation/);
    assert.match(result.reason.toLowerCase(), /missing/);
  }
});
