// WHY (INVARIANT): calling show() a second time on the SAME SpacePanel must
// reveal the tab that already exists, never create a second one. This must
// hold forever — a regression here would silently multiply tabs for one
// space every time the human reopens it (e.g. from the tree view).
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
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage: () => ({ dispose: () => {} }),
          },
          _revealed: 0,
          _disposed: false,
          reveal: () => {
            panel._revealed++;
          },
          onDidDispose: (cb) => {
            listeners.dispose.push(cb);
            return { dispose: () => {} };
          },
          dispose: () => {
            panel._disposed = true;
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

test("show() called twice on the same SpacePanel reveals the same tab and creates no second tab", async () => {
  const fake = installFakeVscode();
  try {
    const { SpacePanel } = await import(path.join(repoRoot, "out", "surfaces", "panel.js"));
    const session = fakeSession("acme/widgets");
    const panel = new SpacePanel(() => session, { ownerKey: "acme/widgets", slug: "main", label: "Main" });
    await panel.show({ fsPath: repoRoot });
    await panel.show({ fsPath: repoRoot });
    assert.equal(fake.panels.length, 1, "a second show() must not open a second webview tab");
    assert.equal(fake.panels[0]._revealed, 1, "the second show() must reveal the existing tab");
  } finally {
    fake.restore();
  }
});
