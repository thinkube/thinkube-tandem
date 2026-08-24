/**
 * The documentation rule changes what a signature covers, so
 * SIGNATURE_RULE is raised. A cut signed under the OLD rule must be
 * reported as unchecked, never as drifted — the render it was signed
 * against no longer matches for a reason that has nothing to do with the
 * person or the promises, and a false "drift" would refuse a cut nobody
 * touched.
 *
 * ONE-TIME TRANSITION — proves the rule bump this slice makes (raising
 * SIGNATURE_RULE for the new documentation line on the cut review) does
 * not turn every already-signed cut into reported drift. Once the rule
 * has shipped and stays stable, this guards nothing new — it is done.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCutSignature, SIGNATURE_RULE } from "./sign";
import { emptySpace } from "../core/schema";

test("verifyCutSignature reports a cut signed under the previous signature rule as unchecked rather than drifted", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "a promise signed before the documentation rule existed",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "it works" }],
        grounding: { touchpoints: [{ path: "src/x.ts", planned: false }], stamp: [] },
      },
    ],
  };
  const cut = {
    id: "cut-1",
    changeIds: ["n1"],
    signature: {
      at: "2026-08-01T00:00:00Z",
      renderHash: "stale-hash-from-before-the-rule-bump",
      groundingHash: "stale-grounding-hash",
      rule: SIGNATURE_RULE - 1,
    },
  };
  const verdict = verifyCutSignature(space, cut);
  assert.equal(verdict.ok, true, "an older-rule signature is not reported as failing");
  assert.ok(
    "unchecked" in verdict && !!verdict.unchecked,
    "the verdict names the signature as unchecked, not silently green",
  );
  assert.ok(
    !("drift" in verdict),
    "an older-rule signature must never be reported as drift",
  );
});
