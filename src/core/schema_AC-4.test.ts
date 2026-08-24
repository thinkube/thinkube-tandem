/**
 * INVARIANT — a cut that records no reason must render no "documentation
 * is not needed" line: the line's presence is the worker's only signal
 * that documentation was deliberately skipped, so it must never appear
 * unearned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../core/schema";
import { renderTepBody } from "../run/briefs";
import type { Space, Change, Cut } from "../core/schema";

const node: Change = {
  id: "n1",
  sentence: "greet the user",
  serves: [],
  needs: [],
  acceptance: [{ id: "c1", text: "greet() returns hello" }],
  grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
};

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

test("renderTepBody for a cut that records no reason contains no documentation-is-not-needed line", () => {
  const space = spaceWith([node]);
  const cut: Cut = { id: "cut-1", changeIds: ["n1"] };
  const body = renderTepBody(space, cut);
  assert.ok(
    !/documentation is not needed/i.test(body),
    "expected no line about documentation not being needed when no reason was recorded",
  );
});
