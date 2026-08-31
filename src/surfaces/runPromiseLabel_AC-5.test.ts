/**
 * INVARIANT: stateFace must never hand the card a blank word — a card
 * with no word at the far zoom is a card with no second carrier for its
 * state at all. This must hold for every named unit state and for any
 * string the run ever produces that stateFace does not recognise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateFace } from "./runCardFace";

test("stateFace returns a short, non-empty word for every named unit state", () => {
  const states = ["ready", "running", "parked", "done", "failed", "blocked"];
  for (const s of states) {
    const face = stateFace(s);
    assert.ok(face.word.length > 0, `stateFace(${s}) must not return a blank word`);
    assert.ok(face.word.length <= 12, `stateFace(${s}) must return a short word, not a sentence`);
  }
});

test("stateFace returns a non-empty word for a state string it does not recognise", () => {
  const face = stateFace("some-future-state-nobody-named-yet");
  assert.ok(
    face.word.length > 0,
    "an unrecognised state must still get a word — never a blank the card renders as nothing",
  );
});
