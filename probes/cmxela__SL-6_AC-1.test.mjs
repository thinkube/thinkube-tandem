// WHY (TRANSITION): before this change the extension held one module-level
// panel; this proves the new register — SpaceTabs — actually holds more
// than one tab at once. Opening two different space keys must create two
// distinct tabs, one per key, and both must still be found in the register
// afterwards. Its job is done once SpaceTabs exists and keeps two tabs
// alive side by side.
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

test("opening two different space keys creates one tab per key and both stay registered", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  const second = tabs.open("owner-b/space-2");

  assert.equal(factory.created.length, 2, "two distinct keys must create two tabs");
  assert.notEqual(first, second, "the two tabs must be different objects");

  // Both keys must still resolve to a live, registered tab afterwards.
  assert.equal(tabs.open("owner-a/space-1"), first, "the first key's tab must still be registered");
  assert.equal(tabs.open("owner-b/space-2"), second, "the second key's tab must still be registered");
  // No third tab should have been created by re-opening the same keys.
  assert.equal(factory.created.length, 2, "re-opening an already-open key must not create a new tab");
});
