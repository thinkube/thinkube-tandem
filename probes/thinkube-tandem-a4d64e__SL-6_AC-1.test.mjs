// WHY (TRANSITION): SpaceTabs is a new register — this proves that opening
// two DIFFERENT space keys each gets its own tab, and both stay registered
// (neither open call disposes or drops the other). The register did not
// exist before this slice; this proves the basic multi-key behaviour landed.
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

test("opening two different space keys creates one tab per key and both stay registered", () => {
  const tabs = new SpaceTabs();
  const a = fakeTabFactory();
  const b = fakeTabFactory();

  const tabA = tabs.open("owner-1/space-a", a.factory);
  const tabB = tabs.open("owner-1/space-b", b.factory);

  assert.equal(a.made.length, 1, "opening the first key makes exactly one tab");
  assert.equal(b.made.length, 1, "opening the second key makes exactly one tab");
  assert.equal(tabA, a.made[0], "the tab returned for key A is the one A's factory made");
  assert.equal(tabB, b.made[0], "the tab returned for key B is the one B's factory made");
  assert.notEqual(tabA, tabB, "the two keys got two distinct tabs");
  assert.equal(tabA.disposed, false, "opening space B never disposes space A's tab");
  assert.equal(tabB.disposed, false, "space B's own tab is not disposed by opening it");
});
