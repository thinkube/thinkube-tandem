// WHY (INVARIANT): each tab must always carry the state of its OWN
// space's session, never a shared or "active" one. This proves two tabs
// open on two different real sessions report two different maps
// (repoName, drawn from spacePush) and two different activity readings
// when pushed through SpaceTabs — so no code path can smuggle one
// space's state into the other's tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SpaceTabs } from "../out-test/surfaces/spaceTabs.js";
import { spacePush } from "../out-test/surfaces/panel.js";
import { TandemSession } from "../out-test/surfaces/session.js";

function bareSession(label) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    scope: { gitRoot: "/repo", prefix: "", projectId: "owner-1", label },
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

function fakeTab() {
  const pushes = [];
  return {
    pushes,
    disposed: false,
    reveal() {},
    dispose() {
      this.disposed = true;
    },
    isClosed() {
      return this.disposed;
    },
    push(payload) {
      pushes.push(payload);
    },
  };
}

test("each tab's push carries the state of its own space's session — two tabs on two sessions report different maps and activity", () => {
  const tabs = new SpaceTabs();
  const sessionA = bareSession("Space A repo");
  const sessionB = bareSession("Space B repo");
  sessionA.activity = { label: "thinking about space A", current: 1, total: 2 };
  sessionB.activity = { label: "thinking about space B", current: 2, total: 5 };

  const tabA = fakeTab();
  const tabB = fakeTab();
  tabs.open("owner-1/space-a", () => tabA);
  tabs.open("owner-1/space-b", () => tabB);

  tabs.push("owner-1/space-a", spacePush(sessionA));
  tabs.push("owner-1/space-b", spacePush(sessionB));

  assert.equal(tabA.pushes.length, 1, "space A's tab got exactly one push");
  assert.equal(tabB.pushes.length, 1, "space B's tab got exactly one push");

  assert.equal(tabA.pushes[0].repoName, "Space A repo", "space A's tab reports space A's own map (repoName)");
  assert.equal(tabB.pushes[0].repoName, "Space B repo", "space B's tab reports space B's own map (repoName)");
  assert.notEqual(
    tabA.pushes[0].repoName,
    tabB.pushes[0].repoName,
    "the two tabs report different maps — neither reads the other session",
  );

  assert.deepEqual(
    tabA.pushes[0].activity,
    { label: "thinking about space A", current: 1, total: 2 },
    "space A's tab reports space A's own machine activity",
  );
  assert.deepEqual(
    tabB.pushes[0].activity,
    { label: "thinking about space B", current: 2, total: 5 },
    "space B's tab reports space B's own machine activity",
  );
  assert.notDeepEqual(
    tabA.pushes[0].activity,
    tabB.pushes[0].activity,
    "the two tabs' activity readings differ — neither tab received the other space's activity",
  );
});
