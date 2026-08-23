// WHY (TRANSITION): deactivate used to dispose a single module-level panel;
// this proves the register's own dispose disposes EVERY tab it holds and
// leaves itself empty — the seam deactivate now delegates to. Its job is
// done once SpaceTabs.dispose empties a register of many tabs in one act.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const created = [];
  const factory = (key) => {
    const tab = {
      key,
      closed: false,
      isClosed: () => tab.closed,
      reveal: () => {},
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

test("disposing the register disposes every registered tab and leaves it empty", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  tabs.open("owner-a/space-1");
  tabs.open("owner-b/space-2");
  tabs.open("owner-c/space-3");

  assert.equal(factory.created.length, 3);
  assert.ok(factory.created.every((t) => !t.closed), "no tab is closed before dispose");

  tabs.dispose();

  assert.ok(
    factory.created.every((t) => t.closed),
    "every registered tab must be disposed",
  );

  // The register itself is now empty: opening any of the same keys again
  // must create fresh tabs, not reveal ones that were just disposed.
  const reopened = tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 4, "the register held nothing after dispose, so reopening makes a new tab");
  assert.equal(reopened.closed, false);
});
