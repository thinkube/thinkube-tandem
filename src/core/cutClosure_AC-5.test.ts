/**
 * INVARIANT — a cut that lands no documentation still signs when it
 * records why documentation is not needed: the refusal is a gate on an
 * unrecorded gap, not a gate on documentation itself, and recording the
 * reason is the one way past it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space, Change } from "./schema";

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

const sourceOnly: Change = {
  id: "n1",
  sentence: "add a helper",
  serves: [],
  needs: [],
  acceptance: [{ id: "c1", text: "it works" }],
  grounding: { touchpoints: [{ path: "src/helper.ts", planned: true }], stamp: [] },
};

test("signCut signs a cut that lands no documentation when the cut records a reason", () => {
  const space = spaceWith([sourceOnly]);
  const r = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsNotNeeded: "this change touches only internal test fixtures" },
    "2026-08-24T00:00:00Z",
    "t",
  );
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
