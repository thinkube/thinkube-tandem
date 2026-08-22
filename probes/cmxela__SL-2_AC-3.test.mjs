// WHY (INVARIANT): a cut that lands no documentation and carries no
// exemption must tell the signer, on the review page itself, that
// documentation is missing and that the cut cannot be signed until it is
// written or excused — the page is the one place a person reads before
// signing, so the refusal must be visible there, not only from signCut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "../out-test/gates/render.js";

test("renderCutScreen says documentation is missing and blocks signing when a cut lands none and carries no exemption", () => {
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
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const page = renderCutScreen(space, cut);
  assert.match(page, /documentation is missing/i);
  assert.match(page, /cannot be signed until it is written or excused/i);
});
