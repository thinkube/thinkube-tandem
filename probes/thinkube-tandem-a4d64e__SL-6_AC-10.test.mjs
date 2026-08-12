// WHY (TRANSITION): before this slice, a delivery notification named no
// space and its "Open the space" button opened whatever the single
// remembered-active session was — with several spaces now able to run
// concurrently, that could open the WRONG tab. This proves pushActive()
// names the space that actually delivered and reveals that space's own
// tab, even when a different space is the remembered active one. Its job
// is done once the notification carries the originating space's identity
// end to end.
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
  const infoMessages = [];
  const warnMessages = [];
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
      withProgress: async (_o, fn) => fn({ report: () => {} }, { onCancellationRequested: () => {} }),
      showInformationMessage: async (msg, ...items) => {
        infoMessages.push(msg);
        return items[items.length - 1];
      },
      showWarningMessage: async (msg) => {
        warnMessages.push(msg);
        return undefined;
      },
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
  return {
    panels,
    infoMessages,
    warnMessages,
    restore: () => { Module._load = originalLoad; },
  };
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

test("a delivery notification from space B names B and its button reveals B's tab, even while A is the remembered active space", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor, pushActive } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessions = { a: fakeSession("repo (space A)"), b: fakeSession("repo (space B)") };
    const extensionUri = { fsPath: repoRoot };
    await openSpaceFor({ ownerKey: "acme/deliv", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    await openSpaceFor({ ownerKey: "acme/deliv", slug: "b", label: "B" }, () => sessions.b, extensionUri);
    const bPanel = fake.panels.find((p) => p.title === "B");
    const revealedBefore = bPanel.revealed;

    // A run in space B finishes while A is remembered as the active space.
    pushActive({ ownerKey: "acme/deliv", slug: "b", label: "B" }, "Delivery ready — the toolbar gains a clear button");

    const msg = fake.infoMessages.find((m) => m.includes("Delivery ready"));
    assert.ok(msg, "a Delivery ready notification must be shown");
    assert.ok(msg.includes("B"), 'the message must name the space it came from ("B")');
    assert.equal(bPanel.revealed, revealedBefore + 1, "the notification's action must reveal B's own tab");
  } finally {
    fake.restore();
  }
});
