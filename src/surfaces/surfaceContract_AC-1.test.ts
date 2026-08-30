/**
 * TRANSITION — refusalSentence is a new seam: a control that is off now
 * says which control it is and why, in one sentence, instead of a bare
 * phase-only reason. For the "build" control refused during a run in
 * flight, the sentence must carry both the control's person-facing name
 * (from CONTROL_NAMES) and the running-phase reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTROL_NAMES, refusalSentence } from "./surfaceContract";

test('refusalSentence("build", "running") names the build control and the running-phase reason', () => {
  const sentence = refusalSentence("build", "running");

  assert.equal(typeof sentence, "string");
  assert.ok(sentence.length > 0, "the sentence must not be blank");

  const controlName = CONTROL_NAMES["build"];
  assert.ok(controlName, "the build action must have a person-facing control name");
  assert.ok(
    sentence.includes(controlName),
    `the sentence must name the control ("${controlName}"): got "${sentence}"`,
  );
  assert.ok(
    /run.*flight|flight.*run|stop it first/i.test(sentence),
    `the sentence must give the running-phase reason: got "${sentence}"`,
  );
});
