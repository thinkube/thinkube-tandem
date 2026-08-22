// WHY (INVARIANT): the reason rides the signed TEP bound by the signature —
// verifyCutSignature must report grounding drift when the exemption reason
// on an already-signed cut is edited afterwards, exactly as it would for any
// other grounded fact moving under a signature.
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

test("verifyCutSignature reports grounding drift when the exemption reason is edited after signing", () => {
  const space = baseSpace();
  const cut = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };
  const signed = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const tampered = {
    ...signed.cut,
    docsExemption: { ...signed.cut.docsExemption, reason: "a different reason typed in after the click" },
  };
  const verdict = verifyCutSignature(space, tampered);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.drift, "grounding");
});
