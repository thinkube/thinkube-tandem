/**
 * signCut signs a cut once one member's grounding lands a documentation path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import type { Space } from "./schema";

function spaceWithDocs(): Space {
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
      {
        id: "n2",
        sentence: "Document the widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "docs/modules/ROOT/pages/widget.adoc" }], stamp: [] },
        acceptance: [{ id: "ac2", text: "the doc page exists" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;
}

test("signCut signs the cut once one member's grounding lands a documentation path", () => {
  const result = signCut(
    spaceWithDocs(),
    { id: "c1", changeIds: ["n1", "n2"] },
    "2026-08-22T00:00:00.000Z",
  );
  assert.equal(result.ok, true);
});
