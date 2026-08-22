// WHY (INVARIANT): opening a space that already has a live tab must reveal
// that same tab, never create a second one for the same key — this is the
// register's whole reason to exist (one tab per open space, forever), so it
// must hold for as long as SpaceTabs exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const created = [];
  const factory = (key) => {
    const tab = {
      key,
      revealed: 0,
      closed: false,
      isClosed: () => tab.closed,
      reveal: () => {
        tab.revealed += 1;
      },
      dispose: () => {
        tab.closed = true;
      },
    };
    created.push(tab);
    return tab;
  };
  factory.created = created;
  return factory;
}

test("opening a key with a live tab reveals that tab and creates no second one", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const opened = tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 1);

  const openedAgain = tabs.open("owner-a/space-1");

  assert.equal(openedAgain, opened, "reopening a live key must return the same tab");
  assert.equal(factory.created.length, 1, "no second tab may be created for a live key");
  assert.equal(opened.revealed, 1, "the existing tab must be revealed on reopen");
});
