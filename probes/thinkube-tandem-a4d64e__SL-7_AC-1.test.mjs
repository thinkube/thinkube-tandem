// WHY (TRANSITION): SpacePanel used to keep one hardcoded "Tandem" panel
// title. This proves a SpacePanel opened for a space asks its host to
// create the underlying panel titled with THAT space's own display name —
// the one-tab-per-space design needs each tab visibly labelled with the
// space it belongs to, so this proves the labelling landed.
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
  const requests = [];
  return {
    requests,
    createPanel(title) {
      requests.push(title);
      return fakePanelHandle();
    },
  };
}

test("a SpacePanel opened for a space asks its host to create a panel titled with that space's display name", async () => {
  const host = fakeHost();
  const session = bareSession("Rebrand the checkout flow");
  const panel = new SpacePanel("owner-1/rebrand", session, host);

  await panel.show();

  assert.equal(host.requests.length, 1, "the host was asked to create exactly one panel");
  assert.equal(
    host.requests[0],
    "Rebrand the checkout flow",
    "the panel was titled with the space's own display name, not a fixed string or the repo name",
  );
});
