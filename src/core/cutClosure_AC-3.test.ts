/**
 * TRANSITION — signing must start refusing a cut whose promises land no
 * documentation and that records no reason why documentation is not
 * needed: before this change such a cut signed silently; this proves the
 * new refusal is in force and that its reason names documentation, so the
 * person reads why the click did nothing.
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

test("signCut refuses a cut whose promises land no documentation and records no reason", () => {
  const space = spaceWith([sourceOnly]);
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-24T00:00:00Z", "t");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /document/i);
});
