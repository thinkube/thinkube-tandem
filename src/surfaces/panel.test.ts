/**
 * spacePush's documentation-exemption field: present with the recorded
 * reason exactly when the session holds a pending exemption, and absent
 * entirely otherwise — so the rail can tell "said nothing" apart from
 * "said it is not needed".
 *
 * Also SpacePanel itself: one panel per space, titled with that space's
 * own display name, host-agnostic and never touching another space's
 * panel — a webview action is always handled against the panel's own
 * session, and the editor closing a tab is always told back to the owner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TandemSession } from "./session";
import { spacePush, SpacePanel } from "./panel";
import type { PanelHost, PanelLike } from "./panel";

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

test("spacePush carries the reason text when the session holds a documentation exemption", () => {
  const s = bareSession("panel-ac12");
  s.space = {
    ...s.space,
    nodes: [
      {
        id: "n1",
        sentence: "the widget resizes",
        serves: [],
        needs: [],
        grounding: { touchpoints: [{ path: "src/widget.ts" }], stamp: [] },
        acceptance: [{ id: "c1", text: "it resizes", kind: "probe" }],
      },
    ],
  } as never;
  s.cutNodeIds = new Set(["n1"]);
  const reason = "internal-only change, nothing to document";
  const r = s.excuseDocs(reason);
  assert.equal(r.ok, true);
  const push = spacePush(s);
  const raw = JSON.stringify(push);
  assert.ok(
    raw.includes(reason),
    "spacePush must carry the recorded exemption reason in its payload",
  );
});

test("spacePush carries no exemption field when the session holds none", () => {
  const s = bareSession("panel-ac13");
  const push = spacePush(s);
  const raw = JSON.stringify(push);
  assert.ok(
    !/docsExemption|pendingDocsExemption/i.test(raw),
    "spacePush for a session with no exemption must carry no exemption field",
  );
});

/** A fake webview panel — just enough surface for SpacePanel to drive,
 *  with hooks a test can use to fire inbound messages or a host-raised
 *  dispose exactly as the real editor would. */
function fakeWebviewPanel(): PanelLike & {
  fire: (msg: unknown) => unknown;
  closeFromEditor: () => unknown;
  disposed: boolean;
  revealed: number;
} {
  let onMessage: ((message: unknown) => unknown) | undefined;
  let onDispose: (() => void) | undefined;
  const tab = {
    disposed: false,
    revealed: 0,
    fire(msg: unknown) {
      return onMessage?.(msg);
    },
    closeFromEditor() {
      return onDispose?.();
    },
    webview: {
      html: "",
      cspSource: "fake:",
      asWebviewUri: (u: unknown) => u,
      onDidReceiveMessage: (cb: (message: unknown) => unknown) => {
        onMessage = cb;
        return { dispose() {} };
      },
      postMessage: async () => true,
    },
    reveal() {
      tab.revealed++;
    },
    onDidDispose: (cb: () => void) => {
      onDispose = cb;
      return { dispose() {} };
    },
    dispose() {
      tab.disposed = true;
    },
  };
  return tab;
}

/** A fake host: records every title and panel it was asked to create. */
function fakeHost(): PanelHost & {
  created: ReturnType<typeof fakeWebviewPanel>[];
  titles: string[];
} {
  const created: ReturnType<typeof fakeWebviewPanel>[] = [];
  const titles: string[] = [];
  return {
    created,
    titles,
    createPanel(title: string) {
      titles.push(title);
      const p = fakeWebviewPanel();
      created.push(p);
      return p;
    },
  };
}

test("a SpacePanel opened for a space asks its host to create a panel whose title is that space's display name", async () => {
  const session = bareSession("panel-sl7ac1");
  const host = fakeHost();
  const panel = new SpacePanel(
    { key: "owner-a/plugin-delivery", name: "Plugin delivery", session },
    host,
  );
  await panel.show();
  assert.deepEqual(
    host.titles,
    ["Plugin delivery"],
    "the host must be asked to create exactly one panel titled with the space's display name",
  );
});

test("two SpacePanels for two different spaces each ask the host for their own panel — neither reuses nor disposes the other's", async () => {
  const hostA = fakeHost();
  const hostB = fakeHost();
  const panelA = new SpacePanel(
    { key: "owner/space-a", name: "Space A", session: bareSession("panel-sl7ac2-a") },
    hostA,
  );
  const panelB = new SpacePanel(
    { key: "owner/space-b", name: "Space B", session: bareSession("panel-sl7ac2-b") },
    hostB,
  );
  await panelA.show();
  await panelB.show();

  assert.equal(hostA.created.length, 1, "space A's host must be asked for exactly one panel");
  assert.equal(hostB.created.length, 1, "space B's host must be asked for exactly one panel");
  assert.notEqual(
    hostA.created[0],
    hostB.created[0],
    "the two panels created must be distinct objects, one per space",
  );

  panelA.dispose();
  assert.equal(hostA.created[0].disposed, true, "disposing panel A must dispose its own panel");
  assert.equal(
    hostB.created[0].disposed,
    false,
    "disposing panel A must never dispose panel B's panel",
  );
});

test("a webview action arriving on one space's panel is handled against that panel's own session, not a session looked up as active", async () => {
  const sessionA = bareSession("panel-sl7ac3-a");
  const sessionB = bareSession("panel-sl7ac3-b");
  sessionA.saveDraft("draft belonging to space A");
  sessionB.saveDraft("draft belonging to space B");

  const hostA = fakeHost();
  const hostB = fakeHost();
  const panelA = new SpacePanel({ key: "owner/space-a", name: "Space A", session: sessionA }, hostA);
  const panelB = new SpacePanel({ key: "owner/space-b", name: "Space B", session: sessionB }, hostB);
  await panelA.show();
  await panelB.show();

  // Fire an inbound action on space B's panel. It must mutate session B —
  // never session A — regardless of which space was opened or acted on last.
  await hostB.created[0].fire({ action: "save-draft", text: "typed while B's tab is open" });

  assert.equal(
    sessionB.space.draft,
    "typed while B's tab is open",
    "the action fired on B's panel must be handled against session B",
  );
  assert.equal(
    sessionA.space.draft,
    "draft belonging to space A",
    "the action fired on B's panel must never touch session A",
  );
});

test("the panel tells its owner when the editor closed it, so nothing keeps a dead tab", async () => {
  const host = fakeHost();
  let closedKey: string | undefined;
  const panel = new SpacePanel(
    { key: "owner/space-a", name: "Space A", session: bareSession("panel-sl7ac4") },
    host,
    { onClosed: (key) => { closedKey = key; } },
  );
  await panel.show();

  // The editor itself closes the tab — never a call the extension makes.
  host.created[0].closeFromEditor();

  assert.equal(
    closedKey,
    "owner/space-a",
    "the panel must tell its owner which space's tab the editor closed",
  );
});
