// WHY (INVARIANT): a SpacePanel must always tell its owner when the editor
// itself closed the tab (the person clicked the tab's close button), so
// the register that owns it (SpaceTabs) can drop the dead tab instead of
// handing it back on the next open. This must always hold, or a closed
// editor tab keeps "living" inside the register forever.
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
  let onDispose;
  return {
    disposed: false,
    reveal() {},
    dispose() {
      this.disposed = true;
    },
    onDidDispose(cb) {
      onDispose = cb;
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
    // Test-only helper: the editor raising its own close, as it would when
    // the person clicks the tab's close button.
    closeFromEditor() {
      onDispose();
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

test("the panel tells its owner when the editor closed it", async () => {
  const host = fakeHost();
  const session = bareSession("Space A");
  let closedCalls = 0;
  const panel = new SpacePanel("owner-1/space-a", session, host, { onClosed: () => closedCalls++ });

  await panel.show();
  assert.equal(closedCalls, 0, "the owner is not told of a close before one happens");

  host.made[0].closeFromEditor();

  assert.equal(closedCalls, 1, "the owner was told exactly once when the editor closed the tab");
});
