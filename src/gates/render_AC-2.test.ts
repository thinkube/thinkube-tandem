/**
 * INVARIANT — every docs/ path the cut will write is named on the review
 * page, not just the first one found, so a signer sees the whole
 * documentation footprint before approving. A path dropped here is a page
 * the signer never knew the cut would write.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen's Documentation line names every docs/ path across every member", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change touching one docs page and one src file",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: {
          touchpoints: [
            { path: "docs/modules/ROOT/pages/one.adoc", planned: true },
            { path: "src/x.ts", planned: true },
          ],
          stamp: [],
        },
      },
      {
        id: "n2",
        sentence: "a second change touching a second docs page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "c2 holds" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/two.adoc", planned: true }],
          stamp: [],
        },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1", "n2"] } as never);
  assert.match(screen, /docs\/modules\/ROOT\/pages\/one\.adoc/, "the first member's docs path is named");
  assert.match(screen, /docs\/modules\/ROOT\/pages\/two\.adoc/, "the second member's docs path is named");
});
