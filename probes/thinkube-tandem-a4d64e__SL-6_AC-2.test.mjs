// WHY (INVARIANT): opening a space key that already has a live tab must
// reveal that same tab rather than making a second one — this is the core
// "reveal if open, create if not" contract of the register, and it must
// always hold so a space never grows two tabs for one key.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const made = [];
  const factory = () => {
    const tab = {
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
    };
    made.push(tab);
    return tab;
  };
  return { factory, made };
}

test("opening a key that already has a live tab reveals it and creates no second one", () => {
  const tabs = new SpaceTabs();
  const { factory, made } = fakeTabFactory();

  const first = tabs.open("owner-1/space-a", factory);
  const second = tabs.open("owner-1/space-a", factory);

  assert.equal(made.length, 1, "only one tab was ever constructed for this key");
  assert.equal(second, first, "the second open returns the very same live tab");
  assert.equal(first.revealed, 1, "the already-open tab was revealed on the second open");
});
