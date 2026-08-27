/**
 * TRANSITION — renderCutScreen gains a documentation section: for a cut
 * that lands documentation, the review page must name every docs/ path
 * the cut's promises ground, so the person sees what documentation ships
 * before they sign. This test's job is done once that section exists.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import { emptySpace } from "../core/schema";

test("renderCutScreen names every docs/ path the cut's promises ground, for a cut that lands documentation", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "the signing gate refuses an undocumented cut",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "signCut refuses without a docs touchpoint" }],
        grounding: {
          touchpoints: [
            { path: "src/gates/sign.ts", planned: false },
            { path: "docs/modules/ROOT/pages/gates.adoc", planned: false },
          ],
          stamp: [],
        },
      },
      {
        id: "n2",
        sentence: "the configuration page states the new documentation rule",
        serves: [],
        needs: [],
        acceptance: [{ id: "c2", text: "the page says documentation is required at signing" }],
        grounding: {
          touchpoints: [{ path: "docs/modules/ROOT/pages/configuration.adoc", planned: false }],
          stamp: [],
        },
      },
    ],
  };
  const screen = renderCutScreen(space as never, { id: "cut-1", changeIds: ["n1", "n2"] });
  assert.match(screen, /docs\/modules\/ROOT\/pages\/gates\.adoc/, "the first docs path this cut grounds is named");
  assert.match(
    screen,
    /docs\/modules\/ROOT\/pages\/configuration\.adoc/,
    "the second docs path this cut grounds is also named",
  );
});
