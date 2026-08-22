/**
 * The TEP body rendered for worker briefs: it must say documentation is
 * excused, in the human's own words, exactly when the cut carries an
 * exemption — and never otherwise, so a worker never mistakes a still-
 * required documentation obligation for one that was excused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import type { Cut, Space } from "../core/schema";

function baseSpace(): Space {
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
  } as unknown as Space;
}

test("renderTepBody, for a cut carrying an exemption, includes a line saying documentation is not needed together with the reason", () => {
  const space = baseSpace();
  const reason = "purely internal refactor — no user-facing behaviour to document";
  const cut = {
    id: "cut-1",
    tepId: "TEP-t-1",
    changeIds: ["n1"],
    docsExemption: { reason },
  } as unknown as Cut;
  const body = renderTepBody(space, cut);
  assert.match(body, /documentation is not needed/i);
  assert.ok(
    body.includes(reason),
    "the TEP body must carry the recorded exemption reason word for word",
  );
});

test("renderTepBody, for a cut with no exemption, prints no line saying documentation is not needed", () => {
  const space = baseSpace();
  const cut = { id: "cut-1", tepId: "TEP-t-1", changeIds: ["n1"] } as unknown as Cut;
  const body = renderTepBody(space, cut);
  assert.doesNotMatch(body, /documentation is not needed/i);
});
