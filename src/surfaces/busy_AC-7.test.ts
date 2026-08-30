/**
 * INVARIANT — thinking about asks counts as busy even with no run: spaceBusy
 * returns a truthy, non-undefined value for a session-shaped object that is
 * grounding asks but has no run in flight, and returns undefined for one
 * that is truly idle. The status bar must report a space as busy while it
 * is working out what a person meant, not only while it is building.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spaceBusy } from "./busy";

test("spaceBusy reports a grounding-only session as busy, and an idle one as not busy", () => {
  const grounding = {
    running: false,
    groundingView: () => [
      { askId: "ask-1", label: "grounding", current: 1, total: 2 },
      { askId: "ask-2", label: "waiting", current: 0, total: 2 },
    ],
  };
  const idle = {
    running: false,
    groundingView: () => [],
  };

  const busy = spaceBusy("owner/grounding-space", "Grounding space", grounding);
  assert.ok(busy, "a session thinking about asks with no run must be reported busy");

  const notBusy = spaceBusy("owner/idle-space", "Idle space", idle);
  assert.equal(notBusy, undefined, "a truly idle session must not be reported busy");
});
