/**
 * A cut whose promises land no documentation and that records no reason
 * either is not yet signable — the review page must say this plainly,
 * before the click, rather than let the person discover it only when
 * signCut refuses.
 *
 * STANDING INVARIANT — renderCutScreen always states the "cannot be
 * signed" condition for a cut with neither a documentation touchpoint
 * nor a recorded docsNotNeeded reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen states that a cut with no documentation and no recorded reason cannot be signed until one of the two exists", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add a helper function",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() returns the expected value" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] });
  assert.match(
    screen,
    /cannot be signed/i,
    "the page states the cut cannot be signed while neither documentation nor a reason exists",
  );
});
