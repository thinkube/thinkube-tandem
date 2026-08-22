/**
 * The register of open thinking-space tabs: one tab per key, revealed when
 * already open, built fresh when not — and dropped the moment it reports
 * itself closed. Disposing the register disposes every tab it holds and
 * leaves itself empty. A push for one key reaches only that key's own
 * tab — every other live tab receives nothing, and a key with no live tab
 * (never opened, or closed) drops the push without error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpaceTabs } from "./spaceTabs";
import type { SpaceTab } from "./spaceTabs";
import { TandemSession } from "./session";
import { spacePush } from "./push";

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

function bareSession(tag: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-spacetabs-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-spacetabs-${tag}-keys-`)),
    now: () => "2026-08-22T00:00:00.000Z",
    author: "t",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "",
      prepare: "",
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
}

test("opening two different space keys creates one tab per key and both stay registered", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  const second = tabs.open("owner-b/space-2");

  assert.equal(factory.created.length, 2, "two distinct keys must create two tabs");
  assert.notEqual(first, second, "the two tabs must be different objects");

  // Both keys must still resolve to a live, registered tab afterwards.
  assert.equal(tabs.open("owner-a/space-1"), first, "the first key's tab must still be registered");
  assert.equal(tabs.open("owner-b/space-2"), second, "the second key's tab must still be registered");
  // No third tab should have been created by re-opening the same keys.
  assert.equal(factory.created.length, 2, "re-opening an already-open key must not create a new tab");
});

test("opening a key with a live tab reveals that tab and creates no second one", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const opened = tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 1);
  const openedFake = factory.created[0];

  const openedAgain = tabs.open("owner-a/space-1");

  assert.equal(openedAgain, opened, "reopening a live key must return the same tab");
  assert.equal(factory.created.length, 1, "no second tab may be created for a live key");
  assert.equal(openedFake.revealed, 1, "the existing tab must be revealed on reopen");
});

test("a tab that reports itself closed is dropped, so reopening that key creates a fresh tab", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const first = tabs.open("owner-a/space-1");
  // The editor closed this tab out from under the register — the tab now
  // reports itself closed, but nothing told the register directly.
  factory.created[0].closed = true;

  const second = tabs.open("owner-a/space-1");

  assert.notEqual(second, first, "a closed tab must not be revealed as if still live");
  assert.equal(factory.created.length, 2, "a fresh tab must be created once the old one reports closed");
});

test("disposing the register disposes every registered tab and leaves it empty", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  tabs.open("owner-a/space-1");
  tabs.open("owner-b/space-2");
  tabs.open("owner-c/space-3");

  assert.equal(factory.created.length, 3);
  assert.ok(factory.created.every((t) => !t.closed), "no tab is closed before dispose");

  tabs.dispose();

  assert.ok(
    factory.created.every((t) => t.closed),
    "every registered tab must be disposed",
  );

  // The register itself is now empty: opening any of the same keys again
  // must create fresh tabs, not reveal ones that were just disposed.
  tabs.open("owner-a/space-1");
  assert.equal(factory.created.length, 4, "the register held nothing after dispose, so reopening makes a new tab");
  assert.equal(factory.created[3].closed, false);
});

test("a push for one space key reaches only that space's tab; the other open tabs receive nothing", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  tabs.open("owner-a/space-1");
  tabs.open("owner-b/space-2");
  const tabA = factory.created[0];
  const tabB = factory.created[1];

  tabs.push("owner-a/space-1", { kind: "space", marker: "for-A-only" });

  assert.deepEqual(
    tabA.pushes,
    [{ kind: "space", marker: "for-A-only" }],
    "the pushed payload must reach the tab whose key it was pushed for",
  );
  assert.deepEqual(
    tabB.pushes,
    [],
    "a tab for a different space key must receive nothing from a push aimed at another key",
  );
});

test("a push for a space with no live tab — never opened, or closed — is dropped without error", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  // No tab has ever been opened for this key.
  assert.doesNotThrow(() => {
    tabs.push("owner-z/never-opened", { kind: "space" });
  });
  assert.equal(factory.created.length, 0, "pushing to a key with no tab must not create one");

  tabs.open("owner-a/space-1");
  const tab = factory.created[factory.created.length - 1];
  tab.closed = true;
  assert.doesNotThrow(() => {
    tabs.push("owner-a/space-1", { kind: "space" });
  });
  assert.deepEqual(tab.pushes, [], "a closed tab must not receive a push aimed at its old key");
});

test("each tab's push carries the state of its own space's session — two tabs on two sessions report different maps and different activity", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const sessionA = bareSession("ac3-a");
  const sessionB = bareSession("ac3-b");

  // Give the two sessions visibly different state before either is pushed.
  sessionA.saveDraft("draft belonging to space A");
  sessionB.saveDraft("draft belonging to space B");
  sessionA.activity = { label: "thinking about A", current: 1, total: 3 };
  sessionB.activity = undefined;

  tabs.open("owner/space-a");
  tabs.open("owner/space-b");
  const tabA = factory.created[0];
  const tabB = factory.created[1];

  tabs.push("owner/space-a", spacePush(sessionA));
  tabs.push("owner/space-b", spacePush(sessionB));

  assert.equal(tabA.pushes.length, 1, "space A's tab must receive exactly one push");
  assert.equal(tabB.pushes.length, 1, "space B's tab must receive exactly one push");

  const pushA = tabA.pushes[0] as { draft: string; activity: unknown };
  const pushB = tabB.pushes[0] as { draft: string; activity: unknown };

  assert.equal(pushA.draft, "draft belonging to space A", "space A's tab must carry space A's own map state");
  assert.equal(pushB.draft, "draft belonging to space B", "space B's tab must carry space B's own map state");
  assert.notDeepEqual(pushA.draft, pushB.draft, "the two tabs' pushed maps must differ, one per session");

  assert.deepEqual(
    pushA.activity,
    { label: "thinking about A", current: 1, total: 3 },
    "space A's tab must carry space A's own activity",
  );
  assert.equal(pushB.activity, undefined, "space B's tab must carry space B's own activity, not space A's");
});
