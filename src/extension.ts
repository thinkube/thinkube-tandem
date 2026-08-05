/**
 * Extension entry point. One command opens the space panel; the session
 * owns the space; every webview action is a registered affordance.
 */
import * as vscode from "vscode";
import * as path from "node:path";
import { TandemSession } from "./surfaces/session";
import { SpacePanel } from "./surfaces/panel";

let session: TandemSession | undefined;
let panel: SpacePanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("thinkube-tandem.openSpace", async () => {
      const config = vscode.workspace.getConfiguration("thinkubeTandem");
      const storeRoot = config.get<string>(
        "storeRoot",
        path.join(process.env.HOME ?? "~", "thinkube-tandem-store"),
      );
      const folder = vscode.workspace.workspaceFolders?.[0];
      const repoRoot = folder?.uri.fsPath ?? process.cwd();
      const spaceName = folder?.name ?? "default";
      if (!session)
        session = new TandemSession({
          round: {
            model: config.get<string>("groundingModel", "opus"),
            repoRoot,
          },
          storeDir: path.join(storeRoot, "spaces", spaceName),
          now: () => new Date().toISOString(),
        });
      if (!panel) panel = new SpacePanel();
      await panel.show(context.extensionUri, session);
    }),
  );
}

export function deactivate(): void {
  panel?.dispose();
}
