/**
 * Run again is a RESUME, never a rebuild.
 *
 * A signed cut that already has a run branch keeps it: the branch is
 * refreshed by merging the base branch's new commits into it at the start,
 * so the work that stands — committed slices, probes, decisions — stays
 * standing, and the resumed work builds against current reality. Git's
 * merge is the impact computation: disjoint changes cost one commit and
 * seconds; a conflict is routed to a repair worker with the markers as
 * evidence, before anything is dispatched.
 */
import { resolveWorkerModel } from "../engine/workerModel";
import { runUnitWorker, porcelainPaths } from "./worker";
import { ensureSnapshot } from "./oracle";
import type { Exec } from "./oracle";
import type { DispatchDeps } from "./dispatch";

export interface RefreshResult {
  refusal?: { trigger: string; refusal: string };
  /** Slices already committed on the branch by an earlier run of this cut. */
  committedSlices: string[];
  /** Whether an existing branch was kept and refreshed. */
  resumed: boolean;
}

/** The slices an earlier run of this cut committed, from the branch's own log. */
export function committedSlicesOf(log: string, tep: string): string[] {
  const out: string[] = [];
  for (const line of log.split("\n")) {
    const m = new RegExp(`^tandem: ${tep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (\\S+)$`).exec(line.trim());
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * Provision the run trees. First run of a cut: a fresh branch from the
 * base. A cut that already has a branch: keep it, merge the base in, and
 * resolve any conflict inside the run before dispatch.
 */
export async function refreshRunTrees(args: {
  repoRoot: string;
  branch: string;
  tep: string;
  worktree: string;
  testerWt: string;
  deps: DispatchDeps;
  exec: Exec;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}): Promise<RefreshResult> {
  const { repoRoot, branch, worktree, testerWt, exec, log } = args;
  for (const stale of [worktree, testerWt])
    await exec("git", ["-C", repoRoot, "worktree", "remove", "--force", stale], repoRoot);
  await exec("git", ["-C", repoRoot, "worktree", "prune"], repoRoot);
  const exists = (await exec("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", branch], repoRoot)).code === 0;
  const refuse = (trigger: string, refusal: string): RefreshResult => ({ refusal: { trigger, refusal }, committedSlices: [], resumed: exists });

  if (!exists) {
    const wt = await exec("git", ["-C", repoRoot, "worktree", "add", "-b", branch, worktree], repoRoot);
    if (wt.code !== 0) return refuse("worktree", `worktree failed: ${wt.out.trim().slice(0, 300)}`);
    if (!(await ensureSnapshot(repoRoot, branch, testerWt, exec)))
      return refuse("tester-snapshot", `tester snapshot failed at ${testerWt}`);
    return { committedSlices: [], resumed: false };
  }

  // Resume: the branch stands; the base's new commits merge in first.
  const wt = await exec("git", ["-C", repoRoot, "worktree", "add", worktree, branch], repoRoot);
  if (wt.code !== 0) return refuse("worktree", `worktree failed: ${wt.out.trim().slice(0, 300)}`);
  const baseRef = (await exec("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"], repoRoot)).out.trim();
  const behind = (await exec("git", ["-C", worktree, "rev-list", "--count", `${branch}..${baseRef}`], worktree)).out.trim();
  if (behind !== "0") {
    log(`${args.tep}: resuming the existing branch — merging ${behind} new base commit(s) from ${baseRef}`);
    const merge = await exec("git", ["-C", worktree, "merge", "--no-edit", baseRef], worktree);
    if (merge.code !== 0) {
      const conflicted = (await exec("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=U"], worktree)).out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      log(`⚔ ${args.tep}: the base moved into ${conflicted.length} file(s) this cut also changed — a repair resolves the conflict before dispatch: ${conflicted.join(", ").slice(0, 300)}`);
      const ok = await resolveConflicts({ ...args, conflicted });
      if (!ok) {
        await exec("git", ["-C", worktree, "merge", "--abort"], worktree);
        return refuse(
          "refresh-conflict",
          `the base branch and this cut's work both changed ${conflicted.join(", ").slice(0, 200)} and the conflict could not be resolved by the run — the branch was left as it was`,
        );
      }
    }
  } else {
    log(`${args.tep}: resuming the existing branch — the base has not moved`);
  }
  if (!(await ensureSnapshot(repoRoot, branch, testerWt, exec)))
    return refuse("tester-snapshot", `tester snapshot failed at ${testerWt}`);
  const history = (await exec("git", ["-C", worktree, "log", `--grep=^tandem: ${args.tep} `, "--format=%s"], worktree)).out;
  const committedSlices = committedSlicesOf(history, args.tep);
  if (committedSlices.length) log(`${args.tep}: standing from the earlier run: ${committedSlices.join(", ")}`);
  return { committedSlices, resumed: true };
}

