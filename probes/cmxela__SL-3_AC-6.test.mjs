// WHY (INVARIANT): what signCut hashes before minting and what
// verifyCutSignature re-renders after must be the same text for an excused
// cut — verifyCutSignature must return ok on the very cut signCut just
// returned, with no drift introduced by the exemption riding along.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "../out-test/gates/sign.js";

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

test("verifyCutSignature returns ok on the cut signCut just returned when it carries a documentation exemption", () => {
  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };
  const signed = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const verdict = verifyCutSignature(space, signed.cut);
  assert.equal(verdict.ok, true, "the freshly signed excused cut must verify clean, with no drift");
});
