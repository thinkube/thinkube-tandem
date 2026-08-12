// WHY (TRANSITION): before this slice there was one panel for the whole
// extension, so closing it lost every space at once. This proves the new
// per-space registry: closing space A's tab (the human clicking the tab's
// close button, i.e. the webview's onDidDispose firing) must leave space
// B's tab open and working, and reopening A afterwards must open a fresh
// tab rather than reviving a disposed one. Its job is done once the
// registry drops a panel entry on dispose.
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
          // Simulates the human closing the tab from the VS Code UI —
          // fires the same onDidDispose callbacks show() registered.
          _userCloses: () => {
            for (const cb of listeners.dispose) cb();
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

test("closing space A's tab leaves space B's tab open; reopening A opens a fresh tab", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessions = { a: fakeSession("repo (space A)"), b: fakeSession("repo (space B)") };
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "b", label: "B" }, () => sessions.b, extensionUri);
    assert.equal(fake.panels.length, 2);

    // The human closes A's tab from the VS Code UI.
    fake.panels[0]._userCloses();

    // B's tab must still work: pushing to it (via a fresh show()) must not
    // throw and must still be the same tab, not a new one.
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "b", label: "B" }, () => sessions.b, extensionUri);
    assert.equal(fake.panels.length, 2, "B's tab must be revealed, not duplicated, and A's closed tab must not resurrect");

    // Reopening the closed space A must open a FRESH tab (a third
    // webview panel), not reveal the disposed one.
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    assert.equal(fake.panels.length, 3, "reopening a closed space must create a new tab");
    assert.deepEqual(fake.panels.map((p) => p.title).sort(), ["A", "B", "B"]);
  } finally {
    fake.restore();
  }
});
