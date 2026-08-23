/**
 * With docsGateMode set to advisory, signCut still refuses a cut that lands
 * no documentation and carries no exemption — the setting governs the accept
 * gate only, and the refusal says so.
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

test("signCut refuses an undocumented, unexempted cut under advisory too, and the refusal says the setting is the accept gate's", () => {
  const space = baseSpace();
  const cut = { id: "c1", changeIds: ["n1"] };

  const strict = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  const advisory = signCut(
    { ...space, docsGateMode: "advisory" } as unknown as Space,
    cut,
    "2026-08-22T00:00:00.000Z",
  );

  assert.equal(strict.ok, false);
  assert.equal(advisory.ok, false, "advisory must not soften the sign gate");
  if (strict.ok === false && advisory.ok === false) {
    assert.equal(
      strict.reason,
      advisory.reason,
      "the refusal must not vary with docsGateMode",
    );
    assert.match(advisory.reason.toLowerCase(), /documentation/);
    assert.match(
      advisory.reason.toLowerCase(),
      /accept/,
      "the refusal must say the setting governs the accept gate",
    );
  }
});
