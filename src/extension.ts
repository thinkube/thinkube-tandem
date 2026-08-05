/**
 * Extension entry point. The core (src/core) is pure and host-free; VS Code
 * surfaces attach here as they are built, each registered through the
 * affordance registry so no capability exists without a human door.
 */
import type * as vscode from "vscode";

export function activate(_context: vscode.ExtensionContext): void {
  // No surfaces yet — build order step 1 is the pure core.
}

export function deactivate(): void {}
