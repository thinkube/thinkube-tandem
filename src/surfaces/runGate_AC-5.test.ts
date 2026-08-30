/**
 * INVARIANT — the notice carries a heading field that is data in its own
 * right, not text a page must parse out of the sentence: heading and
 * sentence are two separate fields on the object signedIdleNotice returns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("the notice's heading is its own field, not derived by parsing the sentence", () => {
  const notice = signedIdleNotice({
    unrun: { id: "cut-1", tepId: "TEP-user-1" },
    running: false,
  });

  assert.ok(notice, "a notice must be returned");
  assert.equal(typeof notice!.heading, "string", "heading is a field on the notice");
  assert.ok(notice!.heading.length > 0, "heading is not blank");
  assert.equal(typeof notice!.sentence, "string", "sentence is a field on the notice");
  assert.notEqual(
    notice!.heading,
    notice!.sentence,
    "heading and sentence are two distinct pieces of text, not one field standing in for both",
  );
});
