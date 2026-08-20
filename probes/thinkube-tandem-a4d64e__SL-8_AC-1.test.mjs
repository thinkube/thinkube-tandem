// WHY (TRANSITION): before this slice a push reached whichever tab
// happened to be on top (the single module-level panel). This proves
// SpaceTabs.push, given a space key, reaches ONLY that key's own tab —
// the other open tab in the register receives nothing — proving the
// per-space routing landed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTab() {
  const pushes = [];
  return {
    pushes,
    revealed: 0,
    disposed: false,
    reveal() {
      this.revealed++;
    },
    dispose() {
      this.disposed = true;
    },
    isClosed() {
      return this.disposed;
    },
    push(payload) {
      pushes.push(payload);
    },
  };
}

test("a push for one space key reaches only that space's tab; the other open tab receives nothing", () => {
  const tabs = new SpaceTabs();
  const tabA = fakeTab();
  const tabB = fakeTab();

  tabs.open("owner-1/space-a", () => tabA);
  tabs.open("owner-1/space-b", () => tabB);

  tabs.push("owner-1/space-a", { kind: "space", repoName: "payload for A" });

  assert.equal(tabA.pushes.length, 1, "space A's own tab received exactly one push");
  assert.deepEqual(
    tabA.pushes[0],
    { kind: "space", repoName: "payload for A" },
    "the push delivered to A's tab carries the payload given for A's key",
  );
  assert.equal(
    tabB.pushes.length,
    0,
    "the other open tab (space B) received nothing from a push addressed to space A",
  );
});
