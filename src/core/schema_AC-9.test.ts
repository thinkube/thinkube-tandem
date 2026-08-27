/**
 * TRANSITION — src/gates/sign.test.ts signs several cuts landing only in
 * src/ (the proof-anchor case, the repository-moved case, the
 * observation-only case, the redrawn-page case). Once the documentation
 * rule lands, each of those cases must ground a docs/ touchpoint or carry a
 * recorded exemption to keep signing — this proves that a cut shaped like
 * each of those cases only signs under one of the two allowed conditions,
 * so the existing suite can be brought under the rule without losing its
 * signature. This test's job is done once sign.test.ts is updated to match.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

// Shaped like the proof-anchor case in sign.test.ts: one node grounded only
// in src/, no docs/ path, no exemption.
const srcOnlySpace = () => ({
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
});

test("a cut grounded only in src/, as in the proof-anchor case, does not sign without docs or an exemption", () => {
  const r = signCut(srcOnlySpace(), { id: "cut-1", changeIds: ["n1"] }, "2026-08-27T00:00:00Z", "t");
  assert.equal(r.ok, false);
});

test("the same cut signs once it carries a recorded docs exemption, as the rule requires", () => {
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    docsExemption: { reason: "no user-facing behaviour to document", at: "2026-08-27T00:00:00Z" },
  };
  const r = signCut(srcOnlySpace(), cut, "2026-08-27T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});

// Shaped like the observation-only case: acceptance is empty but the
// promise carries an unverified observation instead — still grounded only
// in src/, so it still needs a docs decision.
test("an observation-only promise grounded only in src/ still needs a docs decision to sign", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "say plainly what the machine cannot see",
        serves: [],
        needs: [],
        acceptance: [],
        unverified: [{ text: "the tab strip shows two tabs", why: "only the running product can show it" }],
        grounding: { touchpoints: [{ path: "src/x.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const withoutDecision = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-23T00:00:00Z", "t");
  assert.equal(withoutDecision.ok, false);

  const withExemption = signCut(
    space,
    { id: "cut-1", changeIds: ["n1"], docsExemption: { reason: "purely internal", at: "2026-08-23T00:00:00Z" } },
    "2026-08-23T00:00:00Z",
    "t",
  );
  assert.equal(withExemption.ok, true, withExemption.ok ? "" : withExemption.reason);
});
