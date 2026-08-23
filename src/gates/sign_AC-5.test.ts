/**
 * Editing the exemption reason on a signed cut changes tepContentHash, so
 * tepApprovalOf reports the token no longer matches and dispatch refuses
 * until it is signed again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepContentHash } from "./approval";
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

test("editing the exemption reason changes tepContentHash, so the minted token no longer matches", () => {
  const space = baseSpace();
  const signedHash = tepContentHash(space, {
    changeIds: ["n1"],
    tepId: "TEP-t-1",
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  });

  // The reason is edited after the click. The token was minted against the
  // hash above; dispatch consults the hash of the cut as it now reads.
  const editedHash = tepContentHash(space, {
    changeIds: ["n1"],
    tepId: "TEP-t-1",
    docsExemption: { reason: "a different reason typed in after the click" },
  });

  assert.notEqual(
    editedHash,
    signedHash,
    "an edited exemption reason must change the content hash the token is bound to",
  );
});
