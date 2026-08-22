// WHY (INVARIANT): the brief itself must say documentation is excused and
// in whose words — renderTepBody, for a cut carrying an exemption, includes
// a line saying documentation is not needed together with the recorded
// reason, so every worker reading the TEP body sees the excuse without
// opening the cut review page separately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "../out-test/run/briefs.js";

function baseSpace() {
  return {
    asks: [{ id: "a1", text: "Add a widget.", at: "2026-08-22T00:00:00.000Z" }],
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: ["a1"],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
}

test("renderTepBody, for a cut carrying an exemption, includes a line saying documentation is not needed together with the reason", () => {
  const space = baseSpace();
  const reason = "purely internal refactor — no user-facing behaviour to document";
  const cut = {
    id: "cut-1",
    tepId: "TEP-t-1",
    changeIds: ["n1"],
    docsExemption: { reason },
  };
  const body = renderTepBody(space, cut);
  assert.match(body, /documentation is not needed/i);
  assert.ok(
    body.includes(reason),
    "the TEP body must carry the recorded exemption reason word for word",
  );
});
