/**
 * Creating a real VS Code webview panel needs the running editor window, so
 * "a second space never reveals the first space's panel" cannot be proven
 * against the real editor in a standing test. SpacePanel must take the
 * window it creates its webview through as an injected seam, so a fake
 * window can record the title and identity of each panel it is asked to
 * create.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SpacePanel } from "./panel";
import { emptySpace } from "../core/schema";
import type { TandemSession } from "./session";

/** Just enough of TandemSession's surface for spacePush to read without
 *  throwing — SpacePanel pushes the whole state after it shows itself. */
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

/** A minimal fake of the vscode.window surface SpacePanel needs to create
 *  and show a webview panel, recording what it was asked to create. */
function fakeWindow() {
  const created: { title: string; panel: { id: number } }[] = [];
  let nextId = 1;
  const window = {
    createWebviewPanel(_viewType: string, title: string) {
      const panel = {
        id: nextId++,
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
      created.push({ title, panel: { id: panel.id } });
      return panel;
    },
  };
  return { window, created };
}

// TRANSITION: SpacePanel gains an injected window seam in this slice — this
// proves the seam is used: showing the panel asks the fake window to create
// a webview panel titled with this space's own title.
test("SpacePanel creates its webview through the injected window with the space's title", async () => {
  const { window, created } = fakeWindow();
  const session = fakeSession();
  const panelObj = new SpacePanel("repo/main", "Main Thread", () => session, undefined, window as never);
  await panelObj.show({ fsPath: "/ext" } as never);
  assert.equal(created.length, 1, "expected one panel to be created");
  assert.equal(created[0].title, "Main Thread");
});
