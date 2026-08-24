/**
 * INVARIANT — a cut whose promises DO land documentation must sign with no
 * reason recorded: the new refusal exists to catch cuts that document
 * nothing, never to demand a reason from a cut that already documented
 * its work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";
import type { Space, Change } from "./schema";

function spaceWith(nodes: Change[]): Space {
  return { ...emptySpace(), nodes };
}

const documented: Change = {
  id: "n1",
  sentence: "add a helper and document it",
  serves: [],
  needs: [],
  acceptance: [{ id: "c1", text: "it works" }],
  grounding: {
    touchpoints: [
      { path: "src/helper.ts", planned: true },
      { path: "docs/modules/ROOT/pages/helper.adoc", planned: true },
    ],
    stamp: [],
  },
};

test("signCut signs a cut that lands documentation, with no reason recorded", () => {
  const space = spaceWith([documented]);
  const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-24T00:00:00Z", "t");
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
});
