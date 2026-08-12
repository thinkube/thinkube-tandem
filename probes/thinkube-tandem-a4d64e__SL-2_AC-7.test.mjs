// AC-7 (INVARIANT): once a waiver carries a real reason, signing succeeds
// and the signed cut still carries that reason — the decision is not lost
// or reset by the act of signing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { emptySpace } = require("../out/core/schema.js");
const { addAsk, addNode } = require("../out/core/intent.js");
const { signCut } = require("../out/gates/sign.js");

function makeSpace() {
  let s = emptySpace();
  const a = addAsk(s, "add an internal feature flag for A/B testing", "t");
  s = a.space;
  const r = addNode(s, {
    sentence: "an internal flag toggles the A/B experiment",
    serves: [a.added.id],
    needs: [],
    acceptance: [{ id: "c1", text: "the flag toggles the experiment" }],
    grounding: { touchpoints: [{ path: "src/experiments/flag.ts" }], stamp: [] },
  });
  s = r.space;
  return { space: s, changeIds: [r.added.id] };
}

test("a cut waived with a real reason signs, and the signed cut carries that reason", () => {
  const { space, changeIds } = makeSpace();
  const reason = "internal-only experiment flag, never user-facing";
  const cut = { id: "cut-1", changeIds, docs: { waived: true, reason } };
  const r = signCut(space, cut, "t1");
  assert.equal(r.ok, true, "a waiver with a real reason does not block signing");
  assert.equal(
    r.cut.docs && r.cut.docs.reason,
    reason,
    "the signed cut carries the human's reason verbatim",
  );
});
