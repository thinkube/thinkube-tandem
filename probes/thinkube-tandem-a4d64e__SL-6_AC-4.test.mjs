// WHY (TRANSITION): before this slice, the host held one panel for the
// whole extension — opening a second thinking space would re-point that
// single tab at the new space, dropping the first. This test proves that
// change: opening space A then space B leaves TWO tabs open side by side,
// titled with each space's own name, and opening B does not touch A's tab
// contents. Its job is done once the one-tab-per-space registry ships.
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

test("opening space A then space B leaves two tabs open, titled 'A' and 'B', neither touching the other's contents", async () => {
  const fake = installFakeVscode();
  try {
    // openSpaceFor is the landing symbol for this behavior per the SPEC
    // CONTRACT (src/extension.ts › openSpaceFor). Threading a per-space
    // identity through it — rather than reading only ambient workspace
    // state — is the change this slice makes; called here with the space
    // identity explicit is how that change is externally observable.
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessions = { a: fakeSession("repo (space A)"), b: fakeSession("repo (space B)") };
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/widgets", slug: "a", label: "A" }, () => sessions.a, extensionUri);
    const aMessageCountAfterA = fake.panels[0]._messages.length;

    await openSpaceFor({ ownerKey: "acme/widgets", slug: "b", label: "B" }, () => sessions.b, extensionUri);

    assert.equal(fake.panels.length, 2, "opening a second space must open a second tab, not replace the first");
    const titles = fake.panels.map((p) => p.title).sort();
    assert.deepEqual(titles, ["A", "B"]);
    assert.equal(
      fake.panels[0]._messages.length,
      aMessageCountAfterA,
      "opening space B must not push any further update into space A's tab",
    );
  } finally {
    fake.restore();
  }
});

