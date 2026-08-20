// WHY (TRANSITION): a cut carrying a documentation exemption must show the
// human's own reason on the cut review page, word for word — proves the new
// exemption line renders exactly what the human typed, not a paraphrase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySpace } from "../out-test/core/schema.js";
import { renderCutScreen } from "../out-test/gates/render.js";

function spaceWithNoDocLanding() {
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a small internal helper", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a helper function that trims whitespace",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "trims leading and trailing space" }],
        grounding: { touchpoints: [{ path: "src/core/trim.ts" }], stamp: [] },
      },
    ],
  };
  return { space, changeIds: ["n1"] };
}

test("renderCutScreen prints the exemption's reason word for word for an excused cut", () => {
  const { space, changeIds } = spaceWithNoDocLanding();
  const reason = "purely internal refactor, nothing user-facing to explain";
  const cut = {
    id: "cut-1",
    changeIds,
    docsException: { reason },
  };
  const screen = renderCutScreen(space, cut);
  assert.ok(
    screen.includes("documentation is not needed") || screen.toLowerCase().includes("not needed"),
    "the render must say documentation is not needed for this cut",
  );
  assert.ok(
    screen.includes(reason),
    "the render must carry the human's exemption reason word for word",
  );
});
