/**
 * TRANSITION — pins that when a cut carries a docs waiver (no docs/ path
 * grounded, but a reason recorded for why none is needed), renderTepBody's
 * Documentation section carries that recorded reason instead of silently
 * reporting no documentation at all — the TEP is the record of the duty,
 * met or waived, not just of the code that will land.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTepBody } from "./briefs";
import { emptySpace } from "../core/schema";

/** A space with one member grounded only in src/ — no docs/ touchpoint. */
function spaceWithNoDocsTouchpoint() {
  return {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "fix the greet module, no docs needed", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a greet module internal fix",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns 'hello'" }],
        grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
      },
    ],
  };
}

test("renderTepBody writes the docs waiver's recorded reason in the Documentation section", () => {
  const space = spaceWithNoDocsTouchpoint() as never;
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    tepId: "TEP-t-3",
    docsWaiver: { reason: "internal refactor, nothing user-facing changed", at: "2026-08-24T00:00:00.000Z" },
  } as never;
  const body = renderTepBody(space, cut);
  assert.match(body, /## Documentation/, "the body still carries a Documentation section");
  assert.match(
    body,
    /internal refactor, nothing user-facing changed/,
    "the waiver's own reason is written into the section",
  );
});

test("renderTepBody's Documentation section says documentation is missing when the cut grounds no docs/ path and carries no waiver", () => {
  const space = spaceWithNoDocsTouchpoint() as never;
  const cut = { id: "cut-1", changeIds: ["n1"], tepId: "TEP-t-4" } as never;
  const body = renderTepBody(space, cut);
  assert.match(body, /## Documentation/);
  assert.doesNotMatch(
    body,
    /internal refactor, nothing user-facing changed/,
    "no waiver reason exists to appear when none was recorded",
  );
});
