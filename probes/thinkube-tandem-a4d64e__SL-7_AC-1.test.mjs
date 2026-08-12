// WHY (INVARIANT): each open tab must read and write only its own thinking
// space. This must hold forever — a run started in space A must update only
// A's run log and machine activity; B's tab, open at the same time, must
// keep showing B's own state, untouched, whatever A's background work does.
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function installFakeVscode() {
  const panels = [];
  const fakeVscode = {
    ViewColumn: { One: 1 },
    Uri: {
      joinPath: (base, ...parts) => ({
        fsPath: path.join(base.fsPath ?? String(base), ...parts),
        toString: () => path.join(base.fsPath ?? String(base), ...parts),
      }),
      file: (p) => ({ fsPath: p, toString: () => p }),
    },
    window: {
      createWebviewPanel: (_viewType, title) => {
        const listeners = { dispose: [] };
        const panel = {
          title,
          webview: {
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri) => uri,
            postMessage: (msg) => {
              panel._messages = panel._messages || [];
              panel._messages.push(msg);
              return Promise.resolve(true);
            },
            onDidReceiveMessage: () => ({ dispose: () => {} }),
          },
          reveal: () => {},
          onDidDispose: (cb) => {
            listeners.dispose.push(cb);
            return { dispose: () => {} };
          },
          dispose: () => {
            for (const cb of listeners.dispose) cb();
          },
        };
        panels.push(panel);
        return panel;
      },
      withProgress: async (_opts, fn) => fn({ report: () => {} }, { onCancellationRequested: () => {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    workspace: { openTextDocument: async (opts) => ({ ...opts }) },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  return { panels, restore: () => { Module._load = originalLoad; } };
}

function fakeSession(repoName) {
  return {
    space: { asks: [], nodes: [], units: [], cuts: [], deliveries: [], questions: [], subjects: [], claims: [], impacts: [] },
    units: [],
    running: false,
    activity: undefined,
    pendingCheck: undefined,
    runNote: undefined,
    repoName,
    runState: undefined,
    stale: new Set(),
    cutNodeIds: new Set(),
    modelFailure: undefined,
    pendingModel: undefined,
    priceOf: () => ({ state: "free", subjects: 0, promises: 0, alsoReads: [] }),
    thinkingCost: () => ({ subjects: 0, rounds: 0 }),
    groundingView: () => [],
    unrunCut: () => undefined,
    logView: () => [],
    draftRead: () => false,
    deliveryPage: () => undefined,
    deps: { now: () => "2026-08-12T00:00:00Z", docsGateMode: "blocking" },
  };
}

test("a run started in space A updates only A's tab; B's tab keeps showing B's own unchanged state", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessionA = fakeSession("repo (space A)");
    const sessionB = fakeSession("repo (space B)");
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessionA, extensionUri);
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "b", label: "B" }, () => sessionB, extensionUri);

    const panelA = fake.panels.find((p) => p.title === "A");
    const panelB = fake.panels.find((p) => p.title === "B");
    const bMessageCountBefore = panelB._messages.length;

    // A thinks in the background: its run log and activity change while
    // nothing about B changes.
    sessionA.running = true;
    sessionA.activity = { label: "building", current: 1, total: 3 };
    sessionA.logView = () => ["A started a run"];
    sessionA.runState = {
      view: () => ({ units: [{ id: "u1", slice: "SL-1", state: "running" }], parked: [] }),
    };

    // The extension re-pushes A's own tab when A's session reports change —
    // simulated here the same way pushActive drives it: re-showing A's own
    // panel with its own session getter.
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessionA, extensionUri);

    const lastAMessage = panelA._messages[panelA._messages.length - 1];
    assert.equal(lastAMessage.runLog?.[0] ?? lastAMessage.runLog, "A started a run");
    assert.equal(lastAMessage.run?.units?.[0]?.id, "u1");

    assert.equal(
      panelB._messages.length,
      bMessageCountBefore,
      "B's tab must receive no push from A's run",
    );
    const lastBMessage = panelB._messages[panelB._messages.length - 1];
    assert.equal(lastBMessage.running, false, "B's own state must still read unchanged");
    assert.deepEqual(lastBMessage.runLog, [], "B's run log must still be empty");
  } finally {
    fake.restore();
  }
});
