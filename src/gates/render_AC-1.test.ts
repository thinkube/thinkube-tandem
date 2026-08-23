/**
 * renderCutScreen names the documentation pages a cut lands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import type { Space } from "../core/schema";

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
  } as unknown as Space;

  const page = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] });
  assert.match(page, /docs\/modules\/ROOT\/pages\/widget\.adoc/);
});
