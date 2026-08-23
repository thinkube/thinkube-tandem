// WHY (INVARIANT): the render signCut hashes before minting and the render
// verifyCutSignature re-renders after must be the same text for an excused
// cut — renderCutScreen prints the exemption reason word for word but must
// never print the moment it was signed, so the "at" stamped onto the cut at
// signing time cannot move the render hash out from under the signature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCutScreen } from "../out-test/gates/render.js";

function baseSpace() {
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
  };
}

test("renderCutScreen prints the exemption reason word for word and prints no signing moment", () => {
  const space = baseSpace();
  const reason = "purely internal refactor — no user-facing behaviour to document";
  const at = "2026-08-22T00:00:00.000Z";
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason, at },
  };
  const page = renderCutScreen(space, cut);
  assert.ok(
    page.includes(reason),
    "the render must carry the exemption reason word for word",
  );
  assert.ok(
    !page.includes(at),
    "the render must not print the signing moment stamped on the exemption",
  );

  // The same render, before any moment was ever stamped, must come out
  // byte-identical — the "at" field can never move the render's own text.
  const cutBeforeSigning = { id: "cut-1", changeIds: ["n1"], docsExemption: { reason } };
  const pageBeforeSigning = renderCutScreen(space, cutBeforeSigning);
  assert.equal(
    page,
    pageBeforeSigning,
    "the render must be identical whether or not the exemption carries a signing moment",
  );
});
