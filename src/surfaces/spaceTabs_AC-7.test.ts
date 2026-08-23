/**
 * Each tab's push carries the state of its own space's session — two tabs
 * open on two sessions report different maps and different activity.
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

test("two tabs on two sessions report their own map and their own activity", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const sessionA = bareSession("ac7-a");
  const sessionB = bareSession("ac7-b");

  sessionA.saveDraft("draft belonging to space A");
  sessionB.saveDraft("draft belonging to space B");
  sessionA.activity = { label: "thinking about A", current: 1, total: 3 };
  sessionB.activity = undefined;

  tabs.open("owner/space-a");
  tabs.open("owner/space-b");

  tabs.push("owner/space-a", spacePush(sessionA));
  tabs.push("owner/space-b", spacePush(sessionB));

  const pushA = factory.created[0].pushes[0] as { draft: string; activity: unknown };
  const pushB = factory.created[1].pushes[0] as { draft: string; activity: unknown };

  assert.equal(factory.created[0].pushes.length, 1);
  assert.equal(factory.created[1].pushes.length, 1);

  assert.equal(pushA.draft, "draft belonging to space A", "A's tab must carry A's own map state");
  assert.equal(pushB.draft, "draft belonging to space B", "B's tab must carry B's own map state");

  assert.deepEqual(
    pushA.activity,
    { label: "thinking about A", current: 1, total: 3 },
    "A's tab must carry A's own activity",
  );
  assert.equal(pushB.activity, undefined, "B's tab must carry B's own activity, not A's");
});
