/**
 * A space with no open tab has nowhere to receive a push — the registry
 * must swallow that case quietly instead of throwing, since a push can be
 * built for a space key the person has since closed.
 *
 * STANDING INVARIANT — SpaceTabs.pushTo(key, payload) must always be a
 * no-op, and must never raise, when `key` has no open tab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpaceTabs } from "./panels";

interface FakeTab {
  key: string;
  title: string;
  received: unknown[];
  reveal(): void;
  push(payload: unknown): void;
  dispose(): void;
}

function fakeFactory(made: FakeTab[]): (key: string, title: string) => FakeTab {
  return (key, title) => {
    const tab: FakeTab = {
      key,
      title,
      received: [],
      reveal() {},
      push(payload) {
        tab.received.push(payload);
      },
      dispose() {},
    };
    made.push(tab);
    return tab;
  };
}

test("pushing for a space key with no open tab does nothing and raises no error", () => {
  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));

  tabs.open("repo-a/alpha", "Alpha");

  assert.doesNotThrow(() => {
    tabs.pushTo("repo-a/never-opened", { kind: "space" });
  });
  // The only tab that exists must stay untouched by a push aimed elsewhere.
  assert.deepEqual(made[0].received, []);
});

test("pushing before any tab has ever been opened does nothing and raises no error", () => {
  const tabs = new SpaceTabs(() => {
    throw new Error("the factory must never be asked to build a tab for a push");
  });

  assert.doesNotThrow(() => {
    tabs.pushTo("repo-a/alpha", { kind: "space" });
  });
});
