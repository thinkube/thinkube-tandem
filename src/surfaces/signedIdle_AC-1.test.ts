/**
 * HELD-OUT — the signed-idle notice is the one seam a page reads instead of
 * wording "this work is signed and nothing was delivered" itself. This
 * drives signedIdleNotice's full contract as one account: it is silent
 * while a run is in flight or when there is no signed, undelivered work; it
 * is otherwise exactly one object (never a list) carrying a non-empty
 * heading distinct from its sentence; and a refusal note, when present,
 * becomes that same notice's sentence verbatim rather than a second notice
 * beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("signedIdleNotice is silent whenever a run is in flight, whatever else is true", () => {
  assert.equal(
    signedIdleNotice({ unrun: { id: "cut-1", tepId: "TEP-user-1" }, running: true }),
    undefined,
    "signed, undelivered work says nothing while the run is in flight",
  );
  assert.equal(
    signedIdleNotice({ unrun: { id: "cut-1", tepId: "TEP-user-1" }, running: true, runNote: "some note" }),
    undefined,
    "a refusal note does not override the in-flight silence",
  );
});

test("signedIdleNotice is silent whenever there is no signed, undelivered work", () => {
  assert.equal(
    signedIdleNotice({ running: false }),
    undefined,
    "no unrun cut means nothing to notice",
  );
  assert.equal(
    signedIdleNotice({ running: true }),
    undefined,
    "no unrun cut and a run in flight is still silent",
  );
});

test("signedIdleNotice otherwise returns exactly one object with a distinct, non-empty heading", () => {
  const notice = signedIdleNotice({ unrun: { id: "cut-1", tepId: "TEP-user-1" }, running: false });

  assert.ok(notice, "signed, undelivered work with nothing running produces a notice");
  assert.equal(Array.isArray(notice), false, "the notice is a single object, never a list");
  assert.equal(typeof notice, "object");
  assert.equal(typeof notice!.heading, "string", "heading is its own field");
  assert.ok(notice!.heading.length > 0, "heading is never blank");
  assert.equal(typeof notice!.sentence, "string", "sentence is its own field");
  assert.notEqual(notice!.heading, notice!.sentence, "heading is not the sentence restated");
});

test("a refusal note rides as the one notice's sentence, never a second notice beside it", () => {
  const runNote = "The build could not start: no forge is reachable for this repository.";

  const notice = signedIdleNotice({ unrun: { id: "cut-1", tepId: "TEP-user-1" }, running: false, runNote });

  assert.ok(notice, "a notice is still returned when a refusal note is present");
  assert.equal(Array.isArray(notice), false, "still exactly one object");
  assert.equal(notice!.sentence, runNote, "the refusal note's own wording becomes the sentence verbatim");
});
