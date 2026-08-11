// WHY (INVARIANT): the signing gesture must carry the pending cut's
// documentation waiver into signCut so the gate accepts on the strength of
// what the human actually typed, every time Sign is pressed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { signCutGesture } from "../src/surfaces/runGate.ts";

function fakeSession(space, changeId, waiverReason) {
  return {
    space,
    cutNodeIds: new Set([changeId]),
    author: "t",
    running: false,
    deps: { now: () => "2026-08-11T00:00:00Z" },
    pendingDocsWaiver: waiverReason,
    mintTepApproval() {},
    changed() {},
    tepApproval() {
      return { approved: true };
    },
  };
}

test("pressing Sign with a recorded waiver passes it into signCut and the gate accepts", () => {
  let s = emptySpace();
  const a = addAsk(s, "add an undocumented thing", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a promise nowhere documented",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  assert.ok(n.ok);

  const session = fakeSession(n.space, n.added.id, "internal-only, no user surface");
  const r = signCutGesture(session);
  assert.equal(r.ok, true, "the waiver recorded on the pending cut lets Sign succeed");
});
