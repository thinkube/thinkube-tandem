/**
 * INVARIANT — a push from the host never moves the shown flow view either:
 * nextView on a "push" event must return the same flowView it was given,
 * regardless of whether the push reports the work as worked out. Only a
 * reader's gesture may change what is shown; the host's report of progress
 * never does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

test("a push event leaves flowView unchanged whether or not the work is worked out", () => {
  for (const workedOut of [true, false]) {
    const state: ViewState = { tab: "flow", flowView: "report", awaited: null };
    const event: ViewEvent = { kind: "push", workedOut };
    const next = nextView(state, event);
    assert.equal(
      next.flowView,
      "report",
      `push with workedOut=${workedOut} must not move the flow view`,
    );
  }
});
