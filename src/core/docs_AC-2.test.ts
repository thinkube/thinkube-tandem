/**
 * signCut refuses a cut whose members ground no documentation path and that
 * carries no exemption, and the refusal says documentation is missing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../gates/sign";
import type { Space } from "./schema";

function baseSpace(): Space {
  return {
    asks: [],
    nodes: [
      {
        id: "n1",
        sentence: "Add a widget.",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "ac1", text: "widget renders" }],
      },
    ],
    units: [],
    cuts: [],
    deliveries: [],
    questions: [],
  } as unknown as Space;
}

test("signCut refuses an undocumented, unexempted cut, saying documentation is missing", () => {
  const result = signCut(baseSpace(), { id: "c1", changeIds: ["n1"] }, "2026-08-22T00:00:00.000Z");
  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason.toLowerCase(), /documentation/);
    assert.match(result.reason.toLowerCase(), /missing/);
  }
});
