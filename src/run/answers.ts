/**
 * A worker's questions are answered by the machine — every one of them.
 *
 * The supervisor sees the brief, the checks and the repository; whatever
 * is decidable from those it answers. A genuine choice among behaviors
 * the asks do not decide is DECIDED, on the record: the decision rides
 * the delivery for the person to judge before they accept, and a wrong
 * one costs one rerun. It used to park the unit and wait for the person
 * instead — mid-run, on a question they never expected — and a run
 * waiting on an absent person is a run that dies of silence. The person
 * reviews decisions at the merge; nothing waits on them before it.
 * A doubt is not a gap.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkerModel } from "../engine/workerModel";
import { runReadRound } from "../derive/round";
import type { OracleFactoryArgs } from "./oracle";
import { clearedPaths } from "./oracle";
import { clearanceNote } from "./clearance";

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

export function makeParkAnswerer(a: OracleFactoryArgs) {
  return (slice: string, unit: string) =>
    async (question: string, answer: (text: string) => void): Promise<void> => {
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
        "Nobody else is here: the person who commissioned this work reviews the delivery, with your",
        "decisions on its face — they are never interrupted mid-run, so every question ends with you.",
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
        '- "DECIDE: <the choice, and one sentence of why>" when the answer is a genuine choice among',
        "   behaviors that the asks and the checks do not decide. Pick the reading the asks best support",
        "   and commit to it — the decision rides the delivery for the person to judge before they accept,",
        "   and a wrong choice costs one rerun; a unit stopped to wait costs the run. State the decision",
        "   in the words of the asks (behavior, not files or tools), so the person can judge it.",
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
      if (/^DECIDE:/i.test(first)) {
        const text = first.replace(/^DECIDE:\s*/i, "").split("\n")[0].trim().slice(0, 400);
        a.log(`⚖ ${unit}: the supervisor decided — ${text.slice(0, 140)}`, unit);
        // On the delivery's face, beside every other decision: the person
        // judges it at the merge, which is the only place they judge anything.
        a.onDecision?.(unit, text);
        a.defect({
          slice,
          unit,
          activity: "worker question",
          trigger: "supervisor",
          type: "decision",
          impact: "an open choice was decided and recorded for the person's review",
          detail: `Q: ${question.slice(0, 400)}\nDECIDED: ${text}`,
        });
        answer(`Decided: ${text}\nBuild to that. The decision is recorded on the delivery for the person to review.`);
        return;
      }
      // No ruling came back at all. The worker still may not wait on a
      // person who is not here: it chooses the reading its brief best
      // supports and says so where the report will carry it.
      a.defect({
        slice,
        unit,
        activity: "worker question",
        trigger: "supervisor",
        type: "machine",
        impact: "the supervisor gave no usable ruling — the worker decides and documents",
        detail: `Q: ${question.slice(0, 400)}\nREPLY: ${first.slice(0, 300)}`,
      });
      answer(
        "Nobody can rule on this now. Choose the reading your brief best supports, build to it, and state " +
          "the choice and its reason in your final words — the delivery carries it for the person to review.",
      );
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
