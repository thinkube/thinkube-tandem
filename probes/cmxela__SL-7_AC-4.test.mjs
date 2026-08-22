// WHY (INVARIANT): when the editor closes a space's tab, the panel must
// tell its owner so nothing keeps a dead tab registered — a register that
// never hears about a closed tab would show a phantom tab forever and
// refuse to open a fresh one for that space. This must hold for as long as
// panels are looked up by whether they are still open.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { SpacePanel } from "../out-test/surfaces/panel.js";

function bareSession() {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac4-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac4-keys-")),
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

/** A fake webview panel whose "editor" side can raise dispose on demand,
 *  exactly as VS Code does when the human closes the tab. */
function fakeWebviewPanel() {
  let onDispose;
  return {
    closeFromEditor() {
      return onDispose?.();
    },
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u) => u,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async () => true,
    },
    reveal() {},
    onDidDispose: (cb) => {
      onDispose = cb;
      return { dispose() {} };
    },
    dispose() {},
  };
}

function fakeHost() {
  const panels = [];
  return {
    panels,
    createPanel() {
      const p = fakeWebviewPanel();
      panels.push(p);
      return p;
    },
  };
}

test("the panel tells its owner when the editor closed it, so nothing keeps a dead tab", async () => {
  const host = fakeHost();
  let closedKey;
  const panel = new SpacePanel(
    { key: "owner/space-a", name: "Space A", session: bareSession() },
    host,
    { onClosed: (key) => { closedKey = key; } },
  );
  await panel.show();

  // The editor itself closes the tab — never a call the extension makes.
  host.panels[0].closeFromEditor();

  assert.equal(
    closedKey,
    "owner/space-a",
    "the panel must tell its owner which space's tab the editor closed",
  );
});
