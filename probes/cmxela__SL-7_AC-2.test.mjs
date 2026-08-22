// WHY (TRANSITION): today the extension keeps one shared panel; this proves
// the replacement — two SpacePanels, one per space, each ask the host for
// their OWN panel, and neither one reuses or disposes the panel the other
// one owns. Its job is done once no SpacePanel instance ever touches a
// panel it did not itself ask the host to create.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "../out-test/surfaces/session.js";
import { SpacePanel } from "../out-test/surfaces/panel.js";

function bareSession(tag) {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl7-ac2-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl7-ac2-${tag}-keys-`)),
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

function fakeWebviewPanel(id) {
  return {
    id,
    disposed: false,
    revealed: 0,
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u) => u,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async () => true,
    },
    reveal() {
      this.revealed++;
    },
    onDidDispose: () => ({ dispose() {} }),
    dispose() {
      this.disposed = true;
    },
  };
}

function fakeHost() {
  const created = [];
  return {
    created,
    createPanel(title) {
      const p = fakeWebviewPanel(title);
      created.push(p);
      return p;
    },
  };
}

test("two SpacePanels for two different spaces each ask the host for their own panel — neither reuses nor disposes the other's", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const panelA = new SpacePanel(
    { key: "owner/space-a", name: "Space A", session: bareSession("a") },
    hostA,
  );
  const panelB = new SpacePanel(
    { key: "owner/space-b", name: "Space B", session: bareSession("b") },
    hostB,
  );
  await panelA.show();
  await panelB.show();

  assert.equal(hostA.created.length, 1, "space A's host must be asked for exactly one panel");
  assert.equal(hostB.created.length, 1, "space B's host must be asked for exactly one panel");
  assert.notEqual(
    hostA.created[0],
    hostB.created[0],
    "the two panels created must be distinct objects, one per space",
  );

  panelA.dispose();
  assert.equal(hostA.created[0].disposed, true, "disposing panel A must dispose its own panel");
  assert.equal(
    hostB.created[0].disposed,
    false,
    "disposing panel A must never dispose panel B's panel",
  );
});
