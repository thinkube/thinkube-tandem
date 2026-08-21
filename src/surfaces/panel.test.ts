/**
 * One thinking space's own editor tab: titled with the space's own display
 * name, addressed against its own bound session — never a session looked
 * up as "active" — and independent of every other open tab.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { HostPanel, HostWebview, PanelHost, SpacePanel } from "./panel";
import { TandemSession } from "./session";

function bareSession(spaceName: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-")),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), "tandem-keys-")),
    now: () => "2026-08-20T10:00:00Z",
    author: "t",
    spaceName,
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

function fakePanelHandle(): HostPanel & {
  revealed: number;
  disposed: boolean;
  fire(msg: unknown): unknown;
  closeFromEditor(): void;
} {
  let onMessage: ((msg: unknown) => unknown) | undefined;
  let onDispose: (() => void) | undefined;
  return {
    revealed: 0,
    disposed: false,
    reveal() {
      this.revealed++;
    },
    dispose() {
      this.disposed = true;
    },
    onDidDispose(cb: () => void) {
      onDispose = cb;
      return { dispose() {} };
    },
    webview: {
      html: "",
      postMessage: async () => true,
      onDidReceiveMessage(cb: (msg: unknown) => unknown) {
        onMessage = cb;
        return { dispose() {} };
      },
      asWebviewUri: (u: unknown) => u,
      cspSource: "vscode-resource:",
    } as unknown as HostWebview,
    // Test-only helpers, mirroring what the real editor would do.
    fire(msg: unknown) {
      return onMessage!(msg);
    },
    closeFromEditor() {
      onDispose!();
    },
  };
}

function fakeHost(): PanelHost & { requests: string[]; made: ReturnType<typeof fakePanelHandle>[] } {
  const requests: string[] = [];
  const made: ReturnType<typeof fakePanelHandle>[] = [];
  return {
    requests,
    made,
    createPanel(title: string) {
      requests.push(title);
      const handle = fakePanelHandle();
      made.push(handle);
      return handle;
    },
  };
}

test("a SpacePanel opened for a space asks its host to create a panel titled with that space's display name", async () => {
  const host = fakeHost();
  const session = bareSession("Rebrand the checkout flow");
  const panel = new SpacePanel("owner-1/rebrand", session, host);

  await panel.show();

  assert.equal(host.requests.length, 1, "the host was asked to create exactly one panel");
  assert.equal(
    host.requests[0],
    "Rebrand the checkout flow",
    "the panel was titled with the space's own display name, not a fixed string or the repo name",
  );
});

test("two SpacePanels for two different spaces each ask the host for their own panel — neither reuses nor disposes the other's", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const sessionA = bareSession("Space A");
  const sessionB = bareSession("Space B");

  const panelA = new SpacePanel("owner-1/space-a", sessionA, hostA);
  const panelB = new SpacePanel("owner-1/space-b", sessionB, hostB);

  await panelA.show();
  await panelB.show();

  assert.equal(hostA.made.length, 1, "space A's host built exactly one panel for space A");
  assert.equal(hostB.made.length, 1, "space B's host built exactly one panel for space B");
  assert.notEqual(hostA.made[0], hostB.made[0], "the two spaces hold two distinct panel handles");

  assert.equal(hostA.made[0].disposed, false, "opening space B never disposes space A's panel");
  assert.equal(hostB.made[0].disposed, false, "space B's own panel is not disposed by opening it");
  assert.equal(hostA.made[0].revealed, 0, "opening space B never reveals space A's panel");
});

test("a webview action arriving on one space's panel is handled against that panel's own session, not a session looked up as 'active'", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const sessionA = bareSession("Space A");
  const sessionB = bareSession("Space B");

  const panelA = new SpacePanel("owner-1/space-a", sessionA, hostA);
  const panelB = new SpacePanel("owner-1/space-b", sessionB, hostB);

  await panelA.show();
  await panelB.show();

  const handleA = hostA.made[0];
  const handleB = hostB.made[0];

  await handleA.fire({ action: "save-draft", text: "typed into space A" });

  assert.equal(
    sessionA.space.draft,
    "typed into space A",
    "the action fired on space A's panel is handled against space A's own session",
  );
  assert.notEqual(
    sessionB.space.draft,
    "typed into space A",
    "space B's session is never touched by an action that arrived on space A's panel",
  );

  await handleB.fire({ action: "save-draft", text: "typed into space B" });

  assert.equal(
    sessionB.space.draft,
    "typed into space B",
    "the action fired on space B's panel is handled against space B's own session",
  );
  assert.equal(
    sessionA.space.draft,
    "typed into space A",
    "space A's session keeps what was typed into it — unaffected by the later action on space B's panel",
  );
});

test("the panel tells its owner when the editor closed it, so nothing keeps a dead tab", async () => {
  const host = fakeHost();
  const session = bareSession("Space A");
  let closedCalls = 0;
  const panel = new SpacePanel("owner-1/space-a", session, host, { onClosed: () => closedCalls++ });

  await panel.show();
  assert.equal(closedCalls, 0, "the owner is not told of a close before one happens");

  host.made[0].closeFromEditor();

  assert.equal(closedCalls, 1, "the owner was told exactly once when the editor closed the tab");
});
