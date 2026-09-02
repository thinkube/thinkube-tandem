/**
 * Reading sentences again starts by deleting what they produced.
 *
 * A re-reading that only appended left the things a person had grouped
 * pointing at subjects that no longer existed — "1 subject · not worked
 * out yet" on each — and every sentence "not in any of these".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyModel } from "./modelFlow";
import { emptySpace, type Space } from "../core/schema";

function space(): Space {
  return {
    ...emptySpace(),
    asks: [
      { id: "ask-1", text: "My tasks come back sorted.", at: "" },
      { id: "ask-2", text: "Deleting a task asks me first.", at: "" },
    ],
    subjects: [
      { id: "subject-me-1", name: "my tasks", from: ["ask-1"] },
      { id: "subject-me-2", name: "deleting a task", from: ["ask-2"] },
    ],
    claims: [
      { id: "claim-me-1", subjectId: "subject-me-1", text: "come back sorted", fromAsk: "ask-1" },
      { id: "claim-me-2", subjectId: "subject-me-2", text: "asks first", fromAsk: "ask-2" },
    ],
    nodes: [
      { id: "node-me-1", sentence: "The list is sorted.", serves: ["subject-me-1", "ask-1"], servesClaim: "claim-me-1", acceptance: [], needs: [] },
      { id: "node-me-2", sentence: "A confirm box.", serves: ["subject-me-2", "ask-2"], servesClaim: "claim-me-2", acceptance: [], needs: [] },
    ] as never,
    specs: [
      { id: "spec-1", name: "See what to do next", subjectIds: ["subject-me-1"], chosen: true },
      { id: "spec-2", name: "Never lose a task", subjectIds: ["subject-me-2"] },
      { id: "spec-0", name: "From a reading that is gone", subjectIds: ["subject-me-0"] },
    ] as never,
    questions: [
      { id: "q-1", askId: "ask-1", text: "which comes first?" },
      { id: "q-2", askId: "ask-2", text: "how strong a guard?", decided: { text: "one press", at: "" } },
      { id: "q-3", askId: "subject-me-1", text: "raised in the subject's name" },
      { id: "q-4", askId: "subject-me-2", text: "raised in the other subject's name" },
    ] as never,
  };
}

test("what the re-read sentences produced goes; what other sentences produced stays", () => {
  const out = applyModel(
    space(),
    { askIds: ["ask-1"], subjects: [{ name: "the task list", from: [1], claims: [{ text: "in a sensible order", from: 1 }] }] } as never,
    "me",
  );
  assert.deepEqual(out.subjects!.map((s) => s.id), ["subject-me-2", "subject-me-3"]);
  assert.deepEqual(out.claims!.map((c) => c.id), ["claim-me-2", "claim-me-3"]);
  assert.deepEqual(out.nodes.map((n) => n.id), ["node-me-2"], "the promise from the old reading is gone");
  assert.deepEqual(out.specs!.map((sp) => sp.id), ["spec-2"], "the thing around the re-read subject is gone, and so is one naming a subject that no longer exists");
  assert.deepEqual(out.questions.map((q) => q.id), ["q-2", "q-4"], "an undecided question of a re-read sentence or its subject goes; a decided one is a decision and stays");
});

test("signed work is a record and stays through a re-reading", () => {
  const sp = space();
  sp.cuts = [{ id: "cut-1", changeIds: ["node-me-1"], askIds: ["ask-1"], signature: "s", specId: "spec-1" }] as never;
  const out = applyModel(sp, { askIds: ["ask-1", "ask-2"], subjects: [] } as never, "me");
  assert.deepEqual(out.nodes.map((n) => n.id), ["node-me-1"]);
  assert.deepEqual(out.specs!.map((s) => s.id), ["spec-1"]);
});
