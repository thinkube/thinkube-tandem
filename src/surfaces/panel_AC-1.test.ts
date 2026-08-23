/**
 * A SpacePanel opened for a space asks its host to create a panel whose title
 * is that space's display name (seen through a fake host).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { SpacePanel } from "./panel";
import type { PanelHost, PanelLike } from "./panel";

function fakeWebviewPanel(): PanelLike & { disposed: boolean } {
  const tab = {
    disposed: false,
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u: unknown) => u,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async () => true,
    },
    reveal() {},
    onDidDispose: () => ({ dispose() {} }),
    dispose() {
      tab.disposed = true;
    },
  };
  return tab;
}

function fakeHost(): PanelHost & { titles: string[] } {
  const titles: string[] = [];
  return {
    titles,
    createPanel(title: string) {
      titles.push(title);
      return fakeWebviewPanel();
    },
  };
}

function bareSession(tag: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-${tag}-keys-`)),
    now: () => "2026-08-18T10:00:00Z",
    author: "t",
    readCurrentStamp: async () => [],
    knowledge: async () => ({
      repoRoot: "/repo",
      graph: { graphPath: "/g.json", stamp: { root: "/repo", head: "h", dirty: "" } },
      map: "",
      digest: "",
      provision: "",
      prepare: "",
      resetup: async () => ({ provision: "", prepare: "", runOne: "" }),
      proveSetup: () => {},
      decisions: [],
      ask: async () => "",
      affected: async () => "",
    }),
  } as unknown as ConstructorParameters<typeof TandemSession>[0]);
}

test("the panel is created with the space's display name as its title", async () => {
  const host = fakeHost();
  const panel = new SpacePanel(
    { key: "owner-a/plugin-delivery", name: "Plugin delivery", session: bareSession("panel-ac1") },
    host,
  );

  await panel.show();

  assert.deepEqual(
    host.titles,
    ["Plugin delivery"],
    "the host must be asked for exactly one panel titled with the space's display name",
  );
});
