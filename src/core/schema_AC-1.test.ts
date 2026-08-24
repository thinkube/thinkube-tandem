/**
 * INVARIANT — a cut's minted TEP must change when the recorded reason
 * documentation is not needed changes: the reason is part of what the
 * person is asked to sign, so two cuts that differ only in that reason
 * must never mint the same content hash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../core/schema";
import { tepContentHash } from "../gates/approval";
import type { Space, Change } from "../core/schema";

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

const node: Change = {
  id: "n1",
  sentence: "greet the user",
  serves: [],
  needs: [],
  acceptance: [{ id: "c1", text: "greet() returns hello" }],
  grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
};

test("tepContentHash differs for two cuts that differ only in the recorded docsNotNeeded reason", () => {
  const space = spaceWith([node]);
  const withoutReason = tepContentHash(space, { changeIds: ["n1"] });
  const withReason = tepContentHash(space, {
    changeIds: ["n1"],
    docsNotNeeded: "this change touches only internal test fixtures",
  });
  assert.notEqual(withoutReason, withReason);

  const withDifferentReason = tepContentHash(space, {
    changeIds: ["n1"],
    docsNotNeeded: "a completely different reason text",
  });
  assert.notEqual(withReason, withDifferentReason);
});
