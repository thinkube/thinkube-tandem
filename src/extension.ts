/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space end to end — signing starts the run, accepting merges on
 * the project's forge — and every webview action is a registered
 * affordance.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { TandemSession } from "./surfaces/session";
import { SpacePanel, SpaceViewProvider } from "./surfaces/panel";
import { Forge, forgeFor } from "./dispatch/forge";

let session: TandemSession | undefined;
let panel: SpacePanel | undefined;
let sideView: SpaceViewProvider | undefined;

function gitAuthor(repoRoot: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "config", "user.name"],
      { encoding: "utf8" },
      (err, stdout) => resolve(err ? "user" : stdout.trim().replace(/\s+/g, "-").toLowerCase() || "user"),
    );
  });
}

function gitRemote(repoRoot: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoRoot, "remote", "get-url", "origin"],
      { encoding: "utf8" },
      (err, stdout) => resolve(err ? undefined : stdout.trim()),
    );
  });
}

async function resolveForge(
  repoRoot: string,
  giteaToken: string,
): Promise<Forge | undefined> {
  const remote = await gitRemote(repoRoot);
  if (!remote) return undefined;
  try {
    return forgeFor(remote, {
      giteaToken: giteaToken || undefined,
      http: async (method, url, token, payload) => {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `token ${token}`,
            "Content-Type": "application/json",
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
        if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
        return res.json();
      },
    });
  } catch {
    return undefined;
  }
}

async function ensureSession(
  context: vscode.ExtensionContext,
): Promise<TandemSession> {
  if (session) return session;
  const config = vscode.workspace.getConfiguration("thinkubeTandem");
  const storeRoot =
    config.get<string>("storeRoot", "") ||
    path.join(process.env.HOME ?? "~", "thinkube-tandem-store");
  const folder = vscode.workspace.workspaceFolders?.[0];
  const repoRoot = folder?.uri.fsPath ?? process.cwd();
  const spaceName = folder?.name ?? "default";
  const forge = await resolveForge(
    repoRoot,
    config.get<string>("giteaToken", ""),
  );
  session = new TandemSession({
    round: {
      model: config.get<string>("groundingModel", "opus"),
      repoRoot,
    },
    storeDir: path.join(storeRoot, "spaces", spaceName),
    storageDir: context.globalStorageUri.fsPath,
    now: () => new Date().toISOString(),
    author: await gitAuthor(repoRoot),
    forge,
    suiteCommand: config
      .get<string>("suiteCommand", "npm test")
      .split(" ")
      .filter(Boolean),
    onChanged: (message) => {
      if (!session) return;
      panel?.pushFrom(session, message);
      sideView?.pushFrom(session, message);
    },
  });
  return session;
}

export function activate(context: vscode.ExtensionContext): void {
  sideView = new SpaceViewProvider(context.extensionUri, () =>
    ensureSession(context),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("thinkubeTandemSpaceView", sideView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("thinkube-tandem.openSpace", async () => {
      const s = await ensureSession(context);
      if (!panel) panel = new SpacePanel();
      await panel.show(context.extensionUri, s);
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
}
