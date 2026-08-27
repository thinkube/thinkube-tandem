/**
 * What the run was, kept on disk.
 *
 * A run's workers, their order and what each one proved lived only in the
 * memory of the process that ran them, while the delivery they produced
 * was written to the space. Reopening the window therefore left a report
 * with nothing behind it: a page saying nothing has been orchestrated
 * beside a delivery that plainly was. The orchestration page reads the
 * same history everything else does.
 *
 * Logs are kept to a tail per step. The whole point of the page is to be
 * openable long after the run, so what it holds has to stay bounded.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { RunState, RunUnitView } from "./state";

/** How much of each step's log survives the run that wrote it. */
const KEPT_LINES = 400;

/**
 * The plan the door judged, in the only shape the door reads.
 *
 * A run's account said what the workers did and never what they were
 * given, so a fault the door should have caught could only be found by
 * running the whole thing again — an hour, to learn one fact. Kept here,
 * every plan the machine has ever dispatched becomes a case the door can
 * be re-judged against in milliseconds, and a rule that would have
 * refused an old plan says so the moment it is written.
 */
export interface PlanRecord {
  handle: string;
  criterionIds?: string[];
  units: { role?: string; footprint: string[]; consumes?: string[] }[];
}

export interface RunRecord {
  cutId: string;
  tepId?: string;
  /** When the run finished — the newest record is the one shown. */
  at: string;
  units: RunUnitView[];
  /** What was dispatched, as the door saw it. */
  plan?: PlanRecord[];
  logs: string[];
  stepLogs: Record<string, string[]>;
}

/** The plan as the record keeps it — footprints and order, nothing else. */
export function planRecordOf(
  slices: readonly { handle: string; criterionIds?: string[]; workUnits?: { role?: string; footprint: string[]; consumes?: string[] }[] }[],
): PlanRecord[] {
  return slices.map((s) => ({
    handle: s.handle,
    ...(s.criterionIds?.length ? { criterionIds: [...s.criterionIds] } : {}),
    units: (s.workUnits ?? []).map((u) => ({
      ...(u.role ? { role: u.role } : {}),
      footprint: [...u.footprint],
      ...(u.consumes?.length ? { consumes: [...u.consumes] } : {}),
    })),
  }));
}

const dirFor = (storeDir: string): string => path.join(storeDir, "runs");

/**
 * Write what this run IS, as it happens.
 *
 * Not only when it is over: a record kept until the end is a record
 * nobody can read while they need it. The surface holds the only other
 * copy, so a window that closes — or crashes — takes the whole account
 * with it, and nothing outside that window can say what a worker is
 * doing or why one failed.
 *
 * Best effort: the delivery carries the verdicts, so a failed write
 * loses the account of the run, never its result.
 */
export function saveRun(
  storeDir: string,
  record: Omit<RunRecord, "units" | "logs" | "stepLogs">,
  state: RunState,
): void {
  try {
    const dir = dirFor(storeDir);
    fs.mkdirSync(dir, { recursive: true });
    const full: RunRecord = {
      ...record,
      units: [...state.units.values()],
      ...(state.plan?.length ? { plan: state.plan } : {}),
      logs: state.logs.slice(-KEPT_LINES),
      stepLogs: Object.fromEntries(
        [...state.stepLogs].map(([k, v]) => [k, v.slice(-KEPT_LINES)]),
      ),
    };
    fs.writeFileSync(path.join(dir, `${record.cutId}.json`), JSON.stringify(full, null, 2));
  } catch {
    /* the run's verdicts already live on the delivery */
  }
}

/** The last run this space ran, or nothing if it has never run one. */
export function loadLastRun(storeDir: string): RunRecord | undefined {
  try {
    const dir = dirFor(storeDir);
    const records = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunRecord;
        } catch {
          return undefined;
        }
      })
      .filter((r): r is RunRecord => !!r?.units);
    if (!records.length) return undefined;
    return records.sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  } catch {
    return undefined;
  }
}
