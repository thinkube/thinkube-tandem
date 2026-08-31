/**
 * INVARIANT — with no signed undelivered work at all, signedIdleNotice must
 * return undefined: nothing is waiting to be re-run, so there is nothing
 * for the notice to say, and no page should show it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("signedIdleNotice is undefined when there is no signed undelivered work", () => {
  const notice = signedIdleNotice({
    unrun: undefined,
    running: false,
  });

  assert.equal(notice, undefined, "nothing signed-and-undelivered means nothing to notice");
});
