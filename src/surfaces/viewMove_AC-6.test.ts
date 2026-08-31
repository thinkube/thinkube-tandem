/**
 * INVARIANT — an awaited move only lands when its condition is met: after
 * the reader asks to await the work tab, a push reporting workedOut false
 * must leave the tab unchanged and keep the awaited move standing, so the
 * reader is not moved before the work is actually worked out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

test("a not-worked-out push after reader-awaits-work leaves the tab and keeps the wait", () => {
  const start: ViewState = { tab: "intent", flowView: "workers", awaited: null };
  const armed = nextView(start, { kind: "reader-awaits-work" } as ViewEvent);
  const next = nextView(armed, { kind: "push", workedOut: false });

  assert.equal(next.tab, armed.tab, "the tab must not move while the work is still not worked out");
  assert.equal(next.awaited, "work", "the awaited move must still be standing, waiting for its condition");
});
