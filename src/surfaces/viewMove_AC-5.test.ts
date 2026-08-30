/**
 * TRANSITION — proves the new arm-and-arrive sequence: after the reader
 * asks to await the work tab (a "reader-awaits-work" event), a later push
 * reporting workedOut true must carry the reader onto the work tab and
 * clear the awaited move, so the awaited arrival actually happens exactly
 * once and does not linger.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

test("a worked-out push after reader-awaits-work arrives on the work tab and clears the wait", () => {
  const start: ViewState = { tab: "intent", flowView: "workers", awaited: null };
  const armed = nextView(start, { kind: "reader-awaits-work" } as ViewEvent);
  const next = nextView(armed, { kind: "push", workedOut: true });

  assert.equal(next.tab, "work", "the awaited work tab must be shown once the work is worked out");
  assert.equal(next.awaited, null, "the awaited move must be cleared once it has landed");
});
