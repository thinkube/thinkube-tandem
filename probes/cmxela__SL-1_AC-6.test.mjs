// WHY (INVARIANT): now that two gates decide documentation, signing must
// always require documentation or a written exemption — signCut takes no
// docsGateMode relaxation, because that setting governs the accept gate
// only. This must hold for as long as docsGateMode exists as an
// accept-only knob: signCut's own refusal never varies by it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signCut } from "../out-test/gates/sign.js";

function baseSpace() {
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
  };
}

test("signCut refuses an undocumented, unexempted cut the same way whether or not an advisory docsGateMode is configured elsewhere, and its refusal says the setting governs accept only", () => {
  // signCut has no docsGateMode parameter to relax by — passing extra
  // trailing arguments (as acceptDelivery's caller would with its own
  // docsGateMode) must not change signCut's verdict or its call shape.
  const space = baseSpace();
  const cut = { id: "c1", changeIds: ["n1"] };
  const strict = signCut(space, cut, "2026-08-22T00:00:00.000Z");
  const withExtraArg = signCut(space, cut, "2026-08-22T00:00:00.000Z", "user", undefined, "advisory");
  assert.equal(strict.ok, false);
  assert.equal(withExtraArg.ok, false);
  if (strict.ok === false && withExtraArg.ok === false) {
    assert.equal(strict.reason, withExtraArg.reason);
    assert.match(strict.reason.toLowerCase(), /documentation/);
    assert.match(strict.reason.toLowerCase(), /accept/);
  }
});
