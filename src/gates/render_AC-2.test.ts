/**
 * renderCutScreen, for a cut carrying an exemption, prints a line saying
 * documentation is not needed together with the human's reason word for word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "./render";
import type { Space } from "../core/schema";

function baseSpace(): Space {
  return {
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
}

test("renderCutScreen prints that documentation is not needed, with the reason word for word", () => {
  const reason = "this is an internal refactor with no user-facing surface to document";
  const page = renderCutScreen(baseSpace(), {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason },
  });
  assert.match(page, /documentation is not needed/i);
  assert.ok(
    page.includes(reason),
    "the render must carry the human's exemption reason word for word",
  );
});
