/*
 * Copyright Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A worker's exits are held by the harness: a stop without a report is
 * refused, and a question is a tool call the run answers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { answered, questionAsked, REPORT_REFUSALS, stopRefusal } from "./exitProtocol";

test("a stop whose summary says nothing of what was left is refused, with the line to write", () => {
  const why = stopRefusal("I changed the two files and the checks pass.", 0);
  assert.ok(why);
  assert.match(why!, /UNDELIVERED: none/);
});

test("a summary that reports may stop, whether it reports a gap or none", () => {
  assert.equal(stopRefusal("Done.\nUNDELIVERED: none", 0), undefined);
  assert.equal(stopRefusal("- UNDELIVERED: the table migration — question: which schema?", 0), undefined);
  assert.equal(stopRefusal("done\nundelivered: none.", 0), undefined, "case does not matter");
});

test("a question is not a summary, and may stop", () => {
  assert.equal(stopRefusal("⟦NEEDS-INPUT⟧ which of the two tables holds the owner?", 0), undefined);
});

test("a worker that will not report is let go after the refusals run out", () => {
  assert.ok(stopRefusal("no report", REPORT_REFUSALS - 1));
  assert.equal(stopRefusal("no report", REPORT_REFUSALS), undefined);
});

test("a question asked through the tool reaches the run as text, options included", () => {
  const input = {
    questions: [
      { question: "Which table holds the owner?", header: "Table", options: [{ label: "users" }, { label: "accounts" }], multiSelect: false },
      { question: "Keep the old column?", header: "Column", options: [{ label: "yes" }, { label: "no" }], multiSelect: false },
    ],
  };
  assert.equal(questionAsked(input), "Which table holds the owner? (users / accounts)\nKeep the old column? (yes / no)");
  assert.equal(questionAsked({}), "(no question text)");
});

test("the run's answer goes back as the tool's answers, one per question, and the input is otherwise unchanged", () => {
  const input = { questions: [{ question: "A?" }, { question: "B?" }], extra: 1 };
  assert.deepEqual(answered(input, "accounts; keep it"), {
    ...input,
    answers: { "A?": "accounts; keep it", "B?": "accounts; keep it" },
  });
});
