/**
 * Worktree commands — "Start Spec in Worktree" (SP-5).
 *
 * The thinking space's "New Spec" action (commands/thinkingSpaces.ts) opens a session rooted in
 * the repo with `/spec-prepare N` prefilled. This is its sibling for *working*
 * an already-numbered Spec: create the Spec's git worktree and open a session
 * rooted there from the board, so parallel Specs never share a tree.
 */
import * as vscode from "vscode";

import { LauncherService } from "../services/LauncherService";
import { WorktreeService } from "../services/WorktreeService";
import type { SpecNode } from "../views/thinkingSpaces/SpecsProvider";

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
        // Cut the worktree from the Thinking Space's CODE repo (SP-9). Under
        // central thinkingSpaces the spec file lives in the sidecar, so node.file's dir
        // is the thinking space repo, not the code repo — use node.repoPath. canonicalRepo
        // resolves main even if repoPath is itself a linked worktree.
        try {
          const canonical =
            (await worktrees.canonicalRepo(node.repoPath)) ?? node.repoPath;
          const baseDir =
            vscode.workspace
              .getConfiguration("thinkube")
              .get<string>("worktree.baseDir")
              ?.trim() || undefined;
          // Thinking Space-connect the new worktree: pass the configured thinking space
          // root so its .mcp.json kanban server points at the central sidecar.
          const thinkingSpaceRoot =
            vscode.workspace
              .getConfiguration("thinkube.thinkingSpace")
              .get<string>("root")
              ?.trim() || undefined;
          const worktreePath = await worktrees.create(
            canonical,
            n,
            baseDir,
            thinkingSpaceRoot,
          );
          // Open a plain session rooted in the worktree; advancing the Spec's
          // slices is thinking space-driven (the Orchestrate command), not a chat skill.
          await deps.launcher.openHere(vscode.Uri.file(worktreePath));
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
        const ok = await vscode.window.showWarningMessage(
          `Retire the SP-${n} worktree? This removes the worktree directory only — the branch and its commits are kept, and it refuses if there's uncommitted or unmerged work.`,
          { modal: true },
          "Retire",
        );
        if (ok !== "Retire") return;
        try {
          const canonical =
            (await worktrees.canonicalRepo(node.repoPath)) ?? node.repoPath;
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
