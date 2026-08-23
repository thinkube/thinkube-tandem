/**
 * verifyCutSignature reports grounding drift when the reason on a signed cut
 * is edited afterwards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut, verifyCutSignature } from "./sign";
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

test("editing the exemption reason on a signed cut is reported as grounding drift", () => {
  const space = baseSpace();
  const signed = signCut(
    space,
    {
      id: "c1",
      changeIds: ["n1"],
      docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
    },
    "2026-08-22T00:00:00.000Z",
  );
  assert.equal(signed.ok, true);
  if (!signed.ok) return;

  const tampered = {
    ...signed.cut,
    docsExemption: {
      ...signed.cut.docsExemption,
      reason: "a different reason typed in after the click",
    },
  };

  const verdict = verifyCutSignature(space, tampered);
  assert.equal(verdict.ok, false, "an edited reason must not verify clean");
  if (!verdict.ok) assert.equal(verdict.drift, "grounding");
});
