// WHY (INVARIANT): after signing, the cut stored in space.cuts must carry
// the waiver reason verbatim — the record of why documentation was skipped
// must survive the mint, not just the in-flight gate check.
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

test("the signed cut in space.cuts carries the waiver reason verbatim", () => {
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

  const reason = "internal-only, no user surface — exact wording matters here";
  const session = fakeSession(n.space, n.added.id, reason);
  const r = signCutGesture(session);
  assert.equal(r.ok, true);

  const stored = session.space.cuts.at(-1);
  assert.ok(stored, "a cut was appended to space.cuts");
  assert.equal(stored.docs?.reason, reason, "the waiver reason rides the stored cut verbatim");
});
