/**
 * How a run ended, kept where the ledger is kept.
 *
 * A defect row is written the moment something is found and never touched
 * again, so the ledger says what surfaced and not what became of it: three
 * quarters of its rows are silent about whether the thing was repaired
 * before the person ever saw it. That silence hides the number the
 * methodology most needs — not how many defects there were, but how many
 * the machine healed by itself.
 *
 * The run already knows. What it did not do was write the answer anywhere
 * that outlives the space: run records live inside a space and die with
 * it, while the ledger deliberately does not. So the outcome is written
 * beside the ledger, keyed by the same run id the rows already carry, and
 * a row can be asked what happened to it long after its space is gone.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ledgerRoot } from "./defectLog";

/** How one run ended, and how each of its slices ended with it. */
export interface RunOutcome {
  run: string;
  cutId: string;
  tepId?: string;
  space?: string;
  at: string;
  state: "running" | "refused" | "withheld" | "delivered" | "halted";
  /** Each slice's final state, by its handle. */
  slices: Record<string, string>;
}

/** Where a run's outcome is kept: beside the ledger, never inside a space. */
function outcomePath(storeDir: string, run: string): string {
  return path.join(ledgerRoot(storeDir).root, "defects", "outcomes", `${run.replace(/[^\w.@-]/g, "_")}.json`);
}

/** Write it down. Fails soft: a run must never break on its own bookkeeping. */
export function saveRunOutcome(storeDir: string, outcome: RunOutcome): boolean {
  try {
    const file = outcomePath(storeDir, outcome.run);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(outcome, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

/** What became of one run, or nothing if it was never written down. */
export function readRunOutcome(storeDir: string, run: string): RunOutcome | undefined {
  try {
    return JSON.parse(fs.readFileSync(outcomePath(storeDir, run), "utf8")) as RunOutcome;
  } catch {
    return undefined;
  }
}

/** The impacts that already say the thing was repaired where it was found. */
const SAYS_HEALED = new Set([
  "closed what no other actor could",
  "answered — not a gap",
  "flowed as contract — not a gap, not a failure",
  "check re-authored from its criterion",
  "the author repaired its own work",
  "check re-authored",
  "answered from the run's own knowledge — the brief lacked it",
  "conflict resolved before dispatch",
  "half-committed change completed before dispatch",
  "clearance ruled",
  "check re-authored after diagnosis",
  "the tool was wrong and was repaired",
]);

/** The impacts that already say nobody could repair it. */
const SAYS_FAILED = new Set([
  "the author could not repair it",
  "the closer could not finish it either",
  "re-author failed — the check stands",
  "finishing round spent",
  "delivery withheld",
  "unit undelivered",
  "run refused",
  "unit failed; writes reverted",
  "the run cannot judge this cut",
]);

/** What became of a defect: repaired inside the run, or carried out of it. */
export type Fate = "healed" | "reached the person" | "unknown";

/** What a fate is decided from — the little of a row that matters here,
 *  so every reader of the ledger can ask, whatever shape it reads into. */
export interface Askable {
  impact?: string;
  slice?: string;
  run?: string;
}

/**
 * What became of one row.
 *
 * The row's own words come first — an impact that already says it was
 * repaired needs no join. Otherwise the run it belongs to answers: a slice
 * that ended done healed what was found in it, and a run that delivered
 * healed what its slices carried. A run nobody wrote down stays unknown,
 * which is the honest answer rather than a flattering one.
 */
export function fateOf(row: Askable, outcome?: RunOutcome): Fate {
  if (row.impact && SAYS_HEALED.has(row.impact)) return "healed";
  if (row.impact && SAYS_FAILED.has(row.impact)) return "reached the person";
  if (!outcome || outcome.state === "running") return "unknown";
  // A refused run never built anything, so nothing in it was repaired.
  if (outcome.state === "refused" || outcome.state === "halted") return "reached the person";
  const slice = row.slice ? outcome.slices[row.slice] : undefined;
  if (slice) return slice === "done" ? "healed" : "reached the person";
  // No slice to ask: the run's own ending is the answer.
  return outcome.state === "delivered" ? "healed" : "reached the person";
}

/** How a run's slices ended, in the shape an outcome keeps them. */
export function slicesOf(units: readonly { slice: string; state: string }[]): Record<string, string> {
  const by = new Map<string, string[]>();
  for (const u of units) by.set(u.slice, [...(by.get(u.slice) ?? []), u.state]);
  const out: Record<string, string> = {};
  // A slice is done when every unit of it is: one unfinished worker leaves
  // the slice unfinished, whatever the others managed.
  for (const [slice, states] of by) out[slice] = states.every((s) => s === "done") ? "done" : "not done";
  return out;
}

/** The ledger, read with what became of every row. */
export function fates(storeDir: string, rows: readonly Askable[]): Record<Fate, number> {
  const seen = new Map<string, RunOutcome | undefined>();
  const tally: Record<Fate, number> = { healed: 0, "reached the person": 0, unknown: 0 };
  for (const row of rows) {
    const run = row.run;
    if (run && !seen.has(run)) seen.set(run, readRunOutcome(storeDir, run));
    tally[fateOf(row, run ? seen.get(run) : undefined)]++;
  }
  return tally;
}
