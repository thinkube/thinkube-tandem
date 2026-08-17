/**
 * A worker's questions go to the machine first — mid-way as a park, or at
 * the end in its UNDELIVERED lines. The supervisor sees the brief, the
 * checks and the repository; whatever is decidable from those it answers,
 * and only a question about intent reaches the human, in the human's words.
 * A doubt is not a gap.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkerModel } from "../engine/workerModel";
import { runReadRound } from "../derive/round";
import type { OracleFactoryArgs } from "./oracle";

/**
 * A worker's question goes to the machine first. The supervisor sees the
 * brief, the checks and the repository; whatever is decidable from those it
 * ANSWERS, and the worker continues. Only a question about intent — a choice
 * among behaviors the asks do not decide — is ESCALATED to the human, in the
 * human's own words, never in the run's internals.
 */
export function makeParkAnswerer(a: OracleFactoryArgs) {
  return (slice: string, unit: string) =>
    async (
      question: string,
      answer: (text: string) => void,
      escalate: (intentQuestion: string) => void,
    ): Promise<void> => {
      const brief = a.briefBySlice.get(slice) ?? "";
      const probes = a.sliceProbes.get(slice) ?? [];
      let probeSrc = "";
      for (const rel of probes) {
        try {
          probeSrc += `\n── ${rel} ──\n` + (await fs.readFile(path.join(a.testerWt, rel), "utf8")).slice(0, 6000);
        } catch {
          /* absent probe — skip */
        }
      }
      const prompt = [
        "You are the RUN SUPERVISOR. A worker of an autonomous delivery has stopped to ask a question.",
        "You see what it cannot: its exact brief, the held-out checks' source, and the repository (read-only).",
        "The human who commissioned this work has NOT seen the run's internals and must never be asked",
        "about them — files, names, tools, tests, ordering are the run's own business.",
        "",
        "Your FIRST line must be EXACTLY one of:",
        '- "ANSWER: <the answer, complete and concrete, in the worker\'s terms — everything it needs to continue>"',
        "   whenever the question is decidable from the brief, the checks, the repository or the rules of the run",
        "   (a rule of the run: the coder never touches a test file; the tester owns every test; the coder's",
        "   only feedback is `verify`; a check it believes wrong is challenged, never conformed to blindly).",
        '- "ESCALATE: <the question restated at the level of intent, in the human\'s vocabulary — which',
        "   behavior the asks want — with no file names, tool names or internals>\" ONLY when the answer",
        "   is a genuine choice among behaviors that the asks and the checks do not decide.",
        "",
        `THE UNIT: ${unit} of ${slice}`,
        "",
        "──── THE WORKER'S QUESTION ────",
        question.slice(0, 4000),
        "",
        "──── THE WORKER'S BRIEF ────",
        brief.slice(0, 20000),
        "",
        "──── THE HELD-OUT CHECKS (source; describe what they mean, never paste them) ────",
        probeSrc.slice(0, 12000),
      ].join("\n");
      const reply = await (a.supervisorRound ?? runReadRound)(
        {
          model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
          repoRoot: a.worktree,
          log: (line) => a.log(line, unit),
        },
        prompt,
      ).catch(() => null);
      const first = (reply ?? "").trimStart();
      if (/^ANSWER:/i.test(first)) {
        const text = first.replace(/^ANSWER:\s*/i, "").trim();
        a.log(`↩ ${unit}: the supervisor answered the worker's question`, unit);
        a.defect({
          slice,
          unit,
          activity: "worker question",
          trigger: "supervisor",
          type: "contract",
          impact: "answered from the run's own knowledge — the brief lacked it",
          detail: `Q: ${question.slice(0, 400)}\nA: ${text.slice(0, 600)}`,
        });
        answer(text);
        return;
      }
      const intent = /^ESCALATE:/i.test(first)
        ? first.replace(/^ESCALATE:\s*/i, "").trim()
        : question;
      escalate(intent);
    };
}

/**
 * A question a worker left in its UNDELIVERED lines goes to the machine
 * too — the supervisor decides whether the work is complete as it stands
 * (the question was a doubt, not a gap), a real gap, or a matter of intent.
 * Only a real gap stays undelivered.
 */
export function makeEndAnswerer(a: OracleFactoryArgs) {
  return async (slice: string, unit: string, undelivered: readonly string[]): Promise<string[]> => {
    const kept: string[] = [];
    for (const item of undelivered) {
      if (!/question\s*:/i.test(item)) {
        kept.push(item);
        continue;
      }
      const reply = await (a.supervisorRound ?? runReadRound)(
        {
          model: resolveWorkerModel(a.workerModel ?? { workerModel: a.model }, "judge"),
          repoRoot: a.testerWt,
          log: (line) => a.log(line, unit),
        },
        [
          "You are the RUN SUPERVISOR. A worker finished its unit and left this line, which",
          "carries a question. Decide, from the brief and the rules of the run, whether the",
          "work is complete as it stands or something is really missing.",
          "Rules of the run: a check observes the code at a seam through a fake and never",
          "acts on the world; a tester tests the real classes at their seams — it never has",
          "to reach private wiring, and does not export or refactor production code; the coder",
          "never touches tests; a criterion the machine cannot verify is a note, not a check.",
          "",
          "Your FIRST line must be exactly one of:",
          '- "DELIVERED: <why the work is complete as it stands — answer the worker\'s doubt>"',
          '- "GAP: <what is really missing, in one sentence>"',
          '- "ESCALATE: <the question at intent level, in the human\'s words>"',
          "",
          `THE UNIT: ${unit} of ${slice}`,
          "──── THE WORKER'S LINE ────",
          item.slice(0, 3000),
          "──── THE UNIT'S BRIEF ────",
          (a.briefBySlice.get(slice) ?? "").slice(0, 16000),
        ].join("\n"),
      ).catch(() => null);
      const first = (reply ?? "").trimStart();
      if (/^DELIVERED:/i.test(first)) {
        a.log(`↩ ${unit}: the supervisor answered the closing question — the work stands`, unit);
        a.defect({ slice, unit, activity: "worker question", trigger: "supervisor", type: "contract", impact: "answered — not a gap", detail: `${item.slice(0, 300)}\n→ ${first.slice(0, 400)}` });
        continue;
      }
      const why = first.replace(/^(GAP|ESCALATE):\s*/i, "").trim();
      kept.push(why ? `${item} — supervisor: ${why.slice(0, 300)}` : item);
    }
    return kept;
  };
}
