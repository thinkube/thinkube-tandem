/**
 * INVARIANT — not every proof on a delivery answers a criterion: the
 * repository's own suite verdict and a red push are proofs about the
 * DELIVERY, not about any one promise. Moving the Checks section onto a
 * criterion-first list must never drop these — a person still has to see
 * that the suite ran, and that the push failed. This must hold for as long
 * as the page carries proofs that are not criterion-shaped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDeliveryPage } from "./render";
import { emptySpace } from "../core/schema";
import type { Delivery, Space } from "../core/schema";

test("renderDeliveryPage still lists proofs that answer no criterion, beside the criteria", () => {
  const space: Space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a promise with one proved criterion",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the criterion is proved" }],
      },
    ],
    cuts: [{ id: "cut-1", changeIds: ["n1"] }],
  };
  const delivery: Delivery = {
    id: "d1",
    cutId: "cut-1",
    branch: "b",
    proofs: [
      { kind: "probe", label: "the criterion is proved", verdict: "green", criterionId: "c1" },
      // Neither of these carries a criterionId — they answer no criterion.
      { kind: "suite", label: "repo suite", verdict: "green" },
      { kind: "ci", label: "push", verdict: "red" },
    ],
  };

  const page = renderDeliveryPage(space, delivery);

  assert.match(page, /repo suite/, "the repository suite proof still appears on the page");
  assert.match(page, /push/, "the push proof still appears on the page");
  assert.match(page, /the criterion is proved/, "and the criterion-shaped proof is still named too");
});
