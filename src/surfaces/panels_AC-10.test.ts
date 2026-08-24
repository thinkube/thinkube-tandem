/**
 * Opening a second thinking space must never hand back or reveal the first
 * space's panel object — each space gets its own webview panel, proven
 * through the injected window seam: two distinct opens ask for two
 * distinct panels, and reopening the first key asks for none.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanel } from "./panel";
import { emptySpace } from "../core/schema";
import type { TandemSession } from "./session";

function fakeSession(): TandemSession {
  return {
    space: emptySpace(),
    running: false,
    activity: undefined,
    pendingCheck: undefined,
    runNote: undefined,
    runState: undefined,
    stale: new Set(),
    proofDrift: new Set(),
    cutNodeIds: new Set(),
    units: [],
    repoName: "repo",
    deps: { now: () => new Date().toISOString(), docsGateMode: "blocking" },
    unrunCut: () => undefined,
    groundingView: () => [],
    logView: () => undefined,
    thinkingCost: () => ({ subjects: 0, rounds: 0 }),
    priceOf: () => ({ state: "open", subjects: 0, promises: 0, alsoReads: 0 }),
    modelFailure: undefined,
    pendingModel: undefined,
    draftRead: () => [],
    deliveryPage: () => undefined,
    buildRefusal: undefined,
  } as unknown as TandemSession;
}

function fakeWindow() {
  const created: { title: string }[] = [];
  let nextId = 1;
  const window = {
    createWebviewPanel(_viewType: string, title: string) {
      const id = nextId++;
      created.push({ title });
      return {
        id,
        webview: {
          html: "",
          onDidReceiveMessage() {
            return { dispose() {} };
          },
          postMessage: async () => true,
          asWebviewUri: (u: unknown) => u,
          cspSource: "vscode-resource:",
        },
        reveal() {},
        onDidDispose() {
          return { dispose() {} };
        },
        dispose() {},
      };
    },
  };
  return { window, created };
}

// INVARIANT: two spaces get two panels, each created with its own name —
// the second space's open never reaches into or reveals the first space's
// panel object, and reopening an already-open key creates nothing new.
test("opening two space keys asks the window for two panels named for each space; reopening the first asks for none", async () => {
  const { window, created } = fakeWindow();
  const sessionA = fakeSession();
  const sessionB = fakeSession();

  const panelA = new SpacePanel("repo/main", "Main Thread", () => sessionA, undefined, window as never);
  const panelB = new SpacePanel("repo/other", "Rebrand Effort", () => sessionB, undefined, window as never);

  await panelA.show({ fsPath: "/ext" } as never);
  await panelB.show({ fsPath: "/ext" } as never);

  assert.equal(created.length, 2, "expected two panels created for two distinct spaces");
  assert.deepEqual(
    created.map((c) => c.title),
    ["Main Thread", "Rebrand Effort"],
  );

  // Reopening the first space's panel must not ask the window for another.
  await panelA.show({ fsPath: "/ext" } as never);
  assert.equal(created.length, 2, "expected no new panel created when the first space is reopened");
});
