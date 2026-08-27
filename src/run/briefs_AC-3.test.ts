/**
 * INVARIANT — the documentation decision on a cut must always be covered by
 * the signature: verifyCutSignature must always report drift when a signed
 * cut's recorded documentation exemption reason is changed after signing,
 * so the exemption cannot be silently edited once approved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "../gates/sign";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";

function exemptSpace(reason: string): Space {
  return {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "tighten the retry backoff",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "retry() waits twice as long each attempt" }],
        grounding: { touchpoints: [{ path: "src/retry.ts", planned: true }], stamp: [] },
      },
    ],
  };
}

test("verifyCutSignature reports drift for a signed cut whose recorded documentation exemption reason was changed after signing", () => {
  const space = exemptSpace("internal timing tweak, no user-facing behaviour to document");
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: {
      reason: "internal timing tweak, no user-facing behaviour to document",
      at: "2026-08-27T00:00:00Z",
    },
  };
  const signed = signCut(space, cut, "2026-08-27T00:00:00Z", "t");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);

  const editedCut = {
    ...signed.cut,
    docsExemption: {
      reason: "different reason written in after the signature",
      at: "2026-08-27T00:00:00Z",
    },
  };
  const verdict = verifyCutSignature(space, editedCut);
  assert.equal(verdict.ok, false, "editing the exemption reason after signing must surface as drift");
});
