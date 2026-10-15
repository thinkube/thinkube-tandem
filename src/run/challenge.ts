/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The valve on the blinding wall, and the check's own repair.
 *
 * A coder that believes a check misreads its criterion challenges it; a
 * judge that can see both sides rules, and a granted ruling re-authors the
 * check from the criterion it proves — never from the coder's argument.
 * A check that cannot RUN is the check's failure, and is re-authored on
 * the same terms. Both are budgeted: a valve, never a grinding strategy.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkerModel } from "../engine/workerModel";
import { runReadRound } from "../derive/round";
import { runAuthoringRound } from "./author";
import type { OracleFactoryArgs } from "./oracle";
import { pulseOf } from "./oracle";
import { isCheckOf } from "../core/testShape";
import { formatVerifyReply, type VerifyResult } from "../engine/verifyOracle";
import { CHALLENGE_BUDGET } from "./challengeBudget";
import { installedVersions } from "./installed";
import { fixturesStanza } from "./brief";
import { productionSeams, sharedFixtures } from "./seams";

/** What the coder's last verify printed for one check — the failing
 *  assertion and its traceback — or why there is nothing to judge yet. */
function verifyOutputFor(result: VerifyResult | undefined, ac: number): { output: string } | { refusal: string } {
  if (!result) return { refusal: `check ${ac} has not run yet — run verify first; a challenge is judged against what the check printed.` };
  if (result.kind === "results") {
    const r = result.results.find((x) => x.ac === ac);
    if (!r) return { refusal: `check ${ac} did not run in your last verify — run verify first; a challenge is judged against what the check printed.` };
    if (r.pass) return { refusal: `check ${ac} passed in your last verify — there is nothing to challenge.` };
    return { output: r.evidence };
  }
  if (result.kind === "build-failed") return { output: result.output };
  return { output: formatVerifyReply(result) };
}

/**
 * The coder's challenge, adjudicated. The coder never sees the probe; the
 * judge sees everything and answers one narrow question: does the probe
 * faithfully render the criterion the human signed? Granted → a fresh
 * authoring round rewrites the probe FROM THE CRITERION (the coder's
 * argument is not the spec), the ruling rides the delivery's face, and
 * the coder is told to verify again. Denied → the check stands, with the
 * reason. The criterion itself is never touched by this channel — a
 * coder disputing the criterion is disputing the human, and that parks.
 */
