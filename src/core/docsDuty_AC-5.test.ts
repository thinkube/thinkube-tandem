/**
 * Signing must refuse a cut that lands no documentation and carries no
 * waiver reason — the docs duty is enforced at the one gate a human's
 * signature passes through, not left to hope the reviewer notices.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space } from "./schema";

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

// TRANSITION: before this slice, signCut granted any cut whose promises
// were grounded, checked and free of open questions — documentation was
// never part of the gate. This proves the gate now refuses a cut whose
// members ground only src/ and carries no docs waiver.
test("signCut refuses a cut whose members ground no docs/ path and carries no docs waiver", () => {
  const space = spaceWithMember("src/greet.ts");
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-24T00:00:00Z", "t");
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /documentation/i, "the refusal names documentation");
  assert.match(
    r.ok ? "" : r.reason,
    /not needed|waiv/i,
    "the refusal says how to record that documentation is not needed",
  );
});
