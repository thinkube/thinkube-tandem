/**
 * The hand-over is the one act that lands work.
 *
 * A delivery is a local branch until the run hands it over. The merge
 * happens then, and the push with it, so the platform can build what was
 * promised and the promises about a running product can be judged on the
 * running product. There is no pull request, because a second approval on
 * the forge would be the same decision asked twice.
 *
 * The branch goes with the merge: what it held is in the project now, and
 * a repair starts from the project, not from a branch of history.
 *
 * The person's checkout is theirs. Git decides whether the merge can be
 * made over what is there: an unrelated local change or an untracked file
 * is no obstacle, a local change to a file the branch also changes is
 * refused in git's own words, and a merge that conflicts is undone, so the
 * checkout is left as it was found.
 *
 * A merge that cannot be pushed is still a merge: the work is in the
 * project, and the caller is told the remote never saw it.
 */
export type GitExec = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; out: string }>;

export async function landDelivery(a: {
  repoRoot: string;
  branch: string;
  tep: string;
  exec: GitExec;
}): Promise<{ merged: true; head: string; pushed: boolean; why?: string; moved: boolean }> {
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
  // The project may already hold everything this branch has — a run of a
  // cut whose slices all stood, or a repair somebody pushed first. Then
  // the merge is a no-op and so is the push: saying "merged and pushed"
  // sends the run off to wait for a build that will never be triggered.
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
  const remoteHas = remote && (await git("merge-base", "--is-ancestor", "HEAD", "origin/main")).code === 0;
  const moved = !already || !remoteHas;
  const pushed = await git("push", "origin", "HEAD");
  if (pushed.code !== 0)
    return {
      merged: true,
      head,
      pushed: false,
      moved,
      why: `the push was refused: ${pushed.out.trim().split("\n").pop() ?? ""} — push it yourself when the remote is reachable`,
    };
  await git("branch", "-d", a.branch);
  return { merged: true, head, pushed: true, moved };
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

/**
 * Taking the work back out.
 *
 * The hand-over put the work in the project so the platform could build
 * it; the person's decision comes after, and one of the answers is no.
 * That answer is a revert of the one merge commit, pushed like any other
 * commit: the platform builds the project as it was, and the history says
 * what happened rather than pretending it never did.
 *
 * The work itself is not lost. It is in the merge that was reverted, and
 * a later run starts from what was learned by taking it back out.
 */
/**
 * What sits on main between a merge and the tip, and whether it is ours.
 *
 * A space knows the merges it landed by name. Everything else on the
 * first-parent line is either the platform's own — it commits an image tag
 * to the deployment manifests after every build, which touches nothing the
 * work touches — or somebody's commit, and reverting over that is taking
 * out work this space never made.
 */
export async function foreignSince(a: {
  repoRoot: string;
  head: string;
  /** Every merge this space landed, by commit. */
  ours: readonly string[];
  exec: GitExec;
}): Promise<{ commit: string; subject: string }[]> {
  const git = (...args: string[]) => a.exec("git", ["-C", a.repoRoot, ...args], a.repoRoot);
  const mine = new Set(a.ours);
  const line = (await git("log", "--first-parent", "--format=%H%x00%s", `${a.head}..HEAD`)).out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [commit, subject] = l.split("\u0000");
      return { commit, subject: subject ?? "" };
    });
  const out: { commit: string; subject: string }[] = [];
  for (const c of line) {
    if (mine.has(c.commit)) continue;
    // Tandem's own commits after a deploy: the merge, a repair the
    // platform's refusal asked for, a rollback. Only this machine writes
    // them, and they belong to the space that is being taken back out.
    if (/^tandem: /.test(c.subject)) continue;
    // The platform's own commit after a build: it writes an image tag into
    // the deployment manifests and nothing else.
    const touched = (await git("show", "--name-only", "--format=", c.commit)).out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (touched.length && touched.every((p) => /^k8s\//.test(p) || /kustomization\.ya?ml$/.test(p))) continue;
    out.push(c);
  }
  return out;
}

/** What a rollback commit says: which delivery, and which of its merges. */
function rollbackSubject(tep: string, head: string): string {
  return `tandem: roll back ${tep} (${head.slice(0, 8)})`;
}

export async function revertDelivery(a: {
  repoRoot: string;
  head: string;
  tep: string;
  exec: GitExec;
}): Promise<{ ok: boolean; why?: string }> {
  const git = (...args: string[]) => a.exec("git", ["-C", a.repoRoot, ...args], a.repoRoot);
  const known = await git("cat-file", "-e", `${a.head}^{commit}`);
  if (known.code !== 0) return { ok: false, why: `the merge ${a.head.slice(0, 8)} is not in this repository` };
  const already = await git("log", "--format=%s", `${a.head}..HEAD`);
  if (already.out.includes(rollbackSubject(a.tep, a.head))) return { ok: true };
  await git("fetch", "--quiet", "origin");
  const remote = (await git("rev-parse", "--verify", "--quiet", "origin/main")).out.trim();
  if (remote && (await git("merge-base", "--is-ancestor", "origin/main", "HEAD")).code !== 0) {
    const up = await git("merge", "--no-edit", "origin/main");
    if (up.code !== 0) {
      await git("merge", "--abort");
      return { ok: false, why: `main has moved on the remote in ways that conflict with what is here: ${up.out.trim().split("\n").pop() ?? ""}` };
    }
  }
  // The first parent is the project as it was before the merge, so this
  // takes out exactly what the merge brought in.
  const back = await git("revert", "--no-commit", "-m", "1", a.head);
  if (back.code === 0) {
    const said = await git("commit", "-m", rollbackSubject(a.tep, a.head));
    if (said.code !== 0)
      return { ok: false, why: `the revert could not be committed: ${said.out.trim().split("\n").pop() ?? ""}` };
  }
  if (back.code !== 0) {
    await git("revert", "--abort");
    await git("reset", "--hard", "HEAD");
    return {
      ok: false,
      why: `the work cannot be taken back out on its own — something since the merge builds on it: ${back.out.trim().split("\n").pop() ?? ""}`,
    };
  }
  const pushed = await git("push", "origin", "HEAD");
  if (pushed.code !== 0)
    return {
      ok: false,
      why: `taken out here, but the push was refused: ${pushed.out.trim().split("\n").pop() ?? ""} — the platform still has the work`,
    };
  return { ok: true };
}
