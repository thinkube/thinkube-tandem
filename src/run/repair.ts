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
}): Promise<string> {
  let r = await args.oracle.verify();
  const notes: string[] = [];
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
export async function confirmWithRepair(args: {
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
