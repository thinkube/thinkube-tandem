/**
 * Every worker question ends with the machine — nothing waits on a person.
 *
 * The person who commissioned the work reviews the delivery, decisions on
 * its face; they are never interrupted mid-run. A question the supervisor
 * could not answer used to park the unit until the person replied — and a
 * parked unit writes no log lines, so a person twenty minutes from the
 * desk watched the stall watchdog kill a healthy run for the crime of
 * asking first. Now an open choice is DECIDED, on the record: the wrong
 * decision costs one rerun; the wait cost the whole run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeParkAnswerer } from "./answers";

function supervisor(reply: string | null) {
  const decisions: { unit: string; text: string }[] = [];
  const faults: { trigger: string; type?: string }[] = [];
  const answers: string[] = [];
  const ask = makeParkAnswerer({
    briefBySlice: new Map([["SL-1", "the brief"]]),
    sliceProbes: new Map(),
    testerWt: "/nowhere",
    worktree: "/nowhere",
    model: "sonnet",
    log: () => {},
    defect: (e: { trigger: string; type?: string }) => faults.push({ trigger: e.trigger, ...(e.type ? { type: e.type } : {}) }),
    onDecision: (unit: string, text: string) => decisions.push({ unit, text }),
    supervisorRound: async () => reply,
  } as never)("SL-1", "SL-1#eu-0");
  return { ask, decisions, faults, answers, answer: (t: string) => answers.push(t) };
}

test("an open choice is decided and recorded, never parked on the person", async () => {
  const s = supervisor(
    "DECIDE: when someone presses stop, the work already done is kept — the asks value nothing above not losing work.",
  );
  await s.ask("should a stop discard or keep the finished units?", s.answer);

  assert.equal(s.answers.length, 1, "the worker gets an answer and continues — it never waits");
  assert.match(s.answers[0], /Decided: when someone presses stop, the work already done is kept/);
  assert.match(s.answers[0], /recorded on the delivery/, "and is told where the person will judge it");
  assert.deepEqual(
    s.decisions.map((d) => d.unit),
    ["SL-1#eu-0"],
    "the decision rides the delivery, beside every other decision the person reviews",
  );
  assert.equal(s.faults[0]?.type, "decision");
});

test("a supervisor that gives no ruling still leaves nobody waiting", async () => {
  const s = supervisor(null);
  await s.ask("keep or discard?", s.answer);

  assert.equal(s.answers.length, 1, "the worker is answered even when the machine has no answer");
  assert.match(s.answers[0], /Choose the reading your brief best supports/);
  assert.match(s.answers[0], /state\s+the choice and its reason in your final words/);
  assert.equal(s.faults[0]?.type, "machine", "an unusable ruling is the machine's fault, on its record");
});

test("a question the brief settles is answered outright, not turned into a decision", async () => {
  const s = supervisor("ANSWER: the brief already names the store path — use it as given.");
  await s.ask("where does the store live?", s.answer);

  assert.match(s.answers[0], /the brief already names the store path/);
  assert.deepEqual(s.decisions, [], "an answer is not a decision — nothing extra for the person to review");
});
