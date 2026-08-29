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
/** Repo-relative file paths an answer names, in the forms an answer writes
 *  them: bare, backticked, or quoted. */
function pathsNamed(text: string): string[] {
  return [...new Set([...text.matchAll(/[\w./-]*[\w-]+\.(?:[cm]?[jt]sx?|py|rb|go|rs|json|md|adoc)\b/g)].map((m) => m[0]))];
}

/**
 * An answer that sends a worker outside its own footprint.
 *
 * The guard restores anything a unit was not cleared for and fails the
 * unit for it. So an answer naming files this unit may not write is not
 * an answer — it is an instruction to be stopped, and the worker has no
 * way to know that until the edit is reverted underneath it. Clearance
 * has its own line (CLEAR), which actually opens the door; prose does not.
 *
 * Returns the paths the unit may not write, or nothing.
 */
export function outsideFootprint(text: string, footprint: readonly string[]): string[] {
  if (!footprint.length) return [];
  const mine = (p: string): boolean =>
    footprint.some((f) => p === f || p.endsWith("/" + f) || f.endsWith("/" + p) || p.startsWith(f.replace(/\/$/, "") + "/"));
  return pathsNamed(text).filter((p) => /\//.test(p) && !mine(p));
}

/**
 * Text that shows the run's own machinery: a file, a path, a machine error
 * code, or a word only this machine uses. A person is asked about
 * behaviour, never about these.
 *
 * It used to match TypeScript — `.ts`, `.json`, `tsc`, `npm`, and four
 * directory names from this repository. A Python worker asking about
 * `handlers.py`, or a Go worker about `go.mod`, named an internal and was
 * not caught, so the question reached the person as if it were about the
 * work. The shapes below are language-agnostic: any file, any path, any
 * shouting error code, and this methodology's own vocabulary — which is
 * the same in every language because it is ours, not an ecosystem's.
 */
export function reachesThePerson(text: string): boolean {
  return !namesInternals(text);
}

function namesInternals(text: string): boolean {
  return (
    pathsNamed(text).length > 0 ||
    // Any filename SHAPE, not a list of extensions: `go.mod`,
    // `Cargo.toml`, `pyproject.toml` and whatever the next ecosystem calls
    // its manifest are all a name, a dot, and a short word.
    /\b[\w-]{2,}\.[a-z]{1,6}\b/.test(text) ||
    /(^|\s)[\w.-]+\/[\w./-]+/.test(text) ||
    /\b(ERR_[A-Z_]+|E[A-Z]{3,}\b)/.test(text) ||
    /\b(verify|oracle|footprint|probe|slice|clearance|worktree|runner)\b/i.test(text)
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
        // An answer that names files this unit may not write walks it into
        // the guard: the edit is made, restored underneath it, and the unit
        // fails for doing what it was told. The worker is told what it may
        // write instead, which is the one fact it needs and cannot see.
        const mine = a.footprintOf?.(slice) ?? [];
        const stray = outsideFootprint(text, mine);
        if (stray.length) {
          a.log(`⛔ ${unit}: the answer named ${stray.join(", ")} — not this unit's to write; the worker is told what is`, unit);
          a.defect({
            slice,
            unit,
            activity: "worker question",
            trigger: "supervisor",
            type: "contract",
            impact: "an answer would have sent the worker into the guard",
            detail: `Q: ${question.slice(0, 300)}\nA named: ${stray.join(", ")}`,
          });
          answer(
            `That answer named ${stray.join(", ")}, which this unit may not write — an edit there is restored and the unit fails for it. ` +
              `What you may write is exactly: ${mine.join(", ")}. Keep your work inside that, and say UNDELIVERED with the reason if the promise cannot be kept from there.`,
          );
          return;
        }
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
