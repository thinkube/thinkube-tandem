// WHY (INVARIANT): the reason rides the signed TEP — signCut must stamp the
// recorded exemption reason onto the signed cut together with the moment it
// was signed, so the exemption is bound into the signature's own record and
// not left as a bare, undated claim.
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

test("signCut stamps the recorded exemption reason and the signing moment onto the signed cut", () => {
  const space = baseSpace();
  const reason = "internal tooling only, no user-facing surface to document";
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason },
  };
  const at = "2026-08-22T00:00:00.000Z";
  const result = signCut(space, cut, at);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.cut.docsExemption.reason, reason, "the reason must ride onto the signed cut word for word");
    assert.equal(result.cut.docsExemption.at, at, "the signed cut must carry the moment it was signed");
  }
});
