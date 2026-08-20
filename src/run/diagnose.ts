/**
 * When a failure says nothing, the machine looks — it does not let the
 * coder guess.
 *
 * A check can fail with evidence that carries no information (an assertion
 * whose expected and actual are both empty), or fail identically round
 * after round. The coder may not read the probe, so it can only hypothesise;
 * that is the most expensive loop in the run. The diagnoser is the judge
 * that CAN see everything and, unlike the challenge's reader, RUNS the
 * probe against the coder's current tree, reads what it prints, and answers
 * one question: could any correct implementation pass this check?
 *
 * DEFECTIVE → the probe is re-authored from its criterion and the ruling
 * rides the delivery. FAITHFUL → the coder is told, concretely, what its
 * code must do — never "try again".
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkerModel } from "../engine/workerModel";
import { runReadRound } from "../derive/round";
import type { OracleFactoryArgs } from "./oracle";

/** Evidence a coder cannot act on: an assertion that compared nothing it
 *  shows, or a failure with no words of its own at all. */
export function uninformative(evidence: string): boolean {
  const e = evidence.trim();
  if (!e) return true;
  // A value that is empty, or an empty string spelled out, shows nothing.
  const shown = [...e.matchAll(/(expected|actual):[ \t]*(.*)$/gim)].map((m) => m[2].trim().replace(/^['"`]|['"`]$/g, "").trim());
  const hasValues = shown.some((v) => v.length > 0) || /^\s*[+-] (?!actual|expected)\S/m.test(e);
  const asserted = /AssertionError|ERR_ASSERTION|assert/i.test(e);
  if (asserted && !hasValues) return true;
  // Nothing but a heading and a command line.
  return e.split("\n").filter((l) => l.trim() && !/^\$|^AC-\d|^PROBES:/.test(l.trim())).length === 0;
}

export type Diagnoser = (
  slice: string,
  ac: number,
  evidence: string,
) => Promise<{ note: string; reauthored: boolean } | undefined>;

/** Diagnoses a check at most once per slice. */
export function makeDiagnoser(
  a: OracleFactoryArgs,
  reauthor: (slice: string, ac: number, why: string) => Promise<boolean>,
): Diagnoser {
  const spent = new Set<string>();
  return async (slice, ac, evidence) => {
    const key = `${slice}#${ac}`;
    if (spent.has(key)) return undefined;
    const criterion = a.criterionOf?.(slice, ac);
    const rel = (a.sliceProbes.get(slice) ?? []).find((p) => p.includes(`_AC-${ac}.`));
    const verif = (a.sliceVerifs.get(slice) ?? []).find((v) => v.ac === ac);
    if (!criterion || !rel || !verif) return undefined;
    spent.add(key);
    const unit = a.acting?.(slice)?.unit;
    const log = (line: string) => a.log(line, unit);
    log(`🔎 ${slice}: check ${ac} failed with nothing a coder can act on — the judge runs it and looks`);
    const runnerDir = path.join(a.wtRoot, "oracle-runners", `${a.tep}-${slice}`);
    const ran = await a.boundedExec(verif.run, runnerDir).catch(() => ({ code: null, output: "" }));
    const src = await fs.readFile(path.join(a.testerWt, rel), "utf8").catch(() => "");
    const reply = await (a.supervisorRound ?? runReadRound)(
      {
        model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
        repoRoot: runnerDir,
        log,
      },
      [
        "You are the ORACLE. A check keeps failing and its evidence tells the coder nothing.",
        "You see everything the coder cannot: the check's SOURCE, and what it printed when it",
        "was just run against the coder's current tree, in the tree itself.",
        "",
        "Answer ONE question: could ANY correct implementation of the criterion pass this check",
        "as written? Read the WHOLE file, not each test alone — a check can be defective through",
        "an INTERACTION its tests have with each other: module state one test establishes and a",
        "later test inherits (a cached singleton, a module loaded once, a fake installed after the",
        "module was already loaded), an order dependence, a leaked global.",
        "",
        "Your FIRST line must be exactly one of:",
        '- "DEFECTIVE: <what makes it unpassable, in one or two sentences>"',
        '- "FAITHFUL: <what the implementation must do, concretely, naming the behavior — never',
        '   \'try again\'>"',
        "",
        `THE CRITERION the human signed: ${criterion.text}`,
        "",
        "──── THE CHECK'S SOURCE ────",
        src.slice(0, 14000),
        "",
        "──── WHAT IT PRINTED, RUN AGAINST THE CODER'S CURRENT TREE ────",
        `$ ${verif.run} → exit ${ran.code ?? "null"}`,
        (ran.output || "(no output)").slice(0, 6000),
        "",
        "──── WHAT THE CODER WAS TOLD (the evidence that says nothing) ────",
        evidence.slice(0, 1500),
      ].join("\n"),
    ).catch(() => null);
    const first = (reply ?? "").trimStart();
    if (/^DEFECTIVE/i.test(first)) {
      const why = first.replace(/^DEFECTIVE:\s*/i, "").split("\n")[0].trim().slice(0, 400);
      const ok = await reauthor(slice, ac, why);
      log(`⚖ ${slice}: check ${ac} is DEFECTIVE — ${why.slice(0, 160)}${ok ? " — re-authored from its criterion" : " — the re-author failed; the check stands"}`);
      a.onRuling?.({ slice, criterionId: criterion.id, granted: ok, reason: `the check could not be passed by any correct implementation: ${why}` });
      a.defect({
        slice,
        unit,
        activity: "diagnosis",
        trigger: "oracle-ruling",
        type: "test",
        impact: ok ? "check re-authored after diagnosis" : "diagnosed defective; re-author failed",
        detail: `check ${ac}: ${why}`,
      });
      return {
        reauthored: ok,
        note: ok
          ? `──── CHECK ${ac} WAS DEFECTIVE (diagnosed by the oracle, which ran it) ────\n${why}\nIt was re-authored from its criterion. Run verify again.`
          : `──── CHECK ${ac} IS DEFECTIVE (diagnosed by the oracle) ────\n${why}\nThe re-author failed; say so in your final summary and do not grind against it.`,
      };
    }
    const guidance = first.replace(/^FAITHFUL:\s*/i, "").trim().slice(0, 1500);
    if (!guidance) return undefined;
    log(`🔎 ${slice}: check ${ac} is faithful — the oracle says concretely what the code must do`);
    a.defect({
      slice,
      unit,
      activity: "diagnosis",
      trigger: "oracle-ruling",
      type: "contract",
      impact: "the coder was told what to build instead of guessing",
      detail: `check ${ac}: ${guidance.slice(0, 400)}`,
    });
    return { reauthored: false, note: `──── WHAT CHECK ${ac} REQUIRES (the oracle ran it and looked; the check is faithful) ────\n${guidance}` };
  };
}
