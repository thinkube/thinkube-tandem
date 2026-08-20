// INVARIANT — docsGateMode must never reach into signing: signCut has no
// docsGateMode parameter and always requires documentation or a written
// exemption, while the setting continues to govern only acceptDelivery's
// blocking-vs-advisory behavior. This split of ownership must hold for as
// long as both gates decide documentation.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { signCut } from "../out-test/gates/sign.js";

test("signCut refuses a cut landing no documentation and carrying no exemption even when docsGateMode would be advisory", () => {
  const space = {
    ...emptySpace(),
    asks: [{ id: "ask-1", text: "add a greeting", at: "t" }],
    nodes: [
      {
        id: "n1",
        sentence: "a greeting function",
        serves: ["ask-1"],
        needs: [],
        acceptance: [{ id: "c1", text: "greets by name" }],
        grounding: { touchpoints: [{ path: "src/greet.ts" }], stamp: [] },
      },
    ],
  };
  const cut = { id: "cut-1", changeIds: ["n1"] };

  // signCut carries no docsGateMode parameter — its full call shape (space,
  // cut, at, author, tepNumber) is exercised as-is. The refusal must stand
  // exactly as it does when no accept-time mode is in play at all, proving
  // the setting has no channel into signing: there is nowhere to pass it.
  const r = signCut(space, cut, "2026-08-20T00:00:00Z", "user");
  assert.equal(r.ok, false, "docsGateMode governs acceptDelivery only, never signCut");
  assert.match(r.reason, /document/i, "the refusal says documentation is missing, not a mode setting");
});
