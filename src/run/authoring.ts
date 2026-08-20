/**
 * A check leaves its author only when it can stand.
 *
 * Two things happen after a tester's session ends, before anyone is graded
 * by what it wrote: every probe it declared must exist (a session that ran
 * out of room is continued, never discarded), and every probe must pass the
 * machine's own audit — imports that resolve in shape, no simulator of a
 * system this repository does not own (THE-LADDER §6). A fault the machine
 * can see costs one authoring round here; the same fault discovered in a
 * coder's runner costs the run.
 */
import type { WorkerOutcome } from "./worker";
import { auditProbes, faultsBrief } from "./probeAudit";
import { continuationBrief, isProbePath, missingProbes, testerTurns } from "./testHomes";

/** Continuations a tester that stopped short may spend. */
const CONTINUATIONS = 3;
/** Rounds to mend checks the audit refused — one look, one fix. */
const AUDIT_FIXES = 2;

export async function finishAuthoring(a: {
  outcome: WorkerOutcome;
  tree: string;
  footprint: string[];
  unit: string;
  /** A maintain unit writes test homes, not declared probes: no continuation. */
  maintain: boolean;
  brief: string;
  emitMap: readonly string[];
  /** Where the run's still-unwritten work will land — a check may import it. */
  planned: readonly string[];
  halted: () => boolean;
  say: (text: string | undefined) => void;
  log: (line: string) => void;
  defect: (detail: string) => void;
  runWorker: (brief: string, maxTurns: number) => Promise<WorkerOutcome>;
}): Promise<WorkerOutcome> {
  let outcome = a.outcome;
  for (let more = 0; !a.maintain && !outcome.containment && more < CONTINUATIONS && !a.halted(); more++) {
    const missing = await missingProbes(a.tree, a.footprint);
    if (!missing.length) break;
    a.log(`↪ ${a.unit}: ${missing.length} declared probe(s) still unwritten — continuing (${more + 1}/${CONTINUATIONS})`);
    a.say(`continuing — ${missing.length} probe(s) left to write`);
    outcome = await a.runWorker(continuationBrief(a.brief, a.footprint, missing), testerTurns(missing.length));
  }
  for (let fix = 0; !outcome.containment && fix < AUDIT_FIXES && !a.halted(); fix++) {
    const faults = auditProbes(a.tree, a.footprint.filter(isProbePath), a.planned);
    if (!faults.length) break;
    a.log(
      `⌦ ${a.unit}: ${faults.length} check(s) cannot stand as written — ` +
        (faults[0].kind === "simulator"
          ? "a simulator of a platform this repository does not own"
          : "an import naming a directory that does not exist"),
    );
    a.defect(faults.map((f) => `${f.probe}: ${f.detail}`).join("\n").slice(0, 1200));
    a.say(`mending ${faults.length} check(s) the machine refused`);
    outcome = await a.runWorker(`${a.brief}\n\n${faultsBrief(faults, a.emitMap)}`, testerTurns(faults.length));
  }
  return outcome;
}
