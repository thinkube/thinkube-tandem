/**
 * TRANSITION — proves SpacePanel now tells its registry when its tab is
 * closed: driven by a fake window host that reports the tab closed, it
 * calls the disposal callback it was built with, so the registry (SL-7)
 * has a signal to drop that space's key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanel, PanelHost } from "./panel";
import { TandemSession } from "./session";

function fakeWebviewPanel() {
  const disposeListeners: (() => void)[] = [];
  return {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: async () => true,
      asWebviewUri: (u: unknown) => u,
    },
    reveal() {},
    onDidDispose: (cb: () => void) => {
      disposeListeners.push(cb);
      return { dispose: () => {} };
    },
    /** Simulates the user closing the tab: fires every registered listener. */
    closeTab() {
      for (const cb of disposeListeners) cb();
    },
    dispose: () => {},
  };
}

function fakeHost(): PanelHost & { last?: ReturnType<typeof fakeWebviewPanel> } {
  const host: PanelHost & { last?: ReturnType<typeof fakeWebviewPanel> } = {
    createPanel() {
      const p = fakeWebviewPanel();
      host.last = p;
      return p as never;
    },
  };
  return host;
}

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-ac7-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("SpacePanel calls its disposal callback when the host reports the tab was closed", async () => {
  const host = fakeHost();
  const session = throwawaySession();
  let disposedCalls = 0;
  const panel = new SpacePanel({
    key: "repo-1/space-a",
    title: "space a",
    getSession: () => session,
    host,
    onDisposed: () => {
      disposedCalls++;
    },
  } as never);

  await panel.show({} as never);
  assert.equal(disposedCalls, 0, "no disposal reported before the tab closes");

  host.last!.closeTab();

  assert.equal(disposedCalls, 1, "the disposal callback fired when the host reported the tab closed");
});
