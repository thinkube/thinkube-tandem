/**
 * Merge a Spec's single PR at acceptance (TEP-0010).
 *
 * A Spec runs on one branch `spec/SP-<id>` and produces exactly one PR; when the
 * human accepts the Spec (gate green + `accept_spec` stamp), that one PR merges
 * and the Spec is done. The merge keeps the slice commits — each slice is a
 * commit on the branch, and that per-slice trail is the board's history (we use
 * `--merge`, not `--squash`), and deletes the branch so the Space's branch list
 * stays one-branch-per-active-Spec.
 *
 * Unlike `sliceProvenance` (deliberately best-effort), the merge is the point of
 * the accept action — a failure must be surfaced, so this throws on error with
 * the `gh` stderr for the caller to show.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Branch convention for a Spec (TEP-0010): one branch per Spec. */
export function specBranch(spec: string): string {
  return `spec/SP-${spec}`;
}

export interface SpecMergeResult {
  branch: string;
  /** Trimmed `gh` stdout (the merge confirmation), for the success toast. */
  output: string;
}

/**
 * `gh pr merge <branch> --merge --delete-branch` for the Spec's branch, run in
 * `cwd`. Throws (with `gh`'s stderr) when there's no PR for the branch, `gh` is
 * missing/unauthenticated, or the merge is rejected.
 */
export async function mergeSpecPr(
  spec: string,
  cwd: string,
): Promise<SpecMergeResult> {
  const branch = specBranch(spec);
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "merge", branch, "--merge", "--delete-branch"],
      { cwd, timeout: 60000 },
    );
    return { branch, output: stdout.trim() };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    throw new Error(`gh pr merge ${branch} failed: ${detail}`);
  }
}
