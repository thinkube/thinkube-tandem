/**
 * Every failure has an owner, and the owner gets the repair loop.
 *
 * The checker reports what it saw; this module says WHOSE failure it is:
 * - CODE — the check ran and its assertion failed: the coder reworks.
 * - CHECK — the check itself could not run: its import did not resolve, it
 *   threw before any test, it never exited. No implementation can turn
 *   that green; the tester re-authors the check from its criterion with the
 *   error in hand.
 * - ENVIRONMENT — the runner could not build or the tool was not there:
 *   nobody's code; the setup step is retried and the round is not charged.
 *
 * Classification reads the evidence text only, so it holds for any runner
 * that names its errors; the patterns are the words runners print, not a
 * language's.
 */
import type { VerifyResult } from "../engine/verifyOracle";

export type FailureOwner = "code" | "check" | "environment";

/** The owner of one failing check, from its evidence. */
export function ownerOf(evidence: string): FailureOwner {
  const e = evidence;
  if (/\[timed out\]|did not exit|timed out after/i.test(e)) return "check";
  if (/before any test ran:/.test(e)) {
    // Something failed at import. A missing module IMPORTED BY THE PROBE
    // is the probe's; a missing tool or a build that never happened is the
    // environment's.
    if (/Cannot find module .* imported from .*(probes|acceptance)\//.test(e)) return "check";
    if (/SyntaxError|ReferenceError|TypeError|ERR_[A-Z_]+/.test(e)) return "check";
    return "check";
  }
  if (/not found|command not found|ENOENT|not the (tsc|.*) command you are looking for/i.test(e)) return "environment";
  return "code";
}

/** The failing checks of a round, each with its owner. */
export function failuresByOwner(
  r: VerifyResult,
): { ac: number; owner: FailureOwner; evidence: string }[] {
  if (r.kind !== "results") return [];
  return r.results
    .filter((x) => !x.pass)
    .map((x) => ({ ac: x.ac, owner: ownerOf(x.evidence), evidence: x.evidence }));
}

/** The lines of a failure that say what failed, with the parts that change
 *  every run (times, addresses, temp paths) taken out. Two rounds with the
 *  same key are the same failure. */
export function evidenceKey(evidence: string): string {
  return evidence
    .split("\n")
    .filter((l) => /Error|error|not ok|Cannot|expected|actual|assert|failed|timed out/i.test(l))
    .map((l) => l.replace(/\d+(\.\d+)?/g, "#").replace(/\/[^\s'"]+/g, "/…").trim())
    .slice(0, 8)
    .join("|");
}
