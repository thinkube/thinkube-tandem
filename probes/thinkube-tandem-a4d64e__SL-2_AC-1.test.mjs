// WHY (TRANSITION): renderCutScreen must gain a line naming the documentation
// pages a cut lands, so the human never signs blind to where the docs went.
// This proves the line now exists on a cut whose members ground a docs/ path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../out-test/core/schema.js";
import { renderCutScreen } from "../out-test/gates/render.js";

function spaceWithDocLanding() {
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "document the new gate", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "the docs page explains the new gate",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "the page reads clearly" }],
        grounding: { touchpoints: [{ path: "docs/modules/ROOT/pages/gates.adoc" }], stamp: [] },
      },
    ],
  };
  return { space, changeIds: ["n1"] };
}

test("renderCutScreen names the documentation pages a cut lands", () => {
  const { space, changeIds } = spaceWithDocLanding();
  const screen = renderCutScreen(space, { id: "cut-1", changeIds });
  assert.ok(
    screen.includes("docs/modules/ROOT/pages/gates.adoc"),
    "the cut screen must name the documentation page the cut lands at",
  );
});
