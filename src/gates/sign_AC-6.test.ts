/**
 * verifyCutSignature returns ok on the cut signCut just returned when that
 * cut carries a documentation exemption.
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

test("a freshly signed excused cut verifies clean, with no drift", () => {
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

  assert.equal(
    verifyCutSignature(space, signed.cut).ok,
    true,
    "the freshly signed excused cut must verify clean",
  );
});
