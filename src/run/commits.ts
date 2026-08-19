/**
 * The run's commit book: when a slice's last unit finishes green, its probes
 * ride into the code tree and the slice commits — later tester snapshots see
 * committed truth — and everyone waiting on "the next commit" wakes.
 */
import { copyRel } from "./oracle";
import type { Exec } from "./oracle";
import type { RunState } from "./state";

export function makeCommitBook(a: {
  tep: string;
  branch: string;
  worktree: string;
  testerWt: string;
  dag: readonly { id: string; slice: string }[];
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
}): {
  sliceCommitted: Set<string>;
  nextCommit: (ms: number) => Promise<void>;
  failWith: (id: string, ...why: string[]) => void;
  finishUnit: (id: string, slice: string, ok: boolean) => Promise<void>;
} {
  const sliceCommitted = new Set<string>(a.standing);
  const sliceRemaining = new Map<string, number>();
  for (const u of a.dag) sliceRemaining.set(u.slice, (sliceRemaining.get(u.slice) ?? 0) + 1);
  for (const sl of a.standing) sliceRemaining.set(sl, 0);

  let commitWaiters: (() => void)[] = [];
  const nextCommit = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(() => resolve(), ms);
      commitWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  const commitSlice = async (slice: string): Promise<void> => {
    if (sliceCommitted.has(slice)) return;
    sliceCommitted.add(slice);
    const wake = commitWaiters;
    commitWaiters = [];
    for (const w of wake) w();
    const probes = a.sliceProbes.get(slice) ?? [];
    for (const rel of probes) await copyRel(a.testerWt, a.worktree, rel).catch(() => {});
    const paths = [...new Set([...(a.sliceFiles.get(slice) ?? []), ...probes])];
    if (paths.length) await a.exec("git", ["add", "--", ...paths], a.worktree);
    const c = await a.exec("git", ["commit", "-m", `tandem: ${a.tep} ${slice}`], a.worktree);
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
  return { sliceCommitted, nextCommit, failWith, finishUnit };
}
