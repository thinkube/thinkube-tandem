/**
 * TRANSITION — proves the change that replaces the single module-level
 * SpacePanel with a per-space registry: closing one thinking space's tab
 * must dispose only that tab, leaving tabs belonging to other spaces
 * open. Its work is done once SpaceTabs exists and behaves this way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";

interface FakeTab {
  key: string;
  title: string;
  disposed: boolean;
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(made: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    const tab: FakeTab = {
      key,
      title,
      disposed: false,
      reveal() {},
      push() {},
      dispose() {
        tab.disposed = true;
      },
    };
    made.push(tab);
    return tab;
  };
}

test("closing one key disposes only that key's tab; tabs under other keys stay open", () => {
  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");
  tabs.close("repo-a/alpha");

  const alpha = made.find((t) => t.key === "repo-a/alpha")!;
  const beta = made.find((t) => t.key === "repo-a/beta")!;
  assert.equal(alpha.disposed, true, "the closed key's tab must be disposed");
  assert.equal(beta.disposed, false, "a tab under a different key must stay open");
});
