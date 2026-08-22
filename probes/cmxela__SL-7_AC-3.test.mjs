// WHY (INVARIANT): a webview message arriving on one space's panel must
// always be handled against that panel's OWN session, never a session
// looked up as "the active one" — so typing in one open tab can never act
// on the map of a different open thinking space. This must hold for as
// long as more than one space's tab can be open at once.
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
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl7-ac3-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-sl7-ac3-${tag}-keys-`)),
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

/** A fake webview panel that captures the message handler so the test can
 *  fire an inbound action exactly like the real editor would. */
function fakeWebviewPanel() {
  let onMessage;
  return {
    fire(msg) {
      return onMessage?.(msg);
    },
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u) => u,
      onDidReceiveMessage: (cb) => {
        onMessage = cb;
        return { dispose() {} };
      },
      postMessage: async () => true,
    },
    reveal() {},
    onDidDispose: () => ({ dispose() {} }),
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

test("a webview action arriving on one space's panel is handled against that panel's own session, not a session looked up as active", async () => {
  const sessionA = bareSession("a");
  const sessionB = bareSession("b");
  sessionA.saveDraft("draft belonging to space A");
  sessionB.saveDraft("draft belonging to space B");

  const hostA = fakeHost();
  const hostB = fakeHost();
  const panelA = new SpacePanel({ key: "owner/space-a", name: "Space A", session: sessionA }, hostA);
  const panelB = new SpacePanel({ key: "owner/space-b", name: "Space B", session: sessionB }, hostB);
  await panelA.show();
  await panelB.show();

  // Fire an inbound action on space B's panel. It must mutate session B —
  // never session A — regardless of which space was opened or acted on last.
  await hostB.panels[0].fire({ action: "save-draft", text: "typed while B's tab is open" });

  assert.equal(
    sessionB.space.draft,
    "typed while B's tab is open",
    "the action fired on B's panel must be handled against session B",
  );
  assert.equal(
    sessionA.space.draft,
    "draft belonging to space A",
    "the action fired on B's panel must never touch session A",
  );
});
