/**
 * TRANSITION — a cut whose only documentation touchpoint is a root-level
 * markdown document (like ENGINE-WIRING.md) must sign with no reason
 * recorded, proving the widened isDocumentationPath rule actually reaches
 * signCut's refusal rather than only existing in isolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space, Change } from "./schema";

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

const rootDocOnly: Change = {
  id: "n1",
  sentence: "record the engine wiring roster",
  serves: [],
  needs: [],
  acceptance: [{ id: "c1", text: "ENGINE-WIRING.md exists" }],
  grounding: { touchpoints: [{ path: "ENGINE-WIRING.md", planned: true }], stamp: [] },
};

test("signCut signs, with no reason recorded, a cut whose only documentation touchpoint is a root-level markdown document", () => {
  const space = spaceWith([rootDocOnly]);
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-24T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
