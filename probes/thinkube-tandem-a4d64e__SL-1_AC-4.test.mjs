// INVARIANT — a cut that lands no documentation must still be signable when
// it carries a written exemption with a non-empty reason: the exemption is
// the one recorded escape hatch from the documentation obligation, and it
// must keep working for as long as signing enforces that obligation.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { signCut } from "../out-test/gates/sign.js";

function spaceNoDocLanding() {
  return {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a greeting", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a greeting function",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "greets by name" }],
        grounding: { touchpoints: [{ path: "src/greet.ts" }], stamp: [] },
      },
    ],
  };
}

test("signCut signs a cut that lands no documentation when it carries an exemption with a non-empty reason", () => {
  const space = spaceNoDocLanding();
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal refactor, no user-facing behavior" },
  };
  const r = signCut(space, cut, "2026-08-20T00:00:00Z");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.ok(r.cut.signature, "the cut carries a signature");
});
