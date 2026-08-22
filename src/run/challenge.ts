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

const CHALLENGE_BUDGET = 2;

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
): (slice: string) => (ac: number, argument: string) => Promise<string> {
  const spent = new Map<string, number>();
  return (slice: string) =>
    async (ac: number, argument: string): Promise<string> => {
      const used = spent.get(`${slice}#${ac}`) ?? 0;
      if (used >= CHALLENGE_BUDGET)
        return `check ${ac} has been challenged ${CHALLENGE_BUDGET} times — meet it as it stands, or report UNDELIVERED with your evidence.`;
      const criterion = a.criterionOf?.(slice, ac);
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${ac}.`));
      if (!criterion || !rel) return `no check ${ac} exists on this slice.`;
      spent.set(`${slice}#${ac}`, used + 1);
      let probeSrc = "";
      try {
        probeSrc = (await fs.readFile(path.join(a.testerWt, rel), "utf8")).slice(0, 12000);
      } catch {
        return `check ${ac} has no probe yet — nothing to challenge; run verify first.`;
      }
      const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
      const reply = await (a.supervisorRound ?? runReadRound)(
        { model: judge, repoRoot: a.testerWt, log: a.log },
        [
          "You are the ORACLE ruling on a coder's CHALLENGE to one check. You see",
          "everything; the coder saw only its own failures. Judge ONE question:",
          "does the probe faithfully render the criterion? A probe that asserts",
          "implementation details the criterion never demands, contradicts a",
          "stated rule of the run, or cannot be satisfied by ANY correct",
          "implementation is DEFECTIVE. A probe the coder merely finds hard is",
          "FAITHFUL. The criterion itself is not on trial.",
          "Your FIRST line must be exactly DEFECTIVE or FAITHFUL, then one plain",
          "sentence of reason.",
          "",
          `THE CRITERION (signed by the human): ${criterion.text}`,
          "",
          "──── THE PROBE'S SOURCE ────",
          probeSrc,
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

/** Rewrite one probe from its criterion, in the tester's tree, and keep it
 *  past the next snapshot. Used by a granted challenge and by the repair
 *  loop alike: the criterion is the spec, the reason is context. */
async function reauthorCheck(
  a: OracleFactoryArgs,
  args: { slice: string; rel: string; criterion: string; because: string; error?: string },
): Promise<boolean> {
  const judge = resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge");
  const before = await fs.readFile(path.join(a.testerWt, args.rel), "utf8").catch(() => "");
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
      ...(a.emitMap?.length
        ? [`OBSERVED IN THIS TREE — a source file lands EXACTLY here: ${a.emitMap.join("; ")}. Import that path shape literally; do not add or drop a directory.`]
        : []),
      ...(siblings.length ? [`SIBLING PROBES of this slice, written to the same conventions — read one first: ${siblings.join(", ")}`] : []),
      ...(a.digest ? ["", "THE REPOSITORY, READ FOR YOU:", a.digest.slice(0, 6000)] : []),
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
  const after = await fs.readFile(path.join(a.testerWt, args.rel), "utf8").catch(() => "");
  if (after === before) return false;
  await a.persistProbe?.(args.rel).catch(() => {});
  return true;
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
    const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${ac}.`));
    if (!criterion || !rel) return false;
    const ok = await reauthorCheck(a, {
      slice,
      rel,
      criterion: criterion.text,
      because: `the oracle ran this check and ruled it DEFECTIVE: ${why}. Write it so a correct implementation CAN pass: if its tests share module state, make each test load the module fresh after installing its own fakes.`,
    });
    if (ok) await a.persistProbe?.(rel).catch(() => {});
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
      const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${f.ac}.`));
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

/** One oracle per slice, memoized; undefined when the slice has no probes. */
