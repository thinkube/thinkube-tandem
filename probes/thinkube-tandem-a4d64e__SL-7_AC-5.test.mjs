// WHY (INVARIANT): when runs are under way in two spaces at once, the status
// bar must say that more than one space is working, rather than silently
// reporting only one of them as if it were the sole activity. This must
// hold forever — a status bar that names only one running space while a
// second is also busy is a lie about what the machine is doing.
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
  const statusBarItems = [];
  const fakeVscode = {
    ViewColumn: { One: 1 },
    StatusBarAlignment: { Left: 1 },
    ThemeColor: class {
      constructor(id) {
        this.id = id;
      }
    },
    Uri: {
      joinPath: (base, ...parts) => ({
        fsPath: path.join(base.fsPath ?? String(base), ...parts),
        toString: () => path.join(base.fsPath ?? String(base), ...parts),
      }),
      file: (p) => ({ fsPath: p, toString: () => p }),
    },
    window: {
      createStatusBarItem: () => {
        const item = { text: "", tooltip: "", backgroundColor: undefined, show: () => {}, dispose: () => {} };
        statusBarItems.push(item);
        return item;
      },
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
        };
        panels.push(panel);
        return panel;
      },
      withProgress: async (_opts, fn) => fn({ report: () => {} }, { onCancellationRequested: () => {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      createTreeView: () => ({ dispose: () => {} }),
      onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
    },
    workspace: {
      openTextDocument: async (opts) => ({ ...opts }),
      workspaceFolders: [],
      getConfiguration: () => ({ get: (_k, d) => d }),
    },
    commands: { registerCommand: () => ({ dispose: () => {} }), executeCommand: async () => undefined },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  return { panels, statusBarItems, restore: () => { Module._load = originalLoad; } };
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

test("with runs under way in two spaces at once, the status bar states more than one space is working", async () => {
  const fake = installFakeVscode();
  try {
    const { heartbeat } = await import(path.join(repoRoot, "out", "extension.js"));
    assert.equal(typeof heartbeat, "function", "extension.ts must export heartbeat for this to be verifiable");

    const sessionA = fakeSession("repo (space A)");
    const sessionB = fakeSession("repo (space B)");
    sessionA.running = true;
    sessionA.runState = {
      view: () => ({ units: [{ id: "u1", slice: "SL-1", state: "running" }], parked: [] }),
    };
    sessionB.running = true;
    sessionB.runState = {
      view: () => ({ units: [{ id: "u2", slice: "SL-2", state: "running" }], parked: [] }),
    };

    const statusBar = fake.statusBarItems[0] ?? { text: "", show: () => {} };
    const spaces = [
      { ownerKey: "acme/gizmo", slug: "a", label: "A", session: sessionA },
      { ownerKey: "acme/gizmo", slug: "b", label: "B", session: sessionB },
    ];
    heartbeat(statusBar, spaces, "acme/gizmo/a");

    // Reporting only one of the two names would be a silent undercount —
    // the text must indicate plurality (a count, "both", "2 spaces", …)
    // rather than reading as a single-space status.
    const namesBoth = /\bA\b/.test(statusBar.text) && /\bB\b/.test(statusBar.text);
    const statesPlurality = /\b2\b|more than one|multiple|both spaces/i.test(statusBar.text);
    assert.ok(
      namesBoth || statesPlurality,
      `status bar must state that more than one space is working, got: ${JSON.stringify(statusBar.text)}`,
    );
  } finally {
    fake.restore();
  }
});
