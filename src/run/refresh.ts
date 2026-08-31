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
import { defaultExec } from "./oracle";
import { formatBuild } from "./execs";
import type { Exec } from "./oracle";
import type { DispatchDeps } from "./dispatch";

export interface RefreshResult {
  refusal?: { trigger: string; refusal: string };
  /** Slices already committed on the branch by an earlier run of this cut,
   *  each paired with the run id that made it standing — when its commit
   *  carries one. */
  committedSlices: { slice: string; runId?: string }[];
  /** Whether an existing branch was kept and refreshed. */
  resumed: boolean;
}

/**
 * The slices an earlier run of this cut committed, from the branch's own
 * log — paired with the run id riding that commit's `Tandem-Run:` trailer,
 * so a resumed run can say, for a step it does not repeat, WHICH earlier
 * run did the work rather than just that some run did.
 *
 * `git log --format=%s%n%b%x00` gives one record per commit, each ending in
 * a NUL, so a multi-line body is read whole without swallowing the next
 * commit's subject.
 */
export function committedSlicesOf(log: string, tep: string): { slice: string; runId?: string }[] {
  const out = new Map<string, string | undefined>();
  const escapedTep = tep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const subjectRe = new RegExp(`^tandem: ${escapedTep} (\\S+)$`);
  for (const record of log.split("\0")) {
    const lines = record.split("\n");
    const subject = (lines[0] ?? "").trim();
    const m = subjectRe.exec(subject);
    if (!m) continue;
    const body = lines.slice(1).join("\n");
    const trailer = /^Tandem-Run:\s*(\S+)\s*$/m.exec(body);
    out.set(m[1], trailer ? trailer[1] : out.get(m[1]));
  }
  return [...out].map(([slice, runId]) => ({ slice, runId }));
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
  deps: DispatchDeps;
  exec: Exec;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}): Promise<RefreshResult> {
  const { repoRoot, branch, worktree, exec, log } = args;
  await exec("git", ["-C", repoRoot, "worktree", "remove", "--force", worktree], repoRoot);
  await exec("git", ["-C", repoRoot, "worktree", "prune"], repoRoot);
  const exists = (await exec("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", branch], repoRoot)).code === 0;
  const refuse = (trigger: string, refusal: string): RefreshResult => ({ refusal: { trigger, refusal }, committedSlices: [], resumed: exists });

  if (!exists) {
    const wt = await exec("git", ["-C", repoRoot, "worktree", "add", "-b", branch, worktree], repoRoot);
    if (wt.code !== 0) return refuse("worktree", `worktree failed: ${wt.out.trim().slice(0, 300)}`);
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
  const history = (
    await exec("git", ["-C", worktree, "log", `--grep=^tandem: ${args.tep} `, "--format=%s%n%b%x00"], worktree)
  ).out;
  const committedSlices = committedSlicesOf(history, args.tep);
  if (committedSlices.length)
    log(`${args.tep}: standing from the earlier run: ${committedSlices.map((c) => c.slice).join(", ")}`);
  return { committedSlices, resumed: true };
}

/**
 * A resumed branch that does not build gets ONE bounded repair before the
 * run refuses: footprint = the files the compiler names, evidence = the
 * compiler's own words. An earlier run may have left the branch holding
 * half a change; no dispatched worker exists yet, so the refresh owns it.
 */
/** Rounds a broken standing tree may spend. Progress ends it sooner: a
 *  round that does not reduce the compiler's error count buys nothing. */
const MEND_ROUNDS = 4;

/** The files a compiler names, plus the module each named test belongs to —
 *  a test that cannot compile is often waiting on an export from its own
 *  subject, which the compiler names nowhere. */
function filesNamedIn(words: string): string[] {
  const named = [...new Set([...words.matchAll(/(?:^|\s)((?:src|webview|docs)\/[\w./-]+\.[a-z]+)[(:]/gm)].map((m) => m[1]))];
  const subjects = named
    .map((f) => f.replace(/\.(test|spec)\.([cm]?[jt]sx?)$/, ".$2"))
    .filter((f) => !named.includes(f));
  return [...named, ...subjects];
}

/** How many errors the compiler reported — the number a round must reduce. */
function errorCount(words: string): number {
  return [...words.matchAll(/\berror\s+TS\d+/g)].length || (words.trim() ? 1 : 0);
}

export async function repairStandingTree(args: {
  worktree: string;
  tep: string;
  refusal: string;
  deps: DispatchDeps;
  exec: Exec;
  halted?: () => boolean;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
  /** Re-proves the build: whether the tree stands, and the compiler's words. */
  rebuild: () => Promise<{ ok: boolean; words: string }>;
}): Promise<boolean> {
  const id = "refresh#standing";
  const worker = args.deps.worker ?? runUnitWorker;
  const mended = new Set<string>();
  let words = args.refusal;
  let fewest = errorCount(words);
  // A compiler names the errors it can see; mending those reveals the next
  // ones behind them. One round could only ever fix the first wave, so a
  // tree with two waves refused every run — the machine asking a person to
  // repair its own branch by hand. Rounds are bought with progress: while
  // the error count falls, another round; when it stops falling, it stops.
  for (let round = 1; round <= MEND_ROUNDS && !args.halted?.(); round++) {
    const files = filesNamedIn(words);
    if (!files.length) return false;
    for (const f of files) mended.add(f);
    args.log(
      `🧰 ${args.tep}: the resumed branch does not build — mending it before dispatch ` +
        `(round ${round}/${MEND_ROUNDS}, ${fewest} error(s)): ${files.join(", ").slice(0, 300)}`,
      id,
    );
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
        ...(args.deps.prepare ? { buildTool: async () => formatBuild(await defaultExec("sh", ["-c", args.deps.prepare!], args.worktree).then((r) => ({ code: r.code, output: r.out }))) } : {}),
      },
      [
        `The run branch of ${args.tep} holds committed work that does not compile — an earlier run`,
        "committed half of a change. Mend the tree so it builds: read the errors, find the missing",
        "half in the callers' own expectations, and complete it. Change only the files listed.",
        "",
        "THE COMPILER'S WORDS:",
        words.slice(0, 4000),
        "",
        "FILES YOU MAY CHANGE:",
        ...files.map((f) => `- ${f}`),
      ].join("\n"),
    );
    const proof = await args.rebuild();
    if (proof.ok) {
      await args.exec("git", ["-C", args.worktree, "add", "--", ...mended], args.worktree);
      await args.exec("git", ["-C", args.worktree, "commit", "-m", `tandem: ${args.tep} — mend the standing tree`], args.worktree);
      args.log(`✓ ${args.tep}: the standing tree builds again — mended in ${round} round(s) and committed`, id);
      args.defect({ unit: id, activity: "refresh", trigger: "standing-tree", type: "code", impact: "half-committed change completed before dispatch", detail: [...mended].join(", ").slice(0, 400) });
      return true;
    }
    const left = errorCount(proof.words);
    if (left >= fewest) {
      args.log(`⛔ ${args.tep}: the mend stopped making progress — ${left} error(s) still stand`, id);
      args.defect({ unit: id, activity: "refresh", trigger: "standing-tree", type: "code", impact: "run refused — the branch does not build", detail: proof.words.slice(0, 1000) });
      return false;
    }
    fewest = left;
    words = proof.words;
  }
  return false;
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
