/**
 * A promise that does not hold on the running product is repaired here.
 *
 * The closing gate is over by the time the product answers, so a red
 * found on the page is answered by this loop instead: repair bounded to
 * the files the promise lands in, with the reviewer's own words as the
 * evidence; the repository's build proved here; a push; a wait for the
 * platform; and the reviewers asked again about exactly those promises.
 * Two attempts, then it stops and says what still does not hold.
 */
import { Change, Cut, Space } from "../core/schema";
import { DispatchOutcome, RunState } from "./state";

const ATTEMPTS_ON_THE_PRODUCT = 2;

export interface OnTheProductRepair {
  /** The promises that did not hold, by sentence. */
  promises: string[];
  /** What the reviewers said, in their own words. */
  evidence: string;
  /** The files those promises land in — the only ones a repair may touch. */
  files: string[];
}

/** What the newest verdicts say did not hold, and where it lands. */
export function whatDidNotHold(a: {
  space: Space;
  cut: Cut;
  outcome: DispatchOutcome;
}): OnTheProductRepair | undefined {
  const d = a.outcome.delivery;
  if (!d) return undefined;
  const reds = d.proofs.filter((p) => p.verdict === "red" && p.criterionId);
  if (!reds.length) return undefined;
  const byId = new Map(a.space.nodes.map((n) => [n.id, n]));
  const mine: Change[] = a.cut.changeIds
    .map((id) => byId.get(id))
    .filter((n): n is Change => !!n)
    .filter((n) => n.acceptance.some((c) => reds.some((p) => p.criterionId === c.id)));
  if (!mine.length) return undefined;
  return {
    promises: mine.map((n) => n.sentence),
    files: [...new Set(mine.flatMap((n) => (n.grounding?.touchpoints ?? []).map((t) => t.path)))],
    evidence: mine
      .map((n) => {
        const said = n.acceptance
          .map((c) => reds.find((p) => p.criterionId === c.id))
          .filter(Boolean)
          .map((p) => `  - ${p!.label}`)
          .join("\n");
        return `── ${n.sentence}\n${said}`;
      })
      .join("\n"),
  };
}

/**
 * Drive the repair loop. Every step is injected, so the rule holds without
 * a browser or a platform behind it.
 */
export async function repairWhatDidNotHold(a: {
  st: RunState;
  say: (line: string) => void;
  doing: (line: string) => void;
  /** Repair the tree from the reviewers' words, bounded to those files. */
  repair: (r: OnTheProductRepair, attempt: number) => Promise<{ green: boolean; report: string }>;
  /** The repository's own build, here. Nothing is pushed until it passes. */
  buildsHere: () => Promise<{ ok: boolean; output: string }>;
  /** Put the repair in the project. `moved` says whether anything new
   *  actually went in. */
  land: () => Promise<{ ok: boolean; why?: string; moved?: boolean }>;
  /** Wait for the platform to take it live again. */
  waitUntilLive: () => Promise<{ live: boolean; why?: string }>;
  /** Ask the reviewers again, about these promises only. */
  judgeAgain: (promises: string[]) => Promise<DispatchOutcome>;
  outcome: DispatchOutcome;
  space: Space;
  cut: Cut;
  attempts?: number;
}): Promise<DispatchOutcome> {
  let outcome = a.outcome;
  const attempts = a.attempts ?? ATTEMPTS_ON_THE_PRODUCT;
  for (let tried = 1; tried <= attempts; tried++) {
    if (a.st.halted) return outcome;
    const found = whatDidNotHold({ space: a.space, cut: a.cut, outcome });
    if (!found) return outcome;
    a.say(
      `${found.promises.length} promise(s) do not hold on the running product — repairing (${tried} of ${attempts}), in ${
        found.files.length ? found.files.slice(0, 4).join(", ") : "the files they land in"
      }`,
    );
    a.doing(`repairing what the reviewers found (${tried} of ${attempts})`);
    const fixed = await a.repair(found, tried);
    if (!fixed.green) {
      a.say(`the repair did not settle it: ${fixed.report.split("\n").slice(-2).join(" ").slice(0, 300)}`);
      return outcome;
    }
    a.doing("building it here before pushing anything");
    const built = await a.buildsHere();
    if (!built.ok) {
      a.say(`the repair does not build here, so it was not pushed: ${built.output.split("\n").slice(-2).join(" ").slice(0, 300)}`);
      return outcome;
    }
    const landed = await a.land();
    if (!landed.ok) {
      a.say(`the repair could not be put in the project: ${landed.why ?? "no reason given"}`);
      return outcome;
    }
    // Nothing new in the project means nothing for the platform to build,
    // so there is no new version to wait for and nothing to judge again.
    if (landed.moved === false) {
      a.say("the repair changed nothing — there is nothing new for the platform to build");
      return outcome;
    }
    const went = await a.waitUntilLive();
    if (!went.live) {
      a.say(`the repair is in the project, but it did not go live: ${went.why ?? "no reason given"}`);
      return outcome;
    }
    outcome = await a.judgeAgain(found.promises);
  }
  const left = whatDidNotHold({ space: a.space, cut: a.cut, outcome });
  if (left)
    a.say(
      `${left.promises.length} promise(s) still do not hold on the running product after ${attempts} repairs — they are on your report`,
    );
  return outcome;
}
