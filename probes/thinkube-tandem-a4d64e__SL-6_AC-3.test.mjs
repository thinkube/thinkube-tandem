// WHY (INVARIANT): a SpacePanel is permanently bound to the one space it was
// built for — there must be no method that re-targets an existing panel at
// a different space's owner key or slug. This must hold forever: it is what
// makes "one tab per space" true instead of "one tab that gets repointed".
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
              panel._lastMessage = msg;
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

test("SpacePanel exposes no method that re-targets it at a different space", async () => {
  const fake = installFakeVscode();
  try {
    const { SpacePanel } = await import(path.join(repoRoot, "out", "surfaces", "panel.js"));
    const session = fakeSession("acme/widgets");
    const panel = new SpacePanel(() => session, { ownerKey: "acme/widgets", slug: "main", label: "Main" });
    await panel.show({ fsPath: repoRoot });
    // Every own + prototype method name on the instance, minus the
    // constructor and the known same-space operations (show, pushFrom,
    // dispose). Anything left that accepts a slug/ownerKey would be a
    // re-targeting door — none may exist.
    const proto = Object.getPrototypeOf(panel);
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && typeof panel[n] === "function",
    );
    const knownSameSpaceOps = new Set(["show", "pushFrom", "dispose"]);
    const suspicious = methodNames.filter((n) => !knownSameSpaceOps.has(n));
    assert.deepEqual(
      suspicious,
      [],
      `SpacePanel must expose no re-targeting method beyond show/pushFrom/dispose; found: ${suspicious.join(", ")}`,
    );
  } finally {
    fake.restore();
  }
});

test("the space identity SpacePanel renders is read-only after construction (no setter)", async () => {
  const fake = installFakeVscode();
  try {
    const { SpacePanel } = await import(path.join(repoRoot, "out", "surfaces", "panel.js"));
    const session = fakeSession("acme/widgets");
    const panel = new SpacePanel(() => session, { ownerKey: "acme/widgets", slug: "main", label: "Main" });
    await panel.show({ fsPath: repoRoot });
    assert.equal(fake.panels[0].title, "Main");
    // No property assignment on the instance can change the rendered
    // space's slug/ownerKey/label — those fields, if exposed at all, must
    // not be writable in a way that alters a later show()'s target.
    for (const key of ["slug", "ownerKey", "label"]) {
      if (key in panel) {
        try {
          panel[key] = "different-space";
        } catch {
          /* a thrown assignment is an acceptable way to refuse */
        }
      }
    }
    await panel.show({ fsPath: repoRoot });
    assert.equal(fake.panels.length, 1, "still one tab — show() did not open a tab for a different space");
    assert.equal(fake.panels[0].title, "Main", "the tab's title must still name the space it was built for");
  } finally {
    fake.restore();
  }
});
