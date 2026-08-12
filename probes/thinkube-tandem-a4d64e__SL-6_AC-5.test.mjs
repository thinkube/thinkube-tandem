// WHY (INVARIANT): opening a space that already has a tab must reveal that
// tab, never open a duplicate — the registry is keyed by space identity,
// and a repeated open (from the tree view, a command, or a delivery
// notification) is a lookup, not a fresh creation. This must hold
// forever: it is what keeps "open" idempotent per space.
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
          revealed: 0,
          webview: {
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri) => uri,
            postMessage: () => Promise.resolve(true),
            onDidReceiveMessage: () => ({ dispose: () => {} }),
          },
          reveal: () => {
            panel.revealed++;
          },
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

test("opening an already-open space reveals its existing tab rather than opening a duplicate", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessions = { a: fakeSession("repo (space A)") };
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/widgets", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    const revealedAfterFirstOpen = fake.panels[0].revealed;
    await openSpaceFor({ ownerKey: "acme/widgets", slug: "a", label: "A" }, () => sessions.a, extensionUri);

    assert.equal(fake.panels.length, 1, "reopening the same space must not create a duplicate tab");
    assert.equal(
      fake.panels[0].revealed,
      revealedAfterFirstOpen + 1,
      "reopening the same space must reveal the existing tab",
    );
  } finally {
    fake.restore();
  }
});
