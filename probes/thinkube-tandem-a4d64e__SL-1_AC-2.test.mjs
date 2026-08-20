// INVARIANT — signing must always refuse a cut whose members ground no
// documentation path when the cut carries no written exemption, and the
// refusal must say documentation is missing (not some other reason) so the
// human knows what to do next. This must hold for every future cut, not
// just today's.
import { test } from "node:test";
import assert from "node:assert/strict";

import { emptySpace } from "../out-test/core/schema.js";
import { signCut } from "../out-test/gates/sign.js";

function baseSpace() {
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
  return space;
}

test("signCut refuses a cut whose members ground no documentation path and carries no exemption", () => {
  const space = baseSpace();
  const cut = { id: "cut-1", changeIds: ["n1"] };
  const r = signCut(space, cut, "2026-08-20T00:00:00Z");
  assert.equal(r.ok, false);
  assert.match(r.reason, /document/i, "the refusal says documentation is missing");
});
