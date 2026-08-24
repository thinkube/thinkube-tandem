/**
 * INVARIANT — a cut reads as documented as soon as ANY one member grounds a
 * docs/ path, even when the rest of the cut grounds only src/ paths. A
 * review page that required every member to carry docs would demand
 * documentation the change does not need per-member, only per-cut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen reports the cut documented when only one of several members grounds a docs/ path", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a change grounded only in source",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "c1 holds" }],
        grounding: { touchpoints: [{ path: "src/only.ts", planned: true }], stamp: [] },
      },
      {
        id: "n2",
        sentence: "a change grounded in documentation",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "c2 holds" }],
        grounding: { touchpoints: [{ path: "docs/only.adoc", planned: true }], stamp: [] },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1", "n2"] } as never);
  assert.match(screen, /docs\/only\.adoc/, "the one docs/ path across the cut is named");
  assert.doesNotMatch(
    screen,
    /Documentation.*(missing|not needed)/is,
    "the cut is not reported missing or waived when one member already documents it",
  );
});
