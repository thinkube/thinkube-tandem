/**
 * INVARIANT — tepContentHash must be a pure function of what the person
 * actually reviewed: the same members with the same recorded reason must
 * always mint the same content hash, or a re-render of an unchanged cut
 * would spuriously invalidate its own signature.
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

test("tepContentHash returns the same value for two cuts with the same members and the same recorded reason", () => {
  const space = spaceWith([node]);
  const first = tepContentHash(space, {
    changeIds: ["n1"],
    docsNotNeeded: "this change touches only internal test fixtures",
  });
  const second = tepContentHash(space, {
    changeIds: ["n1"],
    docsNotNeeded: "this change touches only internal test fixtures",
  });
  assert.equal(first, second);
});
