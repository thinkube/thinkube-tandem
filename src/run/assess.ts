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
import { observationShaped } from "./observations";
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
  /** Grade only the assessments whose minted label this accepts. A repair
   *  loop re-grades its reds, not the whole panel: a verdict frozen at the
   *  gate's first pass once held three repaired promises red for an hour
   *  while the closer's edits could not move it. */
  only?: (label: string) => boolean;
}

/** The reviewer's word: the last line that starts with GREEN, RED or
 *  OBSERVE. A reviewer that narrates before it decides is still read; one
 *  that never decides is red. OBSERVE is for the one thing a reviewer over
 *  a tree can never judge: behaviour that exists only in the RUNNING
 *  product. That is not a red — it is the person's to certify, on the
 *  delivery they are certifying it WITH — and it is not a green, because
 *  nobody saw it. It rides the delivery's face by name. */
function verdictOf(reply: string | null | undefined): "GREEN" | "RED" | "OBSERVE" | undefined {
  if (!reply) return undefined;
  const lines = reply.split(/\r?\n/).map((l) => l.trim().replace(/^[*_`#>\-\s]+/, "").toUpperCase());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^GREEN\b/.test(lines[i])) return "GREEN";
    if (/^RED\b/.test(lines[i])) return "RED";
    if (/^OBSERVE\b/.test(lines[i])) return "OBSERVE";
  }
  return undefined;
}

export async function gradeAssessments(
  a: AssessArgs,
): Promise<{ proofs: Proof[]; observations: string[] }> {
  const byId = new Map(a.space.nodes.map((n) => [n.id, n]));
  const proofs: Proof[] = [];
  const observations: string[] = [];
  let ord = 0;
  for (const id of a.cut.changeIds) {
    const n = byId.get(id);
    if (!n) continue;
    for (const c of n.acceptance) {
      if (c.kind !== "assessment") continue;
      ord++;
      // The design rule decides before any reviewer is asked: an
      // observation was never a check (src/run/observations.ts). The
      // reviewer's OBSERVE verdict below stays for wordings the rule
      // misses — two layers, because each catches what the other cannot.
      const shaped = observationShaped(c.text);
      if (shaped) {
        observations.push(`${c.text} — ${shaped}`);
        a.log?.(`assessment ${ord}: an observation, by design — it rides the delivery for the person`);
        continue;
      }
      if (a.only && !a.only(`review-${ord}: ${c.text.slice(0, 60)}`)) continue;
      const ask = a.space.asks.find((x) => n.serves.includes(x.id));
      const deps: RoundDeps = {
        model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
        repoRoot: a.testerWt,
        ...(a.log ? { log: a.log } : {}),
      };
      // Where to look: the promise's own files and the checks that prove it
      // — a reviewer dropped blind into a whole tree spends its turns
      // finding them and never reaches a verdict.
      const where = (n.grounding?.touchpoints ?? []).map((t) => t.path);
      const proofs_ = n.acceptance.map((x) => x.proof?.path).filter((x): x is string => !!x);
      const reply = await (a.round ?? runReadRound)(
        { ...deps, maxTurns: 24 },
        [
          "You are an INDEPENDENT REVIEWER grading one assessment check on a",
          "delivered change. You never built this code. Read the repository",
          `you are in — it is at ${a.testerWt} and it contains the delivery.`,
          "Read ONLY under that path; any other copy of this repository on the",
          "machine is not the delivery. Judge honestly.",
          "",
          `THE ASK (the human's words): ${ask?.text ?? "(unavailable)"}`,
          `THE PROMISE: ${n.sentence}`,
          `THE CHECK TO GRADE: ${c.text}`,
          ...(where.length ? ["", `WHERE THE PROMISE LANDS (start here): ${where.join(", ")}`] : []),
          ...(proofs_.length ? [`WHAT ELSE PROVES IT: ${proofs_.join(", ")}`] : []),
          "",
          "You have a small number of tool uses. Read what the check names, then answer.",
          "Your LAST line must be exactly one of GREEN, RED or OBSERVE, then one",
          "plain-English sentence saying why. Nothing after it.",
          "OBSERVE is ONLY for a check that can be judged in the RUNNING product and",
          "nowhere else — a person must see it happen. Everything the tree can show",
          "you — code, wiring, tests that drive the real parts — you judge GREEN or",
          "RED yourself; OBSERVE is never a way to avoid reading.",
        ].join("\n"),
      );
      const verdict = verdictOf(reply);
      if (verdict === "OBSERVE") {
        observations.push(`${c.text} — ${(reply ?? "").split("\n").filter(Boolean).pop()?.replace(/^OBSERVE\S*\s*/i, "").slice(0, 200) ?? ""}`);
        a.log?.(`assessment ${ord}: OBSERVE — only the running product can show it; it rides the delivery for the person`);
        continue;
      }
      const green = verdict === "GREEN";
      if (!green) a.onRed?.(`review-${ord}`, (reply ?? "unreachable").slice(0, 300));
      proofs.push({
        kind: "assessment",
        criterionId: c.id,
        label: `review-${ord}: ${c.text.slice(0, 60)}`,
        verdict: green ? "green" : "red",
        ...(reply ? { ref: reply.slice(0, 300) } : { ref: "the reviewer could not be reached — graded red, never assumed" }),
      });
      a.log?.(`assessment ${ord}: ${green ? "GREEN" : "RED"}`);
    }
  }
  return { proofs, observations };
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
