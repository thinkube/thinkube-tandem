/**
 * INVARIANT — a run in flight is never described as idle: signedIdleNotice
 * must return undefined while running is true, even when there is signed
 * work that has not yet delivered. The notice is about nothing happening;
 * once a run starts, something is happening and the notice would lie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signedIdleNotice } from "./runGate";

test("signedIdleNotice is undefined while a run is in flight", () => {
  const notice = signedIdleNotice({
    unrun: { id: "cut-1", tepId: "TEP-user-1" },
    running: true,
  });

  assert.equal(notice, undefined, "a running build must never show the signed-idle notice");
});
