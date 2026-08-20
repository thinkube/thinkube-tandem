// INVARIANT — once at least one member of a cut grounds a documentation
// path, the cut satisfies the documentation obligation and signing must
// proceed (no exemption needed). This is the positive counterpart to AC-2's
// refusal and must hold for as long as isDocPath decides "documentation".
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { signCut } from "../out-test/gates/sign.js";

function spaceWithDocLanding() {
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
      {
        id: "n2",
        sentence: "a guide page for the greeting",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c2", text: "the guide exists" }],
        grounding: { touchpoints: [{ path: "docs/greet.md", planned: true }], stamp: [] },
      },
    ],
  };
}

test("signCut signs a cut once one member's grounding lands a documentation path", () => {
  const space = spaceWithDocLanding();
  const cut = { id: "cut-1", changeIds: ["n1", "n2"] };
  const r = signCut(space, cut, "2026-08-20T00:00:00Z");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  assert.ok(r.cut.signature, "the cut carries a signature");
});
