/**
 * INVARIANT — when at least one promise in the cut grounds a docs/
 * touchpoint, docsDuty() must say "landed" and list every docs/ path the
 * cut's promises ground, so the decision is derived from the grounding
 * instead of guessed at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsDuty } from "./docsDuty";
import { emptySpace } from "./schema";

test("docsDuty is landed and lists every docs/ path grounded by the cut's promises", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: {
          touchpoints: [
            { path: "src/greet.ts", planned: true },
            { path: "docs/modules/ROOT/pages/greet.adoc", planned: true },
          ],
          stamp: [],
        },
      },
      {
        id: "n2",
        sentence: "explain the greeting in the guide",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "guide mentions greet" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/guide.adoc", planned: true }],
          stamp: [],
        },
      },
    ],
  };
  const cut = { id: "cut-1", changeIds: ["n1", "n2"] };
  const result = docsDuty(space, cut);
  assert.equal(result.state, "landed");
  assert.deepEqual(
    [...result.landings].sort(),
    ["docs/modules/ROOT/pages/greet.adoc", "docs/modules/ROOT/pages/guide.adoc"].sort(),
  );
});
