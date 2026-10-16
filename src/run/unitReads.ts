/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How much a unit looked at the code, against how much it wrote, over every
 * round it ran.
 *
 * A unit that explores the same code its predecessor already explored pays
 * for it in time, and the run log is where that cost is seen: one line per
 * unit, at its end, with the Read/Glob/Grep tool uses and the Edit/Write
 * tool uses of all its rounds together.
 */
import type { RunWorkerDeps, WorkerOutcome } from "./worker";

type Worker = (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;

/** A worker that adds each round's tool uses to the unit's tally. */
export function tallied(worker: Worker): {
  worker: Worker;
  /** The line the unit's end writes to the log. */
  line: (unit: string, start: string) => string;
} {
  let reads = 0;
  let writes = 0;
  let rounds = 0;
  return {
    worker: async (deps, brief) => {
      const outcome = await worker(deps, brief);
      rounds++;
      reads += outcome.reads ?? 0;
      writes += outcome.writes ?? 0;
      return outcome;
    },
    line: (unit, start) =>
      `📖 ${unit}: ${reads} Read/Glob/Grep and ${writes} Edit/Write tool use(s) over ${rounds} round(s) — ${start}`,
  };
}
