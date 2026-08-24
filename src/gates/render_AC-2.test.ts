/**
 * When a cut records why it needs no documentation, the review page must
 * say so plainly and print that reason — otherwise a signer sees a cut
 * that lands no documentation and cannot tell an oversight from a
 * deliberate, recorded decision.
 *
 * STANDING INVARIANT — renderCutScreen always surfaces cut.docsNotNeeded
 * verbatim when it is set, on a cut whose promises land no documentation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen states that documentation is not needed and prints the recorded reason, for a cut that records one", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "rename an internal variable for clarity",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the build still passes" }],
        grounding: { touchpoints: [{ path: "src/internal.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const reason = "purely internal rename, nothing a reader of the docs would ever see";
  const screen = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"], docsNotNeeded: reason });
  assert.match(screen, /documentation is not needed/i, "the page states documentation is not needed");
  assert.match(screen, new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the recorded reason is printed verbatim");
});
