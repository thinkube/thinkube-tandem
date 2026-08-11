// WHY (INVARIANT): with no waiver and no documentation touchpoint, pressing
// Sign must surface the gate's documentation refusal to the human as a
// named reason — never as a silent no-op or an unrelated crash.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { signCutGesture } from "../src/surfaces/runGate.ts";

function fakeSession(space, changeId) {
  let lastChanged;
  return {
    space,
    cutNodeIds: new Set([changeId]),
    author: "t",
    running: false,
    deps: { now: () => "2026-08-11T00:00:00Z" },
    pendingDocsWaiver: undefined,
    mintTepApproval() {},
    changed(m) {
      lastChanged = m;
    },
    get lastChanged() {
      return lastChanged;
    },
    tepApproval() {
      return { approved: true };
    },
  };
}

test("Sign with no waiver and no documentation surfaces the gate's refusal, not an unexplained failure", () => {
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

  const session = fakeSession(n.space, n.added.id);
  const r = signCutGesture(session);
  assert.equal(r.ok, false, "no waiver, no docs touchpoint — Sign refuses");
  assert.ok(r.reason && r.reason.trim().length > 0, "a reason is surfaced, not a bare failure");
  assert.match(r.reason.toLowerCase(), /documentation/, "the surfaced reason names documentation");
});
