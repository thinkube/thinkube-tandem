// WHY (INVARIANT): folding two authors' records must carry a waiver forward
// — when one author left the cut's documentation undecided and the other
// recorded a waiver with a reason, the fold keeps that waiver, never drops
// it back to undecided by first-writer-wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSpaces } from "../out/core/records.js";
import { emptySpace, docsObligation } from "../out/core/schema.js";

test("folding an undecided cut with a waived-with-reason cut yields the waiver", () => {
  const reason = "purely internal, no user-facing behaviour";
  const cutId = "cut-shared";
  const first = {
    author: "alice",
    space: {
      ...emptySpace(),
      cuts: [{ id: cutId, changeIds: ["node-1"] }],
    },
  };
  const second = {
    author: "bob",
    space: {
      ...emptySpace(),
      cuts: [{ id: cutId, changeIds: ["node-1"], docs: { waived: true, reason } }],
    },
  };
  const folded = foldSpaces([first, second]);
  const foldedCut = folded.cuts.find((c) => c.id === cutId);
  assert.ok(foldedCut, "the shared cut survives the fold");
  const obligation = docsObligation(foldedCut);
  assert.equal(obligation.required, false, "the fold carries the waiver forward, not the undecided state");
  assert.equal(obligation.reason, reason, "the fold carries the waiver's reason verbatim");
});
