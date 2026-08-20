// WHY (TRANSITION): before this slice, the extension kept exactly one
// module-level panel, so opening a second space would reuse or replace the
// first one's tab. This proves two SpacePanels built for two different
// spaces each ask the host for their OWN panel — neither one reuses nor
// disposes the other's — proving the one-tab-per-space split actually
// keeps the tabs independent rather than sharing one underlying panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SpacePanel } from "../out-test/surfaces/panel.js";
import { TandemSession } from "../out-test/surfaces/session.js";

function bareSession(spaceName) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    spaceName,
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

function fakePanelHandle() {
  return {
    revealed: 0,
    disposed: false,
    reveal() {
      this.revealed++;
    },
    dispose() {
      this.disposed = true;
    },
    onDidDispose() {
      return { dispose() {} };
    },
    webview: {
      html: "",
      postMessage: async () => true,
      onDidReceiveMessage() {
        return { dispose() {} };
      },
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
    },
  };
}

function fakeHost() {
  const made = [];
  return {
    made,
    createPanel(title) {
      const handle = fakePanelHandle();
      made.push({ title, handle });
      return handle;
    },
  };
}

test("two SpacePanels for two different spaces each ask the host for their own panel", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const sessionA = bareSession("Space A");
  const sessionB = bareSession("Space B");

  const panelA = new SpacePanel("owner-1/space-a", sessionA, hostA);
  const panelB = new SpacePanel("owner-1/space-b", sessionB, hostB);

  await panelA.show();
  await panelB.show();

  assert.equal(hostA.made.length, 1, "space A's host built exactly one panel for space A");
  assert.equal(hostB.made.length, 1, "space B's host built exactly one panel for space B");
  assert.notEqual(hostA.made[0].handle, hostB.made[0].handle, "the two spaces hold two distinct panel handles");

  assert.equal(hostA.made[0].handle.disposed, false, "opening space B never disposes space A's panel");
  assert.equal(hostB.made[0].handle.disposed, false, "space B's own panel is not disposed by opening it");
  assert.equal(hostA.made[0].handle.revealed, 0, "opening space B never reveals space A's panel");
});
