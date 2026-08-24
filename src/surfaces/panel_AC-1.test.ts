/**
 * Every open tab must show only the map and machine activity of the space
 * it belongs to: a payload pushed for one space key must land on that
 * key's own tab and never bleed onto a tab open for a different space.
 *
 * STANDING INVARIANT — SpaceTabs.pushTo(key, payload) must always deliver
 * to the one tab registered under `key` and to no other open tab, however
 * many spaces are open at once.
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

test("a payload pushed for one space key is delivered to that key's tab and to no other open tab", () => {
  const made: FakeTab[] = [];
  const tabs = new SpaceTabs(fakeFactory(made));

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");

  const payload = { kind: "space", running: false };
  tabs.pushTo("repo-a/alpha", payload);

  const alpha = made.find((t) => t.key === "repo-a/alpha")!;
  const beta = made.find((t) => t.key === "repo-a/beta")!;
  assert.deepEqual(alpha.received, [payload], "the targeted key's tab must receive the payload");
  assert.deepEqual(beta.received, [], "a tab open for a different space must receive nothing");
});
