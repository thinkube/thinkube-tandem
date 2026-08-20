// WHY (INVARIANT): every worker reads the TEP body as its brief. For a
// cut that carries a documentation exemption, that body must say so and
// carry the human's own recorded reason — otherwise a worker (or a
// reviewer reading the brief) has no way to know documentation was
// deliberately excused and why.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { renderTepBody } from "../out-test/run/briefs.js";

function makeSpace() {
  const s = emptySpace();
  s.asks.push({ id: "ask-1", text: "ship a change with no documentation", at: "t" });
  s.nodes.push({
    id: "node-1",
    sentence: "a change that lands only in code",
    serves: ["ask-1"],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  return { space: s, changeId: "node-1" };
}

test("renderTepBody says documentation is not needed and carries the recorded reason for an excused cut", () => {
  const { space, changeId } = makeSpace();
  const reason = "config-only change; nothing to document, verbatim reason here";
  const cut = { id: "cut-1", tepId: "TEP-user-1", changeIds: [changeId], exemption: { reason } };
  const body = renderTepBody(space, cut);
  assert.match(body, /documentation is not needed/i, "the body says documentation is excused");
  assert.ok(body.includes(reason), "and carries the recorded reason");
});
