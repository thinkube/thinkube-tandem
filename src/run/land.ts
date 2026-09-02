/**
 * Accept is the one act that lands work.
 *
 * A delivery is a local branch until a person accepts it. Nothing is
 * pushed before that: not by a worker, not by the gate, not by the
 * hand-over. Accepting merges the branch into the checkout's own branch,
 * pushes that, and lets the branch go. There is no pull request, because
 * a second approval on the forge would be the same decision asked twice.
 *
 * The person's checkout is theirs: a merge over uncommitted changes is
 * refused before anything moves, and a merge that conflicts is undone and
 * refused with the files named, so the checkout is left as it was found.
 */
export type GitExec = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;

export async function landDelivery(a: {
  repoRoot: string;
  branch: string;
  tep: string;
  exec: GitExec;
}): Promise<{ merged: true; head: string }> {
  const git = (...args: string[]) => a.exec("git", ["-C", a.repoRoot, ...args], a.repoRoot);
  const dirty = (await git("status", "--porcelain")).out.trim();
  if (dirty)
    throw new Error(
      `your checkout has uncommitted changes — commit or stash them, then accept:\n${dirty.split("\n").slice(0, 8).join("\n")}`,
    );
  const has = await git("rev-parse", "--verify", "--quiet", a.branch);
  if (has.code !== 0) throw new Error(`the branch ${a.branch} is not here — the work it held is gone`);
  const merge = await git("merge", "--no-ff", "--no-edit", "-m", `tandem: accept ${a.tep}`, a.branch);
  if (merge.code !== 0) {
    const conflicted = (await git("diff", "--name-only", "--diff-filter=U")).out.trim();
    await git("merge", "--abort");
    throw new Error(
      conflicted
        ? `the merge conflicts with what is on your branch in: ${conflicted.split("\n").join(", ")} — nothing was changed; run it again on today's base`
        : `the merge did not go through: ${merge.out.trim().split("\n").pop() ?? ""}`,
    );
  }
  const head = (await git("rev-parse", "HEAD")).out.trim();
  const pushed = await git("push", "origin", "HEAD");
  if (pushed.code !== 0)
    throw new Error(
      `merged here, but the push was refused: ${pushed.out.trim().split("\n").pop() ?? ""} — push it yourself when the remote is reachable`,
    );
  await git("branch", "-d", a.branch);
  return { merged: true, head };
}

/**
 * A worker's tree cannot push.
 *
 * Git worktrees share the repository's remotes, so the remote is not
 * removed; the worktree's own push address for it is set to a name that is
 * not a repository. A push from inside fails at once in git's own words,
 * before any credential is looked for; fetching and reading still work,
 * and the checkout the person uses is untouched. A worker that finds no
 * way to push spends nothing trying.
 */
export async function sealWorktree(repoRoot: string, worktree: string, exec: GitExec): Promise<void> {
  await exec("git", ["-C", repoRoot, "config", "extensions.worktreeConfig", "true"], repoRoot);
  await exec("git", ["-C", worktree, "config", "--worktree", "remote.origin.pushurl", "no-push"], worktree);
}
