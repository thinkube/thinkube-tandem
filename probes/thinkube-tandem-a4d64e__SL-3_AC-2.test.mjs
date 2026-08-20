// WHY (INVARIANT): the exemption reason is part of what the signature
// binds. If the reason on a signed cut is edited afterwards, that is a
// change to the grounded facts under the signature — verifyCutSignature
// must report it as grounding drift, the same way it reports any other
// post-signature edit to what the cut grounds.
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

test("verifyCutSignature reports grounding drift once the signed exemption reason is edited", () => {
  const { space, changeId } = makeSpace();
  const cut = {
    id: "cut-1",
    changeIds: [changeId],
    exemption: { reason: "this is a config-only change; nothing to document" },
  };
  const signed = signCut(space, cut, "2026-08-20T09:00:00Z", "user");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);
  assert.equal(verifyCutSignature(space, signed.cut).ok, true, "unedited, the signature holds");

  const edited = {
    ...signed.cut,
    exemption: { ...signed.cut.exemption, reason: "a different reason, typed after signing" },
  };
  const v = verifyCutSignature(space, edited);
  assert.ok(!v.ok, "an edited reason must not still verify");
  assert.equal(v.drift, "grounding", "the drift is grounding — the reason is part of what was signed");
});
