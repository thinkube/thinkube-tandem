// WHY (INVARIANT): a session can change (and try to push) for a space
// that has no open tab — nothing keeps every space open at once. This
// must always hold: pushing to a key with no registered tab is a no-op,
// never a thrown error that could crash the caller (extension.ts's
// onChanged hook, called from deep inside a round).
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTab() {
  const pushes = [];
  return {
    pushes,
    disposed: false,
    reveal() {},
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

test("a push for a space with no open tab is dropped without error", () => {
  const tabs = new SpaceTabs();
  const tabA = fakeTab();
  tabs.open("owner-1/space-a", () => tabA);

  assert.doesNotThrow(() => {
    tabs.push("owner-1/space-never-opened", { kind: "space", repoName: "nobody home" });
  }, "pushing to a key with no registered tab must not throw");

  assert.equal(
    tabA.pushes.length,
    0,
    "the one open, unrelated tab receives nothing from a push addressed to a key it does not own",
  );
});

test("a push to a key that was opened and then closed is also dropped without error", () => {
  const tabs = new SpaceTabs();
  const tabA = fakeTab();
  tabs.open("owner-1/space-a", () => tabA);
  tabA.disposed = true; // the editor closed the tab; isClosed() now reports true

  assert.doesNotThrow(() => {
    tabs.push("owner-1/space-a", { kind: "space", repoName: "late push" });
  }, "pushing to a key whose tab reports itself closed must not throw");
});
