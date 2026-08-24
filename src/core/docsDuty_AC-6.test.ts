/**
 * A cut with a recorded reason for writing no documentation must still be
 * signable — the docs duty is a check for silence, not a mandate that
 * every cut touch docs/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space, Cut } from "./schema";

function spaceWithMember(touchpointPath: string): Space {
  return {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change with no documentation",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: touchpointPath }], stamp: [] },
      },
    ],
  };
}

// TRANSITION: this proves the escape hatch half of the new refusal — a cut
// carrying a docs waiver with a non-empty reason signs even though no
// member grounds a docs/ path.
test("signCut signs a cut with no docs/ path when the cut carries a docs waiver with a reason", () => {
  const space = spaceWithMember("src/greet.ts");
  const cut: Cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsWaiver: { reason: "internal refactor, nothing user-facing", at: "2026-08-24T00:00:00Z" },
  };
  const r = signCut(space, cut, "2026-08-24T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
