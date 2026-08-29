/**
 * Giving a runner what a ready tree has.
 *
 * A verify runner is a snapshot of the same branch with nothing installed
 * in it. What the install produced in the run's own tree is linked into
 * each runner, so one install serves the whole run instead of one per
 * check — and only what the install produced: build output is the work
 * being judged, and lending it once had a run compiling through the link
 * into the tree it came from.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Make a runner share the worktree's provisioning: each produced entry is
 *  linked in where the runner lacks it. Idempotent; a snapshot reset keeps
 *  ignored entries, so links survive it. */
export async function linkProvisioned(
  runnerDir: string,
  worktree: string,
  provisioned: readonly string[],
): Promise<void> {
  for (const rel of provisioned) {
    const dst = path.join(runnerDir, rel);
    try {
      await fs.lstat(dst);
      continue;
    } catch {
      /* absent — link it */
    }
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.symlink(path.join(worktree, rel), dst).catch(() => {});
  }
}
