/**
 * TRANSITION — proves the missing-build message becomes copy-pasteable:
 * when show() runs against an extension folder with no built surface, the
 * webview html must contain the literal build command to run (e.g. "npm
 * run build"), so a person can fix the missing build without guessing the
 * command from prose.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SpacePanel } from "../surfaces/panel";
import { TandemSession } from "../surfaces/session";
import { emptySpace } from "../core/schema";

function throwawaySession(): TandemSession {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac7-session-"));
  const session = new TandemSession({
    round: { model: "sonnet", repoRoot: dir },
    storeDir: dir,
    storageDir: path.join(dir, ".local"),
    now: () => new Date().toISOString(),
  } as never);
  session.space = emptySpace();
  return session;
}

function fakeWebviewPanel(): {
  webview: {
    html: string;
    postMessage(message: unknown): void;
    onDidReceiveMessage(listener: (e: unknown) => unknown): { dispose(): void };
    asWebviewUri(uri: unknown): unknown;
    cspSource: string;
  };
  reveal(): void;
  onDidDispose(listener: () => unknown): { dispose(): void };
  dispose(): void;
} {
  return {
    webview: {
      html: "",
      postMessage: () => {},
      onDidReceiveMessage: () => ({ dispose() {} }),
      asWebviewUri: (uri: unknown) => uri,
      cspSource: "vscode-webview:",
    },
    reveal: () => {},
    onDidDispose: () => ({ dispose() {} }),
    dispose: () => {},
  };
}

test("show() against an extension folder with no built surface names the build command to run", async () => {
  const session = throwawaySession();
  const fakePanel = fakeWebviewPanel();
  // An extension root with nothing under media/map — the built surface is
  // missing, which is the case this message exists for.
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac7-ext-"));
  const panel = new SpacePanel({
    key: "repo1/space1",
    title: "Space one",
    getSession: () => session,
    host: { createPanel: () => fakePanel as never },
  });

  await panel.show({ fsPath: extensionRoot } as never);

  assert.ok(
    fakePanel.webview.html.includes("npm run build"),
    "the html carries the literal command a person can copy-paste to fix the missing build",
  );
});
