// WHY (INVARIANT): a cut whose promises land nowhere in documentation must
// always be refused at signing, with the refusal naming the missing
// documentation and that it can be waived with a reason — this must hold
// for every future cut, not just once at ship time.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
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

test("signing refuses a cut with no documentation stance, naming the gap and the waiver escape", () => {
  const { space, changeId } = spaceWithUndocumentedChange();
  const r = signCut(space, { id: "cut-1", changeIds: [changeId] }, "t");
  assert.equal(r.ok, false, "an undocumented cut is not signable");
  if (!r.ok) {
    assert.match(
      r.reason.toLowerCase(),
      /documentation/,
      "the refusal names documentation as the reason",
    );
    assert.match(
      r.reason.toLowerCase(),
      /waiv|reason/,
      "the refusal says a reason can waive the requirement",
    );
  }
});
