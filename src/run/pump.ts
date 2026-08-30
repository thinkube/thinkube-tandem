/**
 * What runs next, and how many at once.
 *
 * One subject: the frontier decides which units may start, the cap decides
 * how many run together, and every unit that could have started but did
 * not says which of the two is holding it. A unit that crashes is that
 * unit's failure, on the record — never the run's end — and a unit the run
 * never reached is blocked with the reason, never left as nothing.
 */
import { frontier, overlapWaits } from "./frontier";
import type { SchedUnit } from "../engine/core/dag";
import type { RunState } from "./state";

export async function pumpUnits(a: {
  st: RunState;
  dag: SchedUnit[];
  pending: Set<string>;
  done: Set<string>;
  failed: Set<string>;
  liveFootprints: Map<string, { tree: string; paths: string[] }>;
  concurrency: number;
  worktree: string;
  testerWt: string;
  runOne: (u: SchedUnit) => Promise<void>;
  finishUnit: (id: string, slice: string, ok: boolean) => Promise<void>;
  failWith: (id: string, ...why: string[]) => void;
  onTestUnitCrash: () => void;
  log: (line: string, step?: string) => void;
  defect: (e: {
    slice?: string;
    unit?: string;
    activity: string;
    trigger: string;
    impact: string;
    detail: string;
  }) => void;
}): Promise<void> {
  const { st, dag, pending, done, failed, liveFootprints, concurrency } = a;
  const inflight = new Map<string, Promise<void>>();
  while (!st.halted) {
    // The frontier refuses a unit whose footprint a running unit is writing — two coders in one file is a silent loss.
    const ready = frontier(dag, {
      pending,
      done,
      failed,
      running: [...liveFootprints.values()].flatMap((v) => v.paths),
    });
    // A ready unit that is not launched says why: a slot, or a file it shares with a running unit.
    for (const [id, why] of overlapWaits(dag, pending, ready, liveFootprints, done)) st.doing(id, why);
    for (const u of ready) {
      if (inflight.size >= concurrency) {
        st.doing(u.id, `waiting for a free slot (${concurrency} running)`);
        break;
      }
      st.doing(u.id, undefined);
      pending.delete(u.id);
      // On the record synchronously with the launch — later leaves a window the next frontier cannot see.
      liveFootprints.set(u.id, {
        tree: (u.role ?? "code") === "test" ? a.testerWt : a.worktree,
        paths: u.footprint,
      });
      // A crash inside one unit is that unit's failure, on the record — never the run's end.
      const p = a
        .runOne(u)
        .catch(async (err) => {
          const why = err instanceof Error ? (err.stack ?? err.message) : String(err);
          a.log(`⛔ ${u.id}: crashed — ${why.split("\n")[0]}`, u.id);
          a.defect({
            slice: u.slice,
            unit: u.id,
            activity: "unit execution",
            trigger: "crash",
            impact: "unit failed",
            detail: why.slice(0, 1500),
          });
          st.aborts.delete(u.id);
          liveFootprints.delete(u.id);
          if (u.role === "test") a.onTestUnitCrash();
          a.failWith(u.id, `crashed: ${why.split("\n")[0].slice(0, 200)}`);
          await a.finishUnit(u.id, u.slice, false);
        })
        .finally(() => inflight.delete(u.id));
      inflight.set(u.id, p);
    }
    if (inflight.size === 0) break;
    await Promise.race([...inflight.values()]);
  }
  await Promise.all([...inflight.values()]);
  // Never ran is not failed: a unit the run never reached says so, and the real failure stays findable.
  for (const id of pending) st.block(id, "never ran — the run stopped, or something it waits on failed");
}
