// WHY (INVARIANT): a cut holding a promise whose grounding already names a
// documentation path ships documentation by construction — it must sign
// with no reason given, so the waiver gesture is never forced on a cut that
// already documents itself.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { signCut } from "../src/gates/sign.ts";

test("a cut grounded on a documentation path signs with no waiver reason", () => {
  let s = emptySpace();
  const a = addAsk(s, "document the widget", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "the widget's page names how it works",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the page renders" }],
    grounding: {
      touchpoints: [
        { path: "src/widget.ts" },
        { path: "docs/modules/ROOT/pages/widget.adoc" },
      ],
      stamp: [],
    },
  });
  assert.ok(n.ok);
  s = n.space;

  const signed = signCut(s, { id: "cut-1", changeIds: [n.added.id] }, "t");
  assert.equal(signed.ok, true, "grounding on a docs/ path is documentation, no waiver needed");
});
