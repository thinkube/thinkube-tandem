/**
 * Making a run's trees ready to build and check.
 *
 * A worktree fresh from `git worktree add` is a bare checkout: whatever a
 * developer's clone accumulated — installed dependencies, toolchains — is
 * not there, so a build step that is right for the repository fails on
 * "not installed", every verify reports a build failure that no worker
 * can turn green, and the coder grinds against the environment.
 *
 * So the code worktree is PROVISIONED once, with the command the machine
 * derived from the repository's manifests, and what that command produced
 * is OBSERVED — the ignored entries that appeared — rather than named:
 * nothing here knows any package manager. Those entries are then linked
 * into every verify runner (a runner is a snapshot of the same branch), so
 * one install serves the whole run.
 *
 * When the checkout the run was started from ALREADY HOLDS what
 * provisioning would produce, the run borrows it — the same links, from
 * the base — and skips the command. A machine with little memory dies
 * during an install it did not need, which is how two runs ended before
 * their first worker. Borrowing is checked immediately, because the build
 * is proved right after: if the build then fails, the borrowed state is
 * dropped and the real command runs, so a stale borrow costs one build and
 * never a wrong run.
 *
 * When the checkout the run was started from already holds what
 * provisioning would produce, the run BORROWS it — the same links, from
 * the base — and skips the command. A machine with little memory dies
 * during an install it did not need; borrowing costs nothing and is
 * checked immediately, because the build is proved right after. If the
 * build then fails, the borrowed state is dropped and the real command
 * runs, so a stale borrow costs one build, never a wrong run.
 *
 * Then the build step is PROVED on the untouched tree: if it fails before
 * any worker has changed a line, the fault is the environment's, and the
 * run is refused with the output — never dispatched into a wall. The
 * repository's own suite is judged once, at the gate.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Exec } from "./oracle";
import { isProbePath, isTestPath } from "./testHomes";

export type BoundedExec = (
  cmd: string,
  cwd: string,
) => Promise<{ code: number | null; output: string }>;

/** Ignored entries at the tree's surface (`!! node_modules/`), collapsed —
 *  never one line per installed file. */
