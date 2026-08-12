// WHY (TRANSITION): before this slice, deactivate() disposed a single
// module-level panel — with several tabs now open (one per space), that
// call would leave every tab but the last one dangling. This proves
// deactivate() disposes EVERY open space tab and leaves the registry
// empty. Its job is done once deactivate() sweeps the whole panel map.
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
          _disposed: false,
          webview: {
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri) => uri,
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage: () => ({ dispose: () => {} }),
          },
          reveal: () => {},
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

test("with tabs for spaces A and B open, deactivate() disposes both panels and leaves no registry entry behind", async () => {
  const fake = installFakeVscode();
  try {
    const ext = await import(path.join(repoRoot, "out", "extension.js"));
    const { openSpaceFor, deactivate } = ext;
    const sessions = { a: fakeSession("repo (space A)"), b: fakeSession("repo (space B)") };
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/panelco", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    await openSpaceFor({ ownerKey: "acme/panelco", slug: "b", label: "B" }, () => sessions.b, extensionUri);
    assert.equal(fake.panels.length, 2);
    assert.ok(fake.panels.every((p) => !p._disposed));

    deactivate();

    assert.ok(
      fake.panels.every((p) => p._disposed),
      "deactivate() must dispose every open space panel, not only the last one opened",
    );

    // Reopening after deactivate() must create fresh tabs — nothing in the
    // registry should still point at the disposed panels.
    await openSpaceFor({ ownerKey: "acme/panelco", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    assert.equal(fake.panels.length, 3, "no stale registry entry may survive deactivate()");
  } finally {
    fake.restore();
  }
});
