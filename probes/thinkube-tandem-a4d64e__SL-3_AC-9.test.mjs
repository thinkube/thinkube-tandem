// WHY (INVARIANT): a cut with no exemption must never claim in its brief
// that documentation was excused — printing that line unconditionally
// would misinform every worker reading the TEP body about a cut that
// carries no such exemption at all.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { renderTepBody } from "../out-test/run/briefs.js";

function makeSpace() {
  const s = emptySpace();
  s.asks.push({ id: "ask-1", text: "ship a documented change", at: "t" });
  s.nodes.push({
    id: "node-1",
    sentence: "a change that lands in code and docs",
    serves: ["ask-1"],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  return { space: s, changeId: "node-1" };
}

test("renderTepBody prints no exemption line for a cut with no exemption", () => {
  const { space, changeId } = makeSpace();
  const cut = { id: "cut-1", tepId: "TEP-user-1", changeIds: [changeId] };
  const body = renderTepBody(space, cut);
  assert.doesNotMatch(body, /documentation is not needed/i, "no exemption, no such line");
});
