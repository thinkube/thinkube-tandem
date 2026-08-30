/**
 * INVARIANT: the state frame and the in-cut gold are two different marks
 * that must never collapse into one. This pins that none of the tones
 * stateFace can return for a live unit state names the in-cut mark
 * itself, so a card's state frame can never be read as "this is in the
 * cut" by accident.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { stateFace } from "./runCardFace";

test("no state tone stateFace returns names the in-cut mark", () => {
  const states = ["ready", "running", "parked", "done", "failed", "blocked"];
  const tones = states.map((s) => stateFace(s).tone);

  for (const tone of tones) {
    assert.notEqual(tone, "cut", `the ${tone} state's tone must not be the in-cut mark's own name`);
    assert.notEqual(tone, "gold", `the ${tone} state's tone must not be the in-cut mark's own name`);
  }
});

test("the state's mark and the in-cut mark are two different marks, not the same value reused", () => {
  // The in-cut mark is a card-level fact (CardData.inCut, rendered as
  // gold) — a mark about MEMBERSHIP in the cut. stateFace names a mark
  // about STATE. The two must be readable as different marks: neither
  // one of stateFace's possible tones is the literal the in-cut mark is
  // known by.
  const inCutMarkName = "cut";
  const states = ["ready", "running", "parked", "done", "failed", "blocked", "anything-unrecognised"];
  for (const s of states) {
    const face = stateFace(s);
    assert.notEqual(
      face.tone,
      inCutMarkName,
      `stateFace(${s}) must return a state tone, never the in-cut mark's own name`,
    );
  }
});
