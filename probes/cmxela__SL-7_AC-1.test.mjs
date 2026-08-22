// WHY (TRANSITION): today one module-level panel exists for the whole
// extension; this proves the replacement — a SpacePanel built for ONE
// thinking space — asks its host to create a panel titled with that
// space's own display name, not a fixed "Tandem" title or the repo name.
// Its job is done once SpacePanel carries a per-space title into the host.
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
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac1-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-sl7-ac1-keys-")),
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

/** A fake webview panel — just enough surface for SpacePanel to drive. */
function fakeWebviewPanel() {
  return {
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u) => u,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async () => true,
    },
    reveal: () => {},
    onDidDispose: () => ({ dispose() {} }),
    dispose: () => {},
  };
}

/** A fake host: records every title it was asked to create a panel with. */
function fakeHost() {
  const createdTitles = [];
  return {
    createdTitles,
    createPanel(title) {
      createdTitles.push(title);
      return fakeWebviewPanel();
    },
  };
}

test('a SpacePanel opened for a space asks its host to create a panel whose title is that space\'s display name', async () => {
  const session = bareSession();
  const host = fakeHost();
  const panel = new SpacePanel(
    { key: "owner-a/plugin-delivery", name: "Plugin delivery", session },
    host,
  );
  await panel.show();
  assert.deepEqual(
    host.createdTitles,
    ["Plugin delivery"],
    "the host must be asked to create exactly one panel titled with the space's display name",
  );
});
