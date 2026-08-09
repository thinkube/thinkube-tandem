/**
 * Which units may start right now — the engine's answer, not a second one.
 *
 * This product used to filter the DAG itself, and its filter had no
 * footprint clause: two units writing the same file could be dispatched
 * into the same worktree at the same moment, and the loser's work vanished
 * with no error. The only thing standing between that and a corrupted run
 * was that changes sharing a file were merged into one unit beforehand —
 * which is exactly what produced a single worker carrying 71 promises.
 *
 * The engine already had the right answer: deps done, footprint disjoint
 * from everything running, and the longest dependency chain first. It was
 * written, tested and never called. This is the wiring, plus the one thing
 * the engine has no notion of — a unit waiting on work that failed.
 */
import { readyFrontier, SchedUnit } from "../engine/core/dag";

export function frontier(
  dag: SchedUnit[],
  state: {
    /** Units not yet dispatched. */
    pending: Set<string>;
    /** Unit ids that have landed. */
    done: Set<string>;
    /** Unit ids that failed — anything waiting on one can never run. */
    failed: Set<string>;
    /** Files held by units running right now. */
    running: string[];
  },
): SchedUnit[] {
  return readyFrontier(
    dag.filter((u) => state.pending.has(u.id)),
    {
      done: state.done,
      running: new Set(state.running),
      blocked: new Set(
        dag.filter((u) => u.requires.some((r) => state.failed.has(r))).map((u) => u.id),
      ),
    },
  );
}
