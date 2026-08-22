// WHY (INVARIANT): a tab's push must always carry ITS OWN space's session
// state, never a value borrowed from whichever session happened to change
// last — two tabs open on two different sessions must report different
// maps and different activity in their own pushes. This must hold for as
// long as more than one thinking-space tab can be open at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { spacePush } from "../out-test/surfaces/panel.js";
import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";

function bareSession(tag) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl8-ac3-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl8-ac3-${tag}-keys-`)),
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
  });
}

function fakeTabFactory() {
  const created = [];
  const factory = (key) => {
    const pushes = [];
    const tab = {
      key,
      pushes,
      closed: false,
      isClosed: () => tab.closed,
      reveal: () => {},
      dispose: () => {
        tab.closed = true;
      },
      push: (payload) => {
        pushes.push(payload);
      },
    };
    created.push(tab);
    return tab;
  };
  factory.created = created;
  return factory;
}

test("each tab's push carries the state of its own space's session — two tabs on two sessions report different maps and different activity", () => {
  const factory = fakeTabFactory();
  const tabs = new SpaceTabs(factory);

  const sessionA = bareSession("a");
  const sessionB = bareSession("b");

  // Give the two sessions visibly different state before either is pushed.
  sessionA.saveDraft("draft belonging to space A");
  sessionB.saveDraft("draft belonging to space B");
  sessionA.activity = { label: "thinking about A", current: 1, total: 3 };
  sessionB.activity = undefined;

  const tabA = tabs.open("owner/space-a");
  const tabB = tabs.open("owner/space-b");

  tabs.push("owner/space-a", spacePush(sessionA));
  tabs.push("owner/space-b", spacePush(sessionB));

  assert.equal(tabA.pushes.length, 1, "space A's tab must receive exactly one push");
  assert.equal(tabB.pushes.length, 1, "space B's tab must receive exactly one push");

  assert.equal(
    tabA.pushes[0].draft,
    "draft belonging to space A",
    "space A's tab must carry space A's own map state",
  );
  assert.equal(
    tabB.pushes[0].draft,
    "draft belonging to space B",
    "space B's tab must carry space B's own map state",
  );
  assert.notDeepEqual(
    tabA.pushes[0].draft,
    tabB.pushes[0].draft,
    "the two tabs' pushed maps must differ, one per session",
  );

  assert.deepEqual(
    tabA.pushes[0].activity,
    { label: "thinking about A", current: 1, total: 3 },
    "space A's tab must carry space A's own activity",
  );
  assert.equal(
    tabB.pushes[0].activity,
    undefined,
    "space B's tab must carry space B's own activity, not space A's",
  );
});
