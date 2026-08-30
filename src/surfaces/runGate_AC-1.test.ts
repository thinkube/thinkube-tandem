/**
 * TRANSITION — signedIdleNotice is a new seam: one function now decides the
 * "this work is signed and nothing was delivered" notice, in place of each
 * page wording it separately. It must return exactly one notice — a single
 * object, never a list — when there is signed work that has not delivered
 * and nothing is running, so a page can render it directly without folding
 * an array itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("signed, undelivered work with nothing running produces exactly one notice object", () => {
  const notice = signedIdleNotice({
    unrun: { id: "cut-1", tepId: "TEP-user-1" },
    running: false,
  });

  assert.ok(notice, "a notice must be returned");
  assert.equal(Array.isArray(notice), false, "the notice must be a single object, never a list");
  assert.equal(typeof notice, "object");
});
