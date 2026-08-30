/**
 * INVARIANT — every caller of noteAllowed must hand it the phase the same
 * push carried, not just the allowed list. Without the phase, the sentence
 * refusalIfRefused renders for an action outside the allowed list can only
 * be the bare fallback, naming no control — so after recording an allowed
 * list together with a phase, the refused-press lookup for an action
 * outside that list must return a sentence naming the control and giving
 * that phase's own reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteAllowed, refusalIfRefused, refusalSentence, CONTROL_NAMES } from "./surfaceContract";

test("recording an allowed list with a phase makes the refused-press sentence name the control and the phase's reason", () => {
  noteAllowed(["rerun"], "signed");

  const sentence = refusalIfRefused("build");
  assert.ok(sentence, "build is outside the allowed list, so a refusal sentence must come back");

  const controlName = CONTROL_NAMES["build"];
  assert.ok(controlName, "the build action must have a control name");
  assert.ok(
    sentence!.includes(controlName),
    `the sentence must name the control ("${controlName}"): got "${sentence}"`,
  );

  assert.equal(
    sentence,
    refusalSentence("build", "signed"),
    "the sentence must match refusalSentence for the phase actually recorded with noteAllowed",
  );
});
