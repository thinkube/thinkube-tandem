// WHY (INVARIANT): an empty or whitespace-only reason must never count as a
// waiver — the cut stays refused. This guards against a human's stray click
// silently exempting a cut from documentation forever.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space, Cut } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { signCut } from "../src/gates/sign.ts";

function spaceWithUndocumentedChange(): { space: Space; changeId: string } {
  let s = emptySpace();
  const a = addAsk(s, "add a thing", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a promise with no documentation anywhere",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  assert.ok(n.ok);
  return { space: n.space, changeId: n.added.id };
}

test("an empty or whitespace-only waiver reason does not waive — the cut stays refused", () => {
  const { space, changeId } = spaceWithUndocumentedChange();

  const emptyReason: Cut = {
    id: "cut-1",
    changeIds: [changeId],
    docs: { waived: true, reason: "" },
  };
  const r1 = signCut(space, emptyReason, "t");
  assert.equal(r1.ok, false, "an empty reason is not a waiver");

  const whitespaceReason: Cut = {
    id: "cut-1",
    changeIds: [changeId],
    docs: { waived: true, reason: "   \n\t  " },
  };
  const r2 = signCut(space, whitespaceReason, "t");
  assert.equal(r2.ok, false, "a whitespace-only reason is not a waiver");
});
