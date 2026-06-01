/**
 * Active-project context tracking.
 *
 * In a multi-root workspace the extension supports any directory as a Claude
 * project, but at any given moment one project is "active" — that's the one
 * the ChatPanel targets and the status bar names. This module owns:
 *   - the active-project state and the status-bar item that mirrors it
 *   - the wiring to services that depend on the active project (configService,
 *     chatPanel, treeProvider)
 *   - the helpers that resolve "what project is the user currently in?" from
 *     the active editor or workspace folders
 *
 * Extracted from src/extension.ts in chunk 1 (no behavior change).
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import type { ClaudeConfigService } from "../services/ClaudeConfigService";
import type { ConfigTreeProvider } from "../views/sidebar/ConfigTreeProvider";

export interface ActiveContextDeps {
  configService: ClaudeConfigService;
  treeProvider: ConfigTreeProvider;
  statusBarItem: vscode.StatusBarItem;
}

let deps: ActiveContextDeps | undefined;
let currentActiveContext: string | undefined;

export function initActiveContext(d: ActiveContextDeps): void {
  deps = d;
}

export function getCurrentActiveContext(): string | undefined {
  return currentActiveContext;
}

/**
 * Resolve the project path the user is currently focused on, based on the
 * active editor first and the workspace folders second.
 */
export function getActiveProjectPath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const filePath = editor.document.uri.fsPath;
    const projectRoot = findProjectRoot(filePath);
    if (projectRoot) {
      return projectRoot;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      editor.document.uri,
    );
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }

  return undefined;
}

/**
 * Walk upward from startPath looking for common project-root markers,
 * stopping at workspace-folder boundaries.
 */
export function findProjectRoot(startPath: string): string | undefined {
  let current = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspacePaths = workspaceFolders?.map((f) => f.uri.fsPath) || [];

  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, "pyproject.toml")) ||
      fs.existsSync(path.join(current, "Cargo.toml")) ||
      fs.existsSync(path.join(current, "go.mod"))
    ) {
      return current;
    }

    if (workspacePaths.includes(current)) {
      return current;
    }

    current = path.dirname(current);
  }

  return undefined;
}

/**
 * Update the active-project context. In multi-root mode this only affects
 * the ChatPanel target and the status bar — the tree always shows all projects.
 */
export async function updateActiveContext(newPath?: string): Promise<void> {
  const activePath = newPath || getActiveProjectPath();

  if (activePath === currentActiveContext) {
    return;
  }

  currentActiveContext = activePath;

  if (activePath && deps) {
    deps.configService.setActiveProject(activePath);

    await updateConfigContext();

    const contextName = path.basename(activePath);
    deps.statusBarItem.text = `$(folder) ${contextName}`;
    deps.statusBarItem.tooltip = `Active project: ${activePath}`;
    deps.statusBarItem.show();

    vscode.commands.executeCommand(
      "setContext",
      "thinkube.activeContext",
      contextName,
    );
  }
}

/**
 * Push the `thinkube.hasClaudeConfig` context variable so menu/when clauses
 * can hide/show entries based on whether the active project has .claude/.
 */
export async function updateConfigContext(): Promise<void> {
  if (deps) {
    const hasConfig = await deps.configService.hasClaudeConfig();
    await vscode.commands.executeCommand(
      "setContext",
      "thinkube.hasClaudeConfig",
      hasConfig,
    );
  } else {
    await vscode.commands.executeCommand(
      "setContext",
      "thinkube.hasClaudeConfig",
      false,
    );
  }
}
