// A stand-in for the editor host, installed into the CommonJS module cache
// before a module that lazily `require("vscode")` is loaded.
//
// The modules under check reach the host only through a `vs()` accessor that
// calls `require("vscode")` at use time — a seam this repository defines and
// owns. Filling that seam lets a check EXECUTE the module's own logic rather
// than read its source text. Only the handful of members these modules touch
// are provided; anything else is deliberately absent so a check cannot drift
// into simulating an editor.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (fn) => {
      this.listeners.push(fn);
      return { dispose: () => {} };
    };
  }
  fire(value) {
    for (const fn of this.listeners) fn(value);
  }
  dispose() {}
}

class Disposable {
  constructor(fn) {
    this.dispose = fn ?? (() => {});
  }
  static from(...items) {
    return new Disposable(() => {
      for (const i of items) i?.dispose?.();
    });
  }
}

const disposable = { dispose() {} };

export const vscodeStub = {
  TreeItem,
  ThemeIcon,
  ThemeColor,
  EventEmitter,
  Disposable,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  Uri: {
    file: (p) => ({ fsPath: p, path: p, scheme: "file" }),
    parse: (p) => ({ fsPath: String(p), path: String(p), scheme: "file" }),
    joinPath: (base, ...parts) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
      path: [base.fsPath, ...parts].join("/"),
      scheme: "file",
    }),
  },
  workspace: {
    workspaceFolders: [],
    asRelativePath: (p) => String(p),
    getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
    onDidChangeConfiguration: () => disposable,
    openTextDocument: async () => ({}),
    fs: { readFile: async () => new Uint8Array(), writeFile: async () => {} },
  },
  window: {
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showTextDocument: async () => ({}),
    withProgress: async (_o, run) => run({ report() {} }, { onCancellationRequested: () => disposable }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {}, text: "", tooltip: "", command: "" }),
    createTreeView: () => ({ dispose() {}, onDidChangeVisibility: () => disposable }),
    createWebviewPanel: () => ({
      webview: { html: "", onDidReceiveMessage: () => disposable, postMessage: async () => true, asWebviewUri: (u) => u, cspSource: "" },
      onDidDispose: () => disposable,
      reveal() {},
      dispose() {},
    }),
    onDidChangeActiveTextEditor: () => disposable,
    registerWebviewPanelSerializer: () => disposable,
    activeTextEditor: undefined,
  },
  commands: {
    executeCommand: async () => undefined,
    registerCommand: () => disposable,
    getCommands: async () => [],
  },
  env: { openExternal: async () => true, clipboard: { writeText: async () => {} } },
  extensions: { getExtension: () => undefined, all: [] },
};

/** Installs the stand-in so `require("vscode")` resolves to it. */
export function installVscodeStub(stub = vscodeStub) {
  require.cache["vscode"] = { id: "vscode", filename: "vscode", loaded: true, exports: stub };
  const Module = require("node:module");
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === "vscode") return "vscode";
    return originalResolve.call(this, request, ...rest);
  };
  return stub;
}
