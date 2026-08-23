/**
 * A push for one space key reaches only that space's tab; the other open tabs
 * receive nothing — and a push for a space with no open tab is dropped
 * without error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./spaceTabs";
import type { SpaceTab } from "./spaceTabs";

interface FakeTab extends SpaceTab {
  key: string;
  revealed: number;
  closed: boolean;
  pushes: unknown[];
}

function fakeTabFactory(): ((key: string) => FakeTab) & { created: FakeTab[] } {
  const created: FakeTab[] = [];
  const factory = (key: string): FakeTab => {
    const tab: FakeTab = {
      key,
      revealed: 0,
      closed: false,
      pushes: [],
      isClosed: () => tab.closed,
      reveal: () => {
        tab.revealed += 1;
      },
      dispose: () => {
        tab.closed = true;
      },
      push: (payload: unknown) => {
        tab.pushes.push(payload);
      },
    };
    created.push(tab);
    return tab;
  };
  return Object.assign(factory, { created });
}

test("a push for one key reaches only that key's tab", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  tabs.open("owner-a/space-1");
  tabs.open("owner-b/space-2");

  tabs.push("owner-a/space-1", { kind: "space", marker: "for-A-only" });

  assert.deepEqual(
    factory.created[0].pushes,
    [{ kind: "space", marker: "for-A-only" }],
    "the payload must reach the tab whose key it was pushed for",
  );
  assert.deepEqual(
    factory.created[1].pushes,
    [],
    "a tab for a different key must receive nothing",
  );
});

test("a push for a space with no live tab is dropped without error", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  assert.doesNotThrow(() => tabs.push("owner-z/never-opened", { kind: "space" }));
  assert.equal(factory.created.length, 0, "pushing to a key with no tab must not create one");

  tabs.open("owner-a/space-1");
  const tab = factory.created[factory.created.length - 1];
  tab.closed = true;
  assert.doesNotThrow(() => tabs.push("owner-a/space-1", { kind: "space" }));
  assert.deepEqual(tab.pushes, [], "a closed tab must not receive a push aimed at its old key");
});
