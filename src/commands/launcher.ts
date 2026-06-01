/**
 * Launcher command registration.
 *
 * The terminal-based launcher and the per-project `.thinkube/claude-config`
 * `add-dir:` reference-directory flow were removed in chunk 2; everything now
 * goes through `LauncherService`, which patches cwd via the bundled wrapper.
 */
import * as vscode from "vscode";

import { LauncherService } from "../services/LauncherService";

export function registerLauncherCommands(
  context: vscode.ExtensionContext,
  launcher: LauncherService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube-ai.claude.openHere",
      (uri?: vscode.Uri) => launcher.openHere(uri),
    ),
  );
}
