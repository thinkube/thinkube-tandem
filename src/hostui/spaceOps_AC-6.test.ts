/**
 * INVARIANT — a panel that has just opened is sent the space's whole state
 * right away: show() must post exactly one message of kind "space" to the
 * webview, so the surface has the full state before it ever asks for it.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac6-session-"));
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
  posted: unknown[];
} {
  const posted: unknown[] = [];
  return {
    posted,
    webview: {
      html: "",
      postMessage: (message: unknown) => {
        posted.push(message);
      },
      onDidReceiveMessage: () => ({ dispose() {} }),
      asWebviewUri: (uri: unknown) => uri,
      cspSource: "vscode-webview:",
    },
    reveal: () => {},
    onDidDispose: () => ({ dispose() {} }),
    dispose: () => {},
  };
}

test('after show() runs against a fake panel host, exactly one "space" message is posted', async () => {
  const session = throwawaySession();
  const fakePanel = fakeWebviewPanel();
  const extensionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "spaceops-ac6-ext-"));
  const panel = new SpacePanel({
    key: "repo1/space1",
    title: "Space one",
    getSession: () => session,
    host: { createPanel: () => fakePanel as never },
  });

  await panel.show({ fsPath: extensionRoot } as never);

  const spaceMessages = fakePanel.posted.filter(
    (m) => typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === "space",
  );
  assert.equal(spaceMessages.length, 1, 'exactly one message with kind "space" is posted on first show()');
});
