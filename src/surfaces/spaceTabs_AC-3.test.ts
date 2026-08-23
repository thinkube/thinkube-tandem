/**
 * A tab that reports itself closed is dropped from the register, so opening
 * that key again creates a fresh tab.
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

test("a tab reporting itself closed is dropped, so reopening creates a fresh one", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  // The editor closed this tab out from under the register — it now reports
  // itself closed, but nothing told the register directly.
  factory.created[0].closed = true;

  const second = tabs.open("owner-a/space-1");

  assert.notEqual(second, first, "a closed tab must not be revealed as if still live");
  assert.equal(factory.created.length, 2, "a fresh tab must be created once the old one reports closed");
});
