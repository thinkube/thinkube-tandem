/**
 * TRANSITION — renderCutScreen gains a documentation section: for a cut
 * that neither lands documentation nor carries an exemption, the review
 * page must display a status label naming the cut as owing documentation,
 * so the person cannot sign without seeing the gap. This test's job is
 * done once that status label exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen displays a status label naming the cut as owing documentation for a cut with neither landed docs nor an exemption", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "add a helper function",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "helper() returns true" }],
        grounding: { touchpoints: [{ path: "src/helper.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1"] });
  assert.match(screen, /documentation/i, "the page names documentation");
  assert.match(screen, /missing|owing/i, "the page labels the cut as owing/missing documentation");
});
