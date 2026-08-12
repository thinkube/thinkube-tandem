// WHY (INVARIANT): a waiver is a deliberate written act — a reason that is
// empty or only whitespace is not a reason, so the cut stays required.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsObligation } from "../out/core/schema.js";

test("a cut whose waiver carries an empty or whitespace reason is not a valid waiver", () => {
  const emptyReason = { id: "cut-1", changeIds: ["node-1"], docs: { waived: true, reason: "" } };
  const whitespaceReason = { id: "cut-2", changeIds: ["node-1"], docs: { waived: true, reason: "   \n\t " } };
  assert.equal(docsObligation(emptyReason).required, true, "an empty reason leaves the obligation required");
  assert.equal(docsObligation(whitespaceReason).required, true, "a whitespace-only reason leaves the obligation required");
});
