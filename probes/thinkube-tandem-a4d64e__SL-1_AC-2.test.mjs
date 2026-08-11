// WHY (INVARIANT): a cut that was refused for missing documentation must
// sign cleanly once it carries an explicit not-needed reason — the waiver
// is a genuine escape hatch, not decoration, and this must keep working.
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

test("a cut carrying an explicit documentation-not-needed reason signs", () => {
  const { space, changeId } = spaceWithUndocumentedChange();
  const refused = signCut(space, { id: "cut-1", changeIds: [changeId] }, "t");
  assert.equal(refused.ok, false, "sanity: undocumented and unwaived still refuses");

  const waivedCut: Cut = {
    id: "cut-1",
    changeIds: [changeId],
    docs: { waived: true, reason: "this is an internal-only refactor, no user-facing surface" },
  };
  const signed = signCut(space, waivedCut, "t");
  assert.equal(signed.ok, true, "an explicit waiver reason lets the cut sign");
});
