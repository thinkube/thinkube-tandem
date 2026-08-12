// WHY (INVARIANT): each tab must render the map — subjects, claims,
// promises, sentences — of the one space it was opened for, never another
// open space's map. This must hold forever: it is the whole premise of one
// tab per thinking space, and it must survive any number of tabs open at
// once.
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

function fakeSessionWithMap(repoName, { subjectName, claimText, promiseText, askText }) {
  const askId = "ask-1";
  const claimId = "claim-1";
  const nodeId = "node-1";
  return {
    space: {
      asks: [{ id: askId, text: askText }],
      nodes: [
        {
          id: nodeId,
          sentence: promiseText,
          servesClaim: claimId,
          serves: [askId],
          grounding: { touchpoints: [] },
          acceptance: [],
          needs: [],
        },
      ],
      units: [],
      cuts: [],
      deliveries: [],
      questions: [],
      subjects: [{ id: "subj-1", name: subjectName, from: [askId] }],
      claims: [{ id: claimId, text: claimText, why: "", subjectId: "subj-1", fromAsk: askId }],
      impacts: [],
    },
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

test("each tab renders the subjects, claims, promises and sentences of its own space only", async () => {
  const fake = installFakeVscode();
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const sessionA = fakeSessionWithMap("repo (space A)", {
      subjectName: "Subject A",
      claimText: "Claim A",
      promiseText: "Promise A",
      askText: "Ask A",
    });
    const sessionB = fakeSessionWithMap("repo (space B)", {
      subjectName: "Subject B",
      claimText: "Claim B",
      promiseText: "Promise B",
      askText: "Ask B",
    });
    const extensionUri = { fsPath: repoRoot };

    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "a", label: "A" }, () => sessionA, extensionUri);
    await openSpaceFor({ ownerKey: "acme/gizmo", slug: "b", label: "B" }, () => sessionB, extensionUri);

    const panelA = fake.panels.find((p) => p.title === "A");
    const panelB = fake.panels.find((p) => p.title === "B");
    const mapA = panelA._messages[panelA._messages.length - 1];
    const mapB = panelB._messages[panelB._messages.length - 1];

    assert.equal(mapA.subjects?.[0]?.name, "Subject A");
    assert.equal(mapA.subjects?.[0]?.claims?.[0]?.text, "Claim A");
    assert.equal(mapA.subjects?.[0]?.claims?.[0]?.promises?.[0]?.text, "Promise A");
    assert.equal(mapA.sentences?.[0]?.text, "Ask A");

    assert.equal(mapB.subjects?.[0]?.name, "Subject B");
    assert.equal(mapB.subjects?.[0]?.claims?.[0]?.text, "Claim B");
    assert.equal(mapB.subjects?.[0]?.claims?.[0]?.promises?.[0]?.text, "Promise B");
    assert.equal(mapB.sentences?.[0]?.text, "Ask B");

    // Neither tab's map carries a trace of the other space's content.
    const namesInA = JSON.stringify(mapA);
    const namesInB = JSON.stringify(mapB);
    assert.equal(namesInA.includes("Subject B"), false);
    assert.equal(namesInB.includes("Subject A"), false);
  } finally {
    fake.restore();
  }
});
