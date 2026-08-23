/**
 * The REAL panel host, not a fake one: `makeVscodePanelHost` is what the
 * running extension hands every SpacePanel, so it is what decides whether
 * opening a second thinking space shows a second tab or quietly replaces
 * the first.
 *
 * The fake-host panel tests prove SpacePanel asks for one panel per space.
 * They cannot prove what the vscode-backed host does with that ask. This
 * file closes that gap by driving the real factory against a stub `vscode`
 * module: two spaces must produce two distinct panels, each titled with its
 * own space's name, and neither may be pinned to a fixed view column —
 * a fixed column is exactly how a second tab lands on top of the first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanel } from "./panel";
import { SpaceTabs } from "./spaceTabs";
import { TandemSession } from "./session";

/** One recorded createWebviewPanel call, plus the panel handed back. */
interface Recorded {
  viewType: string;
  title: string;
  showOptions: { viewColumn: unknown; preserveFocus: boolean };
}

const ACTIVE = Symbol("ViewColumn.Active");
const ONE = Symbol("ViewColumn.One");

/**
 * The tree-view classes the extension's import chain subclasses and
 * instantiates while it is still being required — `class X extends
 * vscode.TreeItem` runs at module load, so these must exist before
 * `require("../extension")` returns, or the load throws before any
 * assertion below is reached.
 */
