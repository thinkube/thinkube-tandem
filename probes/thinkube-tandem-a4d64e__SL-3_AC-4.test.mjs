// WHY (INVARIANT): tepContentHash rebuilds a bare cut from the changeIds
// alone before hashing it. If it drops the exemption on that rebuild, the
// inner signCut it calls refuses (no documentation, no exemption) and the
// grounding half of the hash goes empty — so the dispatch approval would
// never mint for an excused cut. The exemption must ride the rebuilt cut.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { tepContentHash } from "../out-test/gates/approval.js";
import { signCut } from "../out-test/gates/sign.js";

function makeSpace() {
  const s = emptySpace();
  s.asks.push({ id: "ask-1", text: "ship a change with no documentation", at: "t" });
  s.nodes.push({
    id: "node-1",
    sentence: "a change that lands only in code",
    serves: ["ask-1"],
    needs: [],
    acceptance: [{ id: "c1", text: "it works" }],
    grounding: { touchpoints: [{ path: "src/thing.ts" }], stamp: [] },
  });
  return { space: s, changeId: "node-1" };
}

test("tepContentHash carries the exemption into the rebuilt cut, so an excused cut still hashes a non-empty grounding half", () => {
  const { space, changeId } = makeSpace();
  const cut = {
    id: "cut-1",
    tepId: "TEP-user-1",
    changeIds: [changeId],
    exemption: { reason: "config-only change; nothing to document" },
  };
  const hash = tepContentHash(space, cut);
  assert.ok(hash, "a hash is produced");

  // If the exemption were dropped, the rebuilt bare cut would carry no
  // exemption and no documentation grounding — the inner signCut would
  // refuse it, collapsing the grounding half of the hash to empty. That
  // refused-hash is exactly what a hash over a cut with NO exemption and
  // no documentation would be — the two must differ.
  const bareNoExemption = { id: "cut-2", tepId: "TEP-user-1", changeIds: [changeId] };
  const refusedHash = tepContentHash(space, bareNoExemption);
  assert.notEqual(
    hash,
    refusedHash,
    "the excused cut must not hash the same as a cut whose inner sign was refused for missing documentation",
  );

  // Cross-check directly against the gate the hash depends on: signing the
  // exempted bare cut must succeed, proving the grounding half is real.
  const signed = signCut(space, { id: "pair", changeIds: [changeId], exemption: cut.exemption }, "t", "x");
  assert.ok(signed.ok, "the exemption lets the inner sign through, so the grounding half is non-empty");
});
