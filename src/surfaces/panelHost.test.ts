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

/** Install a stub `vscode` for the duration of one call, then restore. */
function withStubVscode<T>(calls: Recorded[], run: () => T): T {
  const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
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
        calls.push({ viewType, title, showOptions });
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

test("the real vscode panel host pins no fixed view column, so a second space opens beside the first instead of replacing it", () => {
  const calls: Recorded[] = [];
  withStubVscode(calls, () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { makeVscodePanelHost } = require("../extension") as typeof import("../extension");
    const host = makeVscodePanelHost({ fsPath: "/ext" } as never);
    host.createPanel("Space A");
    host.createPanel("Space B");
  });

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
