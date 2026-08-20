// WHY (INVARIANT): the reason a person types to excuse documentation must
// ride the signed cut together with the moment it was signed — signCut is
// the one place that moment is stamped, so the pair (reason, signing time)
// is always written together onto the cut it returns.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
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

test("signCut stamps the recorded exemption reason and the signing moment onto the signed cut", () => {
  const { space, changeId } = makeSpace();
  const cut = {
    id: "cut-1",
    changeIds: [changeId],
    exemption: { reason: "this is a config-only change; nothing to document" },
  };
  const r = signCut(space, cut, "2026-08-20T09:00:00Z", "user");
  assert.ok(r.ok, r.ok ? "" : r.reason);
  assert.ok(r.cut.exemption, "the signed cut carries the exemption");
  assert.equal(
    r.cut.exemption.reason,
    "this is a config-only change; nothing to document",
    "the recorded reason rides the signed cut, word for word",
  );
  // The moment of signing rides beside the reason on the cut, not only
  // inside the signature block — the pair is written together.
  assert.equal(
    r.cut.exemption.at,
    "2026-08-20T09:00:00Z",
    "the moment of signing is stamped onto the exemption alongside the reason",
  );
});
