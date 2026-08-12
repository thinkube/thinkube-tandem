// WHY (TRANSITION): the pre-slice code held the space panel in one
// module-level variable ("let panel: SpacePanel | undefined"), which is
// structurally incompatible with one tab per space. This proves that
// singleton is gone from the source: no module-level binding can hold a
// single SpacePanel once the registry (keyed by space) lands. Its job is
// done once that source pattern is removed for good.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("extension.ts holds no single module-level SpacePanel reference", () => {
  const src = fs.readFileSync(path.join(repoRoot, "src", "extension.ts"), "utf8");
  // The pre-slice shape this proves gone: a lone, reassignable top-level
  // binding typed as exactly one SpacePanel (not a collection of them).
  const singletonPattern = /\b(let|var)\s+panel\s*:\s*SpacePanel\s*\|\s*undefined/;
  assert.ok(
    !singletonPattern.test(src),
    "extension.ts must no longer declare a single module-level 'panel: SpacePanel | undefined' — a Map/registry keyed by space must replace it",
  );
});

test("the space panel is held in a keyed registry, not a bare module-level SpacePanel variable", async () => {
  // Behavioural companion to the source check above: two spaces open
  // side by side must both survive — impossible if a single module-level
  // binding is still the storage.
  const Module = (await import("node:module")).default;
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
      withProgress: async (_o, fn) => fn({ report: () => {} }, { onCancellationRequested: () => {} }),
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
  try {
    const { openSpaceFor } = await import(path.join(repoRoot, "out", "extension.js"));
    const session = () => ({
      space: { asks: [], nodes: [], units: [], cuts: [], deliveries: [], questions: [], subjects: [], claims: [], impacts: [] },
      units: [],
      running: false,
      activity: undefined,
      pendingCheck: undefined,
      runNote: undefined,
      repoName: "repo",
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
    });
    const extensionUri = { fsPath: repoRoot };
    await openSpaceFor({ ownerKey: "acme/reg", slug: "a", label: "A" }, session, extensionUri);
    await openSpaceFor({ ownerKey: "acme/reg", slug: "b", label: "B" }, session, extensionUri);
    assert.equal(panels.length, 2, "a single module-level panel binding could not hold both A and B open at once");
  } finally {
    Module._load = originalLoad;
  }
});
