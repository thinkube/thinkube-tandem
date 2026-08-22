// WHY (INVARIANT): a session can change while its tab is closed or was
// never opened — the push for that key must be silently dropped, never
// throw, so a background change to an unopened space cannot crash the
// caller. This must hold for as long as pushes can be aimed at a key with
// no live tab.
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

test("a push for a space with no open tab is dropped without error", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  // No tab has ever been opened for this key.
  assert.doesNotThrow(() => {
    tabs.push("owner-z/never-opened", { kind: "space" });
  });

  // Nothing was created as a side effect of pushing to an unknown key.
  assert.equal(factory.created.length, 0, "pushing to a key with no tab must not create one");
});

test("a push for a key whose tab reports itself closed is dropped without error", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const tab = tabs.open("owner-a/space-1");
  tab.closed = true;

  assert.doesNotThrow(() => {
    tabs.push("owner-a/space-1", { kind: "space" });
  });
  assert.deepEqual(tab.pushes, [], "a closed tab must not receive a push aimed at its old key");
});
