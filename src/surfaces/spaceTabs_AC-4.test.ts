/**
 * Disposing the register disposes every registered tab and leaves it empty
 * (seen through fake tabs).
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

test("disposing the register disposes every registered tab and leaves it empty", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  tabs.open("owner-a/space-1");
  tabs.open("owner-b/space-2");
  tabs.open("owner-c/space-3");
  assert.equal(factory.created.length, 3);
  assert.ok(factory.created.every((t) => !t.closed), "no tab is closed before dispose");

  tabs.dispose();

  assert.ok(factory.created.every((t) => t.closed), "every registered tab must be disposed");

  // The register itself is now empty: opening the same key again must create
  // a fresh tab, not reveal one that was just disposed.
  tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 4, "the register held nothing after dispose");
  assert.equal(factory.created[3].closed, false);
});
