/**
 * INVARIANT — an unchanged, signed documentation exemption must always
 * verify clean: verifyCutSignature must return ok for a signed exempt cut
 * whose exemption reason still reads exactly as it did at signing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "../gates/sign";
import { emptySpace } from "../core/schema";
import type { Space } from "../core/schema";

function exemptSpace(): Space {
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

test("verifyCutSignature returns ok for a signed exempt cut whose exemption reason is unchanged", () => {
  const space = exemptSpace();
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

  const verdict = verifyCutSignature(space, signed.cut);
  assert.equal(verdict.ok, true, "an unchanged exemption reason must not be reported as drift");
});