export function makeChallenge(
  a: OracleFactoryArgs,
): (slice: string, lastVerify: () => VerifyResult | undefined) => (ac: number, argument: string) => Promise<string> {
  const spent = new Map<string, number>();
  return (slice: string, lastVerify: () => VerifyResult | undefined) =>
    async (ac: number, argument: string): Promise<string> => {
      const used = spent.get(`${slice}#${ac}`) ?? 0;
      if (used >= CHALLENGE_BUDGET)
        return `check ${ac} has been challenged ${CHALLENGE_BUDGET} times — meet it as it stands, or report UNDELIVERED with your evidence.`;
      const criterion = a.criterionOf?.(slice, ac);
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => isCheckOf(p, ac));
      if (!criterion || !rel) return `no check ${ac} exists on this slice.`;
      const ran = verifyOutputFor(lastVerify(), ac);
      if ("refusal" in ran) return ran.refusal;
      let probeSrc = "";
      try {
        probeSrc = (await fs.readFile(path.join(a.testerWt, rel), "utf8")).slice(0, 12000);
      } catch {
        return `check ${ac} has no probe yet — nothing to challenge; run verify first.`;
      }
      spent.set(`${slice}#${ac}`, used + 1);
      const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
      const reply = await (a.supervisorRound ?? runReadRound)(
        { model: judge, repoRoot: a.testerWt, log: a.log, ...pulseOf(a, a.acting?.(slice)?.unit ?? slice) },
        [
          "You are the ORACLE ruling on a coder's CHALLENGE to one check. You see",
          "everything; the coder saw only its own failures. Judge ONE question:",
          "does the probe faithfully render the criterion? A probe that asserts",
          "implementation details the criterion never demands, contradicts a",
          "stated rule of the run, or cannot be satisfied by ANY correct",
          "implementation is DEFECTIVE. A probe that relies on behaviour the",
          "INSTALLED version of a library lacks is DEFECTIVE — judge the library",
          "by the versions below and what it printed, never by the version you",
          "remember. A probe the coder merely finds hard is FAITHFUL. The",
          "criterion itself is not on trial.",
          "Your FIRST line must be exactly DEFECTIVE or FAITHFUL, then one plain",
          "sentence of reason.",
          "",
          `THE CRITERION (signed by the human): ${criterion.text}`,
          "",
          "──── THE PROBE'S SOURCE ────",
          probeSrc,
          "",
          "──── WHAT IT PRINTED in the coder's last verify (the failing assertion and its traceback) ────",
          ran.output.slice(0, 6000),
          "",
          "──── THE INSTALLED VERSIONS of the libraries the probe touches ────",
          installedVersions(a.testerWt, rel),
          "",
          "──── THE CODER'S ARGUMENT ────",
          argument.slice(0, 4000),
        ].join("\n"),
      );
      const granted = !!reply?.trimStart().toUpperCase().startsWith("DEFECTIVE");
      const reason = (reply ?? "the judge was unreachable — the check stands")
        .split("\n")
        .slice(0, 2)
        .join(" ")
        .slice(0, 300);
      a.onRuling?.({ slice, criterionId: criterion.id, granted, reason });
      a.defect({
        slice,
        activity: "challenge",
        trigger: "oracle-ruling",
        type: granted ? "test" : "code",
        impact: granted ? "check re-authored" : "challenge denied",
        detail: reason,
      });
      if (!granted) return `DENIED — ${reason}\nMeet the check as it stands.`;
      const rewritten = await reauthorCheck(a, { slice, rel, criterion: criterion.text, because: `an earlier rendering was ruled defective: ${reason}` });
      if (!rewritten)
        return `GRANTED — ${reason}\nBut the re-author failed; the old check stands for now. Run verify.`;
      a.log(`⚖ ${slice}: check ${ac} re-authored at the oracle's ruling — ${reason}`);
      return `GRANTED — ${reason}\nThe check was re-authored from its criterion. Run verify.`;
    };
}

/** A file's text, or "" when it does not exist: a probe not written yet is
 *  an empty one. Any other read failure is thrown. */
