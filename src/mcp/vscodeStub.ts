/**
 * Minimal `vscode` module stub for the stdio MCP subprocess.
 *
 * The subprocess imports services (`AuthService`, `ThinkubeStore`, etc.)
 * that pull `vscode` at module load. The `vscode` module doesn't exist as
 * an npm package — VS Code injects it into the extension host at runtime.
 * From a plain Node subprocess, `require('vscode')` fails.
 *
 * We work around it with a `Module._resolveFilename` hook (see
 * `installVscodeStub.ts`) that redirects `require('vscode')` to this stub.
 * The stub provides only the surface the subprocess actually exercises:
 *
 *   - `EventEmitter<T>` so `ThinkubeStore` can construct `_onChanged`.
 *   - `workspace.getConfiguration(...)` routed to THINKUBE_* env vars so
 *     `TasksMaterializer.materialize` reads the same settings the host has.
 *   - `workspace.createFileSystemWatcher(...)` returns a no-op watcher —
 *     the subprocess never calls `ThinkubeStore.activate()`.
 *   - `window.showXMessage / showInputBox` are no-ops — the subprocess has
 *     no UI surface and `AuthService` only hits these when env auth fails.
 *
 * Everything else (Uri, TreeItem, WebviewPanel, …) is intentionally
 * undefined. If the subprocess ever reaches code that touches them, the
 * crash points at the surface we forgot to stub.
 */

class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  fire(event: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch (err) {
        process.stderr.write(
          `[vscode-stub] listener threw: ${(err as Error).message}\n`,
        );
      }
    }
  }
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  dispose(): void {
    this.listeners = [];
  }
}

const SETTINGS_FROM_ENV: Record<string, () => unknown> = {
  "thinkube.kanban.repo": () => process.env.THINKUBE_REPO ?? "",
  "thinkube.kanban.projectNumber": () =>
    Number(process.env.THINKUBE_PROJECT_NUMBER ?? "0"),
  "thinkube.kanban.allowAIWrites": () =>
    (process.env.THINKUBE_ALLOW_AI_WRITES ?? "true") === "true",
};

const workspace = {
  workspaceFolders: process.env.THINKUBE_WORKSPACE
    ? [{ uri: { fsPath: process.env.THINKUBE_WORKSPACE } }]
    : undefined,
  getConfiguration(section?: string) {
    return {
      get<T>(key: string, fallback?: T): T {
        const fullKey = section ? `${section}.${key}` : key;
        const reader = SETTINGS_FROM_ENV[fullKey];
        if (reader) {
          const value = reader();
          return (value as T) ?? (fallback as T);
        }
        return fallback as T;
      },
    };
  },
  onDidChangeConfiguration(_listener: () => void) {
    return { dispose: () => {} };
  },
  onDidChangeWorkspaceFolders(_listener: () => void) {
    return { dispose: () => {} };
  },
  createFileSystemWatcher(_pattern: unknown) {
    return {
      onDidCreate(_l: () => void) {
        return { dispose: () => {} };
      },
      onDidChange(_l: () => void) {
        return { dispose: () => {} };
      },
      onDidDelete(_l: () => void) {
        return { dispose: () => {} };
      },
      dispose() {},
    };
  },
};

const window = {
  showInputBox: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  createOutputChannel(name: string) {
    return {
      appendLine: (s: string) => process.stderr.write(`[${name}] ${s}\n`),
      append: (s: string) => process.stderr.write(s),
      clear: () => {},
      show: () => {},
      hide: () => {},
      dispose: () => {},
    };
  },
};

const commands = {
  executeCommand: async () => undefined,
  registerCommand: () => ({ dispose: () => {} }),
};

class RelativePattern {
  constructor(
    public readonly base: unknown,
    public readonly pattern: string,
  ) {}
}

class Uri {
  static file(p: string) {
    return { fsPath: p, scheme: "file", toString: () => `file://${p}` };
  }
  static parse(s: string) {
    return { fsPath: s, scheme: "file", toString: () => s };
  }
  static joinPath(uri: { fsPath: string }, ...segments: string[]) {
    const path = require("node:path");
    return Uri.file(path.join(uri.fsPath, ...segments));
  }
}

module.exports = {
  EventEmitter,
  RelativePattern,
  Uri,
  workspace,
  window,
  commands,
  env: { openExternal: async () => undefined },
};
