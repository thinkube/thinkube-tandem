/**
 * INVARIANT — a single tab close must always call the disposal callback
 * exactly once, never twice: calling dispose() on the panel itself after
 * the host already reported closure (or a caller disposing it directly)
 * must not double-report the same tab going away.
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
    dispose: () => {},
  };
}

function fakeHost(): PanelHost {
  return {
    createPanel() {
      return fakeWebviewPanel() as never;
    },
  };
}

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-ac8-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("SpacePanel calls its dispose callback once for its own dispose(), never twice for one tab", async () => {
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

  panel.dispose();

  assert.equal(disposedCalls, 1, "dispose() reported the tab going away exactly once");
});
