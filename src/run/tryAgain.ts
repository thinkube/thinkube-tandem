/**
 * When the platform refuses what the run merged.
 *
 * Deploy-first means the run is not finished when it merges: it is
 * finished when the product is live. So a build the platform rejects is a
 * red like any other red, and the run answers it instead of handing the
 * person a broken project and calling that a report.
 *
 * Three rules keep the loop honest:
 *
 *   - it repairs only what the platform's own words name, so a failure in
 *     one file does not become a tidy-up of the tree;
 *   - nothing is pushed until the repository's own build passes here, so
 *     no attempt is made on hope;
 *   - two attempts, then it stops and says what it could not fix, in the
 *     platform's words. A loop that never gives up is a loop nobody can
 *     read.
 */
interface Attempt {
  /** The platform's account of what failed, for the repair to work from. */
  evidence: string;
  /** The files its words name — the only ones the repair may touch. */
  files: string[];
}

export interface TryAgainSteps {
  /** Why the last attempt did not go live, in the platform's own words. */
  whyItFailed: () => Promise<Attempt>;
  /** Repair the tree from that evidence. Green means it believes it done. */
  repair: (a: Attempt, attempt: number) => Promise<{ green: boolean; report: string }>;
  /** The repository's own build, here. Nothing is pushed until it passes. */
  buildsHere: () => Promise<{ ok: boolean; output: string }>;
  /** Put the repaired work in the project again. */
  land: () => Promise<{ ok: boolean; why?: string }>;
  /** Wait for the platform, again. */
  waitUntilLive: () => Promise<{ live: boolean; why?: string }>;
  say: (line: string) => void;
  doing: (line: string) => void;
  halted?: () => boolean;
}

export const ATTEMPTS = 2;

/**
 * Answer the platform's refusal, up to twice. Returns how it ended and
 * what the person is left looking at.
 */
export async function repairUntilLive(
  steps: TryAgainSteps,
  attempts = ATTEMPTS,
): Promise<{ live: boolean; why?: string; attempts: number; spent: boolean }> {
  let tried = 0;
  let why: string | undefined;
  while (tried < attempts) {
    if (steps.halted?.()) return { live: false, why: "the run was stopped", attempts: tried, spent: false };
    tried++;
    const found = await steps.whyItFailed();
    steps.say(
      `the platform refused it — trying again (${tried} of ${attempts}), on what it named: ${
        found.files.length ? found.files.slice(0, 4).join(", ") : "its own words"
      }`,
    );
    steps.doing(`repairing what the platform reported (attempt ${tried} of ${attempts})`);
    const fixed = await steps.repair(found, tried);
    if (!fixed.green) {
      why = `the repair did not settle it: ${fixed.report.split("\n").slice(-2).join(" ").slice(0, 300)}`;
      steps.say(why);
      break;
    }
    steps.doing("building it here before pushing anything");
    const built = await steps.buildsHere();
    if (!built.ok) {
      why = `the repair does not build here, so it was not pushed: ${built.output.split("\n").slice(-2).join(" ").slice(0, 300)}`;
      steps.say(why);
      break;
    }
    const landed = await steps.land();
    if (!landed.ok) {
      why = `the repair could not be put in the project: ${landed.why ?? "no reason given"}`;
      steps.say(why);
      break;
    }
    steps.say("the repair is in the project — asking the platform again");
    const went = await steps.waitUntilLive();
    if (went.live) return { live: true, attempts: tried, spent: false };
    why = went.why;
  }
  return { live: false, ...(why ? { why } : {}), attempts: tried, spent: tried >= attempts };
}
