/**
 * Everything the run needs to answer one question honestly: is waiting
 * worth it?
 *
 * Two facts decide it, and they live in different places — the dependency
 * graph, and the files each running unit holds. Reading only the first is
 * how a run waited for units nothing could launch. Here they are read
 * together, once, so no caller can forget the second.
 */
import { whoCanLand } from "./frontier";
import { doorView } from "./clearance";

export function runWaits(a: {
  dag: readonly { id: string; slice: string; requires: string[]; footprint: string[] }[];
  done: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  waiting: () => Set<string>;
  live: () => ReadonlyMap<string, { tree: string; paths: string[] }>;
  tree: string;
  commitUnitWork: (unitId: string, why: string) => Promise<void>;
}): {
  /** Units of other slices that can still land something for this one. The
   *  asker counts as asleep: it is deciding whether to sleep, and a unit
   *  that joins the waiting set only AFTER the question never blocks
   *  anyone — which is how a run waited on units nothing could launch. */
  wakers: (slice: string, self: string) => string[];
  door: ReturnType<typeof doorView>;
} {
  return {
    wakers: (slice, self) =>
      whoCanLand(a.dag, slice, {
        done: a.done,
        failed: a.failed,
        waiting: new Set([...a.waiting(), self]),
        live: new Map([...a.live()].map(([id, v]) => [id, v.paths] as const)),
      }),
    door: doorView({ live: a.live, waiting: a.waiting, tree: a.tree, commitUnitWork: a.commitUnitWork }),
  };
}
