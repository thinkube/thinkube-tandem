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
import { RunState } from "./state";
import type { RunUnitView } from "./state";

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
  /**
   * The run's SITUATION, written down like its content.
   *
   * A run used to keep this in the driving process's memory: whether it
   * was in flight, who was driving, and what it had to say. Everything
   * else — the units, the logs — was on disk, so a second surface could
   * read what a run contained and never learn whether it was happening.
   * A run started outside the editor showed as nothing there; a refusal
   * reached the defect ledger and no eye; a stop was a method call one
   * process could not deliver to another.
   *
   * The owner's pid makes "is it running" answerable by anyone, the same
   * way a stale execution lock is: a record that says running whose
   * process is gone is a run that ended without saying so.
   */
  owner?: { pid: number; at: string };
  /** Where the run got to, in one word. Absent on records written before
   *  a run wrote its situation down. */
  state?: "running" | "refused" | "withheld" | "delivered" | "halted";
  /** What the run has to say about that — the refusal's own words, the
   *  withholding's reason, or nothing while it is simply running. */
  note?: string;
  /** A stop asked for by someone who is not driving. The owner reads it
   *  and ends itself; nobody else may end another process's run. */
  stopRequestedAt?: string;
  units: RunUnitView[];
  /** What was dispatched, as the door saw it. */
  plan?: PlanRecord[];
  logs: string[];
  stepLogs: Record<string, string[]>;
  /** Per-slice acceptance-criteria outcomes — the audit card's account,
   *  carried so a reopened window reads the same verdicts the live run had. */
  sliceChecks?: Record<string, { ac: number; pass: boolean; text?: string }[]>;
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
      ...(state.sliceChecks.size
        ? { sliceChecks: Object.fromEntries([...state.sliceChecks].map(([k, v]) => [k, [...v]])) }
        : {}),
    };
    fs.writeFileSync(path.join(dir, `${record.cutId}.json`), JSON.stringify(full, null, 2));
  } catch {
    /* the run's verdicts already live on the delivery */
  }
}

/** The last run this space ran, or nothing if it has never run one. */
function loadLastRun(storeDir: string): RunRecord | undefined {
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

/**
 * Whether a written run is still happening, judged the way a stale
 * execution lock is judged: it says it is running, and the process that
 * said so is still alive.
 *
 * A driver that crashed, or a window that closed mid-run, leaves a record
 * claiming to be in flight with nobody behind it. Believing that record
 * forever is how a space becomes unusable with no way to say why.
 */
export function runIsLive(
  r: RunRecord | undefined,
  alive: (pid: number) => boolean = livePid,
): boolean {
  if (!r || r.state !== "running") return false;
  if (!r.owner) return false;
  return alive(r.owner.pid);
}

/** Is this pid a live process on this machine? A ZOMBIE is not: a killed
 *  driver lingers defunct until something reaps it, and it answers the
 *  signal-0 probe — which held a space at "a run is already in flight"
 *  with nothing running and no way to start one. */
function livePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 2).trim()[0];
    return state !== "Z" && state !== "X";
  } catch {
    // No /proc (not Linux): the signal probe is the best answer there is.
    return true;
  }
}

/** The whole of what a session needs to show a run it did not start:
 *  the state to render, whether it is happening, and what it said. */
export function readRun(
  storeDir: string,
  onChanged: () => void,
): { state: RunState; running: boolean; note?: string } | undefined {
  const last = loadLastRun(storeDir);
  if (!last) return undefined;
  const seen = runSituation(last);
  return { state: RunState.from(last, onChanged), ...seen };
}

/** What a surface should say about a run it is only watching. */
export function runSituation(
  r: RunRecord | undefined,
  alive: (pid: number) => boolean = livePid,
): { running: boolean; note?: string } {
  if (!r) return { running: false };
  if (runIsLive(r, alive)) return { running: true, ...(r.note ? { note: r.note } : {}) };
  if (r.state === "running")
    return {
      running: false,
      note: `The run that was driving this stopped without saying how it ended (its process is gone). Run it again when you are ready.`,
    };
  return { running: false, ...(r.note ? { note: r.note } : {}) };
}

/** Ask a run to stop, from a process that is not driving it. The owner
 *  reads the request and ends itself — nobody kills another's run. */
export function requestStop(storeDir: string, cutId: string, at: string): boolean {
  try {
    const file = path.join(dirFor(storeDir), `${cutId}.json`);
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord;
    fs.writeFileSync(file, JSON.stringify({ ...r, stopRequestedAt: at }, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Has a stop been asked for since this run began? */
export function stopWasRequested(storeDir: string, cutId: string, since: string): boolean {
  try {
    const r = JSON.parse(
      fs.readFileSync(path.join(dirFor(storeDir), `${cutId}.json`), "utf8"),
    ) as RunRecord;
    return !!r.stopRequestedAt && r.stopRequestedAt > since;
  } catch {
    return false;
  }
}