async function textOrAbsent(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

/** Rewrite one probe from its criterion, in the tester's tree, and keep it
 *  past the next snapshot. Used by a granted challenge, the repair loop and
 *  the supervisor's TEST-FAULT alike: the criterion is the spec, the reason
 *  is context. */
async function reauthorCheck(
  a: OracleFactoryArgs,
  args: { slice: string; rel: string; criterion: string; because: string; error?: string },
): Promise<boolean> {
  const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
  const before = await textOrAbsent(path.join(a.testerWt, args.rel));
  // The re-author starts where the tester started: told where it is, how
  // checks are written here, and which sibling probes run — not blind.
  const siblings = (a.sliceProbes.get(args.slice) ?? []).filter((p) => p !== args.rel).slice(0, 3);
  const log = (line: string) => a.log(line, a.acting?.(args.slice)?.unit);
  const rewritten = await (a.author ?? runAuthoringRound)(
    { cwd: a.testerWt, model: judge, allowWrite: [args.rel], log, maxTurns: 30 },
    [
      `Rewrite the probe at ${args.rel} FROM ITS CRITERION alone. ${args.because}`,
      "",
      `THE CRITERION it must prove, exactly: ${args.criterion}`,
      ...(args.error
        ? ["", "WHAT THE RUNNER SAID when the old probe ran (fix the cause; the criterion stays):", args.error.slice(0, 2500)]
        : []),
      "",
      `WHERE YOU ARE: ${a.testerWt} — the tester's snapshot of the repository, with the delivery's code. Read only under it.`,
      ...(a.built?.length
        ? [`WHERE THE BUILD EMITS compiled output in this repository: ${a.built.join(", ")} — import compiled modules from there, never from a folder that is not built. Compiled CommonJS modules are imported as a default object (\`import m from "…"; m.name\`), not as named exports.`]
        : []),
      ...(siblings.length ? [`SIBLING PROBES of this slice, written to the same conventions — read one first: ${siblings.join(", ")}`] : []),
      ...(a.digest ? ["", "THE REPOSITORY, READ FOR YOU:", a.digest.slice(0, 6000)] : []),
      fixturesStanza(await sharedFixtures(a.testerWt), await productionSeams(a.testerWt)),
      "",
      "Write a complete, runnable probe file proving only that criterion,",
      "against the repository as this tree shows it. Do not weaken the",
      "criterion and do not test implementation details it never names.",
      "The probe must exit on its own: stop anything it starts.",
      "Overwrite the file in place.",
    ].join("\n"),
  );
  if (rewritten === null) return false;
  // A re-author that left the file as it was did nothing, whatever it said.
  const after = await textOrAbsent(path.join(a.testerWt, args.rel));
  if (after === before) return false;
  await a.persistProbe?.(args.rel);
  return true;
}

/** Re-authors one check may take on the supervisor's TEST-FAULT. */
const TEST_FAULT_BUDGET = 1;

/**
 * The supervisor's TEST-FAULT, acted on: a check that contradicts the intent
 * or fakes a seam differently from the code is re-authored from its
 * criterion at once, before the coder's next verify. No challenge is spent:
 * the fault was found by the run, not argued by the coder. The checks
 * re-authored are the failing ones the verdict names by path, file name,
 * `AC-n` or `check n`; the supervisor is shown only the failing checks, so
 * a verdict that names none of them is about all of them. Returns what the
 * coder reads.
 */
export function makeTestFault(
  a: OracleFactoryArgs,
): (slice: string, verdict: string, failingAcs: readonly number[]) => Promise<string> {
  const spent = new Map<string, number>();
  return async (slice, verdict, failingAcs) => {
    const probes = a.sliceProbes.get(slice) ?? [];
    const failing = failingAcs.flatMap((ac) => {
      const rel = probes.find((p) => isCheckOf(p, ac));
      return rel ? [{ ac, rel }] : [];
    });
    const named = failing.filter(
      (f) =>
        verdict.includes(f.rel) ||
        verdict.includes(path.posix.basename(f.rel)) ||
        new RegExp(`\\b(?:AC-|check\\s+)${f.ac}\\b`, "i").test(verdict),
    );
    const why = verdict.replace(/^\s*TEST-FAULT:?\s*/i, "").trim();
    const log = (line: string) => a.log(line, a.acting?.(slice)?.unit);
    const rewritten: number[] = [];
    const standing: number[] = [];
    for (const f of named.length ? named : failing) {
      const key = `${slice}#${f.ac}`;
      const used = spent.get(key) ?? 0;
      const criterion = a.criterionOf?.(slice, f.ac);
      if (used >= TEST_FAULT_BUDGET || !criterion) {
        standing.push(f.ac);
        continue;
      }
      spent.set(key, used + 1);
      const ok = await reauthorCheck(a, {
        slice,
        rel: f.rel,
        criterion: criterion.text,
        because:
          `The run's supervisor read this check against the code it drives and ruled it at fault: ${why.slice(0, 1500)} ` +
          "A double implements EVERY method the production path calls on its seam; a shared fixture is used where one exists.",
      });
      a.onRuling?.({ slice, criterionId: criterion.id, granted: ok, reason: `TEST-FAULT: ${why.split("\n")[0].slice(0, 300)}` });
      a.defect({
        slice,
        activity: "verify-oracle supervision",
        trigger: "supervisor",
        type: "test",
        stage: "check",
        impact: ok ? "check re-authored on the supervisor's TEST-FAULT — no challenge spent" : "TEST-FAULT re-author failed — the check stands",
        detail: `check ${f.ac}: ${why.slice(0, 900)}`,
      });
      log(ok ? `🔧 ${slice}: check ${f.ac} is at fault — re-authored from its criterion before the next verify` : `⚠ ${slice}: check ${f.ac} is at fault and the re-author failed`);
      (ok ? rewritten : standing).push(f.ac);
    }
    return [
      ...(rewritten.length
        ? [`TEST-FAULT — check(s) ${rewritten.join(", ")} did not render their criteria faithfully and were re-authored from them; no challenge was spent. Run verify again.`]
        : []),
      ...(standing.length
        ? [`TEST-FAULT on check(s) ${standing.join(", ")}, which stand as written: ${why.slice(0, 1500)}\nDo NOT conform to them — challenge them.`]
        : []),
    ].join("\n");
  };
}

const REPAIR_BUDGET = 1;

/**
 * The repair loop for check-owned failures: a check that could not run —
 * its import did not resolve, it threw before any test, it never exited —
 * is re-authored from its criterion with the runner's words in hand. No
 * challenge is spent; the coder is told what was repaired. Each check is
 * repaired at most twice per slice.
 */
/** Re-author one check from its criterion, for a ruling made elsewhere
 *  (the diagnoser). The probe is rewritten, never weakened. */
export function makeReauthor(a: OracleFactoryArgs): (slice: string, ac: number, why: string) => Promise<boolean> {
  return async (slice, ac, why) => {
    const criterion = a.criterionOf?.(slice, ac);
    const rel = (a.sliceProbes.get(slice) ?? []).find((p) => isCheckOf(p, ac));
    if (!criterion || !rel) return false;
    const ok = await reauthorCheck(a, {
      slice,
      rel,
      criterion: criterion.text,
      because: `the oracle ran this check and ruled it DEFECTIVE: ${why}. Write it so a correct implementation CAN pass: if its tests share module state, make each test load the module fresh after installing its own fakes.`,
    });
    return ok;
  };
}

export function makeRepair(
  a: OracleFactoryArgs,
): (slice: string, failures: { ac: number; evidence: string }[]) => Promise<string[]> {
  const spent = new Map<string, number>();
  return async (slice, failures) => {
    const repaired: string[] = [];
    for (const f of failures) {
      const key = `${slice}#${f.ac}`;
      const used = spent.get(key) ?? 0;
      if (used >= REPAIR_BUDGET) continue;
      const criterion = a.criterionOf?.(slice, f.ac);
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => isCheckOf(p, f.ac));
      if (!criterion || !rel) continue;
      spent.set(key, used + 1);
      const head = f.evidence.split("\n").find((l) => /Error|Cannot|timed out|did not exit/i.test(l))?.trim().slice(0, 200) ?? "the check could not run";
      const ok = await reauthorCheck(a, {
        slice,
        rel,
        criterion: criterion.text,
        because: `The old probe could not run — that is the check's fault, not the code's.`,
        error: f.evidence,
      });
      a.onRuling?.({ slice, criterionId: criterion.id, granted: ok, reason: `the check could not run: ${head}` });
      a.defect({
        slice,
        activity: "check repair",
        trigger: "check-owner",
        type: "test",
        impact: ok ? "check re-authored from its criterion" : "re-author failed — the check stands",
        detail: head,
      });
      a.log(ok ? `🔧 ${slice}: check ${f.ac} could not run (${head}) — re-authored from its criterion` : `⚠ ${slice}: check ${f.ac} could not run and the re-author failed`, a.acting?.(slice)?.unit);
      if (ok) repaired.push(`check ${f.ac}: ${head}`);
    }
    return repaired;
  };
}
