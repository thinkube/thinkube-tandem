/**
 * Merge a Spec's PR at acceptance (TEP-0010), tolerant of straight-to-main Specs
 * (TEP-tg8dsa).
 *
 * A Spec normally runs on one branch `spec/SP-<id>` and produces exactly one PR;
 * when the human accepts the Spec (gate green + `accept_spec` stamp), that one PR
 * merges and the Spec is done. The merge keeps the slice commits — each slice is
 * a commit on the branch, and that per-slice trail is the board's history (we use
 * `--merge`, not `--squash`), and deletes the branch so the Space's branch list
 * stays one-branch-per-active-Spec.
 *
 * But the PR-ceremony rule lets docs / TEPs / board moves / trivial fixes go
 * straight to `main`. Those Specs have no branch/PR, so acceptance must NOT depend
 * on a PR existing (TEP-tg8dsa): we probe for an open PR first and, when there is
 * none, report it as a benign no-op instead of failing. A *real* failure (gh
 * missing/unauthenticated, or a PR that exists but won't merge) still throws with
 * the `gh` detail for the caller to surface — decoupling from PRs must not quietly
 * skip a merge that was actually needed.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Branch convention for a Spec (TEP-0010): one branch per Spec. */
export function specBranch(spec: string): string {
  return `spec/SP-${spec}`;
}

export type SpecMergeResult =
  | {
      branch: string;
      merged: true;
      /** Trimmed `gh` stdout (the merge confirmation), for the success toast. */
      output: string;
    }
  | { branch: string; merged: false; reason: "no-pr" };

/**
 * The `gh` interactions `mergeSpecPr` needs, injectable so the merged / no-PR /
 * real-failure classification is unit-testable without `gh` or the network.
 */
export interface PrOps {
  /** Number of open PRs whose head is `branch`. Throws if `gh` is missing/unauth. */
  openPrCount(branch: string, cwd: string): Promise<number>;
  /** Merge the branch's PR and delete the branch; returns stdout, throws on failure. */
  merge(branch: string, cwd: string): Promise<string>;
}

const ghOps: PrOps = {
  async openPrCount(branch, cwd) {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
      { cwd, timeout: 60000 },
    );
    const parsed = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  },
  async merge(branch, cwd) {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "merge", branch, "--merge", "--delete-branch"],
      { cwd, timeout: 60000 },
    );
    return stdout.trim();
  },
};

/**
 * Resolve the Spec's branch at acceptance:
 *   - no open PR → `{ merged: false, reason: "no-pr" }` (caller stamps anyway).
 *   - an open PR → merge it + delete the branch → `{ merged: true, output }`.
 * Throws (with the `gh` detail) on a real failure: `gh` missing/unauthenticated
 * on the probe, or a PR that exists but won't merge.
 */
export async function mergeSpecPr(
  spec: string,
  cwd: string,
  ops: PrOps = ghOps,
): Promise<SpecMergeResult> {
  const branch = specBranch(spec);

  let count: number;
  try {
    count = await ops.openPrCount(branch, cwd);
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    throw new Error(`gh pr list ${branch} failed: ${detail}`);
  }

  if (count === 0) {
    return { branch, merged: false, reason: "no-pr" };
  }

  try {
    const output = await ops.merge(branch, cwd);
    return { branch, merged: true, output };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "unknown error").trim();
    throw new Error(`gh pr merge ${branch} failed: ${detail}`);
  }
}
