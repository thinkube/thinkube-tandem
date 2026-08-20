// WHY (INVARIANT): disposing the whole register must dispose every tab it
// holds and leave the register empty — a many-tab register must empty in
// one act, the same guarantee a single panel's dispose() used to give. This
// must always hold so shutdown never leaves a live tab behind.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const made = [];
  const factory = () => {
    const tab = {
      disposed: false,
      reveal() {},
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

test("disposing the register disposes every registered tab and leaves it empty", () => {
  const tabs = new SpaceTabs();
  const a = fakeTabFactory();
  const b = fakeTabFactory();

  const tabA = tabs.open("owner-1/space-a", a.factory);
  const tabB = tabs.open("owner-1/space-b", b.factory);

  tabs.dispose();

  assert.equal(tabA.disposed, true, "the first tab was disposed");
  assert.equal(tabB.disposed, true, "the second tab was disposed");

  // The register is empty: opening either key again must build a fresh
  // tab, not hand back one of the (disposed) tabs that used to live there.
  const freshA = tabs.open("owner-1/space-a", a.factory);
  const freshB = tabs.open("owner-1/space-b", b.factory);
  assert.equal(a.made.length, 2, "space-a's key builds a new tab after dispose");
  assert.equal(b.made.length, 2, "space-b's key builds a new tab after dispose");
  assert.notEqual(freshA, tabA, "the register no longer holds the disposed tab for space-a");
  assert.notEqual(freshB, tabB, "the register no longer holds the disposed tab for space-b");
});
