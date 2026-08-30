/**
 * INVARIANT — a move asked for earlier must never land later: nextView on
 * a "reader-tab" event must clear any awaited move, since the reader has
 * just gone somewhere on their own and any queued auto-move is now stale.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

test("a reader-tab event clears a previously awaited move", () => {
  const state: ViewState = { tab: "write", flowView: "workers", awaited: "work" };
  const event: ViewEvent = { kind: "reader-tab", tab: "intent", hasReport: false };
  const next = nextView(state, event);
  assert.equal(next.awaited, null, "a stale awaited move must not survive a reader's own tab choice");
});
