/**
 * INVARIANT — a space panel is built for one thinking space: showing it the
 * first time makes exactly one panel, and that panel is titled with the
 * name of the space it was constructed for (never a fixed product name).
 * This must always hold: every future SpacePanel, for every space, keeps
 * this true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanel, PanelHost } from "./panel";
import { TandemSession } from "./session";

/** A webview stub carrying just enough surface for panel.ts to drive it. */
function fakeWebviewPanel() {
  const messages: unknown[] = [];
  const disposeListeners: (() => void)[] = [];
  return {
    revealed: 0,
    messages,
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      postMessage: async (m: unknown) => {
        messages.push(m);
        return true;
      },
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

/** A fake host records every panel it was asked to create, so a test can
 *  assert on how many times — and with what title — the real host would
 *  have been called. */
function fakeHost(): PanelHost & { created: { viewType: string; title: string }[] } {
  const created: { viewType: string; title: string }[] = [];
  return {
    created,
    createPanel(viewType: string, title: string) {
      created.push({ viewType, title });
      return fakeWebviewPanel() as never;
    },
  };
}

/** A session backed by an empty, throwaway store — its content is never
 *  the point here, only that show() can push against something real. */
function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-panel-ac1-"));
  return new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  });
}

test("SpacePanel.show() creates exactly one panel, titled with the space's own name", async () => {
  const host = fakeHost();
  const session = throwawaySession();
  const panel = new SpacePanel({
    key: "repo-1/plugin-delivery",
    title: "plugin delivery",
    getSession: () => session,
    host,
  });

  await panel.show({} as never);

  assert.equal(host.created.length, 1, "show() asked the host for exactly one panel");
  assert.equal(
    host.created[0].title,
    "plugin delivery",
    "the panel was titled with the space name it was constructed with",
  );
});
