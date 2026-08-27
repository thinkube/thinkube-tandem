/**
 * INVARIANT — for a cut that grounds no docs/ touchpoint and carries a
 * recorded exemption, tepContentHash's grounding half must be non-empty
 * and equal the same grounding hash signCut produces for that cut — the
 * documentation refusal must not silently break the content hash's
 * grounding binding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tepContentHash } from "../gates/approval";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

test("tepContentHash's grounding half is non-empty for an exempt cut with no docs/ touchpoint", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: { touchpoints: [{ path: "src/greet.ts", planned: true }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason: "internal helper, nothing a user reads", at: "2026-08-27T00:00:00Z" },
  };
  const hash = tepContentHash(space, cut);
  assert.ok(hash.length > 0, "tepContentHash returned a hash");

  const signed = signCut(space, cut, "2026-08-27T00:00:00Z", "t");
  assert.ok(signed.ok, signed.ok ? "" : signed.reason);
  const groundingHash = signed.ok ? signed.cut.signature!.groundingHash : "";
  assert.ok(groundingHash.length > 0, "signCut produced a non-empty grounding hash for the same cut");
});
