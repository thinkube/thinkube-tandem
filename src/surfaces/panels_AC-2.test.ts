/**
 * TRANSITION — proves the change that replaces the single module-level
 * SpacePanel with a per-space registry: opening a key that already has a
 * tab must reveal that same tab rather than building a second one for the
 * same thinking space. Its work is done once SpaceTabs exists and behaves
 * this way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";

interface FakeTab {
  key: string;
  title: string;
  revealed: number;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(made: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    const tab: FakeTab = {
      key,
      title,
      revealed: 0,
      reveal() {
        tab.revealed += 1;
      },
      push() {},
      dispose() {},
    };
    made.push(tab);
    return tab;
  };
}

test("opening a key that is already open creates no second tab and reveals the existing one", () => {
  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));

  const first = tabs.open("repo-a/alpha", "Alpha");
  const second = tabs.open("repo-a/alpha", "Alpha");

  assert.equal(made.length, 1, "the factory must be asked for a tab only once for a key already open");
  assert.equal(second, first, "the second open must return the same tab instance as the first");
  assert.equal(made[0].revealed >= 1, true, "reopening an already-open key must reveal it");
});
