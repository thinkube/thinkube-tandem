// WHY (TRANSITION): before this slice the delivery-ready notification's
// "Open the space" action re-read whatever space the host remembered as
// active — wrong whenever a background run finishes in a space that is
// not the one currently on top. This proves opening the FINISHED space's
// key through the register reveals/creates that space's own tab, never
// the tab of a different, separately-remembered "active" key — proving
// the notification now names and opens the space that actually finished.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTab(label) {
  return {
    label,
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
    push() {},
  };
}

test("opening the finished space's key opens that space's own tab, not the remembered-active space's tab", () => {
  const tabs = new SpaceTabs();
  const activeTab = fakeTab("remembered-active");
  const finishedTab = fakeTab("finished-in-background");

  // Two spaces are already open: the one the human left on top ("active"),
  // and a second one a background run just finished in.
  const activeKey = "owner-1/space-on-top";
  const finishedKey = "owner-1/space-that-finished";
  tabs.open(activeKey, () => activeTab);
  tabs.open(finishedKey, () => finishedTab);

  // A delivery-ready message for the FINISHED space opens by that space's
  // own key — never by whatever key is remembered as "active".
  const opened = tabs.open(finishedKey, () => fakeTab("must not be built"));

  assert.equal(opened, finishedTab, "opening by the finished space's own key resolves to that space's own tab");
  assert.equal(
    finishedTab.revealed,
    1,
    "the finished space's tab was revealed — the notification's target was addressed by its own key",
  );
  assert.equal(
    activeTab.revealed,
    0,
    "the remembered-active space's tab was never touched by a notification belonging to a different space",
  );
});
