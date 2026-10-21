/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the harness holds a worker to at its exits.
 *
 * A worker leaves a unit in one of two ways: it stops with a final
 * summary, or it asks a question it cannot settle itself. Both used to be
 * read from its text after the fact — a summary with no UNDELIVERED line
 * was taken as complete, and a question was a sentinel the run looked for
 * once the worker had already stopped. The harness has an event for each:
 * a Stop hook can refuse a stop whose summary says nothing about what was
 * left undone, and a question asked through the AskUserQuestion tool
 * reaches the run as a tool call and is answered as its result, with the
 * session still open.
 */

/** The line every final summary ends with: what was not delivered, or `none`. */
const REPORT_LINE = /^\s*(?:[-*+]|\d+[.)])?\s*UNDELIVERED\s*:/im;

/** The sentinel the engine's brief still names for a worker that is stuck;
 *  a message carrying it is a question, not a summary, and may stop. */
const NEEDS_INPUT = "⟦NEEDS-INPUT⟧";

/** How many times a stop is refused before the worker is let go: a worker
 *  that will not report is not made to loop. */
export const REPORT_REFUSALS = 2;

/**
 * Why a stop is refused, or nothing when the summary reports. The refusal
 * says the exact line to write, so the worker's next message is the one
 * the run reads.
 */
export function stopRefusal(lastAssistantMessage: string | undefined, refusedSoFar: number): string | undefined {
  if (refusedSoFar >= REPORT_REFUSALS) return undefined;
  const text = lastAssistantMessage ?? "";
  if (REPORT_LINE.test(text) || text.includes(NEEDS_INPUT)) return undefined;
  return (
    "Your final summary must say what was not delivered: one line per obligation starting exactly with " +
    "`UNDELIVERED: `, or the single line `UNDELIVERED: none` when everything was delivered. " +
    "Write the summary again, ending with that."
  );
}

/** What a worker asked through the question tool, as one text for the run. */
export function questionAsked(input: Record<string, unknown>): string {
  const qs = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
  const lines = qs.map((q) => {
    const text = typeof q.question === "string" ? q.question.trim() : "";
    const options = Array.isArray(q.options)
      ? (q.options as Record<string, unknown>[])
          .map((o) => (typeof o.label === "string" ? o.label : ""))
          .filter(Boolean)
      : [];
    return options.length ? `${text} (${options.join(" / ")})` : text;
  });
  return lines.filter(Boolean).join("\n") || "(no question text)";
}

/**
 * The tool's input with the run's answer in it: every question gets the
 * one answer, since the run answers in words rather than by picking an
 * option per question.
 */
export function answered(input: Record<string, unknown>, answer: string): Record<string, unknown> {
  const qs = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
  const answers: Record<string, string> = {};
  for (const q of qs) if (typeof q.question === "string") answers[q.question] = answer;
  return { ...input, answers };
}
