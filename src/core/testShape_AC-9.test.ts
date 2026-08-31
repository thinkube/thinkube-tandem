/**
 * INVARIANT — one person-facing name per action: every human entry in the
 * affordance registry names a control, and that control's name must
 * appear, word for word, in the gesture the same entry gives — so a
 * control cannot be called one thing in a refusal sentence and another
 * thing in an instruction. Both the registry and the control-name table
 * are imported and driven here, never scraped from a file as text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AFFORDANCES } from "../surfaces/affordances";
import { CONTROL_NAMES } from "../surfaces/surfaceContract";

test("every human affordance entry's control name appears in its own gesture", () => {
  const humanEntries = Object.entries(AFFORDANCES).filter(([, entry]) => entry.kind === "human");
  assert.ok(humanEntries.length > 0, "the registry carries at least one human-facing entry to check");

  for (const [action, entry] of humanEntries) {
    if (entry.kind !== "human") continue;
    const controlName = CONTROL_NAMES[action];
    assert.ok(controlName, `${action} has a control name in CONTROL_NAMES`);
    assert.ok(
      entry.affordance.gesture.includes(controlName),
      `${action}'s gesture "${entry.affordance.gesture}" names its control "${controlName}"`,
    );
  }
});
