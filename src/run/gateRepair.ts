/**
 * A red suite at the closing gate goes back into the run, not to the person.
 *
 * The delivered tree fails some of the repository's standing checks. Each
 * red test names files; those files, plus everything the delivery touched,
 * are the footprint of a finisher — a worker that brings the delivered tree
 * under the repository's own suite without weakening a check and without
 * changing what the promises mean. It is graded by the suite, up to a
 * budget. Only when the budget is spent is the delivery withheld, and then
 * the record names the tests that stayed red.
 */
import type { RunState } from "./state";
import type { DispatchDeps } from "./dispatch";
import { resolveWorkerModel } from "../engine/workerModel";
import { runUnitWorker, porcelainPaths } from "./worker";
import { suiteFootprint, suiteStanza, suiteVerdictOf } from "./suite";
import type { SuiteFailure, SuiteVerdict } from "./suite";
import type { Exec } from "./oracle";
import { shellLine } from "./execs";

/** Finishing rounds the gate may spend before it withholds. */
const GATE_REPAIR_BUDGET = 2;

export interface GateRepairArgs {
  tep: string;
  worktree: string;
  baseSha: string;
  deps: DispatchDeps;
  state: RunState;
  exec: Exec;
  /** Runs the suite command in a directory; bounded for a whole suite. */
  suiteExec: (cmd: string, cwd: string) => Promise<{ code: number | null; output: string }>;
  verdict: SuiteVerdict;
  log: (line: string, step?: string) => void;
  defect: (entry: { unit?: string; activity: string; trigger: string; type?: string; impact: string; detail: string }) => void;
}

/** The finisher's brief: the tree, the red tests in the runner's words, the rules. */
function gateRepairBrief(args: { tep: string; failures: readonly SuiteFailure[]; footprint: readonly string[]; digest?: string; attempt: number; budget: number }): string {
  const lines = [
    `You are the FINISHER of delivery ${args.tep} (round ${args.attempt} of ${args.budget}).`,
    "The work is done and every check the run wrote for it is green. The repository's OWN suite —",
    "its standing checks, older than this delivery — is red on the delivered tree. Bring the tree",
    "under those checks.",
    "",
    "RULES",
    "- Never weaken, skip, delete or restamp a standing check to make it pass. A check that pins an",
    "  old rule the delivery deliberately changes is brought under the NEW rule in its own scenario;",
    "  a check that finds a real break is answered by fixing the break.",
    "- Do not change what the delivery promises. You finish it; you do not redesign it.",
    "- Files you may edit are listed below. Everything else is frozen — if a check can only pass by",
    "  editing a frozen file, say so in your final words under UNDELIVERED: and stop.",
    "- Call the verify tool when you believe the suite is green; it runs the whole suite and tells",
    "  you what is still red. Do not claim green without it.",
    "",
    "THE RED TESTS, in the runner's own words:",
    ...args.failures.map((f) => `- ${f.name}${f.file ? ` (${f.file})` : ""}\n${f.detail.split("\n").map((d) => "    " + d.trim()).join("\n")}`),
    "",
    "FILES YOU MAY EDIT:",
    ...args.footprint.map((f) => `- ${f}`),
  ];
  if (args.digest) lines.push("", "THE REPOSITORY, READ FOR YOU:", args.digest.slice(0, 12000));
  lines.push("", "End your final words with a line `UNDELIVERED: none` or `UNDELIVERED: <what could not be brought under and why>`.");
  return lines.join("\n");
}

/**
 * Bring the delivered tree under the suite, up to the budget. Returns the
 * last verdict and how many rounds were spent; on green the tree is
 * committed as the finisher left it.
 */
export async function repairSuiteAtGate(a: GateRepairArgs): Promise<{ verdict: SuiteVerdict; rounds: number }> {
  const worker = a.deps.worker ?? runUnitWorker;
  const cmd = shellLine(a.deps.suiteCommand);
  const suite = async () => {
    const r = await a.suiteExec(cmd, a.worktree);
    return suiteVerdictOf(r.code, r.output, a.worktree);
  };
  let verdict = a.verdict;
  const delivered = (await a.exec("git", ["-C", a.worktree, "diff", "--name-only", "--diff-filter=d", `${a.baseSha}..HEAD`], a.worktree)).out
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  let rounds = 0;
  for (let attempt = 1; attempt <= GATE_REPAIR_BUDGET && !verdict.green && !a.state.halted; attempt++) {
    rounds = attempt;
    const id = `gate#suite-${attempt}`;
    const footprint = [...new Set([...suiteFootprint(verdict.failures, a.worktree), ...delivered])];
    a.state.seed(id, "gate", "maintain", [], "bring the delivered tree under the repository's own suite");
    a.state.set(id, "running");
    a.state.doing(id, `finishing — ${verdict.failures.length} standing check(s) red`);
    a.log(`🧰 ${a.tep}: the repository's suite is red on the delivered tree (${verdict.failures.map((f) => f.name).join("; ").slice(0, 400)}) — a finisher brings it under (round ${attempt}/${GATE_REPAIR_BUDGET})`, id);
    const brief = gateRepairBrief({ tep: a.tep, failures: verdict.failures, footprint, ...(a.deps.digest ? { digest: a.deps.digest } : {}), attempt, budget: GATE_REPAIR_BUDGET });
    const abort = new AbortController();
    a.state.aborts.set(id, abort);
    const outcome = await worker(
      {
        model: resolveWorkerModel(a.deps.workerModel ?? { workerModel: a.deps.model }, "code"),
        worktree: a.worktree,
        // The finisher owns test homes and production alike, like a maintainer.
        role: "test",
        footprint,
        baseline: new Set(await porcelainPaths(a.worktree)),
        abort,
        onPark: (_q, answer) => answer("Decide it yourself from the rules in your brief; the run does not ask a person."),
        log: (line: string) => a.log(line, id),
        verifyTool: async () => {
          a.state.doing(id, "waiting on the suite");
          try {
            verdict = await suite();
            return suiteStanza(verdict, new Map(verdict.failures.map((f) => [f, "code" as const])));
          } finally {
            a.state.doing(id, "finishing");
          }
        },
      },
      brief,
    );
    a.state.aborts.delete(id);
    // The suite decides, never the finisher's word.
    a.state.doing(id, "the suite decides");
    verdict = await suite();
    if (verdict.green) {
      a.log(`✓ ${a.tep}: the delivered tree is under the repository's suite`, id);
      a.state.set(id, "done");
      await a.exec("git", ["add", "-A", "."], a.worktree);
      await a.exec("git", ["commit", "-q", "-m", `tandem: ${a.tep} — brought under the repository's suite`], a.worktree);
      break;
    }
    a.state.fail(id, `the suite is still red: ${verdict.failures.map((f) => f.name).join("; ").slice(0, 300)}`);
    a.defect({
      unit: id,
      activity: "closing gate",
      trigger: "suite",
      type: "code",
      impact: "finishing round spent",
      detail: `${outcome.finalText.slice(0, 400)}\n${verdict.failures.map((f) => f.name).join("\n")}`.slice(0, 1200),
    });
  }
  return { verdict, rounds };
}
