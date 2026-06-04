/**
 * Worktree commands — "Start Spec in Worktree" (SP-5).
 *
 * The board's "New Spec" action (commands/boards.ts) opens a session rooted in
 * the repo with `/spec-prepare N` prefilled. This is its sibling for *working*
 * an already-numbered Spec: create the Spec's git worktree and open a session
 * rooted there with `/pair-start N`, so parallel Specs never share a tree.
 */
import * as path from "node:path";
import * as vscode from "vscode";

import { LauncherService } from "../services/LauncherService";
import { WorktreeService } from "../services/WorktreeService";
import type { SpecNode } from "../views/boards/SpecsProvider";

export interface WorktreeDeps {
  launcher: LauncherService;
  /** Injectable for tests; defaults to a real `WorktreeService`. */
  worktrees?: WorktreeService;
}

export function registerWorktreeCommands(
  context: vscode.ExtensionContext,
  deps: WorktreeDeps,
): void {
  const worktrees = deps.worktrees ?? new WorktreeService();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "thinkube.specs.startWorktree",
      async (node?: SpecNode) => {
        if (!node || node.kind !== "spec") {
          vscode.window.showErrorMessage(
            "Start Spec: select a spec in the Specs view first.",
          );
          return;
        }
        const n = node.specNumber;
        // The spec file lives at <repo>/.thinkube/specs/SP-{n}/spec.md; resolve
        // the canonical repo from there so a worktree is always cut from main,
        // even if this checkout is itself a linked worktree.
        const specDir = path.dirname(node.file);
        try {
          const canonical = await worktrees.canonicalRepo(specDir);
          if (!canonical) {
            vscode.window.showErrorMessage(
              `Start Spec SP-${n}: ${specDir} is not inside a git repository.`,
            );
            return;
          }
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          const worktreePath = await worktrees.create(canonical, n, baseDir);
          await deps.launcher.openHere(
            vscode.Uri.file(worktreePath),
            `/pair-start ${n} `,
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Start Spec SP-${n} failed: ${(err as Error).message}`,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "thinkube.specs.retireWorktree",
      async (node?: SpecNode) => {
        if (!node || node.kind !== "spec") {
          vscode.window.showErrorMessage(
            "Retire Spec worktree: select a spec in the Specs view first.",
          );
          return;
        }
        const n = node.specNumber;
        const specDir = path.dirname(node.file);
        try {
          const canonical = await worktrees.canonicalRepo(specDir);
          if (!canonical) {
            vscode.window.showErrorMessage(
              `Retire SP-${n}: ${specDir} is not inside a git repository.`,
            );
            return;
          }
          const removed = await worktrees.remove(canonical, n);
          vscode.window.showInformationMessage(
            `Retired SP-${n} worktree (${removed}).`,
          );
        } catch (err) {
          // A guard refusal (dirty / unmerged) is an intentional stop, not a
          // crash — surface it as a warning, not an error.
          vscode.window.showWarningMessage((err as Error).message);
        }
      },
    ),
  );
}
