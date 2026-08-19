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

/**
 * Checks that belong to the maintainer, read from a verify result: a red
 * check whose evidence names a test home this runner PRUNED because another
 * unit maintains it. Narrow and mechanical — a coder cannot argue its way
 * in, and a check transferred this way is still graded, at the maintainer
 * and again at the gate; it is never waived.
 */
function transferredChecks(
  r: VerifyResult,
  prunedHomes: readonly string[],
): { ac: number; home: string; evidence: string }[] {
  if (r.kind !== "results") return [];
  const out: { ac: number; home: string; evidence: string }[] = [];
  for (const x of r.results) {
    if (x.pass) continue;
    const home = prunedHomes.find((h) => x.evidence.includes(h));
    if (home) out.push({ ac: x.ac, home, evidence: x.evidence });
  }
  return out;
}

/** Whether a unit is green of its own: every red check is a transfer. */
function greenOfItsOwn(r: VerifyResult, prunedHomes: readonly string[]): boolean {
  if (r.kind !== "results") return false;
  const reds = r.results.filter((x) => !x.pass);
  return reds.length > 0 && transferredChecks(r, prunedHomes).length === reds.length;
}

/** Settle a not-green confirmation: when every red is a transfer, say each
 *  transfer, put it on the record as a ruling, and the unit is green of its
 *  own — the maintainer grades those checks, and the gate grades everything. */
export function settleTransfers(a: {
  result: VerifyResult;
  prunedHomes: readonly string[];
  slice: string;
  unit: string;
  criterionOf?: (slice: string, ac: number) => { id: string; text: string } | undefined;
  onRuling: (r: { criterionId: string; unit: string; granted: boolean; reason: string }) => void;
  log: (line: string) => void;
}): boolean {
  if (!greenOfItsOwn(a.result, a.prunedHomes)) return false;
  for (const t of transferredChecks(a.result, a.prunedHomes)) {
    const crit = a.criterionOf?.(a.slice, t.ac);
    a.log(`⚖ ${a.unit}: check ${t.ac} is graded at the maintainer of ${t.home} — its probe reads a test home this runner holds back for that unit`);
    if (crit)
      a.onRuling({ criterionId: crit.id, unit: a.slice, granted: true, reason: `graded at the maintainer of ${t.home} — the check reads a test home another unit brings under` });
  }
  return true;
}
