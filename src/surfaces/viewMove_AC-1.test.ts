/**
 * INVARIANT — a push from the host never moves the shown page: nextView on
 * a "push" event must return the same tab it was given, for every one of
 * the four tabs. This is the plain rule in force: only a reader's own
 * gesture may move the tab; the host's own updates never do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextView, ViewState, ViewEvent } from "./viewMove";

const TABS: ViewState["tab"][] = ["write", "intent", "work", "flow"];

test("a push event leaves the tab exactly as given, for every tab", () => {
  for (const tab of TABS) {
    const state: ViewState = { tab, flowView: "workers", awaited: null };
    const event: ViewEvent = { kind: "push", workedOut: false };
    const next = nextView(state, event);
    assert.equal(next.tab, tab, `push must not move the tab away from ${tab}`);
  }
});
