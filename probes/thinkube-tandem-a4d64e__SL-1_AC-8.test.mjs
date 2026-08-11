// WHY (INVARIANT): for a waived cut, the internal signCut call inside
// tepContentHash must itself succeed (the waiver travels with the cut it
// hashes), and the grounding half of the resulting hash must be non-empty —
// a waived cut is not a lesser, unbound approval.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace, Space } from "../src/core/schema.ts";
import { addAsk, addNode } from "../src/core/intent.ts";
import { tepContentHash } from "../src/gates/approval.ts";

test("a waived cut's content hash is computed over a non-empty grounded half", () => {
  let s = emptySpace();
  const a = addAsk(s, "add an undocumented thing", "t");
  assert.ok(a.ok);
  s = a.space;
  const n = addNode(s, {
    sentence: "a promise nowhere documented",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  assert.ok(n.ok);
  s = n.space;

  const waivedCut = {
    changeIds: [n.added.id],
    tepId: "TEP-t-1",
    docs: { waived: true, reason: "internal-only, no user surface" },
  };
  const hash = tepContentHash(s, waivedCut);
  assert.ok(typeof hash === "string" && hash.length > 0, "a hash is produced for a waived cut");

  // Sanity: an unwaived, undocumented cut fails inside signCut, so its
  // grounding half is empty — the waived cut's hash must differ from it,
  // proving the grounded half is genuinely non-empty for the waived case.
  const unwaivedCut = { changeIds: [n.added.id], tepId: "TEP-t-1" };
  const unwaivedHash = tepContentHash(s, unwaivedCut);
  assert.notEqual(hash, unwaivedHash, "the waived cut's hash reflects its non-empty grounding half");
});
