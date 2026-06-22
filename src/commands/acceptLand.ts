/**
 * The cleanup half of accept-land (TEP-tgqa78), shared by both accept entry
 * points — `thinkube.accept` (the delivery-report surface, `orchestrate.ts`) and
 * `onAcceptSpec` (the kanban panel button, `boards.ts`). The merge half lives in
 * `github/specMerge.ts`; this retires the Spec's worktree afterwards.
 */
import * as vscode from "vscode";

import { WorktreeService } from "../services/WorktreeService";

/**
 * Retire the Spec's worktree after its merge succeeded and return a short note for
 * the accept toast. **Best-effort**: a retire failure is reported in the note, never
 * thrown — the Spec is already merged and stamped, so cleanup must not turn a
 * successful accept into an error. Defers (leaves the worktree) when the accept
 * fires from inside the very worktree being retired, so it never deletes the
 * session's own cwd.
 */
export async function retireWorktreeNote(
  worktrees: WorktreeService,
  repoPath: string,
  specId: string,
): Promise<string> {
  try {
    const canonical = (await worktrees.canonicalRepo(repoPath)) ?? repoPath;
    const here = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const outcome = await worktrees.retireAfterAccept(canonical, specId, here);
    return outcome === "retired"
      ? " Worktree retired."
      : outcome === "deferred"
        ? " (Worktree left in place — you're working in it; retire it later.)"
        : "";
  } catch (e) {
    return ` (Worktree retire failed: ${(e as Error).message})`;
  }
}
