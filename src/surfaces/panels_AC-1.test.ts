/**
 * TRANSITION — proves the change that replaces the single module-level
 * SpacePanel with a per-space registry: opening two different thinking
 * spaces must produce two independent tabs, both built through the
 * injected factory, and opening the second must never dispose the first.
 * Its work is done once SpaceTabs exists and behaves this way.
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

test("opening two different space keys creates two tabs via the injected factory, and neither is disposed", () => {
  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");

  assert.equal(made.length, 2, "the factory must be asked for a tab once per distinct key");
  assert.deepEqual(
    made.map((t) => t.key),
    ["repo-a/alpha", "repo-a/beta"],
  );
  assert.equal(made[0].disposed, false, "opening the second space must not dispose the first tab");
  assert.equal(made[1].disposed, false);
});
