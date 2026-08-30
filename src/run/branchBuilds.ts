/**
 * The branch still builds, and whoever broke it is named at the moment.
 *
 * A unit is graded in an isolated runner: the branch as committed, plus
 * that unit's own files. `prepare` runs there — enough to make the checks
 * runnable. What SHIPS is a different command in any repository where the
 * product is more than its typecheck, and it ran only at the closing gate,
 * hours later.
 *
 * So a unit rewrote a re-export, dropped a name another file imported,
 * compiled clean, passed every check and landed. Thirty-four minutes later
 * the next unit started, inherited a branch that would not build, and
 * spent eighty-two minutes before ending undelivered — for one word in a
 * file it was not cleared to write, put there by a unit that had already
 * finished and gone.
 *
 * It cannot be answered in the shared worktree: every unit writes there at
 * once, so half of what a build says is somebody's unfinished sentence. It
 * cannot be answered by which files the errors name either — this break
 * was made in the breaker's OWN file and surfaced in a file belonging to
 * nobody in the run.
 *
 * What answers it is the branch's own history. The product is built on the
 * committed branch after each slice lands: green before, red after, and
 * the slice that landed in between is the one that broke it. One build per
 * slice, no attribution to guess at, and the break is named a minute after
 * it is made instead of two hours later on somebody else's account.
 */
import * as path from "node:path";
import { ensureSnapshot } from "./oracle";
import type { Exec } from "./oracle";

export interface BranchBuild {
  /** Build the committed branch after `slice` landed; name a new break. */
  after: (slice: string) => Promise<void>;
  /** Whether the branch is known to be broken, and by whom. */
  broken: () => { slice: string; output: string } | undefined;
}

/**
 * Keep the committed branch's build verdict as slices land on it.
 *
 * The first build is the control: whatever it says is the state the run
 * inherited, and it is never charged to the slice that happened to land
 * first. After that, green→red names the slice in between.
 */
export function watchBranchBuild(a: {
  repoRoot: string;
  branch: string;
  wtRoot: string;
  tep: string;
  /** What ships. Absent (or the same as `prepare`) means nothing to do —
   *  the runner's own prepare already covers it. */
  build?: string;
  exec: Exec;
  run: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  log: (line: string) => void;
  /** Injectable for drives: how the committed branch is materialised. */
  snapshot?: (dir: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  defect: (e: { slice?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}): BranchBuild {
  const dir = path.join(a.wtRoot, "oracle-runners", `${a.tep}-branch-build`);
  let last: "unknown" | "green" | "red" = "unknown";
  let broken: { slice: string; output: string } | undefined;
  return {
    broken: () => broken,
    after: async (slice) => {
      if (!a.build) return;
      const snap = await (a.snapshot ?? ((d: string) => ensureSnapshot(a.repoRoot, a.branch, d, a.exec)))(dir);
      if (!snap.ok) {
        a.log(`⚠ the branch's build could not be checked after ${slice}: ${snap.reason}`);
        return;
      }
      const r = await a.run(a.build, dir);
      const green = r.code === 0;
      if (green) {
        if (last === "red") a.log(`✓ the branch builds again, after ${slice} landed`);
        last = "green";
        broken = undefined;
        return;
      }
      // The first reading is what the run inherited, not this slice's doing.
      if (last === "unknown") {
        a.log(`⚠ the branch did not build before this run's work landed — ${slice} is not the cause`);
        a.defect({
          activity: "branch build",
          trigger: "inherited",
          type: "machine",
          impact: "the branch was already red when the run started landing work",
          detail: (r.output ?? "").slice(0, 1500),
        });
        last = "red";
        return;
      }
      if (last === "green") {
        broken = { slice, output: r.output ?? "" };
        a.log(
          `⛔ ${slice} landed and the product no longer builds. The branch built before it and does not after, ` +
            `so this is its break, not the next unit's:\n${(r.output ?? "").split("\n").slice(0, 12).join("\n")}`,
        );
        a.defect({
          slice,
          activity: "branch build",
          trigger: "broke-the-build",
          type: "code",
          impact: "the branch stopped building when this slice landed",
          detail: (r.output ?? "").slice(0, 1500),
        });
      }
      last = "red";
    },
  };
}
