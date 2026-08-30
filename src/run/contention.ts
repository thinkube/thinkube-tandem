/**
 * How wide a plan can actually run, and how long that makes it.
 *
 * Two units never write the same file at the same time — the frontier
 * refuses it, because two workers in one file is a silent loss. So every
 * unit whose footprint holds a given file runs strictly after the others
 * that hold it: one hot file serialises every unit that touches it,
 * however many workers the run is allowed.
 *
 * A run of forty-one units took three hours and fifty-five minutes and was
 * killed by its own bound with eight units never started. Nothing was
 * waiting for a worker — not once — and nothing was slow. Twenty-eight of
 * the forty-one units carried `src/surfaces/surfaceContract.ts`, so
 * twenty-eight units ran one after another, and no amount of concurrency
 * could have changed it. That was knowable from the plan, in a
 * millisecond, before the first worker started.
 */

/** A unit as the plan holds it: what it is called, and what it may write. */
interface Planned {
  id: string;
  footprint: readonly string[];
}

export interface Contention {
  /** The file in the most footprints, and how many hold it. */
  hottest?: { path: string; units: number };
  /** Every file at least two units must take turns over, worst first. */
  shared: { path: string; units: number }[];
  /** Units that must run one after another because of the hottest file. */
  serialised: number;
  /** All the units the plan holds. */
  total: number;
}

/** What the plan's footprints force to happen one at a time. */
export function contentionOf(units: readonly Planned[]): Contention {
  const holders = new Map<string, number>();
  for (const u of units)
    for (const f of new Set(u.footprint)) holders.set(f, (holders.get(f) ?? 0) + 1);
  const shared = [...holders]
    .filter(([, n]) => n > 1)
    .map(([path, units]) => ({ path, units }))
    .sort((a, b) => b.units - a.units || a.path.localeCompare(b.path));
  return {
    ...(shared[0] ? { hottest: shared[0] } : {}),
    shared,
    serialised: shared[0]?.units ?? (units.length ? 1 : 0),
    total: units.length,
  };
}

/**
 * What the plan's shape means for the clock, said before a worker starts.
 *
 * Undefined when nothing is worth saying. A sentence when the plan is
 * mostly serial: the person can re-cut it, or accept the wait knowing
 * why — either is better than learning it from a run that is killed at
 * its bound with a third of its units never started.
 */
export function contentionNote(c: Contention, minutesPerUnit = 5): string | undefined {
  if (!c.hottest || c.serialised < 3) return undefined;
  const share = c.serialised / c.total;
  const hours = (c.serialised * minutesPerUnit) / 60;
  const line =
    `${c.serialised} of ${c.total} units change ${c.hottest.path}, and two units never write one file ` +
    `at once — so those ${c.serialised} run one after another, however many workers this run is allowed. ` +
    `At ${minutesPerUnit} minutes each that is about ${hours.toFixed(1)} hours of the run's length, ` +
    `set by the plan rather than by the work.`;
  return share >= 0.5
    ? `${line} Most of this plan is a queue behind one file; cutting it smaller, or giving that file to one unit, is what makes it faster.`
    : line;
}
