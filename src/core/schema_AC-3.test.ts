/**
 * INVARIANT — the TEP text a worker reads must say plainly, when the cut
 * recorded a reason documentation is not needed, that documentation is
 * not needed and why — a worker reading only the brief must not have to
 * guess whether documentation was skipped or simply forgotten.
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

test("renderTepBody for a cut that records a reason contains that reason under a line saying documentation is not needed", () => {
  const space = spaceWith([node]);
  const cut: Cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsNotNeeded: "this change touches only internal test fixtures",
  };
  const body = renderTepBody(space, cut);
  const lines = body.split("\n");
  const reasonLineIndex = lines.findIndex((l) => /documentation is not needed/i.test(l));
  assert.notEqual(reasonLineIndex, -1, "expected a line stating documentation is not needed");
  assert.ok(
    body.includes(cut.docsNotNeeded!),
    "expected the recorded reason text to appear in the rendered TEP body",
  );
});
