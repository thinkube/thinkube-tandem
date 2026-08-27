/**
 * The door: how a unit gets to change a file it was not cleared for.
 *
 * A unit is cleared, in advance, to create, change or delete a named set of
 * files. Work does not always fit the plan: a criterion turns out to need a
 * change somewhere nobody foresaw. Then the unit asks, a supervisor rules on
 * one question — does this criterion require that change — and if it does,
 * the unit is cleared and MAKES THE CHANGE NOW. A granted clearance is a
 * key, never a permit to file a request for later.
 *
 * The old rule refused a path that appeared in another unit's clearance and
 * moved the obligation to that unit instead. It cost a run: a promise about
 * a session's name was handed to a slice responsible for something else
 * entirely, and nobody kept it. Responsibility never moves. Only clearances
 * move, and the single legitimate reason to wait is that someone is
 * changing that file at this moment.
 *
 * Waiting cannot deadlock, by construction:
 *  - a unit commits its work before it waits, so it holds nothing while it
 *    is idle — the condition every deadlock needs is simply absent;
 *  - a wait that would close a cycle in the wait-for graph is never taken:
 *    it is recorded as a defect and the door opens at once;
 *  - a unit that finishes, fails or is halted releases its files.
 */
import { isTestPath } from "./testHomes";

/** What the plan says a unit will do to a file. The bare path list the
 *  guard and git use is a projection of these — never the source. */
export interface PlannedChange {
  action: "create" | "change" | "delete";
  path: string;
}

export interface ClearanceRuling {
  granted: string[];
  refused: { path: string; why: string }[];
  /** Paths whose door was held while another unit finished with them. */
  waited: string[];
}

export interface DoorArgs {
  units: readonly { id: string; footprint: string[] }[];
  /** Who is changing which files AT THIS MOMENT. A unit waiting at a door
   *  has committed its work and is changing nothing, so it never appears. */
  changingNow: () => ReadonlyMap<string, readonly string[]>;
  /** Commit the waiter's work, so it holds nothing while it waits. */
  commitBeforeWaiting: (unitId: string, why: string) => Promise<void>;
  halted: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (line: string, step?: string) => void;
  onRuling: (r: { criterionId: string; unit: string; granted: boolean; reason: string }) => void;
  defect: (e: { slice?: string; unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}

/** How often a waiting unit looks at the door again. */
const LOOK_AGAIN_MS = 2000;

export function makeClearance(a: DoorArgs): (
  slice: string,
  unitId: string,
  paths: string[],
) => Promise<ClearanceRuling> {
  // waiter → the unit it is waiting for. The whole wait-for graph of the run.
  const waitingFor = new Map<string, string>();
  const closesCycle = (waiter: string, holder: string): boolean => {
    for (let at: string | undefined = holder, guard = 0; at && guard < 64; at = waitingFor.get(at), guard++)
      if (at === waiter) return true;
    return false;
  };
  const holderOf = (path: string, self: string): string | undefined => {
    for (const [id, live] of a.changingNow()) if (id !== self && live.includes(path)) return id;
    return undefined;
  };
  return async (slice, unitId, paths) => {
    const me = a.units.find((u) => u.id === unitId);
    const granted: string[] = [];
    const waited: string[] = [];
    const refused: { path: string; why: string }[] = [];
    for (const p of paths) {
      if (!me) {
        refused.push({ path: p, why: "this unit is not in the plan" });
        continue;
      }
      if (isTestPath(p)) {
        refused.push({ path: p, why: "test-shaped — the checks are the test author's to write" });
        continue;
      }
      const holder = holderOf(p, unitId);
      if (holder && closesCycle(unitId, holder)) {
        // Cannot happen once a waiter commits and holds nothing; if it does,
        // it is a defect of this machinery, not of the work.
        a.defect({
          slice,
          unit: unitId,
          activity: "clearance",
          trigger: "door",
          type: "gate",
          impact: "wait refused to avoid a cycle",
          detail: `${unitId} would wait for ${holder}, which waits back around to ${unitId} — the door was opened instead of waiting`,
        });
        a.log(`⚠ ${unitId}: waiting for ${holder} would close a cycle — the door opens now instead`, unitId);
      } else if (holder) {
        a.log(`⏳ ${unitId}: ${p} is being changed by ${holder} right now — waiting at the door`, unitId);
        // The edge is recorded BEFORE the work of waiting begins: another
        // unit deciding at the same moment must see this wait, or two of
        // them can each start waiting for the other.
        waitingFor.set(unitId, holder);
        try {
          await a.commitBeforeWaiting(unitId, `waiting for ${p}`);
          while (!a.halted() && holderOf(p, unitId) === holder) await a.sleep(LOOK_AGAIN_MS);
        } finally {
          waitingFor.delete(unitId);
        }
        waited.push(p);
        a.log(`▸ ${unitId}: ${p} is free — going in`, unitId);
      }
      if (!me.footprint.includes(p)) me.footprint.push(p);
      granted.push(p);
    }
    if (granted.length) {
      a.log(`⚖ ${unitId}: cleared to change ${granted.join(", ")} at the supervisor's ruling`, unitId);
      a.onRuling({
        criterionId: "clearance",
        unit: slice,
        granted: true,
        reason:
          `cleared to change ${granted.join(", ")} — the criterion requires it` +
          (waited.length ? `; it waited at the door for ${waited.join(", ")}` : ""),
      });
    }
    for (const r of refused) a.log(`⚖ ${unitId}: not cleared for ${r.path} — ${r.why}`, unitId);
    return { granted, refused, waited };
  };
}

/** What the worker reads when the ruling comes back. A grant says GO. */
export function clearanceNote(r: ClearanceRuling): string | undefined {
  if (!r.granted.length && !r.refused.length) return undefined;
  const refused = r.refused.length
    ? ` Not cleared: ${r.refused.map((x) => `${x.path} (${x.why})`).join("; ")} — leave those alone and say what you could not keep.`
    : "";
  if (!r.granted.length) return `Your request was refused.${refused}`;
  return (
    `CLEARED at the supervisor's ruling: you may now change ${r.granted.join(", ")}` +
    (r.waited.length ? ` (the run waited until ${r.waited.join(", ")} was free)` : "") +
    `. Make the change NOW, in this session, before anything else — this clearance is not a note for later. Then run verify.${refused}`
  );
}

/**
 * The door's view of a run: who is changing what at this moment, and how a
 * unit puts its work down before it waits. A unit that is waiting is not in
 * the first answer — that is the whole of the deadlock argument.
 */
export function doorView(a: {
  live: () => ReadonlyMap<string, { tree: string; paths: string[] }>;
  waiting: () => Set<string>;
  tree: string;
  commitUnitWork: (unitId: string, why: string) => Promise<void>;
}): {
  changingNow: () => ReadonlyMap<string, readonly string[]>;
  commitBeforeWaiting: (unitId: string, why: string) => Promise<void>;
} {
  return {
    changingNow: () =>
      new Map(
        [...a.live().entries()]
          .filter(([id, v]) => v.tree === a.tree && !a.waiting().has(id))
          .map(([id, v]) => [id, v.paths] as const),
      ),
    commitBeforeWaiting: async (unitId, why) => {
      a.waiting().add(unitId);
      try {
        await a.commitUnitWork(unitId, why);
      } finally {
        a.waiting().delete(unitId);
      }
    },
  };
}
