/**
 * signCut signs a cut that lands no documentation when the cut carries an
 * exemption with a non-empty reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import type { Space } from "./schema";

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

test("signCut signs an undocumented cut that carries an exemption with a non-empty reason", () => {
  const reason = "this cut only touches internal tooling, no user-facing surface changed";
  const result = signCut(
    baseSpace(),
    { id: "c1", changeIds: ["n1"], docsExemption: { reason } },
    "2026-08-22T00:00:00.000Z",
  );
  assert.equal(result.ok, true);
});
