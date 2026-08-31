/**
 * TRANSITION — noteRefusal/lastRefusal are a new pair: the surface can hold
 * one refusal sentence across a render so a message line can show it, and
 * the very next noteAllowed call (the next push arriving) clears it, so a
 * refusal from an earlier press never lingers past its own push.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteAllowed, noteRefusal, lastRefusal } from "./surfaceContract";

test("noteRefusal stores a sentence that lastRefusal returns, and a new push clears it", () => {
  const sentence = "The Build control is off — a run is in flight.";

  noteRefusal(sentence);
  assert.equal(lastRefusal(), sentence, "lastRefusal must return exactly the sentence just stored");

  // A new push arrives: noteAllowed is called again with the push's allowed
  // list, and the held refusal must not survive it.
  noteAllowed(["build"], "understood");
  assert.equal(lastRefusal(), undefined, "the next noteAllowed call must clear the held refusal");
});
