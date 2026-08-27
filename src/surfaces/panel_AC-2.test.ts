/**
 * INVARIANT — a space panel never re-binds itself to another space: once
 * built, a second show() on the same instance reveals the one panel it
 * already made instead of asking the host to build a new one. This must
 * always hold, for every call after the first.
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
    revealed: 0,
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: async () => true,
      asWebviewUri: (u: unknown) => u,
    },
    reveal() {
      this.revealed++;
    },
    onDidDispose: (cb: () => void) => {
      disposeListeners.push(cb);
      return { dispose: () => {} };
    },
    dispose: () => {
      for (const cb of disposeListeners) cb();
    },
  };
}

function fakeHost(): PanelHost & { created: ReturnType<typeof fakeWebviewPanel>[] } {
  const created: ReturnType<typeof fakeWebviewPanel>[] = [];
  return {
    created,
    createPanel() {
      const p = fakeWebviewPanel();
      created.push(p);
      return p as never;
    },
  };
}

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-ac2-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("a second show() reveals the panel already made and asks the host for no second one", async () => {
  const host = fakeHost();
  const session = throwawaySession();
  const panel = new SpacePanel({
    key: "repo-1/plugin-delivery",
    title: "plugin delivery",
    getSession: () => session,
    host,
  });

  await panel.show({} as never);
  await panel.show({} as never);

  assert.equal(host.created.length, 1, "the host was never asked for a second panel");
  assert.equal(host.created[0].revealed, 1, "the existing panel was revealed instead");
});
