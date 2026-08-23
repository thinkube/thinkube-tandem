// WHY (INVARIANT): once one member of the cut grounds a real documentation
// path, the cut has landed documentation and signing must succeed (all
// other gates being met) — this is the positive half of the docs rule and
// must hold for as long as the rule exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../out-test/gates/sign.js";

function spaceWithDocs() {
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
      {
        id: "n2",
        sentence: "Document the widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "docs/modules/ROOT/pages/widget.adoc" }], stamp: [] },
        acceptance: [{ id: "ac2", text: "the doc page exists" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
}

test("signCut signs a cut once one member's grounding lands a documentation path", () => {
  const space = spaceWithDocs();
  const cut = { id: "c1", changeIds: ["n1", "n2"] };
  const result = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, true);
});
