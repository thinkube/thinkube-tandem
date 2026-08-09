/**
 * Grading assessment checks at the closing gate: a FRESH judge-tier
 * round — never the builder — reads the delivered code in the tester's
 * snapshot and grades each assessment check against the promise and the
 * ask's own words. Verdict GREEN/RED with a one-line reason; fail-soft
 * RED ("could not be graded") so an unreachable assessor never fakes a
 * pass.
 */
import { Proof, Space, Cut } from "../core/schema";
import { RoundDeps, runReadRound } from "../derive/round";
import { resolveWorkerModel, WorkerModelConfig } from "../engine/workerModel";

export interface AssessArgs {
  space: Space;
  cut: Cut;
  /** The tester snapshot worktree — independent of the builders. */
  testerWt: string;
  model: string;
  workerModel?: WorkerModelConfig;
  log?: (l: string) => void;
  round?: typeof runReadRound;
  onRed?: (label: string, ref: string) => void;
}

export async function gradeAssessments(a: AssessArgs): Promise<Proof[]> {
  const byId = new Map(a.space.nodes.map((n) => [n.id, n]));
  const proofs: Proof[] = [];
  let ord = 0;
  for (const id of a.cut.changeIds) {
    const n = byId.get(id);
    if (!n) continue;
    for (const c of n.acceptance) {
      if (c.kind !== "assessment") continue;
      ord++;
      const ask = a.space.asks.find((x) => n.serves.includes(x.id));
      const deps: RoundDeps = {
        model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
        repoRoot: a.testerWt,
        ...(a.log ? { log: a.log } : {}),
      };
      const reply = await (a.round ?? runReadRound)(
        { ...deps, maxTurns: 12 },
        [
          "You are an INDEPENDENT REVIEWER grading one assessment check on a",
          "delivered change. You never built this code. Read the repository",
          "you are in (it contains the delivery) and judge honestly.",
          "",
          `THE ASK (the human's words): ${ask?.text ?? "(unavailable)"}`,
          `THE PROMISE: ${n.sentence}`,
          `THE CHECK TO GRADE: ${c.text}`,
          "",
          "First line of your answer must be exactly GREEN or RED, then one",
          "plain-English sentence saying why.",
        ].join("\n"),
      );
      const green = reply?.trimStart().toUpperCase().startsWith("GREEN") ?? false;
      if (!green) a.onRed?.(`review-${ord}`, (reply ?? "unreachable").slice(0, 300));
      proofs.push({
        kind: "assessment",
        label: `review-${ord}: ${c.text.slice(0, 60)}`,
        verdict: green ? "green" : "red",
        ...(reply ? { ref: reply.slice(0, 300) } : { ref: "the reviewer could not be reached — graded red, never assumed" }),
      });
      a.log?.(`assessment ${ord}: ${green ? "GREEN" : "RED"}`);
    }
  }
  return proofs;
}

/** One journal line per red runnable check; infra exits stay their own class. */
export function logRedChecks(
  results: readonly {
    ac: number;
    pass: boolean;
    /** The gate's own verdict: the runner could not run at all (exit
     *  126/127), so the red says nothing about the code. */
    unrunnable?: boolean;
    evidence?: string;
  }[],
  defect: (e: { activity: string; trigger: string; type?: string; impact: string; detail: string }) => void,
): void {
  for (const r of results)
    if (!r.pass) {
      // The gate already decides this and puts it on the result. Deriving
      // it again from a `code` field the result does not carry made the
      // test always false, so every tooling failure was journalled as a
      // code defect and the ledger blamed the coder for a broken runner.
      const infra = r.unrunnable === true;
      defect({
        activity: "closing gate",
        trigger: infra ? "gate-infra" : "gate-ac",
        type: infra ? "gate" : "code",
        impact: infra ? "verification unavailable" : "acceptance check red",
        detail: infra
          ? `AC-${r.ac} runner exited 126/127 — a gate defect, not a code verdict`
          : `AC-${r.ac} failed${r.evidence ? ` — ${r.evidence.slice(0, 300)}` : ""}`,
      });
    }
}
