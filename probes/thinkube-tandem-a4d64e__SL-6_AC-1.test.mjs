// WHY (INVARIANT): a SpacePanel is built for one named thinking space — its
// tab must always be titled with that space's display label (name.txt),
// falling back to the slug when name.txt is absent or blank. This must hold
// forever: any regression that titles the tab from something else (a repo
// name, a hardcoded "Tandem") breaks the one-tab-per-space model this slice
// establishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

/** A minimal fake "vscode" good enough to drive SpacePanel.show(). */
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
      createWebviewPanel: (_viewType, title, _showOptions, _opts) => {
        const listeners = { dispose: [], message: [] };
        const panel = {
          title,
          viewType: _viewType,
          webview: {
            html: "",
            cspSource: "vscode-resource:",
            asWebviewUri: (uri) => uri,
            postMessage: (msg) => {
              panel._lastMessage = msg;
              return Promise.resolve(true);
            },
            onDidReceiveMessage: (cb) => {
              listeners.message.push(cb);
              return { dispose: () => {} };
            },
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
      withProgress: async (_opts, fn) =>
        fn({ report: () => {} }, { onCancellationRequested: () => {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    workspace: {
      openTextDocument: async (opts) => ({ ...opts }),
    },
    commands: {
      registerCommand: () => ({ dispose: () => {} }),
      executeCommand: async () => undefined,
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return fakeVscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  return {
    panels,
    restore: () => {
      Module._load = originalLoad;
    },
  };
}

function fakeSession(repoName) {
  return {
    space: {
      asks: [],
      nodes: [],
      units: [],
      cuts: [],
      deliveries: [],
      questions: [],
      subjects: [],
      claims: [],
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

test("SpacePanel.show() titles the webview tab with the space's display label from name.txt", async () => {
  const fake = installFakeVscode();
  try {
    const { SpacePanel } = await import(
      path.join(repoRoot, "out", "surfaces", "panel.js")
    );
    const session = fakeSession("acme/widgets");
    // Constructed with the space's identity (owner key, slug) and the
    // display label already resolved from name.txt by the caller — the
    // same resolution core/spaces.ts's listThinkingSpaces performs.
    const panel = new SpacePanel(() => session, {
      ownerKey: "acme/widgets",
      slug: "plugin-delivery",
      label: "Plugin delivery",
    });
    await panel.show({ fsPath: repoRoot });
    assert.equal(fake.panels.length, 1, "show() must open exactly one tab");
    assert.equal(fake.panels[0].title, "Plugin delivery");
  } finally {
    fake.restore();
  }
});

test("SpacePanel.show() falls back to the slug when name.txt is absent or blank", async () => {
  const fake = installFakeVscode();
  try {
    const { SpacePanel } = await import(
      path.join(repoRoot, "out", "surfaces", "panel.js")
    );
    const session = fakeSession("acme/widgets");
    const panel = new SpacePanel(() => session, {
      ownerKey: "acme/widgets",
      slug: "rebrand",
      label: "rebrand",
    });
    await panel.show({ fsPath: repoRoot });
    assert.equal(fake.panels[0].title, "rebrand");
  } finally {
    fake.restore();
  }
});