/**
 * A resumed branch that does not build gets ONE bounded repair before the
 * run refuses: footprint = the files the compiler names, evidence = the
 * compiler's own words. An earlier run may have left the branch holding
 * half a change; no dispatched worker exists yet, so the refresh owns it.
 */
export async function repairStandingTree(args: {
  worktree: string;
  tep: string;
  refusal: string;
  deps: DispatchDeps;
  exec: Exec;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
  /** Re-proves the build; true when the tree stands. */
  rebuild: () => Promise<boolean>;
}): Promise<boolean> {
  const files = [...new Set([...args.refusal.matchAll(/(?:^|\s)((?:src|webview|docs)\/[\w./-]+\.[a-z]+)\(/gm)].map((m) => m[1]))];
  if (!files.length) return false;
  const id = "refresh#standing";
  args.log(`🧰 ${args.tep}: the resumed branch does not build — a repair mends it before dispatch: ${files.join(", ").slice(0, 300)}`, id);
  const worker = args.deps.worker ?? runUnitWorker;
  await worker(
    {
      model: resolveWorkerModel(args.deps.workerModel ?? { workerModel: args.deps.model }, "code"),
      worktree: args.worktree,
      role: "test",
      footprint: files,
      baseline: new Set(await porcelainPaths(args.worktree)),
      abort: new AbortController(),
      onPark: (_q, answer) => answer("Decide from the compiler's words and the surrounding code; the run does not ask a person."),
      log: (line: string) => args.log(line, id),
    },
    [
      `The run branch of ${args.tep} holds committed work that does not compile — an earlier run`,
      "committed half of a change. Mend the tree so it builds: read the errors, find the missing",
      "half in the callers' own expectations, and complete it. Change only the files listed.",
      "",
      "THE COMPILER'S WORDS:",
      args.refusal.slice(0, 4000),
      "",
      "FILES YOU MAY EDIT:",
      ...files.map((f) => `- ${f}`),
    ].join("\n"),
  );
  const ok = await args.rebuild();
  if (!ok) return false;
  await args.exec("git", ["-C", args.worktree, "add", "--", ...files], args.worktree);
  await args.exec("git", ["-C", args.worktree, "commit", "-m", `tandem: ${args.tep} — mend the standing tree`], args.worktree);
  args.log(`✓ ${args.tep}: the standing tree builds again — mended and committed`, id);
  args.defect({ unit: id, activity: "refresh", trigger: "standing-tree", type: "code", impact: "half-committed change completed before dispatch", detail: files.join(", ").slice(0, 400) });
  return true;
}

/** One bounded repair worker over the conflict markers; the merge concludes
 *  only when nothing is left unmerged. */
async function resolveConflicts(args: {
  worktree: string;
  tep: string;
  conflicted: string[];
  deps: DispatchDeps;
  exec: Exec;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}): Promise<boolean> {
  const worker = args.deps.worker ?? runUnitWorker;
  const id = "refresh#merge";
  const abort = new AbortController();
  await worker(
    {
      model: resolveWorkerModel(args.deps.workerModel ?? { workerModel: args.deps.model }, "code"),
      worktree: args.worktree,
      role: "test",
      footprint: args.conflicted,
      baseline: new Set(await porcelainPaths(args.worktree)),
      abort,
      onPark: (_q, answer) => answer("Decide from the two sides' own words; the run does not ask a person."),
      log: (line: string) => args.log(line, id),
    },
    [
      `You are resolving a git merge conflict on the run branch of ${args.tep}.`,
      "The base branch and this cut's work both changed the files below; the working tree holds",
      "the conflict markers. Resolve each file so BOTH intents survive: the base's change is the",
      "repository's current truth, the branch's change is signed work — neither side is dropped",
      "unless the two are literally the same edit. Remove every conflict marker. Do not touch any",
      "other file.",
      "",
      "CONFLICTED FILES:",
      ...args.conflicted.map((f) => `- ${f}`),
    ].join("\n"),
  );
  const left = (await args.exec("git", ["-C", args.worktree, "diff", "--name-only", "--diff-filter=U"], args.worktree)).out.trim();
  const markers = (await args.exec("git", ["-C", args.worktree, "grep", "-l", "^<<<<<<< ", "--", ...args.conflicted], args.worktree)).out.trim();
  if (markers) return false;
  if (left) await args.exec("git", ["-C", args.worktree, "add", "--", ...args.conflicted], args.worktree);
  const done = await args.exec("git", ["-C", args.worktree, "commit", "--no-edit"], args.worktree);
  if (done.code !== 0) return false;
  args.log(`✓ ${args.tep}: the merge conflict was resolved inside the run and committed`);
  args.defect({
    unit: id,
    activity: "refresh",
    trigger: "merge-conflict",
    type: "contract",
    impact: "conflict resolved before dispatch",
    detail: args.conflicted.join(", ").slice(0, 400),
  });
  return true;
}
