/**
 * renderTepBody, for a cut carrying an exemption, includes a line saying
 * documentation is not needed together with the recorded reason.
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

test("renderTepBody says documentation is not needed, with the reason, for an excused cut", () => {
  const reason = "purely internal refactor — no user-facing behaviour to document";
  const body = renderTepBody(baseSpace(), {
    id: "cut-1",
    tepId: "TEP-t-1",
    changeIds: ["n1"],
    docsExemption: { reason },
  } as unknown as Cut);

  assert.match(body, /documentation is not needed/i);
  assert.ok(
    body.includes(reason),
    "the TEP body must carry the recorded exemption reason word for word",
  );
});
