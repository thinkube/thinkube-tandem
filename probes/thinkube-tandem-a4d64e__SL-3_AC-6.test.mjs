// WHY (INVARIANT): what signCut hashes before minting a signature and what
// verifyCutSignature re-renders after must be the same text for an
// excused cut — otherwise the signature would fail its own re-check the
// instant it was minted. verifyCutSignature must return ok on the exact
// cut signCut just handed back, when that cut carries an exemption.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { signCut, verifyCutSignature } from "../out-test/gates/sign.js";

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

test("verifyCutSignature is ok on the cut signCut just returned for an excused cut", () => {
  const { space, changeId } = makeSpace();
  const cut = {
    id: "cut-1",
    changeIds: [changeId],
    exemption: { reason: "config-only change; nothing to document" },
  };
  const signed = signCut(space, cut, "2026-08-20T09:00:00Z", "user");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);
  const v = verifyCutSignature(space, signed.cut);
  assert.equal(v.ok, true, v.ok ? "" : `${v.drift}: ${v.reason}`);
});
