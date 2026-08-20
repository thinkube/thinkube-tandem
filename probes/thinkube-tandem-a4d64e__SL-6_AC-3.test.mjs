// WHY (INVARIANT): a tab that reports itself closed (isClosed() true, e.g.
// the person closed the editor tab) must be dropped from the register, so
// opening that same key again builds a fresh tab instead of handing back a
// dead one. This must always hold, or a closed tab becomes unreachable.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const made = [];
  const factory = () => {
    const tab = {
      closed: false,
      revealed: 0,
      disposed: false,
      reveal() {
        this.revealed++;
      },
      dispose() {
        this.disposed = true;
      },
      isClosed() {
        return this.closed;
      },
    };
    made.push(tab);
    return tab;
  };
  return { factory, made };
}

test("a tab that reports itself closed is dropped, so opening that key again creates a fresh tab", () => {
  const tabs = new SpaceTabs();
  const { factory, made } = fakeTabFactory();

  const first = tabs.open("owner-1/space-a", factory);
  first.closed = true;

  const second = tabs.open("owner-1/space-a", factory);

  assert.equal(made.length, 2, "the dead tab was dropped and a new one was built");
  assert.notEqual(second, first, "the key now resolves to the fresh tab, not the closed one");
  assert.equal(second.disposed, false, "the fresh tab was not itself disposed on creation");
});
