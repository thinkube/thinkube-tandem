// WHY (TRANSITION): a cut that lands no documentation and carries no
// exemption must say, on the review page itself, that documentation is
// missing and that the cut cannot be signed until it is written or excused —
// proves the human is never left to discover this only at the sign click.
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

test("renderCutScreen says documentation is missing and the cut cannot be signed until it is written or excused", () => {
  const { space, changeIds } = spaceWithNoDocLanding();
  const screen = renderCutScreen(space, { id: "cut-1", changeIds });
  assert.ok(
    screen.toLowerCase().includes("documentation") && screen.toLowerCase().includes("missing"),
    "the render must say documentation is missing",
  );
  assert.ok(
    screen.toLowerCase().includes("cannot be signed"),
    "the render must say the cut cannot be signed until documentation is written or excused",
  );
});
