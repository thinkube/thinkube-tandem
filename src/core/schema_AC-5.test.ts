/**
 * INVARIANT — signCut signs a cut that grounds no docs/ touchpoint once a
 * docs exemption carrying a reason is recorded on it: a recorded reason is
 * the only other way past the documentation rule besides landing docs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

test("signCut signs a cut with no docs/ touchpoint once it carries a docs exemption with a reason", () => {
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
  const r = signCut(space, cut, "2026-08-27T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
