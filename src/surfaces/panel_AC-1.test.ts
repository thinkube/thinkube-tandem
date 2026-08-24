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
import { SpacePanel } from "./panel";

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

test("the real SpacePanel registered under a key receives that key's payload, and a panel under another key receives none", () => {
  // The tabs the registry holds in production are SpacePanels. Each one is
  // given its own webview double, so "delivered to that key's tab" is read
  // off the webview the payload actually reached.
  const posted = new Map<string, unknown[]>();
  function panelFor(key: string): SpacePanel {
    posted.set(key, []);
    const panel = new SpacePanel({} as never, key);
    // The tab is live once the host has built its webview; a panel that
    // was never shown holds none, and must stay silent rather than throw.
    (panel as unknown as { _panel: unknown })._panel = {
      webview: {
        postMessage(payload: unknown) {
          posted.get(key)!.push(payload);
          return Promise.resolve(true);
        },
      },
    };
    return panel;
  }

  const panels = new Map<string, SpacePanel>();
  const tabs = new SpaceTabs((key) => {
    const p = panelFor(key);
    panels.set(key, p);
    return p;
  });

  tabs.open("repo-a/alpha", "Alpha");
  tabs.open("repo-a/beta", "Beta");

  const payload = { kind: "space", running: true };
  tabs.pushTo("repo-a/alpha", payload);

  assert.deepEqual(posted.get("repo-a/alpha"), [payload], "the targeted SpacePanel must post the payload to its own webview");
  assert.deepEqual(posted.get("repo-a/beta"), [], "the other space's SpacePanel must post nothing");
});

test("a SpacePanel whose webview was never built swallows a push instead of throwing", () => {
  const panel = new SpacePanel({} as never, "Alpha");
  assert.doesNotThrow(() => panel.push({ kind: "space" }));
});
