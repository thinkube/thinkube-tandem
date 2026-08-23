// WHY (INVARIANT): a cut carrying a documentation exemption must show the
// human's own reason on the review page, word for word — the signer reads
// why documentation was excused in the exact words given, not a paraphrase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "../out-test/gates/render.js";

test("renderCutScreen prints the exemption reason word for word when the cut carries one", () => {
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
  };
  const reason = "this is an internal refactor with no user-facing surface to document";
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason },
  };
  const page = renderCutScreen(space, cut);
  assert.match(page, /documentation is not needed/i);
  assert.ok(
    page.includes(reason),
    "the render must carry the human's exemption reason word for word",
  );
});
