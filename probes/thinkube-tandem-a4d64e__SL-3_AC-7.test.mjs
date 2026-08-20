// WHY (INVARIANT): renderCutScreen is what signCut hashes before signing
// and what verifyCutSignature re-renders after. The exemption's reason
// must appear in that render word for word, but the signing moment must
// never appear in it — if it did, stamping "at" onto the cut at the
// moment of signing would move the render hash out from under its own
// signature.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { renderCutScreen } from "../out-test/gates/render.js";
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

test("renderCutScreen prints the exemption reason word for word and never a signing moment", () => {
  const { space, changeId } = makeSpace();
  const reason = "config-only change; nothing to document, verbatim reason here";
  const cut = { id: "cut-1", changeIds: [changeId], exemption: { reason } };
  const screen = renderCutScreen(space, cut);
  assert.ok(screen.includes(reason), "the reason appears word for word");

  const signed = signCut(space, cut, "2026-08-20T09:00:00Z", "user");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);
  const screenAfterSigning = renderCutScreen(space, signed.cut);
  assert.equal(
    screenAfterSigning,
    screen,
    "the render must be byte-identical before and after signing — the signing moment does not appear in it",
  );
  assert.ok(
    !screenAfterSigning.includes("2026-08-20T09:00:00Z"),
    "the signing moment itself never appears on the render",
  );
});
