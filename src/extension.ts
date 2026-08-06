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
import { StoreSyncService } from "./engine/StoreSyncService";

let session: TandemSession | undefined;
let panel: SpacePanel | undefined;
let sideView: SpaceViewProvider | undefined;
let storeSync: StoreSyncService | undefined;

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

/** Retire a merged TEP's worktrees (code, tester snapshot, oracle runners) —
 *  best-effort: a missing tree is a no-op, the accept never fails on cleanup. */
async function retireTepWorktrees(repoRoot: string, tepId: string): Promise<void> {
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve) =>
      execFile("git", ["-C", repoRoot, ...args], { encoding: "utf8" }, (_e, out) =>
        resolve(out ?? ""),
      ),
    );
  const wtRoot = path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-worktrees`,
  );
  const listed = await run(["worktree", "list", "--porcelain"]);
  const targets = listed
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter(
      (p) =>
        p === path.join(wtRoot, tepId) ||
        p === path.join(wtRoot, `${tepId}-tester`) ||
        p.startsWith(path.join(wtRoot, "oracle-runners", `${tepId}-`)),
    );
  for (const t of targets) await run(["worktree", "remove", "--force", t]);
  await run(["worktree", "prune"]);
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
    retire: (tepId) => retireTepWorktrees(repoRoot, tepId),
    workerModel: {
      workerModel: config.get<string>("workerModel", "sonnet"),
      workerModelByRole: config.get<Record<string, string>>("workerModelByRole", {}),
    },
    maxConcurrent: config.get<number>("maxConcurrent", 4),
    docsGateMode: config.get<"blocking" | "advisory">("docsGateMode", "blocking"),
    onChanged: (message) => {
      if (!session) return;
      panel?.pushFrom(session, message);
      sideView?.pushFrom(session, message);
    },
  });
  if (!storeSync) {
    storeSync = new StoreSyncService(storeRoot, (l) => console.log(l));
    storeSync.start();
  }
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
  storeSync?.dispose();
}
