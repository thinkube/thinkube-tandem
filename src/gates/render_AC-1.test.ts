/**
 * The cut review page must say where documentation lands for a promise
 * that has a documentation touchpoint — a signer who cannot see this has
 * to go read the diff to find out whether the work explains itself.
 *
 * STANDING INVARIANT — renderCutScreen always names the documentation
 * touchpoint's path when one of the cut's promises lands in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen names where documentation lands, for a cut with a documentation touchpoint", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "explain the new gate in the gates page",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "the gates page mentions the new refusal" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/gates.adoc", planned: false }],
          stamp: [],
        },
      },
    ],
  };
  const screen = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] });
  assert.match(
    screen,
    /docs\/modules\/ROOT\/pages\/gates\.adoc/,
    "the documentation touchpoint's path is named on the review page",
  );
});
