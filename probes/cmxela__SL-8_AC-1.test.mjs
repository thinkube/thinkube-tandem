// WHY (TRANSITION): before this change a session's push reached whichever
// tab happened to be on top; this proves the replacement — SpaceTabs.push
// sends a space's payload ONLY to that space's own tab, and every other
// live tab in the register receives nothing at all. Its job is done once
// SpaceTabs.push exists and is scoped strictly by key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function fakeTabFactory() {
  const created = [];
  const factory = (key) => {
    const pushes = [];
    const tab = {
      key,
      pushes,
      closed: false,
      isClosed: () => tab.closed,
      reveal: () => {},
      dispose: () => {
        tab.closed = true;
      },
      push: (payload) => {
        pushes.push(payload);
      },
    };
    created.push(tab);
    return tab;
  };
  factory.created = created;
  return factory;
}

test("a push for one space key reaches only that space's tab; the other open tabs receive nothing", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const tabA = tabs.open("owner-a/space-1");
  const tabB = tabs.open("owner-b/space-2");

  tabs.push("owner-a/space-1", { kind: "space", marker: "for-A-only" });

  assert.deepEqual(
    tabA.pushes,
    [{ kind: "space", marker: "for-A-only" }],
    "the pushed payload must reach the tab whose key it was pushed for",
  );
  assert.deepEqual(
    tabB.pushes,
    [],
    "a tab for a different space key must receive nothing from a push aimed at another key",
  );
});
