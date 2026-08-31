/**
 * INVARIANT — a reader's own gesture is the only thing that may move the
 * tab: nextView on a "reader-tab" event must return the tab the reader
 * asked for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

test("a reader-tab event moves the tab to the one the reader chose", () => {
  const state: ViewState = { tab: "write", flowView: "workers", awaited: null };
  const event: ViewEvent = { kind: "reader-tab", tab: "intent", hasReport: false };
  const next = nextView(state, event);
  assert.equal(next.tab, "intent", "the reader's chosen tab must be shown");
});
