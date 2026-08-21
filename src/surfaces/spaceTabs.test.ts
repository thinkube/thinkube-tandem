/**
 * The register of open thinking-space tabs: one tab per owner-and-space
 * key, revealed rather than duplicated while live, rebuilt once its tab
 * reports itself closed, and emptied in one act on dispose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { SpaceTab, SpaceTabs } from "./spaceTabs";

function fakeTabFactory(): { factory: () => SpaceTab; made: (SpaceTab & { closed: boolean; revealed: number; disposed: boolean })[] } {
  const made: (SpaceTab & { closed: boolean; revealed: number; disposed: boolean })[] = [];
  const factory = (): SpaceTab => {
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
  assert.equal((tabA as { disposed: boolean }).disposed, false, "opening space B never disposes space A's tab");
  assert.equal((tabB as { disposed: boolean }).disposed, false, "space B's own tab is not disposed by opening it");
});

test("opening a key that already has a live tab reveals it and creates no second one", () => {
  const tabs = new SpaceTabs();
  const { factory, made } = fakeTabFactory();

  const first = tabs.open("owner-1/space-a", factory);
  const second = tabs.open("owner-1/space-a", factory);

  assert.equal(made.length, 1, "only one tab was ever constructed for this key");
  assert.equal(second, first, "the second open returns the very same live tab");
  assert.equal((first as { revealed: number }).revealed, 1, "the already-open tab was revealed on the second open");
});

test("a tab that reports itself closed is dropped, so opening that key again creates a fresh tab", () => {
  const tabs = new SpaceTabs();
  const { factory, made } = fakeTabFactory();

  const first = tabs.open("owner-1/space-a", factory) as SpaceTab & { closed: boolean };
  first.closed = true;

  const second = tabs.open("owner-1/space-a", factory);

  assert.equal(made.length, 2, "the dead tab was dropped and a new one was built");
  assert.notEqual(second, first, "the key now resolves to the fresh tab, not the closed one");
  assert.equal((second as { disposed: boolean }).disposed, false, "the fresh tab was not itself disposed on creation");
});

test("disposing the register disposes every registered tab and leaves it empty", () => {
  const tabs = new SpaceTabs();
  const a = fakeTabFactory();
  const b = fakeTabFactory();

  const tabA = tabs.open("owner-1/space-a", a.factory);
  const tabB = tabs.open("owner-1/space-b", b.factory);

  tabs.dispose();

  assert.equal((tabA as { disposed: boolean }).disposed, true, "the first tab was disposed");
  assert.equal((tabB as { disposed: boolean }).disposed, true, "the second tab was disposed");

  // The register is empty: opening either key again must build a fresh
  // tab, not hand back one of the (disposed) tabs that used to live there.
  const freshA = tabs.open("owner-1/space-a", a.factory);
  const freshB = tabs.open("owner-1/space-b", b.factory);
  assert.equal(a.made.length, 2, "space-a's key builds a new tab after dispose");
  assert.equal(b.made.length, 2, "space-b's key builds a new tab after dispose");
  assert.notEqual(freshA, tabA, "the register no longer holds the disposed tab for space-a");
  assert.notEqual(freshB, tabB, "the register no longer holds the disposed tab for space-b");
});
