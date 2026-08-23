/**
 * renderCutScreen, for a cut that lands no documentation and carries no
 * exemption, says documentation is missing and that the cut cannot be signed
 * until it is written or excused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import type { Space } from "../core/schema";

test("renderCutScreen says documentation is missing and blocks signing", () => {
  const space = {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;

  const page = renderCutScreen(space, { id: "cut-1", changeIds: ["n1"] });
  assert.match(page, /documentation is missing/i);
  assert.match(page, /cannot be signed until it is written or excused/i);
});
