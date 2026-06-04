/**
 * Capture a slice's delivery provenance — the commit it was built on and the
 * pull request carrying it — at the moment it enters Done.
 *
 * Both Done seams (the MCP `move_slice` Done branch and the panel's
 * drag-to-Done write-through) funnel through `stampOnEnteringDone` so the two
 * paths can never disagree on what gets recorded.
 *
 * Everything here is **best-effort**: a missing `git`/`gh`, a detached repo, a
 * branch with no PR — none of these may fail or delay the Done move. Every
 * failure resolves to "nothing captured" and the move proceeds. We record
 * whatever exists at the instant of the move: the branch HEAD commit and the
 * *open* PR — not the eventual squash-merge SHA, which doesn't exist yet.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import type { Frontmatter } from "../store/frontmatter";

const execFileAsync = promisify(execFile);

/** What we managed to read off the repo at Done time. Fields omitted when absent. */
export interface SliceProvenance {
  /** Full 40-char commit SHA of the branch HEAD. */
  commit?: string;
  /** Pull-request URL for the current branch, when one is open. */
  pr?: string;
}

/** Read the branch HEAD commit + open PR for `cwd`. Never throws. */
export async function captureSliceProvenance(
  cwd: string,
): Promise<SliceProvenance> {
  const [commit, pr] = await Promise.all([readHeadCommit(cwd), readPrUrl(cwd)]);
  const result: SliceProvenance = {};
  if (commit) result.commit = commit;
  if (pr) result.pr = pr;
  return result;
}

/**
 * Stamp captured provenance onto a slice's frontmatter just before it's
 * written to Done. Mutates `fm` in place. Best-effort: on any capture failure
 * `fm` is left untouched and the move continues.
 */
export async function stampOnEnteringDone(
  fm: Frontmatter,
  cwd: string,
): Promise<void> {
  const { commit, pr } = await captureSliceProvenance(cwd);
  if (commit) fm.commit = commit;
  if (pr) fm.pr = pr;
}

/** `git rev-parse HEAD` → full SHA, or undefined (not a repo / git missing / detached). */
async function readHeadCommit(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "HEAD"],
      { timeout: 5000 },
    );
    const sha = stdout.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `gh pr view --json url --jq .url` for the current branch → PR URL, or
 * undefined (no `gh`, not authenticated, or no PR open for the branch — `gh`
 * exits non-zero in that last case, which we treat as "no PR").
 */
async function readPrUrl(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "url", "--jq", ".url"],
      { cwd, timeout: 5000 },
    );
    const url = stdout.trim();
    return url.startsWith("http") ? url : undefined;
  } catch {
    return undefined;
  }
}
