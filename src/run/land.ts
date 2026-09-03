/**
 * Accept is the one act that lands work.
 *
 * A delivery is a local branch until a person accepts it. Nothing is
 * pushed before that: not by a worker, not by the gate, not by the
 * hand-over. Accepting merges the branch into the checkout's own branch,
 * pushes that, and lets the branch go. There is no pull request, because
 * a second approval on the forge would be the same decision asked twice.
 *
 * The branch is kept, not deleted: what a merge puts into the project can
 * still turn out wrong, and the work has to be somewhere to run again from.
 * It goes when the platform says the merged tree built and deployed.
 *
 * The person's checkout is theirs. Git decides whether the merge can be
 * made over what is there: an unrelated local change or an untracked file
 * is no obstacle, a local change to a file the branch also changes is
 * refused in git's own words, and a merge that conflicts is undone, so the
 * checkout is left as it was found.
 */
export type GitExec = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;

export async function landDelivery(a: {
  repoRoot: string;
  branch: string;
  tep: string;
  exec: GitExec;
}): Promise<{ merged: true; head: string }> {
  const git = (...args: string[]) => a.exec("git", ["-C", a.repoRoot, ...args], a.repoRoot);
  const has = await git("rev-parse", "--verify", "--quiet", a.branch);
  if (has.code !== 0) throw new Error(`the branch ${a.branch} is not here — the work it held is gone`);
  // The remote moves on its own: the platform's pipeline commits to main
  // after every build. What is there is brought in first, so the push
  // that follows is a plain one; and a landing refused at the push last
  // time, with the merge already made here, carries on from where it was.
  await git("fetch", "--quiet", "origin");
  const remote = (await git("rev-parse", "--verify", "--quiet", "origin/main")).out.trim();
  if (remote) {
    const behind = (await git("merge-base", "--is-ancestor", "origin/main", "HEAD")).code !== 0;
    if (behind) {
      const up = await git("merge", "--no-edit", "origin/main");
      if (up.code !== 0) {
        await git("merge", "--abort");
        throw new Error(`main has moved on the remote in ways that conflict with what is here: ${up.out.trim().split("\n").pop() ?? ""}`);
      }
    }
  }
  const already = (await git("merge-base", "--is-ancestor", a.branch, "HEAD")).code === 0;
  const merge = already ? { code: 0, out: "" } : await git("merge", "--no-ff", "--no-edit", "-m", `tandem: accept ${a.tep}`, a.branch);
  if (merge.code !== 0) {
    const conflicted = (await git("diff", "--name-only", "--diff-filter=U")).out.trim();
    await git("merge", "--abort");
    const said = merge.out.trim().split("\n").filter((l) => l.trim());
    const overwritten = said.some((l) => /would be overwritten by merge/.test(l))
      ? said.filter((l) => /^\s+\S/.test(l) && !/^\s*(Please|Aborting|error|fatal)/.test(l)).map((l) => l.trim())
      : [];
    throw new Error(
      conflicted
        ? `the merge conflicts with what is on your branch in: ${conflicted.split("\n").join(", ")} — nothing was changed; run it again on today's base`
        : overwritten.length
          ? `your checkout has uncommitted changes in files this delivery also changes: ${overwritten.join(", ")} — commit or stash them, then accept`
          : `the merge did not go through: ${said.pop() ?? ""}`,
    );
  }
  const head = (await git("rev-parse", "HEAD")).out.trim();
  const pushed = await git("push", "origin", "HEAD");
  if (pushed.code !== 0)
    throw new Error(
      `merged here, but the push was refused: ${pushed.out.trim().split("\n").pop() ?? ""} — push it yourself when the remote is reachable`,
    );
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
