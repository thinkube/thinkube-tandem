// WHY (INVARIANT): pressing an action button in a tab must act on the
// thinking space THAT tab renders, never on whichever space happens to be
// remembered as "active" elsewhere in the host. This must hold forever —
// otherwise a click in B's tab could silently mutate A's space state.
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
        const listeners = { dispose: [], message: [] };
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
            onDidReceiveMessage: (cb) => {
              listeners.message.push(cb);
              return { dispose: () => {} };
            },
          },
          reveal: () => {},
          onDidDispose: (cb) => {
            listeners.dispose.push(cb);
            return { dispose: () => {} };
          },
          dispose: () => {
            for (const cb of listeners.dispose) cb();
          },
          // Simulates the webview posting an inbound action, exactly as the
          // real webview's postMessage-to-extension channel would.
          _fireInbound: async (msg) => {
            for (const cb of listeners.message) await cb(msg);
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

function fakeSession(repoName, tag) {
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
    // Marks which session actually got acted on.
    draft: "",
    saveDraft(text) {
      this._savedDraftBy = tag;
      this.draft = text;
    },
  };
}

test("an action pressed in tab B's webview acts on session B, leaving session A untouched", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessionA = fakeSession("repo (space A)", "A");
    const sessionB = fakeSession("repo (space B)", "B");
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessionA, extensionUri);
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "b", label: "B" }, () => sessionB, extensionUri);

    const panelB = fake.panels.find((p) => p.title === "B");
    await panelB._fireInbound({ action: "save-draft", text: "written in B" });

    assert.equal(sessionB._savedDraftBy, "B", "the action fired in B's tab must act on session B");
    assert.equal(sessionB.draft, "written in B");
    assert.equal(sessionA._savedDraftBy, undefined, "session A must be untouched by an action pressed in B's tab");
    assert.equal(sessionA.draft, "", "session A's draft must be unchanged");
  } finally {
    fake.restore();
  }
});
