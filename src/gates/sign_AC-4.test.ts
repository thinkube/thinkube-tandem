/**
 * tepContentHash, for a cut carrying a documentation exemption, returns a
 * hash whose grounding half is non-empty — the cut it hashes carries the
 * exemption, so the inner signCut is not refused for missing documentation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepContentHash } from "./approval";
import { groundingHashOf } from "./sign";
import type { Space } from "../core/schema";

function baseSpace(): Space {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "Add a widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "ac1", text: "widget renders" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;
}

const reason = "internal tooling only, no user-facing surface to document";

test("the grounding half tepContentHash covers is non-empty for an excused cut", () => {
  const space = baseSpace();
  const cut = {
    id: "pair",
    changeIds: ["n1"],
    docsExemption: { reason },
  };

  // The exemption rides onto the cut being hashed, so the grounding half is
  // computed rather than refused for missing documentation — an empty half
  // is the failure this criterion exists to catch.
  const grounding = groundingHashOf(space, cut);
  assert.ok(
    grounding.trim().length > 0,
    `the grounding half must be non-empty, saw ${JSON.stringify(grounding)}`,
  );

  const hash = tepContentHash(space, { changeIds: ["n1"], tepId: "TEP-t-1", docsExemption: { reason } });
  assert.ok(hash.trim().length > 0, "the content hash must be non-empty");
});

test("the exemption reason is part of what tepContentHash covers", () => {
  const space = baseSpace();
  const withReason = tepContentHash(space, {
    changeIds: ["n1"],
    tepId: "TEP-t-1",
    docsExemption: { reason },
  });
  const withoutExemption = tepContentHash(space, { changeIds: ["n1"], tepId: "TEP-t-1" });

  assert.notEqual(
    withReason,
    withoutExemption,
    "a cut carrying an exemption must not hash the same as one carrying none",
  );
});
