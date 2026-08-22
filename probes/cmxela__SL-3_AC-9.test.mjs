// WHY (INVARIANT): the brief must say documentation is excused only when it
// truly is — renderTepBody, for a cut with no exemption, must print no line
// saying documentation is not needed, so a worker never mistakes a
// still-required documentation obligation for one that was excused.
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

test("renderTepBody, for a cut with no exemption, prints no line saying documentation is not needed", () => {
  const space = baseSpace();
  const cut = { id: "cut-1", tepId: "TEP-t-1", changeIds: ["n1"] };
  const body = renderTepBody(space, cut);
  assert.doesNotMatch(body, /documentation is not needed/i);
});
