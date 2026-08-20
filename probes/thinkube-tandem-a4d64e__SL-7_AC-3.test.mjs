// WHY (TRANSITION): before this slice a single panel dispatched every
// webview action against whatever session the host currently called
// "active" — a stale lookup once two spaces are open at once. This proves
// a message arriving on ONE space's panel is handled against that panel's
// own bound session and never leaks into or reads from the other open
// session, proving each tab now acts on the space it was opened for.
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
  let onMessage;
  return {
    disposed: false,
    reveal() {},
    dispose() {
      this.disposed = true;
    },
    onDidDispose() {
      return { dispose() {} };
    },
    webview: {
      html: "",
      postMessage: async () => true,
      onDidReceiveMessage(cb) {
        onMessage = cb;
        return { dispose() {} };
      },
      asWebviewUri: (u) => u,
      cspSource: "vscode-resource:",
    },
    // Test-only helper: fire a message as the webview would.
    fire(msg) {
      return onMessage(msg);
    },
  };
}

function fakeHost() {
  const made = [];
  return {
    made,
    createPanel(title) {
      const handle = fakePanelHandle();
      made.push(handle);
      return handle;
    },
  };
}

test("a webview action arriving on one space's panel is handled against that panel's own session", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const sessionA = bareSession("Space A");
  const sessionB = bareSession("Space B");

  const panelA = new SpacePanel("owner-1/space-a", sessionA, hostA);
  const panelB = new SpacePanel("owner-1/space-b", sessionB, hostB);

  await panelA.show();
  await panelB.show();

  const handleA = hostA.made[0];
  const handleB = hostB.made[0];

  await handleA.fire({ action: "save-draft", text: "typed into space A" });

  assert.equal(
    sessionA.space.draft,
    "typed into space A",
    "the action fired on space A's panel is handled against space A's own session",
  );
  assert.notEqual(
    sessionB.space.draft,
    "typed into space A",
    "space B's session is never touched by an action that arrived on space A's panel — no lookup by 'active session' leaked it across",
  );

  await handleB.fire({ action: "save-draft", text: "typed into space B" });

  assert.equal(
    sessionB.space.draft,
    "typed into space B",
    "the action fired on space B's panel is handled against space B's own session",
  );
  assert.equal(
    sessionA.space.draft,
    "typed into space A",
    "space A's session keeps what was typed into it — unaffected by the later action on space B's panel",
  );
});
