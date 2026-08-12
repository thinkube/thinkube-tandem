// WHY (INVARIANT): a cut that carries no documentation decision at all must
// always report its obligation as required — silence is never a waiver.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docsObligation } from "../out/core/schema.js";

test("a cut with no documentation decision reports its obligation as required", () => {
  const cut = { id: "cut-1", changeIds: ["node-1"] };
  const obligation = docsObligation(cut);
  assert.equal(obligation.required, true, "no decision recorded ⇒ required by default");
});
