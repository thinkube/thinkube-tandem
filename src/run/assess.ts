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
  /** The reviewer never reached a verdict — the machine could not judge,
   *  which is its own failure and never the work's. */
  ungraded?: (label: string, criterion: string) => void;
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
/**
 * How much reading a reviewer does between check-ins.
 *
 * Not a budget it is expected to bump into: it is how far it goes before
 * the machine looks in and asks whether it has an answer yet. A reviewer
 * that is still reading is asked to carry on, however many times that
 * takes. What ends the reading is that another round adds nothing —
 * convergence, the same rule the closer stops on — never a count.
 */
const TURNS_PER_READ = 60;
/**
 * The backstop, and only that: a reviewer that keeps producing new text
 * and never answers is not converging on anything. High enough that no
 * honest reading reaches it.
 */
const RUNAWAY = 12;

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
      const askReviewer = (turns: number, more?: string): Promise<string | null> =>
        (a.round ?? runReadRound)(
        { ...deps, maxTurns: turns },
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
          ...(more ? ["", more] : []),
        ].join("\n"),
      );
      /**
       * Read until it has an answer, not until a counter runs out.
       *
       * The reviewer was given a flat budget of tool uses. One spent its
       * budget reading and was cut off mid-sentence; the round returned an
       * error, and an error was recorded as RED. That withheld a delivery
       * of twenty-four promises for a criterion the closer then checked by
       * hand and found kept. A count is not a verdict.
       *
       * So it is asked again while it is still getting somewhere, and it
       * stops when another reading buys nothing — the same rule the closer
       * already runs on. Only the reviewer's own word is ever a verdict.
       */
      let reply = await askReviewer(TURNS_PER_READ);
      let verdict = verdictOf(reply);
      let last = reply ?? "";
      for (let more = 0; !verdict && more < RUNAWAY; more++) {
        a.log?.(`assessment ${ord}: still reading, no answer yet — asking it to carry on`);
        const again = await askReviewer(
          TURNS_PER_READ,
          "You have not answered yet. What you have read already stands. Read only what you " +
            "still need, then give your last line: GREEN, RED or OBSERVE, and one sentence.",
        );
        // It stops when another reading buys nothing — the same text back,
        // or nothing at all. Never because a counter ran out.
        if (!again || again === last) break;
        last = again;
        reply = again;
        verdict = verdictOf(reply);
      }
      if (verdict === "OBSERVE") {
        observations.push(`${c.text} — ${(reply ?? "").split("\n").filter(Boolean).pop()?.replace(/^OBSERVE\S*\s*/i, "").slice(0, 200) ?? ""}`);
        a.log?.(`assessment ${ord}: OBSERVE — only the running product can show it; it rides the delivery for the person`);
        continue;
      }
      // No verdict after re-reading is the MACHINE failing to judge, not
      // the work failing. It rides the delivery for the person to settle,
      // named — never a red the work cannot answer.
      if (!verdict) {
        observations.push(`${c.text} — the machine could not grade this: the reviewer never reached a verdict. Judge it yourself.`);
        a.log?.(`assessment ${ord}: the reviewer never reached a verdict — it rides the delivery for the person, not counted against the work`);
        a.ungraded?.(`review-${ord}`, c.text);
        continue;
      }
      const green = verdict === "GREEN";
      if (!green) a.onRed?.(`review-${ord}`, (reply ?? "").slice(0, 300));
      proofs.push({
        kind: "assessment",
        criterionId: c.id,
        label: `review-${ord}: ${c.text.slice(0, 60)}`,
        verdict: green ? "green" : "red",
        ...(reply ? { ref: reply.slice(0, 300) } : {}),
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
  /** The run was stopped — by the person, or by its own bound. Nothing
   *  that was in flight is evidence about the work, and one row per
   *  interrupted check made a single stop look like dozens of defects. */
  halted = false,
): void {
  if (halted) return;
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

/**
 * A criterion nothing could judge reaches the person as a proposal.
 *
 * Not "your code failed" — nothing was judged. No assessor could be
 * dispatched, one threw, the runner was missing. The only thing that
 * settles such a criterion is a change to what was asked, so it is said in
 * the criterion's own words, to the one person who can change it.
 */
export function proposeRewording(
  tep: string,
  proofs: readonly { verdict: string; label: string; ref?: string }[],
  log: (line: string) => void,
  defect: (e: {
    activity: string;
    trigger: string;
    type?: string;
    stage?: "author" | "brief" | "check" | "clearance" | "altitude";
    impact: string;
    detail: string;
  }) => void,
): void {
  for (const p of proofs.filter((x) => x.verdict === "unjudged")) {
    log(
      `✎ ${tep}: "${p.label}" could not be judged — ${(p.ref ?? "nothing settled it").slice(0, 150)}. ` +
        `Reword it as something you certify by looking, or as a claim a check can run.`,
    );
    defect({
      activity: "closing gate",
      trigger: "unjudgeable-criterion",
      type: "contract",
      stage: "brief",
      impact: "the ask needs rewording",
      detail: `${p.label} — ${(p.ref ?? "").slice(0, 300)}`,
    });
  }
}

/**
 * The cut's criteria that are settled elsewhere, as pending proofs.
 *
 * Each names its settling source — the pipeline the merge fires, the
 * component's 18_test.yaml, a person's attestation — and rides the
 * delivery as pending. Harvested after the merge; never an unkept
 * promise, because the machine deciding here would be deciding about a
 * place it cannot see.
 */
export function stagedProofs(space: Space, cut: Cut): Proof[] {
  const byId = new Map(space.nodes.map((n) => [n.id, n]));
  const out: Proof[] = [];
  for (const id of cut.changeIds) {
    const n = byId.get(id);
    if (!n) continue;
    for (const c of n.acceptance)
      if (c.settledBy)
        out.push({
          kind: "staged",
          label: c.text,
          verdict: "pending",
          settledBy: c.settledBy,
          criterionId: c.id,
        });
  }
  return out;
}
