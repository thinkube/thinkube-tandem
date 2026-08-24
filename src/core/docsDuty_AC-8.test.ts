/**
 * A cut signed before the docs duty became part of the signature must not
 * be reported as drifted: the machine changed what a signature covers, not
 * the person's promises, so an old signature reads as unchecked rather
 * than refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCutSignature } from "../gates/sign";
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

// INVARIANT: a signature carrying an older `rule` number is never checked
// for drift against the current hashing rule — it reports ok with an
// unchecked note. This proves that still holds once the docs duty raises
// the rule number: a src/-only cut signed under rule 1 is not refused for
// missing documentation it was never asked about.
test("verifyCutSignature returns ok with an unchecked note for a cut signed under the previous rule", () => {
  const space = spaceWithMember("src/greet.ts");
  const cut: Cut = {
    id: "cut-1",
    changeIds: ["n1"],
    signature: { at: "2020-01-01T00:00:00Z", renderHash: "irrelevant", groundingHash: "irrelevant", rule: 1 },
  };
  const v = verifyCutSignature(space, cut);
  assert.equal(v.ok, true);
  assert.equal((v as { drift?: string }).drift, undefined, "an old-rule signature is never reported as drift");
  assert.ok(
    "unchecked" in v && typeof v.unchecked === "string" && v.unchecked.length > 0,
    `expected an unchecked note, got ${JSON.stringify(v)}`,
  );
});