class StubTreeItem {
  label: unknown;
  collapsibleState: unknown;
  constructor(label: unknown, collapsibleState?: unknown) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class StubThemeIcon {
  constructor(public readonly id: string) {}
}

class StubEventEmitter {
  event = () => ({ dispose() {} });
  fire() {}
  dispose() {}
}

/**
 * Where the stub currently records. `extension.ts` compiles to
 * `const vscode = require("vscode")` at module scope, so the namespace it
 * calls through is bound once, on first require, and never rebound — a
 * second stub object handed to a later test would never be reached. One
 * stub therefore lives for the whole file and every test points this sink
 * at its own array, so each test still observes only its own calls.
 */
let sink: Recorded[] = [];

/** Install a stub `vscode` for the duration of one call, then restore. */
function withStubVscode<T>(calls: Recorded[], run: () => T): T {
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
  sink = calls;
  const stub = {
    ViewColumn: { Active: ACTIVE, One: ONE },
    TreeItem: StubTreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: StubThemeIcon,
    EventEmitter: StubEventEmitter,
    workspace: {
      asRelativePath: (p: unknown) => String(p),
      getConfiguration: () => ({ get: () => undefined }),
      workspaceFolders: [],
    },
    Uri: {
      joinPath: (base: unknown, ...parts: string[]) => ({
        fsPath: [String((base as { fsPath?: string })?.fsPath ?? "/ext"), ...parts].join("/"),
      }),
    },
    window: {
      createWebviewPanel(
        viewType: string,
        title: string,
        showOptions: { viewColumn: unknown; preserveFocus: boolean },
      ) {
        sink.push({ viewType, title, showOptions });
        return {
          webview: {
            html: "",
            cspSource: "stub:",
            asWebviewUri: (u: unknown) => u,
            onDidReceiveMessage: () => ({ dispose() {} }),
            postMessage: async () => true,
          },
          reveal: () => {},
          onDidDispose: () => ({ dispose() {} }),
          dispose: () => {},
        };
      },
    },
  };
  (Module as unknown as { _load: unknown })._load = function (
    this: unknown,
    request: string,
    ...rest: unknown[]
  ) {
    if (request === "vscode") return stub;
    return (load as (...a: unknown[]) => unknown).call(this, request, ...rest);
  };
  try {
    return run();
  } finally {
    (Module as unknown as { _load: unknown })._load = load;
  }
}

test("the real vscode panel host gives two thinking spaces two distinct panels, each titled with its own space's name", () => {
  const calls: Recorded[] = [];
  withStubVscode(calls, () => {
    // Required inside the stub's lifetime: extension.ts imports vscode at
    // module load, so the stub must already be installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { makeVscodePanelHost } = require("../extension") as typeof import("../extension");
    const host = makeVscodePanelHost({ fsPath: "/ext" } as never);
    const a = host.createPanel("Space A");
    const b = host.createPanel("Space B");
    assert.notEqual(a, b, "each space must get its own panel object from the real host");
  });

  assert.equal(calls.length, 2, "the real host must create one webview panel per space asked for");
  assert.deepEqual(
    calls.map((c) => c.title),
    ["Space A", "Space B"],
    "each panel must carry its own space's display name as its title",
  );
});

/** A session with just enough state to carry its own display name — the
 *  name is a construction dep, exactly as the extension supplies it. */
function bareSession(tag: string, spaceName: string): TandemSession {
  return new TandemSession({
    round: { model: "sonnet", repoRoot: "/repo" },
    spaceName,
    storeDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-panelhost-${tag}-`)),
    storageDir: fs.mkdtempSync(path.join(os.tmpdir(), `tandem-panelhost-${tag}-keys-`)),
    now: () => "2026-08-23T00:00:00.000Z",
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

/**
 * The whole chain the extension actually builds, with no fake link in it:
 * the real SpaceTabs register, whose factory builds a real SpacePanel per
 * key, handed the real makeVscodePanelHost. The other checks each prove one
 * link against a fake neighbour — a fake host under SpacePanel, fake tabs
 * under the register, and the host called directly with no register or
 * panel above it. A chain can have three sound links and still lose the
 * second tab where they join, so this drives the composition itself: two
 * space keys opened through the register must reach the real host as two
 * createWebviewPanel calls, each carrying its own space's name.
 */
test("opening two thinking spaces through the real register, panel and host yields two distinct editor tabs, one per space", async () => {
  const calls: Recorded[] = [];
  const sessionA = bareSession("chain-a", "Space A");
  const sessionB = bareSession("chain-b", "Space B");
  const sessions = new Map([
    ["owner/space-a", sessionA],
    ["owner/space-b", sessionB],
  ]);

  const panels: SpacePanel[] = [];
  await withStubVscode(calls, async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { makeVscodePanelHost } = require("../extension") as typeof import("../extension");
    const host = makeVscodePanelHost({ fsPath: "/ext" } as never);
    // The same factory shape activate() installs: resolve the key's own
    // session, build that space's own SpacePanel, show it.
    const tabs = new SpaceTabs((key) => {
      const session = sessions.get(key);
      if (!session) throw new Error(`no session for ${key}`);
      const panel = new SpacePanel(
        { key, name: session.spaceName ?? key, session },
        host,
      );
      panels.push(panel);
      void panel.show();
      return panel;
    });

    tabs.open("owner/space-a");
    tabs.open("owner/space-b");
    // Opening an already-open key must not spend a third tab on it.
    tabs.open("owner/space-a");

    assert.equal(tabs.liveKeys().length, 2, "both spaces must hold a live tab at once");
  });

  assert.equal(
    calls.length,
    2,
    "two spaces opened through the real chain must reach the editor as two separate webview panels — one collapsing into the other is the defect this criterion names",
  );
  assert.deepEqual(
    calls.map((c) => c.title),
    ["Space A", "Space B"],
    "each editor tab must be titled with its own space's display name, so the human can tell the two apart",
  );
  assert.notEqual(panels[0], panels[1], "each space must own a distinct panel through the register");
  for (const call of calls)
    assert.equal(
      call.showOptions.viewColumn,
      ACTIVE,
      `tab "${call.title}" must open in the active column; a fixed column stacks both spaces in one slot`,
    );
});

test("the real vscode panel host pins no fixed view column, so a second space opens beside the first instead of replacing it", () => {
  const calls: Recorded[] = [];
  withStubVscode(calls, () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { makeVscodePanelHost } = require("../extension") as typeof import("../extension");
    const host = makeVscodePanelHost({ fsPath: "/ext" } as never);
    host.createPanel("Space A");
    host.createPanel("Space B");
  });

  // Without this the loop below passes vacuously on an empty recording,
  // reporting green over a host that was never reached.
  assert.equal(calls.length, 2, "both createPanel asks must reach the editor as recorded webview panels");

  for (const call of calls) {
    assert.notEqual(
      call.showOptions.viewColumn,
      ONE,
      `panel "${call.title}" must not be pinned to view column one — a fixed column puts every space's tab in the same slot, so opening the second replaces the first`,
    );
    assert.equal(
      call.showOptions.viewColumn,
      ACTIVE,
      `panel "${call.title}" must open in the active column, so it joins the group the human is looking at`,
    );
  }
});
