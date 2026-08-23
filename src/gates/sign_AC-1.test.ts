/**
 * signCut writes the recorded reason onto the signed cut together with the
 * moment it was signed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "./sign";
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

test("signCut stamps the recorded reason and the signing moment onto the signed cut", () => {
  const reason = "this cut only touches internal tooling, no user-facing surface changed";
  const at = "2026-08-22T00:00:00.000Z";

  const result = signCut(baseSpace(), { id: "c1", changeIds: ["n1"], docsExemption: { reason } }, at);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.cut.docsExemption?.reason,
      reason,
      "the reason must ride onto the signed cut word for word",
    );
    assert.equal(
      (result.cut.docsExemption as { at?: string })?.at,
      at,
      "the signed cut must carry the moment it was signed",
    );
  }
});
