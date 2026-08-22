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
import { clearedPaths } from "./oracle";
import { clearanceNote } from "./clearance";

/**
 * A worker's question goes to the machine first. The supervisor sees the
 * brief, the checks and the repository; whatever is decidable from those it
 * ANSWERS, and the worker continues. Only a question about intent — a choice
 * among behaviors the asks do not decide — is ESCALATED to the human, in the
 * human's own words, never in the run's internals.
 */
/** Text that shows the run's own machinery: a path, a tool, an error code,
 *  a probe. A person is asked about behavior, never about these. */
function namesInternals(text: string): boolean {
  return (
    /(^|\s)(src|out|out-test|probes|node_modules)\//.test(text) ||
    /\.(ts|tsx|mjs|cjs|js|json)\b/.test(text) ||
    /\b(ERR_[A-Z_]+|tsc|npm|node --test|verify|oracle|footprint|probe)\b/i.test(text)
  );
}

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
        '- "CLEAR: <repo-relative PRODUCTION file paths, space-separated> — <why the unit cannot keep its promise without changing them>"',
        "   ONLY when the criteria this unit is responsible for require a change in a production file it is",
        "   not cleared for. The run clears it and the unit MAKES THE CHANGE IN THIS SAME SESSION. A file",
        "   another unit is changing at this moment is waited for, never refused, and responsibility never",
        "   moves to that unit — the promise stays with the unit that carries it. Only a test-shaped path is",
        "   refused, because the checks are the test author's. Never tell a worker to change a file it is not",
        "   cleared for without this line: words without the clearance send it into the guard.",
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
      if (/^(CLEAR|WIDEN):/i.test(first) && a.clearance) {
        // The key, not a permit: the door may hold while another unit finishes
        // with that file, and then this unit goes in and does the work itself.
        // Nothing is ever handed to another slice — a clearance moves, a
        // promise does not (docs/WORDS.md).
        const note = clearanceNote(await a.clearance(slice, unit, clearedPaths(first)));
        if (note) {
          a.defect({ slice, unit, activity: "worker question", trigger: "supervisor", type: "contract", impact: "clearance ruled", detail: `Q: ${question.slice(0, 300)}\n→ ${note.slice(0, 400)}` });
          answer(note);
          return;
        }
      }
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
      const intent = /^ESCALATE:/i.test(first) ? first.replace(/^ESCALATE:\s*/i, "").trim() : question;
      // The human is never shown the run's internals. A "question" full of
      // paths, tools and error codes is not an intent question: it is the
      // machine failing to answer, and it is answered as such.
      if (namesInternals(intent)) {
        a.log(`⛔ ${unit}: the machine could not answer this itself and its restatement still names internals — not a question for a person`, unit);
        a.defect({
          slice,
          unit,
          activity: "worker question",
          trigger: "supervisor",
          type: "contract",
          impact: "escalation refused — internals, not intent",
          detail: intent.slice(0, 600),
        });
        answer(
          "The machine cannot answer this and it is not a question for a person — it names the run's own internals. " +
            "Do what you are cleared to do, and end with an UNDELIVERED line stating exactly what remains and why.",
        );
        return;
      }
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
          '- "CONTRACT: <a one-sentence obligation for ANOTHER role of this slice — e.g. the coder must export',
          "   a named seam so a check can reach it>\" when the line names work that is not this worker's to do.",
          "   The sentence becomes that role's contract and this unit is complete; wording is binding, so name",
          "   the exact symbol, file and rule.",
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
      if (/^CONTRACT:/i.test(first)) {
        const text = first.replace(/^CONTRACT:\s*/i, "").split("\n")[0].trim().slice(0, 400);
        a.log(`⚖ ${unit}: the closing question became another role's contract — ${text.slice(0, 140)}`, unit);
        a.onDecision?.(unit, text);
        a.defect({ slice, unit, activity: "worker question", trigger: "supervisor", type: "contract", impact: "flowed as contract — not a gap, not a failure", detail: `${item.slice(0, 300)}\n→ CONTRACT: ${text}` });
        continue;
      }
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
