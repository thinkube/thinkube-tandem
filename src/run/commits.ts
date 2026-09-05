/**
 * The run's commit book: when a slice's last unit finishes green, its probes
 * ride into the code tree and the slice commits — later tester snapshots see
 * committed truth — and everyone waiting on "the next commit" wakes.
 */
import { waitOrStop } from "./waiting";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Exec } from "./oracle";
import type { RunState } from "./state";

/** How long a unit sleeps on another slice's commit before looking again. */
const WAIT_FOR_COMMIT_MS = 10 * 60 * 1000;

export function makeCommitBook(a: {
  tep: string;
  /** This run's own id, ridden as a `Tandem-Run:` trailer on every slice
   *  commit — so a later run's resume can name, in its own log, which run
   *  made a standing slice's work standing. */
  runId: string;
  branch: string;
  worktree: string;
  testerWt: string;
  dag: readonly { id: string; slice: string; footprint: readonly string[] }[];
  st: RunState;
  exec: Exec;
  log: (line: string, step?: string) => void;
  undelivered: string[];
  done: Set<string>;
  failed: Set<string>;
  /** Slices already committed by an earlier run of this cut. */
  standing: ReadonlySet<string>;
  sliceProbes: ReadonlyMap<string, string[]>;
  sliceFiles: ReadonlyMap<string, string[]>;
  /** How a unit sleeps between looks. Injectable so a test drives a
   *  ten-minute wait in no time: every deadlock this run has met lives in
   *  the waits, and a wait nothing can fast-forward is a wait no test can
   *  reach. Defaults to the clock. */
  sleep?: (ms: number, wake: (fn: () => void) => void) => Promise<void>;
}): {
  sliceCommitted: Set<string>;
  /** Units asleep on the next commit right now. */
  waiting: Set<string>;
  /** Sleep until the next commit, on the record: a unit that is waiting
   *  lands nothing, so nobody may wait on it in turn. */
  waitForCommit: (id: string) => Promise<void>;
  /** Commit a unit's work mid-flight, so it holds nothing while it waits. */
  commitUnitWork: (unitId: string, why: string) => Promise<void>;
  failWith: (id: string, ...why: string[]) => void;
  finishUnit: (id: string, slice: string, ok: boolean) => Promise<void>;
} {
  const sliceCommitted = new Set<string>(a.standing);
  const sliceRemaining = new Map<string, number>();
  for (const u of a.dag) sliceRemaining.set(u.slice, (sliceRemaining.get(u.slice) ?? 0) + 1);
  for (const sl of a.standing) sliceRemaining.set(sl, 0);

  let commitWaiters: (() => void)[] = [];
  /** Sleep on the clock, waking on the next commit or on Stop. Stop must be
   *  visible at once: a wait that only watches for a commit leaves a halted
   *  run looking alive for as long as its timeout. */
  // One way to wait, and it hears Stop the moment it is pressed — this
  // one polled the flag once a second, which is a second of a stopped run
  // still working, and a second kind of wait to keep right.
  const sleepOnTheClock = (ms: number, wake: (fn: () => void) => void): Promise<void> =>
    new Promise((resolve) => {
      let woken = false;
      const done = (): void => {
        if (woken) return;
        woken = true;
        resolve();
      };
      void waitOrStop(ms, a.st.stop.signal).then(done);
      wake(done);
    });
  const nextCommit = (ms: number): Promise<void> =>
    (a.sleep ?? sleepOnTheClock)(ms, (fn) => commitWaiters.push(fn));
  const commitSlice = async (slice: string): Promise<void> => {
    if (sliceCommitted.has(slice)) return;
    sliceCommitted.add(slice);
    const wake = commitWaiters;
    commitWaiters = [];
    for (const w of wake) w();
    const probes = a.sliceProbes.get(slice) ?? [];
    // The unit's LIVE footprints, not only the plan's list: a footprint
    // widened mid-run rides the commit, or the branch holds half a change.
    const live = a.dag.filter((u) => u.slice === slice).flatMap((u) => [...u.footprint]);
    // A granted-but-unwritten path must not sink the whole add.
    const paths = [...new Set([...(a.sliceFiles.get(slice) ?? []), ...live, ...probes])].filter((rel) =>
      fs.existsSync(path.join(a.worktree, rel)),
    );
    if (paths.length) await a.exec("git", ["add", "--", ...paths], a.worktree);
    // Subject and trailer ride as ONE combined message: a later run's
    // `committedSlicesOf` reads the run id from this commit's own body, and
    // git only keeps a body when it arrives in the same `-m` string as the
    // subject it belongs to.
    const c = await a.exec(
      "git",
      ["commit", "-m", `tandem: ${a.tep} ${slice}\n\nTandem-Run: ${a.runId}`],
      a.worktree,
    );
    if (c.code === 0) a.log(`✓ ${slice}: committed on ${a.branch}`);
    else a.log(`⚠ ${slice}: nothing to commit — ${c.out.trim().split("\n").pop() ?? ""}`);
  };
  const failWith = (id: string, ...why: string[]): void => {
    a.st.fail(id, why.join("; "));
    a.undelivered.push(...why.map((u) => `${id}: ${u}`));
  };
  const finishUnit = async (id: string, slice: string, ok: boolean): Promise<void> => {
    if (ok) {
      a.done.add(id);
      a.st.set(id, "done");
    } else {
      a.failed.add(id);
      a.st.set(id, "failed");
    }
    const left = (sliceRemaining.get(slice) ?? 1) - 1;
    sliceRemaining.set(slice, left);
    if (left === 0 && [...a.dag].filter((u) => u.slice === slice).every((u) => a.done.has(u.id))) await commitSlice(slice);
  };
  // A unit about to wait commits what it has written, so it holds nothing
  // while it is idle. Deadlock needs a unit to hold and wait; this removes
  // the holding. The message deliberately carries text after the slice
  // handle: `committedSlicesOf` only counts a line that ends there, so a
  // partial commit never reads as a finished slice on a later resume.
  const commitUnitWork = async (unitId: string, why: string): Promise<void> => {
    const u = a.dag.find((x) => x.id === unitId);
    if (!u) return;
    const paths = [...u.footprint].filter((rel) => fs.existsSync(path.join(a.worktree, rel)));
    if (!paths.length) return;
    await a.exec("git", ["add", "--", ...paths], a.worktree);
    const c = await a.exec("git", ["commit", "-m", `tandem: ${a.tep} ${u.slice} — partial: ${unitId} ${why}`], a.worktree);
    if (c.code === 0) a.log(`✓ ${unitId}: its work so far is committed — it holds nothing while it waits`, unitId);
  };

  const waiting = new Set<string>();
  const waitForCommit = async (id: string): Promise<void> => {
    waiting.add(id);
    try {
      await nextCommit(WAIT_FOR_COMMIT_MS);
    } finally {
      waiting.delete(id);
    }
  };
  return { sliceCommitted, waiting, waitForCommit, commitUnitWork, failWith, finishUnit };
}
