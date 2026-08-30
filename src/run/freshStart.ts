/**
 * Start a cut again from nothing, keeping what is thrown away.
 *
 * A rerun resumes: a slice already committed by an earlier run stands, and
 * only what never finished runs again (src/run/plan.ts, `standingSlices`).
 * That is right when the last run merely stopped, and wrong when the run
 * itself was the problem — the machinery changed underneath it, and the
 * finished units were judged by rules that have since been corrected. Then
 * the whole cut must be proved again, on today's base, and a resume proves
 * almost nothing.
 *
 * The branch is where the resume lives, so a fresh start removes it: the
 * run's own door then finds no branch and cuts a new one from the base,
 * which is exactly the first-run path (src/run/refresh.ts).
 *
 * Nothing is destroyed without a way back. The discarded head is tagged
 * before the branch goes, so an hour of work thrown away by a gesture is
 * still reachable by name — `git log discarded/…` — long after the branch
 * that held it is gone from here and from the forge.
 */
import type { Exec } from "./oracle";

export interface FreshStart {
  /** What was discarded, and the tag that still holds it. */
  discarded?: { head: string; tag: string };
  /** Said when there was nothing to discard. */
  nothing?: string;
}

/** The tag a discarded branch is kept under: its own name and the moment. */
export function discardTag(branch: string, at: Date): string {
  const when = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `discarded/${branch.replace(/^tandem\//, "")}-${when}`;
}

/**
 * Remove a cut's run branch so the next run starts from the base.
 *
 * Best-effort by design: a worktree that is already gone, a remote that
 * refuses, a tag that exists — none of them is a reason to refuse the
 * fresh start the person asked for. Only the local branch's deletion is
 * load-bearing, because that is what makes the door cut a new one.
 */
export async function discardRunBranch(a: {
  repoRoot: string;
  branch: string;
  worktree: string;
  exec: Exec;
  now?: () => Date;
  log: (line: string) => void;
}): Promise<FreshStart> {
  const at = (a.now ?? (() => new Date()))();
  const head = (
    await a.exec("git", ["-C", a.repoRoot, "rev-parse", "--verify", "--quiet", a.branch], a.repoRoot)
  ).out.trim();
  if (!head) return { nothing: `no branch ${a.branch} — this cut has not run here before` };

  const tag = discardTag(a.branch, at);
  await a.exec("git", ["-C", a.repoRoot, "tag", "-f", tag, head], a.repoRoot);
  // The worktree holds the branch checked out; the branch cannot go while it does.
  await a.exec("git", ["-C", a.repoRoot, "worktree", "remove", "--force", a.worktree], a.repoRoot);
  await a.exec("git", ["-C", a.repoRoot, "worktree", "prune"], a.repoRoot);
  const gone = await a.exec("git", ["-C", a.repoRoot, "branch", "-D", a.branch], a.repoRoot);
  if (gone.code !== 0)
    return { nothing: `the branch ${a.branch} could not be removed: ${gone.out.trim().slice(0, 200)}` };
  // The forge's copy too, or the next push resurrects the old work as a merge.
  await a.exec("git", ["-C", a.repoRoot, "push", "origin", "--delete", a.branch], a.repoRoot);

  a.log(
    `starting again from nothing: ${a.branch} is discarded and kept as ${tag} ` +
      `(${head.slice(0, 7)}) — every unit runs again on the base as it stands today.`,
  );
  return { discarded: { head, tag } };
}
