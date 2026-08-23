/**
 * Opening two different space keys through the register creates one tab per
 * key and both stay registered (seen through a fake tab factory).
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

test("two different keys create one tab each, and both stay registered", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  const second = tabs.open("owner-b/space-2");

  assert.equal(factory.created.length, 2, "two distinct keys must create two tabs");
  assert.notEqual(first, second, "the two tabs must be different objects");

  assert.equal(tabs.open("owner-a/space-1"), first, "the first key's tab must still be registered");
  assert.equal(tabs.open("owner-b/space-2"), second, "the second key's tab must still be registered");
  assert.equal(factory.created.length, 2, "re-opening an already-open key must not create a new tab");
});
