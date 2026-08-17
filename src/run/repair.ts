/**
 * The oracle's rounds, with the owner rule applied: a round's failures are
 * classified; the check-owned ones are repaired by the tester's re-author
 * and the round is run again; the reply the coder reads says what was
 * repaired and which failures are the environment's, not its own.
 */
import { formatVerifyReply, VerifyOracle, VerifyResult } from "../engine/verifyOracle";
import { failuresByOwner } from "./owner";

export type Repair = (slice: string, failures: { ac: number; evidence: string }[]) => Promise<string[]>;

/** One verify round for the coder, repaired once when a check could not run. */
export async function verifyWithRepair(args: {
  oracle: VerifyOracle;
  slice: string;
  repair: Repair;
  halted?: () => boolean;
  /** The acting unit's footprint — a build that fails only outside it is not its failure. */
  footprint?: readonly string[];
}): Promise<string> {
  let r = await args.oracle.verify();
  const notes: string[] = [];
  if (r.kind === "build-failed" && args.footprint) {
    const mine = args.footprint;
    const outside = r.errorFiles.filter((f) => !mine.some((m) => f === m || f.startsWith(m + "/")));
    if (outside.length && outside.length === r.errorFiles.length)
      notes.push(
        "──── ENVIRONMENT (not your code) ────",
        `The build fails only in files outside your footprint: ${outside.join(", ")}. Another unit's work, or the committed base, does not compile right now. Do not change your files for this; verify again in a moment.`,
      );
  }
  const repaired = await repairChecks(args, r);
  if (repaired.length && !args.halted?.()) {
    r = await args.oracle.verify();
    notes.push(
      "──── CHECKS REPAIRED (they could not run — the tester re-wrote them from their criteria; the round was run again) ────",
      ...repaired.map((x) => `- ${x}`),
    );
  }
  const env = failuresByOwner(r).filter((f) => f.owner === "environment");
  if (env.length)
    notes.push(
      "──── ENVIRONMENT (not your code: the runner could not build or a tool was missing) ────",
      ...env.map((f) => `- check ${f.ac}: ${f.evidence.split("\n").slice(1, 3).join(" ").trim().slice(0, 200)}`),
    );
  return [formatVerifyReply(r), ...notes].join("\n\n");
}

/** The mandatory green-check, repaired once the same way. */
async function confirmWithRepair(args: {
  oracle: VerifyOracle;
  slice: string;
  repair: Repair;
  halted?: () => boolean;
}): Promise<{ green: boolean; result: VerifyResult }> {
  let c = await args.oracle.confirmGreen();
  if (c.green || args.halted?.()) return c;
  const repaired = await repairChecks(args, c.result);
  if (repaired.length && !args.halted?.()) c = await args.oracle.confirmGreen();
  return c;
}

async function repairChecks(
  args: { slice: string; repair: Repair },
  r: VerifyResult,
): Promise<string[]> {
  const broken = failuresByOwner(r).filter((f) => f.owner === "check");
  if (!broken.length) return [];
  return args.repair(args.slice, broken);
}

/**
 * The mandatory green-check with the tree's failures told apart from the
 * coder's: when the build fails only in files this unit does not own while
 * other slices are still landing, the failure is theirs to resolve — this
 * unit waits for the next commit and is graded again, up to six times,
 * without spending a rework.
 */
export async function confirmWaitingForTree(args: {
  oracle: VerifyOracle;
  slice: string;
  repair: Repair;
  halted: () => boolean;
  footprint: readonly string[];
  othersPending: () => boolean;
  waitForCommit: () => Promise<void>;
  say: (why: string) => void;
}): Promise<{ green: boolean; result: VerifyResult }> {
  let confirm = await confirmWithRepair(args);
  for (let waits = 0; waits < 6 && !args.halted(); waits++) {
    const r = confirm.result;
    if (r.kind !== "build-failed") break;
    const foreign = r.errorFiles.filter((f) => !args.footprint.some((m) => f === m || f.startsWith(m + "/")));
    if (!foreign.length || foreign.length !== r.errorFiles.length || !args.othersPending()) break;
    args.say(`the build fails only outside this unit's footprint (${foreign.slice(0, 3).join(", ")}) — waiting for another slice to land`);
    await args.waitForCommit();
    confirm = await confirmWithRepair(args);
  }
  return confirm;
}
