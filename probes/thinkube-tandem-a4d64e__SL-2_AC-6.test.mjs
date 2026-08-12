// AC-6 (INVARIANT): signing refuses a cut whose waiver has no reason, and
// the refusal says a reason is required — the gate, not just the surface,
// must enforce that a waiver cannot exist without a reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { signCut } = require("../out/gates/sign.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add a print-friendly view", "t");
  s = a.space;
  const r = addNode(s, {
    sentence: "a print button opens a print-friendly layout",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the print layout opens" }],
    grounding: { touchpoints: [{ path: "src/view/print.ts" }], stamp: [] },
  });
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("signing a cut whose waiver carries an empty reason is refused", () => {
  const { space, changeIds } = makeSpace();
  const cut = { id: "cut-1", changeIds, docs: { waived: true, reason: "" } };
  const r = signCut(space, cut, "t1");
  assert.equal(r.ok, false, "an empty-reason waiver refuses the signature");
  assert.match(r.reason, /reason/i, "the refusal says a reason is required");
});

test("signing a cut whose waiver carries a whitespace-only reason is refused", () => {
  const { space, changeIds } = makeSpace();
  const cut = { id: "cut-1", changeIds, docs: { waived: true, reason: "   " } };
  const r = signCut(space, cut, "t1");
  assert.equal(r.ok, false, "a whitespace-only reason is treated the same as no reason");
  assert.match(r.reason, /reason/i, "the refusal names the missing reason");
});
