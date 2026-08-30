/**
 * INVARIANT — a refusal note (why the last build did not start) rides on
 * the SAME single notice, never a second one beside it: when runNote is
 * present, signedIdleNotice must still return exactly one object, and that
 * object's sentence must carry the refusal note's text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("a refusal note becomes the one notice's sentence, not a second notice", () => {
  const runNote = "The build could not start: no forge is reachable for this repository.";

  const notice = signedIdleNotice({
    unrun: { id: "cut-1", tepId: "TEP-user-1" },
    running: false,
    runNote,
  });

  assert.ok(notice, "a notice must still be returned");
  assert.equal(Array.isArray(notice), false, "still exactly one object, never a list");
  assert.equal(notice!.sentence, runNote, "the refusal note's own words become the notice's sentence");
});
