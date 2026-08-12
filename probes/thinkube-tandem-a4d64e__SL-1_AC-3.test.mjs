// WHY (INVARIANT): once a cut is validly waived, the human's own words for
// why must come back unchanged — the reason is never paraphrased or dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsObligation } from "../out/core/schema.js";

test("a waived cut reports the human's reason back verbatim", () => {
  const reason = "the change is an internal refactor with no user-facing surface";
  const cut = { id: "cut-1", changeIds: ["node-1"], docs: { waived: true, reason } };
  const obligation = docsObligation(cut);
  assert.equal(obligation.required, false, "a validly waived cut is not required");
  assert.equal(obligation.reason, reason, "the reason rides back byte for byte");
});
