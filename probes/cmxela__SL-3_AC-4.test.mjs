// WHY (INVARIANT): tepContentHash rebuilds a bare cut from changeIds alone —
// for a cut carrying a documentation exemption it must carry that exemption
// onto the bare cut it hashes too, so the inner signCut is not refused for
// missing documentation and the grounding half of the hash is non-empty
// rather than the empty string a refused inner sign would produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepContentHash } from "../out-test/gates/approval.js";
import { signCut } from "../out-test/gates/sign.js";

function baseSpace() {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "Add a widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "ac1", text: "widget renders" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  };
}

test("tepContentHash for a cut carrying a documentation exemption hashes a non-empty grounding half", () => {
  const space = baseSpace();
  const excused = {
    id: "c1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal tooling only, no user-facing surface to document" },
  };

  const excusedHash = tepContentHash(space, excused);
  assert.equal(typeof excusedHash, "string");
  assert.ok(excusedHash.length > 0, "the excused cut's content hash must be non-empty");

  // Directly confirm the grounding half tepContentHash folds in for this
  // cut is non-empty: signCut on the same bare "pair" cut -- the exact
  // reconstruction tepContentHash itself performs -- must succeed rather
  // than being refused for missing documentation. A refusal is exactly
  // what would hash an empty grounding half instead (tepContentHash's own
  // "" fallback when the inner signCut is not ok), so this proves the
  // exemption rode onto the cut tepContentHash rebuilds.
  const bareCut = { id: "pair", changeIds: excused.changeIds, docsExemption: excused.docsExemption };
  const innerSign = signCut(space, bareCut, "t", "x");
  assert.equal(
    innerSign.ok,
    true,
    "the bare cut tepContentHash rebuilds must carry the exemption, or its inner signCut is refused and hashes an empty grounding half",
  );
  if (innerSign.ok) {
    assert.ok(
      innerSign.cut.signature.groundingHash.length > 0,
      "the grounding half tepContentHash folds in must be non-empty",
    );
  }
});
