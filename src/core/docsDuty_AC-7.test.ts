/**
 * The docs waiver's reason is part of what was approved, exactly like a
 * promise's sentence or its grounding: changing it after the cut was
 * signed must surface as grounding drift, not pass silently as if nothing
 * the signature covered had moved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "../gates/sign";
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

// TRANSITION: the docs waiver reason is now bound by the signature. This
// proves editing it after signing is detected as drift, exactly as editing
// a criterion's own words is.
test("verifyCutSignature reports grounding drift when the docs waiver reason changes after signing", () => {
  const space = spaceWithMember("src/greet.ts");
  const cut: Cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsWaiver: { reason: "internal refactor, nothing user-facing", at: "2026-08-24T00:00:00Z" },
  };
  const signed = signCut(space, cut, "2026-08-24T00:00:00Z", "t");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);

  const reworded: Cut = {
    ...signed.cut,
    docsWaiver: { reason: "a completely different reason", at: "2026-08-24T00:00:00Z" },
  };
  const v = verifyCutSignature(space, reworded);
  assert.equal(v.ok, false);
  assert.equal((v as { drift?: string }).drift, "grounding");
});