async function ignoredEntries(dir: string, exec: Exec): Promise<Set<string>> {
  const r = await exec("git", ["-C", dir, "status", "--porcelain", "--ignored"], dir);
  return new Set(
    r.out
      .split("\n")
      .filter((l) => l.startsWith("!! "))
      .map((l) => l.slice(3).trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

export interface TreeSetup {
  /** The proven way to run one of the repository's own tests, or "". */
  runOne: string;
  /** What provisioning produced — ignored entries to link into runners. */
  provisioned: string[];
  /** What the build step produced — where compiled output lands, so a
   *  tester imports from a folder that exists. */
  built: string[];
  /** Why the run cannot proceed, when the untouched tree fails its own setup. */
  refusal?: string;
  /** The setup that finally held, when a first answer had to be corrected. */
  corrected?: { provision: string; prepare: string };
}

/** The end of a tool's output, with the lines that name a failure kept even
 *  when a summary follows them — a reader must see WHAT failed, not only
 *  that something did. */
const tail = (output: string, n = 900): string => {
  const lines = output.trim().split("\n");
  const named = lines.filter((l) => /^not ok|\b(FAIL|FAILED|Error|error:)\b/.test(l)).slice(-8);
  const last = lines.slice(-6);
  return [...new Set([...named, ...last])].join("\n").slice(-n);
};

export interface SetupArgs {
  worktree: string;
  /** The checkout the run was started from, whose provisioning can be
   *  borrowed instead of installed again. */
  repoRoot?: string;
  provision?: string;
  prepare?: string;
  /** Runs one of the repository's own test files (`<file>` = its source
   *  path). Proved on one existing test before it is trusted; an answer
   *  that does not hold is dropped, never a reason to refuse the run. */
  runOne?: string;
  /** Re-read the setup facts with a failure as evidence; the door tries the
   *  corrected answer once before refusing. */
  resetup?: (evidence: string) => Promise<{ provision: string; prepare: string; runOne?: string }>;
  /** Told the answer that held on the untouched tree — the only one worth remembering. */
  proven?: (s: { provision: string; prepare: string; runOne: string }) => void;
  exec: Exec;
  boundedExec: BoundedExec;
  log: (line: string) => void;
}

/** Provision the tree and prove the build and the suite on it before any
 *  worker runs; a setup answer that fails is re-read once with the failure
 *  as evidence, and the corrected answer is tried before the run refuses. */
export async function setupRunTree(args: SetupArgs): Promise<TreeSetup> {
  const first = await proveTree(args);
  if (!first.refusal) {
    args.proven?.({ provision: args.provision ?? "", prepare: args.prepare ?? "", runOne: first.runOne });
    return first;
  }
  if (!args.resetup) return first;
  const again = await args.resetup(first.refusal).catch(() => undefined);
  if (!again || (again.provision === (args.provision ?? "") && again.prepare === (args.prepare ?? "")))
    return first;
  args.log(
    `the setup answer was corrected from the failure — provision: ${again.provision || "NONE"}; prepare: ${again.prepare || "NONE"}`,
  );
  const second = await proveTree({ ...args, provision: again.provision, prepare: again.prepare, runOne: again.runOne ?? args.runOne });
  if (!second.refusal) args.proven?.({ provision: again.provision, prepare: again.prepare, runOne: second.runOne });
  return second.refusal ? second : { ...second, corrected: { provision: again.provision, prepare: again.prepare } };
}

/** Seconds since a moment, for a door that must say how long each step took. */
const since = (t0: number): string => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function proveTree(args: SetupArgs, borrow = true): Promise<TreeSetup> {
  const provisioned: string[] = [];
  let borrowed = false;
  // Borrowing does not wait for a known install command: the checkout the
  // run was started from holds the ground truth about what a ready tree
  // has, and a repository whose install command was never learned still
  // deserves a tree that builds. The build proof right after guards it.
  if (borrow && args.repoRoot) {
    const theirs = await ignoredEntries(args.repoRoot, args.exec);
    const mine = await ignoredEntries(args.worktree, args.exec);
    const lendable = [...theirs].filter((e) => !mine.has(e) && !e.startsWith("."));
    if (lendable.length) {
      await linkProvisioned(args.worktree, args.repoRoot, lendable);
      provisioned.push(...lendable);
      borrowed = true;
      args.log(
        `borrowing the checkout's ${lendable.slice(0, 6).join(", ")}${lendable.length > 6 ? "…" : ""}` +
          (args.provision ? ` instead of running: ${args.provision}` : ""),
      );
    }
  }
  if (args.provision && !borrowed) {
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`provisioning the worktree: ${args.provision}`);
    const t0 = Date.now();
    const p = await args.boundedExec(args.provision, args.worktree);
    args.log(`  provisioned in ${since(t0)}`);
    if (p.code !== 0)
      return {
        runOne: "",
        provisioned,
        built: [],
        refusal: `the repository's own provisioning step (${args.provision}) fails on an untouched checkout — no worker can build here until it does:\n${tail(p.output)}`,
      };
    const after = await ignoredEntries(args.worktree, args.exec);
    for (const e of after) if (!before.has(e)) provisioned.push(e);
  }
  const built: string[] = [];
  if (args.prepare) {
    const before = await ignoredEntries(args.worktree, args.exec);
    args.log(`building the untouched tree: ${args.prepare}`);
    const t0 = Date.now();
    const b = await args.boundedExec(args.prepare, args.worktree);
    args.log(`  built in ${since(t0)}`);
    if (b.code !== 0) {
      // A borrowed provisioning that does not build is simply wrong for
      // this tree: drop it and pay for the real install once.
      if (borrowed) {
        args.log("  the borrowed provisioning does not build here — installing instead");
        for (const rel of provisioned) await fs.rm(path.join(args.worktree, rel), { force: true }).catch(() => {});
        return proveTree(args, false);
      }
      return {
        runOne: "",
        provisioned,
        built,
        refusal: `the repository's own build step (${args.prepare}) fails on the untouched tree — every check would report a build failure no worker can fix:\n${tail(b.output)}`,
      };
    }
    const after = await ignoredEntries(args.worktree, args.exec);
    for (const e of after) if (!before.has(e) && !provisioned.includes(e)) built.push(e);
    if (built.length) args.log(`  the build emits into: ${built.join(", ")}`);
  }
  return { provisioned, built, runOne: await proveRunOne(args) };
}

/** The single-test command, tried on one of the repository's own tests.
 *  Held → kept; failed or nothing to try it on → "" (the gate's whole suite
 *  still stands behind every slice), with the reason said. */
async function proveRunOne(args: SetupArgs): Promise<string> {
  if (!args.runOne) return "";
  const listed = (await args.exec("git", ["-C", args.worktree, "ls-files"], args.worktree)).out.split("\n").map((l) => l.trim());
  const sample = listed.filter((f) => f && isTestPath(f) && !isProbePath(f)).sort((a, b) => a.length - b.length)[0];
  if (!sample) {
    args.log("  no test of the repository's own to prove the single-test command on — slices run without it");
    return "";
  }
  const cmd = args.runOne.replace(/<file>/g, sample);
  args.log(`proving the single-test command on ${sample}: ${cmd}`);
  const t0 = Date.now();
  const r = await args.boundedExec(cmd, args.worktree);
  // Held means the runner RAN the test — green, or red in the runner's own
  // words. A red test on the base is the base's business; a command that
  // cannot run one file at all is not a way to run one.
  const ran = r.code === 0 || /^(not )?ok \d+|\b\d+ (passed|failed)\b|^(--- )?(PASS|FAIL)\b/m.test(r.output);
  args.log(`  ${ran ? "held" : "did not hold"} in ${since(t0)}${ran ? "" : ` — ${tail(r.output, 300).split("\n").pop() ?? ""}`}`);
  return ran ? args.runOne : "";
}

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

/** Build the delivered tree before the closing checks; a failure is spoken,
 *  and the checks still run — against an unbuilt tree, said so. */
export async function prepareAtGate(
  prepare: string | undefined,
  worktree: string,
  boundedExec: BoundedExec,
  log: (line: string) => void,
): Promise<void> {
  if (!prepare) return;
  const prep = await boundedExec(prepare, worktree);
  if (prep.code !== 0)
    log(
      `⚠ the prepare command failed at the gate — checks run against an unbuilt tree: ${prep.output.split("\n").pop()?.slice(0, 160) ?? ""}`,
    );
}
