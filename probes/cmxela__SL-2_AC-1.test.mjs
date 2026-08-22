// WHY (INVARIANT): the cut review page must always name where a cut's
// documentation lands, so a signer can see the doc paths without opening
// each promise individually. renderCutScreen prints the doc-path lines
// for a cut whose members ground a docs/ path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "../out-test/gates/render.js";

test("renderCutScreen names the documentation pages a cut lands", () => {
  const space = {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: {
          touchpoints: [
            { path: "src/widget.ts" },
            { path: "docs/modules/ROOT/pages/widget.adoc" },
          ],
          stamp: [],
        },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const page = renderCutScreen(space, cut);
  assert.match(page, /docs\/modules\/ROOT\/pages\/widget\.adoc/);
});
