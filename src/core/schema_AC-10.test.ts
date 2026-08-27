/**
 * INVARIANT — signCut must never sign a cut that neither lands
 * documentation nor carries a recorded exemption. This is the general rule
 * that src/gates/sign.test.ts must not contain any case contradicting: no
 * test anywhere may assert that such a cut signs successfully.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import { emptySpace } from "./schema";

test("signCut never signs a cut with no docs/ touchpoint and no exemption, regardless of how the promise is proved", () => {
  const cases = [
    // Runnable-check promise, no docs, no exemption.
    {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a thing",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "it works" }],
          grounding: { touchpoints: [{ path: "src/x.ts", planned: true }], stamp: [] },
        },
      ],
    },
    // Assessment-kind check, no docs, no exemption.
    {
      ...emptySpace(),
      nodes: [
        {
          id: "n1",
          sentence: "a thing reviewed by eye",
          serves: [],
          needs: [],
          acceptance: [{ id: "c1", text: "it reads correctly", kind: "assessment" as const }],
          grounding: { touchpoints: [{ path: "src/y.ts", planned: false }], stamp: [] },
        },
      ],
    },
  ];
  for (const space of cases) {
    const r = signCut(space, { id: "cut-1", changeIds: ["n1"] }, "2026-08-27T00:00:00Z", "t");
    assert.equal(r.ok, false, "a cut with no docs/ touchpoint and no exemption must never sign");
    assert.match(r.ok ? "" : r.reason, /documentation/i);
  }
});
