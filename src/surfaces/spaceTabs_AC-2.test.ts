/**
 * Opening a key that already has a live tab reveals that tab and creates no
 * second one.
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

test("opening a key with a live tab reveals it and creates no second tab", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const opened = tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 1);

  const openedAgain = tabs.open("owner-a/space-1");

  assert.equal(openedAgain, opened, "reopening a live key must return the same tab");
  assert.equal(factory.created.length, 1, "no second tab may be created for a live key");
  assert.equal(factory.created[0].revealed, 1, "the existing tab must be revealed on reopen");
});
