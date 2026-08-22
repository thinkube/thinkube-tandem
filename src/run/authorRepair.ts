/**
 * A red criterion goes back to the author that wrote the code — as the next
 * message in its own session.
 *
 * The alternative, and what happened until now, is a fresh worker holding a
 * summary of somebody else's work. It has to reconstruct why the code is
 * shaped as it is before it can change anything, and what it reconstructs
 * is a guess: the intent lived in the first author's session and died with
 * it. Half the repairs of a bad week were that guess being wrong.
 *
 * The author still holds its own reasoning. Resumed, it is told exactly two
 * things — the drive's evidence, and what changed in the tree since it
 * stopped — and it is bound by the same three prohibitions it always had:
 * it may not touch the promise, it may not weaken a check, and it is judged
 * by execution.
 *
 * When there is no session to resume — an earlier run, a crash, a unit that
 * never started — this says so and the caller falls to the next rung. A
 * missing session is never a reason to skip the repair.
 */
import type { WorkerOutcome, RunWorkerDeps } from "./worker";

export interface RedCriterion {
  /** The unit that wrote the code this criterion is about. */
  unit: string;
  /** The criterion, in the person's words. */
  text: string;
  /** What the drive printed. */
  evidence: string;
  /** What the unit is cleared to change. */
  footprint: string[];
}

export interface AuthorRepairResult {
  unit: string;
  /** Whether an author was reached at all — not whether it succeeded. */
  resumed: boolean;
  why: string;
}

/** What the resumed author is told. Its own work is already in its context. */
export function repairMessage(a: {
  criterion: string;
  evidence: string;
  changedSince: readonly string[];
}): string {
  return [
    "THE GATE RAN YOUR WORK AGAINST THE WHOLE TREE, AND THIS PROMISE IS NOT KEPT.",
    "",
    "You are the same session that wrote this code — everything you decided is still yours.",
    "Continue it. Do not restate the design; change what is wrong.",
    "",
    `THE PROMISE: ${a.criterion}`,
    "",
    "WHAT THE DRIVE PRINTED:",
    a.evidence.slice(0, 4000),
    "",
    a.changedSince.length
      ? `WHAT CHANGED IN THE TREE SINCE YOU STOPPED (other units landed their work):\n${a.changedSince
          .slice(0, 40)
          .map((f) => `- ${f}`)
          .join("\n")}`
      : "NOTHING ELSE CHANGED IN THE TREE SINCE YOU STOPPED.",
    "",
    "THE RULES ARE UNCHANGED:",
    "- the promise is fixed — you may not reinterpret it;",
    "- the checks are not yours to weaken; if one misreads its criterion, say so and why;",
    "- green is decided by running your code, not by your account of it.",
    "",
    "End with UNDELIVERED: none, or one line per thing you could not do.",
  ].join("\n");
}

/**
 * Send each red criterion back to its own author. Returns one line per
 * attempt, for the delivery and the ledger — including the ones where no
 * session survived, because a silent skip is the thing this replaces.
 */
export async function repairByAuthors(a: {
  reds: readonly RedCriterion[];
  /** The session each unit was worked in, when the run still has it. */
  sessionOf: (unit: string) => string | undefined;
  changedSince: readonly string[];
  worktree: string;
  model: string;
  worker: (deps: RunWorkerDeps, brief: string) => Promise<WorkerOutcome>;
  log: (line: string) => void;
  defect: (e: {
    unit?: string;
    activity: string;
    trigger: string;
    type?: string;
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void;
}): Promise<AuthorRepairResult[]> {
  const out: AuthorRepairResult[] = [];
  for (const red of a.reds) {
    const session = a.sessionOf(red.unit);
    if (!session) {
      a.log(`↩ ${red.unit}: its session is gone — the repair falls to the next rung`);
      out.push({ unit: red.unit, resumed: false, why: "no session to resume" });
      continue;
    }
    a.log(`↩ ${red.unit}: the gate's evidence goes back to the author that wrote it`);
    const outcome = await a.worker(
      {
        model: a.model,
        worktree: a.worktree,
        role: "code",
        blind: true,
        footprint: red.footprint,
        baseline: new Set<string>(),
        abort: new AbortController(),
        onPark: (_q, answer) => answer("continue with what you have"),
        log: (line) => a.log(line),
        resume: session,
      },
      repairMessage({ criterion: red.text, evidence: red.evidence, changedSince: a.changedSince }),
    );
    a.defect({
      unit: red.unit,
      activity: "gate repair",
      trigger: "author-resume",
      type: "code",
      stage: "author",
      impact: outcome.ok ? "the author repaired its own work" : "the author could not repair it",
      detail: `${red.text} — ${outcome.finalText.slice(0, 300)}`,
    });
    out.push({
      unit: red.unit,
      resumed: true,
      why: outcome.ok ? "the author says it is repaired" : (outcome.undelivered ?? ["it could not"]).join("; "),
    });
  }
  return out;
}
