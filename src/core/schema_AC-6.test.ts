/**
 * INVARIANT — signCut signs a cut that grounds a docs/ touchpoint and
 * carries no exemption: landing documentation is enough on its own,
 * without also requiring a recorded exemption.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

test("signCut signs a cut that grounds a docs/ touchpoint and carries no exemption", () => {
  const space = {
    ...emptySpace(),
    nodes: [
      {
        id: "n1",
        sentence: "greet the user",
        serves: [],
        needs: [],
        acceptance: [{ id: "c1", text: "greet() returns hello" }],
        grounding: {
          touchpoints: [
            { path: "src/greet.ts", planned: true },
            { path: "docs/modules/ROOT/pages/greet.adoc", planned: true },
          ],
          stamp: [],
        },
      },
    ],
  };
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-27T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
